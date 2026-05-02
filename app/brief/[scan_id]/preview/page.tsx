import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { BriefRenderer } from '@/components/brief/BriefRenderer'
import { BriefPaymentGate } from '@/components/brief/BriefPaymentGate'
import { getLatestBriefForScan } from '@/lib/brief/store'
import { BriefHeader, BriefFooter } from '@/app/brief/[scan_id]/page'

export const metadata: Metadata = {
  title: 'Your developer brief — preview — fixmysite.in',
  description:
    'Preview Bugbite\'s developer brief. Unlock the full version with priority + effort estimates and the not-in-scope list for ₹99.',
  robots: { index: false, follow: false },
}

/**
 * /brief/[scan_id]/preview — paywall page.
 *
 *   - Shows the LATEST brief for this scan (not the latest paid).
 *     Re-submitting the input form replaces what shows here.
 *   - If the latest brief is already paid, redirect to /full so the
 *     owner doesn't see a paywall they've already cleared.
 *   - Renders the brief in 'preview' mode (intent + first section only;
 *     remaining sections show titles but bodies are blurred).
 *   - BriefPaymentGate handles the Razorpay flow + redirect to /full.
 */
export default async function BriefPreviewPage({
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

  const brief = await getLatestBriefForScan(scan_id)

  // No brief generated yet — bounce back to the input form.
  if (!brief || !brief.brief_json) {
    redirect(`/brief/${scan_id}`)
  }

  // Already paid — straight to /full. Refreshing the preview after
  // payment shouldn't make the owner re-encounter the paywall.
  if (brief.payment_status === 'paid') {
    redirect(`/brief/${scan_id}/full`)
  }

  // Defensive: an owner who somehow lost their email between submit
  // and preview can't proceed to payment. Bounce them to re-submit.
  // In practice the input form requires email, so this is rare.
  if (!brief.owner_email) {
    redirect(`/brief/${scan_id}`)
  }

  const displayHost = resolveDisplayHost(scan.url as string)
  const priceRupees = brief.price_paise / 100

  return (
    <div className="flex flex-1 flex-col">
      <BriefHeader scanId={scan_id} />

      <main className="flex-1 bg-zinc-50">
        <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
          <Link
            href={`/brief/${scan_id}`}
            className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Edit your input
          </Link>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Your brief for {displayHost}
          </h1>
          <p className="mt-3 text-base text-zinc-600">
            Bugbite has translated your words into a developer-ready brief.
            Here&apos;s a preview — unlock the full version below.
          </p>

          <div className="mt-8">
            <BriefRenderer brief={brief.brief_json} mode="preview" />
          </div>

          <div className="mt-10">
            <BriefPaymentGate
              briefId={brief.id}
              scanId={scan_id}
              priceRupees={priceRupees}
              ownerEmail={brief.owner_email}
            />
          </div>

          <p className="mt-6 text-xs text-zinc-500">
            Reference: {brief.id}
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
