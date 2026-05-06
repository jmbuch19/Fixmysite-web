import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'For developers — fixmysite.in',
  description:
    'Join the fixmysite.in partner network. Get matched to Indian small-business clients near you. Receive lead notifications, build your reputation.',
}

/**
 * /developer — landing page for the developer side of the marketplace.
 *
 * SPEC §19 calls for three paths from this page:
 *   1. Scan a client site (agency plan)
 *   2. View a report sent to you (token-based)
 *   3. Join the partner network ← only this is wired in v1.0.1
 *
 * Paths 1 and 2 are visible but explicitly labelled "coming soon" so
 * the SPEC structure is preserved without false advertising.
 */
export default function DeveloperLandingPage() {
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

      <main className="flex-1">
        {/* ─── Hero ───────────────────────────────────────────────── */}
        <section className="bg-brand-surface">
          <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand">
              For developers
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl md:text-5xl">
              Bugbite finds the bugs. You fix them.
              <br />
              We make the introduction.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-700 sm:text-xl">
              Indian small-business owners run their websites through
              fixmysite.in to find what is broken. Bugbite reports the
              issues — then matches them to a developer near them who can
              fix it. That could be you.
            </p>
          </div>
        </section>

        {/* ─── Three paths ───────────────────────────────────────── */}
        <section className="bg-white">
          <div className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              Three ways to work with fixmysite.in
            </h2>

            <ul className="mt-10 grid gap-6 lg:grid-cols-3">
              {/* Path 1 — Scan a client site (agency plan, coming soon) */}
              <li className="rounded-xl border border-zinc-200 bg-zinc-50 p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Coming soon
                </p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-900">
                  Scan a client site
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  Run unlimited scans for your agency clients. Bugbite
                  delivers the report to you, branded with your name.
                  Forward to client or use it yourself. ₹999/month.
                </p>
                <p className="mt-3 text-xs text-zinc-500">
                  Agency plan launching after the partner network is live.
                </p>
              </li>

              {/* Path 2 — View a report (token-based, coming soon) */}
              <li className="rounded-xl border border-zinc-200 bg-zinc-50 p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Coming soon
                </p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-900">
                  View a report sent to you
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  A client shared a fixmysite.in report? Enter the access
                  token from the email — you will see the full report and
                  solution map. No payment from you, the owner already
                  paid.
                </p>
                <p className="mt-3 text-xs text-zinc-500">
                  Right now, find the report PDF in the email your client
                  forwarded.
                </p>
              </li>

              {/* Path 3 — Join the partner network ← THE ACTIVE ONE */}
              <li className="rounded-xl border-2 border-brand bg-brand-surface p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand">
                  Open now
                </p>
                <h3 className="mt-2 text-lg font-semibold text-zinc-900">
                  Join the partner network
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                  Get matched to Indian small-business clients near you.
                  Receive lead notifications when work in your city and
                  skills comes in. Build your rating with every job.
                  Free to register.
                </p>
                <Link
                  href="/developer/join"
                  className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-accent"
                >
                  Register free →
                </Link>
              </li>
            </ul>
          </div>
        </section>

        {/* ─── How partner matching works ─────────────────────────── */}
        <section className="bg-brand-surface">
          <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              How partner matching works
            </h2>
            <ol className="mt-8 space-y-6">
              <Step
                n={1}
                title="A site owner runs a scan"
                body="Bugbite finds what's broken — contact form not submitting, SSL expiring, dead links, missing alt text."
              />
              <Step
                n={2}
                title="Owner clicks 'Find a developer' in the report"
                body="Bugbite matches by city first, then by skills the report's findings actually need, then by rating."
              />
              <Step
                n={3}
                title="Bugbite sends you the lead"
                body="Site URL, the city it's in, the issues to fix, the budget signal. Confirm you want it and Bugbite connects you with the owner."
              />
              <Step
                n={4}
                title="Job done — owner rates you, owner pays you"
                body="The client pays you directly per your agreement — fixmysite.in is not a party to the project fee or scope. Star rating + review become part of your profile. Higher rating means more leads. Bugbite's only charge is a ₹200 platform fee per accepted lead."
              />
            </ol>
          </div>
        </section>
      </main>

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
    </div>
  )
}

function Step({
  n,
  title,
  body,
}: {
  n: number
  title: string
  body: string
}) {
  return (
    <li className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
        {n}
      </span>
      <div>
        <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
        <p className="mt-1 text-sm text-zinc-700">{body}</p>
      </div>
    </li>
  )
}
