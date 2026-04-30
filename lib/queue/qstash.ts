import { Client, Receiver } from '@upstash/qstash'

/**
 * QStash wrapper.
 *
 * Two responsibilities, kept in one file because they share env vars:
 *
 *   1. PUBLISH side  — `enqueuePhase2()` posts a job from `/api/payment/verify`
 *      (or anywhere) and returns immediately. QStash holds the job, retries on
 *      failure, and POSTs it to our worker URL when ready.
 *
 *   2. RECEIVE side  — `verifyQstashSignature()` is called inside the worker
 *      route to confirm the incoming request is genuinely from QStash and not
 *      a forged hit on a public URL.
 *
 * Lazy-init mirror of `lib/security/rateLimit.ts` — no env reads at module
 * load (cold-start hygiene), fail-open with warn-once in dev, never throws
 * from helpers (always discriminated results).
 *
 * Required env vars in production:
 *   QSTASH_TOKEN              — publish auth (Upstash dashboard → QStash)
 *   QSTASH_CURRENT_SIGNING_KEY — receiver verification (current key)
 *   QSTASH_NEXT_SIGNING_KEY    — receiver verification (rotation key)
 *
 * Optional:
 *   UPSTASH_QSTASH_URL — override publish endpoint (defaults to https://qstash.upstash.io).
 *
 * The worker target URL is derived from NEXT_PUBLIC_APP_URL — must be a
 * publicly reachable HTTPS URL (QStash cannot POST to localhost). For local
 * dev, run `ngrok http 3000` and set NEXT_PUBLIC_APP_URL to the ngrok URL.
 */

// ─── Publish-side client ───────────────────────────────────────────────

let _client: Client | null = null
let _clientWarned = false

function getClient(): Client | null {
  if (_client) return _client
  const token = process.env.QSTASH_TOKEN
  if (!token) {
    if (!_clientWarned) {
      console.warn(
        '[qstash] QSTASH_TOKEN not set — queue publishing is DISABLED. Set the token before production deployment.',
      )
      _clientWarned = true
    }
    return null
  }
  const baseUrl = process.env.UPSTASH_QSTASH_URL
  _client = new Client({ token, ...(baseUrl ? { baseUrl } : {}) })
  return _client
}

// ─── Receive-side verifier ─────────────────────────────────────────────

let _receiver: Receiver | null = null
let _receiverWarned = false

function getReceiver(): Receiver | null {
  if (_receiver) return _receiver
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!currentSigningKey || !nextSigningKey) {
    if (!_receiverWarned) {
      console.warn(
        '[qstash] QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY not set — worker signature verification is DISABLED (fail-closed). Worker requests will be rejected.',
      )
      _receiverWarned = true
    }
    return null
  }
  _receiver = new Receiver({ currentSigningKey, nextSigningKey })
  return _receiver
}

/**
 * True when both publish + receive credentials are present. Lets ops scripts
 * decide whether to publish to the queue or run inline (e.g. local dev with
 * no QStash creds — fall back to direct invocation).
 */
export function hasQstashCredentials(): boolean {
  return (
    !!process.env.QSTASH_TOKEN &&
    !!process.env.QSTASH_CURRENT_SIGNING_KEY &&
    !!process.env.QSTASH_NEXT_SIGNING_KEY
  )
}

// ─── Public URL resolution ─────────────────────────────────────────────

/**
 * Resolve the absolute base URL QStash should POST to. QStash runs outside
 * our network — `localhost` and relative paths will not work.
 *
 * Order: NEXT_PUBLIC_APP_URL → VERCEL_URL (preview deploys) → null.
 * Returns null when neither is set; caller decides how to handle.
 */
export function resolveAppUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`
  return null
}

// ─── Publish: Phase 2 deep scan ────────────────────────────────────────

export type Phase2JobPayload = {
  scan_id: string
  enqueued_at: string // ISO timestamp — useful for downstream lag metrics
}

export type EnqueueResult =
  | { ok: true; message_id: string }
  | {
      ok: false
      reason: 'not_configured' | 'no_app_url' | 'publish_failed'
      error?: string
    }

/**
 * Publish a Phase 2 deep-scan job to QStash. Caller (typically
 * `/api/payment/verify`) should await this and surface failures so the
 * payment row reflects whether the worker was queued.
 *
 * Idempotency: each call is its own message. Re-paying for the same scan
 * publishes a new job — the worker side's `runPhase2` lock-acquisition
 * pattern makes this safe (second run sees status='complete' or 'scanning'
 * and bails). We do not pass a deduplication ID because we want explicit
 * retry capability (admin can re-publish manually).
 *
 * Retry policy: 2 retries with exponential backoff (QStash default 60s/15m).
 * Lower than QStash's max 5 retries because each attempt costs a Twilio
 * lookup and Claude call — better to surface a stuck scan to admin than
 * burn external API credits in a retry loop.
 */
export async function enqueuePhase2(scan_id: string): Promise<EnqueueResult> {
  const client = getClient()
  if (!client) {
    return { ok: false, reason: 'not_configured' }
  }

  const baseUrl = resolveAppUrl()
  if (!baseUrl) {
    console.error(
      '[qstash] cannot enqueue — neither NEXT_PUBLIC_APP_URL nor VERCEL_URL is set',
      { scan_id },
    )
    return { ok: false, reason: 'no_app_url' }
  }

  const targetUrl = `${baseUrl}/api/scan/phase2/worker`
  const payload: Phase2JobPayload = {
    scan_id,
    enqueued_at: new Date().toISOString(),
  }

  try {
    const res = await client.publishJSON({
      url: targetUrl,
      body: payload,
      retries: 2,
    })
    console.info('[qstash] phase2 job enqueued', {
      scan_id,
      message_id: res.messageId,
    })
    return { ok: true, message_id: res.messageId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[qstash] phase2 publish failed', { scan_id, error: msg })
    return { ok: false, reason: 'publish_failed', error: msg }
  }
}

// ─── Receive: signature verification ───────────────────────────────────

export type VerifyResult<T> =
  | { ok: true; payload: T }
  | {
      ok: false
      reason:
        | 'not_configured'
        | 'missing_signature'
        | 'invalid_signature'
        | 'invalid_body'
      error?: string
    }

/**
 * Verify an incoming worker request is signed by QStash.
 *
 * Reads `Upstash-Signature` (the SDK header name) and verifies with the
 * lazily-initialised Receiver. On success returns the parsed JSON body
 * cast to the caller's expected shape — caller MUST then validate the
 * payload with Zod before trusting any field.
 *
 * Fail-closed: if signing keys are missing in env, this returns
 * `not_configured` rather than allowing the request through. The worker
 * route should treat that as 503 (server misconfigured), not 401.
 *
 * NOTE: this consumes the request body (`req.text()`). Do not call
 * `req.json()` on the same request afterwards — pass the returned
 * `payload` instead.
 */
export async function verifyQstashSignature<T = unknown>(
  req: Request,
): Promise<VerifyResult<T>> {
  const receiver = getReceiver()
  if (!receiver) {
    return { ok: false, reason: 'not_configured' }
  }

  const signature = req.headers.get('upstash-signature')
  if (!signature) {
    return { ok: false, reason: 'missing_signature' }
  }

  const rawBody = await req.text()

  try {
    const isValid = await receiver.verify({ signature, body: rawBody })
    if (!isValid) {
      return { ok: false, reason: 'invalid_signature' }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: 'invalid_signature', error: msg }
  }

  try {
    const payload = JSON.parse(rawBody) as T
    return { ok: true, payload }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: 'invalid_body', error: msg }
  }
}
