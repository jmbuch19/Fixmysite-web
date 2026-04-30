import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { getRazorpay } from '@/lib/razorpay/client'
import { getTier, toPaise } from '@/constants/pricing'
import { getClientIp, rateLimit, rateLimitResponse } from '@/lib/security/rateLimit'

export const runtime = 'nodejs'

const bodySchema = z.object({
  scan_id: z.uuid(),
})

export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'payment-create-order',
    limit: 20,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let scan_id: string
  try {
    const json = await req.json()
    scan_id = bodySchema.parse(json).scan_id
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: scan, error: loadError } = await supabase
    .from('scans')
    .select('id, page_count, status, payment_status, razorpay_order_id, url_normalized')
    .eq('id', scan_id)
    .single()

  if (loadError || !scan) {
    return Response.json({ error: 'Scan not found' }, { status: 404 })
  }

  if (scan.payment_status === 'paid') {
    return Response.json({ error: 'Scan already paid' }, { status: 409 })
  }

  if (scan.status !== 'phase1_complete') {
    return Response.json(
      { error: 'Scan not ready for payment', status: scan.status },
      { status: 400 },
    )
  }

  if (typeof scan.page_count !== 'number') {
    return Response.json({ error: 'Scan page count missing' }, { status: 400 })
  }

  const tier = getTier(scan.page_count)
  if (!tier) {
    return Response.json(
      {
        error: 'Site too large for automated checkout',
        action: 'contact_us',
        contact_url: '/agency',
      },
      { status: 400 },
    )
  }

  const amountPaise = toPaise(tier.price)

  // Idempotent re-click: same scan, still unpaid, already has an order → return
  // the same order. Friendly for double-tapped pay buttons on flaky mobile.
  if (scan.razorpay_order_id) {
    return Response.json({
      order_id: scan.razorpay_order_id,
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
      receipt: scan.id,
      notes: {
        scan_id: scan.id,
        url_normalized: scan.url_normalized,
        tier: tier.name,
      },
    })
  } catch (err) {
    // Razorpay SDK throws plain objects ({ statusCode, error: { code, description, ... } }),
    // not Error instances — String(err) collapses to '[object Object]'. Pull the
    // useful fields out so the dev log actually tells us what went wrong.
    const e = err as {
      statusCode?: number
      error?: { code?: string; description?: string; reason?: string; field?: string }
      message?: string
    }
    console.error('[create-order] Razorpay order creation failed', {
      scan_id: scan.id,
      statusCode: e?.statusCode,
      code: e?.error?.code,
      description: e?.error?.description,
      reason: e?.error?.reason,
      field: e?.error?.field,
      message: e?.message,
      raw: JSON.stringify(err),
    })
    return Response.json({ error: 'Payment provider error' }, { status: 502 })
  }

  const { error: updateError } = await supabase
    .from('scans')
    .update({
      razorpay_order_id: order.id,
      tier: tier.name,
    })
    .eq('id', scan.id)

  if (updateError) {
    console.error('[create-order] failed to persist order_id', {
      scan_id: scan.id,
      order_id: order.id,
      error: updateError.message,
    })
    return Response.json({ error: 'Failed to persist order' }, { status: 500 })
  }

  return Response.json({
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  })
}
