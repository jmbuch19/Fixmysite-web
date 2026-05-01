import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // Optional `source` so future placements (footer, dedicated /waitlist
  // page, embedded share cards) can tag where each signup came from.
  // Defaults to 'landing' — matches the column default.
  source: z.string().trim().min(1).max(40).optional(),
})

/**
 * POST /api/waitlist/join
 *
 * Adds an email to the waitlist. Quiet on duplicates — if the email is
 * already in the table we still return 200 with `ok: true`. The visitor
 * does not need to know they already joined; surfacing "already on the
 * list" tells everyone with a known email whether someone is on the
 * waitlist, which is a tiny privacy leak we prefer to avoid.
 *
 * Rate limit: 3/hour/IP. Generous enough for honest typo-and-retry,
 * tight enough to make scraping the form expensive.
 *
 * No email confirmation in v1 — the value is the captured signal, not
 * the relationship. Confirmation emails ship in v1.1 alongside the
 * Blueprint Engine launch announcement campaign.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'waitlist-join',
    limit: 3,
    windowSec: 3600,
    key: ip,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { error: 'Please enter a valid email.' },
      { status: 400 },
    )
  }

  const { email, source = 'landing' } = parsed.data

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('waitlist')
    .insert({ email, source })

  if (error) {
    // 23505 = unique violation. Treat as success per the privacy rule
    // above — visitor sees the same confirmation either way.
    if (error.code === '23505') {
      return Response.json({ ok: true }, { status: 200 })
    }
    console.error('[waitlist] insert failed', {
      email,
      source,
      error: error.message,
      code: error.code,
    })
    return Response.json(
      { error: 'Could not join the waitlist. Please try again.' },
      { status: 500 },
    )
  }

  // TODO(posthog): fire 'waitlist_joined' event with { source } when
  // posthog-node is wired up.

  return Response.json({ ok: true }, { status: 200 })
}
