'use client'

import { useEffect, useState } from 'react'
import { captureEvent } from '@/lib/analytics/posthog'
import type { Phase1Result } from '@/lib/scan/phase1'
import type { Issue } from '@/lib/scan/phase2'
import type { ReportData, ReportScan } from '@/lib/report/types'

export type { ReportData, ReportScan }

// ─── Polling tunables ──────────────────────────────────────────────────
//
// 2s flat — exponential backoff was considered and rejected. The user is
// staring at the page while the scan runs; smooth 2s ticks read better
// than a slowing cadence.
//
// 150 polls × 2s = 5 minutes — the absolute ceiling. Real Phase 2 should
// finish in under 90s; if we hit 150 something has wedged and we hand
// the user to email follow-up rather than spin forever.
//
// Self-heal at 15 polls = 30s in 'paid'. The QStash publish in the
// trigger route is durable, but if it failed (network blip during
// payment-verify → trigger), the worker never fired and the scan
// stays 'paid'. One re-publish is enough to recover.
const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 150
const SELF_HEAL_THRESHOLD_POLLS = 15
const MAX_CONSECUTIVE_ERRORS = 3
// 600ms breath before snapping the scanning view away to the full
// report. Nothing technical — purely UX. Avoids a jarring flip that
// makes the report feel rushed at the moment of arrival.
const COMPLETE_TRANSITION_DELAY_MS = 600

type FallbackKind = 'timeout' | 'network'

/**
 * Client wrapper for /report/[scan_id]/full.
 *
 * Sub-task 5.1 (this file's current state):
 *   - Receives initial { scan, issues } from the server component.
 *   - Renders one of four status-aware views: queued / scanning /
 *     complete / failed. Initial render is the right thing — no flash.
 *
 * Sub-task 5.2 (next):
 *   - Adds useState + useEffect polling against /api/report/[scan_id]
 *     every 2s while status is 'paid' or 'scanning'.
 *   - Adds self-heal: re-trigger if 'paid' for >30s.
 *   - Adds 150-poll cap with friendly fallback message.
 *
 * Sub-task 5.4 (later):
 *   - Replaces FullReportSections stub with the SPEC §7 11-section
 *     layout — Summary card, Contact verification, Links & pages, Trust,
 *     Content, Visual & UI, Workflow & UX, Technical, Solution map,
 *     Send to developer.
 */
export function ReportClient({ initial }: { initial: ReportData }) {
  const [data, setData] = useState<ReportData>(initial)
  const [fallback, setFallback] = useState<FallbackKind | null>(null)

  useEffect(() => {
    const initialStatus = initial.scan.status
    // Terminal states never poll. Initial render is final.
    if (initialStatus !== 'paid' && initialStatus !== 'scanning') {
      return
    }

    const scanId = initial.scan.id

    // Closure-local state so the polling loop is independent of React
    // state updates (which only need to drive the rendered UI). Using
    // refs would work too — closure vars are simpler since this effect
    // runs once per mount (deps fixed by initial.scan.id).
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let pollCount = 0
    // -1 = not currently in 'paid'. 0 = just entered. We tick up while
    // status stays 'paid' so the self-heal threshold reflects time-in-paid,
    // not total poll count.
    let paidPollCount = initialStatus === 'paid' ? 0 : -1
    let selfHealAttempted = false
    let consecutiveErrors = 0
    let prevStatus: string | null = initialStatus

    function scheduleNext() {
      if (cancelled) return
      pollCount += 1
      timeoutId = setTimeout(tick, POLL_INTERVAL_MS)
    }

    function recordError(kind: FallbackKind): boolean {
      consecutiveErrors += 1
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        setFallback(kind)
        return true // stop polling
      }
      return false
    }

    async function tick() {
      if (cancelled) return

      if (pollCount >= MAX_POLLS) {
        setFallback('timeout')
        return
      }

      // ─── Fetch ──────────────────────────────────────────────────────
      // 5.3 will land /api/report/[scan_id]. Until then this 404s and
      // the polling will mark the scan failed — that's the staging gap.
      let res: Response
      try {
        res = await fetch(`/api/report/${scanId}`, { cache: 'no-store' })
      } catch {
        if (recordError('network')) return
        scheduleNext()
        return
      }

      if (cancelled) return

      // 404 = scan record genuinely missing (deleted, bad id). Treat as
      // failed so the user lands on a clear support path instead of
      // spinning. Distinguishable from network error because the server
      // responded — our DNS/network is fine.
      if (res.status === 404) {
        setData((prev) => ({
          ...prev,
          scan: { ...prev.scan, status: 'failed' },
        }))
        return
      }

      if (!res.ok) {
        if (recordError('network')) return
        scheduleNext()
        return
      }

      let next: ReportData
      try {
        next = (await res.json()) as ReportData
      } catch {
        if (recordError('network')) return
        scheduleNext()
        return
      }

      if (cancelled) return
      consecutiveErrors = 0

      // ─── 600ms intentional pause on scanning → complete ────────────
      if (
        prevStatus === 'scanning' &&
        next.scan.status === 'complete'
      ) {
        await new Promise((r) =>
          setTimeout(r, COMPLETE_TRANSITION_DELAY_MS),
        )
        if (cancelled) return
      }

      prevStatus = next.scan.status
      setData(next)

      // ─── Stop on terminal states ───────────────────────────────────
      if (
        next.scan.status === 'complete' ||
        next.scan.status === 'failed'
      ) {
        return
      }

      // ─── Self-heal book-keeping ────────────────────────────────────
      if (next.scan.status === 'paid') {
        paidPollCount = paidPollCount === -1 ? 1 : paidPollCount + 1
        if (
          !selfHealAttempted &&
          paidPollCount >= SELF_HEAL_THRESHOLD_POLLS
        ) {
          selfHealAttempted = true
          void selfHealTrigger(scanId)
        }
      } else {
        // Status moved out of 'paid' (typically into 'scanning') — reset.
        paidPollCount = -1
      }

      scheduleNext()
    }

    // First poll fires after the interval, not immediately — the server
    // component just delivered fresh data and a sub-second poll would be
    // wasteful.
    timeoutId = setTimeout(tick, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
    // initial.scan.id is stable per page; initial.scan.status only matters
    // for the initial gating decision (terminal vs poll-worthy). Both are
    // safe to depend on — they don't change during a mount.
  }, [initial.scan.id, initial.scan.status])

  return (
    <>
      <PaymentConfirmation startedDate={formatDate(data.scan.created_at)} />
      <ScanHeader scan={data.scan} />
      <Phase1Findings phase1={data.scan.phase1_result} />
      <StatusBody scan={data.scan} issues={data.issues} fallback={fallback} />
      <ActionFooter enabled={data.scan.status === 'complete'} />
      <p className="mt-10 text-xs text-zinc-400">Reference: {data.scan.id}</p>
    </>
  )
}

// ─── Self-heal trigger ──────────────────────────────────────────────────

/**
 * Re-publish the Phase 2 job to QStash. Called once per mount when the
 * scan has been stuck in 'paid' for SELF_HEAL_THRESHOLD_POLLS × 2s.
 *
 * Failures here are intentionally silent — the polling loop continues
 * and will surface the timeout fallback if self-heal didn't help.
 *
 * PostHog event fires before the fetch so we capture intent even if the
 * network request itself fails.
 */
async function selfHealTrigger(scan_id: string): Promise<void> {
  captureEvent('scan_self_healed', { scan_id })
  try {
    await fetch('/api/scan/phase2/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan_id }),
    })
  } catch {
    // Silent. Polling will hit timeout fallback if scan stays stuck.
  }
}

// ─── Status switch ───────────────────────────────────────────────────────

function StatusBody({
  scan,
  issues,
  fallback,
}: {
  scan: ReportScan
  issues: Issue[]
  fallback: FallbackKind | null
}) {
  // Polling has stopped (timeout or repeated network errors) AND we're
  // still in a non-terminal status. Render the fallback in place of the
  // normal queued/scanning view since there's no progress to show.
  if (fallback && (scan.status === 'paid' || scan.status === 'scanning')) {
    return <FallbackView kind={fallback} />
  }

  switch (scan.status) {
    case 'complete':
      return <FullReportSections scan={scan} issues={issues} />
    case 'scanning':
      return <ScanningView />
    case 'failed':
      return <FailedView />
    case 'paid':
    default:
      // 'paid' = queued but worker hasn't picked up yet.
      // null/'phase1_complete' shouldn't reach here (server gates payment_status='paid'
      // before mounting), but render the same friendly placeholder if so.
      return <QueuedView />
  }
}

function FallbackView({ kind }: { kind: FallbackKind }) {
  if (kind === 'timeout') {
    return (
      <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold text-amber-900">
          Bugbite is taking longer than usual
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-amber-900">
          Bugbite will email you when the report is ready. Questions in the
          meantime — write to{' '}
          <a
            href="mailto:hello@fixmysite.in"
            className="underline underline-offset-2"
          >
            hello@fixmysite.in
          </a>
          .
        </p>
      </section>
    )
  }
  // 'network' — three consecutive fetch failures
  return (
    <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-lg font-semibold text-amber-900">
        Bugbite can&apos;t check in from this page right now
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-amber-900">
        Bugbite is still working on your scan — this page just can&apos;t reach
        us to ask how it&apos;s going. Refresh to try again, or email{' '}
        <a
          href="mailto:hello@fixmysite.in"
          className="underline underline-offset-2"
        >
          hello@fixmysite.in
        </a>{' '}
        if it doesn&apos;t load. Bugbite will email the report either way.
      </p>
    </section>
  )
}

// ─── Status views ────────────────────────────────────────────────────────

function QueuedView() {
  return (
    <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-lg font-semibold text-amber-900">
        Bugbite is queueing up…
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-amber-900">
        Bugbite is booking time to run the deep audit on your site. This page
        will update automatically once Bugbite gets started — no need to refresh.
      </p>
    </section>
  )
}

function ScanningView() {
  return (
    <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-lg font-semibold text-amber-900">
        Bugbite is on it…
      </h2>
      <ul className="mt-4 space-y-2 text-sm text-amber-900">
        <li className="flex gap-2">
          <span aria-hidden>•</span>
          <span>Bugbite is checking your phone numbers…</span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden>•</span>
          <span>Bugbite is running through your links…</span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden>•</span>
          <span>Bugbite is reading your content…</span>
        </li>
      </ul>
      <p className="mt-4 text-xs text-amber-900/80">
        This page updates automatically. You can close the tab — Bugbite will
        email you when the report is ready.
      </p>
    </section>
  )
}

function FailedView() {
  return (
    <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6">
      <h2 className="text-lg font-semibold text-red-900">
        Bugbite ran into a problem
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-red-900">
        Your payment is safe. Email{' '}
        <a
          href="mailto:hello@fixmysite.in"
          className="underline underline-offset-2"
        >
          hello@fixmysite.in
        </a>{' '}
        with this URL and we&apos;ll re-run your scan within 24 hours.
      </p>
    </section>
  )
}

// ─── Full report — SPEC §7 eleven-section layout ────────────────────────

type ReportJson = {
  summary?: string
  return_message?: string | null
}

function FullReportSections({
  scan,
  issues,
}: {
  scan: ReportScan
  issues: Issue[]
}) {
  const reportJson = (scan.report_json ?? {}) as ReportJson
  const summary = reportJson.summary ?? ''
  const returnMessage = reportJson.return_message?.trim() || null

  return (
    <div className="mt-8 space-y-6">
      {returnMessage && <ReturnMessage text={returnMessage} />}

      <SummaryCard
        healthScore={scan.health_score}
        summary={summary}
        issues={issues}
      />

      <IssueSection
        title="Contact verification"
        issues={issues.filter((i) => i.category === 'contact')}
      />
      <IssueSection
        title="Links & pages"
        issues={issues.filter((i) => i.category === 'links')}
      />
      <IssueSection
        title="Trust signals"
        issues={issues.filter((i) => i.category === 'trust')}
      />
      <IssueSection
        title="Content quality"
        issues={issues.filter((i) => i.category === 'content')}
      />
      <IssueSection
        title="Visual & UI"
        issues={issues.filter((i) => i.category === 'visual')}
      />
      <IssueSection
        title="Workflow & UX"
        issues={issues.filter((i) => i.category === 'workflow')}
      />
      <IssueSection
        title="Technical health"
        issues={issues.filter((i) => i.category === 'technical')}
      />

      <SolutionMap issues={issues} />

      <SendToDeveloper scanId={scan.id} />
    </div>
  )
}

// ─── §1 Return message ──────────────────────────────────────────────────
// Only renders when the orchestrator wrote `return_message` into
// report_json (i.e. fix_rate ≥ 0.8 on the previous-scan check).

function ReturnMessage({ text }: { text: string }) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
      <p className="text-base leading-relaxed text-emerald-900">{text}</p>
    </section>
  )
}

// ─── §2 Summary card ────────────────────────────────────────────────────

function SummaryCard({
  healthScore,
  summary,
  issues,
}: {
  healthScore: number | null
  summary: string
  issues: Issue[]
}) {
  const fails = issues.filter((i) => i.status === 'fail').length
  const warnings = issues.filter((i) => i.status === 'warning').length
  const oks = issues.filter((i) => i.status === 'ok').length

  const scoreColor =
    healthScore === null
      ? 'text-zinc-500'
      : healthScore >= 70
        ? 'text-[#1D9E75]'
        : healthScore >= 40
          ? 'text-[#EF9F27]'
          : 'text-[#E87C28]'

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Health score
          </p>
          <p className={`mt-1 text-5xl font-semibold tabular-nums ${scoreColor}`}>
            {healthScore ?? '—'}
            <span className="text-2xl font-normal text-zinc-400">/100</span>
          </p>
        </div>
        {summary && (
          <p className="max-w-md text-sm leading-relaxed text-zinc-700 sm:text-right">
            {summary}
          </p>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-zinc-100 pt-4 text-sm text-zinc-700">
        <span>
          <strong className="text-[#E87C28]">{fails}</strong> critical
        </span>
        <span>
          <strong className="text-[#EF9F27]">{warnings}</strong> warnings
        </span>
        <span>
          <strong className="text-[#1D9E75]">{oks}</strong> verified
        </span>
      </div>
    </section>
  )
}

// ─── §3-§9 Per-category issue sections ──────────────────────────────────

function IssueSection({
  title,
  issues,
}: {
  title: string
  issues: Issue[]
}) {
  if (issues.length === 0) return null

  // "Issues" in the header counts fails + warnings — the things that
  // need attention. 'ok' items show in the body (verified phones etc.)
  // but the header celebrates them with "all clear ✓".
  const problemCount = issues.filter((i) => i.status !== 'ok').length
  const headerSuffix =
    problemCount > 0
      ? `— ${problemCount} ${problemCount === 1 ? 'issue' : 'issues'}`
      : '— all clear ✓'

  // <details open> = expanded by default on every device. On desktop the
  // chevron is hidden and the cursor stays default — discouraging
  // collapse. On mobile the chevron + pointer cursor invite a tap to
  // collapse if the user wants a smaller scroll.
  return (
    <details open className="group rounded-xl border border-zinc-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 sm:cursor-default [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-semibold text-zinc-900">
          {title}
          <span className="ml-1 font-normal text-zinc-500">
            {headerSuffix}
          </span>
        </h2>
        <span
          aria-hidden
          className="text-zinc-400 transition-transform group-open:rotate-180 sm:hidden"
        >
          ▾
        </span>
      </summary>
      <div className="space-y-3 border-t border-zinc-100 px-6 py-4">
        {issues.map((issue, idx) => (
          <IssueCard key={`${issue.item}-${idx}`} issue={issue} />
        ))}
      </div>
    </details>
  )
}

function IssueCard({ issue }: { issue: Issue }) {
  return (
    <article className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-4">
      <div className="flex items-start gap-3">
        <StatusDot status={issue.status} />
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-900 break-words">
            {issue.item}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-700">
            {issue.detail}
          </p>
          {issue.action && issue.status !== 'ok' && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-900">
              <span className="font-medium">What to do:</span> {issue.action}
            </p>
          )}
          {issue.status !== 'ok' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <PriorityBadge priority={issue.priority} />
              <EffortTag effort={issue.effort} />
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function StatusDot({ status }: { status: Issue['status'] }) {
  const color =
    status === 'fail'
      ? 'bg-[#E87C28]'
      : status === 'warning'
        ? 'bg-[#EF9F27]'
        : 'bg-[#1D9E75]'
  const label =
    status === 'fail'
      ? 'Failed check'
      : status === 'warning'
        ? 'Warning'
        : 'Verified'
  return (
    <span
      role="img"
      aria-label={label}
      className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${color}`}
    />
  )
}

function PriorityBadge({ priority }: { priority: Issue['priority'] }) {
  const styles =
    priority === 'high'
      ? 'bg-[#E87C28] text-white'
      : priority === 'medium'
        ? 'bg-[#EF9F27] text-white'
        : 'bg-[#1D9E75] text-white'
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

function EffortTag({ effort }: { effort: Issue['effort'] }) {
  const label =
    effort === 'low'
      ? 'Low effort'
      : effort === 'medium'
        ? 'Medium effort'
        : 'High effort'
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
      {label}
    </span>
  )
}

// ─── §10 Solution map ───────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<Issue['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}
const EFFORT_WEIGHT: Record<Issue['effort'], number> = {
  low: 0,
  medium: 1,
  high: 2,
}

function SolutionMap({ issues }: { issues: Issue[] }) {
  // Solution map only shows things that need fixing — 'ok' verified
  // items aren't actions. Sort high-priority + low-effort first
  // ("most impactful, easiest fixes at the top"). Placeholder until
  // Claude's report.solution_map lands with bespoke titles + bodies;
  // until then we derive directly from the issue list.
  const actionable = issues
    .filter((i) => i.status !== 'ok')
    .slice()
    .sort((a, b) => {
      const p = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
      if (p !== 0) return p
      return EFFORT_WEIGHT[a.effort] - EFFORT_WEIGHT[b.effort]
    })

  if (actionable.length === 0) return null

  return (
    <details
      open
      className="group rounded-xl border border-zinc-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 sm:cursor-default [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-semibold text-zinc-900">
          Solution map
          <span className="ml-1 font-normal text-zinc-500">
            — fix these in order
          </span>
        </h2>
        <span
          aria-hidden
          className="text-zinc-400 transition-transform group-open:rotate-180 sm:hidden"
        >
          ▾
        </span>
      </summary>
      <ol className="space-y-4 border-t border-zinc-100 px-6 py-4">
        {actionable.map((issue, idx) => (
          <li
            key={`solution-${issue.item}-${idx}`}
            className="flex gap-4"
          >
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white">
              {idx + 1}
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-900 break-words">
                {issue.item}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-700">
                {issue.action || issue.detail}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <PriorityBadge priority={issue.priority} />
                <EffortTag effort={issue.effort} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </details>
  )
}

// ─── §11 Send to developer ──────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type SendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; email: string }
  | { phase: 'error'; message: string }

function SendToDeveloper({ scanId }: { scanId: string }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<SendState>({ phase: 'idle' })

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!EMAIL_RE.test(trimmed)) {
      setState({
        phase: 'error',
        message: 'Enter a valid email address.',
      })
      return
    }

    setState({ phase: 'sending' })
    try {
      const res = await fetch('/api/report/send-developer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan_id: scanId, developer_email: trimmed }),
      })
      if (!res.ok) {
        setState({
          phase: 'error',
          message:
            'Could not send. Try again, or email hello@fixmysite.in and we will forward it for you.',
        })
        return
      }
      setState({ phase: 'sent', email: trimmed })
    } catch {
      setState({
        phase: 'error',
        message:
          'Could not send. Try again, or email hello@fixmysite.in and we will forward it for you.',
      })
    }
  }

  if (state.phase === 'sent') {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">
          Report sent to {state.email}
        </h2>
        <p className="mt-2 text-sm text-emerald-900">
          They&apos;ll receive the full PDF in their inbox shortly.
        </p>
        <button
          type="button"
          onClick={() => {
            setEmail('')
            setState({ phase: 'idle' })
          }}
          className="mt-3 text-sm font-medium text-emerald-900 underline underline-offset-2"
        >
          Send to someone else
        </button>
      </section>
    )
  }

  const isSending = state.phase === 'sending'

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        Send what Bugbite found to your developer
      </h2>
      <p className="mt-2 text-sm text-zinc-700">
        Bugbite will email them the full solution map — ordered, prioritised, ready to action.
      </p>
      <form
        onSubmit={handleSend}
        className="mt-4 flex flex-col gap-3 sm:flex-row"
      >
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="developer@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (state.phase === 'error') setState({ phase: 'idle' })
          }}
          disabled={isSending}
          className="flex-1 rounded-lg border border-zinc-300 px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
        />
        <button
          type="submit"
          disabled={isSending}
          aria-busy={isSending}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSending ? 'Sending…' : 'Send report'}
        </button>
      </form>
      {state.phase === 'error' && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {state.message}
        </p>
      )}
    </section>
  )
}

// ─── Header / summary ────────────────────────────────────────────────────

function ScanHeader({ scan }: { scan: ReportScan }) {
  const displayHost = resolveDisplayHost(scan)
  const startedDate = formatDate(scan.created_at)
  const completedDate = scan.completed_at ? formatDate(scan.completed_at) : null
  const tierLabel = scan.tier
    ? scan.tier[0]!.toUpperCase() + scan.tier.slice(1)
    : null
  const pageCount = scan.page_count ?? 0
  const isComplete = scan.status === 'complete'

  return (
    <section className="mt-8">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
        Your scan of {displayHost}
      </h1>
      <p className="mt-3 text-base text-zinc-700">
        {tierLabel ? `${tierLabel} site` : 'Site'}
        {pageCount > 0 && (
          <>
            {' · '}
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
          </>
        )}
        {' · '}started {startedDate}
        {completedDate && isComplete && (
          <>
            {' · '}completed {completedDate}
          </>
        )}
      </p>
    </section>
  )
}

function PaymentConfirmation({ startedDate }: { startedDate: string }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-900">
      ✓ Payment received on {startedDate}
    </div>
  )
}

// ─── Phase 1 findings (carried over from the server-only version) ───────

function Phase1Findings({ phase1 }: { phase1: Phase1Result | null }) {
  if (!phase1) {
    return (
      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
        <p className="text-sm text-zinc-700">
          Initial scan results are not yet available for this scan.
        </p>
      </section>
    )
  }

  const phoneCount = phase1.homepage.phones.length
  const emailCount = phase1.homepage.emails.length
  const sourceLabel = phase1.pageCount.source.replace(/_/g, ' ')

  return (
    <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        What we found in your initial scan
      </h2>
      <ul className="mt-4 space-y-2 text-sm text-zinc-700">
        <li className="flex gap-2">
          <span aria-hidden>✓</span>
          <span>Site is reachable</span>
        </li>
        {phase1.ssl?.basicValid ? (
          <li className="flex gap-2">
            <span aria-hidden>✓</span>
            <span>SSL certificate is valid</span>
          </li>
        ) : (
          <li className="flex gap-2 text-amber-700">
            <span aria-hidden>⚠</span>
            <span>Site served over HTTP — no SSL certificate</span>
          </li>
        )}
        {phase1.robots.exists ? (
          phase1.robots.crawlAllowed ? (
            <li className="flex gap-2">
              <span aria-hidden>✓</span>
              <span>robots.txt allows crawling</span>
            </li>
          ) : (
            <li className="flex gap-2 text-amber-700">
              <span aria-hidden>⚠</span>
              <span>
                robots.txt blocks crawlers — the full scan may be limited
              </span>
            </li>
          )
        ) : (
          <li className="flex gap-2">
            <span aria-hidden>✓</span>
            <span>No robots.txt restrictions</span>
          </li>
        )}
        <li className="flex gap-2">
          <span aria-hidden>✓</span>
          <span>
            {phase1.pageCount.count}{' '}
            {phase1.pageCount.count === 1 ? 'page' : 'pages'} detected
            {phase1.pageCount.source !== 'unknown' && ` via ${sourceLabel}`}
          </span>
        </li>
        {phoneCount > 0 && (
          <li className="flex gap-2">
            <span aria-hidden>✓</span>
            <span>
              {phoneCount}{' '}
              {phoneCount === 1 ? 'phone number' : 'phone numbers'} found on
              homepage
            </span>
          </li>
        )}
        {emailCount > 0 && (
          <li className="flex gap-2">
            <span aria-hidden>✓</span>
            <span>
              {emailCount} email{' '}
              {emailCount === 1 ? 'address' : 'addresses'} found on homepage
            </span>
          </li>
        )}
      </ul>

      {phase1.homepage.title && (
        <div className="mt-5 border-t border-zinc-100 pt-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Page title
          </p>
          <p className="mt-1 text-sm text-zinc-700">
            {phase1.homepage.title}
          </p>
        </div>
      )}
      {phase1.homepage.metaDescription && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Description
          </p>
          <p className="mt-1 text-sm text-zinc-700">
            {phase1.homepage.metaDescription}
          </p>
        </div>
      )}
    </section>
  )
}

// ─── Action footer ───────────────────────────────────────────────────────

function ActionFooter({ enabled }: { enabled: boolean }) {
  return (
    <section className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={!enabled}
          aria-disabled={!enabled}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          Download PDF report
        </button>
        <button
          type="button"
          disabled={!enabled}
          aria-disabled={!enabled}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-3 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Send to your developer
        </button>
      </div>
      {!enabled && (
        <p className="mt-3 text-xs text-zinc-500">
          Bugbite is still working — both buttons activate when the report is ready.
        </p>
      )}
    </section>
  )
}

// ─── Pure helpers ────────────────────────────────────────────────────────

function resolveDisplayHost(scan: ReportScan): string {
  try {
    const u = new URL(scan.phase1_result?.finalUrl ?? scan.url)
    return u.host.replace(/^www\./, '')
  } catch {
    return scan.url
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
