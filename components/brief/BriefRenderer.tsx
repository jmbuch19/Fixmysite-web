import type { BriefOutput, BriefSection } from '@/lib/claude/brief'

/**
 * Display layer for a generated developer brief. Used by:
 *
 *   /brief/[scan_id]/preview — mode='preview' (paywall: only first
 *     section's body visible, rest blurred behind a lock)
 *   /brief/[scan_id]/full    — mode='full'    (everything visible)
 *
 * Pure server component — takes a BriefOutput, renders. No state, no
 * fetching, no payment logic. The preview vs full gate is a pure prop
 * decision so the same component can render both surfaces with no
 * branching at the page level beyond passing the mode.
 */
export function BriefRenderer({
  brief,
  mode,
}: {
  brief: BriefOutput
  mode: 'preview' | 'full'
}) {
  return (
    <div className="space-y-6">
      <IntentSummary
        intent={brief.intent_summary}
        businessType={brief.business_type}
        ownerOriginalWords={brief.owner_original_words}
      />

      <SectionsList sections={brief.sections} mode={mode} />

      {mode === 'full' && brief.additional_recommendations.length > 0 && (
        <RecommendationsBlock items={brief.additional_recommendations} />
      )}

      {mode === 'full' && brief.not_in_scope.length > 0 && (
        <NotInScopeBlock items={brief.not_in_scope} />
      )}
    </div>
  )
}

// ─── Intent summary card ───────────────────────────────────────────────

function IntentSummary({
  intent,
  businessType,
  ownerOriginalWords,
}: {
  intent: string
  businessType: string
  ownerOriginalWords: string
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand">
        What Bugbite understood — {humanBusinessType(businessType)}
      </p>
      <p className="mt-2 text-base leading-relaxed text-zinc-900">{intent}</p>

      <div className="mt-5 rounded-lg border border-zinc-100 bg-zinc-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Your original words
        </p>
        <p className="mt-1 text-sm italic text-zinc-700">
          &ldquo;{ownerOriginalWords}&rdquo;
        </p>
      </div>
    </section>
  )
}

// ─── Sections list with paywall gate ───────────────────────────────────

function SectionsList({
  sections,
  mode,
}: {
  sections: BriefSection[]
  mode: 'preview' | 'full'
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-900">
        Work items {mode === 'preview' ? `(${sections.length} total)` : ''}
      </h2>

      {sections.map((section, idx) => {
        const isLocked = mode === 'preview' && idx > 0
        return (
          <SectionCard
            key={`${section.title}-${idx}`}
            section={section}
            order={idx + 1}
            locked={isLocked}
          />
        )
      })}

      {mode === 'preview' && sections.length > 1 && (
        <p className="px-1 text-xs text-zinc-500">
          {sections.length - 1} more{' '}
          {sections.length - 1 === 1 ? 'work item' : 'work items'} unlock with
          the full brief, plus Bugbite&apos;s clinic-specific recommendations
          and the &ldquo;not in scope&rdquo; boundary list for your developer.
        </p>
      )}
    </section>
  )
}

function SectionCard({
  section,
  order,
  locked,
}: {
  section: BriefSection
  order: number
  locked: boolean
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-xl border p-6 ${
        locked
          ? 'border-zinc-200 bg-zinc-50'
          : 'border-zinc-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white">
          {order}
        </span>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-zinc-900">
            {section.title}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <PriorityBadge priority={section.priority} />
            <EffortTag effort={section.effort_days} />
          </div>
        </div>
      </div>

      {/* Owner words — always visible. The owner's verbatim quote that
          motivated this section. Builds the "you were heard" feeling. */}
      <div className="mt-4 rounded-lg border-l-4 border-brand bg-brand-surface/50 px-4 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          You said
        </p>
        <p className="mt-1 text-sm italic text-zinc-700">
          &ldquo;{section.owner_words}&rdquo;
        </p>
      </div>

      {/* Technical brief — locked behind paywall in preview except for
          the first section. The lock is a visual blur on the body plus
          a small badge. The "Unlock the full brief" CTA lives below
          the sections list at page level so it's not repeated per card. */}
      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          What to build
        </p>
        {locked ? (
          <div className="relative mt-1.5">
            <p
              aria-hidden
              className="select-none text-sm leading-relaxed text-zinc-700 blur-sm"
            >
              {/* Show first ~120 chars blurred so the layout has body, but
                  the full spec doesn't leak. Truncating here AND blurring
                  is belt-and-braces — a determined inspector with devtools
                  could un-blur, but they'd still hit the truncation. */}
              {section.technical_brief.slice(0, 120)}…
            </p>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white shadow-sm">
                🔒 Unlock with the full brief
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-700">
            {section.technical_brief}
          </p>
        )}
      </div>
    </article>
  )
}

// ─── Recommendations + not-in-scope (full only) ────────────────────────

function RecommendationsBlock({ items }: { items: string[] }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        Bugbite&apos;s additional recommendations
      </h2>
      <p className="mt-2 text-sm text-zinc-600">
        Optional improvements Bugbite noticed that fit your business type. Not
        required to ship the work above.
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((item, idx) => (
          <li
            key={`rec-${idx}`}
            className="flex gap-3 text-sm leading-relaxed text-zinc-700"
          >
            <span aria-hidden className="text-brand">
              ✓
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function NotInScopeBlock({ items }: { items: string[] }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">Not in scope</h2>
      <p className="mt-2 text-sm text-zinc-600">
        For your developer&apos;s reference — things you did not ask for, so
        the project stays focused. Show this list to anyone who tries to add
        more.
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((item, idx) => (
          <li
            key={`not-${idx}`}
            className="flex gap-3 text-sm leading-relaxed text-zinc-600"
          >
            <span aria-hidden className="text-zinc-400">
              ✗
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Small helpers ─────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: BriefSection['priority'] }) {
  const styles =
    priority === 'high'
      ? 'bg-[#E87C28] text-white'
      : priority === 'medium'
        ? 'bg-[#EF9F27] text-white'
        : 'bg-brand text-white'
  const label =
    priority === 'high'
      ? 'High priority'
      : priority === 'medium'
        ? 'Medium priority'
        : 'Low priority'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}
    >
      {label}
    </span>
  )
}

function EffortTag({ effort }: { effort: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
      {effort}
    </span>
  )
}

function humanBusinessType(key: string): string {
  switch (key) {
    case 'clinic':
      return 'Medical clinic'
    case 'retail_clothing':
      return 'Retail / clothing'
    case 'restaurant':
      return 'Restaurant'
    case 'legal':
      return 'Legal practice'
    case 'education':
      return 'Education'
    case 'ca_finance':
      return 'CA / finance'
    case 'real_estate':
      return 'Real estate'
    case 'salon_beauty':
      return 'Salon / beauty'
    case 'gym_fitness':
      return 'Gym / fitness'
    case 'general':
    default:
      return 'General business'
  }
}
