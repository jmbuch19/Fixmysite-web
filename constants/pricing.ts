export const SCAN_TIERS = {
  small:  { name: 'small',  maxPages: 10,  price: 49,  label: 'Small'  },
  medium: { name: 'medium', maxPages: 50,  price: 149, label: 'Medium' },
  large:  { name: 'large',  maxPages: 200, price: 349, label: 'Large'  },
} as const

export const SUBSCRIPTION_PRICE = 99
export const AGENCY_PRICE       = 999

export type TierName = keyof typeof SCAN_TIERS
export type Tier     = typeof SCAN_TIERS[TierName]

/**
 * Returns the pricing tier for a given page count, or `null` for sites
 * larger than 200 pages (enterprise — handled via contact form, not
 * automated checkout). Callers MUST handle the null case explicitly:
 * route to /agency or a contact-us flow rather than to Razorpay checkout.
 *
 * Note: the DB `scans.tier` CHECK constraint allows the value 'enterprise',
 * so enterprise scans can still be persisted once a manual quote is agreed.
 */
export function getTier(pageCount: number): Tier | null {
  if (pageCount <= 10)  return SCAN_TIERS.small
  if (pageCount <= 50)  return SCAN_TIERS.medium
  if (pageCount <= 200) return SCAN_TIERS.large
  return null
}

export const toPaise = (rupees: number): number => Math.round(rupees * 100)

// ─── Brief pricing (CLAUDE.md spec) ─────────────────────────────────────

export const BRIEF_PRICING = {
  text_only:        { price: 99,  label: 'Developer Brief' },
  with_screenshots: { price: 199, label: 'Developer Brief + Screenshots' },
  bundle:           { price: 199, label: 'Scan + Brief Bundle' },
} as const

// ─── Predefined intake cards for the brief input form ──────────────────
//
// Owner-facing labels (with emoji prefix for the on-page UI). The
// brief generator strips the emoji before sending to Claude — emoji
// adds no signal and keeps the prompt tidy.
//
// Keys are stored in the DB and passed in API bodies; never rename a
// key without a migration. Labels can be edited freely.

export const PREDEFINED_CARDS = [
  { key: 'looks_old',       label: '🎨 My website looks old' },
  { key: 'mobile_bad',      label: "📱 Doesn't look good on mobile" },
  { key: 'seo_poor',        label: "🔍 People can't find me on Google" },
  { key: 'contact_hard',    label: "📞 Customers can't contact me easily" },
  { key: 'products_hard',   label: '🛒 Hard to show my products/services' },
  { key: 'photos_bad',      label: '📸 My photos look bad' },
  { key: 'slow',            label: '⚡ Website feels slow' },
  { key: 'add_feature',     label: '📝 I want to add something new' },
  { key: 'booking_needed',  label: '📅 I want online booking' },
  { key: 'whatsapp_needed', label: '💬 I want WhatsApp integration' },
  { key: 'payment_needed',  label: '💳 I want to accept payments online' },
  { key: 'language_needed', label: '🌐 I want my website in another language' },
] as const

export type PredefinedCardKey = (typeof PREDEFINED_CARDS)[number]['key']

/**
 * Map an array of stored card keys to their human-readable labels with
 * the leading emoji stripped. Used by the Claude brief prompt — emoji
 * is owner-UI decoration, not signal for the LLM.
 */
export function cardKeysToLabels(keys: readonly string[]): string[] {
  // Widen the Map's key/value types to plain string — `PREDEFINED_CARDS`
  // is `as const`, so without the explicit annotation TypeScript would
  // narrow keys/values to literal unions and `byKey.get(arbitraryString)`
  // would fail to typecheck.
  const byKey = new Map<string, string>(
    PREDEFINED_CARDS.map((c) => [c.key, c.label]),
  )
  const out: string[] = []
  for (const k of keys) {
    const label = byKey.get(k)
    if (label) out.push(stripLeadingEmoji(label))
  }
  return out
}

function stripLeadingEmoji(label: string): string {
  // The emoji prefix is followed by a single space. We strip everything
  // up to the first ASCII letter so any Unicode-range emoji works.
  const match = label.match(/^[^A-Za-z]+(.+)$/)
  return match ? match[1]!.trim() : label
}
