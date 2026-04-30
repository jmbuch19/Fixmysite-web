import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { getClientIp, rateLimit, rateLimitResponse } from '@/lib/security/rateLimit'
import { runPhase1, type Phase1Failure } from '@/lib/scan/phase1'

export const runtime = 'nodejs'

const bodySchema = z.object({
  url: z.string().min(3).max(2048),
})

export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'phase1',
    limit: 10,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let url: string
  try {
    const json = await req.json()
    url = bodySchema.parse(json).url
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const outcome = await runPhase1(url)

  if (!outcome.ok) {
    const { status, payload } = mapFailure(outcome)
    console.warn('[phase1] scan failed before insert', {
      ip,
      url,
      reason: outcome.reason,
      message: outcome.message,
    })
    return Response.json(payload, { status })
  }

  const phase1 = outcome.data
  const supabase = createServiceClient()

  const { data: inserted, error: insertError } = await supabase
    .from('scans')
    .insert({
      url: phase1.url,
      url_normalized: phase1.urlNormalized,
      page_count: phase1.pageCount.count,
      tier: phase1.tier,
      status: 'phase1_complete',
      phase1_result: phase1,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[phase1] failed to insert scan row', {
      ip,
      url_normalized: phase1.urlNormalized,
      error: insertError?.message,
    })
    return Response.json({ error: 'Failed to record scan' }, { status: 500 })
  }

  return Response.json(
    {
      scan_id: inserted.id,
      ...phase1,
    },
    { status: 201 },
  )
}

function mapFailure(failure: Phase1Failure): { status: number; payload: Record<string, unknown> } {
  switch (failure.reason) {
    case 'invalid_url':
      return {
        status: 400,
        payload: { error: 'Invalid URL', reason: 'invalid_url' },
      }
    case 'blocked':
      // Do not leak the specific SSRF reason — could help an attacker probe
      // internal infrastructure layout. Generic message only.
      return {
        status: 400,
        payload: { error: 'Cannot scan that URL', reason: 'blocked' },
      }
    case 'timeout':
      return {
        status: 504,
        payload: { error: 'Site did not respond in time', reason: 'timeout' },
      }
    case 'network':
      return {
        status: 502,
        payload: { error: 'Could not reach the site', reason: 'network' },
      }
    case 'http_error':
      return {
        status: 502,
        payload: {
          error: `Site returned HTTP ${failure.status}`,
          reason: 'http_error',
          upstream_status: failure.status,
        },
      }
  }
}
