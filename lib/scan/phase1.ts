import {
  coerceToUrl,
  estimatePageCount,
  fetchAndExtract,
  normalizeUrl,
  type FetchExtractResult,
} from './extractor'
import { isSafeUrl } from '@/lib/security/ssrf'
import { getTier } from '@/constants/pricing'

const ROBOTS_TIMEOUT_MS = 8_000
const USER_AGENT =
  'Mozilla/5.0 (compatible; fixmysite.in/1.0; +https://fixmysite.in)'

export type Phase1Tier = 'small' | 'medium' | 'large' | 'enterprise'

export type Phase1Result = {
  url: string                     // user input, preserved verbatim
  urlNormalized: string           // canonical for `scans.url_normalized`
  finalUrl: string                // after any redirects
  fetchedAt: string               // ISO 8601
  durationMs: number
  ssl: {
    basicValid: boolean
    detail: string
  }
  homepage: {
    title: string | null
    metaDescription: string | null
    phones: string[]              // canonical "+91XXXXXXXXXX"
    emails: string[]              // lowercase
    internalLinks: string[]       // absolute, same-host, deduped, capped at HOMEPAGE_LINK_CAP
    internalLinkCount: number
    images: string[]              // absolute http(s) image URLs, deduped
  }
  robots: {
    exists: boolean
    crawlAllowed: boolean
    detail: string
  }
  pageCount: {
    count: number
    source: 'sitemap' | 'homepage_links' | 'unknown'
    truncated: boolean
    sampleUrls: string[]
  }
  tier: Phase1Tier
  price: number | null            // ₹ rupees; null for enterprise
  isEnterprise: boolean
}

export type Phase1Failure =
  | { ok: false; reason: 'invalid_url'; message: string }
  | { ok: false; reason: 'blocked';     message: string }
  | { ok: false; reason: 'timeout';     message: string }
  | { ok: false; reason: 'network';     message: string }
  | { ok: false; reason: 'http_error';  status: number; message: string }

export type Phase1Outcome = { ok: true; data: Phase1Result } | Phase1Failure

// TODO: add runPhase1 unit tests before first paid scan goes live
/**
 * Phase 1 orchestrator.
 *
 *  - Validates and normalises the input URL (throws-safe; failures return
 *    `Phase1Failure` rather than throwing so the API route can map them
 *    to user-friendly errors without a try/catch wrapper).
 *  - Fetches the homepage (SSRF-guarded, redirect-revalidated) and
 *    `/robots.txt` in parallel.
 *  - On any homepage-fetch failure we return a typed failure WITHOUT
 *    inserting a DB row — the caller (API route) treats that as "site
 *    unreachable" per CLAUDE.md.
 *  - Estimates page count via sitemap.xml first, falling back to the
 *    homepage's same-host internal links.
 *  - Classifies tier + price using `getTier` from /constants/pricing.ts.
 *
 * The orchestrator is DB-free by design — persistence is the API
 * route's job. This keeps the function easy to test and reusable.
 */
export async function runPhase1(rawUrl: string): Promise<Phase1Outcome> {
  const startedAt = Date.now()

  let coerced: string
  let urlNormalized: string
  try {
    coerced = coerceToUrl(rawUrl)
    urlNormalized = normalizeUrl(coerced)
  } catch {
    return {
      ok: false,
      reason: 'invalid_url',
      message: `Could not parse URL: ${rawUrl}`,
    }
  }

  const [homepage, robots] = await Promise.all([
    fetchAndExtract(coerced),
    fetchRobotsTxt(coerced),
  ])

  if (!homepage.ok) return mapHomepageFailure(homepage)

  const finalUrl = homepage.finalUrl
  const ssl = classifySsl(finalUrl)
  const estimate = await estimatePageCount(coerced, homepage.data)
  // TODO: if pageCount.count === 0 and source === 'homepage_links',
  // the site is likely a JS-rendered SPA we cannot crawl.
  // Phase 2 should detect this early and return a partial report
  // with a clear message: "This site uses JavaScript rendering —
  // our scanner found limited content. Results may be incomplete."
  // Do NOT refund automatically. Do surface the limitation clearly.
  const tierEntry = getTier(estimate.count)
  const tier: Phase1Tier = tierEntry?.name ?? 'enterprise'
  const price: number | null = tierEntry?.price ?? null

  return {
    ok: true,
    data: {
      url: rawUrl,
      urlNormalized,
      finalUrl,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      ssl,
      homepage: {
        title: homepage.data.title,
        metaDescription: homepage.data.metaDescription,
        phones: homepage.data.phones,
        emails: homepage.data.emails,
        internalLinks: homepage.data.internalLinks,
        internalLinkCount: homepage.data.internalLinks.length,
        images: homepage.data.images,
      },
      robots,
      pageCount: estimate,
      tier,
      price,
      isEnterprise: tier === 'enterprise',
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifySsl(finalUrl: string): { basicValid: boolean; detail: string } {
  try {
    const isHttps = new URL(finalUrl).protocol === 'https:'
    return {
      basicValid: isHttps,
      detail: isHttps
        ? 'https reachable; certificate chain validated by TLS handshake'
        : 'site served over http — no SSL certificate',
    }
  } catch {
    return { basicValid: false, detail: 'final url unparseable' }
  }
}

/**
 * Fetch /robots.txt from the site root and detect a blanket disallow
 * against `User-agent: *`. We are deliberately permissive on errors: a
 * missing or unreachable robots.txt is treated as "crawl allowed", same
 * as the major search engines. Full per-path robots compliance is
 * Phase 2's responsibility once we know which URLs we want to crawl.
 */
async function fetchRobotsTxt(rootUrl: string): Promise<{
  exists: boolean
  crawlAllowed: boolean
  detail: string
}> {
  let robotsUrl: string
  try {
    const u = new URL(rootUrl)
    robotsUrl = `${u.protocol}//${u.host}/robots.txt`
  } catch {
    return { exists: false, crawlAllowed: true, detail: 'invalid root url' }
  }

  if (!(await isSafeUrl(robotsUrl))) {
    return { exists: false, crawlAllowed: true, detail: 'robots.txt url blocked by SSRF guard' }
  }

  let res: Response
  try {
    res = await fetch(robotsUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    })
  } catch {
    return { exists: false, crawlAllowed: true, detail: 'robots.txt fetch failed (treated as permissive)' }
  }

  if (!res.ok) {
    return {
      exists: false,
      crawlAllowed: true,
      detail: `robots.txt status ${res.status} (treated as permissive)`,
    }
  }
  if (res.url !== robotsUrl && !(await isSafeUrl(res.url))) {
    return { exists: false, crawlAllowed: true, detail: 'robots.txt redirect blocked' }
  }

  let text: string
  try {
    text = await res.text()
  } catch {
    return { exists: false, crawlAllowed: true, detail: 'robots.txt body unreadable' }
  }

  const allowed = !hasBlanketDisallow(text)
  return {
    exists: true,
    crawlAllowed: allowed,
    detail: allowed
      ? 'robots.txt permits crawling'
      : 'robots.txt blanket-disallows our user agent',
  }
}

/**
 * True only when a `User-agent: *` block contains a `Disallow: /` line
 * with nothing after the slash. Anything narrower (path-specific, allow
 * lists, sitemap-only) is treated as "crawl allowed at root" for Phase 1.
 */
function hasBlanketDisallow(robotsText: string): boolean {
  const lines = robotsText.split(/\r?\n/)
  let inWildcardBlock = false
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim().toLowerCase()
    const value = line.slice(colonIdx + 1).trim()

    if (key === 'user-agent') {
      inWildcardBlock = value === '*'
      continue
    }
    if (inWildcardBlock && key === 'disallow' && value === '/') {
      return true
    }
  }
  return false
}

function mapHomepageFailure(
  failure: Extract<FetchExtractResult, { ok: false }>,
): Phase1Failure {
  switch (failure.reason) {
    case 'blocked':
      return { ok: false, reason: 'blocked', message: failure.message }
    case 'timeout':
      return { ok: false, reason: 'timeout', message: failure.message }
    case 'network':
      return { ok: false, reason: 'network', message: failure.message }
    case 'http_error':
      return {
        ok: false,
        reason: 'http_error',
        status: failure.status,
        message: failure.message,
      }
    case 'invalid_url':
      return { ok: false, reason: 'invalid_url', message: failure.message }
  }
}
