import { z } from 'zod'
import {
  isLockedOut,
  isOtpExpired,
  OTP_CONSTANTS,
  verifyOtpHash,
} from '@/lib/enterprise/otp'
import {
  sendInquiryReceivedToAdmin,
  sendInquiryReceivedToClaimant,
} from '@/lib/email/sender'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  inquiry_id: z.uuid(),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
})

/**
 * Step 7 — verify the 6-digit OTP for an enterprise / institution inquiry.
 *
 * Lockout policy (per SPEC §4 + CLAUDE.md rule 39):
 *   - 15-minute TTL from otp_sent_at
 *   - Max 3 attempts before the inquiry is locked
 *   - Locked state is encoded via otp_attempts >= 3, not a status column
 *     (the spec's status enum doesn't have 'locked' — easier to recover by
 *     creating a new inquiry than to reset an attempt counter.)
 *
 * Successful verification flips status to 'otp_verified'. From there the
 * admin reviews the inquiry and either approves (sets quoted_price + status)
 * or rejects.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'enterprise-verify-otp',
    limit: 10,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch {
    return Response.json({ error: 'Invalid code format' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: inquiry, error: loadError } = await supabase
    .from('enterprise_inquiries')
    .select(
      'id, otp_code, otp_sent_at, otp_attempts, otp_verified, status, url, url_class, url_domain, claimed_email, created_at',
    )
    .eq('id', body.inquiry_id)
    .maybeSingle()

  if (loadError || !inquiry) {
    return Response.json({ error: 'Verification not found' }, { status: 404 })
  }

  if (inquiry.otp_verified) {
    return Response.json({
      ok: true,
      already_verified: true,
      inquiry_id: inquiry.id,
      url_class: inquiry.url_class,
      hostname: inquiry.url_domain,
    })
  }

  if (!inquiry.otp_code || !inquiry.otp_sent_at) {
    return Response.json(
      { error: 'No code on file. Please start again.', reason: 'no_code' },
      { status: 400 },
    )
  }

  if (isLockedOut(inquiry.otp_attempts ?? 0)) {
    return Response.json(
      {
        error: 'This verification has been locked after too many attempts. Please start again.',
        reason: 'locked',
      },
      { status: 429 },
    )
  }

  if (isOtpExpired(inquiry.otp_sent_at)) {
    return Response.json(
      {
        error: 'Code has expired. Please start again.',
        reason: 'expired',
      },
      { status: 400 },
    )
  }

  const isValid = await verifyOtpHash(body.otp, inquiry.otp_code)

  if (!isValid) {
    const newAttempts = (inquiry.otp_attempts ?? 0) + 1
    await supabase
      .from('enterprise_inquiries')
      .update({ otp_attempts: newAttempts })
      .eq('id', body.inquiry_id)

    if (newAttempts >= OTP_CONSTANTS.MAX_ATTEMPTS) {
      return Response.json(
        {
          error: 'This verification has been locked after too many attempts. Please start again.',
          reason: 'locked',
        },
        { status: 429 },
      )
    }

    return Response.json(
      {
        error: 'Wrong code. Try again.',
        reason: 'wrong_code',
        attempts_remaining: OTP_CONSTANTS.MAX_ATTEMPTS - newAttempts,
      },
      { status: 400 },
    )
  }

  // ─── Verified ──────────────────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('enterprise_inquiries')
    .update({
      otp_verified: true,
      otp_verified_at: new Date().toISOString(),
      status: 'otp_verified',
    })
    .eq('id', body.inquiry_id)

  if (updateError) {
    console.error('[verify-otp] failed to mark verified', {
      inquiry_id: body.inquiry_id,
      error: updateError.message,
    })
    return Response.json({ error: 'Database update failed' }, { status: 500 })
  }

  // Fire-and-continue email notifications. We deliberately do NOT block
  // the response on email-send results — verification succeeded and the
  // user already sees the success card on their end. Email failures are
  // logged inside `send()`; the user's status is unaffected.
  //
  // Self-serve (Complex-tier) inquiries are domain-ownership proofs, not
  // enterprise contacts awaiting human follow-up — skip both emails.
  if (inquiry.url_class !== 'self_serve') {
    const origin = resolveOrigin(req)
    const adminPanelUrl = `${origin}/admin/inquiries/${inquiry.id}`

    await Promise.allSettled([
      sendInquiryReceivedToAdmin({
        inquiry_id: inquiry.id as string,
        url: inquiry.url as string,
        url_class: inquiry.url_class as string,
        hostname: inquiry.url_domain as string,
        claimed_email: inquiry.claimed_email as string,
        submitted_at: inquiry.created_at as string,
        admin_panel_url: adminPanelUrl,
      }),
      sendInquiryReceivedToClaimant({
        to: inquiry.claimed_email as string,
        hostname: inquiry.url_domain as string,
      }),
    ])
  }

  return Response.json({
    ok: true,
    inquiry_id: inquiry.id,
    url_class: inquiry.url_class,
    hostname: inquiry.url_domain,
  })
}

function resolveOrigin(req: Request): string {
  const host = req.headers.get('host') ?? 'localhost:3000'
  const proto =
    req.headers.get('x-forwarded-proto') ??
    (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
