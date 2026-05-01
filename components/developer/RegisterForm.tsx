'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  DEVELOPER_SKILLS,
  YEARS_EXP_OPTIONS,
  type DeveloperSkill,
} from '@/lib/developer/skills'

type FormState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success'; alreadyRegistered: boolean }
  | { phase: 'error'; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Permissive: accept +91 prefix or bare 10-digit numbers, allow spaces
// and dashes for natural typing. Server tightens validation.
const PHONE_RE = /^[+\d][\d\s\-]{6,19}$/

export function RegisterForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [skills, setSkills] = useState<Set<DeveloperSkill>>(new Set())
  const [portfolio, setPortfolio] = useState('')
  const [yearsExp, setYearsExp] = useState<number | null>(null)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [state, setState] = useState<FormState>({ phase: 'idle' })

  function toggleSkill(skill: DeveloperSkill) {
    setSkills((prev) => {
      const next = new Set(prev)
      if (next.has(skill)) next.delete(skill)
      else next.add(skill)
      return next
    })
    // If the user is fixing a past error, clear the error state on
    // any subsequent edit so the form doesn't keep showing stale copy.
    if (state.phase === 'error') setState({ phase: 'idle' })
  }

  function clearErrorOnEdit() {
    if (state.phase === 'error') setState({ phase: 'idle' })
  }

  function validate(): string | null {
    if (name.trim().length < 2) return 'Please enter your full name.'
    if (!EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.'
    if (!PHONE_RE.test(phone.trim()))
      return 'Please enter a valid phone or WhatsApp number.'
    if (city.trim().length < 2) return 'Please enter your city.'
    if (skills.size === 0) return 'Please select at least one skill.'
    if (yearsExp === null) return 'Please pick your years of experience.'
    if (
      portfolio.trim().length > 0 &&
      !/^https?:\/\//i.test(portfolio.trim())
    ) {
      return 'Portfolio URL should start with http:// or https://'
    }
    if (!agreedToTerms) {
      return 'Please agree to the partner terms to register.'
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const error = validate()
    if (error) {
      setState({ phase: 'error', message: error })
      return
    }

    setState({ phase: 'submitting' })
    try {
      const res = await fetch('/api/developer/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          city: city.trim(),
          skills: Array.from(skills),
          portfolio_url: portfolio.trim(),
          years_exp: yearsExp,
        }),
      })

      if (res.status === 429) {
        setState({
          phase: 'error',
          message:
            'Too many registration attempts from this device. Wait an hour and try again.',
        })
        return
      }
      if (!res.ok) {
        setState({
          phase: 'error',
          message:
            'Could not submit. Please try again, or email hello@fixmysite.in.',
        })
        return
      }
      const body = (await res.json()) as {
        ok: boolean
        already_registered?: boolean
      }
      setState({
        phase: 'success',
        alreadyRegistered: body.already_registered === true,
      })
    } catch {
      setState({
        phase: 'error',
        message:
          'Could not reach our server. Check your internet and try again.',
      })
    }
  }

  if (state.phase === 'success') {
    return <SuccessCard alreadyRegistered={state.alreadyRegistered} />
  }

  const submitting = state.phase === 'submitting'

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
      aria-busy={submitting}
      noValidate
    >
      {/* ─── Name + Email ─── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="dev-name" required>
          <input
            id="dev-name"
            type="text"
            autoComplete="name"
            required
            disabled={submitting}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              clearErrorOnEdit()
            }}
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
          />
        </Field>

        <Field label="Email" htmlFor="dev-email" required>
          <input
            id="dev-email"
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
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
          />
        </Field>
      </div>

      {/* ─── Phone + City ─── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="WhatsApp number" htmlFor="dev-phone" required>
          <input
            id="dev-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            placeholder="+91 9XXXX XXXXX"
            disabled={submitting}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              clearErrorOnEdit()
            }}
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
          />
        </Field>

        <Field label="City" htmlFor="dev-city" required>
          <input
            id="dev-city"
            type="text"
            autoComplete="address-level2"
            required
            placeholder="Ahmedabad"
            disabled={submitting}
            value={city}
            onChange={(e) => {
              setCity(e.target.value)
              clearErrorOnEdit()
            }}
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
          />
        </Field>
      </div>

      {/* ─── Skills (checkboxes) ─── */}
      <fieldset>
        <legend className="text-sm font-medium text-zinc-900">
          What do you build?{' '}
          <span className="text-red-600" aria-hidden>
            *
          </span>
        </legend>
        <p className="mt-1 text-xs text-zinc-500">
          Pick everything you handle confidently — Bugbite uses this to
          match you with the right clients.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DEVELOPER_SKILLS.map((skill) => {
            const checked = skills.has(skill)
            return (
              <label
                key={skill}
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
                  onChange={() => toggleSkill(skill)}
                  className="h-4 w-4 accent-brand"
                />
                <span>{skill}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {/* ─── Years experience ─── */}
      <Field
        label="Years of experience"
        htmlFor="dev-years-exp"
        required
      >
        <select
          id="dev-years-exp"
          required
          disabled={submitting}
          value={yearsExp ?? ''}
          onChange={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value)
            setYearsExp(v)
            clearErrorOnEdit()
          }}
          className="input"
        >
          <option value="" disabled>
            Pick a range…
          </option>
          {YEARS_EXP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>

      {/* ─── Portfolio (optional) ─── */}
      <Field label="Portfolio URL" htmlFor="dev-portfolio" optional>
        <input
          id="dev-portfolio"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://"
          disabled={submitting}
          value={portfolio}
          onChange={(e) => {
            setPortfolio(e.target.value)
            clearErrorOnEdit()
          }}
          className="input"
        />
      </Field>

      {/* ─── Partner terms consent ─── */}
      {/* The full terms live at /terms §6. This in-form summary is a
          plain-language disclosure of the most material points so a
          developer never signs up confused about who's responsible for
          what. Checkbox is required — `validate()` blocks submit
          without it. */}
      <fieldset className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-zinc-600">
          How fixmysite.in works for partners
        </legend>
        <ul className="space-y-2 text-sm text-zinc-700">
          <li className="flex gap-2">
            <span aria-hidden className="text-brand">
              •
            </span>
            <span>
              fixmysite.in introduces leads. Project fee, scope, and
              payment are <strong>between you and the client</strong>.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-brand">
              •
            </span>
            <span>
              Bugbite charges a <strong>₹200 platform fee per accepted
              lead</strong>. No fee if you decline a lead.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-brand">
              •
            </span>
            <span>
              You handle your own GST, invoicing, and tax. fixmysite.in
              is not a party to your project agreement.
            </span>
          </li>
        </ul>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            checked={agreedToTerms}
            disabled={submitting}
            onChange={(e) => {
              setAgreedToTerms(e.target.checked)
              clearErrorOnEdit()
            }}
            className="mt-0.5 h-4 w-4 accent-brand"
            required
          />
          <span>
            I understand and agree to the{' '}
            <Link
              href="/terms#6-developer-partners"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline underline-offset-2 hover:text-brand-accent"
            >
              partner terms
            </Link>
            .
          </span>
        </label>
      </fieldset>

      {/* ─── Submit ─── */}
      <div className="space-y-3 pt-2">
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
          {submitting ? 'Submitting…' : 'Submit registration'}
        </button>
        <p className="text-xs text-zinc-500">
          Bugbite reviews each application within 48 hours. Approved partners
          get a "fixmysite.in Certified Partner" badge and start receiving
          leads.
        </p>
      </div>
    </form>
  )
}

// ─── Small layout helpers ──────────────────────────────────────────────

function Field({
  label,
  htmlFor,
  required,
  optional,
  children,
}: {
  label: string
  htmlFor: string
  required?: boolean
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-zinc-900"
      >
        {label}
        {required && (
          <span className="ml-1 text-red-600" aria-hidden>
            *
          </span>
        )}
        {optional && (
          <span className="ml-1 text-xs font-normal text-zinc-500">
            (optional)
          </span>
        )}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function SuccessCard({ alreadyRegistered }: { alreadyRegistered: boolean }) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
      <h2 className="text-lg font-semibold text-emerald-900">
        {alreadyRegistered
          ? 'Bugbite has your registration on file'
          : 'Registration received'}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-emerald-900">
        {alreadyRegistered
          ? "This email is already in our queue. If your application is still pending, Bugbite will reach out within 48 hours of your original submission. Already approved? Watch your WhatsApp for lead notifications."
          : "Bugbite will review your application within 48 hours. Once approved, you will receive a 'fixmysite.in Certified Partner' badge and start receiving lead notifications on the WhatsApp number you provided."}
      </p>
      <p className="mt-3 text-sm text-emerald-900/80">
        Questions in the meantime — write to{' '}
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
