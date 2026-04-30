import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Protects /admin/* routes. Anything under /admin requires:
 *   1. An active Supabase session (signed in via magic link)
 *   2. The user's email matches ADMIN_EMAIL exactly
 *
 * Login page itself (/admin/login) is excluded so the redirect target is
 * reachable. Auth callback (/auth/callback) is also excluded so magic-link
 * sign-in can complete its code-for-session exchange.
 */
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  // Only gate /admin/* paths. Everything else passes straight through.
  if (!path.startsWith('/admin')) return NextResponse.next()
  // Login page itself must be reachable without a session.
  if (path === '/admin/login') return NextResponse.next()

  let res = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            req.cookies.set(name, value),
          )
          res = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser() refreshes the session token if needed and writes new cookies
  // through the setAll adapter above. Don't replace with getSession() —
  // it doesn't validate the JWT against Auth's server.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const url = req.nextUrl.clone()
    url.pathname = '/admin/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  // Email allowlist (defense in depth — login action also checks this).
  const allowed = process.env.ADMIN_EMAIL?.toLowerCase().trim()
  if (!allowed || user.email?.toLowerCase().trim() !== allowed) {
    const url = req.nextUrl.clone()
    url.pathname = '/admin/login'
    url.searchParams.set('error', 'unauthorized')
    return NextResponse.redirect(url)
  }

  return res
}

export const config = {
  matcher: ['/admin/:path*'],
}
