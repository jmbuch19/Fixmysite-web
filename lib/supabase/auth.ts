import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Cookie-aware Supabase client for **session auth** flows (admin magic-link
 * login, /auth/callback, middleware). Uses the anon key — never the service
 * role — because the session belongs to the user, not the server.
 *
 * Distinct from `createServiceClient` (lib/supabase/server.ts), which uses
 * the service-role key to bypass RLS for app-side reads/writes. Don't mix:
 *   - Service role  → app data (scans, inquiries, briefs, etc.)
 *   - Auth client   → user identity, sessions, magic-link verification
 *
 * The `setAll` try/catch handles the read-only-cookie case in Server
 * Components — Next.js disallows cookie writes there, but Supabase's SSR
 * client tries anyway during session refresh. Middleware handles the actual
 * session-cookie writing.
 */
export async function createAuthClient() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          /* Server Component context — middleware updates session cookies */
        }
      },
    },
  })
}

/**
 * Compare an email against the ADMIN_EMAIL env var, case-insensitive.
 *
 * Single source of truth for "is this user the admin" — used in both the
 * login server action (to refuse magic-link sends to non-admin emails) and
 * middleware (defense in depth — if a session was minted some other way).
 *
 * Returns false if ADMIN_EMAIL is unset, so the admin panel is locked
 * shut by default in misconfigured environments.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = process.env.ADMIN_EMAIL?.toLowerCase().trim()
  if (!allowed) return false
  return email.toLowerCase().trim() === allowed
}
