import { isSafeUrl } from '@/lib/security/ssrf'
import type { Issue } from '@/lib/scan/phase2'

// ─── Tunables ──────────────────────────────────────────────────────────

const TIMEOUT_MS = 8_000
const MAX_REDIRECTS = 5
const MAX_LINKS_PER_SCAN = 200
const CONCURRENCY = 4

// ─── Types ─────────────────────────────────────────────────────────────

export type LinkCheckResult =
  | {
      ok: true
      url: string
      finalUrl: string
      status: number
      redirected: boolean
      redirectCount: number
    }
  | {
      ok: false
      url: string
      reason:
        | 'blocked'
        | 'invalid_url'
        | 'timeout'
        | 'network'
        | 'http_error'
        | 'redirect_loop'
        | 'too_many_redirects'
      status?: number
      message?: string
    }

// ─── Skip filter ───────────────────────────────────────────────────────

// Anchor-only ('#about'), data:/blob: URIs, mailto/tel/javascript schemes.
// Phase 1's extractor already drops non-http(s), so mailto/tel can't reach
// us today — but keeping the filter here as defence in depth for future
// callers that pass in raw hrefs.
const SKIP_SCHEME_RE = /^(mailto|tel|javascript|data|blob):/i

function shouldSkip(href: string): boolean {
  const trimmed = href.trim()
  if (!trimmed) return true
  if (trimmed.startsWith('#')) return true
  if (SKIP_SCHEME_RE.test(trimmed)) return true
  return false
}

// ─── Single-URL check ──────────────────────────────────────────────────

/**
 * HEAD-check a single URL with manual redirect handling so we can cap
 * redirect chains, fall back to GET when servers reject HEAD with 405,
 * and re-run the SSRF guard on every hop (defeats DNS rebinding mid-chain).
 *
 * Never throws — every failure path returns a discriminated result.
 */
export async function checkLink(rawUrl: string): Promise<LinkCheckResult> {
  // URL shape validation
  try {
    new URL(rawUrl)
  } catch {
    return { ok: false, url: rawUrl, reason: 'invalid_url' }
  }

  // Initial SSRF guard
  if (!(await isSafeUrl(rawUrl))) {
    return { ok: false, url: rawUrl, reason: 'blocked' }
  }

  let currentUrl = rawUrl
  let redirectCount = 0

  while (redirectCount <= MAX_REDIRECTS) {
    const headResult = await fetchWithFallback(currentUrl)
    if (!headResult.ok) {
      return { ...headResult, url: rawUrl }
    }

    const res = headResult.response

    // 3xx — redirect
    if (
      res.status === 301 ||
      res.status === 302 ||
      res.status === 303 ||
      res.status === 307 ||
      res.status === 308
    ) {
      const location = res.headers.get('location')
      if (!location) {
        // 3xx without Location header — treat as broken
        return {
          ok: false,
          url: rawUrl,
          reason: 'http_error',
          status: res.status,
        }
      }
      let nextUrl: URL
      try {
        nextUrl = new URL(location, currentUrl)
      } catch {
        return {
          ok: false,
          url: rawUrl,
          reason: 'http_error',
          status: res.status,
        }
      }
      if (nextUrl.href === currentUrl) {
        return { ok: false, url: rawUrl, reason: 'redirect_loop' }
      }
      // SSRF re-check on the new target — defeats DNS rebinding via
      // 3xx redirect to a private IP.
      if (!(await isSafeUrl(nextUrl.href))) {
        return { ok: false, url: rawUrl, reason: 'blocked' }
      }
      currentUrl = nextUrl.href
      redirectCount += 1
      continue
    }

    // 4xx / 5xx
    if (res.status >= 400) {
      return {
        ok: false,
        url: rawUrl,
        reason: 'http_error',
        status: res.status,
      }
    }

    // 2xx
    return {
      ok: true,
      url: rawUrl,
      finalUrl: currentUrl,
      status: res.status,
      redirected: redirectCount > 0,
      redirectCount,
    }
  }

  // Exited the redirect loop without resolving
  return { ok: false, url: rawUrl, reason: 'too_many_redirects' }
}

// ─── Internal helpers ──────────────────────────────────────────────────

type FetchAttempt =
  | { ok: true; response: Response }
  | { ok: false; reason: 'timeout' | 'network'; message?: string }

/**
 * HEAD with timeout. Falls back to a 1-byte GET on 405 (some servers
 * disallow HEAD). All redirects deferred to the caller (`redirect: 'manual'`)
 * so we can count and SSRF-recheck each hop.
 */
async function fetchWithFallback(url: string): Promise<FetchAttempt> {
  const head = await timedFetch(url, 'HEAD')
  if (!head.ok) return head

  if (head.response.status !== 405) return head

  // 405 Method Not Allowed — retry as GET with a Range header to keep
  // the body small. Some hosts ignore Range; that's fine, fetch closes
  // the connection on Response gc.
  const get = await timedFetch(url, 'GET', { Range: 'bytes=0-0' })
  return get
}

async function timedFetch(
  url: string,
  method: 'HEAD' | 'GET',
  extraHeaders?: Record<string, string>,
): Promise<FetchAttempt> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; fixmysite.in/1.0; +https://fixmysite.in)',
        ...(extraHeaders ?? {}),
      },
    })
    return { ok: true, response }
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError')
    return {
      ok: false,
      reason: isAbort ? 'timeout' : 'network',
      message: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─── Bulk check ────────────────────────────────────────────────────────

/**
 * Check many links. Dedupes, drops skip-schemes, caps at
 * MAX_LINKS_PER_SCAN, runs at CONCURRENCY parallel workers.
 *
 * Since today's caller passes only same-host internal links, "be polite"
 * just means a global concurrency cap — no per-host accounting.
 *
 * Returns the per-URL results in dedupe-filtered input order, plus a
 * count of URLs that didn't make the cut (capped).
 */
export async function checkLinks(urls: string[]): Promise<{
  results: LinkCheckResult[]
  capped: number
}> {
  const seen = new Set<string>()
  const queue: string[] = []
  for (const u of urls) {
    if (shouldSkip(u)) continue
    if (seen.has(u)) continue
    seen.add(u)
    queue.push(u)
  }

  const capped = Math.max(0, queue.length - MAX_LINKS_PER_SCAN)
  const toCheck = queue.slice(0, MAX_LINKS_PER_SCAN)

  const results: LinkCheckResult[] = new Array(toCheck.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const idx = cursor
      cursor += 1
      if (idx >= toCheck.length) return
      results[idx] = await checkLink(toCheck[idx]!)
    }
  }

  const n = Math.min(CONCURRENCY, toCheck.length)
  await Promise.all(Array.from({ length: n }, () => worker()))

  return { results, capped }
}

// ─── Issue translation ─────────────────────────────────────────────────

/**
 * Translate link-check results into user-facing issues. Successful 2xx
 * responses produce no issue (the link is fine — no need to add it to
 * the report's noise floor).
 *
 * Cap warning is appended as a single scan-level finding (category
 * 'technical', item 'link_check_capped') matching the spec the user
 * approved — not a per-URL issue.
 */
export function buildLinkIssues(
  results: LinkCheckResult[],
  capped: number,
): Issue[] {
  const issues: Issue[] = []

  for (const r of results) {
    if (r.ok) continue

    switch (r.reason) {
      case 'http_error': {
        const status = r.status ?? 0
        if (status >= 400 && status < 500) {
          issues.push({
            category: 'links',
            item: r.url,
            status: 'fail',
            detail: `Visitors clicking this link see a not-found page (HTTP ${status}).`,
            priority: 'high',
            effort: 'low',
            action:
              'Either restore the page at this URL, or remove the link from your site.',
          })
        } else if (status >= 500) {
          issues.push({
            category: 'links',
            item: r.url,
            status: 'fail',
            detail: `This link returns a server error (HTTP ${status}). Visitors cannot reach the page.`,
            priority: 'medium',
            effort: 'low',
            action:
              'Check the destination server, or contact whoever hosts it.',
          })
        }
        break
      }

      case 'timeout':
        issues.push({
          category: 'links',
          item: r.url,
          status: 'warning',
          detail:
            'This link takes too long to respond. Most visitors give up before it loads.',
          priority: 'medium',
          effort: 'medium',
          action:
            'Check whether the destination is online and responsive on mobile networks.',
        })
        break

      case 'redirect_loop':
      case 'too_many_redirects':
        issues.push({
          category: 'links',
          item: r.url,
          status: 'warning',
          detail:
            'This link bounces through too many redirects before settling. Slow and unreliable for visitors.',
          priority: 'medium',
          effort: 'low',
          action: 'Update the link to point directly at the final destination.',
        })
        break

      case 'network':
        issues.push({
          category: 'links',
          item: r.url,
          status: 'fail',
          detail:
            'The destination server cannot be reached. This link goes nowhere.',
          priority: 'medium',
          effort: 'low',
          action:
            'Either fix the destination, or remove this link from your site.',
        })
        break

      case 'invalid_url':
      case 'blocked':
        // invalid_url shouldn't happen — extractor produces well-formed URLs.
        // 'blocked' = SSRF target — silently skip, never surface to owner.
        break
    }
  }

  if (capped > 0) {
    const total = MAX_LINKS_PER_SCAN + capped
    issues.push({
      category: 'technical',
      item: 'link_check_capped',
      status: 'warning',
      priority: 'low',
      effort: 'low',
      detail: `We checked ${MAX_LINKS_PER_SCAN} of ${total} links found on this site. Remaining links were not verified.`,
      action: 'Consider an agency scan for full coverage.',
    })
  }

  return issues
}
