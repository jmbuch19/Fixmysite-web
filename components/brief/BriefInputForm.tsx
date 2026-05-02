'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PREDEFINED_CARDS, type PredefinedCardKey } from '@/constants/pricing'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FormState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'error'; message: string }

/**
 * Brief intake form — owner email + free-text concern + nudge cards.
 *
 * Submission flow: POST /api/brief/generate (which runs detector +
 * brief generator + scrub + persist), then redirect to
 * /brief/[scan_id]/preview where the latest brief surfaces.
 *
 * The cards aren't required (CLAUDE.md spec lets owners write only
 * free text), but a checked-in default of "encourage at least one"
 * helps Claude write tighter sections — owners with vague text and
 * zero cards tend to get briefs that lean generic.
 */
export function BriefInputForm({ scanId }: { scanId: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [text, setText] = useState('')
  const [cards, setCards] = useState<Set<PredefinedCardKey>>(new Set())
  const [state, setState] = useState<FormState>({ phase: 'idle' })

  function toggleCard(key: PredefinedCardKey) {
    setCards((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (state.phase === 'error') setState({ phase: 'idle' })
  }

  function clearErrorOnEdit() {
    if (state.phase === 'error') setState({ phase: 'idle' })
  }

  function validate(): string | null {
    if (!EMAIL_RE.test(email.trim())) {
      return 'Please enter a valid email — Bugbite emails the PDF here once the brief is unlocked.'
    }
    const trimmed = text.trim()
    if (trimmed.length < 10) {
      return 'Tell Bugbite a little more — at least one sentence about what you want to fix or add.'
    }
    if (trimmed.length > 5000) {
      return 'That is more than Bugbite can read in one go — please trim to under 5000 characters.'
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validate()
    if (err) {
      setState({ phase: 'error', message: err })
      return
    }

    setState({ phase: 'submitting' })
    try {
      const res = await fetch('/api/brief/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scan_id: scanId,
          owner_text: text.trim(),
          selected_cards: Array.from(cards),
          owner_email: email.trim().toLowerCase(),
        }),
      })

      if (res.status === 429) {
        setState({
          phase: 'error',
          message:
            'Too many brief generations from this device. Wait an hour and try again.',
        })
        return
      }

      if (res.status === 403) {
        setState({
          phase: 'error',
          message:
            'Bugbite needs a paid scan before generating a brief. The link you came from may be wrong — go back to your report.',
        })
        return
      }

      if (!res.ok) {
        setState({
          phase: 'error',
          message:
            'Bugbite ran into a problem generating your brief. Try again, or email hello@fixmysite.in if it keeps happening.',
        })
        return
      }

      // Brief is created + persisted. Latest-brief semantics on the
      // preview page mean we don't need to pass brief_id explicitly —
      // the preview reads "latest for this scan".
      router.push(`/brief/${scanId}/preview`)
    } catch {
      setState({
        phase: 'error',
        message:
          'Could not reach our server. Check your internet and try again.',
      })
    }
  }

  const submitting = state.phase === 'submitting'

  return (
    <form onSubmit={handleSubmit} className="space-y-6" aria-busy={submitting} noValidate>
      {/* ─── Email ─── */}
      <div>
        <label
          htmlFor="brief-email"
          className="block text-sm font-medium text-zinc-900"
        >
          Your email{' '}
          <span className="text-red-600" aria-hidden>
            *
          </span>
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Bugbite emails you the brief PDF as soon as it&apos;s unlocked.
        </p>
        <input
          id="brief-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          disabled={submitting}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            clearErrorOnEdit()
          }}
          placeholder="you@yourbusiness.com"
          className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
        />
      </div>

      {/* ─── Free text ─── */}
      <div>
        <label
          htmlFor="brief-text"
          className="block text-sm font-medium text-zinc-900"
        >
          What do you want fixed or added?{' '}
          <span className="text-red-600" aria-hidden>
            *
          </span>
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Plain language, any language — Hindi, Gujarati, English, or mixed.
          Bugbite translates your intent into a developer-ready brief.
        </p>
        <textarea
          id="brief-text"
          required
          disabled={submitting}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            clearErrorOnEdit()
          }}
          rows={5}
          placeholder="Site looks old. Contact form not working. Want online appointment booking…"
          className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
        />
        <p className="mt-1 text-right text-xs text-zinc-400">
          {text.length} / 5000
        </p>
      </div>

      {/* ─── Predefined cards ─── */}
      <fieldset>
        <legend className="text-sm font-medium text-zinc-900">
          Common concerns{' '}
          <span className="font-normal text-zinc-500">(optional)</span>
        </legend>
        <p className="mt-1 text-xs text-zinc-500">
          Pick anything that matches — Bugbite uses these to write tighter,
          more relevant sections.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PREDEFINED_CARDS.map((card) => {
            const checked = cards.has(card.key)
            return (
              <label
                key={card.key}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  checked
                    ? 'border-brand bg-brand-surface text-brand'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={submitting}
                  onChange={() => toggleCard(card.key)}
                  className="h-4 w-4 accent-brand"
                />
                <span>{card.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {/* ─── Submit ─── */}
      <div className="space-y-3">
        {state.phase === 'error' && (
          <p className="text-sm text-red-700" role="alert">
            {state.message}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="inline-flex w-full items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {submitting
            ? 'Bugbite is writing your brief…'
            : 'Generate my developer brief'}
        </button>
        <p className="text-xs text-zinc-500">
          Generation takes about 15-30 seconds. Bugbite sends you a free
          preview first; the full brief unlocks for ₹99.
        </p>
      </div>
    </form>
  )
}
