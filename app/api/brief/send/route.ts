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
import { sendBriefToDeveloper } from '@/lib/email/sender'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Render PDF + Resend send. Comfortable under 60s.
export const maxDuration = 60

const bodySchema = z.object({
  brief_id: z.uuid(),
  developer_email: z.string().trim().toLowerCase().email().max(254),
})

/**
 * POST /api/brief/send
 *
 * Forwards a paid brief's PDF to the owner's developer via Resend
 * (CLAUDE.md template 6). Mirrors the report's send-developer route.
 *
 * Server-side payment verification — never act on a brief the caller
 * hasn't paid for. Renders the PDF inline and attaches it (no link-
 * based delivery; developers expect attachments).
 *
 * Updates briefs.dev_email + sent_at on success so admin panel can
 * see who the brief was forwarded to and when.
 *
 * Rate limit: 3/hour/IP (same as report send-developer).
 *
 * Response shapes:
 *   200 { ok: true, sent: true }            — success
 *   400 { error: '...' }                    — body validation
 *   403 { error: 'Not authorised' }         — payment not verified
 *   404 { error: 'Brief not found' }
 *   500 { error: '...' }                    — render or send failure
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'brief-send-developer',
    limit: 3,
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

  const brief = await getBriefById(body.brief_id)
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
    console.error('[brief-send] paid brief has null brief_json', {
      brief_id: brief.id,
    })
    return Response.json({ error: 'Brief data missing' }, { status: 500 })
  }

  // Lookup scan URL for PDF sub-header + filename.
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
        // keep default
      }
    }
  }

  // ─── Render PDF ──────────────────────────────────────────────────
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await generateBriefPdf({
      brief: brief.brief_json,
      meta: {
        hostname,
        scanUrl,
        briefId: brief.id,
        paidAt: brief.sent_at ?? brief.created_at ?? null,
        hasScreenshots: false,
      },
    })
  } catch (err) {
    console.error('[brief-send] PDF render failed', {
      brief_id: brief.id,
      error: err instanceof Error ? err.message : err,
    })
    return Response.json(
      { error: 'Could not generate PDF' },
      { status: 500 },
    )
  }

  const filename = buildBriefPdfFilename(hostname, brief.created_at)

  // ─── Send email ──────────────────────────────────────────────────
  const sendResult = await sendBriefToDeveloper({
    to: body.developer_email,
    hostname,
    scanUrl,
    workItemCount: brief.brief_json.sections.length,
    pdfBuffer,
    pdfFilename: filename,
  })

  if (!sendResult.ok) {
    console.error('[brief-send] Resend send failed', {
      brief_id: brief.id,
      developer_email: body.developer_email,
      reason: sendResult.reason,
      error: sendResult.error,
    })
    return Response.json(
      { error: 'Could not send the email — try again or email hello@fixmysite.in' },
      { status: 500 },
    )
  }

  // ─── Persist forwarding metadata ─────────────────────────────────
  // Best-effort — if the UPDATE fails the email still went through;
  // we just lose the audit trail. Log loudly but don't fail the user.
  const supabase = createServiceClient()
  const { error: updateError } = await supabase
    .from('briefs')
    .update({
      dev_email: body.developer_email,
      sent_at: new Date().toISOString(),
    })
    .eq('id', brief.id)

  if (updateError) {
    console.error(
      '[brief-send] update dev_email/sent_at failed (email sent OK)',
      { brief_id: brief.id, error: updateError.message },
    )
  }

  return Response.json({ ok: true, sent: true })
}
