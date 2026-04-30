import Link from 'next/link'

export const metadata = {
  title: 'Institution scanning — fixmysite.in',
  description:
    'Special website health scans for educational, government, and NGO institutions in India.',
}

// Stub page. Real institution-tier landing + pricing + OTP flow lives in
// Step 7+. This page exists so /components/scan/InstitutionUpsell.tsx's
// "Learn more →" link doesn't 404.
export default function InstitutionPage() {
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
        <div className="mx-auto w-full max-w-2xl px-5 py-16 sm:px-8 sm:py-20">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Institution scanning
          </h1>
          <p className="mt-5 text-base leading-relaxed text-zinc-700">
            We&apos;re preparing dedicated reports for educational and
            government websites — including accessibility audits,
            department-level checks, and admission / grievance workflow
            review.
          </p>
          <p className="mt-3 text-base leading-relaxed text-zinc-700">
            Verification is via your institution&apos;s own domain email.
          </p>
          <p className="mt-3 text-base leading-relaxed text-zinc-700">
            <a
              href="mailto:hello@fixmysite.in"
              className="text-brand underline"
            >
              Contact us for institution pricing →
            </a>
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 py-3 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Back to home
          </Link>
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
