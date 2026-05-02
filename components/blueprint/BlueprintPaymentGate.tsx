'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'
const BRAND_COLOR = '#0F6E56'
const SUPPORT_EMAIL = 'hello@fixmysite.in'

type PaymentState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'opening' }
  | { phase: 'verifying' }
  // Brief transitional state shown after verify succeeds and we're
  // about to redirect to /full. ≤800ms — long enough to read the
  // confirmation, short enough not to feel laggy.
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
 * Razorpay paywall card for the blueprint preview page. Mirrors
 * components/brief/BriefPaymentGate exactly in shape — same state
 * machine, same idempotent re-click handling, same friendly error
 * states. Differences:
 *
 *   - Talks to /api/blueprint/payment/{create-order, verify}
 *   - Posts blueprint_id (not brief_id)
 *   - Redirects to /plan/blueprint/[id]/full on success
 *   - Owns the dark "what you unlock" card layout — caller just
 *     embeds <BlueprintPaymentGate ... />
 */
export function BlueprintPaymentGate({
  blueprintId,
  priceRupees,
  ownerEmail,
  ownerName,
}: {
  blueprintId: string
  priceRupees: number
  ownerEmail: string | null
  ownerName: string | null
}) {
  const router = useRouter()
  const [state, setState] = useState<PaymentState>({ phase: 'idle' })

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.Razorpay) return
    if (document.querySelector(`script[src="${RAZORPAY_SCRIPT_SRC}"]`)) return

    const script = document.createElement('script')
    script.src = RAZORPAY_SCRIPT_SRC
    script.async = true
    document.body.appendChild(script)
  }, [])

  // Prewarm /api/blueprint/payment/verify on mount. The route is rarely
  // hit and Next.js compiles routes on first request — that cold-start
  // (~30s in dev, ~2-3s on Vercel) used to land inside Razorpay's
  // handler callback, where the verify fetch would time out and the
  // payment would orbit unconfirmed. A no-op POST forces compilation
  // up-front so the real verify hits a warm route.
  //
  // Sends an obviously-invalid signature so the route returns 403 fast
  // without touching the DB. We don't care about the response — only
  // that compilation has happened.
  useEffect(() => {
    fetch('/api/blueprint/payment/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blueprint_id: blueprintId,
        razorpay_order_id: 'prewarm',
        razorpay_payment_id: 'prewarm',
        razorpay_signature: 'prewarm',
      }),
      keepalive: true,
    }).catch(() => {
      // Network error during prewarm is harmless — the real verify
      // path will surface its own error if needed.
    })
  }, [blueprintId])

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

    let orderResp: CreateOrderResponse
    try {
      const res = await fetch('/api/blueprint/payment/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint_id: blueprintId }),
      })

      if (res.status === 409) {
        // Either already paid, or generation hasn't completed yet.
        // Try to read the JSON for context — both cases route the
        // owner somewhere useful.
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        if (data?.error === 'Blueprint already paid') {
          router.push(`/plan/blueprint/${blueprintId}/full`)
          return
        }
        setState({
          phase: 'failed',
          message:
            'Bugbite is still finishing your blueprint. Refresh in a few seconds and try again.',
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
      description: 'Website blueprint — full unlock',
      theme: { color: BRAND_COLOR },
      prefill: {
        name: ownerName ?? undefined,
        email: ownerEmail ?? undefined,
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
        setState({ phase: 'verifying' })
        try {
          const verifyRes = await fetch('/api/blueprint/payment/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              blueprint_id: blueprintId,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          })

          if (!verifyRes.ok) {
            setState({
              phase: 'failed',
              message: `Your payment went through but Bugbite could not confirm it. Email ${SUPPORT_EMAIL} with this URL and we will fix it.`,
              supportable: true,
            })
            return
          }

          const verifyData = (await verifyRes.json()) as { ok?: boolean }
          if (!verifyData.ok) {
            setState({
              phase: 'failed',
              message: `Payment received but verification failed. Email ${SUPPORT_EMAIL} and we will sort it out.`,
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

        setState({ phase: 'preparing' })
        setTimeout(() => {
          router.push(`/plan/blueprint/${blueprintId}/full`)
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
        return `Unlock full blueprint — ₹${priceRupees} →`
    }
  })()

  return (
    <section className="rounded-xl border-2 border-zinc-900 bg-zinc-900 p-6 text-white">
      <p className="text-xs font-semibold uppercase tracking-wider text-white/60">
        Locked
      </p>
      <h2 className="mt-2 text-xl font-semibold">Unlock the full blueprint</h2>
      <ul className="mt-4 space-y-2 text-sm leading-relaxed text-white/90">
        <li className="flex gap-2">
          <span aria-hidden className="text-brand">
            ✓
          </span>
          <span>Why this recommendation is right for you</span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden className="text-brand">
            ✓
          </span>
          <span>Why simpler or more complex options would not work</span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden className="text-brand">
            ✓
          </span>
          <span>The exact pages and features you need</span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden className="text-brand">
            ✓
          </span>
          <span>Technology suggestion with Indian context and real prices</span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden className="text-brand">
            ✓
          </span>
          <span>Step-by-step next actions</span>
        </li>
      </ul>

      {state.phase === 'preparing' ? (
        <p
          className="mt-6 text-sm font-medium text-white"
          role="status"
          aria-live="polite"
        >
          Payment confirmed. Bugbite is unlocking your blueprint…
        </p>
      ) : (
        <button
          type="button"
          onClick={handlePay}
          disabled={isBusy}
          aria-busy={isBusy}
          className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {buttonLabel}
        </button>
      )}

      <p className="mt-3 text-xs text-white/60">
        One-time payment. PDF download included. No subscription.
      </p>

      {/* International disclaimer. fixmysite.in is India-first by
          design — Claude blueprint recommends Indian vendors per
          CLAUDE.md rule 70 (Razorpay, Hostinger India, BigRock,
          Truelancer, etc.). The line collapses the trust gap for a
          non-IN visitor before they pay. Currency display + true
          regional support tracked separately — see
          memory/international_rollout_plan.md. */}
      <p className="mt-4 border-t border-white/10 pt-3 text-xs italic leading-relaxed text-white/50">
        fixmysite.in is built for Indian businesses. International
        customers are welcome — recommendations include Indian vendors
        (Hostinger India, Razorpay, Truelancer) that may not apply
        where you are.
      </p>

      {state.phase === 'failed' && (
        <p
          className={`mt-3 text-sm ${state.supportable ? 'text-red-300' : 'text-amber-300'}`}
          role="alert"
        >
          {state.message}
        </p>
      )}
    </section>
  )
}
