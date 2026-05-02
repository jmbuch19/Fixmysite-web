import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { getBriefById } from '@/lib/brief/store'
import {
  buildBriefPdfFilename,
  generateBriefPdf,
} from '@/lib/pdf/briefGenerator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// React-PDF render + font fetch comfortably fit under 30s. Same 60s
// ceiling as the report PDF route to leave headroom for cold starts
// and slow font-CDN responses.
export const maxDuration = 60

const bodySchema = z.object({
  brief_id: z.uuid(),
})

/**
 * POST /api/brief/pdf
 *
 * Renders a paid brief into a PDF and returns it as application/pdf
 * with a download-attachment disposition.
 *
 * Per CLAUDE.md rule 4: re-fetches `payment_status='paid'` server-
 * side. Never trust the caller's claim about a brief_id.
 *
 * Per CLAUDE.md rule 10: PDF generation is server-side only — never
 * client-side (would expose service-role data + render JSX in the
 * browser inefficiently).
 *
 * Rate limit: 5/hour/IP (same as the report PDF route).
 *
 * Response shapes:
 *   200 application/pdf                     — success
 *   400 { error: 'Invalid request body' }   — body validation failure
 *   403 { error: 'Not authorised' }         — payment not verified
 *   404 { error: 'Brief not found' }
 *   500 { error: 'Could not generate PDF' } — render failure (rare)
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'brief-pdf',
    limit: 5,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let brief_id: string
  try {
    brief_id = bodySchema.parse(await req.json()).brief_id
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const brief = await getBriefById(brief_id)
  if (!brief) {
    return Response.json({ error: 'Brief not found' }, { status: 404 })
  }
  if (brief.payment_status !== 'paid') {
    return Response.json(
      { error: 'Brief is gated behind payment' },
      { status: 403 },
    )
  }
  if (!brief.brief_json) {
    console.error('[brief-pdf] paid brief has null brief_json', { brief_id })
    return Response.json(
      { error: 'Brief data missing' },
      { status: 500 },
    )
  }

  // Need the scan URL for the PDF sub-header line "Prepared for: <url>"
  // and the filename hostname. Lookup is small + cached at the DB level.
  let scanUrl = ''
  let hostname = 'site'
  if (brief.scan_id) {
    const supabase = createServiceClient()
    const { data: scan } = await supabase
      .from('scans')
      .select('url')
      .eq('id', brief.scan_id)
      .maybeSingle()
    if (scan?.url) {
      scanUrl = scan.url as string
      try {
        hostname = new URL(scanUrl).hostname.replace(/^www\./, '')
      } catch {
        // Keep default
      }
    }
  }

  let buffer: Buffer
  try {
    buffer = await generateBriefPdf({
      brief: brief.brief_json,
      meta: {
        hostname,
        scanUrl,
        briefId: brief.id,
        // sent_at is null until the auto-email lands; fall back to
        // brief.created_at, then to now() inside the formatter.
        paidAt: brief.sent_at ?? brief.created_at ?? null,
        // v1.0.x: screenshots tier is not yet shipped, so this is
        // always false. When the with_screenshots upload pipeline
        // lands, derive from brief.predefined_selections or a new
        // brief.tier column.
        hasScreenshots: false,
      },
    })
  } catch (err) {
    console.error('[brief-pdf] render failed (both font passes)', {
      brief_id,
      error: err instanceof Error ? err.message : err,
    })
    return Response.json(
      { error: 'Could not generate PDF' },
      { status: 500 },
    )
  }

  const filename = buildBriefPdfFilename(hostname, brief.created_at)

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': buffer.length.toString(),
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Private cache only — the brief is paid-customer-specific.
      'Cache-Control': 'private, max-age=3600, must-revalidate',
    },
  })
}
