import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import {
  BUSINESS_TYPES,
  normalizeIndianMobile,
} from '@/lib/blueprint/questions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUSINESS_TYPE_VALUES = new Set<string>(
  BUSINESS_TYPES.map((t) => t.value),
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  // Identity + reachability — pulled out of `answers` so they land in
  // typed columns. All kept .nullable() so an early-exit draft still
  // persists; Session 2's delivery flow refuses to send when the
  // required ones (email) are missing.
  owner_email: z
    .string()
    .nullable()
    .optional()
    .refine((v) => v == null || EMAIL_RE.test(v), {
      message: 'invalid owner_email',
    }),
  owner_name: z.string().nullable().optional(),
  business_name: z.string().nullable().optional(),
  // Client already normalises to E.164 (+91XXXXXXXXXX). Re-validate
  // server-side so a hand-crafted POST can't slip raw digits past us.
  whatsapp_number: z
    .string()
    .nullable()
    .optional()
    .refine((v) => v == null || normalizeIndianMobile(v) !== null, {
      message: 'invalid whatsapp_number',
    }),
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

  const {
    business_type,
    answers,
    free_text,
    owner_email,
    owner_name,
    business_name,
    whatsapp_number,
  } = parsed.data
  const supabase = createServiceClient()

  // Re-normalise WhatsApp server-side. Zod's refine guaranteed the
  // value is normalisable; this call gives us the canonical form.
  const whatsappE164 =
    whatsapp_number && whatsapp_number.trim().length > 0
      ? normalizeIndianMobile(whatsapp_number)
      : null

  const { data: inserted, error: insertError } = await supabase
    .from('website_blueprints')
    .insert({
      business_type,
      answers,
      free_text: free_text && free_text.trim().length > 0 ? free_text : null,
      owner_email:
        owner_email && owner_email.trim().length > 0
          ? owner_email.trim().toLowerCase()
          : null,
      owner_name:
        owner_name && owner_name.trim().length > 0 ? owner_name.trim() : null,
      business_name:
        business_name && business_name.trim().length > 0
          ? business_name.trim()
          : null,
      whatsapp_number: whatsappE164,
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
