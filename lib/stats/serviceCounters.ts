import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Cumulative service-delivery counters for the homepage trust band.
 *
 * Three numbers — websites audited, blueprints generated, briefs
 * delivered. Counts only fully-delivered service (paid + complete);
 * in-flight scans and abandoned drafts are excluded.
 *
 * Cached for 24h via `unstable_cache`. The tag SERVICE_COUNTERS_TAG is
 * invalidated from each service-delivery point:
 *   - lib/scan/phase2.ts            scan flips to status='complete'
 *   - app/api/blueprint/payment/verify/route.ts (first paid flip)
 *   - app/api/brief/payment/verify/route.ts     (first paid flip)
 * so the band catches up within seconds of any new completion and
 * otherwise serves from cache without hitting Supabase.
 */

export type ServiceCounters = {
  audited: number
  blueprints: number
  briefs: number
}

export const SERVICE_COUNTERS_TAG = 'service-counters'

// Floor to suppress the band on a fresh launch — single-digit numbers
// erode trust more than no section does. The band reappears organically
// once any one counter clears its threshold. Tune per real traction.
const VISIBLE_FLOOR = { audited: 25, blueprints: 5, briefs: 5 }

export async function getServiceCounters(): Promise<ServiceCounters | null> {
  const counters = await getCachedCounters()
  if (
    counters.audited < VISIBLE_FLOOR.audited &&
    counters.blueprints < VISIBLE_FLOOR.blueprints &&
    counters.briefs < VISIBLE_FLOOR.briefs
  ) {
    return null
  }
  return counters
}

const getCachedCounters = unstable_cache(
  async (): Promise<ServiceCounters> => {
    const supabase = createServiceClient()

    // head:true + count:'exact' returns the count without the rows —
    // cheapest way to ask Supabase "how many?" against a paid+complete
    // filter. Three queries in parallel; no foreign-key joins.
    const [audited, blueprints, briefs] = await Promise.all([
      supabase
        .from('scans')
        .select('id', { count: 'exact', head: true })
        .eq('payment_status', 'paid')
        .eq('status', 'complete'),
      supabase
        .from('website_blueprints')
        .select('id', { count: 'exact', head: true })
        .eq('payment_status', 'paid'),
      supabase
        .from('briefs')
        .select('id', { count: 'exact', head: true })
        .eq('payment_status', 'paid'),
    ])

    if (audited.error) {
      console.error('[service-counters] scans count failed', {
        error: audited.error.message,
      })
    }
    if (blueprints.error) {
      console.error('[service-counters] blueprints count failed', {
        error: blueprints.error.message,
      })
    }
    if (briefs.error) {
      console.error('[service-counters] briefs count failed', {
        error: briefs.error.message,
      })
    }

    return {
      audited: audited.count ?? 0,
      blueprints: blueprints.count ?? 0,
      briefs: briefs.count ?? 0,
    }
  },
  ['service-counters-v1'],
  { revalidate: 86400, tags: [SERVICE_COUNTERS_TAG] },
)

const compactFormatter = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatCounter(n: number): string {
  if (n < 1000) return n.toLocaleString('en-IN')
  return compactFormatter.format(n)
}
