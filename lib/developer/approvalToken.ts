import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

/**
 * Signed approval / rejection tokens for the developer partner flow.
 *
 * Generated server-side and embedded in the admin notification email
 * sent by /api/developer/register on every new registration. The
 * founder clicks Approve or Reject from their inbox; the link goes to
 * /api/developer/decide which verifies the token and applies the
 * state transition.
 *
 * Why HS256 (HMAC, not RSA): the same secret signs and verifies — both
 * happen on our servers, never on a client, so asymmetric isn't needed.
 *
 * Why a 7-day expiry: cron auto-approves at 48h. The 7-day window
 * gives the founder generous slack for late manual decisions even
 * after auto-approval (rejecting an already-approved partner is also
 * useful — sets active=false). Beyond 7 days the link is stale.
 *
 * Why single-use idempotency lives at the route layer (not here): the
 * token itself is just an authorisation envelope. The route checks
 * the row's current state and short-circuits if the decision has
 * already been applied. This makes accidental re-clicks safe and
 * email-prefetcher-safe (Gmail/Outlook may pre-render links to
 * detect phishing — the first hit applies the action; later hits
 * see "already decided" and no-op).
 */

const TOKEN_EXPIRY = '7d'

export type ApprovalAction = 'approve' | 'reject'

export type ApprovalTokenPayload = JWTPayload & {
  partner_id: string
  action: ApprovalAction
}

function getSecret(): Uint8Array {
  const secret = process.env.APPROVAL_TOKEN_SECRET
  if (!secret) {
    throw new Error(
      'APPROVAL_TOKEN_SECRET env var is not set — cannot sign or verify approval tokens',
    )
  }
  if (secret.length < 32) {
    // jose enforces minimum key length for HS256 (32 bytes raw). Fail
    // loudly on misconfiguration instead of silently signing weak tokens.
    throw new Error(
      'APPROVAL_TOKEN_SECRET is too short — needs at least 32 bytes of entropy (use `openssl rand -base64 32`)',
    )
  }
  return new TextEncoder().encode(secret)
}

export async function signApprovalToken(args: {
  partnerId: string
  action: ApprovalAction
}): Promise<string> {
  return new SignJWT({
    partner_id: args.partnerId,
    action: args.action,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(getSecret())
}

export type VerifyResult =
  | { ok: true; partnerId: string; action: ApprovalAction }
  | { ok: false; reason: 'invalid' | 'expired' | 'malformed' }

export async function verifyApprovalToken(
  token: string,
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    const partnerId = payload.partner_id
    const action = payload.action
    if (
      typeof partnerId !== 'string' ||
      partnerId.length === 0 ||
      (action !== 'approve' && action !== 'reject')
    ) {
      return { ok: false, reason: 'malformed' }
    }
    return { ok: true, partnerId, action }
  } catch (err) {
    // jose throws specific errors for expired vs invalid; surface that
    // distinction so the route can render the right message ("link
    // expired — ask the partner to re-register" vs "tampered link").
    const name = err instanceof Error ? err.name : ''
    if (name === 'JWTExpired') return { ok: false, reason: 'expired' }
    return { ok: false, reason: 'invalid' }
  }
}

/**
 * Build the absolute URL the admin clicks in the notification email.
 * Caller passes the app's base URL (typically resolveAppUrl() from
 * lib/queue/qstash) so the link works in dev, staging, and prod.
 */
export function buildDecisionUrl(args: {
  appUrl: string
  token: string
}): string {
  const base = args.appUrl.replace(/\/+$/, '')
  return `${base}/api/developer/decide?token=${encodeURIComponent(args.token)}`
}
