import { z } from 'zod'
import { coerceToUrl } from '@/lib/scan/extractor'
import { classifyUrl, type UrlClass } from '@/lib/scan/classifier'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  url: z.string().min(3).max(2048),
})

/**
 * Pre-Phase-1 URL classifier. Runs on every URL submit BEFORE any scan
 * row is created — this is what enables Path E (fun-seeker exit) to leave
 * zero DB rows: classify first, then either show admin gate, institution
 * upsell, or proceed to Phase 1 based on the returned class.
 *
 * Pure classification — no DB writes, no outbound fetches, no SSRF guard
 * (we never fetch the user's URL here, only parse the hostname).
 *
 * Response shape:
 *   { class: UrlClass, hostname: string }
 *   `hostname` is the post-normalisation form (lowercase, no leading
 *   `www.`, no trailing dot) — suitable for direct UI display.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'classify-url',
    limit: 30,
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

  let hostname: string
  try {
    const coerced = coerceToUrl(url)
    hostname = new URL(coerced).hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '')
  } catch {
    return Response.json(
      { error: 'Invalid URL', reason: 'invalid_url' },
      { status: 400 },
    )
  }

  const urlClass: UrlClass = classifyUrl(hostname)

  return Response.json({
    class: urlClass,
    hostname,
  })
}
