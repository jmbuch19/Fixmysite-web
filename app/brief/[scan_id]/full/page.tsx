import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { BriefRenderer } from '@/components/brief/BriefRenderer'
import { getLatestPaidBriefForScan } from '@/lib/brief/store'
import { BriefHeader, BriefFooter } from '@/app/brief/[scan_id]/page'

export const metadata: Metadata = {
  title: 'Your developer brief — fixmysite.in',
  description: 'Your full developer brief from fixmysite.in.',
  robots: { index: false, follow: false },
}

/**
 * /brief/[scan_id]/full — post-payment full brief.
 *
 *   - Loads the LATEST PAID brief for this scan (so a freshly
 *     generated unpaid brief never replaces a paid one the owner
 *     is entitled to see).
 *   - If no paid brief exists, bounce to /preview where the latest
 *     brief (paid or not) is shown with the paywall.
 *   - Renders in 'full' mode — every section, recommendations, and
 *     the not-in-scope list visible.
 *
 * The download-PDF and send-to-developer actions ship in slice 2.3.
 * For 2.2 the page is read-only — owners can scroll through, copy
 * text, screenshot, or wait for the email Bugbite will send once
 * 2.3's email integration is wired into the verify route.
 */
export default async function BriefFullPage({
  params,
}: {
  params: Promise<{ scan_id: string }>
}) {
  const { scan_id } = await params

  const supabase = createServiceClient()
  const { data: scan } = await supabase
    .from('scans')
    .select('id, url, payment_status')
    .eq('id', scan_id)
    .maybeSingle()

  if (!scan) notFound()
  if (scan.payment_status !== 'paid') {
    redirect(`/scanning/${scan_id}`)
  }

  const brief = await getLatestPaidBriefForScan(scan_id)

  // No paid brief yet — bounce to preview where they can pay, or
  // back to input if they haven't generated anything.
  if (!brief || !brief.brief_json) {
    redirect(`/brief/${scan_id}/preview`)
  }

  const displayHost = resolveDisplayHost(scan.url as string)
  const priceRupees = brief.price_paise / 100

  return (
    <div className="flex flex-1 flex-col">
      <BriefHeader scanId={scan_id} />

      <main className="flex-1 bg-zinc-50">
        <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
          {/* Confirmation strip — same warm tone as the report's
              "Payment received" strip so the owner immediately sees
              they're past the paywall. */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-900">
            ✓ Payment received — your brief is unlocked
          </div>

          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Your developer brief — {displayHost}
          </h1>
          <p className="mt-3 text-base text-zinc-600">
            Hand this to your developer. Every section quotes your own
            words, gives a precise spec, and includes a realistic effort
            estimate. The &ldquo;not in scope&rdquo; list at the bottom
            sets the project boundary.
          </p>

          {/* TODO(slice 2.3): action bar with Download PDF + Send to
              developer. For 2.2 the brief is read-only on screen. The
              email-on-verify will land at the same time so owners get
              the PDF in their inbox automatically. */}

          <div className="mt-8">
            <BriefRenderer brief={brief.brief_json} mode="full" />
          </div>

          <div className="mt-10 rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
            <p>
              <span className="font-semibold text-zinc-900">Coming soon:</span>{' '}
              download as PDF and send straight to your developer&apos;s
              email. For now, you can scroll, screenshot, or copy any
              section — and Bugbite will email you the formatted PDF as
              soon as that feature ships next.
            </p>
          </div>

          <p className="mt-6 text-xs text-zinc-400">
            Reference: {brief.id} · Paid ₹{priceRupees}
          </p>
        </div>
      </main>

      <BriefFooter />
    </div>
  )
}

function resolveDisplayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
