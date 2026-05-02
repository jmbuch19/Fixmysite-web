import { renderToBuffer } from '@react-pdf/renderer'
import {
  BlueprintDocument,
  type BlueprintPdfMeta,
} from '@/components/blueprint/BlueprintDocument'
import type { BlueprintOutput } from '@/lib/claude/blueprint'

/**
 * Render a paid blueprint into a PDF buffer.
 *
 * Two-pass strategy mirrors the brief PDF wrapper exactly: try the
 * branded font first (Plus Jakarta Sans loaded from jsDelivr CDN),
 * fall back to built-in Helvetica if the font fetch fails. The
 * "never fail PDF generation because of a font" rule lives here, not
 * in the document — the document just accepts a fontFamily prop.
 *
 * Throws only when both renders fail. Caller (the API route OR the
 * verify-route auto-email path) maps that to either a 500 response
 * or a logged warning, depending on context.
 */
export async function generateBlueprintPdf(args: {
  blueprint: BlueprintOutput
  meta: BlueprintPdfMeta
}): Promise<Buffer> {
  try {
    return await renderToBuffer(
      BlueprintDocument({
        blueprint: args.blueprint,
        meta: args.meta,
        fontFamily: 'Plus Jakarta Sans',
      }),
    )
  } catch (err) {
    console.warn(
      '[blueprint-pdf] branded-font render failed, retrying with Helvetica',
      err instanceof Error ? err.message : err,
    )
    return await renderToBuffer(
      BlueprintDocument({
        blueprint: args.blueprint,
        meta: args.meta,
        fontFamily: 'Helvetica',
      }),
    )
  }
}

/**
 * Filename pattern: fixmysite-blueprint-[business-slug]-[YYYY-MM-DD].pdf
 *
 * Mirrors the brief naming. business name is the human anchor for
 * blueprints (no scan URL like the brief), so we slugify whatever
 * the owner gave us in the wizard. Falls back to the blueprint id
 * when the owner skipped business_name.
 */
export function buildBlueprintPdfFilename(
  businessName: string | null,
  blueprintId: string,
  isoDate?: string | null,
): string {
  const dt = isoDate ? new Date(isoDate) : new Date()
  const yyyy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')

  // Slugify business name; fall back to first 8 chars of the blueprint
  // id when missing. Strip every char that isn't safe across
  // Windows / macOS / Linux filesystems.
  const safe = businessName
    ? businessName.replace(/[^a-z0-9.-]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase()
    : blueprintId.slice(0, 8)
  const stem = safe.length > 0 ? safe : blueprintId.slice(0, 8)

  return `fixmysite-blueprint-${stem}-${yyyy}-${mm}-${dd}.pdf`
}
