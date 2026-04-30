import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { enqueuePhase2 } from '@/lib/queue/qstash'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  scan_id: z.uuid(),
})

/**
 * POST /api/scan/phase2/trigger
 *
 * Front-of-house entry point for Phase 2. Replaces the old monolithic
 * `/api/scan/phase2` route. Verifies payment + scan state, then publishes
 * the work to QStash and returns 202 immediately.
 *
 * The actual scan runs in `/api/scan/phase2/worker` which QStash POSTs to
 * with a signed request (no client can hit the worker without the signature).
 *
 * Per CLAUDE.md rule 4: re-checks `payment_status='paid'` server-side
 * (defence in depth — never trust client claims).
 *
 * Per CLAUDE.md rule 8: Phase 1 and Phase 2 are separate routes.
 *
 * Rate limit: 3/hour/IP per CLAUDE.md.
 *
 * Response shapes:
 *   202 { ok: true, scan_id, queued: true, message_id }       — newly queued
 *   202 { ok: true, scan_id, already_running: true }          — another worker has it
 *   200 { ok: true, scan_id, already_complete: true, ... }    — already done
 *   403 { error, reason: 'not_paid' }                          — payment not verified
 *   404 { error, reason: 'scan_not_found' }
 *   409 { error, reason: 'previously_failed' }                 — admin must reset
 *   500 { error, reason: 'db_error' | 'enqueue_failed' }
 *   503 { error, reason: 'queue_not_configured' }              — env vars missing
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'phase2-trigger',
    limit: 3,
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

  const supabase = createServiceClient()
  const { data: scan, error: loadError } = await supabase
    .from('scans')
    .select('id, status, payment_status, health_score')
    .eq('id', body.scan_id)
    .maybeSingle()

  if (loadError) {
    console.error('[phase2 trigger] load failed', {
      scan_id: body.scan_id,
      error: loadError.message,
    })
    return Response.json(
      { error: 'Could not load scan', reason: 'db_error' },
      { status: 500 },
    )
  }
  if (!scan) {
    return Response.json(
      { error: 'Scan not found', reason: 'scan_not_found' },
      { status: 404 },
    )
  }
  if (scan.payment_status !== 'paid') {
    return Response.json(
      {
        error: 'Payment not verified for this scan',
        reason: 'not_paid',
      },
      { status: 403 },
    )
  }

  // Idempotent shortcuts — avoid spending a QStash message when there's
  // nothing to do.
  if (scan.status === 'complete') {
    return Response.json(
      {
        ok: true,
        scan_id: scan.id,
        already_complete: true,
        health_score: scan.health_score,
      },
      { status: 200 },
    )
  }
  if (scan.status === 'scanning') {
    return Response.json(
      { ok: true, scan_id: scan.id, already_running: true },
      { status: 202 },
    )
  }
  if (scan.status === 'failed') {
    return Response.json(
      {
        error:
          'A previous run of this scan failed. Contact hello@fixmysite.in to retry.',
        reason: 'previously_failed',
      },
      { status: 409 },
    )
  }

  // status is 'paid' (normal path) or null/'phase1_complete' (edge case where
  // payment_status got flipped without status). Either way, enqueue.
  const enq = await enqueuePhase2(body.scan_id)
  if (!enq.ok) {
    console.error('[phase2 trigger] enqueue failed', {
      scan_id: body.scan_id,
      reason: enq.reason,
      error: enq.error,
    })
    if (enq.reason === 'not_configured' || enq.reason === 'no_app_url') {
      return Response.json(
        {
          error: 'Background queue not configured. Contact support.',
          reason: 'queue_not_configured',
        },
        { status: 503 },
      )
    }
    return Response.json(
      {
        error: 'Could not start the deep scan. Try again in a moment.',
        reason: 'enqueue_failed',
      },
      { status: 502 },
    )
  }

  return Response.json(
    {
      ok: true,
      scan_id: body.scan_id,
      queued: true,
      message_id: enq.message_id,
    },
    { status: 202 },
  )
}
