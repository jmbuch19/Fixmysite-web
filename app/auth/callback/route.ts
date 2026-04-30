import { NextResponse, type NextRequest } from 'next/server'
import { createAuthClient, isAdminEmail } from '@/lib/supabase/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Magic-link callback. Supabase emails the admin a URL like:
 *   {APP_URL}/auth/callback?code=<pkce_code>
 *
 * We exchange the code for a session, then redirect:
 *   - admin email + valid session → /admin (or `next` param if present)
 *   - any failure → /admin/login with a specific `error` reason so the
 *     login page can render a clear next-action message (rule #50).
 *
 * The session is written to cookies by the SSR client's adapter — no
 * extra work needed here.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/admin'

  if (!code) {
    return NextResponse.redirect(`${origin}/admin/login?error=missing_code`)
  }

  const supabase = await createAuthClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchange failed', {
      error: error.message,
    })
    return NextResponse.redirect(
      `${origin}/admin/login?error=exchange_failed`,
    )
  }

  // Defence in depth — even if the magic link was issued, confirm the
  // logged-in user matches the admin allowlist before redirecting them
  // into the admin area.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    // Sign them back out so a stale non-admin session can't linger.
    await supabase.auth.signOut()
    return NextResponse.redirect(
      `${origin}/admin/login?error=unauthorized`,
    )
  }

  // Only redirect to internal `next` paths.
  const safeNext =
    next.startsWith('/') && !next.startsWith('//') ? next : '/admin'
  return NextResponse.redirect(`${origin}${safeNext}`)
}
