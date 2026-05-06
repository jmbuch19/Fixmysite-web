import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/security/rateLimit'
import { DEVELOPER_SKILLS, YEARS_EXP_OPTIONS } from '@/lib/developer/skills'
import {
  sendDeveloperRegisteredToAdmin,
  sendDeveloperRegisteredToApplicant,
} from '@/lib/email/sender'
import {
  buildDecisionUrl,
  signApprovalToken,
} from '@/lib/developer/approvalToken'
import { resolveAppUrl } from '@/lib/queue/qstash'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SKILL_SET = new Set<string>(DEVELOPER_SKILLS)
const YEARS_EXP_VALUES = new Set<number>(YEARS_EXP_OPTIONS.map((o) => o.value))

const bodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).toLowerCase(),
  phone: z.string().trim().min(7).max(20),
  city: z.string().trim().min(2).max(80),
  // At least one skill required — the marketplace can't match a partner
  // with zero advertised skills. Server validates against the same
  // canonical list the form renders, so a tampered client cannot
  // inject arbitrary tags.
  skills: z
    .array(z.string())
    .min(1)
    .refine((arr) => arr.every((s) => SKILL_SET.has(s)), {
      message: 'unknown skill',
    }),
  portfolio_url: z
    .string()
    .trim()
    .url()
    .max(500)
    .optional()
    .or(z.literal('')),
  years_exp: z
    .number()
    .int()
    .refine((v) => YEARS_EXP_VALUES.has(v), { message: 'unknown years_exp' }),
})

/**
 * POST /api/developer/register
 *
 * Public endpoint — anyone can register. Inserts into
 * `developer_partners` with `verified=false`. Admin approves manually
 * via the admin panel (separate route, not yet built).
 *
 * Rate limit: 3/hour/IP — generous enough for a real applicant who
 * needs to retry, tight enough to make spam expensive.
 *
 * Duplicate-email handling is friendly. We don't disclose whether the
 * email exists (tiny privacy nicety for partner discovery), but we DO
 * give the applicant a clear next step in either case.
 *
 * Response shapes:
 *   201 { ok: true, message }                    — newly registered
 *   200 { ok: true, already_registered: true }   — duplicate email
 *   400 { error, issues? }                       — validation failure
 *   429 { ... } via rateLimitResponse            — rate limited
 *   500 { error }                                — DB or unexpected failure
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  const rl = await rateLimit({
    name: 'developer-register',
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
      {
        error: 'Please check the form and try again.',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const data = parsed.data
  const supabase = createServiceClient()

  // ─── Duplicate-email check (case-insensitive) ────────────────────────
  // The unique index is on lower(email); we do a pre-flight read so we
  // can return a friendlier shape than a raw 23505 unique violation.
  const { data: existing, error: lookupError } = await supabase
    .from('developer_partners')
    .select('id, verified')
    .ilike('email', data.email)
    .maybeSingle()

  if (lookupError) {
    console.error('[developer/register] lookup failed', {
      email: data.email,
      error: lookupError.message,
    })
    return Response.json(
      { error: 'Could not process registration. Please try again.' },
      { status: 500 },
    )
  }

  if (existing) {
    return Response.json(
      {
        ok: true,
        already_registered: true,
        verified: existing.verified,
      },
      { status: 200 },
    )
  }

  // ─── Insert ─────────────────────────────────────────────────────────
  // .select('id').single() so we can sign approval tokens for the row
  // we just created. Without it the admin notification email can't
  // include working Approve / Reject links.
  const { data: inserted, error: insertError } = await supabase
    .from('developer_partners')
    .insert({
      name: data.name,
      email: data.email,
      phone: data.phone,
      city: data.city,
      skills: data.skills,
      portfolio_url:
        data.portfolio_url && data.portfolio_url.length > 0
          ? data.portfolio_url
          : null,
      years_exp: data.years_exp,
      // verified, active, plan, jobs_completed, etc. all use schema
      // defaults — explicit insert keeps insert payload clean.
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    // Defence-in-depth — if the pre-flight check raced with another
    // insert and we hit the unique index, treat it as already-registered
    // rather than 500ing the applicant.
    if (insertError?.code === '23505') {
      return Response.json(
        { ok: true, already_registered: true, verified: false },
        { status: 200 },
      )
    }
    console.error('[developer/register] insert failed', {
      email: data.email,
      error: insertError?.message,
      code: insertError?.code,
    })
    return Response.json(
      { error: 'Could not save your registration. Please try again.' },
      { status: 500 },
    )
  }

  const partnerId = inserted.id as string

  // ─── Sign approval tokens + build admin decision URLs ──────────────
  // Tokens are HMAC-signed JWTs (jose HS256), 7-day expiry. The route
  // /api/developer/decide validates them and applies the state change
  // idempotently. Failure here (e.g. APPROVAL_TOKEN_SECRET unset) is
  // caught and logged — the registration still succeeds, but the admin
  // email falls back to a no-link variant via empty URL strings, which
  // /api/cron/auto-approve-developers will catch up on at 48h regardless.
  const appUrl = resolveAppUrl() ?? 'https://fixmysite.in'
  let approveUrl = ''
  let rejectUrl = ''
  try {
    const [approveToken, rejectToken] = await Promise.all([
      signApprovalToken({ partnerId, action: 'approve' }),
      signApprovalToken({ partnerId, action: 'reject' }),
    ])
    approveUrl = buildDecisionUrl({ appUrl, token: approveToken })
    rejectUrl = buildDecisionUrl({ appUrl, token: rejectToken })
  } catch (err) {
    console.error(
      '[developer/register] approval token signing failed — admin email will lack one-click links, auto-approval cron will still cover this row',
      {
        partner_id: partnerId,
        error: err instanceof Error ? err.message : err,
      },
    )
  }

  // ─── Notification emails (fire-and-log, never block the response) ──
  // Applicant: confirmation that the application landed + what happens
  // next. Admin: inline summary + signed Approve / Reject one-click
  // links so the founder can decide from inbox without logging into
  // Supabase. Email failure is logged loudly but the applicant still
  // gets the 201 — registration row is the durable fact.
  //
  // We deliberately await both sends rather than fire-and-forget so
  // the serverless function isn't killed mid-Resend-call. Per existing
  // patterns in /api/blueprint/payment/verify and /api/brief/payment/verify.
  const registeredAt = new Date().toISOString()
  const [applicantResult, adminResult] = await Promise.all([
    sendDeveloperRegisteredToApplicant({
      to: data.email,
      name: data.name,
    }),
    sendDeveloperRegisteredToAdmin({
      name: data.name,
      email: data.email,
      phone: data.phone,
      city: data.city,
      skills: data.skills,
      portfolioUrl:
        data.portfolio_url && data.portfolio_url.length > 0
          ? data.portfolio_url
          : null,
      yearsExp: data.years_exp,
      registeredAt,
      approveUrl,
      rejectUrl,
    }),
  ])
  if (!applicantResult.ok) {
    console.error('[developer/register] applicant email failed', {
      email: data.email,
      reason: applicantResult.reason,
      error: applicantResult.error,
    })
  }
  if (!adminResult.ok && adminResult.reason !== 'no_api_key') {
    console.error('[developer/register] admin email failed', {
      applicant_email: data.email,
      reason: adminResult.reason,
      error: adminResult.error,
    })
  }

  // TODO(posthog): fire 'developer_registered' server-side event with
  // { city, skills_count } per SPEC §19 PostHog table.

  return Response.json(
    {
      ok: true,
      message: "Registration received. Bugbite will review within 48 hours.",
    },
    { status: 201 },
  )
}
