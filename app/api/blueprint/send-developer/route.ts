import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import {
  buildBlueprintPdfFilename,
  generateBlueprintPdf,
} from '@/lib/pdf/blueprintGenerator'
import { sendBlueprintToDeveloper } from '@/lib/email/sender'
import type { BlueprintOutput } from '@/lib/claude/blueprint'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Render PDF + Resend send. Comfortable under 60s.
export const maxDuration = 60

const bodySchema = z.object({
  blueprint_id: z.uuid(),
  developer_email: z.string().trim().toLowerCase().email().max(254),
})

/**
 * POST /api/blueprint/send-developer
 *
 * Forwards a paid blueprint's PDF to the owner's chosen developer
 * via Resend (CLAUDE.md template 6 equivalent for blueprints).
 * Mirrors /api/brief/send.
 *
 * Server-side payment verification — never act on a blueprint the
 * caller hasn't paid for. Renders the PDF inline and attaches it
 * (no link-based delivery; developers expect attachments).
 *
 * Updates website_blueprints.dev_email + completed_at on success so
 * the admin panel can see the forwarding history.
 *
 * Rate limit: 3/hour/IP — same as brief send-developer + report
 * send-developer.
 *
 * Response shapes:
 *   200 { ok: true, sent: true }            — success
 *   400 { error: '...' }                    — body validation
 *   403 { error: 'Not authorised' }         — payment not verified
 *   404 { error: 'Blueprint not found' }
 *   500 { error: '...' }                    — render or send failure
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'blueprint-send-developer',
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

  const supabase = createServiceClient()
  const { data: row, error: loadError } = await supabase
    .from('website_blueprints')
    .select(
      'id, payment_status, business_name, owner_name, blueprint_json, completed_at, created_at',
    )
    .eq('id', body.blueprint_id)
    .maybeSingle()

  if (loadError) {
    console.error('[blueprint-send] db load failed', {
      blueprint_id: body.blueprint_id,
      error: loadError.message,
    })
    return Response.json({ error: 'Database error' }, { status: 500 })
  }

  if (!row) {
    return Response.json({ error: 'Blueprint not found' }, { status: 404 })
  }
  if (row.payment_status !== 'paid') {
    return Response.json(
      { error: 'Blueprint is gated behind payment' },
      { status: 403 },
    )
  }
  if (!row.blueprint_json) {
    console.error('[blueprint-send] paid blueprint has null blueprint_json', {
      blueprint_id: row.id,
    })
    return Response.json(
      { error: 'Blueprint data missing' },
      { status: 500 },
    )
  }

  const blueprintJson = row.blueprint_json as BlueprintOutput

  // ─── Render PDF ──────────────────────────────────────────────────
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await generateBlueprintPdf({
      blueprint: blueprintJson,
      meta: {
        blueprintId: row.id,
        businessName: row.business_name ?? null,
        ownerName: row.owner_name ?? null,
        paidAt: row.completed_at ?? row.created_at ?? null,
      },
    })
  } catch (err) {
    console.error('[blueprint-send] PDF render failed', {
      blueprint_id: row.id,
      error: err instanceof Error ? err.message : err,
    })
    return Response.json(
      { error: 'Could not generate PDF' },
      { status: 500 },
    )
  }

  const filename = buildBlueprintPdfFilename(
    row.business_name ?? null,
    row.id,
    row.created_at,
  )

  // ─── Send email ──────────────────────────────────────────────────
  const sendResult = await sendBlueprintToDeveloper({
    to: body.developer_email,
    businessName: row.business_name ?? null,
    recommendationLabel: blueprintJson.recommendation_label,
    pdfBuffer,
    pdfFilename: filename,
  })

  if (!sendResult.ok) {
    console.error('[blueprint-send] Resend send failed', {
      blueprint_id: row.id,
      developer_email: body.developer_email,
      reason: sendResult.reason,
      error: sendResult.error,
    })
    return Response.json(
      {
        error:
          'Could not send the email — try again or email hello@fixmysite.in',
      },
      { status: 500 },
    )
  }

  // ─── Persist forwarding metadata (best effort) ───────────────────
  // If the UPDATE fails the email still went through; we just lose
  // the audit trail. Log loudly but don't fail the user.
  const { error: updateError } = await supabase
    .from('website_blueprints')
    .update({
      dev_email: body.developer_email,
      completed_at: new Date().toISOString(),
      status: 'complete',
    })
    .eq('id', row.id)

  if (updateError) {
    console.error(
      '[blueprint-send] update dev_email/completed_at failed (email sent OK)',
      { blueprint_id: row.id, error: updateError.message },
    )
  }

  return Response.json({ ok: true, sent: true })
}
