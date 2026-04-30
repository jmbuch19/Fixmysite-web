import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAuthClient, isAdminEmail } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { AdminHeader } from '@/components/admin/AdminHeader'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ScanRow = {
  id: string
  url: string
  url_normalized: string
  tier: string | null
  status: string | null
  payment_status: string
  created_at: string
}

type InquiryRow = {
  id: string
  url: string
  url_class: string
  claimed_email: string
  status: string
  manually_approved: boolean
  created_at: string
}

type Metrics = {
  totalScans: number
  paid30d: number
  pendingInquiries: number
}

export default async function AdminDashboardPage() {
  // Middleware already gates this — but defensively confirm. If middleware
  // somehow let a non-admin through (misconfigured matcher, etc.), this
  // still bounces them.
  const authClient = await createAuthClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    redirect('/admin/login')
  }

  const supabase = createServiceClient()
  const [metrics, recentScans, pendingInquiries] = await Promise.all([
    fetchMetrics(supabase),
    fetchRecentScans(supabase),
    fetchPendingInquiries(supabase),
  ])

  const adminEmail = user.email ?? 'admin'

  return (
    <div className="flex flex-1 flex-col">
      <AdminHeader email={adminEmail} />

      <main className="flex-1 bg-zinc-50">
        <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            Welcome back.
          </h1>
          <p className="mt-2 text-sm text-zinc-700">
            Signed in as <strong>{adminEmail}</strong>.
          </p>

          <MetricsGrid metrics={metrics} />

          <QuickLinks />

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-zinc-900">
              Pending inquiries
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Verified inquiries awaiting your review and price quote.
            </p>
            <PendingInquiriesTable rows={pendingInquiries} />
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-zinc-900">
              Recent scans
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              The last 10 scans across the platform, paid or not.
            </p>
            <RecentScansTable rows={recentScans} />
          </section>
        </div>
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} fixmysite.in admin</span>
          <span>Internal use only</span>
        </div>
      </footer>
    </div>
  )
}

// ─── Data fetchers ────────────────────────────────────────────────────

async function fetchMetrics(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<Metrics> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [totalScansRes, paid30dRes, pendingRes] = await Promise.all([
    supabase.from('scans').select('*', { count: 'exact', head: true }),
    supabase
      .from('scans')
      .select('*', { count: 'exact', head: true })
      .eq('payment_status', 'paid')
      .gte('created_at', thirtyDaysAgo),
    supabase
      .from('enterprise_inquiries')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'otp_verified')
      .eq('manually_approved', false)
      // Exclude Complex-tier self_serve verifications — those are
      // automatic domain proofs, not items needing admin review.
      .neq('url_class', 'self_serve'),
  ])

  return {
    totalScans: totalScansRes.count ?? 0,
    paid30d: paid30dRes.count ?? 0,
    pendingInquiries: pendingRes.count ?? 0,
  }
}

async function fetchRecentScans(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<ScanRow[]> {
  const { data } = await supabase
    .from('scans')
    .select(
      'id, url, url_normalized, tier, status, payment_status, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(10)
  return (data ?? []) as ScanRow[]
}

async function fetchPendingInquiries(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<InquiryRow[]> {
  const { data } = await supabase
    .from('enterprise_inquiries')
    .select(
      'id, url, url_class, claimed_email, status, manually_approved, created_at',
    )
    .eq('status', 'otp_verified')
    .eq('manually_approved', false)
    .neq('url_class', 'self_serve')
    .order('created_at', { ascending: false })
    .limit(10)
  return (data ?? []) as InquiryRow[]
}

// ─── UI sub-components ────────────────────────────────────────────────

function MetricsGrid({ metrics }: { metrics: Metrics }) {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      <MetricCard label="Total scans" value={metrics.totalScans} />
      <MetricCard label="Paid (last 30 days)" value={metrics.paid30d} />
      <MetricCard
        label="Pending inquiries"
        value={metrics.pendingInquiries}
        highlight={metrics.pendingInquiries > 0}
      />
    </div>
  )
}

function MetricCard({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        highlight
          ? 'border-amber-200 bg-amber-50'
          : 'border-zinc-200 bg-white'
      }`}
    >
      <p
        className={`text-xs uppercase tracking-wider ${
          highlight ? 'text-amber-900' : 'text-zinc-500'
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums ${
          highlight ? 'text-amber-900' : 'text-zinc-900'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function QuickLinks() {
  const links: Array<{ href: string; label: string; description: string }> = [
    {
      href: '/admin/inquiries',
      label: 'Inquiries',
      description:
        'Enterprise + institution inquiries. Approve, set price, reject.',
    },
    {
      href: '/admin/scans',
      label: 'Scans',
      description: 'All scans. Filter by tier, status, payment.',
    },
    {
      href: '/admin/briefs',
      label: 'Briefs',
      description: 'Developer briefs generated post-scan.',
    },
  ]

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="group rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-brand hover:bg-brand-surface"
        >
          <p className="text-base font-semibold text-zinc-900 group-hover:text-brand">
            {link.label} →
          </p>
          <p className="mt-2 text-sm text-zinc-600">{link.description}</p>
        </Link>
      ))}
    </div>
  )
}

function PendingInquiriesTable({ rows }: { rows: InquiryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No pending inquiries. Everyone is reviewed.
      </div>
    )
  }
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3">URL</th>
            <th className="px-4 py-3">Class</th>
            <th className="px-4 py-3 hidden sm:table-cell">Claimed email</th>
            <th className="px-4 py-3 hidden md:table-cell">Submitted</th>
            <th className="px-4 py-3 text-right" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <tr key={row.id} className="text-zinc-700">
              <td className="px-4 py-3 font-medium">{displayHost(row.url)}</td>
              <td className="px-4 py-3 text-xs">
                {formatUrlClass(row.url_class)}
              </td>
              <td className="px-4 py-3 hidden sm:table-cell text-zinc-600">
                {row.claimed_email}
              </td>
              <td className="px-4 py-3 hidden md:table-cell text-zinc-600">
                {formatDate(row.created_at)}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/admin/inquiries/${row.id}`}
                  className="text-sm font-medium text-brand hover:text-brand-accent"
                >
                  Review →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RecentScansTable({ rows }: { rows: ScanRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No scans yet.
      </div>
    )
  }
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3">URL</th>
            <th className="px-4 py-3">Tier</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 hidden sm:table-cell">Payment</th>
            <th className="px-4 py-3 hidden md:table-cell">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <tr key={row.id} className="text-zinc-700">
              <td className="px-4 py-3 font-medium">{displayHost(row.url)}</td>
              <td className="px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
                {row.tier ?? '—'}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-3 hidden sm:table-cell">
                <PaymentBadge status={row.payment_status} />
              </td>
              <td className="px-4 py-3 hidden md:table-cell text-zinc-600">
                {formatDate(row.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-zinc-400">—</span>
  const tone =
    status === 'complete'
      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
      : status === 'failed'
        ? 'bg-red-50 text-red-900 border-red-200'
        : 'bg-zinc-50 text-zinc-700 border-zinc-200'
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function PaymentBadge({ status }: { status: string }) {
  const tone =
    status === 'paid'
      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
      : status === 'refunded' || status === 'failed'
        ? 'bg-red-50 text-red-900 border-red-200'
        : 'bg-zinc-50 text-zinc-700 border-zinc-200'
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status}
    </span>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

function displayHost(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function formatUrlClass(cls: string): string {
  switch (cls) {
    case 'global_enterprise':
      return 'Global enterprise'
    case 'indian_enterprise':
      return 'Indian enterprise'
    case 'institution':
      return 'Institution'
    case 'self_serve':
      return 'Self-serve (Complex tier)'
    default:
      return cls
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
