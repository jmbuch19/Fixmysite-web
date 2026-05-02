import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { getRazorpay } from '@/lib/razorpay/client'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { BLUEPRINT_PRICING, toPaise } from '@/constants/pricing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  blueprint_id: z.uuid(),
})

/**
 * POST /api/blueprint/payment/create-order
 *
 * Creates a Razorpay order for a blueprint and binds the order_id to
 * the blueprint row. Mirrors the brief + scan create-order routes —
 * same idempotent re-click, same order_id binding as the security
 * boundary for the verify route.
 *
 * Pre-conditions:
 *   - Blueprint must exist
 *   - Blueprint must be 'generated' (Claude has run) — paying for an
 *     ungenerated blueprint would buy nothing
 *   - Blueprint must not already be 'paid'
 *
 * Rate limit: 20/hour/IP — generous enough for legitimate flaky-mobile
 * retries while keeping spam expensive. Same as brief.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'blueprint-payment-create-order',
    limit: 20,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let blueprint_id: string
  try {
    blueprint_id = bodySchema.parse(await req.json()).blueprint_id
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: row, error: loadError } = await supabase
    .from('website_blueprints')
    .select(
      'id, status, payment_status, razorpay_order_id, owner_email, owner_name',
    )
    .eq('id', blueprint_id)
    .maybeSingle()

  if (loadError) {
    console.error('[blueprint/create-order] load failed', {
      blueprint_id,
      error: loadError.message,
    })
    return Response.json(
      { error: 'Could not start payment' },
      { status: 500 },
    )
  }

  if (!row) {
    return Response.json({ error: 'Blueprint not found' }, { status: 404 })
  }

  if (row.payment_status === 'paid') {
    // 409 lets the client know to redirect straight to /full instead
    // of opening another Razorpay modal. Same pattern as brief.
    return Response.json(
      { error: 'Blueprint already paid', blueprint_id: row.id },
      { status: 409 },
    )
  }

  if (row.status === 'draft') {
    // No blueprint_json yet — Claude hasn't run. Selling an empty
    // blueprint would defraud the owner. Return 409 so the preview
    // client can prompt a regenerate.
    return Response.json(
      {
        error: 'Blueprint not generated',
        message:
          'Bugbite has not finished writing your blueprint yet. Wait a few seconds and refresh the preview.',
      },
      { status: 409 },
    )
  }

  const amountPaise = toPaise(BLUEPRINT_PRICING.full.price)

  // Idempotent re-click. A second tap on the unlock button while the
  // first order is still unpaid returns the same order — Razorpay
  // dedups its modal on order_id so the owner never sees a flicker.
  if (row.razorpay_order_id) {
    return Response.json({
      order_id: row.razorpay_order_id,
      amount: amountPaise,
      currency: 'INR',
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    })
  }

  let order
  try {
    order = await getRazorpay().orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: row.id,
      notes: {
        blueprint_id: row.id,
        kind: 'website_blueprint',
      },
    })
  } catch (err) {
    const e = err as {
      statusCode?: number
      error?: {
        code?: string
        description?: string
        reason?: string
        field?: string
      }
      message?: string
    }
    console.error('[blueprint/create-order] Razorpay order creation failed', {
      blueprint_id: row.id,
      statusCode: e?.statusCode,
      code: e?.error?.code,
      description: e?.error?.description,
      reason: e?.error?.reason,
      field: e?.error?.field,
      message: e?.message,
    })
    return Response.json({ error: 'Payment provider error' }, { status: 502 })
  }

  // Persist the order_id binding before returning. If this UPDATE
  // fails after Razorpay accepted the order, the order is orphaned —
  // the next idempotent re-click will create a fresh one. Razorpay
  // auto-expires orphaned orders, so no cleanup needed.
  const { error: updateError } = await supabase
    .from('website_blueprints')
    .update({ razorpay_order_id: order.id })
    .eq('id', row.id)

  if (updateError) {
    console.error('[blueprint/create-order] failed to persist order_id', {
      blueprint_id: row.id,
      order_id: order.id,
      error: updateError.message,
    })
    return Response.json(
      { error: 'Failed to persist order' },
      { status: 500 },
    )
  }

  return Response.json({
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  })
}
