import {
  GLOBAL_ENTERPRISE_DOMAINS,
  INDIAN_ENTERPRISE_DOMAINS,
  INSTITUTION_TLDS,
} from '@/constants/enterprise'

export type UrlClass =
  | 'global_enterprise'
  | 'indian_enterprise'
  | 'institution'
  | 'self_serve'

// TODO: add classifyUrl unit tests before first paid scan goes live

/**
 * Classify a hostname into one of four paths (A/B/C/D per SPEC §4).
 * Path E ("No, just curious" fun-seeker) is a UI branch off Path A/B and is
 * intentionally NOT represented here — it's the user's reply to the admin
 * gate, not a class of URL.
 *
 * Match priority: global > indian > institution > self_serve. The first
 * matching predicate wins; later predicates are not evaluated.
 *
 * Input contract: a clean hostname like `mail.tatamotors.com`. Callers are
 * responsible for URL parsing — pass `new URL(input).hostname`. This
 * function applies minimal normalisation (lowercase, strip leading `www.`,
 * strip trailing dot) but does no port/path/scheme handling.
 *
 * Subdomain semantics: `mail.tatamotors.com` classifies as Indian
 * enterprise because it ends with `.tatamotors.com`. Bare `tatamotors.com`
 * matches by exact equality.
 */
export function classifyUrl(hostname: string): UrlClass {
  const clean = hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '')

  if (GLOBAL_ENTERPRISE_DOMAINS.some((d) => domainMatches(clean, d))) {
    return 'global_enterprise'
  }
  if (INDIAN_ENTERPRISE_DOMAINS.some((d) => domainMatches(clean, d))) {
    return 'indian_enterprise'
  }
  if (INSTITUTION_TLDS.some((tld) => clean.endsWith(tld))) {
    return 'institution'
  }
  return 'self_serve'
}

/** Exact match OR subdomain match — `mail.tata.com` counts as `tata.com`. */
function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith('.' + domain)
}
