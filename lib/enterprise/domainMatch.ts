import { FREE_PROVIDERS } from '@/constants/enterprise'

export type DomainValidation =
  | { valid: true }
  | { valid: false; reason: 'invalid_email' | 'free_provider' | 'domain_mismatch' }

/**
 * Validate that an email address can verify ownership of a website.
 *
 * Rules (per SPEC §4 Domain-Match Verification):
 *   1. Email must parse — i.e. have an "@<domain>" portion.
 *   2. Free providers (gmail.com, yahoo.com, …) are always rejected.
 *   3. Email domain must equal the site hostname OR be a subdomain of it.
 *      e.g. `webmaster@mail.tatamotors.com` is valid for `tatamotors.com`,
 *      but `webmaster@notmytatamotors.com` is not.
 *
 * Used by /api/enterprise/verify-email before generating an OTP.
 *
 * Input contract: `siteHostname` is a clean hostname (lowercase preferred,
 * no scheme, no port, no path). We apply minimal normalisation just in
 * case the caller passes a raw host with `www.` or trailing dot.
 */
export function isEmailDomainValid(
  email: string,
  siteHostname: string,
): DomainValidation {
  const emailDomain = email.split('@')[1]?.toLowerCase()
  if (!emailDomain) return { valid: false, reason: 'invalid_email' }

  if ((FREE_PROVIDERS as readonly string[]).includes(emailDomain)) {
    return { valid: false, reason: 'free_provider' }
  }

  const siteDomain = siteHostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '')

  const matches =
    emailDomain === siteDomain || emailDomain.endsWith('.' + siteDomain)

  return matches ? { valid: true } : { valid: false, reason: 'domain_mismatch' }
}
