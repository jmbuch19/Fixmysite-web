import Link from 'next/link'
import { signOut } from '@/app/admin/actions'

/**
 * Shared header for authenticated /admin/* pages. Clicking the brand
 * navigates to the admin dashboard, not the consumer homepage — admin
 * shouldn't drop out of context unintentionally.
 *
 * Sign-out posts to the server action which clears the Supabase session
 * cookie and redirects back to /admin/login.
 */
export function AdminHeader({ email }: { email: string }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="text-lg font-semibold text-brand"
          >
            fixmysite.in
          </Link>
          <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
            admin
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-600">{email}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="text-sm font-medium text-zinc-700 transition-colors hover:text-zinc-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
