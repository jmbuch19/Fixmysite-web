'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Phase1Tier } from '@/lib/scan/phase1'

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'
const BRAND_COLOR = '#0F6E56'
const SUPPORT_EMAIL = 'reports@fixmysite.in'

type PaidTier = Exclude<Phase1Tier, 'enterprise'>

const TIER_LABELS: Record<PaidTier, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

type PaymentState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'opening' }
  | { phase: 'verifying' }
  // Brief transitional state shown after Phase 2 has been queued and we
  // are about to redirect to /report/[scan_id]/full. ≤800ms — just long
  // enough to feel intentional. No spinner. No button. Just the message.
  | { phase: 'preparing' }
  | { phase: 'failed'; message: string; supportable?: boolean }

type CreateOrderResponse = {
  order_id: string
  amount: number
  currency: string
  key_id: string
}

type RazorpaySuccessResponse = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

type RazorpayFailedResponse = {
  error?: { description?: string; reason?: string; code?: string }
}

type RazorpayInstance = {
  open: () => void
  on: (event: 'payment.failed', cb: (resp: RazorpayFailedResponse) => void) => void
}

type RazorpayOptions = {
  key: string
  amount: number
  currency: string
  order_id: string
  name: string
  description: string
  theme: { color: string }
  prefill: { name?: string; email?: string; contact?: string }
  modal: { ondismiss: () => void; escape: boolean }
  handler: (response: RazorpaySuccessResponse) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

export function PriceGate({
  scan_id,
  tier,
  price,
}: {
  scan_id: string
  tier: PaidTier
  price: number
}) {
  const router = useRouter()
  const [state, setState] = useState<PaymentState>({ phase: 'idle' })

  // ─── Sub-step 1: Load Razorpay script client-side ─────────────────────
  // Inject once per page. Skip if window.Razorpay is already populated
  // (back-nav from /report → /scanning) or the <script> tag is already
  // in the DOM (StrictMode double-mount, multiple PriceGates on the page).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.Razorpay) return
    if (document.querySelector(`script[src="${RAZORPAY_SCRIPT_SRC}"]`)) return

    const script = document.createElement('script')
    script.src = RAZORPAY_SCRIPT_SRC
    script.async = true
    document.body.appendChild(script)
  }, [])

  // Wait up to 5s for window.Razorpay to appear. Resolves immediately if
  // already present, rejects on timeout so handlePay can show a retry.
  function waitForRazorpay(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window !== 'undefined' && window.Razorpay) return resolve()
      const start = Date.now()
      const interval = setInterval(() => {
        if (typeof window !== 'undefined' && window.Razorpay) {
          clearInterval(interval)
          resolve()
        } else if (Date.now() - start > 5000) {
          clearInterval(interval)
          reject(new Error('razorpay_script_timeout'))
        }
      }, 50)
    })
  }

  async function handlePay() {
    if (state.phase === 'starting' || state.phase === 'opening' || state.phase === 'verifying') {
      return
    }
    setState({ phase: 'starting' })

    // Script must be available before we can construct the modal.
    try {
      await waitForRazorpay()
    } catch {
      setState({
        phase: 'failed',
        message:
          'Could not load the payment system. Check your internet connection and try again.',
      })
      return
    }

    // ─── Sub-step 2: POST /api/payment/create-order ─────────────────────
    let orderResp: CreateOrderResponse
    try {
      const res = await fetch('/api/payment/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan_id }),
      })

      if (res.status === 409) {
        // Already paid in another tab — race condition. Take them to the report.
        router.push(`/report/${scan_id}/full`)
        return
      }

      if (res.status === 400) {
        // Site outgrew automated checkout (rare race) — route to enterprise contact.
        const data = (await res.json().catch(() => null)) as
          | { action?: string; contact_url?: string }
          | null
        if (data?.action === 'contact_us') {
          router.push(data.contact_url ?? '/agency')
          return
        }
        setState({
          phase: 'failed',
          message: 'Could not start payment. Refresh the page and try again.',
        })
        return
      }

      if (!res.ok) {
        setState({
          phase: 'failed',
          message: 'Could not start payment. Try again in a moment.',
        })
        return
      }

      orderResp = (await res.json()) as CreateOrderResponse
    } catch {
      setState({
        phase: 'failed',
        message: 'Network error while starting payment. Try again.',
      })
      return
    }

    if (!orderResp.key_id) {
      setState({
        phase: 'failed',
        message: 'Payment is not configured yet. Please try again later.',
      })
      return
    }

    // ─── Sub-step 3: Open Razorpay modal (theme #0F6E56) ────────────────
    if (!window.Razorpay) {
      setState({
        phase: 'failed',
        message: 'Payment system not ready. Refresh the page and try again.',
      })
      return
    }

    setState({ phase: 'opening' })

    const rzp = new window.Razorpay({
      key: orderResp.key_id,
      amount: orderResp.amount,
      currency: orderResp.currency,
      order_id: orderResp.order_id,
      name: 'fixmysite.in',
      description: `${TIER_LABELS[tier]} scan — full report`,
      theme: { color: BRAND_COLOR },
      // No user account yet — prefill is empty. Razorpay shows its own
      // contact/email fields inside the modal in this case.
      prefill: {},
      modal: {
        escape: true,
        ondismiss: () => {
          // ─── Sub-step 6: modal dismissed → recoverable failure ─────────
          setState({
            phase: 'failed',
            message: 'Payment cancelled. Click below to try again.',
          })
        },
      },
      handler: async (response) => {
        // ─── Step A: POST /api/payment/verify ──────────────────────────
        setState({ phase: 'verifying' })
        try {
          const verifyRes = await fetch('/api/payment/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scan_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          })

          if (!verifyRes.ok) {
            setState({
              phase: 'failed',
              message: `Your payment went through but we couldn't confirm it on our end. Email ${SUPPORT_EMAIL} with this URL and we'll fix it.`,
              supportable: true,
            })
            return
          }

          const verifyData = (await verifyRes.json()) as { ok?: boolean }
          if (!verifyData.ok) {
            setState({
              phase: 'failed',
              message: `Payment received but verification failed. Email ${SUPPORT_EMAIL} and we'll sort it out.`,
              supportable: true,
            })
            return
          }
        } catch {
          setState({
            phase: 'failed',
            message: `Network error while verifying your payment. Email ${SUPPORT_EMAIL} if money was deducted.`,
            supportable: true,
          })
          return
        }

        // ─── Step B: queue Phase 2 via /api/scan/phase2/trigger ───────
        // Trigger always returns fast — it just publishes to QStash and
        // returns 202. Errors here are NEVER silent: the user paid and
        // they need to know if the queue handoff failed.
        //   202 → newly queued OR already_running        (redirect, poll on report page)
        //   200 → already_complete                       (redirect straight to report)
        //   anything else → failure with retry path
        let triggerOk = false
        let triggerErrorMessage: string | null = null
        try {
          const triggerRes = await fetch('/api/scan/phase2/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scan_id }),
          })

          if (triggerRes.status === 202 || triggerRes.status === 200) {
            triggerOk = true
          } else {
            const data = (await triggerRes.json().catch(() => null)) as
              | { error?: string }
              | null
            triggerErrorMessage =
              data?.error ?? `Could not start the deep scan (${triggerRes.status}).`
          }
        } catch {
          triggerErrorMessage = 'Network error while starting the deep scan.'
        }

        if (!triggerOk) {
          // Payment is captured + DB row marked paid. The "retry" button
          // (which calls handlePay → /api/payment/create-order) returns
          // 409 already_paid for paid scans, redirecting safely to the
          // report page. So no risk of double-charging.
          setState({
            phase: 'failed',
            message: `${triggerErrorMessage} Your payment is safe — click below to retry, or email ${SUPPORT_EMAIL}.`,
            supportable: true,
          })
          return
        }

        // ─── Step C: brief transitional message, then redirect ─────────
        // 800ms is "long enough to feel intentional" — the user reads
        // confirmation, then the report page takes over the live UX.
        setState({ phase: 'preparing' })
        setTimeout(() => {
          router.push(`/report/${scan_id}/full`)
        }, 800)
      },
    })

    // ─── Sub-step 6: payment.failed → recoverable failure ────────────────
    rzp.on('payment.failed', (resp) => {
      const desc = resp?.error?.description?.trim()
      setState({
        phase: 'failed',
        message: desc
          ? `${desc} Try again or use a different method.`
          : 'Payment failed. Try again or use a different method.',
      })
    })

    rzp.open()
  }

  const isBusy =
    state.phase === 'starting' ||
    state.phase === 'opening' ||
    state.phase === 'verifying'

  const buttonLabel = (() => {
    switch (state.phase) {
      case 'starting':
        return 'Starting payment…'
      case 'opening':
        return 'Opening payment…'
      case 'verifying':
        return 'Verifying payment…'
      case 'failed':
        return `Try again — Pay ₹${price}`
      default:
        return `Pay ₹${price}`
    }
  })()

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        {TIER_LABELS[tier]} scan — ₹{price}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700">
        Full report with every issue found, ordered by what to fix first.
        Plain-language actions you can hand to your developer.
      </p>
      {state.phase === 'preparing' ? (
        <p
          className="mt-5 text-sm font-medium text-zinc-900"
          role="status"
          aria-live="polite"
        >
          Payment confirmed. Preparing your report…
        </p>
      ) : (
        <button
          type="button"
          onClick={handlePay}
          disabled={isBusy}
          aria-busy={isBusy}
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {buttonLabel}
        </button>
      )}
      {state.phase === 'failed' && (
        <p
          className={`mt-3 text-sm ${state.supportable ? 'text-red-700' : 'text-amber-700'}`}
          role="alert"
        >
          {state.message}
        </p>
      )}
    </div>
  )
}
