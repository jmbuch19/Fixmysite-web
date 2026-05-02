import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyCheckoutSignature } from '@/lib/razorpay/client'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { getBriefById } from '@/lib/brief/store'
import {
  buildBriefPdfFilename,
  generateBriefPdf,
} from '@/lib/pdf/briefGenerator'
import { sendBriefReadyToOwner } from '@/lib/email/sender'
import { resolveAppUrl } from '@/lib/queue/qstash'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Verify + DB UPDATE are fast (~200ms). The auto-email path adds PDF
// render (~1-2s) + Resend send (~300ms). Comfortably under 60s.
export const maxDuration = 60

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

  // ─── Auto-email the owner (fire-and-log, never fails the response) ──
  // Payment is the durable fact. Email is best-effort delivery: if PDF
  // render fails, font CDN times out, or Resend rejects, we log loudly
  // but still return ok=true. The owner can download the PDF manually
  // from /full and use the "Send to my developer" button — Bugbite
  // doesn't pretend the email succeeded.
  await sendBriefReadyEmailBestEffort({ briefId: brief.id })

  return Response.json({ ok: true, scan_id: brief.scan_id })
}

/**
 * Render the PDF + email it to the owner. All failure paths log
 * structured warnings + return — never throw. Caller awaits this so
 * the verify response only completes after the email attempt finishes
 * (otherwise Vercel could kill the function before the send fires).
 */
async function sendBriefReadyEmailBestEffort(args: {
  briefId: string
}): Promise<void> {
  const brief = await getBriefById(args.briefId)
  if (!brief) {
    console.error('[brief/verify-email] brief vanished after update', {
      brief_id: args.briefId,
    })
    return
  }
  if (!brief.brief_json) {
    console.error('[brief/verify-email] paid brief has null brief_json', {
      brief_id: args.briefId,
    })
    return
  }
  if (!brief.owner_email) {
    console.warn(
      '[brief/verify-email] no owner_email on file — skipping auto-send',
      { brief_id: args.briefId },
    )
    return
  }

  // Need scan URL for PDF sub-header + filename hostname.
  let scanUrl = ''
  let hostname = 'site'
  if (brief.scan_id) {
    const supabase = createServiceClient()
    const { data: scan } = await supabase
      .from('scans')
      .select('url')
      .eq('id', brief.scan_id)
      .maybeSingle()
    if (scan?.url) {
      scanUrl = scan.url as string
      try {
        hostname = new URL(scanUrl).hostname.replace(/^www\./, '')
      } catch {
        // keep default
      }
    }
  }

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await generateBriefPdf({
      brief: brief.brief_json,
      meta: {
        hostname,
        scanUrl,
        briefId: brief.id,
        paidAt: new Date().toISOString(),
        hasScreenshots: false,
      },
    })
  } catch (err) {
    console.error('[brief/verify-email] PDF render failed', {
      brief_id: brief.id,
      error: err instanceof Error ? err.message : err,
    })
    return
  }

  const filename = buildBriefPdfFilename(hostname, brief.created_at)
  // appUrl is needed for the "view online" link in the email body.
  // Falls back to the production domain so an unconfigured local dev
  // env still produces a valid link.
  const appUrl = resolveAppUrl() ?? 'https://fixmysite.in'

  const sendResult = await sendBriefReadyToOwner({
    to: brief.owner_email,
    hostname,
    briefId: brief.id,
    scanId: brief.scan_id ?? '',
    appUrl,
    workItemCount: brief.brief_json.sections.length,
    pdfBuffer,
    pdfFilename: filename,
  })

  if (!sendResult.ok) {
    console.error('[brief/verify-email] Resend send failed', {
      brief_id: brief.id,
      owner_email: brief.owner_email,
      reason: sendResult.reason,
      error: sendResult.error,
    })
    return
  }

  // Mark sent_at so admin panel + future logic can see this brief
  // already had its owner email delivered. Best-effort — if the
  // UPDATE fails the email still went, we just lose the audit trail.
  const supabase = createServiceClient()
  const { error: updateError } = await supabase
    .from('briefs')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', brief.id)
  if (updateError) {
    console.error(
      '[brief/verify-email] sent_at update failed (email sent OK)',
      { brief_id: brief.id, error: updateError.message },
    )
  }
}
