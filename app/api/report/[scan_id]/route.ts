import { createServiceClient } from '@/lib/supabase/server'
import type { Issue } from '@/lib/scan/phase2'
import type { ReportScan } from '@/lib/report/types'

export const runtime = 'nodejs'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Must match `lib/report/types.ts > ReportScan` and the SCAN_FIELDS in
// `app/report/[scan_id]/full/page.tsx`. All three call sites must agree
// or the client cast will silently produce undefined fields at runtime.
const SCAN_FIELDS =
  'id, url, url_normalized, status, payment_status, health_score, phase1_result, report_json, tier, page_count, created_at, completed_at'

const ISSUE_FIELDS =
  'category, item, status, detail, priority, effort, action'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

function noStoreJson(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS })
}

/**
 * GET /api/report/[scan_id]
 *
 * Polling endpoint for the live report page. Called by ReportClient
 * every 2s while the scan is in 'paid' or 'scanning' status (capped at
 * 150 polls).
 *
 * Auth: payment_status = 'paid' on the scan row. No rate limit — same-
 * user polling 150 times in 5 minutes is the expected pattern, not abuse.
 * The payment gate is the auth boundary.
 *
 * Caching: every response is `Cache-Control: no-store`. We never want a
 * proxy or browser to serve a stale snapshot of an in-flight scan.
 *
 * Per CLAUDE.md rule 4: never reveal scan data without verified payment.
 *
 * Response shapes:
 *   200 { scan: ReportScan, issues: Issue[] }       — issues populated only on 'complete'
 *   400 { error: 'Invalid scan id' }                — malformed UUID
 *   401 { error: 'Unauthorized' }                   — payment not verified
 *   404 { error: 'Scan not found' }
 *   500 { error: 'Could not load scan' }            — DB error
 *
 * Edge case (defensive, per spec):
 *   If scan.status === 'complete' AND scan.report_json IS NULL, we log
 *   a warning and return empty issues — never 500. This shouldn't happen
 *   (the orchestrator writes report_json + status atomically) but bad
 *   data shouldn't crash the client.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ scan_id: string }> },
) {
  const { scan_id } = await params

  if (!UUID_RE.test(scan_id)) {
    return noStoreJson({ error: 'Invalid scan id' }, 400)
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scans')
    .select(SCAN_FIELDS)
    .eq('id', scan_id)
    .maybeSingle()

  if (error) {
    console.error('[report-poll] db error', {
      scan_id,
      error: error.message,
    })
    return noStoreJson({ error: 'Could not load scan' }, 500)
  }
  if (!data) {
    return noStoreJson({ error: 'Scan not found' }, 404)
  }

  const scan = data as ReportScan

  if (scan.payment_status !== 'paid') {
    // 401, not 403 — the URL pattern itself is fine, the auth marker
    // (paid status) is what's missing. Same response whether the scan
    // exists unpaid or is in any other state — don't leak existence.
    return noStoreJson({ error: 'Unauthorized' }, 401)
  }

  let issues: Issue[] = []
  if (scan.status === 'complete') {
    if (scan.report_json === null) {
      console.warn(
        '[report-poll] complete status but null report_json',
        { scan_id },
      )
      // Intentionally skip the issues fetch — if report_json is missing
      // the scan's data integrity is suspect. Empty issues array is
      // safer than rendering partial state.
    } else {
      const { data: rows } = await supabase
        .from('issues')
        .select(ISSUE_FIELDS)
        .eq('scan_id', scan_id)
      issues = (rows ?? []) as Issue[]
    }
  }

  return noStoreJson({ scan, issues })
}
