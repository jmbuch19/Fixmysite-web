'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  BlueprintGetResponse,
} from '@/app/api/blueprint/[id]/route'
import type { BlueprintOutput } from '@/lib/claude/blueprint'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'redirecting' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready'
      businessName: string | null
      ownerName: string | null
      blueprint: BlueprintOutput
    }

/**
 * Renders the paid full blueprint at /plan/blueprint/[id]/full.
 *
 * Auth model: relies on /api/blueprint/[id] returning `full: null`
 * when payment_status !== 'paid'. If `full` is null we redirect back
 * to the preview page (where the paywall lives) — no client-side
 * gate to bypass.
 *
 * Slice 2.3 will mount the action bar (Download PDF + Send to
 * developer) below this content. Layout intentionally leaves room.
 */
export function BlueprintFull({ blueprintId }: { blueprintId: string }) {
  const router = useRouter()
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const startedRef = useRef(false)

  useEffect(() => {
    // startedRef alone is enough to dedupe React StrictMode's dev
    // double-invocation. We deliberately do NOT pair it with a
    // `cancelled` flag — the StrictMode cleanup would flip the flag
    // before the first effect's fetch resolves, the second effect is
    // rejected by startedRef, and setState would be skipped forever
    // (spinner stuck). React 18+ tolerates setState on an "unmounted"
    // tree, so just letting setState fire is the safer pattern.
    if (startedRef.current) return
    startedRef.current = true

    async function load() {
      try {
        const res = await fetch(`/api/blueprint/${blueprintId}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          throw new Error(`fetch ${res.status}`)
        }
        const data = (await res.json()) as BlueprintGetResponse

        if (!data.full) {
          // Either not paid, not generated yet, or vanished. The preview
          // page handles all three cases — generate-on-demand and the
          // paywall both live there.
          setState({ phase: 'redirecting' })
          router.replace(`/plan/blueprint/${blueprintId}`)
          return
        }

        setState({
          phase: 'ready',
          businessName: data.business_name,
          ownerName: data.owner_name,
          blueprint: data.full,
        })
      } catch {
        setState({
          phase: 'error',
          message:
            'Could not load your blueprint. Refresh in a moment, or email hello@fixmysite.in.',
        })
      }
    }

    load()
  }, [blueprintId, router])

  if (state.phase === 'loading' || state.phase === 'redirecting') {
    return <Loader phase={state.phase} />
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm leading-relaxed text-red-900">
          {state.message}
        </p>
      </div>
    )
  }

  return (
    <FullBody
      blueprintId={blueprintId}
      businessName={state.businessName}
      ownerName={state.ownerName}
      blueprint={state.blueprint}
    />
  )
}

// ─── Loader ────────────────────────────────────────────────────────────

function Loader({ phase }: { phase: 'loading' | 'redirecting' }) {
  // Owners arriving here have just paid ₹99 — the moment deserves more
  // than a generic spinner. Lead with a payment-confirmed badge so they
  // see the money landed before the content loads, then a Bugbite-voiced
  // line so the page feels continuous with the gate's "unlocking…" copy.
  const message =
    phase === 'redirecting'
      ? 'Bugbite is sending you to the right place…'
      : 'Bugbite is unlocking your blueprint…'

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white">
        <span aria-hidden>✓</span>
        Payment confirmed
      </span>
      <div
        aria-hidden
        className="mx-auto mt-5 h-8 w-8 animate-spin rounded-full border-2 border-emerald-200 border-t-brand"
      />
      <p className="mt-4 text-sm leading-relaxed text-emerald-900">
        {message}
      </p>
    </div>
  )
}

// ─── Body ──────────────────────────────────────────────────────────────

function FullBody({
  blueprintId,
  businessName,
  ownerName,
  blueprint,
}: {
  blueprintId: string
  businessName: string | null
  ownerName: string | null
  blueprint: BlueprintOutput
}) {
  const subjectName = businessName ?? 'your business'
  return (
    <article className="space-y-10">
      {/* Header */}
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">
          Your blueprint
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl">
          {ownerName ? `${ownerName.split(' ')[0]}, ` : ''}here is the
          full plan for{' '}
          <span className="text-brand">{subjectName}</span>.
        </h1>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white">
            {blueprint.recommendation_label}
          </span>
          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700">
            Timeline: {blueprint.timeline_days}
          </span>
          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700">
            Budget: {blueprint.budget_range}
          </span>
        </div>
      </header>

      {/* What we understood */}
      <Section label="What Bugbite understood">
        <p className="text-base leading-relaxed text-zinc-800">
          {blueprint.understood}
        </p>
      </Section>

      {/* Why right */}
      <Section label="Why this is right for you">
        <List items={blueprint.why_right} bullet="✓" tone="positive" />
      </Section>

      {/* Why not alternatives */}
      <Section label="Why simpler or more complex would not work">
        <List
          items={blueprint.why_not_alternative}
          bullet="✗"
          tone="negative"
        />
      </Section>

      {/* Pages needed */}
      <Section label="Pages your site needs">
        <ol className="space-y-4">
          {blueprint.pages_needed.map((page, i) => (
            <li
              key={`${page.name}-${i}`}
              className="rounded-lg border border-zinc-200 bg-white p-4"
            >
              <p className="text-sm font-semibold text-zinc-900">
                {i + 1}. {page.name}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-700">
                {page.purpose}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Features needed / not needed (two columns on sm+) */}
      <Section label="Features">
        <div className="grid gap-6 sm:grid-cols-2">
          <FeatureColumn
            title="What to build"
            items={blueprint.features_needed}
            tone="positive"
          />
          <FeatureColumn
            title="What to skip"
            items={blueprint.features_not_needed}
            tone="negative"
          />
        </div>
      </Section>

      {/* Technology */}
      <Section label="Technology suggestion">
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <p className="text-base font-semibold text-zinc-900">
            {blueprint.technology.platform}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-700">
            {blueprint.technology.reason}
          </p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Hosting
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-700">
            {blueprint.technology.hosting}
          </p>

          {blueprint.technology.avoid.length > 0 && (
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Avoid
              </p>
              <ul className="mt-2 space-y-2">
                {blueprint.technology.avoid.map((item, i) => (
                  <li key={i} className="text-sm leading-relaxed text-zinc-700">
                    <span className="font-semibold text-zinc-900">{item}</span>
                    {blueprint.technology.avoid_reasons[i] && (
                      <>
                        {' — '}
                        {blueprint.technology.avoid_reasons[i]}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* Next steps */}
      <Section label="Step-by-step next actions">
        <ol className="space-y-3">
          {blueprint.next_steps.map((step) => (
            <li
              key={step.step}
              className="flex gap-4 rounded-lg border border-zinc-200 bg-white p-4"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                {step.step}
              </span>
              <div className="flex-1">
                <p className="text-sm leading-relaxed text-zinc-800">
                  {step.action}
                </p>
                {step.cost && (
                  <p className="mt-1 text-xs font-medium text-brand">
                    {step.cost}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* Red flags — only render when Claude found something */}
      {blueprint.red_flags && blueprint.red_flags.length > 0 && (
        <Section label="Things to watch out for">
          <ul className="space-y-3">
            {blueprint.red_flags.map((flag, i) => (
              <li
                key={i}
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900"
              >
                {flag}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Cross-sell — scan upsell. SPEC §20: "Already have a site?
          Scan it for ₹49." Bundle (Blueprint + monitor = ₹999) waits
          on the monitor product itself. */}
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Already running another site?
        </p>
        <h2 className="mt-2 text-lg font-semibold text-zinc-900">
          Scan it and find what is broken — ₹49
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-700">
          If you manage another website (yours or a client&apos;s), Bugbite
          can scan every page, find the issues that lose customers, and
          write a plain-language report your developer can act on.
        </p>
        <a
          href="/"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-brand bg-transparent px-5 py-2.5 text-sm font-medium text-brand transition-colors hover:bg-brand-surface"
        >
          Scan a site →
        </a>
      </section>

      <p className="text-xs text-zinc-400">Reference: {blueprintId}</p>
    </article>
  )
}

// ─── Building blocks ───────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function List({
  items,
  bullet,
  tone,
}: {
  items: string[]
  bullet: string
  tone: 'positive' | 'negative'
}) {
  const bulletColor = tone === 'positive' ? 'text-brand' : 'text-amber-700'
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-zinc-800">
          <span aria-hidden className={`shrink-0 font-semibold ${bulletColor}`}>
            {bullet}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function FeatureColumn({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone: 'positive' | 'negative'
}) {
  if (items.length === 0) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </p>
        <p className="mt-2 text-sm italic text-zinc-400">None.</p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-zinc-700">
            <span
              aria-hidden
              className={`shrink-0 font-semibold ${tone === 'positive' ? 'text-brand' : 'text-zinc-400'}`}
            >
              {tone === 'positive' ? '✓' : '–'}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
