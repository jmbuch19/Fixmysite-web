import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ScanningView } from '@/components/report/ScanningView'

/**
 * /preview/scanning — unlisted route for previewing the live-scan
 * animation without paying for an actual scan.
 *
 * Renders the exact ScanningView component the report page renders
 * during the 30-90s window between Phase 2 worker pickup and report
 * delivery. Single-source-of-truth import means this preview can never
 * drift from production.
 *
 * Not linked from anywhere in the navigation. Only people who know the
 * URL find it. `robots.noindex` keeps it out of search engines.
 */
export const metadata: Metadata = {
  title: 'Scanning preview — fixmysite.in',
  description: 'Internal preview of the Bugbite scanning experience.',
  robots: { index: false, follow: false },
}

export default function ScanningPreviewPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-5 py-4 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2 transition-opacity hover:opacity-80"
            aria-label="Back to fixmysite.in homepage"
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

      <main className="flex-1 bg-white">
        <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
          {/* Honest framing — this is a preview, not an active scan.
              Customer arriving here by accident immediately understands
              they aren't waiting for a real result. */}
          <div className="mb-8 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
            <strong className="font-semibold text-zinc-800">
              Internal preview.
            </strong>{' '}
            This page shows what the live scanning state looks like —
            without running an actual scan. The narrative cycles every
            three seconds and loops indefinitely.{' '}
            <Link href="/" className="text-brand underline underline-offset-2">
              Back to homepage
            </Link>
            .
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            Your scan of yourbusiness.com
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Small site · 9 pages · started just now
          </p>

          <ScanningView />
        </div>
      </main>

      <footer className="border-t border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-6 text-xs text-zinc-500 sm:px-8">
          <span>fixmysite.in · scanning preview</span>
          <Link href="/" className="hover:text-zinc-900">
            Back home
          </Link>
        </div>
      </footer>
    </div>
  )
}
