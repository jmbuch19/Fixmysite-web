import path from 'node:path'
import { Font } from '@react-pdf/renderer'

/**
 * Shared brand-font registration for every server-side PDF (report,
 * brief, blueprint).
 *
 * Why this lives in its own module:
 *   - Three callers used to duplicate the same Font.register block,
 *     each pointing at @fontsource's jsDelivr CDN. The v5 reorg killed
 *     the URL pattern silently; every PDF fell back to PDF-built-in
 *     Helvetica, which has no rupee glyph (₹ rendered as superscript
 *     1 across every report, brief, and blueprint that quoted INR).
 *   - One helper, one source of truth: bundle the TTF inside
 *     public/fonts/, register it on module load, hand back a constant
 *     for the family name. No network at render time, no font CDN to
 *     break the moment a publisher reorganises their package.
 *
 * Variable-font note: Plus Jakarta Sans on Google Fonts ships as a
 * single variable TTF (PlusJakartaSans[wght].ttf). @react-pdf does not
 * synthesise discrete weights from a variable file, so we register the
 * same TTF twice — once "as" 400 and once "as" 600. Visually the two
 * weights will look identical in PDF output. We trade weight
 * differentiation for guaranteed glyph coverage; the PDF still has
 * size, colour, and layout for emphasis.
 *
 * Always-safe to call: protected by a try/catch + idempotency guard,
 * so importing this module multiple times across documents is fine.
 */

export const BRAND_FONT_FAMILY = 'Plus Jakarta Sans'

const FONT_PATH = path.join(
  process.cwd(),
  'public',
  'fonts',
  'PlusJakartaSans-Variable.ttf',
)

let registered = false

export function registerBrandFont(callerTag: string): void {
  if (registered) return
  registered = true

  // Note: we used to call Font.clear() here to flush stale URL-based
  // registrations from older module loads. Don't — Font.clear() also
  // wipes @react-pdf's built-in Helvetica, leaving the fallback path
  // with no font at all. Production cold starts have no stale state;
  // dev needs a server restart after font code changes.

  try {
    // We register italic styles too even though we have no italic TTF.
    // The variable font we ship (Plus Jakarta Sans wght axis only) has
    // no italic instance — @react-pdf doesn't synthesize italics, so a
    // fontStyle:'italic' style in the PDF would throw "Could not resolve
    // font" and trip the Helvetica fallback. Pointing italic at the same
    // file means italic text renders upright; we lose the slant but keep
    // the rupee glyph and the brand. Footer taglines and owner-quote
    // callouts use italic — verified visually before shipping.
    Font.register({
      family: BRAND_FONT_FAMILY,
      fonts: [
        { src: FONT_PATH, fontWeight: 400 },
        { src: FONT_PATH, fontWeight: 600 },
        { src: FONT_PATH, fontWeight: 400, fontStyle: 'italic' },
        { src: FONT_PATH, fontWeight: 600, fontStyle: 'italic' },
      ],
    })
  } catch (err) {
    console.warn(
      `[${callerTag}] Plus Jakarta Sans registration failed — Helvetica fallback will lose the rupee glyph`,
      err instanceof Error ? err.message : err,
    )
    // Reset so a future caller (if the env recovers) gets to retry.
    registered = false
  }
}
