/**
 * Humanize a stored `Issue.item` key into a customer-facing title.
 *
 * `Issue.item` is the stable identifier we use for fix-rate matching
 * across scans (e.g. `form_no_destination:https://example.com/contact`).
 * It's a database key, not display copy. Wherever an issue surfaces in
 * the UI (report cards, solution map, developer email, PDF), we run
 * the item through this helper first.
 *
 * The stored `item` never changes — display layer only.
 *
 * Returns `{ title, subtitle? }` so cards can render a clean two-line
 * layout: bold title on top, smaller path/host context below.
 *
 * Adding a new issue type? Three places to update in this file:
 *   1. PREFIXED_TITLES — for `<check>:<pageUrl>` patterns
 *   2. BARE_KEY_TITLES — for single-token keys like `ssl_expired`
 *   3. UX prefix handling at the top of formatIssueTitle if needed
 */

export type FormattedTitle = {
  title: string
  subtitle?: string
}

// ─── Prefixed-key titles (`<prefix>:<pageUrl>`) ────────────────────────
//
// Keep titles short — they're rendered as card headings (~6 words max).
// They describe WHAT the problem is; the page path goes into subtitle.

const PREFIXED_TITLES: Record<string, string> = {
  // Content (lib/scan/content.ts)
  lorem_ipsum: 'Placeholder text found',
  coming_soon: '"Coming soon" page with no content',
  under_construction: '"Under construction" page',
  thin_content: 'Page has very little content',

  // UI quality (lib/scan/ui.ts)
  no_cta: 'No clear call-to-action',
  contact_buried: 'Phone number not in header',
  no_trust_indicators: 'No visible trust signals',
  wall_of_text: 'Long paragraphs without headings',
  missing_alt_text: 'Images missing alt text',
  nav_overload: 'Too many top-level menu items',
  no_h1: 'No main heading on page',

  // Workflow (lib/scan/workflow.ts)
  form_no_destination: 'Form has no submission destination',
  upload_no_submit: 'File upload has no submit button',
  upload_no_rules: 'File picker accepts any file type',
  upload_no_format_hint: 'No file format hint shown',
  upload_no_size_hint: 'No file size limit shown',
  form_missing_labels: 'Form fields missing labels',
  generic_submit_label: 'Generic submit button text',
  search_no_results: 'Search bar with no results page',
}

// ─── Bare-key titles (no colon) ────────────────────────────────────────

const BARE_KEY_TITLES: Record<string, string> = {
  // Twilio cost cap (lib/scan/phase2.ts)
  phone_lookup_cap: 'Some phone numbers not verified',

  // Link checker cap (lib/scan/links.ts)
  link_check_capped: 'Some links not checked',

  // SSL (lib/scan/ssl.ts)
  ssl_missing: 'No SSL certificate',
  ssl_expired: 'SSL certificate expired',
  ssl_expiring: 'SSL certificate expiring soon',
  ssl_self_signed: 'Self-signed SSL certificate',
  ssl_check_failed: 'Could not verify SSL certificate',

  // Images (lib/scan/images.ts)
  old_images_homepage: 'Old photos on homepage',
}

// ─── Public entry point ────────────────────────────────────────────────

export function formatIssueTitle(item: string): FormattedTitle {
  if (!item) return { title: 'Unknown issue' }

  // ── Phone numbers (Twilio) — E.164 format starting with `+` ─────────
  // Stored as +919429081884; humans expect +91 94290 81884 (Indian
  // grouping). For non-+91 numbers we fall back to grouping the last
  // 10 digits to keep the format predictable.
  if (item.startsWith('+')) {
    return { title: formatPhone(item) }
  }

  // ── Bare URL items (link checker — item is the link itself) ─────────
  if (/^https?:\/\//i.test(item)) {
    return formatUrlItem(item)
  }

  // ── ux:<slug>:<pageUrl> — Claude UX audit findings ──────────────────
  // The slug is the Claude-generated finding text, slugified at write
  // time. We reverse the slug for display.
  if (item.startsWith('ux:')) {
    return formatUxItem(item)
  }

  // ── <prefix>:<pageUrl> patterns ─────────────────────────────────────
  const colonIdx = item.indexOf(':')
  if (colonIdx > 0) {
    const prefix = item.slice(0, colonIdx)
    const rest = item.slice(colonIdx + 1)
    const knownTitle = PREFIXED_TITLES[prefix]
    if (knownTitle) {
      return {
        title: knownTitle,
        subtitle: pageSubtitle(rest),
      }
    }
    // Unknown prefix — fall through to bare-key + raw subtitle handling
  }

  // ── Bare keys (no colon, known) ─────────────────────────────────────
  if (BARE_KEY_TITLES[item]) {
    return { title: BARE_KEY_TITLES[item]! }
  }

  // ── Last-resort fallback — un-snake the raw key ─────────────────────
  // Better than showing `some_unknown_thing:url` to a customer.
  return {
    title: humanizeSnakeCase(item.split(':')[0] || item),
    subtitle: colonIdx > 0 ? pageSubtitle(item.slice(colonIdx + 1)) : undefined,
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Format a phone number in E.164 (`+919429081884`) into a readable form.
 * Indian +91 numbers get the standard 5-5 grouping ("+91 94290 81884").
 * Other country codes get loose digit grouping for legibility.
 */
function formatPhone(e164: string): string {
  // +91XXXXXXXXXX → +91 XXXXX XXXXX
  if (e164.startsWith('+91') && e164.length === 13) {
    return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`
  }
  // Generic fallback: split country code and group last 10 digits.
  const ccMatch = e164.match(/^\+(\d{1,3})(\d+)$/)
  if (ccMatch) {
    const cc = ccMatch[1]!
    const rest = ccMatch[2]!
    if (rest.length === 10) {
      return `+${cc} ${rest.slice(0, 5)} ${rest.slice(5)}`
    }
  }
  return e164
}

/**
 * For a URL stored as the `item` (link-checker findings), the URL IS
 * the identifying detail. Surface the host as the title and the path
 * as the subtitle so the card reads like a real reference.
 *
 *   https://www.example.com/contact?ref=foo
 *   ↓
 *   { title: 'example.com', subtitle: '/contact' }
 */
function formatUrlItem(rawUrl: string): FormattedTitle {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { title: rawUrl }
  }
  const host = parsed.hostname.replace(/^www\./i, '')
  const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : null
  return {
    title: host,
    subtitle: path ?? 'Homepage',
  }
}

/**
 * `ux:claude_finding_slug:https://example.com/page` → readable.
 * Slug uses underscores; reverse to spaces and capitalise first letter.
 */
function formatUxItem(item: string): FormattedTitle {
  // ux:<slug>:<url> — split on first two colons only; URL may contain colons
  const firstColon = item.indexOf(':')
  const secondColon = item.indexOf(':', firstColon + 1)
  if (secondColon === -1) {
    // Malformed — fall through to a sensible default
    return { title: 'UX finding', subtitle: undefined }
  }
  const slug = item.slice(firstColon + 1, secondColon)
  const url = item.slice(secondColon + 1)
  return {
    title: humanizeSnakeCase(slug),
    subtitle: pageSubtitle(url),
  }
}

/**
 * Convert a stored URL into a short page reference for the subtitle.
 * Homepage paths collapse to "Homepage". Other paths shown without
 * the host (the host is implied — it's the customer's own site).
 *
 *   https://www.example.com/contact.html  →  "/contact.html"
 *   https://www.example.com/              →  "Homepage"
 *   not-a-url                             →  the raw string (defensive)
 */
function pageSubtitle(maybeUrl: string): string {
  try {
    const u = new URL(maybeUrl)
    const path = u.pathname.replace(/\/+$/, '')
    if (!path || path === '') return 'Homepage'
    return path
  } catch {
    return maybeUrl
  }
}

/**
 * `form_no_destination` → "Form no destination".
 * Used as a defensive fallback when an unknown item key surfaces — keeps
 * the report readable instead of leaking the raw key to a customer.
 */
function humanizeSnakeCase(s: string): string {
  if (!s) return ''
  const words = s.replace(/[_-]+/g, ' ').trim()
  if (!words) return ''
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}
