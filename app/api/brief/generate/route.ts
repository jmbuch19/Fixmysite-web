import { z } from 'zod'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { createBriefForScan } from '@/lib/brief/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Three Claude calls in series (detector + brief + retry on parse fail)
// + DB roundtrips. Comfortable under 60s.
export const maxDuration = 60

const bodySchema = z.object({
  scan_id: z.uuid(),
  owner_text: z.string().trim().min(1).max(5000),
  selected_cards: z.array(z.string()).max(20).default([]),
  // Optional today (slice 2.1 — payment flow not wired yet). Required
  // when slice 2.2 lands the user-facing input form, since the
  // post-payment flow needs somewhere to deliver the PDF.
  owner_email: z.string().trim().email().max(254).optional(),
})

/**
 * POST /api/brief/generate
 *
 * Slice 2.1 endpoint:
 *   - Verifies the underlying scan is paid
 *   - Generates the brief via the service layer (detect → generate →
 *     scrub banned words → persist with payment_status='unpaid')
 *   - Returns the brief_id + full BriefOutput JSON
 *
 * The brief is now PERSISTED to the briefs table on every successful
 * call. Multiple calls for the same scan create multiple briefs — an
 * owner who revises their input and re-generates gets a fresh row,
 * the 5/hr/IP rate limit prevents abuse.
 *
 * TODO(brief-payment, slice 2.2): brief generation itself remains
 * gated only by the underlying scan's payment_status. The brief's
 * own payment gate (Razorpay flow at /api/brief/payment/{create-order,
 * verify}) lands in slice 2.2 alongside the user-facing input form.
 * Until then, the test endpoint is reachable by anyone who has a
 * paid scan_id — acceptable during prompt-tuning, NOT acceptable
 * for public marketing of the brief feature.
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

  const result = await createBriefForScan(parsed.data)

  if (!result.ok) {
    const status =
      result.reason === 'scan_not_found'
        ? 404
        : result.reason === 'scan_not_paid'
          ? 403
          : 500
    return Response.json(
      { error: result.reason, message: result.message },
      { status },
    )
  }

  return Response.json(
    {
      ok: true,
      brief_id: result.brief_id,
      business_type: result.business_type,
      cards_resolved: result.cards_resolved,
      brief: result.brief,
    },
    { status: 200 },
  )
}
