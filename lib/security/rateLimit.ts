import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

let _redis: Redis | null = null
let _enabled: boolean | null = null
let _warned = false

function getRedis(): Redis | null {
  if (_enabled === false) return null
  if (_redis) return _redis

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    if (!_warned) {
      console.warn(
        '[rateLimit] UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is DISABLED (fail-open). Set both env vars before production deployment.',
      )
      _warned = true
    }
    _enabled = false
    return null
  }

  _enabled = true
  _redis = new Redis({ url, token })
  return _redis
}

const limiters = new Map<string, Ratelimit>()

function getLimiter(name: string, limit: number, windowSec: number): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null

  const cacheKey = `${name}:${limit}:${windowSec}`
  let limiter = limiters.get(cacheKey)
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      analytics: false,
      prefix: `rl:${name}`,
    })
    limiters.set(cacheKey, limiter)
  }
  return limiter
}

export type RateLimitResult = {
  ok: boolean
  limit: number
  remaining: number
  reset: number // unix ms timestamp when the window resets
}

/**
 * Rate-limit a request. Fail-open: returns ok=true if Upstash env vars are
 * missing (with one warning logged per process). In production, set both
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
 *
 * Usage:
 *   const ip = getClientIp(req)
 *   const r = await rateLimit({ name: 'phase1', limit: 10, windowSec: 3600, key: ip })
 *   if (!r.ok) return rateLimitResponse(r)
 */
export async function rateLimit(args: {
  name: string
  limit: number
  windowSec: number
  key: string
}): Promise<RateLimitResult> {
  const limiter = getLimiter(args.name, args.limit, args.windowSec)
  if (!limiter) {
    return { ok: true, limit: args.limit, remaining: args.limit, reset: 0 }
  }
  const r = await limiter.limit(args.key)
  return {
    ok: r.success,
    limit: r.limit,
    remaining: r.remaining,
    reset: r.reset,
  }
}

/**
 * Build a 429 response with standard rate-limit headers. The Retry-After
 * header is in seconds.
 */
export function rateLimitResponse(r: RateLimitResult): Response {
  const retryAfter = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000))
  return new Response('Too Many Requests', {
    status: 429,
    headers: {
      'Retry-After': retryAfter.toString(),
      'X-RateLimit-Limit': r.limit.toString(),
      'X-RateLimit-Remaining': r.remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(r.reset / 1000).toString(),
    },
  })
}

/**
 * Extract the client IP from request headers. Vercel sets x-forwarded-for
 * and x-real-ip. Falls back to a constant 'unknown' if neither is present —
 * meaning all such traffic shares one bucket. Acceptable as a safety net.
 */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real
  return 'unknown'
}
