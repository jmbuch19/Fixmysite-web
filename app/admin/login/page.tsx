import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAuthClient, isAdminEmail } from '@/lib/supabase/auth'
import { signInWithMagicLink } from './actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SearchParams = {
  sent?: string
  error?: string
  next?: string
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // Already-logged-in admins skip the form.
  const supabase = await createAuthClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user && isAdminEmail(user.email)) {
    redirect('/admin')
  }

  const params = await searchParams
  const sent = params.sent === '1'
  const errorMessage = mapLoginError(params.error)

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center px-5 py-4 sm:px-8">
          <Link href="/" className="text-lg font-semibold text-brand">
            fixmysite.in
          </Link>
        </div>
      </header>

      <main className="flex-1 bg-brand-surface">
        <div className="mx-auto w-full max-w-md px-5 py-16 sm:px-8 sm:py-20">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              Admin sign-in
            </h1>
            <p className="mt-2 text-sm text-zinc-700">
              Enter your admin email. We&apos;ll send you a one-time
              sign-in link.
            </p>

            {sent ? (
              <SentNotice />
            ) : (
              <form action={signInWithMagicLink} className="mt-6">
                <label
                  htmlFor="admin-email"
                  className="text-sm font-medium text-zinc-900"
                >
                  Admin email
                </label>
                <input
                  id="admin-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  placeholder="hello@fixmysite.in"
                  aria-invalid={errorMessage !== null}
                  aria-describedby={errorMessage ? 'admin-login-error' : undefined}
                  className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <button
                  type="submit"
                  className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-accent"
                >
                  Send sign-in link
                </button>
              </form>
            )}

            {errorMessage && (
              <p
                id="admin-login-error"
                role="alert"
                className="mt-4 text-sm text-amber-700"
              >
                {errorMessage}
              </p>
            )}

            <p className="mt-6 text-xs text-zinc-500">
              Only the configured admin email can sign in. Other addresses
              receive no email.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} fixmysite.in</span>
          <span>Made for Indian businesses</span>
        </div>
      </footer>
    </div>
  )
}

function SentNotice() {
  return (
    <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-medium">Check your inbox.</p>
      <p className="mt-1 leading-relaxed">
        We sent a one-time sign-in link. Click it within 15 minutes. The
        link only works in the same browser you requested it from.
      </p>
    </div>
  )
}

function mapLoginError(reason: string | undefined): string | null {
  switch (reason) {
    case 'invalid_email':
      return 'Please enter a valid email address.'
    case 'not_allowed':
      // Generic — don't enumerate which email is the admin.
      return 'That email is not authorised. If you think this is wrong, contact hello@fixmysite.in.'
    case 'send_failed':
      return 'Could not send the sign-in link. Try again in a moment, or contact hello@fixmysite.in.'
    case 'missing_code':
      return 'The sign-in link was incomplete. Request a fresh one.'
    case 'exchange_failed':
      return 'The sign-in link is expired or invalid. Request a fresh one.'
    case 'unauthorized':
      return 'Your session is no longer authorised. Sign in again with the admin email.'
    default:
      return null
  }
}
