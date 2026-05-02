import * as cheerio from 'cheerio'
import { isSafeUrl } from '@/lib/security/ssrf'
import type { Issue } from '@/lib/scan/phase2'

// ─── Tunables ──────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8_000
const NAV_ITEMS_THRESHOLD = 7
const WALL_OF_TEXT_PARA_THRESHOLD = 5
const WALL_OF_TEXT_HEADING_FLOOR = 2

const USER_AGENT =
  'Mozilla/5.0 (compatible; fixmysite.in/1.0; +https://fixmysite.in)'

// Trust signals — these surface words associated with credibility.
// A homepage with none of them tells a new visitor nothing about why
// they should pick this business over the next search result.
const TRUST_KEYWORDS = [
  'years',
  'certified',
  'award',
  'testimonial',
  'review',
  'since',
] as const

// ─── Types ─────────────────────────────────────────────────────────────

export type UiCheckKey =
  | 'no_cta'
  | 'contact_buried'
  | 'no_trust_indicators'
  | 'wall_of_text'
  | 'missing_alt_text'
  | 'nav_overload'
  | 'no_h1'

export type UiFinding = {
  check: UiCheckKey
  pageUrl: string
  priority: 'low' | 'medium' | 'high'
  effort: 'low' | 'medium' | 'high'
  count?: number
}

// ─── Pure detector ─────────────────────────────────────────────────────

/**
 * Detect surface-level UI problems on a single page. Most checks are
 * homepage-relevant; the ones gated to homepage only (CTA, nav size, h1)
 * are explicitly bracketed below — they don't make sense on deep pages
 * where a different IA applies.
 *
 * Trust-indicator detection is keyword-based by design — a real signal
 * extractor (Schema.org, structured review markup) would be more
 * accurate but the keyword sweep catches the long tail of small-business
 * sites that hand-write "20 years experience" without semantic markup.
 */
export function analyseUIQuality(
  html: string,
  pageUrl: string,
): UiFinding[] {
  const $ = cheerio.load(html)
  const findings: UiFinding[] = []
  const onHomepage = isHomepage(pageUrl)

  // 1. No CTA on homepage
  if (onHomepage) {
    const ctaCount = $(
      'a.btn, button, a[href*="contact"], a[href*="appointment"], a[href*="book"]',
    ).length
    if (ctaCount === 0) {
      findings.push({
        check: 'no_cta',
        pageUrl,
        priority: 'medium',
        effort: 'low',
      })
    }
  }

  // 2. Contact buried (no phone in <header>)
  // We're deliberately permissive — any 10-digit run or +91 prefix counts.
  // False positives (a date, an order number) are acceptable; the cost of
  // missing a real phone in the header is higher.
  //
  // TODO v1.1: gate this check on business type. Skip for SaaS,
  // e-commerce, B2B, and digital products — they don't expect phone in
  // header and emailing is the norm. Run for clinics, restaurants,
  // shops, and other fixed-location businesses where a missing phone
  // genuinely loses customers. Requires the business-type detector to
  // run before UI checks (today it's a separate Claude call inside the
  // brief flow only).
  const headerText = $('header').first().text().toLowerCase()
  const hasPhoneInHeader = /\d{10}|\+91/.test(headerText)
  if (!hasPhoneInHeader) {
    findings.push({
      check: 'contact_buried',
      pageUrl,
      priority: 'medium',
      effort: 'low',
    })
  }

  // 3. No trust indicators in body text
  const bodyText = $('body').text().toLowerCase()
  const hasTrust = TRUST_KEYWORDS.some((k) => bodyText.includes(k))
  if (!hasTrust) {
    findings.push({
      check: 'no_trust_indicators',
      pageUrl,
      priority: 'low',
      effort: 'medium',
    })
  }

  // 4. Wall of text — many paragraphs, few headings
  const paras = $('p').length
  const headings = $('h1, h2, h3').length
  if (
    paras > WALL_OF_TEXT_PARA_THRESHOLD &&
    headings < WALL_OF_TEXT_HEADING_FLOOR
  ) {
    findings.push({
      check: 'wall_of_text',
      pageUrl,
      priority: 'low',
      effort: 'low',
    })
  }

  // 5. Missing alt text — counts <img> without an `alt` attribute at all.
  // (An empty alt="" is intentional — used for decorative images — and
  // doesn't get flagged.)
  const imgsWithoutAlt = $('img:not([alt])').length
  if (imgsWithoutAlt > 0) {
    findings.push({
      check: 'missing_alt_text',
      pageUrl,
      priority: 'low',
      effort: 'low',
      count: imgsWithoutAlt,
    })
  }

  // 6. Nav overload (homepage only) — top-level menu items > threshold
  if (onHomepage) {
    const navItems = countTopLevelNavItems($)
    if (navItems > NAV_ITEMS_THRESHOLD) {
      findings.push({
        check: 'nav_overload',
        pageUrl,
        priority: 'medium',
        effort: 'medium',
        count: navItems,
      })
    }
  }

  // 7. No H1 above fold (homepage only)
  if (onHomepage) {
    const h1Text = $('h1').first().text().trim()
    if (!h1Text) {
      findings.push({
        check: 'no_h1',
        pageUrl,
        priority: 'medium',
        effort: 'low',
      })
    }
  }

  return findings
}

// ─── Internal helpers ──────────────────────────────────────────────────

function isHomepage(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl)
    const path = u.pathname.replace(/\/+$/, '')
    return path === '' || path === '/'
  } catch {
    return false
  }
}

/**
 * Count top-level menu items in the primary navigation. Tries the most
 * structured selectors first (header > nav > ul > li), falls back to
 * direct anchor children, then to a flat anchor count inside <nav>.
 *
 * The fallback overcounts mega-menus (every sub-link counted), but a
 * mega-menu with 8+ visible items is itself a nav-overload problem —
 * so the false positive lands in roughly the right place.
 */
function countTopLevelNavItems(
  $: ReturnType<typeof cheerio.load>,
): number {
  const $nav = $('header nav').first().length
    ? $('header nav').first()
    : $('nav').first()
  if ($nav.length === 0) return 0

  const lis = $nav.find('> ul > li').length
  if (lis > 0) return lis

  const directAnchors = $nav.children('a').length
  if (directAnchors > 0) return directAnchors

  return $nav.find('a').length
}

// ─── Issue translation ─────────────────────────────────────────────────

export function buildUiIssues(findings: UiFinding[]): Issue[] {
  return findings.map(translateUiFinding)
}

function translateUiFinding(f: UiFinding): Issue {
  switch (f.check) {
    case 'no_cta':
      return {
        category: 'visual',
        item: `no_cta:${f.pageUrl}`,
        status: 'warning',
        priority: f.priority,
        effort: f.effort,
        detail:
          "Your homepage has no clear call-to-action button. Visitors land but don't know what to do next.",
        action:
          'Add a prominent button — "Contact us", "Book appointment", "Get a quote" — visible on the homepage.',
      }
    case 'contact_buried':
      return {
        category: 'visual',
        item: `contact_buried:${f.pageUrl}`,
        status: 'warning',
        priority: f.priority,
        effort: f.effort,
        detail:
          'No phone number in your header. Customers who want to call have to scroll or hunt for it.',
        action:
          "Add your phone number to the header so it's visible on every page.",
      }
    case 'no_trust_indicators':
      return {
        category: 'visual',
        item: `no_trust_indicators:${f.pageUrl}`,
        status: 'warning',
        priority: f.priority,
        effort: f.effort,
        detail:
          'No visible trust signals (years in business, certifications, reviews, awards). New visitors have nothing to anchor their decision on.',
        action:
          'Add a line about how long you have been operating, or display reviews and certifications prominently.',
      }
    case 'wall_of_text':
      return {
        category: 'visual',
        item: `wall_of_text:${f.pageUrl}`,
        status: 'warning',
        priority: f.priority,
        effort: f.effort,
        detail:
          'Long paragraphs with few headings. Mobile readers scan headings first — without them, they leave.',
        action:
          'Break long sections with descriptive headings every 2 to 3 paragraphs.',
      }
    case 'missing_alt_text': {
      const n = f.count ?? 0
      return {
        category: 'visual',
        item: `missing_alt_text:${f.pageUrl}`,
        status: 'warning',
        priority: f.priority,
        effort: f.effort,
        detail: `${n} ${n === 1 ? 'image' : 'images'} on this page ${n === 1 ? 'has' : 'have'} no alt text. Search engines cannot read them and screen-reader users skip them.`,
        action:
          'Add a short description (alt text) to each image — what it shows or its purpose.',
      }
    }
    case 'nav_overload': {
      const n = f.count ?? 0
      return {
        category: 'visual',
        item: `nav_overload:${f.pageUrl}`,
        status: 'warning',
        priority: f.priority,
        effort: f.effort,
        detail: `Your menu has ${n} top-level items. Visitors get overwhelmed and don't pick any of them.`,
        action:
          'Group related items under fewer top-level menus, or move secondary items to the footer.',
      }
    }
    case 'no_h1':
      return {
        category: 'visual',
        item: `no_h1:${f.pageUrl}`,
        status: 'warning',
        priority: f.priority,
        effort: f.effort,
        detail:
          'Your homepage has no main heading (H1). Search engines and visitors cannot tell at a glance what your business is or does.',
        action:
          'Add a clear H1 at the top of the page — usually your business tagline or "What we do".',
      }
  }
}

// ─── Orchestrator ──────────────────────────────────────────────────────

export type UiChecksOutput = {
  fetched: boolean
  finding_count: number
  issues: Issue[]
}

async function fetchHomepageHtml(url: string): Promise<string | null> {
  if (!(await isSafeUrl(url))) return null
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  if (res.url !== url && !(await isSafeUrl(res.url))) return null
  try {
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Fetch the homepage and run all UI checks against it. Returns issues
 * ready to push into the report and a boolean for telemetry — a fetch
 * failure isn't a scan-level failure, just a silent skip (rare in
 * practice since Phase 1 already proved the homepage is reachable).
 *
 * TODO v1.1: phase2.ts currently fetches the homepage three times
 * (content scan, ui check, workflow audit). Extract a single per-scan
 * page cache and feed pre-fetched HTML into all three modules.
 */
export async function runUiChecks(
  homepageUrl: string,
): Promise<UiChecksOutput> {
  const html = await fetchHomepageHtml(homepageUrl)
  if (!html) {
    return { fetched: false, finding_count: 0, issues: [] }
  }
  const findings = analyseUIQuality(html, homepageUrl)
  return {
    fetched: true,
    finding_count: findings.length,
    issues: buildUiIssues(findings),
  }
}
