import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { BriefInputForm } from '@/components/brief/BriefInputForm'
import { getLatestPaidBriefForScan } from '@/lib/brief/store'

export const metadata: Metadata = {
  title: 'Get a developer brief — fixmysite.in',
  description:
    'Tell Bugbite what you want fixed or added in plain language. Bugbite turns your words into a developer-ready technical brief.',
}

/**
 * /brief/[scan_id] — input form for the brief generator.
 *
 * Server-component shell that:
 *   - Verifies the scan exists and is paid (briefs are gated behind
 *     the paid scan; you can't pay for a brief without first owning
 *     a scan to generate it from)
 *   - Redirects straight to /full if a paid brief already exists for
 *     this scan (no point letting the owner re-generate when they
 *     already paid for one)
 *   - Otherwise renders the input form
 */
export default async function BriefInputPage({
  params,
}: {
  params: Promise<{ scan_id: string }>
}) {
  const { scan_id } = await params

  const supabase = createServiceClient()
  const { data: scan } = await supabase
    .from('scans')
    .select('id, url, payment_status, status')
    .eq('id', scan_id)
    .maybeSingle()

  if (!scan) notFound()
  if (scan.payment_status !== 'paid') {
    // Visiting /brief/<id> for an unpaid scan is a wrong link — bounce
    // them back to the report flow with a friendly explanation.
    redirect(`/scanning/${scan_id}`)
  }

  // If a paid brief already exists for this scan, skip the input form
  // and take them to /full. Re-generating after paying is wasteful and
  // confusing — the latest-paid brief is what they're entitled to see.
  const paidBrief = await getLatestPaidBriefForScan(scan_id)
  if (paidBrief) {
    redirect(`/brief/${scan_id}/full`)
  }

  const displayHost = resolveDisplayHost(scan.url as string)

  return (
    <div className="flex flex-1 flex-col">
      <BriefHeader scanId={scan_id} />

      <main className="flex-1 bg-white">
        <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
          <Link
            href={`/report/${scan_id}/full`}
            className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Back to your report
          </Link>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Get a developer brief for {displayHost}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-700">
            Tell Bugbite what you want fixed or added — in plain language,
            any language. Bugbite turns your words into a precise technical
            brief your developer can quote against. ₹99 to unlock the full
            brief, free preview first.
          </p>

          <div className="mt-8">
            <BriefInputForm scanId={scan_id} />
          </div>
        </div>
      </main>

      <BriefFooter />
    </div>
  )
}

// ─── Shared layout (same as report page header/footer) ────────────────

function BriefHeader({ scanId }: { scanId: string }) {
  return (
    <header className="border-b border-zinc-100 bg-white">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-5 py-4 sm:px-8">
        <Link
          href={`/report/${scanId}/full`}
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
          aria-label="Back to your fixmysite.in report"
        >
          <Image
            src="/brand/logo-mark.png"
            alt=""
            width={397}
            height={294}
            priority
            className="h-7 w-auto mix-blend-multiply"
          />
          <span className="text-lg font-semibold text-brand">
            fixmysite.in
          </span>
        </Link>
      </div>
    </header>
  )
}

function BriefFooter() {
  return (
    <footer className="border-t border-zinc-100 bg-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span>
          © {new Date().getFullYear()} fixmysite.in · Made for Indian
          businesses
        </span>
        <nav className="flex gap-5">
          <Link href="/about-us" className="hover:text-zinc-900">
            About
          </Link>
          <Link href="/privacy" className="hover:text-zinc-900">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-zinc-900">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  )
}

function resolveDisplayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export { BriefHeader, BriefFooter }
