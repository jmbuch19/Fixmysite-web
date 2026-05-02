import { renderToBuffer } from '@react-pdf/renderer'
import {
  BriefDocument,
  type BriefPdfMeta,
} from '@/components/brief/BriefDocument'
import type { BriefOutput } from '@/lib/claude/brief'

/**
 * Render a paid brief into a PDF buffer.
 *
 * Two-pass strategy: try the branded font first (Plus Jakarta Sans
 * loaded from jsDelivr CDN). If anything during render fails — most
 * commonly the font CDN is unreachable from the Vercel function — we
 * retry once with the built-in Helvetica.
 *
 * Mirrors lib/pdf/generator.ts (the report PDF wrapper) exactly. Same
 * "never fail PDF generation because of a font" rule lives here, not
 * in the document — the document just accepts a fontFamily prop.
 *
 * Throws only when both renders fail. Caller (the API route OR the
 * verify-route auto-email path) maps that to either a 500 response
 * or a logged warning, depending on context.
 */
export async function generateBriefPdf(args: {
  brief: BriefOutput
  meta: BriefPdfMeta
}): Promise<Buffer> {
  try {
    return await renderToBuffer(
      BriefDocument({
        brief: args.brief,
        meta: args.meta,
        fontFamily: 'Plus Jakarta Sans',
      }),
    )
  } catch (err) {
    console.warn(
      '[brief-pdf] branded-font render failed, retrying with Helvetica',
      err instanceof Error ? err.message : err,
    )
    return await renderToBuffer(
      BriefDocument({
        brief: args.brief,
        meta: args.meta,
        fontFamily: 'Helvetica',
      }),
    )
  }
}

/**
 * Filename pattern: fixmysite-brief-[hostname]-[YYYY-MM-DD].pdf
 *
 * Mirrors the report's fixmysite-[hostname]-report.pdf naming, with
 * the date included because owners may regenerate briefs over time
 * and want to tell two PDFs apart in their downloads folder.
 */
export function buildBriefPdfFilename(
  hostname: string,
  isoDate?: string | null,
): string {
  const dt = isoDate ? new Date(isoDate) : new Date()
  const yyyy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  // Sanitise hostname for filenames (strip anything that isn't safe
  // across Windows / macOS / Linux).
  const safeHost = hostname.replace(/[^a-z0-9.-]/gi, '_').toLowerCase()
  return `fixmysite-brief-${safeHost}-${yyyy}-${mm}-${dd}.pdf`
}
