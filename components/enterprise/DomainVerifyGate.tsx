'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

type Stage =
  | { name: 'email_input' }
  | { name: 'otp_input'; inquiryId: string; email: string }
  | { name: 'verified' }

/**
 * Soft Complex-tier OTP gate (SPEC §4 size-based rules).
 *
 * Renders on /scanning/[scan_id] when Phase 1 detected a Large-tier site
 * (51–200 pages) and no verified inquiry exists yet for this scan. Unlike
 * AdminGate, there's no "Are you the admin?" question — by this point
 * we already know the user is self-serve and intends to scan their own
 * site. We just need a domain-matching email before charging ₹349.
 *
 * On success, calls `router.refresh()` so the scanning page re-renders
 * server-side: the verified inquiry is now visible, so the parent's
 * branching swaps the gate out for PriceGate.
 */
export function DomainVerifyGate({
  scanId,
  url,
  hostname,
  pageCount,
}: {
  scanId: string
  url: string
  hostname: string
  pageCount: number
}) {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>({ name: 'email_input' })

  function handleEmailSent(inquiryId: string, email: string) {
    setStage({ name: 'otp_input', inquiryId, email })
  }

  function handleVerified() {
    setStage({ name: 'verified' })
    // Server component re-runs, sees the verified inquiry, swaps in PriceGate.
    router.refresh()
  }

  if (stage.name === 'otp_input') {
    return (
      <OtpEntryStep
        inquiryId={stage.inquiryId}
        email={stage.email}
        onBack={() => setStage({ name: 'email_input' })}
        onVerified={handleVerified}
      />
    )
  }

  if (stage.name === 'verified') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <p className="text-sm font-medium text-emerald-900">
          ✓ Verified — loading your scan summary…
        </p>
      </div>
    )
  }

  return (
    <EmailEntryStep
      scanId={scanId}
      url={url}
      hostname={hostname}
      pageCount={pageCount}
      onSent={handleEmailSent}
    />
  )
}

// ─── Email entry — soft tone, no Yes/No ──────────────────────────────

function EmailEntryStep({
  scanId,
  url,
  hostname,
  pageCount,
  onSent,
}: {
  scanId: string
  url: string
  hostname: string
  pageCount: number
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
        body: JSON.stringify({ url, email: trimmed, scan_id: scanId }),
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
      <h2 className="text-lg font-semibold text-zinc-900">
        Verify you manage {hostname}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-700">
        This is a detailed website with {pageCount} pages. Enter your work
        email at {hostname} to continue. We use this to confirm you manage
        this site.
      </p>
      <form onSubmit={handleSubmit} aria-busy={busy} className="mt-4">
        <label htmlFor="domain-verify-email" className="sr-only">
          Work email
        </label>
        <input
          id="domain-verify-email"
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
          aria-describedby={error ? 'domain-verify-email-error' : undefined}
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand sm:max-w-md"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {busy ? 'Sending…' : 'Send code →'}
        </button>
      </form>
      {error && (
        <p
          id="domain-verify-email-error"
          role="alert"
          className="mt-3 text-sm text-amber-700"
        >
          {error}
        </p>
      )}
    </div>
  )
}

// ─── OTP entry — same shape as AdminGate's, simpler success path ─────

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
        <label htmlFor="domain-verify-otp" className="sr-only">
          6-digit code
        </label>
        <input
          id="domain-verify-otp"
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
          aria-describedby={error ? 'domain-verify-otp-error' : undefined}
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
          id="domain-verify-otp-error"
          role="alert"
          className="mt-3 text-sm text-amber-700"
        >
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Error message helpers — same shape as AdminGate's ───────────────

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
      return "This site doesn't require verification. Please refresh the page."
    case 'scan_not_found':
      return 'Scan not found. Please start a new scan from the homepage.'
    case 'already_paid':
      return 'This scan is already paid. Refresh the page to view your report.'
    case 'url_mismatch':
      return 'URL mismatch. Please refresh and try again.'
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
