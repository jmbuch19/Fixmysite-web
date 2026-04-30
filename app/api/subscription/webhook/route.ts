import { createServiceClient } from '@/lib/supabase/server'
import { verifyWebhookSignature } from '@/lib/razorpay/client'
import { enqueuePhase2 } from '@/lib/queue/qstash'

export const runtime = 'nodejs'

// Path is /api/subscription/webhook per CLAUDE.md folder spec, but this
// handler receives ALL Razorpay events for the account (payment.captured,
// order.paid, subscription.*, etc.) — Razorpay sends every subscribed event
// to a single webhook URL. The path name is a historical artifact; treat
// this as the universal Razorpay webhook handler.

type RazorpayWebhook = {
  event: string
  payload: {
    payment?: {
      entity: {
        id: string
        order_id: string
        status: string
        amount?: number
        error_code?: string
        error_description?: string
      }
    }
    subscription?: { entity: { id: string; status: string } }
  }
}

export async function POST(req: Request) {
  // Raw body read FIRST. HMAC is over the exact bytes Razorpay sent;
  // JSON.parse + re-stringify would re-order keys and break the signature.
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return new Response('Invalid body', { status: 400 })
  }

  const signature = req.headers.get('x-razorpay-signature')
  if (!signature) {
    console.error('[webhook] missing x-razorpay-signature header')
    return new Response('Unauthorized', { status: 401 })
  }

  let sigOk = false
  try {
    sigOk = verifyWebhookSignature(rawBody, signature)
  } catch (err) {
    console.error('[webhook] verifyWebhookSignature threw', {
      error: err instanceof Error ? err.message : String(err),
    })
    return new Response('Server error', { status: 500 })
  }

  if (!sigOk) {
    console.error('[webhook] signature mismatch', { sig_prefix: signature.slice(0, 8) })
    return new Response('Unauthorized', { status: 401 })
  }

  let event: RazorpayWebhook
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.log('[webhook] received', {
    event: event.event,
    payment_id: event.payload.payment?.entity.id,
    order_id: event.payload.payment?.entity.order_id,
    sub_id: event.payload.subscription?.entity.id,
  })

  // Both events fire for the same payment (Razorpay sends payment.captured
  // and order.paid). Idempotent UPDATE means duplicate processing is harmless.
  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    return handlePaymentSucceeded(event)
  }

  if (event.event === 'payment.failed') {
    console.warn('[webhook] payment failed', {
      payment_id: event.payload.payment?.entity.id,
      order_id: event.payload.payment?.entity.order_id,
      error_code: event.payload.payment?.entity.error_code,
      reason: event.payload.payment?.entity.error_description,
    })
    return Response.json({ received: true, processed: false, event: event.event })
  }

  // TODO(subscription): handle subscription.activated/.charged/.cancelled/
  // .halted when /api/subscription/create ships. For now, acknowledge so
  // Razorpay does not retry.
  if (event.event.startsWith('subscription.')) {
    console.log('[webhook] subscription event (no handler yet)', {
      event: event.event,
      sub_id: event.payload.subscription?.entity.id,
    })
    return Response.json({ received: true, processed: false, event: event.event })
  }

  // Unknown event — acknowledge to prevent Razorpay retry loop.
  return Response.json({ received: true, processed: false, event: event.event })
}

async function handlePaymentSucceeded(event: RazorpayWebhook): Promise<Response> {
  const payment = event.payload.payment?.entity
  if (!payment) {
    console.warn('[webhook] payment event with no payment entity', { event: event.event })
    return Response.json({ received: true, processed: false, reason: 'missing_payment' })
  }

  const supabase = createServiceClient()

  const { data: scan, error: loadError } = await supabase
    .from('scans')
    .select('id, payment_status')
    .eq('razorpay_order_id', payment.order_id)
    .maybeSingle()

  if (loadError) {
    // Transient DB error → 500 so Razorpay retries.
    console.error('[webhook] DB error looking up scan by order_id', {
      order_id: payment.order_id,
      error: loadError.message,
    })
    return new Response('Database error', { status: 500 })
  }

  if (!scan) {
    // Order not in our DB — likely a different env (test vs prod), or
    // a pre-DB scan that was deleted. Acknowledge so Razorpay stops
    // retrying; there is nothing to do.
    console.warn('[webhook] no scan for order_id', {
      event: event.event,
      order_id: payment.order_id,
      payment_id: payment.id,
    })
    return Response.json({ received: true, processed: false, reason: 'unknown_order' })
  }

  if (scan.payment_status === 'paid') {
    // /verify or an earlier webhook already flipped this row.
    return Response.json({ received: true, already_paid: true })
  }

  const { error: updateError } = await supabase
    .from('scans')
    .update({
      payment_status: 'paid',
      payment_id: payment.id,
      status: 'paid',
    })
    .eq('id', scan.id)

  if (updateError) {
    console.error('[webhook] failed to update scan to paid', {
      scan_id: scan.id,
      payment_id: payment.id,
      error: updateError.message,
    })
    return new Response('Database update failed', { status: 500 })
  }

  // ─── Enqueue Phase 2 — webhook safety-net path ──────────────────────
  // Mirrors /api/payment/verify. We only reach this branch when we just
  // flipped payment_status unpaid→paid (the early-return at line 141
  // skips already-paid rows), so a concurrent /verify call has not
  // already enqueued this scan. Failure here is logged but does NOT
  // 500 — Razorpay shouldn't retry the webhook for a queue hiccup; the
  // payment row is durable and admin can re-trigger via
  // POST /api/scan/phase2/trigger.
  const enq = await enqueuePhase2(scan.id)
  if (!enq.ok) {
    console.error('[webhook] phase2 enqueue failed — scan stuck at paid until admin retriggers', {
      scan_id: scan.id,
      payment_id: payment.id,
      reason: enq.reason,
      error: enq.error,
    })
  }

  // TODO(posthog): fire 'payment_captured_via_webhook' server-side event.

  return Response.json({
    received: true,
    processed: true,
    event: event.event,
    queued: enq.ok,
  })
}
