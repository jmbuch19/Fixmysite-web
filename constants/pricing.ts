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
