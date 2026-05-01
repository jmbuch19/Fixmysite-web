import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { detectBusinessType } from '@/lib/brief/detector'
import { generateBrief, type BriefScanSummary } from '@/lib/claude/brief'
import { cardKeysToLabels } from '@/constants/pricing'
import type { Phase1Result } from '@/lib/scan/phase1'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Three Claude calls in series in worst case (detector + brief + retry)
// + DB roundtrips. Comfortable under 60s.
export const maxDuration = 60

const bodySchema = z.object({
  scan_id: z.uuid(),
  // Owner can write a lot — 5000 chars is generous for a textbox.
  owner_text: z.string().trim().min(1).max(5000),
  // Card keys are validated against the canonical list inside
  // cardKeysToLabels — unknown keys are silently dropped, not rejected.
  selected_cards: z.array(z.string()).max(20).default([]),
})

/**
 * POST /api/brief/generate
 *
 * Test endpoint for the Brief generator pipeline (slice 1 of v1.1).
 *
 * Verifies the scan exists and is paid, runs business-type detection
 * (Haiku), then generates the brief (Sonnet). Returns the raw
 * BriefOutput JSON for prompt-quality inspection.
 *
 * TODO(brief-payment): add brief payment gate before returning the
 * full brief. v1 plan per CLAUDE.md BRIEF_PRICING:
 *   - text_only        → ₹99
 *   - with_screenshots → ₹199
 *   - bundle           → ₹199
 * Until that lands, this endpoint is gated only by the underlying
 * scan's payment_status — anyone with a paid scan_id can generate a
 * brief. Acceptable during prompt-tuning; not acceptable for public
 * launch.
 *
 * TODO(persist): write the brief to the briefs table once shape is
 * confirmed. Currently we hold the output in-memory only — caller
 * must save it themselves if they want to keep it.
 *
 * Rate limit: 5/hour/IP — covers honest retry, blocks scraping.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'brief-generate',
    limit: 5,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      {
        error: 'Invalid input',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const { scan_id, owner_text, selected_cards } = parsed.data
  const supabase = createServiceClient()

  // ─── Load scan + verify payment ──────────────────────────────────
  const { data: scan, error: scanErr } = await supabase
    .from('scans')
    .select('id, url, page_count, tier, payment_status, status, phase1_result')
    .eq('id', scan_id)
    .maybeSingle()

  if (scanErr) {
    console.error('[brief/generate] scan lookup failed', {
      scan_id,
      error: scanErr.message,
    })
    return Response.json({ error: 'Could not load scan' }, { status: 500 })
  }
  if (!scan) {
    return Response.json({ error: 'Scan not found' }, { status: 404 })
  }
  if (scan.payment_status !== 'paid') {
    return Response.json(
      { error: 'Brief generation requires a paid scan' },
      { status: 403 },
    )
  }

  const phase1 = scan.phase1_result as Phase1Result | null

  // ─── Business type detection (Haiku) ─────────────────────────────
  // v1.0.x: phase1_result doesn't store full body text — only title +
  // meta description + structured fields. We feed the detector what we
  // have. For drgauravchhaya.com the title alone ("doctor diabetologist
  // in ahmedabad...") is enough to land 'clinic'. If detection quality
  // proves weak across business types, the v1.1 fix is to extend
  // phase1's extractor to capture a body-text excerpt for this purpose.
  const pageTextHints = [
    phase1?.homepage?.title ?? '',
    phase1?.homepage?.metaDescription ?? '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const businessType = await detectBusinessType({
    url: scan.url as string,
    pageText: pageTextHints,
  })

  // ─── Build scan summary for the brief prompt ─────────────────────
  const scanSummary: BriefScanSummary = {
    url: scan.url as string,
    page_count: (scan.page_count as number | null) ?? null,
    tier: (scan.tier as string | null) ?? null,
    ssl: phase1?.ssl ?? null,
    phones_found: phase1?.homepage?.phones?.length ?? 0,
    emails_found: phase1?.homepage?.emails?.length ?? 0,
  }

  // ─── Map card keys → labels (emoji stripped) ─────────────────────
  // The brief generator never sees raw keys — it gets the human-
  // readable labels the owner actually clicked. Unknown keys are
  // silently dropped by cardKeysToLabels.
  const labels = cardKeysToLabels(selected_cards)

  // ─── Generate brief (Sonnet) ─────────────────────────────────────
  const brief = await generateBrief({
    url: scan.url as string,
    businessType,
    scanSummary,
    ownerText: owner_text,
    selectedCards: labels,
    screenshotCount: 0,
  })

  if (!brief) {
    return Response.json(
      { error: 'Brief generation failed', business_type: businessType },
      { status: 500 },
    )
  }

  return Response.json(
    {
      ok: true,
      scan_id,
      business_type: businessType,
      cards_resolved: labels,
      brief,
    },
    { status: 200 },
  )
}
