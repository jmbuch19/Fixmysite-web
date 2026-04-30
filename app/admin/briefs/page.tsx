import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAuthClient, isAdminEmail } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { AdminHeader } from '@/components/admin/AdminHeader'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25
const MAX_QUERY_LEN = 100

type PaymentFilter = 'all' | 'paid' | 'unpaid' | 'refunded' | 'failed'

const PAYMENT_FILTERS: Array<{ key: PaymentFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'failed', label: 'Failed' },
]

type BriefRow = {
  id: string
  scan_id: string | null
  detected_language: string | null
  business_type: string | null
  brief_pdf_url: string | null
  payment_id: string | null
  payment_status: string
  owner_email: string | null
  dev_email: string | null
  sent_at: string | null
  created_at: string
  scans: { id: string; url: string; url_normalized: string } | null
}

export default async function BriefsListPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string; q?: string; page?: string }>
}) {
  const auth = await createAuthClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    redirect('/admin/login')
  }

  const params = await searchParams
  const filter = parsePaymentFilter(params.payment)
  const query = parseQuery(params.q)
  const page = parsePage(params.page)

  const result = await fetchBriefs(filter, query, page)
  const adminEmail = user.email ?? 'admin'

  return (
    <div className="flex flex-1 flex-col">
      <AdminHeader email={adminEmail} />

      <main className="flex-1 bg-zinc-50">
        <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
          <Link
            href="/admin"
            className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
          >
            ← Dashboard
          </Link>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            Briefs
          </h1>
          <p className="mt-2 text-sm text-zinc-700">
            Developer briefs generated from owner input post-scan.
          </p>

          {result.kind === 'table_missing' ? (
            <TableMissingNotice />
          ) : (
            <>
              <p className="mt-1 text-sm text-zinc-600">
                {result.totalCount}{' '}
                {result.totalCount === 1 ? 'brief' : 'briefs'} in current
                view
                {query ? <> matching &ldquo;{query}&rdquo;</> : null}.
              </p>

              <SearchBox currentFilter={filter} currentQuery={query} />
              <FilterRow active={filter} query={query} />

              <BriefsTable rows={result.rows} />

              {result.totalCount > PAGE_SIZE && (
                <Pagination
                  filter={filter}
                  query={query}
                  page={page}
                  totalPages={Math.max(
                    1,
                    Math.ceil(result.totalCount / PAGE_SIZE),
                  )}
                />
              )}
            </>
          )}
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

// ─── Data fetch ───────────────────────────────────────────────────────

type FetchResult =
  | { kind: 'ok'; rows: BriefRow[]; totalCount: number }
  | { kind: 'table_missing' }

async function fetchBriefs(
  filter: PaymentFilter,
  query: string,
  page: number,
): Promise<FetchResult> {
  const supabase = createServiceClient()

  let q = supabase
    .from('briefs')
    .select(
      `id, scan_id, detected_language, business_type, brief_pdf_url,
       payment_id, payment_status, owner_email, dev_email, sent_at, created_at,
       scans ( id, url, url_normalized )`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })

  if (filter !== 'all') {
    q = q.eq('payment_status', filter)
  }

  if (query) {
    // Match owner_email substring. URL search would need cross-table
    // ilike which Supabase JS doesn't support cleanly — admins can use
    // /admin/scans?q=… for URL lookups and follow scan_id links.
    q = q.ilike('owner_email', `%${query}%`)
  }

  const start = (page - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE - 1

  const { data, count, error } = await q.range(start, end)

  if (error) {
    // Most common reason this fires: the briefs table doesn't exist yet
    // because the migration hasn't been applied. Surface a friendly notice
    // instead of crashing the admin panel.
    const msg = error.message?.toLowerCase() ?? ''
    if (
      msg.includes('does not exist') ||
      msg.includes('relation') ||
      msg.includes('briefs')
    ) {
      return { kind: 'table_missing' }
    }
    console.error('[admin/briefs] fetch failed', { error: error.message })
    return { kind: 'ok', rows: [], totalCount: 0 }
  }

  return {
    kind: 'ok',
    rows: (data ?? []) as unknown as BriefRow[],
    totalCount: count ?? 0,
  }
}

// ─── UI sub-components ────────────────────────────────────────────────

function TableMissingNotice() {
  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="font-medium">The briefs table isn&apos;t live yet.</p>
      <p className="mt-2 leading-relaxed">
        Apply migration{' '}
        <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">
          20260428000003_add_briefs.sql
        </code>{' '}
        with{' '}
        <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">
          npx supabase db push
        </code>{' '}
        to create it. Once applied this page will list any briefs that get
        generated.
      </p>
    </div>
  )
}

function SearchBox({
  currentFilter,
  currentQuery,
}: {
  currentFilter: PaymentFilter
  currentQuery: string
}) {
  return (
    <form
      method="get"
      action="/admin/briefs"
      className="mt-6 flex gap-2 sm:max-w-md"
    >
      <input type="hidden" name="payment" value={currentFilter} />
      <input
        type="search"
        name="q"
        defaultValue={currentQuery}
        maxLength={MAX_QUERY_LEN}
        placeholder="Search by owner email…"
        aria-label="Search briefs by owner email"
        className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <button
        type="submit"
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
      >
        Search
      </button>
      {currentQuery && (
        <Link
          href={
            currentFilter === 'all'
              ? '/admin/briefs'
              : `/admin/briefs?payment=${currentFilter}`
          }
          className="self-center text-sm text-zinc-600 hover:text-zinc-900"
        >
          Clear
        </Link>
      )}
    </form>
  )
}

function FilterRow({
  active,
  query,
}: {
  active: PaymentFilter
  query: string
}) {
  return (
    <div
      className="mt-4 flex flex-wrap gap-2"
      role="tablist"
      aria-label="Payment status filter"
    >
      {PAYMENT_FILTERS.map((f) => {
        const isActive = f.key === active
        const qs = buildQuery({ payment: f.key, q: query })
        return (
          <Link
            key={f.key}
            href={`/admin/briefs${qs}`}
            role="tab"
            aria-selected={isActive}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? 'border-brand bg-brand text-white'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            {f.label}
          </Link>
        )
      })}
    </div>
  )
}

function BriefsTable({ rows }: { rows: BriefRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No briefs match the current filters. The brief module isn&apos;t
        live yet — this page will populate once owners start generating
        briefs.
      </div>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3">Site</th>
            <th className="px-4 py-3 hidden sm:table-cell">Business</th>
            <th className="px-4 py-3 hidden md:table-cell">Lang</th>
            <th className="px-4 py-3 hidden lg:table-cell">Owner email</th>
            <th className="px-4 py-3">Payment</th>
            <th className="px-4 py-3 hidden md:table-cell">Sent</th>
            <th className="px-4 py-3 hidden lg:table-cell">Created</th>
            <th className="px-4 py-3 text-right" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => {
            const scanHost = row.scans
              ? displayHost(row.scans.url)
              : '— (scan deleted)'
            return (
              <tr key={row.id} className="text-zinc-700">
                <td className="px-4 py-3 font-medium">{scanHost}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-zinc-600">
                  {row.business_type ?? '—'}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-xs uppercase tracking-wide text-zinc-500">
                  {row.detected_language ?? '—'}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-zinc-600">
                  {row.owner_email ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <PaymentBadge status={row.payment_status} />
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-zinc-600">
                  {row.sent_at ? formatDate(row.sent_at) : '—'}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-zinc-600">
                  {formatDate(row.created_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  {row.scan_id ? (
                    <Link
                      href={`/admin/scans?q=${encodeURIComponent(row.scans?.url_normalized ?? '')}`}
                      className="text-sm font-medium text-brand hover:text-brand-accent"
                    >
                      Scan →
                    </Link>
                  ) : (
                    <span className="text-sm text-zinc-400">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Pagination({
  filter,
  query,
  page,
  totalPages,
}: {
  filter: PaymentFilter
  query: string
  page: number
  totalPages: number
}) {
  const prevQs =
    page > 1
      ? buildQuery({ payment: filter, q: query, page: page - 1 })
      : null
  const nextQs =
    page < totalPages
      ? buildQuery({ payment: filter, q: query, page: page + 1 })
      : null

  return (
    <div className="mt-6 flex items-center justify-between">
      <span className="text-sm text-zinc-600">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <PaginationButton
          href={prevQs ? `/admin/briefs${prevQs}` : null}
          label="← Previous"
        />
        <PaginationButton
          href={nextQs ? `/admin/briefs${nextQs}` : null}
          label="Next →"
        />
      </div>
    </div>
  )
}

function PaginationButton({
  href,
  label,
}: {
  href: string | null
  label: string
}) {
  if (!href) {
    return (
      <span className="cursor-not-allowed rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-400">
        {label}
      </span>
    )
  }
  return (
    <Link
      href={href}
      className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
    >
      {label}
    </Link>
  )
}

function PaymentBadge({ status }: { status: string }) {
  const tone =
    status === 'paid'
      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
      : status === 'failed'
        ? 'bg-red-50 text-red-900 border-red-200'
        : status === 'refunded'
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : 'bg-zinc-50 text-zinc-700 border-zinc-200'
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status}
    </span>
  )
}

// ─── Param helpers ────────────────────────────────────────────────────

function parsePaymentFilter(raw: string | undefined): PaymentFilter {
  switch (raw) {
    case 'paid':
    case 'unpaid':
    case 'refunded':
    case 'failed':
      return raw
    default:
      return 'all'
  }
}

function parseQuery(raw: string | undefined): string {
  if (!raw) return ''
  return raw.trim().slice(0, MAX_QUERY_LEN).toLowerCase()
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function buildQuery(args: {
  payment: PaymentFilter
  q: string
  page?: number
}): string {
  const parts: string[] = []
  if (args.payment !== 'all') parts.push(`payment=${args.payment}`)
  if (args.q) parts.push(`q=${encodeURIComponent(args.q)}`)
  if (args.page && args.page > 1) parts.push(`page=${args.page}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

function displayHost(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
