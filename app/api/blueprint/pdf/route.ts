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
import type { BlueprintOutput } from '@/lib/claude/blueprint'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// React-PDF render + font fetch comfortably fit under 30s. 60s ceiling
// matches the brief PDF route (cold-start headroom + slow font CDN).
export const maxDuration = 60

const bodySchema = z.object({
  blueprint_id: z.uuid(),
})

/**
 * POST /api/blueprint/pdf
 *
 * Renders a paid blueprint into a PDF and returns it as
 * application/pdf with a download-attachment disposition.
 *
 * Per CLAUDE.md rule 4: re-fetches `payment_status='paid'` server-
 * side. Never trust the caller's claim about a blueprint_id.
 *
 * Per CLAUDE.md rules 10 and 73: PDF generation is server-side only,
 * using @react-pdf/renderer (same pattern as report + brief).
 *
 * Rate limit: 5/hour/IP (matches brief PDF + report PDF).
 *
 * Response shapes:
 *   200 application/pdf                     — success
 *   400 { error: 'Invalid request body' }   — body validation failure
 *   403 { error: 'Not authorised' }         — payment not verified
 *   404 { error: 'Blueprint not found' }
 *   500 { error: 'Could not generate PDF' } — render failure (rare)
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'blueprint-pdf',
    limit: 5,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let blueprint_id: string
  try {
    blueprint_id = bodySchema.parse(await req.json()).blueprint_id
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: row, error: loadError } = await supabase
    .from('website_blueprints')
    .select(
      'id, payment_status, business_name, owner_name, blueprint_json, completed_at, created_at',
    )
    .eq('id', blueprint_id)
    .maybeSingle()

  if (loadError) {
    console.error('[blueprint-pdf] db load failed', {
      blueprint_id,
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
    console.error('[blueprint-pdf] paid blueprint has null blueprint_json', {
      blueprint_id,
    })
    return Response.json(
      { error: 'Blueprint data missing' },
      { status: 500 },
    )
  }

  let buffer: Buffer
  try {
    buffer = await generateBlueprintPdf({
      blueprint: row.blueprint_json as BlueprintOutput,
      meta: {
        blueprintId: row.id,
        businessName: row.business_name ?? null,
        ownerName: row.owner_name ?? null,
        // Prefer the moment the auto-email landed; fall back to creation;
        // formatter falls back to "today" when both are null.
        paidAt: row.completed_at ?? row.created_at ?? null,
      },
    })
  } catch (err) {
    console.error('[blueprint-pdf] render failed (both font passes)', {
      blueprint_id,
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

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': buffer.length.toString(),
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Private cache only — paid-customer-specific content.
      'Cache-Control': 'private, max-age=3600, must-revalidate',
    },
  })
}
