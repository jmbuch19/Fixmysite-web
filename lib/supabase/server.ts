import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for server-side use only.
 *
 * Bypasses Row Level Security — DO NOT pass this client (or its key) to the
 * browser. Use it from API routes, Server Actions, and Server Components
 * for all reads and writes against fixmysite tables. The migration enables
 * RLS with no policies, so this is the ONLY way the app can read or write.
 *
 * Returns a fresh client per call. Service-role auth is stateless, so
 * callers may also cache the result at module scope if hot-path perf matters.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
