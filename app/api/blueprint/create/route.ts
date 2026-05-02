import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { BUSINESS_TYPES } from '@/lib/blueprint/questions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUSINESS_TYPE_VALUES = new Set<string>(
  BUSINESS_TYPES.map((t) => t.value),
)

const bodySchema = z.object({
  business_type: z
    .string()
    .nullable()
    .refine((v) => v === null || BUSINESS_TYPE_VALUES.has(v), {
      message: 'unknown business_type',
    }),
  // Free-form answer record. Each entry is either a string (radio /
  // text / textarea answer) or an array of strings (checkbox group).
  // Server-side schema validation per question would be ideal but
  // overkill for a draft row — Claude generation in Session 2 is the
  // first place that meaningfully reads from this map, and it tolerates
  // missing fields. v1 keeps it permissive.
  answers: z.record(
    z.string(),
    z.union([z.string(), z.array(z.string())]),
  ),
  free_text: z.string().nullable().optional(),
})

/**
 * POST /api/blueprint/create
 *
 * Persists a draft blueprint from the question wizard. No Claude
 * generation, no payment — Session 1 lands the data foundation only.
 * Session 2 adds /api/blueprint/generate which reads the draft, runs
 * Claude, and writes the recommendation back to blueprint_json.
 *
 * Validation is intentionally permissive: the wizard already enforces
 * required answers per branch client-side, and the draft row is the
 * "save my work" target — rejecting a partially-filled answer set
 * here would lose the owner's progress on a flaky network.
 *
 * Rate limit: 5/hour/IP — generous enough for legitimate retry,
 * tight enough to make spam expensive.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'blueprint-create',
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

  const { business_type, answers, free_text } = parsed.data
  const supabase = createServiceClient()

  const { data: inserted, error: insertError } = await supabase
    .from('website_blueprints')
    .insert({
      business_type,
      answers,
      free_text: free_text && free_text.trim().length > 0 ? free_text : null,
      // status, payment_status, recommendation, blueprint_json, etc.
      // all use schema defaults. detected_language stays null until
      // Session 2's Claude call fills it.
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[blueprint/create] insert failed', {
      business_type,
      error: insertError?.message,
      code: insertError?.code,
    })
    return Response.json(
      { error: 'Could not save your answers. Please try again.' },
      { status: 500 },
    )
  }

  // TODO(posthog, session 1.x): fire 'blueprint_questions_completed'
  // event with { business_type, question_count: Object.keys(answers).length }
  // when posthog-node is wired up.

  return Response.json(
    {
      ok: true,
      blueprint_id: inserted.id,
    },
    { status: 201 },
  )
}
