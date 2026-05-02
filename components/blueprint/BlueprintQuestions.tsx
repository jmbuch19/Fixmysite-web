'use client'

import { useState } from 'react'
import {
  BRANCH_1,
  BRANCH_3,
  BRANCH_4,
  BRANCH_5,
  BRANCH_6,
  BRANCH_7,
  TOTAL_STEPS,
  getBranch2,
  isQuestionActive,
  normalizeIndianMobile,
  type BusinessType,
  type Question,
} from '@/lib/blueprint/questions'

// All answers live in one flat record keyed by question.id. Multi-
// select answers are arrays; everything else is a string. Free-text
// follow-ups (e.g. "Other" institution type) are stored under
// `${questionId}_other`. Cleaner than nested branches and serialises
// directly into the JSONB column on submit.
type AnswerValue = string | string[]
type Answers = Record<string, AnswerValue>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | {
      phase: 'submitted'
      blueprintId: string
      ownerEmail: string
      ownerName: string
      businessName: string
    }
  | { phase: 'error'; message: string }

/**
 * Cascading wizard for the Blueprint Engine. Seven branches, Branch 2
 * shape resolves from Branch 1's answer. State is local React state —
 * nothing hits the database until the final submit on step 7 calls
 * /api/blueprint/create.
 *
 * Why a single component instead of one component per branch:
 * - Answers are global — every branch reads + writes the same record.
 *   Threading state through 7 sub-components is more boilerplate than
 *   value.
 * - Branch shape is data-driven (lib/blueprint/questions.ts). The
 *   wizard just renders whatever `getQuestionsForStep(currentStep)`
 *   returns — adding a new branch means editing the data, not the JSX.
 *
 * Progress indicator: "Step X of 7". The total stays constant even
 * though Branch 2 questions vary by path — owner sees the same
 * structure regardless of business type.
 */
export function BlueprintQuestions() {
  const [currentStep, setCurrentStep] = useState(1)
  const [answers, setAnswers] = useState<Answers>({})
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' })

  const businessType = answers.business_type as BusinessType | undefined

  const branchInfo = (() => {
    switch (currentStep) {
      case 1:
        return BRANCH_1
      case 2:
        return getBranch2(businessType)
      case 3:
        return BRANCH_3
      case 4:
        return BRANCH_4
      case 5:
        return BRANCH_5
      case 6:
        return BRANCH_6
      case 7:
        return BRANCH_7
      default:
        return BRANCH_1
    }
  })()

  function setAnswer(id: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
    if (submit.phase === 'error') setSubmit({ phase: 'idle' })
  }

  function getAnswer(id: string): AnswerValue | undefined {
    return answers[id]
  }

  // Validation per branch. The wizard refuses to advance until every
  // required answer on the current branch is satisfied. Questions whose
  // `dependsOn` predicate is unmet are skipped — they aren't visible
  // to the owner, so refusing to advance over them would strand them.
  function validateCurrentBranch(): string | null {
    for (const q of branchInfo.questions) {
      if (!isQuestionActive(q, answers)) continue
      const v = answers[q.id]
      if (q.kind === 'radio') {
        if (typeof v !== 'string' || v.length === 0) {
          return 'Pick an option to continue.'
        }
        // Follow-up text input (e.g. "Other" → free text). Optional
        // by default; required only when the option's followUp.optional
        // is explicitly false.
        if (q.followUp && v === q.followUp.triggerValue && !q.followUp.optional) {
          const fu = answers[`${q.id}_other`]
          if (typeof fu !== 'string' || fu.trim().length === 0) {
            return 'Add a few words for the "Other" option.'
          }
        }
      } else if (q.kind === 'checkbox') {
        const arr = Array.isArray(v) ? v : []
        const min = q.minSelected ?? 0
        if (arr.length < min) {
          return min === 1
            ? 'Pick at least one option to continue.'
            : `Pick at least ${min} options to continue.`
        }
      } else if (q.kind === 'text') {
        if (typeof v !== 'string' || v.trim().length === 0) {
          return 'Add a short answer to continue.'
        }
        const min = q.minLength ?? 0
        if (v.trim().length < min) {
          return 'A bit more detail, please — at least a few characters.'
        }
      } else if (q.kind === 'textarea') {
        const trimmed = typeof v === 'string' ? v.trim() : ''
        // Optional textareas: empty is fine. If the owner did type
        // something, still apply minLength so we never persist a
        // single-character "a" by accident.
        if (q.optional && trimmed.length === 0) continue
        const min = q.minLength ?? 10
        if (trimmed.length < min) {
          return 'Tell Bugbite a little more — at least one sentence.'
        }
      } else if (q.kind === 'email') {
        if (typeof v !== 'string' || !EMAIL_RE.test(v.trim())) {
          return 'Add a valid email — Bugbite sends your blueprint here.'
        }
      } else if (q.kind === 'tel') {
        // Optional WhatsApp: empty is fine. If filled, must be a valid
        // Indian mobile so we never persist garbage.
        const trimmed = typeof v === 'string' ? v.trim() : ''
        if (trimmed.length === 0) {
          if (!q.optional) return 'Add your WhatsApp number to continue.'
        } else if (!normalizeIndianMobile(trimmed)) {
          return 'That doesn\'t look like an Indian mobile number — try 10 digits, optionally with +91.'
        }
      }
    }
    return null
  }

  function handleNext() {
    const err = validateCurrentBranch()
    if (err) {
      setSubmit({ phase: 'error', message: err })
      return
    }
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep((s) => s + 1)
      // Scroll to top of the form area on advance — the owner gets a
      // fresh viewport for the new branch instead of starting halfway
      // down the page.
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }
  }

  function handleBack() {
    if (submit.phase === 'error') setSubmit({ phase: 'idle' })
    if (currentStep > 1) {
      setCurrentStep((s) => s - 1)
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }
  }

  async function handleSubmit() {
    const err = validateCurrentBranch()
    if (err) {
      setSubmit({ phase: 'error', message: err })
      return
    }

    setSubmit({ phase: 'submitting' })

    // Identity + contact fields are pulled out of the answers map so
    // they can land in dedicated DB columns. Everything else — radio
    // answers, checkbox arrays, follow-up text, business_location,
    // operating_mode, existing_presence, domain_ideas — stays inside
    // the answers JSONB and is read by Claude in Session 2.
    const {
      free_text: freeText,
      owner_email: ownerEmail,
      owner_name: ownerName,
      business_name: businessName,
      whatsapp_number: whatsappNumberRaw,
      ...restAnswers
    } = answers

    const whatsappE164 =
      typeof whatsappNumberRaw === 'string' && whatsappNumberRaw.trim().length > 0
        ? normalizeIndianMobile(whatsappNumberRaw.trim())
        : null

    try {
      const res = await fetch('/api/blueprint/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_type: businessType ?? null,
          answers: restAnswers,
          free_text: typeof freeText === 'string' ? freeText : null,
          owner_email:
            typeof ownerEmail === 'string'
              ? ownerEmail.trim().toLowerCase()
              : null,
          owner_name: typeof ownerName === 'string' ? ownerName.trim() : null,
          business_name:
            typeof businessName === 'string' ? businessName.trim() : null,
          whatsapp_number: whatsappE164,
        }),
      })

      if (res.status === 429) {
        setSubmit({
          phase: 'error',
          message:
            'Too many submissions from this device. Wait an hour and try again.',
        })
        return
      }

      if (!res.ok) {
        setSubmit({
          phase: 'error',
          message:
            'Something went wrong saving your answers. Try again, or email hello@fixmysite.in.',
        })
        return
      }

      const body = (await res.json()) as { ok: boolean; blueprint_id: string }
      // Session 1 lands the wizard + draft persistence only. Claude
      // generation + preview/full pages ship in Session 2; for now
      // we render a self-contained success card so the owner sees
      // confirmation that submit worked. The blueprint_id is shown
      // so testers can cross-reference the Supabase row.
      setSubmit({
        phase: 'submitted',
        blueprintId: body.blueprint_id,
        ownerEmail:
          typeof ownerEmail === 'string' ? ownerEmail.trim().toLowerCase() : '',
        ownerName: typeof ownerName === 'string' ? ownerName.trim() : '',
        businessName:
          typeof businessName === 'string' ? businessName.trim() : '',
      })
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch {
      setSubmit({
        phase: 'error',
        message: 'Could not reach our server. Check your internet and try again.',
      })
    }
  }

  const isLastStep = currentStep === TOTAL_STEPS
  const submitting = submit.phase === 'submitting'

  if (submit.phase === 'submitted') {
    const greeting = submit.ownerName
      ? `Thanks, ${submit.ownerName.split(' ')[0]}.`
      : 'Bugbite has your answers.'
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-xl font-semibold text-emerald-900">{greeting}</h2>
        <p className="mt-3 text-sm leading-relaxed text-emerald-900">
          {submit.businessName ? (
            <>
              Bugbite is preparing the full website recommendation for{' '}
              <span className="font-semibold">{submit.businessName}</span>{' '}
              — what kind of site fits, the right technology, the right
              budget, and a step-by-step plan.
            </>
          ) : (
            <>
              Your blueprint is in the queue. Bugbite is preparing your
              full website recommendation — what kind of site fits, the
              right technology, the right budget, and a step-by-step plan.
            </>
          )}
        </p>
        {submit.ownerEmail ? (
          <p className="mt-3 text-sm leading-relaxed text-emerald-900">
            The full blueprint preview lands in the next release. You can
            close this tab — Bugbite will email{' '}
            <span className="font-semibold">{submit.ownerEmail}</span>{' '}
            with the link as soon as it&apos;s ready.
          </p>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-emerald-900">
            The full blueprint preview lands in the next release. You can
            close this tab — Bugbite will email you the link as soon as
            it&apos;s ready.
          </p>
        )}
        <p className="mt-4 text-xs text-emerald-900/70">
          Reference: {submit.blueprintId}
        </p>
      </section>
    )
  }

  return (
    <div>
      {/* Progress strip */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span className="font-semibold uppercase tracking-wider text-brand">
            Step {currentStep} of {TOTAL_STEPS}
          </span>
          <span>{Math.round((currentStep / TOTAL_STEPS) * 100)}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full bg-brand transition-all duration-300"
            style={{ width: `${(currentStep / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {/* Branch heading */}
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
        {branchInfo.title}
      </h2>

      {/* Questions */}
      <div className="mt-8 space-y-8">
        {branchInfo.questions
          .filter((q) => isQuestionActive(q, answers))
          .map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={getAnswer(q.id)}
              followUpValue={
                typeof getAnswer(`${q.id}_other`) === 'string'
                  ? (getAnswer(`${q.id}_other`) as string)
                  : ''
              }
              onChange={(v) => setAnswer(q.id, v)}
              onFollowUpChange={(s) => setAnswer(`${q.id}_other`, s)}
              disabled={submitting}
            />
          ))}
      </div>

      {/* Error */}
      {submit.phase === 'error' && (
        <p
          className="mt-6 text-sm text-red-700"
          role="alert"
        >
          {submit.message}
        </p>
      )}

      {/* Navigation */}
      <div className="mt-10 flex flex-col gap-3 border-t border-zinc-100 pt-6 sm:flex-row sm:justify-between">
        <button
          type="button"
          onClick={handleBack}
          disabled={currentStep === 1 || submitting}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Back
        </button>
        {isLastStep ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            aria-busy={submitting}
            className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Submit my answers'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Field renderer ────────────────────────────────────────────────────

function QuestionField({
  question,
  value,
  followUpValue,
  onChange,
  onFollowUpChange,
  disabled,
}: {
  question: Question
  value: AnswerValue | undefined
  followUpValue: string
  onChange: (v: AnswerValue) => void
  onFollowUpChange: (s: string) => void
  disabled: boolean
}) {
  switch (question.kind) {
    case 'radio': {
      const selected = typeof value === 'string' ? value : ''
      const showFollowUp =
        question.followUp && selected === question.followUp.triggerValue
      return (
        <fieldset>
          <legend className="text-base font-medium text-zinc-900">
            {question.label}
          </legend>
          <div className="mt-3 space-y-2">
            {question.options.map((opt) => {
              const checked = selected === opt.value
              return (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                    checked
                      ? 'border-brand bg-brand-surface text-zinc-900'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                  }`}
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={opt.value}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onChange(opt.value)}
                    className="mt-0.5 h-4 w-4 accent-brand"
                  />
                  <span className="leading-relaxed">{opt.label}</span>
                </label>
              )
            })}
          </div>
          {showFollowUp && (
            <input
              type="text"
              value={followUpValue}
              disabled={disabled}
              onChange={(e) => onFollowUpChange(e.target.value)}
              placeholder={question.followUp?.placeholder ?? ''}
              className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
            />
          )}
        </fieldset>
      )
    }

    case 'checkbox': {
      const selected = Array.isArray(value) ? value : []
      function toggle(v: string) {
        if (selected.includes(v)) {
          onChange(selected.filter((x) => x !== v))
        } else {
          onChange([...selected, v])
        }
      }
      return (
        <fieldset>
          <legend className="text-base font-medium text-zinc-900">
            {question.label}
          </legend>
          {question.helper && (
            <p className="mt-1 text-xs text-zinc-500">{question.helper}</p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {question.options.map((opt) => {
              const checked = selected.includes(opt.value)
              return (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                    checked
                      ? 'border-brand bg-brand-surface text-zinc-900'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(opt.value)}
                    className="mt-0.5 h-4 w-4 accent-brand"
                  />
                  <span className="leading-relaxed">{opt.label}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )
    }

    case 'text': {
      const v = typeof value === 'string' ? value : ''
      return (
        <div>
          <label
            htmlFor={question.id}
            className="block text-base font-medium text-zinc-900"
          >
            {question.label}
          </label>
          {question.helper && (
            <p className="mt-1 text-xs text-zinc-500">{question.helper}</p>
          )}
          <input
            id={question.id}
            type="text"
            value={v}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder ?? ''}
            maxLength={question.maxLength}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
          />
        </div>
      )
    }

    case 'textarea': {
      const v = typeof value === 'string' ? value : ''
      const rows = question.rows ?? 5
      const max = question.maxLength ?? 5000
      return (
        <div>
          <label
            htmlFor={question.id}
            className="block text-base font-medium text-zinc-900"
          >
            {question.label}
          </label>
          {question.helper && (
            <p className="mt-1 text-xs text-zinc-500">{question.helper}</p>
          )}
          <textarea
            id={question.id}
            value={v}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder ?? ''}
            rows={rows}
            maxLength={max}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
            <span>{question.examples ? '' : ''}</span>
            <span>
              {v.length} / {max}
            </span>
          </div>
          {question.examples && question.examples.length > 0 && (
            <div className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50/70 p-3 text-xs text-zinc-600">
              <p className="font-semibold uppercase tracking-wider text-zinc-500">
                Examples people have written
              </p>
              <ul className="mt-2 space-y-2">
                {question.examples.map((ex, i) => (
                  <li key={i} className="italic leading-relaxed">
                    {ex}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )
    }

    case 'email': {
      const v = typeof value === 'string' ? value : ''
      return (
        <div>
          <label
            htmlFor={question.id}
            className="block text-base font-medium text-zinc-900"
          >
            {question.label}
          </label>
          {question.helper && (
            <p className="mt-1 text-xs text-zinc-500">{question.helper}</p>
          )}
          <input
            id={question.id}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={v}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder ?? 'you@yourbusiness.com'}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-50"
          />
        </div>
      )
    }

    case 'tel': {
      const v = typeof value === 'string' ? value : ''
      return (
        <div>
          <label
            htmlFor={question.id}
            className="block text-base font-medium text-zinc-900"
          >
            {question.label}
          </label>
          {question.helper && (
            <p className="mt-1 text-xs text-zinc-500">{question.helper}</p>
          )}
          <div className="mt-2 flex overflow-hidden rounded-lg border border-zinc-300 bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
            <span className="flex select-none items-center border-r border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500">
              +91
            </span>
            <input
              id={question.id}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={v}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              placeholder={question.placeholder ?? '98765 43210'}
              maxLength={20}
              className="flex-1 bg-transparent px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:bg-zinc-50"
            />
          </div>
        </div>
      )
    }
  }
}
