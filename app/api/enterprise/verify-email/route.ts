import { z } from 'zod'
import { coerceToUrl, normalizeUrl } from '@/lib/scan/extractor'
import { classifyUrl, type UrlClass } from '@/lib/scan/classifier'
import { isEmailDomainValid } from '@/lib/enterprise/domainMatch'
import { generateOtp, hashOtp } from '@/lib/enterprise/otp'
import { sendOtpEmail } from '@/lib/email/sender'
import { hasMxRecord } from '@/lib/enterprise/emailGuard'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESEND_THROTTLE_MS = 60_000 // rule #49 — 60s between resends to same inquiry

const bodySchema = z.object({
  url: z.string().min(3).max(2048),
  email: z.string().email().max(254),
  scan_id: z.uuid().optional(),
})

/**
 * POST /api/enterprise/verify-email
 *
 * Two flows route through here:
 *   1. Enterprise / institution gate (Path A/B/C) — fires from AdminGate.
 *      No scan_id; inquiry stands alone for admin review.
 *   2. Complex-tier gate (Path D Large) — fires from /scanning/[scan_id]
 *      after Phase 1. scan_id required; inquiry links back to the scan.
 *
 * Build-rule contract enforced here:
 *   #46  MX check before any DB write.
 *   #47  Send result is a discriminated union — never throws.
 *   #48  Email send failure rolls back the DB row.
 *   #49  Idempotent — looks up existing pending inquiry first; resends to
 *        the same row past the 60s throttle, returns existing id within it.
 *   #50  Every error response carries a `reason` so the frontend can map
 *        to a user-facing next-action message.
 *
 * Rate limit: 5/hour/IP.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'enterprise-verify-email',
    limit: 5,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch {
    return Response.json(
      { error: 'Invalid request body', reason: 'invalid_body' },
      { status: 400 },
    )
  }

  // ─── Parse + normalise URL ─────────────────────────────────────────────
  let urlNormalized: string
  let hostname: string
  try {
    const coerced = coerceToUrl(body.url)
    urlNormalized = normalizeUrl(coerced)
    hostname = new URL(coerced).hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '')
  } catch {
    return Response.json(
      { error: 'Invalid URL', reason: 'invalid_url' },
      { status: 400 },
    )
  }

  const urlClass: UrlClass = classifyUrl(hostname)
  const supabase = createServiceClient()

  // ─── self_serve gate: requires scan_id + Large tier ────────────────────
  if (urlClass === 'self_serve') {
    if (!body.scan_id) {
      return Response.json(
        {
          error: 'This URL does not require domain verification',
          reason: 'not_required',
        },
        { status: 400 },
      )
    }

    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .select('id, tier, payment_status, url_normalized')
      .eq('id', body.scan_id)
      .maybeSingle()

    if (scanError || !scan) {
      return Response.json(
        { error: 'Scan not found', reason: 'scan_not_found' },
        { status: 404 },
      )
    }
    if (scan.tier !== 'large') {
      return Response.json(
        {
          error: 'This URL does not require domain verification',
          reason: 'not_required',
        },
        { status: 400 },
      )
    }
    if (scan.payment_status === 'paid') {
      return Response.json(
        { error: 'Scan is already paid', reason: 'already_paid' },
        { status: 400 },
      )
    }
    if (scan.url_normalized !== urlNormalized) {
      return Response.json(
        { error: 'Scan URL mismatch', reason: 'url_mismatch' },
        { status: 400 },
      )
    }
  }

  // ─── Domain-match validation ───────────────────────────────────────────
  const validation = isEmailDomainValid(body.email, hostname)
  if (!validation.valid) {
    return Response.json(
      { error: 'Email cannot verify ownership', reason: validation.reason },
      { status: 400 },
    )
  }

  const claimedEmail = body.email.toLowerCase()
  const emailDomain = claimedEmail.split('@')[1]!

  // ─── Rule #46: MX check BEFORE any DB write ────────────────────────────
  // If the email domain can't receive mail, the OTP would land nowhere.
  // 422 (Unprocessable Entity) — the request is well-formed but the email
  // address isn't routable.
  const mxOk = await hasMxRecord(emailDomain)
  if (!mxOk) {
    return Response.json(
      {
        error:
          'That email domain has no mail server. Try a different email.',
        reason: 'no_mx_record',
      },
      { status: 422 },
    )
  }

  // ─── Rule #49: idempotency — look up existing pending inquiry ──────────
  // Match key: (url_normalized, claimed_email, scan_id-or-null) with status
  // 'pending' and not yet verified. If found, we either throttle (< 60s
  // since last send) or resend to the same row (≥ 60s).
  let lookup = supabase
    .from('enterprise_inquiries')
    .select('id, otp_sent_at')
    .eq('url_normalized', urlNormalized)
    .eq('claimed_email', claimedEmail)
    .eq('otp_verified', false)
    .eq('status', 'pending')

  lookup = body.scan_id
    ? lookup.eq('scan_id', body.scan_id)
    : lookup.is('scan_id', null)

  const { data: existing } = await lookup
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const now = Date.now()

  if (existing) {
    const lastSentMs = existing.otp_sent_at
      ? new Date(existing.otp_sent_at as string).getTime()
      : 0
    const elapsed = now - lastSentMs

    if (elapsed < RESEND_THROTTLE_MS) {
      // Throttled — 429 per CLAUDE.md call-order spec. Frontend reads
      // `reason: 'throttled'` to differentiate from rate-limit 429s.
      // Inquiry id + hostname returned so the frontend can still advance
      // to OTP entry (the previously-delivered code is valid for 15 min).
      return Response.json(
        {
          error: 'Please wait before requesting another code',
          reason: 'throttled',
          inquiry_id: existing.id,
          hostname,
          url_class: urlClass,
          seconds_until_resend: Math.ceil(
            (RESEND_THROTTLE_MS - elapsed) / 1000,
          ),
        },
        { status: 429 },
      )
    }

    // ≥ 60s ago: resend. Generate fresh OTP, update row, send email.
    const otp = generateOtp()
    const otpHash = await hashOtp(otp)

    const { error: updateError } = await supabase
      .from('enterprise_inquiries')
      .update({
        otp_code: otpHash,
        otp_sent_at: new Date().toISOString(),
        otp_attempts: 0,
      })
      .eq('id', existing.id)

    if (updateError) {
      console.error('[verify-email] failed to update for resend', {
        id: existing.id,
        error: updateError.message,
      })
      return Response.json(
        { error: 'Could not start verification', reason: 'db_error' },
        { status: 500 },
      )
    }

    const sendResult = await sendOtpEmail({ to: claimedEmail, otp, hostname })

    if (!sendResult.ok) {
      // Rule #48: rollback. Clear the OTP fields we just wrote so the
      // user can immediately retry without hitting the throttle. Logged
      // but not surfaced — the user just sees "couldn't send".
      const { error: rollbackError } = await supabase
        .from('enterprise_inquiries')
        .update({ otp_code: null, otp_sent_at: null, otp_attempts: 0 })
        .eq('id', existing.id)
      if (rollbackError) {
        console.error('[verify-email] resend rollback failed', {
          id: existing.id,
          error: rollbackError.message,
        })
      }
      console.error('[verify-email] resend OTP email failed', {
        inquiry_id: existing.id,
        reason: sendResult.reason,
        error: sendResult.error,
      })
      return Response.json(
        {
          error: 'Could not send verification code. Try again in a moment.',
          reason: 'send_failed',
        },
        { status: 502 },
      )
    }

    return Response.json({
      inquiry_id: existing.id,
      hostname,
      url_class: urlClass,
      resent: true,
    })
  }

  // ─── Fresh inquiry — insert, then send, with rule-#48 rollback ─────────
  const otp = generateOtp()
  const otpHash = await hashOtp(otp)

  const { data: inquiry, error: insertError } = await supabase
    .from('enterprise_inquiries')
    .insert({
      scan_id: body.scan_id ?? null,
      url: body.url,
      url_normalized: urlNormalized,
      url_class: urlClass,
      claimed_email: claimedEmail,
      email_domain: emailDomain,
      url_domain: hostname,
      domain_match: true,
      otp_code: otpHash,
      otp_sent_at: new Date().toISOString(),
      otp_attempts: 0,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !inquiry) {
    console.error('[verify-email] failed to insert inquiry', {
      hostname,
      scan_id: body.scan_id,
      error: insertError?.message,
    })
    return Response.json(
      { error: 'Could not start verification', reason: 'db_error' },
      { status: 500 },
    )
  }

  const sendResult = await sendOtpEmail({ to: claimedEmail, otp, hostname })

  if (!sendResult.ok) {
    // Rule #48: row was just inserted but the email never made it. Roll
    // back hard — delete the orphan. Best-effort; if delete fails (rare),
    // we log it but still surface the send failure to the user.
    const { error: deleteError } = await supabase
      .from('enterprise_inquiries')
      .delete()
      .eq('id', inquiry.id)
    if (deleteError) {
      console.error('[verify-email] orphan rollback failed', {
        id: inquiry.id,
        error: deleteError.message,
      })
    }
    console.error('[verify-email] OTP email send failed', {
      inquiry_id: inquiry.id,
      reason: sendResult.reason,
      error: sendResult.error,
    })
    return Response.json(
      {
        error: 'Could not send verification code. Try again in a moment.',
        reason: 'send_failed',
      },
      { status: 502 },
    )
  }

  return Response.json({
    inquiry_id: inquiry.id,
    hostname,
    url_class: urlClass,
  })
}
