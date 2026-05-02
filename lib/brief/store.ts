import { createServiceClient } from '@/lib/supabase/server'
import type { BriefOutput } from '@/lib/claude/brief'

/**
 * Read-side queries for the briefs table. Writes live in service.ts.
 *
 * "Latest brief" semantics drive the page-level URL design — every
 * `/brief/[scan_id]/...` route shows whichever brief is most recent for
 * that scan, regardless of which one the owner generated five minutes
 * ago vs. yesterday. Re-submitting the input form overwrites what the
 * preview page shows; once a paid brief exists it surfaces at /full
 * even if a newer unpaid one is generated afterwards.
 */

export type BriefRow = {
  id: string
  scan_id: string | null
  owner_input: string | null
  detected_language: string | null
  business_type: string | null
  predefined_selections: string[] | null
  brief_json: BriefOutput | null
  brief_pdf_url: string | null
  payment_id: string | null
  payment_status: 'unpaid' | 'paid' | 'refunded' | 'failed'
  razorpay_order_id: string | null
  price_paise: number
  owner_email: string | null
  dev_email: string | null
  created_at: string
  sent_at: string | null
}

const BRIEF_FIELDS =
  'id, scan_id, owner_input, detected_language, business_type, predefined_selections, brief_json, brief_pdf_url, payment_id, payment_status, razorpay_order_id, price_paise, owner_email, dev_email, created_at, sent_at'

/**
 * Latest brief for a scan, regardless of payment status. Used by the
 * preview page (which renders the latest, locked or unlocked) and by
 * the input page (to detect whether the owner already has a brief in
 * flight that they could continue rather than re-submit).
 */
export async function getLatestBriefForScan(
  scan_id: string,
): Promise<BriefRow | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('briefs')
    .select(BRIEF_FIELDS)
    .eq('scan_id', scan_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[brief/store] getLatestBriefForScan failed', {
      scan_id,
      error: error.message,
    })
    return null
  }
  return (data as BriefRow | null) ?? null
}

/**
 * Latest PAID brief for a scan. Used by the /full page so a freshly
 * generated unpaid brief never replaces the paid one the owner is
 * entitled to see.
 */
export async function getLatestPaidBriefForScan(
  scan_id: string,
): Promise<BriefRow | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('briefs')
    .select(BRIEF_FIELDS)
    .eq('scan_id', scan_id)
    .eq('payment_status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[brief/store] getLatestPaidBriefForScan failed', {
      scan_id,
      error: error.message,
    })
    return null
  }
  return (data as BriefRow | null) ?? null
}

/**
 * Single brief lookup by id. Used by the payment routes to load the
 * exact brief being paid for (rather than guessing via scan_id, which
 * could match the wrong row if the owner generated multiple briefs).
 */
export async function getBriefById(
  brief_id: string,
): Promise<BriefRow | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('briefs')
    .select(BRIEF_FIELDS)
    .eq('id', brief_id)
    .maybeSingle()

  if (error) {
    console.error('[brief/store] getBriefById failed', {
      brief_id,
      error: error.message,
    })
    return null
  }
  return (data as BriefRow | null) ?? null
}
