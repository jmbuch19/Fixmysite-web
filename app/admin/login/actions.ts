'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAuthClient, isAdminEmail } from '@/lib/supabase/auth'

/**
 * Server action — sends a magic-link sign-in to the submitted email IF
 * that email matches ADMIN_EMAIL. Non-admin emails are silently rejected
 * with the same generic redirect; we don't enumerate which addresses are
 * allowed.
 *
 * `emailRedirectTo` is derived from the actual incoming request's
 * Host/X-Forwarded-Proto headers — works on localhost during dev and on
 * the production domain after deployment without env-var juggling.
 *
 * Per rule #50 — every error redirects with a `?error=` so the page can
 * show a clear next-action message.
 */
export async function signInWithMagicLink(formData: FormData): Promise<void> {
  const raw = String(formData.get('email') ?? '')
  const email = raw.toLowerCase().trim()

  if (!email || !email.includes('@')) {
    redirect('/admin/login?error=invalid_email')
  }

  // Allowlist check — refuse to issue magic links to non-admin addresses.
  // Defence in depth (middleware also enforces) but more importantly this
  // stops us from spamming Resend with magic links to whoever the form
  // gets pasted at.
  if (!isAdminEmail(email)) {
    redirect('/admin/login?error=not_allowed')
  }

  const headerList = await headers()
  const host = headerList.get('host') ?? 'localhost:3000'
  const proto =
    headerList.get('x-forwarded-proto') ??
    (host.startsWith('localhost') ? 'http' : 'https')
  const origin = `${proto}://${host}`

  const supabase = await createAuthClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      shouldCreateUser: true,
    },
  })

  if (error) {
    console.error('[admin/login] signInWithOtp failed', {
      email,
      origin,
      error: error.message,
    })
    redirect('/admin/login?error=send_failed')
  }

  redirect('/admin/login?sent=1')
}
