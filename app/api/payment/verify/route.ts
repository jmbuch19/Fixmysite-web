import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyCheckoutSignature } from '@/lib/razorpay/client'
import { getClientIp, rateLimit, rateLimitResponse } from '@/lib/security/rateLimit'
import { enqueuePhase2 } from '@/lib/queue/qstash'

export const runtime = 'nodejs'

// Razorpay Checkout returns these field names (snake_case, not camelCase).
const bodySchema = z.object({
  scan_id: z.uuid(),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
})

export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'payment-verify',
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
    console.error('[verify] signature mismatch', {
      ip,
      scan_id: body.scan_id,
      order_id: body.razorpay_order_id,
      payment_id: body.razorpay_payment_id,
    })
    return Response.json({ error: 'Payment verification failed' }, { status: 403 })
  }

  const supabase = createServiceClient()

  const { data: scan, error: loadError } = await supabase
    .from('scans')
    .select('id, razorpay_order_id, payment_status')
    .eq('id', body.scan_id)
    .single()

  if (loadError || !scan) {
    console.error('[verify] scan not found despite valid signature', {
      ip,
      scan_id: body.scan_id,
      order_id: body.razorpay_order_id,
    })
    return Response.json({ error: 'Payment verification failed' }, { status: 403 })
  }

  // The scan's order_id must match the one Razorpay just signed for.
  // Defends against an attacker paying for scan A and claiming the payment
  // unlocks scan B. NULL razorpay_order_id (no /create-order ever called for
  // this scan) also fails this check, which is the desired behavior.
  if (scan.razorpay_order_id !== body.razorpay_order_id) {
    console.error('[verify] order_id mismatch — possible cross-scan attack', {
      ip,
      scan_id: body.scan_id,
      expected_order_id: scan.razorpay_order_id,
      submitted_order_id: body.razorpay_order_id,
      payment_id: body.razorpay_payment_id,
    })
    return Response.json({ error: 'Payment verification failed' }, { status: 403 })
  }

  // Idempotent: webhook may have arrived first and already flipped the row.
  // Client retries (e.g. after navigation) should still receive ok.
  if (scan.payment_status === 'paid') {
    return Response.json({ ok: true, already_paid: true })
  }

  const { error: updateError } = await supabase
    .from('scans')
    .update({
      payment_status: 'paid',
      payment_id: body.razorpay_payment_id,
      status: 'paid',
    })
    .eq('id', body.scan_id)

  if (updateError) {
    console.error('[verify] failed to update scan after valid payment', {
      scan_id: body.scan_id,
      payment_id: body.razorpay_payment_id,
      error: updateError.message,
    })
    return Response.json({ error: 'Database update failed' }, { status: 500 })
  }

  // ─── Enqueue Phase 2 to QStash ───────────────────────────────────────
  // The DB update above is the durable record of payment. Now hand the
  // work off so the user doesn't have to keep the browser open. Failure
  // here is logged loudly but does NOT fail the response — payment IS
  // verified, and ops/admin can manually re-trigger via
  // POST /api/scan/phase2/trigger if the publish hiccupped.
  //
  // Idempotency: re-publishing for the same scan is safe — `runPhase2`
  // acquires an atomic paid→scanning lock and the second worker delivery
  // bails with `in_progress` (or `complete`), which the worker route
  // 200's so QStash drops the dup.
  const enq = await enqueuePhase2(body.scan_id)
  if (!enq.ok) {
    console.error('[verify] phase2 enqueue failed — scan stuck at paid until admin retriggers', {
      scan_id: body.scan_id,
      payment_id: body.razorpay_payment_id,
      reason: enq.reason,
      error: enq.error,
    })
  }

  // TODO(posthog): fire 'payment_verified' server-side event when
  // posthog-node is wired up. Properties: { scan_id, payment_id, amount }.

  return Response.json({
    ok: true,
    queued: enq.ok,
    ...(enq.ok ? { message_id: enq.message_id } : {}),
  })
}
