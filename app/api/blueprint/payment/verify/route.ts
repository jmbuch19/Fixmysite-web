import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyCheckoutSignature } from '@/lib/razorpay/client'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { sendBlueprintReadyEmailBestEffort } from '@/lib/blueprint/sendReadyEmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Verify + DB UPDATE are fast (~200ms). The auto-email path adds PDF
// render (~1-2s) + Resend send (~300ms). Comfortably under 60s.
export const maxDuration = 60

const bodySchema = z.object({
  blueprint_id: z.uuid(),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
})

/**
 * POST /api/blueprint/payment/verify
 *
 * Confirms a Razorpay payment for a blueprint and flips its
 * payment_status to 'paid'. Same security model as the brief + scan
 * verify routes:
 *
 *   1. HMAC signature on (order_id, payment_id) — proves authorisation
 *      came through Razorpay
 *   2. Stored razorpay_order_id must match the submitted one — defends
 *      against cross-blueprint attacks (paying for cheap blueprint A,
 *      claiming the signature unlocks expensive blueprint B). Both
 *      blueprints are ₹99 right now so the attack window is zero, but
 *      we keep the binding for when bundles ship.
 *   3. Idempotent — webhook may have flipped the row already, or the
 *      client may retry on flaky network. Either way, return ok.
 *
 * After flipping payment_status='paid', fires the best-effort owner
 * delivery email (PDF render + Resend) so the blueprint lands in the
 * owner's inbox even if they close the tab before reaching /full.
 * Email failures log loudly but never fail the verify response —
 * payment is the durable fact; the owner can always re-download from
 * the action bar.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'blueprint-payment-verify',
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

  // Signature first — cheap CPU, fails fast for forgeries. Same response
  // shape across all branches so an attacker can't distinguish "wrong
  // signature" from "wrong blueprint id" from "order_id mismatch".
  const sigOk = verifyCheckoutSignature({
    orderId: body.razorpay_order_id,
    paymentId: body.razorpay_payment_id,
    signature: body.razorpay_signature,
  })
  if (!sigOk) {
    console.error('[blueprint/verify] signature mismatch', {
      ip,
      blueprint_id: body.blueprint_id,
      order_id: body.razorpay_order_id,
      payment_id: body.razorpay_payment_id,
    })
    return Response.json(
      { error: 'Payment verification failed' },
      { status: 403 },
    )
  }

  const supabase = createServiceClient()
  const { data: row, error: loadError } = await supabase
    .from('website_blueprints')
    .select('id, payment_status, razorpay_order_id')
    .eq('id', body.blueprint_id)
    .maybeSingle()

  if (loadError) {
    console.error('[blueprint/verify] db load failed', {
      blueprint_id: body.blueprint_id,
      error: loadError.message,
    })
    return Response.json({ error: 'Database error' }, { status: 500 })
  }

  if (!row) {
    console.error('[blueprint/verify] blueprint not found despite valid signature', {
      ip,
      blueprint_id: body.blueprint_id,
      order_id: body.razorpay_order_id,
    })
    return Response.json(
      { error: 'Payment verification failed' },
      { status: 403 },
    )
  }

  if (row.razorpay_order_id !== body.razorpay_order_id) {
    console.error(
      '[blueprint/verify] order_id mismatch — possible cross-blueprint attack',
      {
        ip,
        blueprint_id: row.id,
        expected_order_id: row.razorpay_order_id,
        submitted_order_id: body.razorpay_order_id,
        payment_id: body.razorpay_payment_id,
      },
    )
    return Response.json(
      { error: 'Payment verification failed' },
      { status: 403 },
    )
  }

  if (row.payment_status === 'paid') {
    return Response.json({
      ok: true,
      already_paid: true,
      blueprint_id: row.id,
    })
  }

  const { error: updateError } = await supabase
    .from('website_blueprints')
    .update({
      payment_status: 'paid',
      payment_id: body.razorpay_payment_id,
      status: 'paid',
    })
    .eq('id', row.id)

  if (updateError) {
    console.error(
      '[blueprint/verify] failed to update blueprint after valid payment',
      {
        blueprint_id: row.id,
        payment_id: body.razorpay_payment_id,
        error: updateError.message,
      },
    )
    return Response.json({ error: 'Database update failed' }, { status: 500 })
  }

  // ─── Auto-email the owner (fire-and-log, never fails the response) ──
  // Payment is the durable fact. Email is best-effort delivery: if PDF
  // render fails, font CDN times out, or Resend rejects, we log loudly
  // but still return ok=true. The owner can always download manually
  // from the action bar on /full — Bugbite never pretends an email
  // succeeded that didn't.
  //
  // The same helper fires from the Razorpay webhook safety-net path
  // when /verify never reaches us (cold start, tab closed mid-flight).
  // Both writers gate on payment_status, so the email lands at most
  // once per payment regardless of which path flipped the row.
  await sendBlueprintReadyEmailBestEffort({
    blueprintId: row.id,
    callerTag: 'blueprint/verify-email',
  })

  return Response.json({ ok: true, blueprint_id: row.id })
}
