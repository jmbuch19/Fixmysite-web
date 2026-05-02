'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BlueprintPaymentGate } from '@/components/blueprint/BlueprintPaymentGate'
import { BLUEPRINT_PRICING } from '@/constants/pricing'
import type {
  BlueprintGetResponse,
  BlueprintPreviewFields,
} from '@/app/api/blueprint/[id]/route'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'generating' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready'
      businessName: string | null
      ownerName: string | null
      ownerEmail: string | null
      preview: BlueprintPreviewFields
      paymentStatus: BlueprintGetResponse['payment_status']
    }

/**
 * Free-preview client for /plan/blueprint/[id].
 *
 * Lifecycle:
 *   1. mount → GET /api/blueprint/[id]
 *   2. if status === 'draft' → POST /api/blueprint/generate, then GET again
 *   3. render preview (Bugbite framing → understood card → recommendation
 *      pill → ₹99 paywall)
 *
 * Generation is owned by this page, not the wizard. Why: the wizard's
 * "Saving…" state covers the create call (~1s); the 10-15s Claude call
 * happens here behind a clear loading state ("Bugbite is reading your
 * answers…"). Owner who refreshes or shares the URL gets the same
 * lazy-generation behaviour for free.
 *
 * The /api/blueprint/generate endpoint is idempotent (cached: true on
 * subsequent calls) so a double-mount or back-button is harmless.
 */
export function BlueprintPreview({ blueprintId }: { blueprintId: string }) {
  const router = useRouter()
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  // Guard against double-fire under React 18 StrictMode dev double-mount.
  const startedRef = useRef(false)

  useEffect(() => {
    // startedRef alone is enough to dedupe React StrictMode's dev
    // double-invocation. We deliberately do NOT pair it with a
    // `cancelled` flag — the StrictMode cleanup would flip the flag
    // before the first effect's fetch resolves, the second effect is
    // rejected by startedRef, and setState would be skipped forever
    // (spinner stuck). React 18+ tolerates setState on an "unmounted"
    // tree, so just letting setState fire is the safer pattern.
    if (startedRef.current) return
    startedRef.current = true

    async function run() {
      try {
        const initial = await fetchBlueprint(blueprintId)

        // Already paid? Skip the preview entirely — the owner has
        // unlocked the full blueprint, send them straight to it.
        if (initial.payment_status === 'paid') {
          router.replace(`/plan/blueprint/${blueprintId}/full`)
          return
        }

        if (initial.status === 'draft' || !initial.preview) {
          setState({ phase: 'generating' })
          const generated = await generateBlueprint(blueprintId)
          if (!generated.ok) {
            setState({ phase: 'error', message: generated.message })
            return
          }
          // Re-fetch after generation. The generate endpoint returns
          // the blueprint directly but we re-read so payment_status,
          // business_name etc. all come from one source of truth.
          const refreshed = await fetchBlueprint(blueprintId)
          settleReady(refreshed)
          return
        }

        settleReady(initial)
      } catch {
        setState({
          phase: 'error',
          message:
            'Could not reach our server. Check your internet and refresh the page.',
        })
      }
    }

    function settleReady(payload: BlueprintGetResponse) {
      if (!payload.preview) {
        setState({
          phase: 'error',
          message:
            'Bugbite generated your blueprint but the preview did not load. Refresh the page.',
        })
        return
      }
      setState({
        phase: 'ready',
        businessName: payload.business_name,
        ownerName: payload.owner_name,
        ownerEmail: payload.owner_email,
        preview: payload.preview,
        paymentStatus: payload.payment_status,
      })
    }

    run()
  }, [blueprintId, router])

  if (state.phase === 'loading' || state.phase === 'generating') {
    return <Loader phase={state.phase} />
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-semibold text-red-900">
          Bugbite hit a snag
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-red-900">
          {state.message}
        </p>
        <p className="mt-3 text-xs text-red-900/70">
          Reference: {blueprintId}
        </p>
      </div>
    )
  }

  return (
    <PreviewBody
      blueprintId={blueprintId}
      businessName={state.businessName}
      ownerName={state.ownerName}
      ownerEmail={state.ownerEmail}
      preview={state.preview}
    />
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────

async function fetchBlueprint(
  blueprintId: string,
): Promise<BlueprintGetResponse> {
  const res = await fetch(`/api/blueprint/${blueprintId}`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`fetchBlueprint ${res.status}`)
  }
  return (await res.json()) as BlueprintGetResponse
}

async function generateBlueprint(
  blueprintId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response
  try {
    res = await fetch('/api/blueprint/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint_id: blueprintId }),
    })
  } catch {
    return { ok: false, message: 'Could not reach Bugbite. Check your internet.' }
  }
  if (res.status === 429) {
    return {
      ok: false,
      message:
        'Too many generation attempts from this device. Wait an hour and refresh.',
    }
  }
  if (!res.ok) {
    return {
      ok: false,
      message:
        'Bugbite could not write your blueprint right now. Refresh in a minute, or email hello@fixmysite.in.',
    }
  }
  return { ok: true }
}

// ─── Loader ────────────────────────────────────────────────────────────

function Loader({ phase }: { phase: 'loading' | 'generating' }) {
  const message =
    phase === 'generating'
      ? 'Bugbite is reading your answers and writing your blueprint. This takes about 15 seconds.'
      : 'Loading your blueprint…'
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-8 text-center">
      <div
        aria-hidden
        className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-brand"
      />
      <p className="mt-4 text-sm leading-relaxed text-zinc-700">{message}</p>
    </div>
  )
}

// ─── Body ──────────────────────────────────────────────────────────────

function PreviewBody({
  blueprintId,
  businessName,
  ownerName,
  ownerEmail,
  preview,
}: {
  blueprintId: string
  businessName: string | null
  ownerName: string | null
  ownerEmail: string | null
  preview: BlueprintPreviewFields
}) {
  const subjectName = businessName ?? 'your business'
  return (
    <div className="space-y-8">
      {/* Bugbite framing */}
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">
          Your blueprint preview
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl">
          {ownerName ? `${ownerName.split(' ')[0]}, ` : ''}Bugbite read your
          answers and analysed{' '}
          <span className="text-brand">{subjectName}</span>.
        </h1>
      </header>

      {/* What we understood */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          What Bugbite understood
        </h2>
        <p className="mt-3 text-base leading-relaxed text-zinc-800">
          {preview.understood}
        </p>
      </section>

      {/* Recommendation pill */}
      <section className="rounded-xl border border-brand bg-brand-surface p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-brand">
          Bugbite recommends
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white">
            {preview.recommendation_label}
          </span>
        </div>
      </section>

      {/* Razorpay paywall — owns its own state machine, error UI, and
          dark card layout. Caller just embeds it. */}
      <BlueprintPaymentGate
        blueprintId={blueprintId}
        priceRupees={BLUEPRINT_PRICING.full.price}
        ownerEmail={ownerEmail}
        ownerName={ownerName}
      />

      <p className="text-xs text-zinc-400">Reference: {blueprintId}</p>
    </div>
  )
}
