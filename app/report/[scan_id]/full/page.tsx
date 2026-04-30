import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { ReportClient } from '@/components/report/ReportClient'
import type { ReportScan } from '@/lib/report/types'
import type { Issue } from '@/lib/scan/phase2'

// CLAUDE.md rule 4 — payment status check must always be authoritative.
// `force-dynamic` ensures we hit the DB on every request, never serve a
// cached "paid" view from a stale build.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Keep this string in lockstep with the field list in
// `lib/report/types.ts > ReportScan` and with the polling endpoint
// `app/api/report/[scan_id]/route.ts`. All three contracts must agree.
const SCAN_FIELDS =
  'id, url, url_normalized, status, payment_status, health_score, phase1_result, report_json, tier, page_count, created_at, completed_at'

const ISSUE_FIELDS =
  'category, item, status, detail, priority, effort, action'

/**
 * Server component for /report/[scan_id]/full.
 *
 * Responsibilities (per sub-task 5.1 plan):
 *   1. Validate scan_id format
 *   2. Fetch the scan row
 *   3. Enforce the payment gate — bounce un-paid users to /scanning/<id>
 *   4. If status==='complete', also fetch the relational issues table —
 *      this gives the client the full data needed for the SPEC §7 layout
 *      without an extra round-trip on initial render.
 *   5. Hand everything to <ReportClient/>, which renders status-aware
 *      UI and (in sub-task 5.2) polls /api/report/[scan_id] for updates.
 */
export default async function FullReportPage({
  params,
}: {
  params: Promise<{ scan_id: string }>
}) {
  const { scan_id } = await params
  if (!UUID_RE.test(scan_id)) notFound()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scans')
    .select(SCAN_FIELDS)
    .eq('id', scan_id)
    .single()

  if (error || !data) notFound()
  const scan = data as ReportScan

  // Authoritative payment check. Anyone hitting this URL without payment
  // gets bounced to /scanning (which routes paid users straight back here,
  // so there's no infinite loop).
  if (scan.payment_status !== 'paid') {
    redirect(`/scanning/${scan_id}`)
  }

  let issues: Issue[] = []
  if (scan.status === 'complete') {
    const { data: rows } = await supabase
      .from('issues')
      .select(ISSUE_FIELDS)
      .eq('scan_id', scan_id)
    issues = (rows ?? []) as Issue[]
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center px-5 py-4 sm:px-8">
          <Link href="/" className="text-lg font-semibold text-brand">
            fixmysite.in
          </Link>
        </div>
      </header>

      <main className="flex-1 bg-brand-surface">
        <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
          <ReportClient initial={{ scan, issues }} />
        </div>
      </main>

      <footer className="border-t border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} fixmysite.in</span>
          <span>Made for Indian businesses</span>
        </div>
      </footer>
    </div>
  )
}
