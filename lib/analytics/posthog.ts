'use client'

import posthog from 'posthog-js'

let initialized = false
let warned = false

/**
 * Lazy-init PostHog on the browser. Safe to call from server code (no-ops).
 * Falls back to a console log if NEXT_PUBLIC_POSTHOG_KEY is unset, so we
 * never silently drop events during local development.
 */
function ensureInit(): boolean {
  if (initialized) return true
  if (typeof window === 'undefined') return false

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com'

  if (!key) {
    if (!warned) {
      // eslint-disable-next-line no-console
      console.warn(
        '[posthog] NEXT_PUBLIC_POSTHOG_KEY not set — events will console.info instead of sending. Set it in .env.local for production telemetry.',
      )
      warned = true
    }
    return false
  }

  posthog.init(key, {
    api_host: host,
    capture_pageview: false,
    person_profiles: 'identified_only',
  })
  initialized = true
  return true
}

/**
 * Capture an analytics event. Server-side calls are silently dropped (the
 * client wrapper is the source of truth — server-side events go through
 * posthog-node directly when needed).
 *
 * Event names + property shapes follow SPEC §13 / §17 conventions:
 * snake_case event names, snake_case keys.
 */
export function captureEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return

  const ready = ensureInit()
  if (!ready) {
    // eslint-disable-next-line no-console
    console.info('[posthog]', event, properties ?? {})
    return
  }

  posthog.capture(event, properties)
}
