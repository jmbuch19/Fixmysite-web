import * as cheerio from 'cheerio'
import { isSafeUrl } from '@/lib/security/ssrf'

const USER_AGENT =
  'Mozilla/5.0 (compatible; fixmysite.in/1.0; +https://fixmysite.in)'

const DEFAULT_TIMEOUT_MS = 15_000
const SITEMAP_URL_CAP = 250
const SITEMAP_INDEX_CAP = 5
const HOMEPAGE_LINK_CAP = 250

// ---------------------------------------------------------------------------
// URL normalisation
// ---------------------------------------------------------------------------

/**
 * lower-case host, strip trailing slash on path, drop query + fragment.
 * Used as the canonical key for `scans.url_normalized`.
 *
 * Throws on invalid URL — callers must coerce/validate first.
 */
export function normalizeUrl(input: string): string {
  const u = new URL(input)
  u.hash = ''
  u.search = ''
  let path = u.pathname
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return `${u.protocol}//${u.host.toLowerCase()}${path}`
}

/**
 * Accept user-facing input that may omit the protocol ("example.com").
 * Prepends https:// when missing. Throws on otherwise-invalid input.
 */
export function coerceToUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('empty url')
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

// ---------------------------------------------------------------------------
// Phone & email extraction
// ---------------------------------------------------------------------------

// Indian mobile: 10 digits starting with 6-9, optionally prefixed with +91 / 91.
// Lookarounds prevent matching inside longer numeric strings (order IDs, etc.).
const PHONE_REGEX = /(?<!\d)(?:\+?91[\s.\-]?)?([6-9]\d{9})(?!\d)/g

const EMAIL_REGEX = /[a-z0-9._+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi

const EMAIL_FALSE_POSITIVE_TLDS = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?)$/i

function lastTenDigits(s: string): string {
  const digits = s.replace(/\D/g, '')
  return digits.slice(-10)
}

function dedupePhones(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of raw) {
    const key = lastTenDigits(p)
    if (key.length !== 10) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(`+91${key}`)
  }
  return out
}

function dedupeEmails(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of raw) {
    const lower = e.toLowerCase()
    if (EMAIL_FALSE_POSITIVE_TLDS.test(lower)) continue
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(lower)
  }
  return out
}

// ---------------------------------------------------------------------------
// HTML extraction (pure)
// ---------------------------------------------------------------------------

export type PageExtract = {
  title: string | null
  metaDescription: string | null
  phones: string[] // canonical "+91XXXXXXXXXX", deduped
  emails: string[] // lowercase, deduped
  internalLinks: string[] // absolute, same-host, deduped by pathname
  images: string[]        // absolute http(s) image URLs, deduped
}

export function extractFromHtml(html: string, baseUrl: string): PageExtract {
  const $ = cheerio.load(html)
  const base = new URL(baseUrl)

  const title = $('head > title').first().text().trim() || null
  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() || null

  // Phones
  const rawPhones: string[] = []
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    rawPhones.push(href.replace(/^tel:/i, ''))
  })
  const bodyText = $('body').text()
  for (const m of bodyText.matchAll(PHONE_REGEX)) rawPhones.push(m[0])

  // Emails
  const rawEmails: string[] = []
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    rawEmails.push(href.replace(/^mailto:/i, '').split('?')[0])
  })
  for (const m of bodyText.matchAll(EMAIL_REGEX)) rawEmails.push(m[0])

  // Internal links — absolute, same host, deduped by pathname
  const linkSeen = new Set<string>()
  const internalLinks: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    let abs: URL
    try {
      abs = new URL(href, base)
    } catch {
      return
    }
    if (abs.host.toLowerCase() !== base.host.toLowerCase()) return
    if (!['http:', 'https:'].includes(abs.protocol)) return
    abs.hash = ''
    abs.search = ''
    const key = abs.pathname.replace(/\/+$/, '') || '/'
    if (linkSeen.has(key)) return
    linkSeen.add(key)
    internalLinks.push(`${abs.protocol}//${abs.host.toLowerCase()}${key}`)
  })

  // Images — absolute http(s) URLs, deduped. We collect from `src`,
  // `data-src`/`data-lazy-src` (lazy-load attrs used by most CMSes),
  // and `srcset` (responsive images — take the largest entry, which
  // is usually the rightmost). Inline `data:` URIs and SVG data blobs
  // are ignored — those have no Last-Modified to check.
  const imageSeen = new Set<string>()
  const images: string[] = []
  const considerImageUrl = (raw: string | undefined) => {
    if (!raw) return
    const trimmed = raw.trim()
    if (!trimmed) return
    if (/^(data|blob):/i.test(trimmed)) return
    let abs: URL
    try {
      abs = new URL(trimmed, base)
    } catch {
      return
    }
    if (!['http:', 'https:'].includes(abs.protocol)) return
    abs.hash = ''
    const key = abs.href
    if (imageSeen.has(key)) return
    imageSeen.add(key)
    images.push(key)
  }
  $('img').each((_, el) => {
    const $el = $(el)
    considerImageUrl($el.attr('src'))
    considerImageUrl($el.attr('data-src'))
    considerImageUrl($el.attr('data-lazy-src'))
    const srcset = $el.attr('srcset') || $el.attr('data-srcset')
    if (srcset) {
      // srcset format: "url1 1x, url2 2x" or "url1 480w, url2 800w".
      // We want each unique URL — drop the descriptor.
      for (const part of srcset.split(',')) {
        const url = part.trim().split(/\s+/)[0]
        considerImageUrl(url)
      }
    }
  })
  $('source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset')
    if (!srcset) return
    for (const part of srcset.split(',')) {
      considerImageUrl(part.trim().split(/\s+/)[0])
    }
  })

  return {
    title,
    metaDescription,
    phones: dedupePhones(rawPhones),
    emails: dedupeEmails(rawEmails),
    internalLinks,
    images,
  }
}

// ---------------------------------------------------------------------------
// Fetch + extract
// ---------------------------------------------------------------------------

export type FetchExtractFailure =
  | { ok: false; reason: 'blocked'; message: string }
  | { ok: false; reason: 'timeout'; message: string }
  | { ok: false; reason: 'network'; message: string }
  | { ok: false; reason: 'http_error'; status: number; message: string }
  | { ok: false; reason: 'invalid_url'; message: string }

export type FetchExtractSuccess = {
  ok: true
  status: number
  finalUrl: string
  data: PageExtract
}

export type FetchExtractResult = FetchExtractSuccess | FetchExtractFailure

async function fetchHtml(
  url: string,
  timeoutMs: number,
): Promise<
  | { ok: true; status: number; finalUrl: string; html: string }
  | FetchExtractFailure
> {
  if (!(await isSafeUrl(url))) {
    return { ok: false, reason: 'blocked', message: `blocked by SSRF guard: ${url}` }
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const e = err as { name?: string; message?: string }
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: `timed out after ${timeoutMs}ms` }
    }
    return { ok: false, reason: 'network', message: e.message ?? 'network error' }
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: 'http_error',
      status: res.status,
      message: `${res.status} ${res.statusText}`,
    }
  }

  // Re-validate the post-redirect URL — a 30x could send us to a private IP.
  if (res.url !== url && !(await isSafeUrl(res.url))) {
    return { ok: false, reason: 'blocked', message: `redirect target blocked: ${res.url}` }
  }

  let html: string
  try {
    html = await res.text()
  } catch (err) {
    const e = err as { message?: string }
    return { ok: false, reason: 'network', message: e.message ?? 'failed to read body' }
  }

  return { ok: true, status: res.status, finalUrl: res.url || url, html }
}

export async function fetchAndExtract(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<FetchExtractResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let normalized: string
  try {
    normalized = coerceToUrl(url)
  } catch {
    return { ok: false, reason: 'invalid_url', message: `invalid url: ${url}` }
  }

  const fetched = await fetchHtml(normalized, timeoutMs)
  if (!fetched.ok) return fetched

  return {
    ok: true,
    status: fetched.status,
    finalUrl: fetched.finalUrl,
    data: extractFromHtml(fetched.html, fetched.finalUrl),
  }
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

export type SitemapFetchResult = {
  found: boolean
  urls: string[]
  truncated: boolean
}

async function fetchSitemapXml(
  url: string,
  timeoutMs: number,
): Promise<string | null> {
  if (!(await isSafeUrl(url))) return null
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    if (res.url !== url && !(await isSafeUrl(res.url))) return null
    return await res.text()
  } catch {
    return null
  }
}

function parseSitemap(xml: string): { type: 'urlset' | 'index' | 'unknown'; locs: string[] } {
  const $ = cheerio.load(xml, { xml: true })

  const urlLocs = $('urlset > url > loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
  if (urlLocs.length > 0) return { type: 'urlset', locs: urlLocs }

  const indexLocs = $('sitemapindex > sitemap > loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
  if (indexLocs.length > 0) return { type: 'index', locs: indexLocs }

  return { type: 'unknown', locs: [] }
}

/**
 * Try to fetch /sitemap.xml from the root. Recurses one level into sitemap
 * indexes (capped at SITEMAP_INDEX_CAP child sitemaps) and stops once we've
 * collected SITEMAP_URL_CAP URLs.
 */
export async function fetchSitemapUrls(
  rootUrl: string,
  opts: { timeoutMs?: number; cap?: number } = {},
): Promise<SitemapFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const cap = opts.cap ?? SITEMAP_URL_CAP

  let base: URL
  try {
    base = new URL(coerceToUrl(rootUrl))
  } catch {
    return { found: false, urls: [], truncated: false }
  }

  const sitemapUrl = `${base.protocol}//${base.host}/sitemap.xml`
  const xml = await fetchSitemapXml(sitemapUrl, timeoutMs)
  if (!xml) return { found: false, urls: [], truncated: false }

  const top = parseSitemap(xml)

  if (top.type === 'urlset') {
    const truncated = top.locs.length > cap
    return { found: true, urls: top.locs.slice(0, cap), truncated }
  }

  if (top.type === 'index') {
    const seen = new Set<string>()
    const collected: string[] = []
    let truncated = false
    const childSitemaps = top.locs.slice(0, SITEMAP_INDEX_CAP)
    for (const child of childSitemaps) {
      if (collected.length >= cap) {
        truncated = true
        break
      }
      const childXml = await fetchSitemapXml(child, timeoutMs)
      if (!childXml) continue
      const childParsed = parseSitemap(childXml)
      if (childParsed.type !== 'urlset') continue
      for (const loc of childParsed.locs) {
        if (seen.has(loc)) continue
        seen.add(loc)
        collected.push(loc)
        if (collected.length >= cap) {
          truncated = true
          break
        }
      }
    }
    if (top.locs.length > SITEMAP_INDEX_CAP) truncated = true
    return { found: true, urls: collected, truncated }
  }

  return { found: false, urls: [], truncated: false }
}

// ---------------------------------------------------------------------------
// Page count estimator
// ---------------------------------------------------------------------------

export type PageCountEstimate = {
  count: number
  source: 'sitemap' | 'homepage_links' | 'unknown'
  truncated: boolean
  sampleUrls: string[]
}

/**
 * Estimate the page count for tier classification.
 *
 *  1. Try /sitemap.xml first (cheapest, most accurate).
 *  2. Fallback to counting same-host internal links on the already-fetched
 *     homepage HTML (caller passes it in to avoid a duplicate fetch).
 *
 * Returns count capped at HOMEPAGE_LINK_CAP / SITEMAP_URL_CAP so an
 * adversarial sitemap with millions of entries can't blow up memory.
 * The "enterprise" decision (>200) is unaffected by the cap.
 */
export async function estimatePageCount(
  rootUrl: string,
  homepageExtract: PageExtract | null,
  opts: { timeoutMs?: number } = {},
): Promise<PageCountEstimate> {
  const sitemap = await fetchSitemapUrls(rootUrl, {
    timeoutMs: opts.timeoutMs,
    cap: SITEMAP_URL_CAP,
  })
  if (sitemap.found && sitemap.urls.length > 0) {
    return {
      count: sitemap.urls.length,
      source: 'sitemap',
      truncated: sitemap.truncated,
      sampleUrls: sitemap.urls.slice(0, 10),
    }
  }

  if (homepageExtract && homepageExtract.internalLinks.length > 0) {
    const links = homepageExtract.internalLinks.slice(0, HOMEPAGE_LINK_CAP)
    return {
      count: links.length,
      source: 'homepage_links',
      truncated: homepageExtract.internalLinks.length > HOMEPAGE_LINK_CAP,
      sampleUrls: links.slice(0, 10),
    }
  }

  return { count: 0, source: 'unknown', truncated: false, sampleUrls: [] }
}
