'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AdminGate } from '@/components/enterprise/AdminGate'
import { InstitutionUpsell } from '@/components/scan/InstitutionUpsell'

type UrlClass =
  | 'global_enterprise'
  | 'indian_enterprise'
  | 'institution'
  | 'self_serve'

type ApiErrorBody = { error?: string; reason?: string } | null

type FormState =
  | { phase: 'idle' }
  | { phase: 'classifying' }
  | { phase: 'starting_phase1' }
  | { phase: 'admin_gate'; url: string; hostname: string; urlClass: 'global_enterprise' | 'indian_enterprise' }
  | { phase: 'institution_upsell'; hostname: string }
  | { phase: 'error'; message: string }

export function ScanForm() {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [state, setState] = useState<FormState>({ phase: 'idle' })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return

    setState({ phase: 'classifying' })

    // ─── Step 1: classify the URL (zero DB writes) ──────────────────────
    let classify: { class: UrlClass; hostname: string }
    try {
      const res = await fetch('/api/scan/classify-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })

      if (res.status === 429) {
        setState({ phase: 'error', message: "You've started too many scans. Try again in an hour." })
        return
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody
        if (data?.reason === 'invalid_url') {
          setState({ phase: 'error', message: "That doesn't look like a valid URL. Check it and try again." })
          return
        }
        // Fail closed — a broken classifier must never let the request slip
        // through to Phase 1, since that would create a DB row for a URL whose
        // routing class we don't actually know. Path E's zero-cost promise
        // depends on this gate.
        setState({ phase: 'error', message: 'Something went wrong. Please try again.' })
        return
      }

      classify = (await res.json()) as { class: UrlClass; hostname: string }
    } catch {
      setState({ phase: 'error', message: 'Something went wrong. Please try again.' })
      return
    }

    // ─── Step 2: branch on class ────────────────────────────────────────
    if (classify.class === 'institution') {
      setState({ phase: 'institution_upsell', hostname: classify.hostname })
      return
    }

    if (classify.class === 'global_enterprise' || classify.class === 'indian_enterprise') {
      setState({
        phase: 'admin_gate',
        url: trimmed,
        hostname: classify.hostname,
        urlClass: classify.class,
      })
      return
    }

    // ─── Step 3 (self_serve only): proceed to Phase 1 ───────────────────
    setState({ phase: 'starting_phase1' })

    let res: Response
    try {
      res = await fetch('/api/scan/phase1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
    } catch {
      setState({ phase: 'error', message: 'Network error starting scan. Try again.' })
      return
    }

    if (res.status === 429) {
      setState({ phase: 'error', message: "You've started too many scans. Try again in an hour." })
      return
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as ApiErrorBody
      setState({ phase: 'error', message: mapPhase1Error(data) })
      return
    }

    const data = (await res.json().catch(() => null)) as { scan_id?: string } | null
    if (!data?.scan_id) {
      setState({ phase: 'error', message: 'Scan started but no ID came back. Try again.' })
      return
    }

    // Form unmounts when /scanning/[scan_id] renders — no need to reset state.
    router.push(`/scanning/${data.scan_id}`)
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setUrl(e.target.value)
    if (state.phase === 'error') setState({ phase: 'idle' })
  }

  // Branch handler used by AdminGate ("No, just curious") and InstitutionUpsell
  // ("Try a different URL"). Clears the input + resets the form so the user
  // can paste a new URL with no trace of the previous attempt.
  function handleStartOver() {
    setUrl('')
    setState({ phase: 'idle' })
  }

  // ─── Branched UI: gates that replace the form entirely ────────────────
  if (state.phase === 'admin_gate') {
    return (
      <AdminGate
        url={state.url}
        hostname={state.hostname}
        urlClass={state.urlClass}
        onExit={handleStartOver}
      />
    )
  }

  if (state.phase === 'institution_upsell') {
    return (
      <InstitutionUpsell
        hostname={state.hostname}
        onStartOver={handleStartOver}
      />
    )
  }

  // ─── Default: the URL input form ──────────────────────────────────────
  const busy = state.phase === 'classifying' || state.phase === 'starting_phase1'
  const buttonLabel =
    state.phase === 'classifying'
      ? 'Checking…'
      : state.phase === 'starting_phase1'
        ? 'Scanning…'
        : 'Scan my site'
  const error = state.phase === 'error' ? state.message : null

  return (
    <div className="w-full">
      <form
        onSubmit={handleSubmit}
        aria-busy={busy}
        className="flex w-full flex-col gap-3 sm:flex-row"
      >
        <label htmlFor="scan-url" className="sr-only">
          Website URL
        </label>
        <input
          id="scan-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          enterKeyHint="go"
          value={url}
          onChange={handleChange}
          placeholder="yourbusiness.com"
          required
          aria-invalid={error !== null}
          aria-describedby={error ? 'scan-url-error' : undefined}
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand sm:flex-1"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="rounded-lg bg-brand px-6 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {buttonLabel}
        </button>
      </form>
      {error && (
        <p
          id="scan-url-error"
          role="alert"
          className="mt-3 text-sm text-amber-700"
        >
          {error}
        </p>
      )}
    </div>
  )
}

function mapPhase1Error(data: ApiErrorBody): string {
  switch (data?.reason) {
    case 'invalid_url':
      return "That doesn't look like a valid URL. Check it and try again."
    case 'blocked':
      return "We can't scan that URL. Try a different site."
    case 'timeout':
      return "The site didn't respond in time. Try again in a moment."
    case 'network':
      return 'Could not reach the site. Check the URL and try again.'
    case 'http_error':
      return 'The site returned an error. Try again or check the URL.'
    default:
      return data?.error || 'Could not start scan. Try again.'
  }
}
