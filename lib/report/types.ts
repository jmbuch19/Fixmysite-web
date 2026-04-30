import type { Phase1Result, Phase1Tier } from '@/lib/scan/phase1'
import type { Issue } from '@/lib/scan/phase2'

/**
 * Wire shape exposed to the report page client. The same shape is:
 *   - assembled by the server component on initial render
 *     (app/report/[scan_id]/full/page.tsx)
 *   - returned by the polling endpoint
 *     (app/api/report/[scan_id]/route.ts)
 *   - consumed by ReportClient.tsx
 *
 * Keeping the contract in one place stops the three call sites drifting.
 *
 * Intentionally NOT included from the scans row:
 *   - payment_id     — internal, never rendered
 *   - phase2_result  — per-check status detail. Not used by the current UI;
 *                      revisit if sub-task 5.4's 11-section render needs it.
 */
export type ReportScan = {
  id: string
  url: string
  url_normalized: string
  status: string | null
  payment_status: string
  health_score: number | null
  phase1_result: Phase1Result | null
  report_json: unknown | null
  tier: Phase1Tier | null
  page_count: number | null
  created_at: string
  completed_at: string | null
}

export type ReportData = {
  scan: ReportScan
  issues: Issue[]
}
