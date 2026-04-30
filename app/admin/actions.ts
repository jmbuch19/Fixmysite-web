'use server'

import { redirect } from 'next/navigation'
import { createAuthClient } from '@/lib/supabase/auth'

/**
 * Sign out the current admin session.
 *
 * Called from the dashboard's sign-out form. Clears session cookies via
 * Supabase Auth, then redirects to the login screen. The middleware will
 * subsequently treat any /admin/* request as unauthenticated.
 */
export async function signOut(): Promise<void> {
  const supabase = await createAuthClient()
  await supabase.auth.signOut()
  redirect('/admin/login')
}
