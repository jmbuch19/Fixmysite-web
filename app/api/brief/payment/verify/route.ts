import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyCheckoutSignature } from '@/lib/razorpay/client'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { getBriefById } from '@/lib/brief/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Razorpay's success callback returns these field names (snake_case).
const bodySchema = z.object({
  brief_id: z.uuid(),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
})

/**
 * POST /api/brief/payment/verify
 *
 * Confirms a Razorpay payment for a brief and flips its payment_status
 * to 'paid'. Mirrors the security model of /api/payment/verify (scans):
 *
 *   1. Verify HMAC signature on (order_id, payment_id) — proves the
 *      payment was actually authorised through Razorpay
 *   2. Confirm the brief's stored razorpay_order_id matches the
 *      submitted one — defends against an attacker paying for cheap
 *      brief A and claiming the payment unlocks expensive brief B
 *   3. Idempotent — if the brief is already paid, return 200 ok
 *      (the client may retry on flaky network)
 *
 * TODO(brief-email, slice 2.3): on first successful verify, fire
 * sendBriefReadyToOwner email so the owner gets the PDF in their
 * inbox immediately, even if they close the browser before reaching
 * /full. Pattern mirrors what scan verify will eventually do for
 * the report email.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'brief-payment-verify',
    limit: 20,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Signature check first — cheap CPU, fails fast for forgeries.
  const sigOk = verifyCheckoutSignature({
    orderId: body.razorpay_order_id,
    paymentId: body.razorpay_payment_id,
    signature: body.razorpay_signature,
  })
  if (!sigOk) {
    console.error('[brief/verify] signature mismatch', {
      ip,
      brief_id: body.brief_id,
      order_id: body.razorpay_order_id,
      payment_id: body.razorpay_payment_id,
    })
    return Response.json({ error: 'Payment verification failed' }, { status: 403 })
  }

  const brief = await getBriefById(body.brief_id)
  if (!brief) {
    console.error('[brief/verify] brief not found despite valid signature', {
      ip,
      brief_id: body.brief_id,
      order_id: body.razorpay_order_id,
    })
    return Response.json({ error: 'Payment verification failed' }, { status: 403 })
  }

  // The brief's stored order_id must match what Razorpay just signed.
  // Defends against a cross-brief attack: an attacker pays for brief
  // A's order, then submits the (valid) signature claiming it unlocks
  // brief B. NULL razorpay_order_id (no /create-order ever called for
  // this brief) also fails this check, which is the desired behaviour.
  if (brief.razorpay_order_id !== body.razorpay_order_id) {
    console.error('[brief/verify] order_id mismatch — possible cross-brief attack', {
      ip,
      brief_id: brief.id,
      expected_order_id: brief.razorpay_order_id,
      submitted_order_id: body.razorpay_order_id,
      payment_id: body.razorpay_payment_id,
    })
    return Response.json({ error: 'Payment verification failed' }, { status: 403 })
  }

  // Idempotent: webhook may have arrived first and flipped the row,
  // or the client may retry the verify on a flaky network. Both should
  // see the same result.
  if (brief.payment_status === 'paid') {
    return Response.json({
      ok: true,
      already_paid: true,
      scan_id: brief.scan_id,
    })
  }

  const supabase = createServiceClient()
  const { error: updateError } = await supabase
    .from('briefs')
    .update({
      payment_status: 'paid',
      payment_id: body.razorpay_payment_id,
    })
    .eq('id', brief.id)

  if (updateError) {
    console.error('[brief/verify] failed to update brief after valid payment', {
      brief_id: brief.id,
      payment_id: body.razorpay_payment_id,
      error: updateError.message,
    })
    return Response.json({ error: 'Database update failed' }, { status: 500 })
  }

  // TODO(brief-email): trigger sendBriefReadyToOwner here once the
  // email template ships in slice 2.3. Pattern: catch-and-log so an
  // email failure never blocks the verify response — payment is the
  // durable fact, the email is best-effort delivery.

  return Response.json({ ok: true, scan_id: brief.scan_id })
}
