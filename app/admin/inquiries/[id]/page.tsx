import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createAuthClient, isAdminEmail } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { approveInquiry, rejectInquiry } from '../actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Inquiry = {
  id: string
  scan_id: string | null
  url: string
  url_normalized: string
  url_class: string
  claimed_email: string
  email_domain: string
  url_domain: string
  domain_match: boolean
  otp_verified: boolean
  otp_verified_at: string | null
  otp_attempts: number
  manually_approved: boolean
  manually_approved_by: string | null
  status: string
  institution_type: string | null
  quoted_price: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export default async function InquiryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    approved?: string
    rejected?: string
    email_failed?: string
    error?: string
  }>
}) {
  const auth = await createAuthClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    redirect('/admin/login')
  }

  const { id } = await params
  if (!UUID_RE.test(id)) notFound()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('enterprise_inquiries')
    .select(
      'id, scan_id, url, url_normalized, url_class, claimed_email, email_domain, url_domain, domain_match, otp_verified, otp_verified_at, otp_attempts, manually_approved, manually_approved_by, status, institution_type, quoted_price, notes, created_at, updated_at',
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !data) notFound()
  const inquiry = data as Inquiry

  const sp = await searchParams
  const banner = computeBanner(sp, inquiry)

  const adminEmail = user.email ?? 'admin'

  return (
    <div className="flex flex-1 flex-col">
      <AdminHeader email={adminEmail} />

      <main className="flex-1 bg-zinc-50">
        <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-12">
          <Link
            href="/admin/inquiries"
            className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
          >
            ← All inquiries
          </Link>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            {displayHost(inquiry.url)}
          </h1>
          <p className="mt-2 text-sm text-zinc-700">
            {formatUrlClass(inquiry.url_class)} · submitted{' '}
            {formatDate(inquiry.created_at)}
          </p>

          {banner && <Banner {...banner} />}

          <InquiryContext inquiry={inquiry} />

          <ActionSection inquiry={inquiry} />
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

// ─── Banner (success / error after action) ────────────────────────────

type BannerProps = { tone: 'success' | 'error' | 'info'; message: string }

function computeBanner(
  sp: {
    approved?: string
    rejected?: string
    email_failed?: string
    error?: string
  },
  inquiry: Inquiry,
): BannerProps | null {
  const emailFailed = sp.email_failed === '1'

  if (sp.approved === '1') {
    const price = inquiry.quoted_price
      ? formatPrice(inquiry.quoted_price)
      : 'an unset amount'
    if (emailFailed) {
      return {
        tone: 'error',
        message: `Inquiry approved at ${price}. ⚠ Notification email to ${inquiry.claimed_email} FAILED to send — follow up manually. Check server logs for the Resend error.`,
      }
    }
    return {
      tone: 'success',
      message: `Inquiry approved at ${price}. Claimant notified by email at ${inquiry.claimed_email}.`,
    }
  }
  if (sp.rejected === '1') {
    if (emailFailed) {
      return {
        tone: 'error',
        message: `Inquiry rejected. ⚠ Notification email to ${inquiry.claimed_email} FAILED to send — follow up manually. Check server logs for the Resend error.`,
      }
    }
    return {
      tone: 'info',
      message: `Inquiry rejected. Claimant notified by email at ${inquiry.claimed_email} with the reason from notes.`,
    }
  }
  switch (sp.error) {
    case 'invalid_input':
      return {
        tone: 'error',
        message:
          'Form data was invalid. Check the price (₹99–₹1,000,000) and any required fields, then try again.',
      }
    case 'db_failed':
      return {
        tone: 'error',
        message:
          'Database update failed. Try again, or check Supabase logs if it persists.',
      }
    case 'stale_state':
      return {
        tone: 'error',
        message:
          'This inquiry was already approved or rejected since the page was loaded. Refresh to see the current state.',
      }
    default:
      return null
  }
}

function Banner({ tone, message }: BannerProps) {
  const cls =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-900'
        : 'border-zinc-200 bg-zinc-50 text-zinc-900'
  return (
    <div className={`mt-6 rounded-xl border p-4 text-sm ${cls}`} role="status">
      {message}
    </div>
  )
}

// ─── Inquiry context (read-only) ─────────────────────────────────────

function InquiryContext({ inquiry }: { inquiry: Inquiry }) {
  return (
    <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">Inquiry context</h2>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <Field label="URL">
          <a
            href={inquiry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline hover:text-brand-accent"
          >
            {inquiry.url}
          </a>
        </Field>
        <Field label="Normalised URL">
          <span className="font-mono text-xs text-zinc-700">
            {inquiry.url_normalized}
          </span>
        </Field>
        <Field label="Class">{formatUrlClass(inquiry.url_class)}</Field>
        <Field label="Status">
          <StatusBadge status={inquiry.status} />
        </Field>
        <Field label="Claimed email">
          <span className="text-zinc-700">{inquiry.claimed_email}</span>
        </Field>
        <Field label="Domain match">
          <span className="text-zinc-700">
            {inquiry.email_domain}
            {' vs '}
            {inquiry.url_domain}
            {inquiry.domain_match ? ' ✓' : ' ✗'}
          </span>
        </Field>
        <Field label="OTP">
          {inquiry.otp_verified ? (
            <span className="text-emerald-900">
              Verified
              {inquiry.otp_verified_at &&
                ` on ${formatDate(inquiry.otp_verified_at)}`}
            </span>
          ) : (
            <span className="text-amber-900">
              Not verified ({inquiry.otp_attempts}/3 attempts)
            </span>
          )}
        </Field>
        {inquiry.scan_id && (
          <Field label="Linked scan">
            <Link
              href={`/scanning/${inquiry.scan_id}`}
              className="text-brand underline hover:text-brand-accent"
            >
              {inquiry.scan_id.slice(0, 8)}…
            </Link>
          </Field>
        )}
        {inquiry.institution_type && (
          <Field label="Institution type">
            {formatInstitutionType(inquiry.institution_type)}
          </Field>
        )}
        {inquiry.quoted_price !== null && (
          <Field label="Quoted price">
            <span className="font-medium text-zinc-900 tabular-nums">
              {formatPrice(inquiry.quoted_price)}
            </span>
          </Field>
        )}
        {inquiry.manually_approved_by && (
          <Field label="Reviewed by">
            <span className="text-zinc-700">{inquiry.manually_approved_by}</span>
            <span className="ml-1 text-zinc-500">
              ({formatDate(inquiry.updated_at)})
            </span>
          </Field>
        )}
        {inquiry.notes && (
          <div className="sm:col-span-2">
            <Field label="Notes">
              <p className="whitespace-pre-wrap text-zinc-700">
                {inquiry.notes}
              </p>
            </Field>
          </div>
        )}
      </dl>
    </section>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  )
}

// ─── Action section — branches by inquiry state ──────────────────────

function ActionSection({ inquiry }: { inquiry: Inquiry }) {
  // Self-serve (Complex-tier) — domain-verification proof, no admin action.
  if (inquiry.url_class === 'self_serve') {
    return (
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">
          No admin action required
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-700">
          This is a Complex-tier domain-ownership proof. The user has
          already proved they manage{' '}
          <strong>{inquiry.url_domain}</strong> and can proceed to pay
          ₹349 for the scan. Nothing for you to do here — the inquiry
          exists for the audit trail.
        </p>
      </section>
    )
  }

  if (inquiry.status === 'pending') {
    return (
      <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold text-amber-900">
          Awaiting OTP verification
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-amber-900">
          The claimant hasn&apos;t entered the 6-digit code yet, or the
          OTP send failed. Approve/reject becomes available after
          verification.
        </p>
      </section>
    )
  }

  if (inquiry.status === 'approved') {
    return (
      <section className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">
          Approved at {formatPrice(inquiry.quoted_price ?? 0)}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-emerald-900">
          {inquiry.manually_approved_by
            ? `Approved by ${inquiry.manually_approved_by} on ${formatDate(inquiry.updated_at)}.`
            : `Approved on ${formatDate(inquiry.updated_at)}.`}
          {' '}The claimant should receive a follow-up with the quote and
          payment instructions (manual for now).
        </p>
      </section>
    )
  }

  if (inquiry.status === 'rejected') {
    return (
      <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-semibold text-red-900">Rejected</h2>
        <p className="mt-3 text-sm leading-relaxed text-red-900">
          {inquiry.manually_approved_by
            ? `Rejected by ${inquiry.manually_approved_by} on ${formatDate(inquiry.updated_at)}.`
            : `Rejected on ${formatDate(inquiry.updated_at)}.`}
        </p>
        {inquiry.notes && (
          <p className="mt-3 text-sm text-red-900 whitespace-pre-wrap">
            <strong>Reason:</strong> {inquiry.notes}
          </p>
        )}
      </section>
    )
  }

  if (inquiry.status === 'converted') {
    return (
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">
          Converted to a paid scan
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-700">
          The claimant paid the quoted amount and a scan was started.
        </p>
      </section>
    )
  }

  // Default: status === 'otp_verified', not yet approved/rejected. Show forms.
  return (
    <>
      <ApproveForm inquiry={inquiry} />
      <RejectForm inquiry={inquiry} />
    </>
  )
}

// ─── Approve form ─────────────────────────────────────────────────────

function ApproveForm({ inquiry }: { inquiry: Inquiry }) {
  const isInstitution = inquiry.url_class === 'institution'

  return (
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        Approve and set quote
      </h2>
      <p className="mt-2 text-sm text-zinc-700">
        Approving sets the price and marks the inquiry ready for follow-up.
      </p>
      <form action={approveInquiry} className="mt-5 space-y-4">
        <input type="hidden" name="inquiry_id" value={inquiry.id} />

        <div>
          <label
            htmlFor="quoted_price_rupees"
            className="text-sm font-medium text-zinc-900"
          >
            Quote (₹)
          </label>
          <input
            id="quoted_price_rupees"
            name="quoted_price_rupees"
            type="number"
            inputMode="numeric"
            min={99}
            max={1000000}
            step={1}
            required
            placeholder={isInstitution ? '999' : '14999'}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-base text-zinc-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand sm:max-w-xs"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Whole rupees. Stored as paise internally (×100).
          </p>
        </div>

        {isInstitution && (
          <div>
            <label
              htmlFor="institution_type"
              className="text-sm font-medium text-zinc-900"
            >
              Institution type
            </label>
            <select
              id="institution_type"
              name="institution_type"
              required
              defaultValue=""
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-base text-zinc-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand sm:max-w-xs"
            >
              <option value="" disabled>
                Select…
              </option>
              <option value="ngo">NGO / Non-profit (~₹999)</option>
              <option value="college">College (~₹2,999)</option>
              <option value="university">University (~₹2,999)</option>
              <option value="government">Government body (~₹4,999)</option>
              <option value="research">Research institute (~₹2,999)</option>
            </select>
          </div>
        )}

        <div>
          <label
            htmlFor="approve_notes"
            className="text-sm font-medium text-zinc-900"
          >
            Notes (optional)
          </label>
          <textarea
            id="approve_notes"
            name="notes"
            rows={3}
            maxLength={2000}
            placeholder="Internal notes — scope, contact details, follow-up plan…"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent"
        >
          Approve and set price
        </button>
      </form>
    </section>
  )
}

// ─── Reject form ──────────────────────────────────────────────────────

function RejectForm({ inquiry }: { inquiry: Inquiry }) {
  return (
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">Reject</h2>
      <p className="mt-2 text-sm text-zinc-700">
        Rejecting closes the inquiry. The reason you write here is the
        only paper trail — be specific.
      </p>
      <form action={rejectInquiry} className="mt-5 space-y-4">
        <input type="hidden" name="inquiry_id" value={inquiry.id} />

        <div>
          <label
            htmlFor="reject_notes"
            className="text-sm font-medium text-zinc-900"
          >
            Rejection reason
          </label>
          <textarea
            id="reject_notes"
            name="notes"
            rows={3}
            required
            minLength={1}
            maxLength={2000}
            placeholder="e.g. claimant could not provide proof of authority over the domain"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg border border-red-300 bg-white px-5 py-3 text-base font-medium text-red-700 transition-colors hover:bg-red-50"
        >
          Reject inquiry
        </button>
      </form>
    </section>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'approved'
      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
      : status === 'rejected'
        ? 'bg-red-50 text-red-900 border-red-200'
        : status === 'otp_verified'
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : 'bg-zinc-50 text-zinc-700 border-zinc-200'
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status === 'otp_verified' ? 'needs review' : status.replace(/_/g, ' ')}
    </span>
  )
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

function formatInstitutionType(t: string): string {
  switch (t) {
    case 'ngo':
      return 'NGO / Non-profit'
    case 'college':
      return 'College'
    case 'university':
      return 'University'
    case 'government':
      return 'Government body'
    case 'research':
      return 'Research institute'
    default:
      return t
  }
}

function formatPrice(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
