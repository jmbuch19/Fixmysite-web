import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Plan a website — fixmysite.in',
  description:
    'Bugbite plans a website that fits your business. Cascading questions in plain language, a reasoned recommendation in your inbox — Indian context, real budgets, real tools.',
}

/**
 * /plan — landing page for the second door.
 *
 * fixmysite.in has two doors:
 *   /scan ← already have a site, find what's broken
 *   /plan ← no website yet, get a tailored recommendation
 *
 * This page surfaces both choices so an owner who landed here by
 * accident can find their way to the scan flow without backtracking.
 * Both options visible above the fold; neither dominates.
 */
export default function PlanLandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <PlanHeader />

      <main className="flex-1">
        {/* ─── Hero ─────────────────────────────────────────────── */}
        <section className="bg-brand-surface">
          <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand">
              Website planning
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl md:text-5xl">
              Bugbite plans a website that fits your business.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-700 sm:text-xl">
              Not a template. Not a guess. A reasoned recommendation —
              what kind of website you need, what it should cost, who
              should build it, and why the alternatives are wrong for you.
            </p>
          </div>
        </section>

        {/* ─── Two doors ────────────────────────────────────────── */}
        <section className="bg-white">
          <div className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              What would you like to do today?
            </h2>
            <p className="mt-3 max-w-2xl text-base text-zinc-600">
              Two doors. Same Bugbite. Pick whichever fits where you are
              right now.
            </p>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              {/* Door 1 — already have a site → /scan / homepage */}
              <article className="rounded-xl border border-zinc-200 bg-zinc-50 p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  You already have a website
                </p>
                <h3 className="mt-2 text-xl font-semibold text-zinc-900">
                  Check what&apos;s broken on your site
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  Bugbite scans every page, finds the issues that lose
                  you customers, and writes a plain-language report your
                  developer can act on. ₹49 for the full report.
                </p>
                <ul className="mt-4 space-y-1.5 text-sm text-zinc-700">
                  <li className="flex gap-2">
                    <span aria-hidden className="text-brand">
                      ✓
                    </span>
                    <span>Free 30-second preview</span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden className="text-brand">
                      ✓
                    </span>
                    <span>Phone numbers, links, SSL, content checks</span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden className="text-brand">
                      ✓
                    </span>
                    <span>Solution map ordered by what to fix first</span>
                  </li>
                </ul>
                <Link
                  href="/"
                  className="mt-5 inline-flex items-center justify-center rounded-lg border border-brand bg-transparent px-5 py-2.5 text-sm font-medium text-brand transition-colors hover:bg-brand-surface"
                >
                  Scan my existing site →
                </Link>
              </article>

              {/* Door 2 — no website yet → /plan/questions */}
              <article className="rounded-xl border-2 border-brand bg-brand-surface p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand">
                  You don&apos;t have a website yet
                </p>
                <h3 className="mt-2 text-xl font-semibold text-zinc-900">
                  Get a website blueprint Bugbite writes for you
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                  Answer a few questions about your business — Bugbite
                  recommends the right kind of website, the right
                  technology, the right budget, and a step-by-step plan
                  for how to get there.
                </p>
                <ul className="mt-4 space-y-1.5 text-sm text-zinc-800">
                  <li className="flex gap-2">
                    <span aria-hidden className="text-brand">
                      ✓
                    </span>
                    <span>Cascading questions in plain language</span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden className="text-brand">
                      ✓
                    </span>
                    <span>Indian context — real tools, real prices</span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden className="text-brand">
                      ✓
                    </span>
                    <span>
                      Why this kind of site is right and the others are wrong
                    </span>
                  </li>
                </ul>
                <Link
                  href="/plan/questions"
                  className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-accent"
                >
                  Start the questions →
                </Link>
              </article>
            </div>
          </div>
        </section>
      </main>

      <PlanFooter />
    </div>
  )
}

// ─── Shared layout ─────────────────────────────────────────────────────

export function PlanHeader() {
  return (
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
  )
}

export function PlanFooter() {
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
