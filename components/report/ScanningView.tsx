'use client'

import { useEffect, useState } from 'react'

// Narrative phrases shown while the Phase 2 worker runs (~30-90s real
// wall time). Cycles every SCAN_NARRATIVE_INTERVAL_MS to keep the page
// feeling alive.
//
// Phrasing rule: every line is something Bugbite is *actually* doing
// somewhere in the orchestrator (extractor, twilio, links, ssl, content,
// ui, workflow, ux audit, claude report). Not literal one-to-one — a
// single phrase often covers multiple parallel checks — but never
// invents activity that isn't happening. Honest theatre.
const SCAN_NARRATIVE = [
  'Bugbite is reading your homepage…',
  'Bugbite is checking your phone numbers…',
  'Bugbite is sniffing around your contact form…',
  'Bugbite is running through every link…',
  'Bugbite is peeking at your SSL certificate…',
  'Bugbite is reading your content carefully…',
  'Bugbite is sizing up your photos…',
  'Bugbite is wandering through your menu…',
  'Bugbite is making sense of it all…',
  'Bugbite is writing up your report…',
] as const

const SCAN_NARRATIVE_INTERVAL_MS = 3_000

/**
 * The "Bugbite is on it…" card shown while a paid scan is running.
 *
 * Lives in its own file so the unlisted /preview/scanning route can
 * render the exact same component in isolation — single source of
 * truth means the preview can never drift from production.
 */
export function ScanningView() {
  const [narrativeIdx, setNarrativeIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setNarrativeIdx((prev) => (prev + 1) % SCAN_NARRATIVE.length)
    }, SCAN_NARRATIVE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-lg font-semibold text-amber-900">
        Bugbite is on it…
      </h2>

      {/* Pulsing-dot + cycling narrative line. The dot uses the
          standard Tailwind ping pattern (an absolute-positioned ping
          ring + a relative solid centre) so it reads as a soft radar
          pulse. Re-mounting the message via `key={narrativeIdx}` makes
          React drop in a fresh element each tick — combined with the
          custom .animate-fade-in keyframe in globals.css, the swap
          feels alive without a Framer Motion dependency. */}
      <div className="mt-4 flex items-start gap-3 text-sm text-amber-900">
        <span
          aria-hidden
          className="relative mt-1.5 inline-flex h-2.5 w-2.5 flex-shrink-0"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-600" />
        </span>
        <span
          key={narrativeIdx}
          aria-live="polite"
          className="animate-fade-in"
        >
          {SCAN_NARRATIVE[narrativeIdx]}
        </span>
      </div>

      {/* Walking Bugbite. The animated GIF is the cat's actual
          movement (walking, sniffing around, wagging tail, sitting —
          the source MP4 has all four behaviours in sequence over
          ~6 seconds). CSS layers a slow horizontal pace on top so
          Bugbite traverses the card width too — net effect: a curious
          cat exploring the scanning card.

          Why a plain <img> instead of next/image: animated GIFs lose
          their animation when run through Next's image optimizer
          unless `unoptimized` is set, and unoptimized + the path-
          based <Image> ergonomics are no nicer than a vanilla img
          for a 134KB asset. Keep it simple.

          mix-blend-multiply melts the GIF's white background into the
          amber-50 card surface — same trick the hero logo uses.
          aria-hidden since this is purely decorative animation. */}
      <div
        className="relative mt-5 h-10 w-full"
        aria-hidden
      >
        <div
          className="animate-cat-walk absolute bottom-0"
          style={{ width: 40, height: 40 }}
        >
          <div className="animate-cat-walk-bounce h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/cat-walking.gif"
              alt=""
              width={96}
              height={96}
              className="h-full w-full object-contain mix-blend-multiply"
            />
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-amber-900/80">
        This page updates automatically. You can close the tab — Bugbite will
        email you when the report is ready.
      </p>
    </section>
  )
}
