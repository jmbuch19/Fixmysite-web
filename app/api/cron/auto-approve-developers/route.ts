import { createServiceClient } from '@/lib/supabase/server'
import { sendDeveloperApprovedToPartner } from '@/lib/email/sender'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Each pending row triggers a Resend send (~300ms). 60s window
// comfortably handles dozens of rows in one tick. The hourly cadence
// caps backlog: even a slow day with 50 simultaneous registrations
// drains in under a minute on the next tick.
export const maxDuration = 60

/**
 * GET /api/cron/auto-approve-developers
 *
 * Hourly Vercel cron (configured in vercel.json). Auto-approves any
 * developer_partners row that has been pending for 48+ hours with no
 * admin decision. Mirrors what the founder would have done by
 * clicking Approve in the admin notification email — flips
 * verified=true, sets verified_at + decision_method='auto', and fires
 * the same welcome email the manual path uses.
 *
 * Selection criteria (matches the partial index in
 * 20260506000001_developer_approval_audit.sql):
 *   verified = false AND active = true AND created_at < now() - 48h
 *
 * `active = true` is critical: it excludes rows the founder rejected
 * (which sets active=false). A rejected row stays rejected; the cron
 * never re-approves it.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Vercel injects this
 * header automatically when the platform invokes the cron. A leaked
 * URL without the secret is harmless.
 *
 * Idempotency: each row's UPDATE includes `.eq('verified', false)`
 * as a race guard, so two simultaneous cron deliveries (or a manual
 * curl by the founder while the cron is mid-flight) cannot
 * double-approve. The first writer wins, the second sees zero rows
 * affected and falls through.
 */

const PENDING_THRESHOLD_HOURS = 48

export async function GET(req: Request) {
  // ─── Auth ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error(
      '[cron/auto-approve-developers] CRON_SECRET env var is not set — refusing to run',
    )
    return Response.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${expected}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const cutoff = new Date(
    Date.now() - PENDING_THRESHOLD_HOURS * 60 * 60 * 1000,
  ).toISOString()

  const { data: pending, error: loadError } = await supabase
    .from('developer_partners')
    .select('id, name, email, city, skills, created_at')
    .eq('verified', false)
    .eq('active', true)
    .lt('created_at', cutoff)

  if (loadError) {
    console.error(
      '[cron/auto-approve-developers] pending query failed',
      { error: loadError.message },
    )
    return Response.json(
      { ok: false, error: 'pending_query_failed' },
      { status: 500 },
    )
  }

  if (!pending || pending.length === 0) {
    return Response.json({ ok: true, approved: 0, errors: [] })
  }

  const errors: Array<{
    partner_id: string
    stage: 'update' | 'email'
    message: string
  }> = []
  let approvedCount = 0

  for (const row of pending) {
    const nowIso = new Date().toISOString()
    const { error: updateError, count } = await supabase
      .from('developer_partners')
      .update(
        {
          verified: true,
          verified_at: nowIso,
          decision_method: 'auto',
        },
        { count: 'exact' },
      )
      .eq('id', row.id)
      // Race guard — only flip if still pending. If the founder
      // approved manually between our SELECT and our UPDATE, this
      // returns count=0 and we skip the welcome email (manual path
      // already sent it).
      .eq('verified', false)
      .eq('active', true)

    if (updateError) {
      console.error(
        '[cron/auto-approve-developers] update failed',
        { partner_id: row.id, error: updateError.message },
      )
      errors.push({
        partner_id: row.id,
        stage: 'update',
        message: updateError.message,
      })
      continue
    }

    if (count === 0) {
      // Race lost — manual approval beat us to it. The manual path
      // already fired the welcome email; nothing more to do here.
      continue
    }

    approvedCount += 1

    const sendResult = await sendDeveloperApprovedToPartner({
      to: row.email,
      name: row.name,
      city: row.city,
      skills: (row.skills ?? []) as string[],
    })
    if (!sendResult.ok) {
      console.error(
        '[cron/auto-approve-developers] welcome email failed',
        {
          partner_id: row.id,
          partner_email: row.email,
          reason: sendResult.reason,
          error: sendResult.error,
        },
      )
      errors.push({
        partner_id: row.id,
        stage: 'email',
        message: sendResult.error ?? sendResult.reason,
      })
    }
  }

  console.info('[cron/auto-approve-developers] tick complete', {
    candidates: pending.length,
    approved: approvedCount,
    errors: errors.length,
  })

  return Response.json({
    ok: true,
    approved: approvedCount,
    candidates: pending.length,
    errors,
  })
}
