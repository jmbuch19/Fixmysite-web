import { createServiceClient } from '@/lib/supabase/server'
import { detectBusinessType } from '@/lib/brief/detector'
import {
  generateBrief,
  type BriefOutput,
  type BriefScanSummary,
} from '@/lib/claude/brief'
import { scrubBriefBannedWords } from '@/lib/brief/banWordFilter'
import { cardKeysToLabels } from '@/constants/pricing'
import type { Phase1Result } from '@/lib/scan/phase1'

/**
 * Full brief-creation pipeline used by every entry point that needs a
 * fresh brief (the test endpoint today, the user-facing input form
 * tomorrow). Encapsulates:
 *
 *   1. Load the underlying scan, verify it's paid
 *   2. Detect business_type via Haiku from cached page hints
 *   3. Map predefined card keys → human-readable labels (emoji stripped)
 *   4. Generate the brief via Sonnet
 *   5. Scrub BRAND.md banned words from Claude-authored text fields
 *   6. Persist to the briefs table with payment_status='unpaid'
 *
 * Returns a typed discriminated result so callers (API routes) can map
 * each failure mode to a sensible HTTP status without guessing. Never
 * throws — every failure path is a typed `ok: false` return.
 *
 * One brief per call — multiple calls for the same scan create multiple
 * briefs. That's intentional: an owner who wants to revise their input
 * and re-generate gets a fresh row each time. The 5/hr/IP rate limit
 * on the route prevents abuse.
 */

export type CreateBriefArgs = {
  scan_id: string
  owner_text: string
  selected_cards: string[]
  // Optional today (test endpoint doesn't require it). Required when
  // the user-facing input form ships in 2.2 — the form will gate
  // submit on a valid email so the post-payment flow has somewhere
  // to deliver the PDF.
  owner_email?: string
}

export type CreateBriefResult =
  | {
      ok: true
      brief_id: string
      business_type: string
      cards_resolved: string[]
      brief: BriefOutput
    }
  | {
      ok: false
      reason:
        | 'scan_not_found'
        | 'scan_not_paid'
        | 'generation_failed'
        | 'persist_failed'
        | 'db_error'
      message?: string
    }

export async function createBriefForScan(
  args: CreateBriefArgs,
): Promise<CreateBriefResult> {
  const supabase = createServiceClient()

  // ─── Load scan + verify payment ──────────────────────────────────
  const { data: scan, error: scanErr } = await supabase
    .from('scans')
    .select(
      'id, url, page_count, tier, payment_status, status, phase1_result',
    )
    .eq('id', args.scan_id)
    .maybeSingle()

  if (scanErr) {
    console.error('[brief/service] scan lookup failed', {
      scan_id: args.scan_id,
      error: scanErr.message,
    })
    return { ok: false, reason: 'db_error', message: scanErr.message }
  }
  if (!scan) {
    return { ok: false, reason: 'scan_not_found' }
  }
  if (scan.payment_status !== 'paid') {
    return { ok: false, reason: 'scan_not_paid' }
  }

  const phase1 = scan.phase1_result as Phase1Result | null

  // ─── Business-type detection (Haiku) ─────────────────────────────
  // Uses cached title + meta description from phase1_result. Without
  // body text the detector falls back to 'general' more often, which
  // the brief generator handles by skipping industry-specific
  // terminology guidance. Acceptable degradation.
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
  const labels = cardKeysToLabels(args.selected_cards)

  // ─── Generate brief (Sonnet) ─────────────────────────────────────
  const rawBrief = await generateBrief({
    url: scan.url as string,
    businessType,
    scanSummary,
    ownerText: args.owner_text,
    selectedCards: labels,
    screenshotCount: 0,
  })

  if (!rawBrief) {
    return { ok: false, reason: 'generation_failed' }
  }

  // ─── Scrub banned words ──────────────────────────────────────────
  // Claude usually obeys the system prompt's banned-word rule, but the
  // slice 1 curl test caught one slip ("ensure"). This filter is the
  // hard guarantee — every brief that hits the DB is scrubbed first.
  // Owner verbatim fields are passed through untouched.
  const brief = scrubBriefBannedWords(rawBrief)

  // ─── Persist ─────────────────────────────────────────────────────
  // razorpay_order_id and price_paise use schema defaults (null and
  // 9900 respectively). The payment routes (slice 2.2) populate
  // razorpay_order_id when the Razorpay order is created and flip
  // payment_status to 'paid' when the signature verifies.
  const { data: inserted, error: insertErr } = await supabase
    .from('briefs')
    .insert({
      scan_id: args.scan_id,
      owner_input: args.owner_text,
      detected_language: brief.detected_language,
      business_type: brief.business_type,
      predefined_selections: args.selected_cards,
      brief_json: brief,
      owner_email: args.owner_email ?? null,
      payment_status: 'unpaid',
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    console.error('[brief/service] persist failed', {
      scan_id: args.scan_id,
      error: insertErr?.message,
      code: insertErr?.code,
    })
    return {
      ok: false,
      reason: 'persist_failed',
      message: insertErr?.message,
    }
  }

  return {
    ok: true,
    brief_id: inserted.id as string,
    business_type: businessType,
    cards_resolved: labels,
    brief,
  }
}
