// Not used until user auth is added.
// Stub for future client-side auth flows (login, password reset, etc.).
// The current MVP scan flow is anonymous and reads/writes happen exclusively
// through server-side API routes using the service-role client (server.ts).

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

export function createSupabaseBrowserClient(): SupabaseClient {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
