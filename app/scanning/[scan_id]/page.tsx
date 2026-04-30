import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { PriceGate } from '@/components/scan/PriceGate'
import { DomainVerifyGate } from '@/components/enterprise/DomainVerifyGate'
import type { Phase1Result, Phase1Tier } from '@/lib/scan/phase1'
import {
  checkPreviousScan,
  type PreviousScanSummary,
} from '@/lib/scan/returnVisit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ScanRow = {
  id: string
  url: string
  url_normalized: string
  page_count: number | null
  tier: Phase1Tier | null
  status: string | null
  payment_status: string
  phase1_result: Phase1Result | null
  created_at: string
}

export default async function ScanningPage({
  params,
}: {
  params: Promise<{ scan_id: string }>
}) {
  const { scan_id } = await params
  if (!UUID_RE.test(scan_id)) notFound()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scans')
    .select(
      'id, url, url_normalized, page_count, tier, status, payment_status, phase1_result, created_at',
    )
    .eq('id', scan_id)
    .single()

  if (error || !data) notFound()
  const scan = data as ScanRow

  // Look up a prior paid+completed scan only when the user is actually
  // standing in front of the price gate. Skip for paid/failed/unknown
  // states — saves a DB round-trip and avoids confusing already-paid users
  // with "we scanned you before" messaging.
  const previous: PreviousScanSummary | null =
    scan.status === 'phase1_complete' && scan.payment_status !== 'paid'
      ? await checkPreviousScan(scan.url_normalized)
      : null

  // SPEC §4 size-based gate: Large-tier (51-200 pages) self-serve scans
  // need domain-email verification before PriceGate is shown. Other tiers
  // (small/medium/enterprise) and already-paid scans skip this entirely
  // (treated as "verified" so the branch in Phase1Summary falls through).
  const domainVerified =
    scan.tier === 'large' &&
    scan.status === 'phase1_complete' &&
    scan.payment_status !== 'paid'
      ? await hasVerifiedInquiry(supabase, scan.id)
      : true

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
        <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
          <ScanContent
            scan={scan}
            previous={previous}
            domainVerified={domainVerified}
          />
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

function ScanContent({
  scan,
  previous,
  domainVerified,
}: {
  scan: ScanRow
  previous: PreviousScanSummary | null
  domainVerified: boolean
}) {
  if (scan.payment_status === 'paid') {
    return <AlreadyPaid scan_id={scan.id} />
  }
  if (scan.status === 'failed') {
    return <ScanFailed />
  }
  if (scan.status === 'phase1_complete') {
    return (
      <Phase1Summary
        scan={scan}
        previous={previous}
        domainVerified={domainVerified}
      />
    )
  }
  return <UnexpectedState status={scan.status ?? 'unknown'} />
}

function Phase1Summary({
  scan,
  previous,
  domainVerified,
}: {
  scan: ScanRow
  previous: PreviousScanSummary | null
  domainVerified: boolean
}) {
  const phase1 = scan.phase1_result
  const displayHost = (() => {
    try {
      const u = new URL(phase1?.finalUrl ?? scan.url)
      return u.host.replace(/^www\./, '')
    } catch {
      return scan.url
    }
  })()

  const pageCount = scan.page_count ?? 0
  const tier: Phase1Tier = scan.tier ?? 'small'
  const isHttps = phase1?.ssl?.basicValid ?? false
  const robotsExists = phase1?.robots?.exists ?? false
  const crawlAllowed = phase1?.robots?.crawlAllowed ?? true
  const price = phase1?.price ?? null

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
        {displayHost} is reachable.
      </h1>

      <ul className="mt-6 space-y-2 text-base text-zinc-700">
        <li>
          ✓{' '}
          {pageCount === 0
            ? 'Just the homepage detected'
            : `We found ~${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`}
        </li>
        {isHttps ? (
          <li>✓ SSL certificate is valid</li>
        ) : (
          <li className="text-amber-700">
            ⚠ Site served over HTTP — no SSL certificate
          </li>
        )}
        {robotsExists ? (
          crawlAllowed ? (
            <li>✓ robots.txt found</li>
          ) : (
            <li className="text-amber-700">
              ⚠ robots.txt blocks crawlers — full scan may be limited
            </li>
          )
        ) : (
          <li>✓ No robots.txt restrictions</li>
        )}
      </ul>

      {previous && <PreviousScanBanner previous={previous} />}

      <div className="mt-8">
        {tier === 'enterprise' ? (
          <EnterpriseCta />
        ) : tier === 'large' && !domainVerified ? (
          <DomainVerifyGate
            scanId={scan.id}
            url={scan.url}
            hostname={displayHost}
            pageCount={scan.page_count ?? 0}
          />
        ) : price !== null ? (
          <PriceGate scan_id={scan.id} tier={tier} price={price} />
        ) : (
          <UnexpectedState status="missing price" />
        )}
      </div>
    </>
  )
}

function EnterpriseCta() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        200+ pages — let&apos;s talk
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700">
        Sites this size need a custom plan. Tell us a bit about your business
        and we&apos;ll send a quote within one working day.
      </p>
      <Link
        href="/agency"
        className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent"
      >
        Contact us
      </Link>
    </div>
  )
}

async function hasVerifiedInquiry(
  supabase: ReturnType<typeof createServiceClient>,
  scanId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('enterprise_inquiries')
    .select('id')
    .eq('scan_id', scanId)
    .eq('otp_verified', true)
    .limit(1)
    .maybeSingle()
  return !!data
}

function PreviousScanBanner({ previous }: { previous: PreviousScanSummary }) {
  const date = new Date(previous.completed_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const scoreFragment =
    previous.health_score !== null
      ? ` — health score was ${previous.health_score}/100`
      : ''
  return (
    <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-5">
      <p className="text-sm leading-relaxed text-zinc-700">
        We last scanned this site on <strong>{date}</strong>
        {scoreFragment}. Run a fresh scan to see what&apos;s changed.
      </p>
    </div>
  )
}

function AlreadyPaid({ scan_id }: { scan_id: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">Payment received</h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700">
        Your full scan is ready to view.
      </p>
      <Link
        href={`/report/${scan_id}/full`}
        className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent"
      >
        View report
      </Link>
    </div>
  )
}

function ScanFailed() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        This scan didn&apos;t complete
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700">
        Something went wrong while scanning your site. Try again from the
        homepage.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 py-3 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
      >
        Back home
      </Link>
    </div>
  )
}

function UnexpectedState({ status }: { status: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        Your scan is in an unexpected state
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700">
        Status: {status}. If this persists, start a new scan from the homepage.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 py-3 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
      >
        Back home
      </Link>
    </div>
  )
}
