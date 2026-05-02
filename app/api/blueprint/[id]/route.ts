import { createServiceClient } from '@/lib/supabase/server'
import type {
  BlueprintOutput,
  BlueprintRecommendation,
} from '@/lib/claude/blueprint'

export const runtime = 'nodejs'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

function noStoreJson(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS })
}

// Public preview shape — kept narrow on purpose. The free /plan/blueprint/[id]
// page reveals WHAT was recommended; everything that explains WHY (why_right,
// why_not_alternative, pages, technology, next_steps) lives behind the
// payment gate and only appears in the `full` field.
export type BlueprintPreviewFields = {
  understood: string
  recommendation: BlueprintRecommendation
  recommendation_label: string
}

export type BlueprintGetResponse = {
  blueprint_id: string
  status: 'draft' | 'generated' | 'paid' | 'complete'
  payment_status: 'unpaid' | 'paid' | 'refunded' | 'failed'
  business_name: string | null
  owner_name: string | null
  // Populated once Claude generation has run.
  preview: BlueprintPreviewFields | null
  // Populated only after payment_status === 'paid'.
  full: BlueprintOutput | null
}

/**
 * GET /api/blueprint/[id]
 *
 * Read endpoint for both the free preview and the paid full page.
 *
 * Auth model differs from the report endpoint: blueprint preview is
 * intentionally public (the wizard's whole point is showing the owner
 * the recommendation type before they pay). Payment gates ONLY the full
 * blueprint reasoning. Pattern:
 *
 *   status=draft           → preview: null, full: null
 *   status=generated       → preview: filled, full: null   (preview UI)
 *   payment_status=paid    → preview: filled, full: filled (full UI)
 *
 * Cache: no-store. The blueprint can transition draft→generated→paid
 * within seconds; we never want a CDN serving the previous state.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  if (!UUID_RE.test(id)) {
    return noStoreJson({ error: 'Invalid blueprint id' }, 400)
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('website_blueprints')
    .select(
      'id, status, payment_status, business_name, owner_name, blueprint_json',
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[blueprint/get] db error', {
      blueprint_id: id,
      error: error.message,
    })
    return noStoreJson({ error: 'Could not load blueprint' }, 500)
  }

  if (!data) {
    return noStoreJson({ error: 'Blueprint not found' }, 404)
  }

  const blueprint =
    data.blueprint_json && typeof data.blueprint_json === 'object'
      ? (data.blueprint_json as BlueprintOutput)
      : null

  // Status-derived booleans. Defensive: a row could in theory have
  // payment_status='paid' without status advancing past 'generated' if
  // the verify route landed before the status update — both states are
  // accepted as "paid" for read purposes.
  const isGenerated = blueprint !== null
  const isPaid = data.payment_status === 'paid'

  const preview: BlueprintPreviewFields | null = isGenerated
    ? {
        understood: blueprint!.understood,
        recommendation: blueprint!.recommendation,
        recommendation_label: blueprint!.recommendation_label,
      }
    : null

  const response: BlueprintGetResponse = {
    blueprint_id: data.id,
    status: data.status as BlueprintGetResponse['status'],
    payment_status: data.payment_status as BlueprintGetResponse['payment_status'],
    business_name: data.business_name ?? null,
    owner_name: data.owner_name ?? null,
    preview,
    full: isPaid ? blueprint : null,
  }

  return noStoreJson(response)
}
