import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { sendReportToDeveloper } from '@/lib/email/sender'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import type { Issue } from '@/lib/scan/phase2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  scan_id: z.uuid(),
  developer_email: z.string().trim().email().max(254),
})

const ISSUE_FIELDS =
  'category, item, status, detail, priority, effort, action'

const PRIORITY_WEIGHT: Record<Issue['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}
const EFFORT_WEIGHT: Record<Issue['effort'], number> = {
  low: 0,
  medium: 1,
  high: 2,
}

/**
 * POST /api/report/send-developer
 *
 * Forwards a paid scan's solution map to the owner's developer via Resend
 * (CLAUDE.md template 2). Called by the §11 form on the full report page.
 *
 * Per CLAUDE.md rule 4: never act on a scan the caller hasn't paid for.
 * We re-fetch payment_status server-side (defence in depth — never trust
 * the client's claim about a scan_id).
 *
 * Rate limit: 3/hour/IP per CLAUDE.md.
 *
 * Order of operations is deliberate:
 *   1. Validate input
 *   2. Verify scan + payment
 *   3. Fetch issues + build solution map
 *   4. Send email via Resend
 *   5. Insert developer_sends row with status reflecting send result
 *
 * Insert AFTER send so the row's `status` column always reflects the
 * actual send outcome — no two-step "queued → sent" dance. If insert
 * fails, the email still went; we log and return success.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'send-developer',
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

  const { data: scan, error: scanError } = await supabase
    .from('scans')
    .select('id, url, payment_status, status')
    .eq('id', body.scan_id)
    .maybeSingle()

  if (scanError) {
    console.error('[send-developer] db error', {
      scan_id: body.scan_id,
      error: scanError.message,
    })
    return Response.json({ error: 'Could not load scan' }, { status: 500 })
  }
  if (!scan) {
    return Response.json({ error: 'Scan not found' }, { status: 404 })
  }
  if (scan.payment_status !== 'paid') {
    // 403 not 401 — the request shape is fine; the resource is gated.
    return Response.json(
      {
        error: 'This scan has not been paid for. Cannot send the report.',
        reason: 'not_paid',
      },
      { status: 403 },
    )
  }

  const { data: issueRows, error: issuesError } = await supabase
    .from('issues')
    .select(ISSUE_FIELDS)
    .eq('scan_id', body.scan_id)

  if (issuesError) {
    console.error('[send-developer] failed to fetch issues', {
      scan_id: body.scan_id,
      error: issuesError.message,
    })
    return Response.json({ error: 'Could not load scan' }, { status: 500 })
  }

  const allIssues = (issueRows ?? []) as Issue[]

  // Solution map: actionable items only ('ok' = verified, no work needed),
  // sorted high-priority + low-effort first — same logic as §10 in the
  // web report so the developer reads exactly what the owner saw.
  const solutionMap = allIssues
    .filter((i) => i.status !== 'ok')
    .slice()
    .sort((a, b) => {
      const p = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
      if (p !== 0) return p
      return EFFORT_WEIGHT[a.effort] - EFFORT_WEIGHT[b.effort]
    })

  const hostname = (() => {
    try {
      return new URL(scan.url).hostname.replace(/^www\./, '')
    } catch {
      return scan.url
    }
  })()

  const sendResult = await sendReportToDeveloper({
    to: body.developer_email,
    scanUrl: scan.url,
    hostname,
    issueCount: solutionMap.length,
    solutionMap,
  })

  // Record the send (success or failure) for ops + admin visibility.
  const { error: insertError } = await supabase
    .from('developer_sends')
    .insert({
      scan_id: body.scan_id,
      dev_email: body.developer_email,
      status: sendResult.ok ? 'sent' : 'failed',
    })
  if (insertError) {
    // Don't fail the route — the email may have gone out and the user
    // shouldn't see an error for an internal log issue.
    console.error('[send-developer] developer_sends insert failed', {
      scan_id: body.scan_id,
      send_ok: sendResult.ok,
      error: insertError.message,
    })
  }

  if (!sendResult.ok) {
    console.error('[send-developer] resend send failed', {
      scan_id: body.scan_id,
      reason: sendResult.reason,
      error: sendResult.error,
    })
    return Response.json(
      {
        error:
          'Could not send the report. Try again, or email hello@fixmysite.in and we will forward it for you.',
        reason: sendResult.reason,
      },
      { status: 502 },
    )
  }

  return Response.json({
    ok: true,
    scan_id: body.scan_id,
    email: body.developer_email,
  })
}
