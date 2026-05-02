import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { getRazorpay } from '@/lib/razorpay/client'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { getBriefById } from '@/lib/brief/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  brief_id: z.uuid(),
})

/**
 * POST /api/brief/payment/create-order
 *
 * Creates a Razorpay order for a brief and binds the order_id to the
 * brief row. Mirrors /api/payment/create-order for scans, including the
 * idempotent re-click pattern (a second click on a still-unpaid brief
 * with an existing order returns the same order, friendly for double-
 * tapped pay buttons on flaky mobile).
 *
 * The order_id binding is the security boundary — verify-route later
 * checks that the Razorpay-signed order_id matches what we stored
 * here, defending against an attacker paying for a cheap brief and
 * claiming the payment unlocks an expensive one (pure HMAC signature
 * check would still pass for the cheap order).
 *
 * Rate limit: 20/hour/IP. Generous since legitimate retry on payment
 * UX flakiness is normal; the underlying Razorpay charge can't be
 * abused without going through the full payment flow.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'brief-payment-create-order',
    limit: 20,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let brief_id: string
  try {
    brief_id = bodySchema.parse(await req.json()).brief_id
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const brief = await getBriefById(brief_id)
  if (!brief) {
    return Response.json({ error: 'Brief not found' }, { status: 404 })
  }

  if (brief.payment_status === 'paid') {
    return Response.json(
      { error: 'Brief already paid', scan_id: brief.scan_id },
      { status: 409 },
    )
  }

  // The post-payment flow needs an email to deliver the PDF to. The
  // user-facing input form requires it; the test endpoint allows
  // omitting it. Briefs without an owner_email therefore can't enter
  // the payment flow — return 400 so the caller knows what's missing.
  if (!brief.owner_email) {
    return Response.json(
      {
        error: 'owner_email required',
        message:
          'This brief has no owner email on file. Generate the brief through the input form (which captures the email) before attempting payment.',
      },
      { status: 400 },
    )
  }

  const amountPaise = brief.price_paise

  // Idempotent re-click: existing order, still unpaid → return the same
  // order. Avoids creating duplicate Razorpay orders on double-tap.
  if (brief.razorpay_order_id) {
    return Response.json({
      order_id: brief.razorpay_order_id,
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
      receipt: brief.id,
      notes: {
        brief_id: brief.id,
        scan_id: brief.scan_id ?? '',
        kind: 'developer_brief',
      },
    })
  } catch (err) {
    // Razorpay SDK throws plain objects, not Error instances — mirror
    // the structured-log pattern from /api/payment/create-order so dev
    // logs surface the actual failure reason.
    const e = err as {
      statusCode?: number
      error?: { code?: string; description?: string; reason?: string; field?: string }
      message?: string
    }
    console.error('[brief/create-order] Razorpay order creation failed', {
      brief_id: brief.id,
      statusCode: e?.statusCode,
      code: e?.error?.code,
      description: e?.error?.description,
      reason: e?.error?.reason,
      field: e?.error?.field,
      message: e?.message,
    })
    return Response.json({ error: 'Payment provider error' }, { status: 502 })
  }

  // Persist the order_id binding BEFORE returning to the client. If
  // this update fails after the Razorpay order is created, the order
  // is orphaned (no DB record) — the next idempotent re-click will
  // create a fresh order rather than reuse it. Acceptable: orphaned
  // orders auto-expire on Razorpay's side.
  const supabase = createServiceClient()
  const { error: updateError } = await supabase
    .from('briefs')
    .update({ razorpay_order_id: order.id })
    .eq('id', brief.id)

  if (updateError) {
    console.error('[brief/create-order] failed to persist order_id', {
      brief_id: brief.id,
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
