import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAuthClient, isAdminEmail } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { AdminHeader } from '@/components/admin/AdminHeader'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

type StatusFilter = 'needs_review' | 'all' | 'approved' | 'rejected'

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'needs_review', label: 'Needs review' },
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

type InquiryRow = {
  id: string
  url: string
  url_class: string
  claimed_email: string
  status: string
  manually_approved: boolean
  manually_approved_by: string | null
  quoted_price: number | null
  created_at: string
}

export default async function InquiriesListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const auth = await createAuthClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    redirect('/admin/login')
  }

  const params = await searchParams
  const filter = parseStatusFilter(params.status)
  const page = parsePage(params.page)

  const { rows, totalCount } = await fetchInquiries(filter, page)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const adminEmail = user.email ?? 'admin'

  return (
    <div className="flex flex-1 flex-col">
      <AdminHeader email={adminEmail} />

      <main className="flex-1 bg-zinc-50">
        <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
            >
              ← Dashboard
            </Link>
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            Inquiries
          </h1>
          <p className="mt-2 text-sm text-zinc-700">
            Enterprise, institution, and Complex-tier domain-verified
            inquiries. {totalCount} {totalCount === 1 ? 'row' : 'rows'} in
            current view.
          </p>

          <FilterRow active={filter} />

          <InquiriesTable rows={rows} />

          {totalCount > PAGE_SIZE && (
            <Pagination
              filter={filter}
              page={page}
              totalPages={totalPages}
            />
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

async function fetchInquiries(
  filter: StatusFilter,
  page: number,
): Promise<{ rows: InquiryRow[]; totalCount: number }> {
  const supabase = createServiceClient()

  let query = supabase
    .from('enterprise_inquiries')
    .select(
      'id, url, url_class, claimed_email, status, manually_approved, manually_approved_by, quoted_price, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })

  switch (filter) {
    case 'needs_review':
      query = query
        .eq('status', 'otp_verified')
        .eq('manually_approved', false)
        // Exclude Complex-tier self_serve verifications — auto domain proofs,
        // not actionable items.
        .neq('url_class', 'self_serve')
      break
    case 'approved':
      query = query.eq('status', 'approved')
      break
    case 'rejected':
      query = query.eq('status', 'rejected')
      break
    case 'all':
      break
  }

  const start = (page - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE - 1

  const { data, count } = await query.range(start, end)
  return {
    rows: (data ?? []) as InquiryRow[],
    totalCount: count ?? 0,
  }
}

// ─── UI sub-components ────────────────────────────────────────────────

function FilterRow({ active }: { active: StatusFilter }) {
  return (
    <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Status filter">
      {STATUS_FILTERS.map((f) => {
        const isActive = f.key === active
        return (
          <Link
            key={f.key}
            href={`/admin/inquiries${f.key === 'needs_review' ? '' : `?status=${f.key}`}`}
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

function InquiriesTable({ rows }: { rows: InquiryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No inquiries match the current filter.
      </div>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3">URL</th>
            <th className="px-4 py-3">Class</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 hidden sm:table-cell">Claimed email</th>
            <th className="px-4 py-3 hidden md:table-cell">Quote</th>
            <th className="px-4 py-3 hidden lg:table-cell">Submitted</th>
            <th className="px-4 py-3 text-right" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <tr key={row.id} className="text-zinc-700">
              <td className="px-4 py-3 font-medium">{displayHost(row.url)}</td>
              <td className="px-4 py-3 text-xs">{formatUrlClass(row.url_class)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-3 hidden sm:table-cell text-zinc-600">
                {row.claimed_email}
              </td>
              <td className="px-4 py-3 hidden md:table-cell text-zinc-600 tabular-nums">
                {row.quoted_price ? `₹${(row.quoted_price / 100).toLocaleString('en-IN')}` : '—'}
              </td>
              <td className="px-4 py-3 hidden lg:table-cell text-zinc-600">
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

function Pagination({
  filter,
  page,
  totalPages,
}: {
  filter: StatusFilter
  page: number
  totalPages: number
}) {
  const baseQs =
    filter === 'needs_review' ? '' : `&status=${filter}`
  const prevHref =
    page > 1 ? `/admin/inquiries?page=${page - 1}${baseQs}` : null
  const nextHref =
    page < totalPages ? `/admin/inquiries?page=${page + 1}${baseQs}` : null

  return (
    <div className="mt-6 flex items-center justify-between">
      <span className="text-sm text-zinc-600">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <PaginationButton href={prevHref} label="← Previous" />
        <PaginationButton href={nextHref} label="Next →" />
      </div>
    </div>
  )
}

function PaginationButton({ href, label }: { href: string | null; label: string }) {
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

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'approved'
      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
      : status === 'rejected'
        ? 'bg-red-50 text-red-900 border-red-200'
        : status === 'otp_verified'
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : status === 'converted'
            ? 'bg-zinc-50 text-zinc-700 border-zinc-200'
            : 'bg-zinc-50 text-zinc-700 border-zinc-200'
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status === 'otp_verified' ? 'needs review' : status.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseStatusFilter(raw: string | undefined): StatusFilter {
  switch (raw) {
    case 'all':
    case 'approved':
    case 'rejected':
      return raw
    default:
      return 'needs_review'
  }
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

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
