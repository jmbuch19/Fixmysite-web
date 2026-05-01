import { renderToBuffer } from '@react-pdf/renderer'
import {
  ReportDocument,
  type ReportPdfScan,
} from '@/components/report/ReportDocument'
import type { Issue } from '@/lib/scan/phase2'

/**
 * Render a paid scan into a PDF buffer.
 *
 * Two-pass strategy: try the branded font first (Plus Jakarta Sans
 * loaded from jsDelivr CDN). If anything during render fails — most
 * commonly the font CDN is unreachable from the Vercel function — we
 * retry once with the built-in Helvetica.
 *
 * The "never fail PDF generation because of a font" rule from the build
 * scope is enforced here, not in the document. The document just accepts
 * a fontFamily prop; the recovery logic lives at this orchestrator
 * layer so error handling is in one place.
 *
 * Throws only when both renders fail. Caller (the API route) maps that
 * to a 500 response.
 */
export async function generateReportPdf(args: {
  scan: ReportPdfScan
  issues: Issue[]
}): Promise<Buffer> {
  try {
    return await renderToBuffer(
      ReportDocument({
        scan: args.scan,
        issues: args.issues,
        fontFamily: 'Plus Jakarta Sans',
      }),
    )
  } catch (err) {
    console.warn(
      '[pdf] branded-font render failed, retrying with Helvetica',
      err instanceof Error ? err.message : err,
    )
    return await renderToBuffer(
      ReportDocument({
        scan: args.scan,
        issues: args.issues,
        fontFamily: 'Helvetica',
      }),
    )
  }
}
