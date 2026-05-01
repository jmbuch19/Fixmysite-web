import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { generateReportPdf } from '@/lib/pdf/generator'
import type { Issue } from '@/lib/scan/phase2'
import type { ReportPdfScan } from '@/components/report/ReportDocument'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// React-PDF render + font fetch + DB roundtrips fit comfortably under
// 30s. Bump to 60 to leave headroom for cold starts and the rare slow
// font-CDN response.
export const maxDuration = 60

const bodySchema = z.object({
  scan_id: z.uuid(),
})

/**
 * POST /api/report/pdf
 *
 * Renders a paid scan into a PDF and returns it as
 * `application/pdf` with a download-attachment disposition.
 *
 * Per CLAUDE.md rule 4: re-fetches `payment_status='paid'` server-side.
 * Never trust the caller's claim about a scan_id.
 *
 * Per CLAUDE.md rule 10: PDF generation is server-side only — never
 * client-side (would expose service-role data + render JSX in the
 * browser inefficiently).
 *
 * Rate limit: 5/hour/IP per CLAUDE.md.
 *
 * Response shapes:
 *   200 application/pdf                  — success
 *   400 { error: 'Invalid request' }     — body validation failure
 *   403 { error: 'Not authorised' }      — payment not verified
 *   404 { error: 'Scan not found' }
 *   500 { error: 'Could not generate PDF' } — render failure (rare)
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'report-pdf',
    limit: 5,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // ─── Load scan ────────────────────────────────────────────────────
  const { data: scan, error: scanErr } = await supabase
    .from('scans')
    .select(
      'id, url, health_score, completed_at, page_count, tier, payment_status, status, report_json',
    )
    .eq('id', body.scan_id)
    .maybeSingle()

  if (scanErr) {
    console.error('[pdf] scan lookup failed', {
      scan_id: body.scan_id,
      error: scanErr.message,
    })
    return Response.json({ error: 'Could not load scan' }, { status: 500 })
  }
  if (!scan) {
    return Response.json({ error: 'Scan not found' }, { status: 404 })
  }

  // ─── Auth — verify payment server-side ────────────────────────────
  if (scan.payment_status !== 'paid') {
    return Response.json(
      { error: 'Report is gated behind payment' },
      { status: 403 },
    )
  }

  // ─── Load issues ──────────────────────────────────────────────────
  const { data: issueRows, error: issuesErr } = await supabase
    .from('issues')
    .select('category, item, status, detail, priority, effort, action')
    .eq('scan_id', body.scan_id)

  if (issuesErr) {
    console.error('[pdf] issues lookup failed', {
      scan_id: body.scan_id,
      error: issuesErr.message,
    })
    return Response.json({ error: 'Could not load issues' }, { status: 500 })
  }

  const issues: Issue[] = (issueRows ?? []) as Issue[]

  // ─── Render ───────────────────────────────────────────────────────
  let buffer: Buffer
  try {
    buffer = await generateReportPdf({
      scan: scan as unknown as ReportPdfScan,
      issues,
    })
  } catch (err) {
    console.error('[pdf] render failed (both font passes)', {
      scan_id: body.scan_id,
      error: err instanceof Error ? err.message : err,
    })
    return Response.json(
      { error: 'Could not generate PDF' },
      { status: 500 },
    )
  }

  // ─── Filename based on the scanned hostname ───────────────────────
  let filename = `fixmysite-report-${body.scan_id}.pdf`
  try {
    const host = new URL(scan.url as string).hostname.replace(/^www\./, '')
    filename = `fixmysite-${host}-report.pdf`
  } catch {
    // fallback to scan-id filename — already set above
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': buffer.length.toString(),
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Private cache only — the report is paid-customer-specific.
      'Cache-Control': 'private, max-age=3600, must-revalidate',
    },
  })
}
