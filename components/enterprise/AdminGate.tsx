'use client'

import { useState, type FormEvent } from 'react'
import { captureEvent } from '@/lib/analytics/posthog'

type Stage =
  | { name: 'gate' }
  | { name: 'email_input' }
  | { name: 'otp_input'; inquiryId: string; email: string }
  | { name: 'inquiry_success' }
  | { name: 'fun_seeker_exit' }

/**
 * "Are you the admin?" gate (SPEC §4) — entry point for Path A/B (global
 * and Indian enterprise) URLs that need manual approval.
 *
 * Internal state machine:
 *   gate → email_input → otp_input → inquiry_success
 *        ↘ fun_seeker_exit (Path E — zero DB rows)
 *
 * The component owns all state for the entire enterprise verification
 * flow. ScanForm only knows when the user wants to start fresh (`onExit`).
 */
export function AdminGate({
  url,
  hostname,
  urlClass,
  onExit,
}: {
  url: string
  hostname: string
  urlClass: 'global_enterprise' | 'indian_enterprise'
  onExit: () => void
}) {
  const [stage, setStage] = useState<Stage>({ name: 'gate' })

  function handleYes() {
    setStage({ name: 'email_input' })
  }

  function handleNo() {
    // Fire BEFORE rendering the exit screen so the analytics event is
    // recorded even if the user navigates away on the next breath. No DB
    // row is touched on this path — only an analytics ping.
    captureEvent('fun_seeker_exit', { hostname, url_class: urlClass })
    setStage({ name: 'fun_seeker_exit' })
  }

  function handleEmailSent(inquiryId: string, email: string) {
    setStage({ name: 'otp_input', inquiryId, email })
  }

  function handleOtpVerified() {
    setStage({ name: 'inquiry_success' })
  }

  function handleBackToGate() {
    setStage({ name: 'gate' })
  }

  if (stage.name === 'email_input') {
    return (
      <EmailEntryStep
        url={url}
        hostname={hostname}
        onBack={handleBackToGate}
        onSent={handleEmailSent}
      />
    )
  }

  if (stage.name === 'otp_input') {
    return (
      <OtpEntryStep
        inquiryId={stage.inquiryId}
        email={stage.email}
        onBack={handleBackToGate}
        onVerified={handleOtpVerified}
      />
    )
  }

  if (stage.name === 'inquiry_success') {
    return <InquirySuccess />
  }

  if (stage.name === 'fun_seeker_exit') {
    return <FunSeekerExit onTryAgain={onExit} />
  }

  // Default: the gate
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        {hostname} looks like a large website
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-700">
        fixmysite.in is built for Indian small businesses — but we scan
        large sites too, at a different price. Are you responsible for
        this website?
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleYes}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent"
        >
          Yes, I manage this site
        </button>
        <button
          type="button"
          onClick={handleNo}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-3 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          No, just curious
        </button>
      </div>
    </div>
  )
}

// ─── Email entry step ──────────────────────────────────────────────────

function EmailEntryStep({
  url,
  hostname,
  onBack,
  onSent,
}: {
  url: string
  hostname: string
  onBack: () => void
  onSent: (inquiryId: string, email: string) => void
}) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return

    setBusy(true)
    setError(null)

    let res: Response
    try {
      res = await fetch('/api/enterprise/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, email: trimmed }),
      })
    } catch {
      setError('Network error. Please try again.')
      setBusy(false)
      return
    }

    if (res.status === 429) {
      const data = (await res.json().catch(() => null)) as
        | { reason?: string; seconds_until_resend?: number }
        | null
      if (data?.reason === 'throttled') {
        const seconds = data.seconds_until_resend ?? 60
        setError(`Please wait ${seconds} seconds before requesting another code.`)
      } else {
        setError(
          "You've requested too many codes. Try again in an hour, or contact us at hello@fixmysite.in.",
        )
      }
      setBusy(false)
      return
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { reason?: string; error?: string }
        | null
      setError(mapVerifyEmailError(data, hostname))
      setBusy(false)
      return
    }

    const data = (await res.json().catch(() => null)) as
      | { inquiry_id?: string }
      | null
    if (!data?.inquiry_id) {
      setError('Something went wrong. Please try again.')
      setBusy(false)
      return
    }

    onSent(data.inquiry_id, trimmed.toLowerCase())
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
      >
        ← Back
      </button>
      <h2 className="mt-3 text-lg font-semibold text-zinc-900">
        Verify with your work email
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-700">
        To request a scan of {hostname}, we need to confirm you manage
        this site. Enter your work email at this domain — we&apos;ll send
        a 6-digit code.
      </p>
      <form onSubmit={handleSubmit} aria-busy={busy} className="mt-4">
        <label htmlFor="work-email" className="sr-only">
          Work email
        </label>
        <input
          id="work-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (error) setError(null)
          }}
          placeholder={`yourname@${hostname}`}
          required
          aria-invalid={error !== null}
          aria-describedby={error ? 'work-email-error' : undefined}
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand sm:max-w-md"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {busy ? 'Sending…' : 'Send verification code'}
        </button>
      </form>
      {error && (
        <p
          id="work-email-error"
          role="alert"
          className="mt-3 text-sm text-amber-700"
        >
          {error}
        </p>
      )}
    </div>
  )
}

// ─── OTP entry step ────────────────────────────────────────────────────

function OtpEntryStep({
  inquiryId,
  email,
  onBack,
  onVerified,
}: {
  inquiryId: string
  email: string
  onBack: () => void
  onVerified: () => void
}) {
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = otp.trim()
    if (trimmed.length !== 6) return

    setBusy(true)
    setError(null)

    let res: Response
    try {
      res = await fetch('/api/enterprise/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inquiry_id: inquiryId, otp: trimmed }),
      })
    } catch {
      setError('Network error. Try again.')
      setBusy(false)
      return
    }

    if (res.status === 429) {
      const data = (await res.json().catch(() => null)) as
        | { reason?: string }
        | null
      if (data?.reason === 'locked') {
        setError(
          'This verification has been locked after too many attempts. Please start again.',
        )
      } else {
        setError("You've made too many requests. Try again in an hour.")
      }
      setBusy(false)
      return
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { reason?: string; error?: string; attempts_remaining?: number }
        | null
      setError(mapVerifyOtpError(data))
      setBusy(false)
      return
    }

    onVerified()
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-zinc-600 transition-colors hover:text-zinc-900"
      >
        ← Back
      </button>
      <h2 className="mt-3 text-lg font-semibold text-zinc-900">
        Enter the code we sent
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-700">
        We&apos;ve sent a 6-digit code to <strong>{email}</strong>. Check
        your inbox and enter it below. Valid for 15 minutes.
      </p>
      <form onSubmit={handleSubmit} aria-busy={busy} className="mt-4">
        <label htmlFor="otp" className="sr-only">
          6-digit code
        </label>
        <input
          id="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={otp}
          onChange={(e) => {
            setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
            if (error) setError(null)
          }}
          placeholder="123456"
          required
          aria-invalid={error !== null}
          aria-describedby={error ? 'otp-error' : undefined}
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-center text-base tracking-[0.5em] text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand sm:max-w-xs"
        />
        <button
          type="submit"
          disabled={busy || otp.length !== 6}
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {busy ? 'Verifying…' : 'Verify'}
        </button>
      </form>
      {error && (
        <p
          id="otp-error"
          role="alert"
          className="mt-3 text-sm text-amber-700"
        >
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Terminal states ──────────────────────────────────────────────────

function InquirySuccess() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        Thank you. We&apos;ve received your request.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-700">
        We&apos;ll be in touch within 24 hours with a custom quote and
        next steps.
      </p>
    </div>
  )
}

function FunSeekerExit({ onTryAgain }: { onTryAgain: () => void }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">No problem.</h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-700">
        fixmysite.in is built for website owners and managers. Paste a
        site you manage to get started.
      </p>
      <button
        type="button"
        onClick={onTryAgain}
        className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent"
      >
        Try a site you manage
      </button>
    </div>
  )
}

// ─── Error message helpers ────────────────────────────────────────────

function mapVerifyEmailError(
  data: { reason?: string; error?: string } | null,
  hostname: string,
): string {
  switch (data?.reason) {
    case 'free_provider':
      return `Please use your work email at ${hostname}. Personal email addresses like Gmail cannot be used to verify website ownership.`
    case 'domain_mismatch':
      return `The email you entered doesn't match ${hostname}. Use an email like yourname@${hostname} to verify you manage this site.`
    case 'invalid_email':
      return 'Please enter a valid email address.'
    case 'no_mx_record':
      return `That email address can't receive mail. Try a different email at ${hostname}.`
    case 'invalid_url':
      return 'The website URL is invalid. Please start over.'
    case 'not_required':
      return "This site doesn't require verification. Please start over."
    case 'send_failed':
      return 'Could not send the code right now. Please wait a moment and try again.'
    case 'db_error':
      return 'Something went wrong on our end. Please try again in a moment.'
    default:
      return data?.error || 'Could not send verification code. Please try again.'
  }
}

function mapVerifyOtpError(
  data:
    | { reason?: string; error?: string; attempts_remaining?: number }
    | null,
): string {
  switch (data?.reason) {
    case 'wrong_code': {
      const remaining = data.attempts_remaining ?? 0
      if (remaining <= 0) return 'Wrong code. Try again.'
      const noun = remaining === 1 ? 'attempt' : 'attempts'
      return `Wrong code. ${remaining} ${noun} remaining.`
    }
    case 'expired':
      return 'Code has expired. Please start again.'
    case 'locked':
      return 'This verification has been locked after too many attempts. Please start again.'
    case 'no_code':
      return 'No code on file. Please start again.'
    default:
      return data?.error || 'Could not verify code. Try again.'
  }
}
