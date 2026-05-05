import Image from 'next/image'
import Link from 'next/link'
import { ScanForm } from '@/components/scan/ScanForm'
import { formatCounter, getServiceCounters } from '@/lib/stats/serviceCounters'

const CHECKS = [
  {
    title: 'Contact that works',
    body: 'Bugbite verifies every phone number, email, and WhatsApp link actually reaches you.',
  },
  {
    title: 'Every link, every page',
    body: 'Bugbite walks your whole site and flags links that go nowhere.',
  },
  {
    title: 'SSL and security',
    body: 'Padlock real? Certificate about to expire? Bugbite catches both.',
  },
  {
    title: 'Mobile readability',
    body: 'Bugbite reads your site on a phone the way your customers do — tap targets, font sizes, layout.',
  },
  {
    title: 'Placeholder content',
    body: 'Bugbite spots lorem ipsum, "coming soon" pages, and leftover sample text.',
  },
  {
    title: 'Trust signals',
    body: 'Bugbite checks reviews, testimonials, and that your address is the same on every page.',
  },
]

export default async function Home() {
  const counters = await getServiceCounters()

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-5 py-4 sm:px-8">
          <Image
            src="/brand/logo-mark.png"
            alt=""
            width={397}
            height={294}
            priority
            className="h-7 w-auto mix-blend-multiply"
          />
          <span className="text-lg font-semibold text-brand">fixmysite.in</span>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-surface">
          <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
            {/* Hero logo composite — cat + FIXMYSITE.IN + tagline.
                Sized restrained so the H1 leads the page; logo
                supports rather than dominates. mix-blend-multiply
                merges the white file background with the mint
                surface — without it you get a hard white rectangle. */}
            <div className="flex justify-center">
              <Image
                src="/brand/logo-light.png"
                alt="fixmysite.in — your website, finally well-behaved."
                width={1414}
                height={560}
                priority
                sizes="(max-width: 640px) 70vw, 320px"
                className="h-auto w-full max-w-[240px] mix-blend-multiply sm:max-w-[320px]"
              />
            </div>

            <h1 className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl md:text-5xl">
              Bugbite finds what&apos;s broken on your website — before your customers do.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-700 sm:text-xl">
              Phone numbers that don&apos;t ring. Links that go nowhere. Forms
              that lose enquiries. Bugbite reads your site the way your
              customer does, then tells you exactly what to fix — in plain
              language, no developer-speak.
            </p>

            <div className="mt-8">
              <ScanForm />
            </div>

            <ul className="mt-5 flex flex-col gap-2 text-sm text-zinc-700 sm:flex-row sm:gap-6">
              <li>Free 30-second check</li>
              <li>No signup or login</li>
              <li>Built for Indian small businesses</li>
            </ul>
            {/* Soft hint that international rollout is on the roadmap.
                See memory/international_rollout_plan.md for the full
                plan; surfaced here so non-IN visitors who land on the
                hero see they're not unwelcome — just early. The
                mailto link lets them surface themselves; pre-filled
                subject means international pings sort cleanly in the
                inbox without needing a contact form. */}
            <p className="mt-2 text-xs italic text-zinc-500">
              Bugbite ventures abroad soon — say hi at{' '}
              <a
                href="mailto:hello@fixmysite.in?subject=Scanning%20from%20outside%20India"
                className="font-medium text-brand underline underline-offset-2 hover:text-brand-accent"
              >
                hello@fixmysite.in
              </a>{' '}
              if you&apos;re scanning from outside India.
            </p>
          </div>
        </section>

        {/* Service-to-date counters — only renders once any one of the
            three service streams clears its visibility floor. Numbers
            are paid+complete service deliveries only (no in-flight
            scans, no draft blueprints). Cached 24h, refreshed via
            revalidateTag('service-counters') from each delivery point.
            See lib/stats/serviceCounters.ts. */}
        {counters && (
          <section className="border-y border-zinc-100 bg-white">
            <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand">
                Bugbite to date
              </p>
              <h2 className="mt-2 max-w-2xl text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
                Real Indian businesses, real service delivered.
              </h2>

              <ul className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-6">
                <li className="rounded-2xl border border-zinc-100 bg-brand-surface p-6 sm:p-8">
                  <p className="text-4xl font-semibold tracking-tight text-brand sm:text-5xl">
                    {formatCounter(counters.audited)}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                    Websites audited
                  </p>
                </li>
                <li className="rounded-2xl border border-zinc-100 bg-brand-surface p-6 sm:p-8">
                  <p className="text-4xl font-semibold tracking-tight text-brand sm:text-5xl">
                    {formatCounter(counters.blueprints)}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                    Blueprints generated
                  </p>
                </li>
                <li className="rounded-2xl border border-zinc-100 bg-brand-surface p-6 sm:p-8">
                  <p className="text-4xl font-semibold tracking-tight text-brand sm:text-5xl">
                    {formatCounter(counters.briefs)}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                    Developer briefs delivered
                  </p>
                </li>
              </ul>
            </div>
          </section>
        )}

        {/* Second door — visitors without a website yet (or a stale one
            they want to replace). Used to be a "notify me when launched"
            waitlist, but the Blueprint Engine is shipped — point people
            at the live wizard instead. Ghost-style button keeps it
            visually subordinate to the primary "Scan my site" CTA above. */}
        <section className="border-y border-zinc-100 bg-white">
          <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <div className="max-w-md">
                <p className="text-base font-semibold text-zinc-900">
                  No website yet, or one you want to replace?
                </p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                  Answer seven short questions. Bugbite writes a tailored
                  website blueprint — what kind of site fits, the right
                  technology, the right budget, and a step-by-step plan.
                </p>
              </div>
              <div className="sm:flex-shrink-0">
                <Link
                  href="/plan"
                  className="inline-flex items-center justify-center rounded-lg border border-brand bg-transparent px-5 py-2.5 text-base font-medium text-brand transition-colors hover:bg-brand-surface"
                >
                  Plan a website →
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* What we check */}
        <section className="bg-white">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              Bugbite checks what your customers actually experience
            </h2>
            <p className="mt-3 max-w-2xl text-base text-zinc-600">
              No technical scores. Bugbite hunts for the real problems that
              lose you calls, messages, and walk-ins.
            </p>

            <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {CHECKS.map((check) => (
                <li
                  key={check.title}
                  className="rounded-xl border border-zinc-100 bg-zinc-50 p-5"
                >
                  <h3 className="text-base font-semibold text-zinc-900">
                    {check.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                    {check.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works — two doors side by side. Mirrored 3-step
            structure across both columns so the parallel reads cleanly:
            cheap entry → paid unlock → use yourself or hand off.
            Stacks on mobile, two columns from sm. When the third door
            (Spark Report) ships, switch to lg:grid-cols-3 and add the
            third column. */}
        <section className="bg-brand-surface">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              How it works
            </h2>
            <p className="mt-3 text-base text-zinc-700">
              Two doors. Same Bugbite. Pick whichever fits where you are.
            </p>

            <div className="mt-10 grid gap-10 sm:grid-cols-2 sm:gap-8">
              {/* Door 1 — Scan an existing site */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-brand">
                  Scan an existing site
                </h3>
                <p className="mt-1 text-base font-semibold text-zinc-900">
                  You already have a website
                </p>
                <ol className="mt-6 space-y-6">
                  <li className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                      1
                    </span>
                    <div>
                      <h4 className="text-base font-semibold text-zinc-900">
                        Paste your website URL
                      </h4>
                      <p className="mt-1 text-sm text-zinc-700">
                        Bugbite shows the biggest issues right away — free,
                        in 30 seconds.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                      2
                    </span>
                    <div>
                      <h4 className="text-base font-semibold text-zinc-900">
                        Get the full report for ₹49
                      </h4>
                      <p className="mt-1 text-sm text-zinc-700">
                        Bugbite hands you the full findings with a
                        step-by-step fix list, ordered by what matters most.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                      3
                    </span>
                    <div>
                      <h4 className="text-base font-semibold text-zinc-900">
                        Fix it yourself or send it to your developer
                      </h4>
                      <p className="mt-1 text-sm text-zinc-700">
                        Plain-language actions from Bugbite. PDF report you
                        can email to whoever builds your site.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              {/* Door 2 — Plan a new site */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-brand">
                  Plan a new site
                </h3>
                <p className="mt-1 text-base font-semibold text-zinc-900">
                  You don&apos;t have a website yet
                </p>
                <ol className="mt-6 space-y-6">
                  <li className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                      1
                    </span>
                    <div>
                      <h4 className="text-base font-semibold text-zinc-900">
                        Answer seven short questions
                      </h4>
                      <p className="mt-1 text-sm text-zinc-700">
                        Bugbite asks about your business in plain language —
                        free, about two minutes.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                      2
                    </span>
                    <div>
                      <h4 className="text-base font-semibold text-zinc-900">
                        Get the full blueprint for ₹99
                      </h4>
                      <p className="mt-1 text-sm text-zinc-700">
                        What kind of site fits, the right technology, the
                        right budget, and a step-by-step plan to get there.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                      3
                    </span>
                    <div>
                      <h4 className="text-base font-semibold text-zinc-900">
                        Build it yourself or hand it to a developer
                      </h4>
                      <p className="mt-1 text-sm text-zinc-700">
                        Bugbite emails the PDF blueprint. Share it with any
                        developer — they will know exactly what to build.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} fixmysite.in · Made for Indian businesses</span>
          <nav className="flex flex-wrap gap-5">
            <Link href="/developer" className="hover:text-zinc-900">
              For developers
            </Link>
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
