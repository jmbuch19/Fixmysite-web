import Link from 'next/link'

/**
 * Shown on the homepage when the URL classifier returns 'institution'.
 * Replaces the scan form inline (no redirect) — owners of educational /
 * government / NGO sites land on a dedicated cross-sell instead of the
 * standard ₹49 self-serve flow. No DB row is created at this stage.
 *
 * "Try a different URL" calls back to ScanForm's handleStartOver, which
 * clears the input and resets the form to idle.
 */
export function InstitutionUpsell({
  hostname,
  onStartOver,
}: {
  hostname: string
  onStartOver: () => void
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        {hostname} looks like an institution
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-700">
        This looks like an educational or government website. We offer
        special scanning packages for institutions — accessibility audits,
        department-by-department checks, and admission-form workflow review.
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          href="/institution"
          className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent"
        >
          Learn more →
        </Link>
        <button
          type="button"
          onClick={onStartOver}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 py-3 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          Try a different URL
        </button>
      </div>
    </div>
  )
}
