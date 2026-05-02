import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { generateBlueprint } from '@/lib/claude/blueprint'
import { scrubBlueprintBannedWords } from '@/lib/blueprint/banWordFilter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Single Claude call (Sonnet 4.6, ~6k tokens) plus DB roundtrips.
// Comfortable under 60s; the brief route uses the same ceiling.
export const maxDuration = 60

const bodySchema = z.object({
  blueprint_id: z.uuid(),
})

/**
 * POST /api/blueprint/generate
 *
 * Slice 2.1 endpoint:
 *   - Loads the draft row created by /api/blueprint/create
 *   - Idempotent: if status is already 'generated' / 'paid' / 'complete'
 *     and blueprint_json exists, returns the cached blueprint without
 *     touching Claude. Saves tokens on retries and double-load preview
 *     pages.
 *   - Calls Claude (Sonnet 4.6) — fourth distinct Claude call in the
 *     codebase per CLAUDE.md rule 67. Never merge with report / UX
 *     audit / brief.
 *   - Scrubs banned words (utilize / leverage / ensure / robust /
 *     seamless) before persistence — same hard-guarantee pattern as
 *     the brief generator.
 *   - Persists blueprint_json + recommendation + free_text_language,
 *     transitions status draft → generated.
 *   - Returns the full blueprint JSON. The preview page filters out
 *     paid-only fields client-side; the GET /api/blueprint/[id] route
 *     (slice 2.1 part B) is the real payment-gated read.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'blueprint-generate',
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

  const { blueprint_id } = parsed.data
  const supabase = createServiceClient()

  const { data: row, error: loadError } = await supabase
    .from('website_blueprints')
    .select(
      'id, business_type, business_name, owner_name, owner_email, whatsapp_number, answers, free_text, status, blueprint_json',
    )
    .eq('id', blueprint_id)
    .maybeSingle()

  if (loadError) {
    console.error('[blueprint/generate] load failed', {
      blueprint_id,
      error: loadError.message,
      code: loadError.code,
    })
    return Response.json(
      { error: 'Could not load your blueprint. Please try again.' },
      { status: 500 },
    )
  }

  if (!row) {
    return Response.json({ error: 'Blueprint not found' }, { status: 404 })
  }

  // Idempotency. If Claude already ran for this draft, return what we
  // have — no second token spend, no risk of rewriting paid content.
  if (row.status !== 'draft' && row.blueprint_json) {
    return Response.json(
      {
        ok: true,
        blueprint_id,
        cached: true,
        blueprint: row.blueprint_json,
      },
      { status: 200 },
    )
  }

  // Coerce answers to the shape the generator expects. The DB column
  // is jsonb so it can technically hold anything; in practice the
  // create route persists Record<string, string | string[]>, but the
  // type signature here is the one defensive shim we keep.
  const answers =
    row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
      ? (row.answers as Record<string, string | string[]>)
      : {}

  const generated = await generateBlueprint({
    blueprintId: blueprint_id,
    businessType: row.business_type ?? null,
    businessName: row.business_name ?? null,
    ownerName: row.owner_name ?? null,
    ownerEmail: row.owner_email ?? null,
    whatsappNumber: row.whatsapp_number ?? null,
    answers,
    freeText: row.free_text ?? null,
  })

  if (!generated) {
    return Response.json(
      {
        error:
          'Could not generate your blueprint. Please try again in a minute, or email hello@fixmysite.in.',
      },
      { status: 502 },
    )
  }

  const scrubbed = scrubBlueprintBannedWords(generated)

  const { error: updateError } = await supabase
    .from('website_blueprints')
    .update({
      blueprint_json: scrubbed,
      recommendation: scrubbed.recommendation,
      free_text_language: scrubbed.detected_language,
      status: 'generated',
    })
    .eq('id', blueprint_id)

  if (updateError) {
    console.error('[blueprint/generate] persist failed', {
      blueprint_id,
      error: updateError.message,
      code: updateError.code,
    })
    return Response.json(
      { error: 'Generated your blueprint but could not save it. Try again.' },
      { status: 500 },
    )
  }

  return Response.json(
    {
      ok: true,
      blueprint_id,
      cached: false,
      blueprint: scrubbed,
    },
    { status: 200 },
  )
}
