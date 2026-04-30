/**
 * Single source of truth for URL classification + email validation.
 *
 * Imported by:
 *   - /lib/scan/classifier.ts        (classifyUrl: hostname → UrlClass)
 *   - /lib/scan/trust.ts             (Standard-tier email identity check)
 *   - /lib/enterprise/domainMatch.ts (Complex+ domain-match validation)
 *
 * Match semantics, by category:
 *   - GLOBAL_ENTERPRISE_DOMAINS / INDIAN_ENTERPRISE_DOMAINS:
 *     hostname === d  ||  hostname.endsWith('.' + d)
 *     (so `mail.tatamotors.com` classifies as Indian enterprise)
 *   - INSTITUTION_TLDS:
 *     hostname.endsWith(tld)
 *   - FREE_PROVIDERS:
 *     emailDomain === d (exact match — no subdomain semantics for email)
 *
 * Curation notes:
 *   - GLOBAL/INDIAN domain lists are STUBS for launch. Expand to ~Tranco
 *     top 500 each before opening the enterprise path to traffic; the
 *     small lists below cover obvious cases for early testing.
 *   - INSTITUTION_TLDS is closed: ICANN-defined TLDs only, no curation drift.
 *   - FREE_PROVIDERS is closed by intent — adding a provider here changes
 *     who can self-serve a Standard-tier scan. Edit deliberately.
 */

/**
 * Free email providers — never accepted for enterprise / institution /
 * complex-tier verification. Owners using these on Standard-tier sites
 * (11–50 pages) get a Phase 2 trust finding instead of a hard block.
 */
export const FREE_PROVIDERS = [
  'gmail.com',
  'hotmail.com',
  'icloud.com',
  'me.com',
  'outlook.com',
  'protonmail.com',
  'rediffmail.com',
  'yahoo.com',
  'ymail.com',
  'zoho.com',
] as const

/**
 * Path A — global enterprise. Pricing ₹49,999+, always manual approval.
 * STUB LIST — expand to Tranco global top 500 before launch.
 */
export const GLOBAL_ENTERPRISE_DOMAINS = [
  'airbnb.com',
  'amazon.com',
  'amazon.in',
  'apple.com',
  'facebook.com',
  'google.com',
  'linkedin.com',
  'meta.com',
  'microsoft.com',
  'netflix.com',
  'twitter.com',
  'uber.com',
] as const

/**
 * Path B — Indian enterprise. Pricing ₹9,999–₹24,999, always manual approval.
 * STUB LIST — expand to Tranco India top 500 before launch.
 */
export const INDIAN_ENTERPRISE_DOMAINS = [
  'airtel.in',
  'flipkart.com',
  'hdfcbank.com',
  'icicibank.com',
  'infosys.com',
  'jio.com',
  'myntra.com',
  'reliancedigital.in',
  'sbi.co.in',
  'snapdeal.com',
  'tata.com',
  'tatamotors.com',
  'wipro.com',
] as const

/**
 * Path C — institution / non-profit / government. Domain-match OTP required;
 * pricing ₹999–₹4,999 by sub-type. Closed list — these are ICANN-defined.
 */
export const INSTITUTION_TLDS = [
  '.ac.in',
  '.edu.in',
  '.gov',
  '.gov.in',
  '.mil.in',
  '.ngo.in',
  '.org.in',
  '.res.in',
] as const
