import { z } from 'zod'
import { runPhase2 } from '@/lib/scan/phase2'
import {
  verifyQstashSignature,
  type Phase2JobPayload,
} from '@/lib/queue/qstash'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 300s budget — covers the long-tail Phase 2 run (Twilio + 3 Claude calls
// + Maps). Requires Vercel Pro; on Hobby this is silently capped at 10s
// and Phase 2 will time out mid-scan.
export const maxDuration = 300

const payloadSchema = z.object({
  scan_id: z.uuid(),
  enqueued_at: z.string().min(1),
})

/**
 * POST /api/scan/phase2/worker
 *
 * Internal endpoint — only QStash calls this. Authenticates via the
 * `Upstash-Signature` HMAC header (verified against both current + next
 * signing keys to allow rotation). No client should ever hit this.
 *
 * Runs the Phase 2 orchestrator (`runPhase2`) which is fully idempotent:
 *   - duplicate deliveries (QStash retry, double-publish) are caught by
 *     the atomic `paid → scanning` lock acquisition in the orchestrator.
 *   - status='complete' / 'scanning' / 'failed' all early-return cleanly.
 *
 * No rate limit — QStash itself rate-limits, and the HMAC signature is
 * the auth boundary. Adding IP-based rate limiting would block legitimate
 * QStash retries from the same upstream IP.
 *
 * Status-code policy for QStash retry behaviour:
 *   - 200 on `ok: true` (success — ack)
 *   - 200 on permanent failures (`scan_not_found`, `not_paid`,
 *     `previously_failed`, `in_progress`) — these will not improve with
 *     a retry, ack to remove from queue
 *   - 500 on transient failures (`db_error`, `orchestrator_error`) —
 *     QStash retries with backoff (max 2 retries per `enqueuePhase2`)
 *   - 401 on signature failure (rejects forged hits)
 *   - 503 if signing keys are missing (server misconfigured — alert)
 */
export async function POST(req: Request) {
  const verified = await verifyQstashSignature<Phase2JobPayload>(req)
  if (!verified.ok) {
    if (verified.reason === 'not_configured') {
      console.error(
        '[phase2 worker] QStash signing keys not configured — rejecting all requests',
      )
      return Response.json(
        { error: 'Worker not configured' },
        { status: 503 },
      )
    }
    if (verified.reason === 'invalid_body') {
      console.warn('[phase2 worker] invalid body', { error: verified.error })
      return Response.json({ error: 'Invalid body' }, { status: 400 })
    }
    // missing_signature or invalid_signature
    console.warn('[phase2 worker] signature check failed', {
      reason: verified.reason,
      error: verified.error,
    })
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = payloadSchema.safeParse(verified.payload)
  if (!parsed.success) {
    console.warn('[phase2 worker] payload validation failed', {
      issues: parsed.error.issues,
    })
    return Response.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { scan_id, enqueued_at } = parsed.data
  const enqueuedAtMs = Date.parse(enqueued_at)
  const lagMs = Number.isFinite(enqueuedAtMs) ? Date.now() - enqueuedAtMs : null

  const outcome = await runPhase2(scan_id)

  console.info('[phase2 worker] processed', {
    scan_id,
    outcome_ok: outcome.ok,
    reason: outcome.ok ? null : outcome.reason,
    queue_lag_ms: lagMs,
  })

  if (outcome.ok) {
    return Response.json(
      {
        ok: true,
        scan_id: outcome.scan_id,
        health_score: outcome.health_score,
        already_complete: outcome.already_complete,
      },
      { status: 200 },
    )
  }

  // Permanent failures — ack so QStash drops the message.
  if (
    outcome.reason === 'scan_not_found' ||
    outcome.reason === 'not_paid' ||
    outcome.reason === 'previously_failed' ||
    outcome.reason === 'in_progress'
  ) {
    return Response.json(
      { ok: false, scan_id: outcome.scan_id, reason: outcome.reason },
      { status: 200 },
    )
  }

  // Transient — return 500 so QStash retries with backoff.
  console.error('[phase2 worker] transient failure — QStash will retry', {
    scan_id,
    reason: outcome.reason,
    message: outcome.message,
  })
  return Response.json(
    {
      ok: false,
      scan_id: outcome.scan_id,
      reason: outcome.reason,
      message: outcome.message,
    },
    { status: 500 },
  )
}
