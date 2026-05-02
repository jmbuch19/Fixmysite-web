import * as cheerio from 'cheerio'
import { isSafeUrl } from '@/lib/security/ssrf'
import { normalizeUrl } from '@/lib/scan/extractor'
import type { Issue } from '@/lib/scan/phase2'

// ─── Tunables ──────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8_000
const MAX_CONTENT_PAGES = 20
const COMING_SOON_GATE_WORDS = 100
const THIN_CONTENT_THRESHOLD = 50
const FETCH_CONCURRENCY = 4

const USER_AGENT =
  'Mozilla/5.0 (compatible; fixmysite.in/1.0; +https://fixmysite.in)'

// Paths we expect to be intentionally short — skipping thin-content
// detection on them avoids penalising sites for clean contact / 404 /
// thank-you pages.
const NON_CONTENT_PATH_RE = /\/(contact|404|error|thankyou|thank-you)/i

// ─── Placeholder pattern table ─────────────────────────────────────────
//
// `gateBelowWords` makes the pattern fire only when the page's word count
// is BELOW that threshold. Used for "coming soon" — a real page that
// happens to mention "coming soon" in some marketing copy is fine; the
// problem is when the entire page IS "coming soon" with nothing else.
//
// "under construction" has no gate per the approved scope — it's old-web
// jargon that has no legitimate place on a live business site.

const PLACEHOLDER_PATTERNS: ReadonlyArray<{
  regex: RegExp
  bucket: 'lorem_ipsum' | 'coming_soon' | 'under_construction'
  gateBelowWords?: number
}> = [
  { regex: /lorem\s+ipsum/i, bucket: 'lorem_ipsum' },
  { regex: /your\s+text\s+here/i, bucket: 'lorem_ipsum' },
  { regex: /sample\s+content/i, bucket: 'lorem_ipsum' },
  { regex: /insert\s+(name|text|content)\s+here/i, bucket: 'lorem_ipsum' },
  { regex: /placeholder\s+text/i, bucket: 'lorem_ipsum' },
  { regex: /dummy\s+text/i, bucket: 'lorem_ipsum' },
  { regex: /test\s+content/i, bucket: 'lorem_ipsum' },
  { regex: /coming\s+soon/i, bucket: 'coming_soon', gateBelowWords: COMING_SOON_GATE_WORDS },
  { regex: /under\s+construction/i, bucket: 'under_construction' },
]

// ─── Meta-mention guard ────────────────────────────────────────────────
//
// Marketing copy, blog posts, and feature descriptions routinely MENTION
// "lorem ipsum" or "placeholder text" as a CONCEPT — fixmysite.in's own
// homepage was the canary: a card body reading "Bugbite spots lorem
// ipsum, 'coming soon' pages, and leftover sample text" was getting
// flagged as if it were real placeholder content.
//
// Two layers of defence:
//   1. Skip whole HTML containers that are obviously meta-content (code
//      samples, demo blocks, anything with class hints like "feature",
//      "card", "description", "example", "demo"). Removed before text
//      extraction so the match never even surfaces.
//   2. After a match in surviving body text, check the 60 characters
//      immediately before for verbs that frame the match as meta-mention
//      ("spots", "detects", "looks for", etc.) or for unbalanced quote
//      marks suggesting we're inside a quoted concept.
//
// Both checks are intentionally conservative — "leftover sample text"
// in a clinic owner's homepage will still fire (no meta-verb, no
// quotes), and a dev who genuinely shipped lorem ipsum inside a class
// named .card will still get caught by other detectors on the same page.

const META_MENTION_VERBS =
  /\b(?:spots?|detects?|finds?|catches?|identifies?|identify|flags?|checks?|looks?\s+for|looking\s+for|searches?\s+for|recognises?|recognizes?|spotting|detecting|finding|catching|matching|matches|matched)\b/i

// Class-name hints that mark a container as meta-content rather than
// real visitor-facing copy. We strip whole elements before extracting
// body text so a match inside them is never even considered.
const META_CONTAINER_SELECTOR =
  'code, pre, [class*="feature"], [class*="card"], [class*="description"], [class*="example"], [class*="demo"]'

// ─── Public types ──────────────────────────────────────────────────────

export type PlaceholderFinding = {
  pattern: string         // the matched substring, e.g. "Lorem ipsum"
  context: string         // ±40 chars around the match
  pageUrl: string
}

export type ThinContentFinding = {
  pageUrl: string
  wordCount: number
}

// ─── Pure detectors ────────────────────────────────────────────────────

/**
 * Find placeholder/dummy text in a page's visible body.
 *
 * Strips `<script>`, `<style>`, `<noscript>` first so we don't false-
 * positive on framework code or analytics blobs. Each match is returned
 * with ±40 characters of surrounding context — this gets surfaced to
 * the report (and to PostHog telemetry) so the owner can locate the
 * paragraph instead of hunting through the page.
 *
 * Some patterns are gated below a word-count threshold (see
 * `gateBelowWords` on PLACEHOLDER_PATTERNS). The classic case is
 * "coming soon" — a real page mentioning it in marketing copy is fine;
 * a near-empty page that just says "coming soon" is the bug we want
 * to catch.
 */
export function detectPlaceholderText(
  html: string,
  pageUrl: string,
): PlaceholderFinding[] {
  // Word count is taken from the FULL stripped text (no meta-container
  // exclusion) because the COMING_SOON gate measures "is this page
  // genuinely empty?" — a card-class container that contains real copy
  // shouldn't downgrade that signal.
  const fullText = stripHtmlToText(html, { excludeMetaContainers: false })
  const wordCount = countWords(fullText)

  // Match-search runs against text WITH meta-containers excluded so we
  // never even see a mention inside a feature description, code block,
  // or example card.
  const eligibleText = stripHtmlToText(html, { excludeMetaContainers: true })

  const findings: PlaceholderFinding[] = []
  const seenBuckets = new Set<string>()

  for (const { regex, bucket, gateBelowWords } of PLACEHOLDER_PATTERNS) {
    const match = regex.exec(eligibleText)
    if (!match || match.index === undefined) continue
    if (gateBelowWords !== undefined && wordCount >= gateBelowWords) continue

    // Negative-context check: skip matches that look like meta-mentions
    // ("Bugbite spots lorem ipsum...") rather than real placeholder
    // content. Cheap heuristic on the 60 chars immediately before the
    // match — verb-frame OR unbalanced straight-quote count.
    const contextBefore = eligibleText.slice(
      Math.max(0, match.index - 60),
      match.index,
    )
    if (isMetaMention(contextBefore)) continue

    // Only one finding per bucket per page — multiple lorem-ipsum hits
    // on the same page tell the report nothing extra and just inflate
    // issue count.
    if (seenBuckets.has(bucket)) continue
    seenBuckets.add(bucket)

    const matchedText = match[0]
    const start = Math.max(0, match.index - 40)
    const end = match.index + matchedText.length + 40
    findings.push({
      pattern: matchedText,
      context: eligibleText.slice(start, end).trim(),
      pageUrl,
    })
  }
  return findings
}

/**
 * Detect a page with implausibly little content. Skips paths that are
 * legitimately short (contact, 404, error, thank-you) so a clean
 * one-line confirmation page doesn't get flagged as a thin-content
 * problem.
 *
 * Word count is computed on body text after script/style stripping —
 * same source the placeholder detector uses, so the two checks stay
 * consistent on the same input.
 */
export function detectThinContent(
  html: string,
  pageUrl: string,
): ThinContentFinding | null {
  let path = ''
  try {
    path = new URL(pageUrl).pathname
  } catch {
    // Unparseable URL — fall through and let word-count decide.
  }
  if (NON_CONTENT_PATH_RE.test(path)) return null

  const text = stripHtmlToText(html)
  const wordCount = countWords(text)
  if (wordCount >= THIN_CONTENT_THRESHOLD) return null

  return { pageUrl, wordCount }
}

// ─── Internal helpers ──────────────────────────────────────────────────

function stripHtmlToText(
  html: string,
  opts: { excludeMetaContainers?: boolean } = {},
): string {
  const $ = cheerio.load(html)
  $('script, style, noscript, template').remove()
  if (opts.excludeMetaContainers) {
    $(META_CONTAINER_SELECTOR).remove()
  }
  return $('body').text().replace(/\s+/g, ' ').trim()
}

function countWords(text: string): number {
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * True when the 60-char window before a placeholder-pattern match looks
 * like a meta-mention ("Bugbite spots lorem ipsum...") rather than real
 * placeholder content the developer forgot to remove.
 *
 * Two cheap signals:
 *   - A meta-mention verb appears in the window (spots, detects, looks
 *     for, identifies, etc.) — the match is being framed as a CONCEPT.
 *   - Odd parity of straight quote chars in the window — we are likely
 *     inside an open quote that has not closed yet, e.g. `"lorem ipsum"`
 *     used as a quoted-name reference in marketing copy.
 *
 * Both heuristics err toward false negatives (allowing through a real
 * placeholder) over false positives (flagging marketing copy). A real
 * lorem-ipsum bug usually appears in long body paragraphs without
 * either signal nearby — those still fire.
 */
function isMetaMention(contextBefore: string): boolean {
  if (META_MENTION_VERBS.test(contextBefore)) return true
  const window = contextBefore.slice(-60)
  const straightQuotes = (window.match(/["']/g) ?? []).length
  if (straightQuotes % 2 === 1) return true
  return false
}

// ─── Page fetcher ──────────────────────────────────────────────────────

type PageFetch =
  | { ok: true; url: string; html: string }
  | { ok: false; url: string; reason: 'blocked' | 'timeout' | 'network' | 'http_error' }

async function fetchPageHtml(url: string): Promise<PageFetch> {
  if (!(await isSafeUrl(url))) {
    return { ok: false, url, reason: 'blocked' }
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    const e = err as { name?: string }
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { ok: false, url, reason: 'timeout' }
    }
    return { ok: false, url, reason: 'network' }
  }
  if (!res.ok) return { ok: false, url, reason: 'http_error' }
  // Re-validate post-redirect target — defends DNS rebinding via 30x.
  if (res.url !== url && !(await isSafeUrl(res.url))) {
    return { ok: false, url, reason: 'blocked' }
  }
  try {
    const html = await res.text()
    return { ok: true, url, html }
  } catch {
    return { ok: false, url, reason: 'network' }
  }
}

// ─── Orchestrator ──────────────────────────────────────────────────────

export type ContentChecksOutput = {
  pages_attempted: number
  pages_fetched: number
  pages_failed: number
  placeholder_findings: number
  thin_content_findings: number
  issues: Issue[]
}

/**
 * Build the candidate page list, fetch each fresh, run both detectors.
 *
 * Page selection (CLAUDE.md rule 19 — content checks run on every
 * crawled page, not just the homepage):
 *   1. Homepage finalUrl always included.
 *   2. Then `phase1_result.pageCount.sampleUrls` (sitemap or homepage
 *      links — whichever Phase 1 used to estimate the page count).
 *   3. Then `phase1_result.homepage.internalLinks` to top up to the cap.
 *      Natural appearance order in the homepage HTML is the proxy for
 *      "most prominent" — nav/header links surface first, footer-only
 *      links last. Real per-URL link-frequency tracking would require
 *      changes to the extractor; appearance order gets us 80% of the
 *      benefit at zero cost.
 *   Capped at MAX_CONTENT_PAGES (20). Dedup is by `normalizeUrl()`
 *   so http/https + trailing-slash variants collapse to one fetch.
 */
export async function runContentChecks(opts: {
  homepageUrl: string
  sampleUrls: string[]
  internalLinks: string[]
}): Promise<ContentChecksOutput> {
  const candidates = buildCandidateList({
    homepageUrl: opts.homepageUrl,
    sampleUrls: opts.sampleUrls,
    internalLinks: opts.internalLinks,
  })

  let pagesFetched = 0
  let pagesFailed = 0
  let placeholderFindingCount = 0
  let thinContentFindingCount = 0
  const issues: Issue[] = []

  let cursor = 0
  async function worker() {
    while (true) {
      const idx = cursor++
      if (idx >= candidates.length) return
      const url = candidates[idx]!
      const fetched = await fetchPageHtml(url)
      if (!fetched.ok) {
        pagesFailed += 1
        continue
      }
      pagesFetched += 1
      const placeholderFindings = detectPlaceholderText(fetched.html, url)
      const thinFinding = detectThinContent(fetched.html, url)
      placeholderFindingCount += placeholderFindings.length
      if (thinFinding) thinContentFindingCount += 1
      issues.push(...buildContentIssues(placeholderFindings, thinFinding, url))
    }
  }

  const workers = Math.min(FETCH_CONCURRENCY, candidates.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))

  return {
    pages_attempted: candidates.length,
    pages_fetched: pagesFetched,
    pages_failed: pagesFailed,
    placeholder_findings: placeholderFindingCount,
    thin_content_findings: thinContentFindingCount,
    issues,
  }
}

function buildCandidateList(opts: {
  homepageUrl: string
  sampleUrls: string[]
  internalLinks: string[]
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const consider = (raw: string) => {
    if (out.length >= MAX_CONTENT_PAGES) return
    let key: string
    try {
      key = normalizeUrl(raw)
    } catch {
      return
    }
    if (seen.has(key)) return
    seen.add(key)
    out.push(raw)
  }

  consider(opts.homepageUrl)
  for (const u of opts.sampleUrls) consider(u)
  for (const u of opts.internalLinks) consider(u)
  return out
}

// ─── Issue translation ─────────────────────────────────────────────────

/**
 * Translate per-page detector output into report issues.
 *
 * `item` is keyed `<bucket>:<pageUrl>` so fix-rate matching across
 * scans (returnVisit.ts) can tell "page X had lorem ipsum, now fixed"
 * apart from "page X had thin content, now fixed" when a single page
 * had both findings.
 */
function buildContentIssues(
  placeholders: PlaceholderFinding[],
  thin: ThinContentFinding | null,
  pageUrl: string,
): Issue[] {
  const issues: Issue[] = []
  const buckets = new Set(
    placeholders.map((f) => bucketForPattern(f.pattern)),
  )

  if (buckets.has('lorem_ipsum')) {
    issues.push({
      category: 'content',
      item: `lorem_ipsum:${pageUrl}`,
      status: 'fail',
      priority: 'high',
      effort: 'low',
      detail:
        'Page contains placeholder text (lorem ipsum). Visitors see dummy content instead of real information about your business.',
      action:
        'Replace the placeholder text with real information about this page.',
    })
  }

  if (buckets.has('coming_soon')) {
    issues.push({
      category: 'content',
      item: `coming_soon:${pageUrl}`,
      status: 'warning',
      priority: 'medium',
      effort: 'low',
      detail:
        "A page on your site says 'coming soon' with no other content. Remove or complete it.",
      action:
        'Either finish the page or remove the link to it from your menu.',
    })
  }

  if (buckets.has('under_construction')) {
    issues.push({
      category: 'content',
      item: `under_construction:${pageUrl}`,
      status: 'warning',
      priority: 'medium',
      effort: 'low',
      detail:
        "A page on your site says 'under construction'. Remove or complete it.",
      action:
        'Either finish the page or remove the link to it from your menu.',
    })
  }

  if (thin) {
    issues.push({
      category: 'content',
      item: `thin_content:${pageUrl}`,
      status: 'warning',
      priority: 'low',
      effort: 'low',
      detail:
        'This page has very little content. Add more information to help visitors and improve Google ranking.',
      action: 'Add at least a paragraph explaining what this page is about.',
    })
  }

  return issues
}

function bucketForPattern(
  pattern: string,
): 'lorem_ipsum' | 'coming_soon' | 'under_construction' {
  if (/coming\s+soon/i.test(pattern)) return 'coming_soon'
  if (/under\s+construction/i.test(pattern)) return 'under_construction'
  return 'lorem_ipsum'
}
