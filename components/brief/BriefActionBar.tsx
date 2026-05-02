'use client'

import { useState } from 'react'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type DownloadState =
  | { phase: 'idle' }
  | { phase: 'generating' }
  | { phase: 'error'; message: string }

type SendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; email: string }
  | { phase: 'error'; message: string }

/**
 * Action bar for /brief/[scan_id]/full. Two independent surfaces:
 *
 *   1. Download PDF — fetch + blob pattern. Same as the report's
 *      ActionFooter download button. Browser-native download dialog,
 *      filename comes from the server's Content-Disposition header.
 *   2. Send to developer — email input + submit. Mirrors the report's
 *      SendToDeveloper form, talking to /api/brief/send instead.
 *
 * Each action has its own state machine so they can run independently —
 * an owner who's already downloaded the PDF can still email it to a
 * developer without restarting state.
 */
export function BriefActionBar({ briefId }: { briefId: string }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        Hand it to your developer
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">
        Download the PDF, or send it straight to your developer&apos;s email
        — whichever fits how you work with them.
      </p>

      <div className="mt-5 space-y-6">
        <DownloadRow briefId={briefId} />
        <div className="border-t border-zinc-100 pt-6">
          <SendDeveloperRow briefId={briefId} />
        </div>
      </div>
    </section>
  )
}

// ─── Download PDF ─────────────────────────────────────────────────────

function DownloadRow({ briefId }: { briefId: string }) {
  const [state, setState] = useState<DownloadState>({ phase: 'idle' })

  async function handleDownload() {
    if (state.phase === 'generating') return
    setState({ phase: 'generating' })
    try {
      const res = await fetch('/api/brief/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief_id: briefId }),
      })
      if (!res.ok) throw new Error(`PDF endpoint returned ${res.status}`)

      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = cd.match(/filename="?([^";]+)"?/i)
      const filename = match?.[1] ?? `fixmysite-brief-${briefId}.pdf`

      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)

      setState({ phase: 'idle' })
    } catch (err) {
      console.error('[brief-download] failed', err)
      setState({
        phase: 'error',
        message:
          'Could not generate the PDF. Try again, or email hello@fixmysite.in.',
      })
    }
  }

  const downloading = state.phase === 'generating'

  return (
    <div>
      <p className="text-sm font-medium text-zinc-900">Download as PDF</p>
      <p className="mt-1 text-xs text-zinc-500">
        Single-file PDF you can save, print, or attach to an email yourself.
      </p>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        aria-busy={downloading}
        className="mt-3 inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {downloading ? 'Generating PDF…' : 'Download PDF'}
      </button>
      {state.phase === 'error' && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {state.message}
        </p>
      )}
    </div>
  )
}

// ─── Send to developer ────────────────────────────────────────────────

function SendDeveloperRow({ briefId }: { briefId: string }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<SendState>({ phase: 'idle' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!EMAIL_RE.test(trimmed)) {
      setState({
        phase: 'error',
        message: "Enter a valid email — your developer's address.",
      })
      return
    }

    setState({ phase: 'sending' })
    try {
      const res = await fetch('/api/brief/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief_id: briefId,
          developer_email: trimmed,
        }),
      })

      if (res.status === 429) {
        setState({
          phase: 'error',
          message:
            'Too many sends from this device. Wait an hour or email hello@fixmysite.in.',
        })
        return
      }
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
          'Could not reach our server. Check your internet and try again.',
      })
    }
  }

  if (state.phase === 'sent') {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">
          Brief sent to {state.email}
        </p>
        <p className="mt-1 text-sm text-emerald-900">
          They&apos;ll receive the PDF in their inbox shortly. Reply with
          changes? Bugbite can update the brief — start a fresh one with
          your revisions.
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
      </div>
    )
  }

  const isSending = state.phase === 'sending'

  return (
    <div>
      <p className="text-sm font-medium text-zinc-900">Send to your developer</p>
      <p className="mt-1 text-xs text-zinc-500">
        Bugbite emails the PDF directly with a short note explaining what
        the brief is.
      </p>
      <form
        onSubmit={handleSubmit}
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        aria-busy={isSending}
        noValidate
      >
        <label htmlFor="brief-dev-email" className="sr-only">
          Developer&apos;s email
        </label>
        <input
          id="brief-dev-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="developer@example.com"
          value={email}
          disabled={isSending}
          onChange={(e) => {
            setEmail(e.target.value)
            if (state.phase === 'error') setState({ phase: 'idle' })
          }}
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
        />
        <button
          type="submit"
          disabled={isSending}
          aria-busy={isSending}
          className="inline-flex items-center justify-center rounded-lg border border-brand bg-transparent px-5 py-2.5 text-base font-medium text-brand transition-colors hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSending ? 'Sending…' : 'Send brief'}
        </button>
      </form>
      {state.phase === 'error' && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {state.message}
        </p>
      )}
    </div>
  )
}
