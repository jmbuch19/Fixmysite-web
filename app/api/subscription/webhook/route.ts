import { createServiceClient } from '@/lib/supabase/server'
import { verifyWebhookSignature } from '@/lib/razorpay/client'
import { enqueuePhase2 } from '@/lib/queue/qstash'
import { sendBlueprintReadyEmailBestEffort } from '@/lib/blueprint/sendReadyEmail'

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
    // Order not in scans — could belong to a blueprint. Try the
    // website_blueprints table next. Same safety-net pattern: if
    // /api/blueprint/payment/verify never reached us (cold start, tab
    // closed mid-flight), the webhook is the second chance to flip the
    // row + fire the auto-email. Without this, paying customers can
    // sit in 'unpaid' state forever.
    const blueprintResult = await tryHandleBlueprintPayment(payment)
    if (blueprintResult) return blueprintResult

    // Order not in either products' DB — likely a different env
    // (test vs prod), or a deleted pre-DB row. Acknowledge so Razorpay
    // stops retrying; there is nothing to do.
    console.warn('[webhook] no scan or blueprint for order_id', {
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

/**
 * Blueprint safety-net path. Mirrors handlePaymentSucceeded for scans
 * but writes to website_blueprints + fires the blueprint auto-email
 * helper instead of enqueuing Phase 2 (blueprints have no background
 * job — just an email).
 *
 * Returns null when no blueprint matches the order_id, letting the
 * caller fall through to its "unknown_order" response. Returns a Response
 * when the blueprint was found and processed (paid or already_paid).
 */
async function tryHandleBlueprintPayment(payment: {
  id: string
  order_id: string
}): Promise<Response | null> {
  const supabase = createServiceClient()
  const { data: row, error: loadError } = await supabase
    .from('website_blueprints')
    .select('id, payment_status')
    .eq('razorpay_order_id', payment.order_id)
    .maybeSingle()

  if (loadError) {
    console.error('[webhook] DB error looking up blueprint by order_id', {
      order_id: payment.order_id,
      error: loadError.message,
    })
    return new Response('Database error', { status: 500 })
  }

  if (!row) return null

  if (row.payment_status === 'paid') {
    // /verify or an earlier webhook already flipped this row.
    return Response.json({
      received: true,
      already_paid: true,
      kind: 'blueprint',
    })
  }

  const { error: updateError } = await supabase
    .from('website_blueprints')
    .update({
      payment_status: 'paid',
      payment_id: payment.id,
      status: 'paid',
    })
    .eq('id', row.id)

  if (updateError) {
    console.error('[webhook] failed to update blueprint to paid', {
      blueprint_id: row.id,
      payment_id: payment.id,
      error: updateError.message,
    })
    return new Response('Database update failed', { status: 500 })
  }

  // Fire the auto-email — same helper /verify uses, so the email lands
  // exactly once per payment regardless of which writer flipped the row.
  await sendBlueprintReadyEmailBestEffort({
    blueprintId: row.id,
    callerTag: 'webhook/blueprint-email',
  })

  return Response.json({
    received: true,
    processed: true,
    kind: 'blueprint',
    blueprint_id: row.id,
  })
}
