import { z } from 'zod'
import { coerceToUrl, normalizeUrl } from '@/lib/scan/extractor'
import { checkPreviousScan } from '@/lib/scan/returnVisit'
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

export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'check-previous',
    limit: 20,
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

  let urlNormalized: string
  try {
    urlNormalized = normalizeUrl(coerceToUrl(url))
  } catch {
    return Response.json(
      { error: 'Invalid URL', reason: 'invalid_url' },
      { status: 400 },
    )
  }

  const previous = await checkPreviousScan(urlNormalized)
  if (!previous) {
    return Response.json({ found: false }, { status: 200 })
  }

  return Response.json({ found: true, scan: previous }, { status: 200 })
}
