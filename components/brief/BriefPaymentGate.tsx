'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'
const BRAND_COLOR = '#0F6E56'
const SUPPORT_EMAIL = 'reports@fixmysite.in'

type PaymentState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'opening' }
  | { phase: 'verifying' }
  // Brief transitional state shown after verify succeeds and we're
  // about to redirect to /brief/[scan_id]/full. ≤800ms — long enough
  // to read the confirmation, short enough to not feel laggy.
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
  on: (
    event: 'payment.failed',
    cb: (resp: RazorpayFailedResponse) => void,
  ) => void
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

/**
 * Razorpay paywall for the brief preview page. Mirrors components/scan/
 * PriceGate exactly in shape — same state machine, same idempotent
 * re-click handling, same friendly error states. Differences:
 *
 *   - Talks to /api/brief/payment/{create-order, verify} instead of
 *     /api/payment/{create-order, verify}
 *   - Posts brief_id (not scan_id)
 *   - Redirects to /brief/[scan_id]/full on success (no Phase 2
 *     trigger to wait for — the brief is already generated)
 *
 * Email + name are passed through prefill so Razorpay doesn't ask
 * the owner to re-enter data they already gave us on the input form.
 */
export function BriefPaymentGate({
  briefId,
  scanId,
  priceRupees,
  ownerEmail,
}: {
  briefId: string
  scanId: string
  priceRupees: number
  ownerEmail: string
}) {
  const router = useRouter()
  const [state, setState] = useState<PaymentState>({ phase: 'idle' })

  // Lazy-load the Razorpay checkout script. Skip if already loaded
  // (back-nav to preview from elsewhere) or already injected
  // (StrictMode double-mount, multiple gates on the page).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.Razorpay) return
    if (document.querySelector(`script[src="${RAZORPAY_SCRIPT_SRC}"]`)) return

    const script = document.createElement('script')
    script.src = RAZORPAY_SCRIPT_SRC
    script.async = true
    document.body.appendChild(script)
  }, [])

  // Wait up to 5s for window.Razorpay to appear. Resolves immediately
  // if already present, rejects on timeout so handlePay can show retry.
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
    if (
      state.phase === 'starting' ||
      state.phase === 'opening' ||
      state.phase === 'verifying'
    ) {
      return
    }
    setState({ phase: 'starting' })

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

    // ─── Create order ────────────────────────────────────────────────
    let orderResp: CreateOrderResponse
    try {
      const res = await fetch('/api/brief/payment/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief_id: briefId }),
      })

      if (res.status === 409) {
        // Already paid in another tab — go straight to /full.
        router.push(`/brief/${scanId}/full`)
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
      description: 'Developer brief — full unlock',
      theme: { color: BRAND_COLOR },
      // Prefill what we know so the owner doesn't re-enter their email.
      prefill: {
        email: ownerEmail,
      },
      modal: {
        escape: true,
        ondismiss: () => {
          setState({
            phase: 'failed',
            message: 'Payment cancelled. Click below to try again.',
          })
        },
      },
      handler: async (response) => {
        // ─── Verify ────────────────────────────────────────────────────
        setState({ phase: 'verifying' })
        try {
          const verifyRes = await fetch('/api/brief/payment/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              brief_id: briefId,
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

        // 800ms transitional message, then redirect to /full.
        setState({ phase: 'preparing' })
        setTimeout(() => {
          router.push(`/brief/${scanId}/full`)
        }, 800)
      },
    })

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
        return `Try again — Pay ₹${priceRupees}`
      default:
        return `Unlock full brief — Pay ₹${priceRupees}`
    }
  })()

  return (
    <section className="rounded-xl border-2 border-brand bg-brand-surface p-6">
      <h2 className="text-lg font-semibold text-zinc-900">
        Unlock the complete brief
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700">
        You&apos;ve seen the first work item in full. Pay ₹{priceRupees} to
        unlock the rest, plus Bugbite&apos;s additional recommendations and
        the &ldquo;not in scope&rdquo; list for your developer. Bugbite emails
        you the PDF as soon as the payment confirms.
      </p>

      {state.phase === 'preparing' ? (
        <p
          className="mt-5 text-sm font-medium text-zinc-900"
          role="status"
          aria-live="polite"
        >
          Payment confirmed. Bugbite is unlocking your brief…
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

      {/* International disclaimer — same line shipped on the blueprint
          unlock card. India-first by design; this collapses the trust
          gap before a non-IN visitor pays. See
          memory/international_rollout_plan.md for the full plan. */}
      <p className="mt-4 border-t border-zinc-200 pt-3 text-xs italic leading-relaxed text-zinc-500">
        fixmysite.in is built for Indian businesses. International
        customers are welcome — recommendations include Indian vendors
        (Hostinger India, Razorpay, Truelancer) that may not apply
        where you are.
      </p>

      {state.phase === 'failed' && (
        <p
          className={`mt-3 text-sm ${state.supportable ? 'text-red-700' : 'text-amber-700'}`}
          role="alert"
        >
          {state.message}
        </p>
      )}
    </section>
  )
}
