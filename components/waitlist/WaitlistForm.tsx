'use client'

import { useState } from 'react'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FormState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success' }
  | { phase: 'error'; message: string }

/**
 * Second-door capture for visitors without a website yet. Designed to
 * sit BELOW the primary scan input — visually subtle, ghost-button
 * style, never competing with the main "Scan my site" CTA.
 *
 * Server route is quiet on duplicates (returns 200 even if the email
 * is already on the list) so the success copy is the same regardless.
 */
export function WaitlistForm({
  source = 'landing',
}: {
  source?: string
}) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<FormState>({ phase: 'idle' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!EMAIL_RE.test(trimmed)) {
      setState({
        phase: 'error',
        message: 'Please enter a valid email address.',
      })
      return
    }

    setState({ phase: 'submitting' })
    try {
      const res = await fetch('/api/waitlist/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, source }),
      })
      if (res.status === 429) {
        setState({
          phase: 'error',
          message:
            'Too many attempts from this device. Wait an hour and try again.',
        })
        return
      }
      if (!res.ok) {
        setState({
          phase: 'error',
          message:
            'Something went wrong. Try again or email hello@fixmysite.in.',
        })
        return
      }
      setState({ phase: 'success' })
    } catch {
      setState({
        phase: 'error',
        message:
          'Something went wrong. Try again or email hello@fixmysite.in.',
      })
    }
  }

  if (state.phase === 'success') {
    return (
      <p
        role="status"
        className="text-sm font-medium text-brand"
      >
        You&apos;re on the list. We&apos;ll be in touch.
      </p>
    )
  }

  const submitting = state.phase === 'submitting'

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 sm:flex-row"
      aria-busy={submitting}
      noValidate
    >
      <label htmlFor="waitlist-email" className="sr-only">
        Email
      </label>
      <input
        id="waitlist-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        value={email}
        disabled={submitting}
        onChange={(e) => {
          setEmail(e.target.value)
          if (state.phase === 'error') setState({ phase: 'idle' })
        }}
        className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
      />
      {/* Ghost-style button: brand-coloured outline + text, transparent
          fill. Distinct from the primary scan CTA which is filled teal.
          Same visual weight as the input; together they read as one
          quiet unit, not a competing call-to-action. */}
      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="inline-flex items-center justify-center rounded-lg border border-brand bg-transparent px-5 py-2.5 text-base font-medium text-brand transition-colors hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {submitting ? 'Adding…' : 'Notify me →'}
      </button>
      {state.phase === 'error' && (
        <p
          className="text-sm text-red-700 sm:basis-full"
          role="alert"
        >
          {state.message}
        </p>
      )}
    </form>
  )
}
