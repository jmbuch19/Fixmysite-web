import * as cheerio from 'cheerio'
import { isSafeUrl } from '@/lib/security/ssrf'
import { normalizeUrl } from '@/lib/scan/extractor'
import type { Issue } from '@/lib/scan/phase2'

// ─── Tunables ──────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8_000
const MAX_WORKFLOW_PAGES = 20
const FETCH_CONCURRENCY = 4

const USER_AGENT =
  'Mozilla/5.0 (compatible; fixmysite.in/1.0; +https://fixmysite.in)'

// CTAs we'd like the link checker to validate. Collected here for future
// cross-reference (CLAUDE.md rule 28); not surfaced as standalone issues
// today since the link checker has already finished by the time
// workflow.ts runs.
const CTA_SELECTORS = [
  'a[href*="apply"]',
  'a[href*="book"]',
  'a[href*="enquire"]',
  'a[href*="register"]',
  'a[href*="download"]',
  'a[href*="appointment"]',
] as const

const GENERIC_SUBMIT_LABELS = new Set([
  'submit',
  'send',
  'go',
  'ok',
  'click here',
])

// ─── Types ─────────────────────────────────────────────────────────────

export type WorkflowCheckKey =
  | 'form_no_destination'
  | 'form_js_driven'
  | 'upload_no_submit'
  | 'upload_no_rules'
  | 'upload_no_format_hint'
  | 'upload_no_size_hint'
  | 'form_missing_labels'
  | 'generic_submit_label'
  | 'cta_to_validate'
  | 'search_no_results'

export type WorkflowFinding = {
  check: WorkflowCheckKey
  page: string
  priority: 'low' | 'medium' | 'high'
  effort: 'low' | 'medium' | 'high'
  userImpact: string       // mandatory — CLAUDE.md rule 25
  href?: string            // populated for cta_to_validate only
}

// ─── Pure detector ─────────────────────────────────────────────────────

/**
 * HTML-only workflow audit. Runs synchronously per page — no AI cost,
 * no network calls — so it's safe to invoke on every crawled page
 * (CLAUDE.md rule 24).
 *
 * Every finding carries a `userImpact` line written from the visitor's
 * perspective ("user fills the form, nothing happens") rather than the
 * site owner's. The report renderer surfaces this directly as the
 * issue's `detail` text — owners read what their customers experience
 * instead of what the site "does wrong".
 *
 * Implementation follows the CLAUDE.md pattern verbatim. Effort and
 * priority values were already fixed there; do not tune in isolation.
 */
export function auditWorkflow(
  html: string,
  pageUrl: string,
): WorkflowFinding[] {
  const $ = cheerio.load(html)
  const findings: WorkflowFinding[] = []

  // ─── Forms ───────────────────────────────────────────────────────────
  // Page-level signal: any <script> tag at all on the rendered HTML.
  // Used by the JS-driven-form heuristic below — a form lacking the
  // classical action/method attributes is fine on a modern React /
  // Vue / Svelte page where submission lives in compiled JavaScript
  // the scraper cannot read.
  const pageHasScript = $('script').length > 0

  $('form').each((_, form) => {
    const $form = $(form)
    const hasAction = !!$form.attr('action')
    const hasMethod = !!$form.attr('method')
    const hasSubmit =
      $form.find('[type=submit], button').length > 0
    const fileInputs = $form.find('input[type=file]')
    const labels = $form.find('label').length
    const fields = $form.find('input, select, textarea').length

    if (!hasAction || !hasMethod) {
      // JS-driven heuristic: a form with no action/method, but with a
      // submit-shaped button AND a script tag somewhere on the page,
      // is overwhelmingly likely to be a React/Vue/Svelte form whose
      // submission path is bound in JavaScript. Flagging this as
      // 'fail/high' produces a ~80% false-positive rate on modern
      // sites — fixmysite.in itself was the canary.
      //
      // Browsers also default <button> inside a form to type="submit",
      // so a bare <button> without an explicit type counts as a submit
      // signal too.
      const hasSubmitButton =
        $form.find(
          'button[type="submit"], button:not([type]), input[type="submit"]',
        ).length > 0
      const isJsDriven = hasSubmitButton && pageHasScript

      if (isJsDriven) {
        findings.push({
          check: 'form_js_driven',
          page: pageUrl,
          priority: 'low',
          effort: 'low',
          userImpact:
            'Form uses JavaScript submission — Bugbite could not verify the destination automatically. Test it yourself by submitting and confirming the message reaches you.',
        })
      } else {
        findings.push({
          check: 'form_no_destination',
          page: pageUrl,
          priority: 'high',
          effort: 'low',
          userImpact:
            'User fills the form and clicks submit — nothing happens. Their enquiry is lost.',
        })
      }
    }

    if (fileInputs.length > 0 && !hasSubmit) {
      findings.push({
        check: 'upload_no_submit',
        page: pageUrl,
        priority: 'high',
        effort: 'low',
        userImpact:
          'User selects a file but finds no upload button. They cannot complete the action.',
      })
    }

    fileInputs.each((__, input) => {
      const $input = $(input)
      const accept = $input.attr('accept')

      // Walk up to the nearest meaningful container so hint copy in a
      // sibling description div (not the direct parent) is captured —
      // typical CMS layout puts "Upload your CV (PDF, max 5MB)" in a
      // separate <p> above the input.
      const $ctx = $input.closest('form, fieldset, div, section')
      const nearbyText = ($ctx.length ? $ctx : $input.parent())
        .text()
        .toLowerCase()
      const hasFormatHint =
        /pdf|jpg|jpeg|png|doc|docx|format|type/i.test(nearbyText)
      const hasSizeHint =
        /mb|kb|size|maximum|max|limit/i.test(nearbyText)

      // Three orthogonal checks here — keep them separate so the
      // report can guide the owner toward the specific gap:
      //   upload_no_rules        → no `accept` attribute (the OS file
      //                            picker doesn't filter at all)
      //   upload_no_format_hint  → no human-readable format hint near
      //                            the input (PDF/JPG/PNG/DOC/...)
      //   upload_no_size_hint    → no human-readable size hint (MB/KB/
      //                            limit/maximum/...)
      // A site can fail any combination — accept attribute set but no
      // visible copy ("file picker filters but the user doesn't know
      // why their drag-drop got rejected"), or visible copy without
      // an accept attribute ("hint says PDF only, but the picker still
      // shows everything").

      if (!accept) {
        findings.push({
          check: 'upload_no_rules',
          page: pageUrl,
          priority: 'high',
          effort: 'low',
          userImpact:
            'File picker accepts any file. User picks something invalid and only finds out after the form errors on submit.',
        })
      }

      if (!hasFormatHint) {
        findings.push({
          check: 'upload_no_format_hint',
          page: pageUrl,
          priority: 'high',
          effort: 'low',
          userImpact:
            'No file format shown. User uploads the wrong type, gets rejected, and has no idea why.',
        })
      }

      if (!hasSizeHint) {
        findings.push({
          check: 'upload_no_size_hint',
          page: pageUrl,
          priority: 'high',
          effort: 'low',
          userImpact:
            'No file size limit shown. User spends time compressing a file with no target to aim for.',
        })
      }
    })

    if (fields > 2 && labels < fields / 2) {
      findings.push({
        check: 'form_missing_labels',
        page: pageUrl,
        priority: 'medium',
        effort: 'low',
        userImpact:
          'Form fields have no labels. Users on mobile or screen readers cannot tell what to fill in.',
      })
    }

    const submitText = $form
      .find('[type=submit], button[type=submit]')
      .text()
      .trim()
      .toLowerCase()
    if (submitText && GENERIC_SUBMIT_LABELS.has(submitText)) {
      findings.push({
        check: 'generic_submit_label',
        page: pageUrl,
        priority: 'low',
        effort: 'low',
        userImpact:
          'Submit button says nothing useful. User is unsure what will happen when they click.',
      })
    }
  })

  // ─── CTA dead-ends (collected only) ─────────────────────────────────
  // CLAUDE.md rule 28: only collect, do NOT validate here. Link
  // validation is the link-checker's job. We tag these for future
  // cross-reference but do not translate them into issues today.
  for (const sel of CTA_SELECTORS) {
    $(sel).each((_, el) => {
      const href = $(el).attr('href')
      if (!href) return
      findings.push({
        check: 'cta_to_validate',
        page: pageUrl,
        priority: 'high',
        effort: 'low',
        userImpact:
          'Primary action button may lead nowhere. Visitor intent is blocked.',
        href,
      })
    })
  }

  // ─── Search bar without results page ────────────────────────────────
  const hasSearch =
    $('input[type=search], input[name=s], input[name=q]').length > 0
  // Cheap signature for "this site has a results page". The crude
  // string match is intentional — we're looking for the WordPress
  // `?s=` pattern, the generic `?q=` pattern, or a results-page URL
  // anywhere in the HTML.
  const hasResultsSurface =
    html.includes('search-results') ||
    html.includes('?s=') ||
    html.includes('?q=')
  if (hasSearch && !hasResultsSurface) {
    findings.push({
      check: 'search_no_results',
      page: pageUrl,
      priority: 'medium',
      effort: 'medium',
      userImpact:
        'Search bar is present but searching goes nowhere. Users searching for specific info leave frustrated.',
    })
  }

  return findings
}

// ─── Issue translation ─────────────────────────────────────────────────

/**
 * Translate workflow findings into report issues.
 *
 * Dedupe by (check, page) so a page with five forms each missing labels
 * surfaces once, not five times. The report's "fix the form labels on
 * /contact" direction is identical regardless of how many forms have
 * the problem.
 *
 * `cta_to_validate` is intentionally dropped here per CLAUDE.md rule 28
 * — those hrefs need link-checker validation before becoming issues.
 */
export function buildWorkflowIssues(findings: WorkflowFinding[]): Issue[] {
  const seen = new Set<string>()
  const issues: Issue[] = []
  for (const f of findings) {
    if (f.check === 'cta_to_validate') continue
    const item = `${f.check}:${f.page}`
    if (seen.has(item)) continue
    seen.add(item)
    issues.push({
      category: 'workflow',
      item,
      status: f.priority === 'high' ? 'fail' : 'warning',
      priority: f.priority,
      effort: f.effort,
      detail: f.userImpact,
      action: workflowAction(f.check),
    })
  }
  return issues
}

function workflowAction(check: WorkflowCheckKey): string {
  switch (check) {
    case 'form_no_destination':
      return "Set the form's submission destination — your developer can fix this in minutes."
    case 'form_js_driven':
      return 'Submit the form yourself and confirm you receive the enquiry — Bugbite cannot verify JavaScript-driven submissions automatically.'
    case 'upload_no_submit':
      return 'Add a clearly labelled upload or submit button next to the file field.'
    case 'upload_no_rules':
      return 'Add an `accept` attribute to the file input — for example `accept=".pdf,.jpg"` — so the file picker only shows valid choices.'
    case 'upload_no_format_hint':
      return 'Show accepted file formats next to the upload — for example "PDF or JPG only".'
    case 'upload_no_size_hint':
      return 'Show the maximum file size next to the upload — for example "Maximum 5 MB".'
    case 'form_missing_labels':
      return 'Add a short label above each input describing what to fill in.'
    case 'generic_submit_label':
      return 'Replace generic button text with the actual outcome — for example "Send enquiry" or "Book appointment".'
    case 'search_no_results':
      return 'Hook the search bar up to a results page, or remove it if not used.'
    case 'cta_to_validate':
      return ''
  }
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
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

export type WorkflowChecksOutput = {
  pages_attempted: number
  pages_fetched: number
  pages_failed: number
  finding_count: number
  cta_collected: number
  issues: Issue[]
}

/**
 * Build the same crawl page list content.ts uses, fetch each fresh,
 * run auditWorkflow over each, aggregate findings.
 *
 * TODO v1.1: this duplicates content.ts's fetch loop — both modules
 * fetch the same up-to-20 pages independently. Extract a shared
 * per-scan page cache so each URL is fetched once and the HTML is
 * fanned out to content + workflow + ui. Worth ~20 fewer GETs per
 * scan against the customer's own site.
 */
export async function runWorkflowChecks(opts: {
  homepageUrl: string
  sampleUrls: string[]
  internalLinks: string[]
}): Promise<WorkflowChecksOutput> {
  const candidates = buildCrawlList(opts)

  let pagesFetched = 0
  let pagesFailed = 0
  const allFindings: WorkflowFinding[] = []

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
      allFindings.push(...auditWorkflow(fetched.html, url))
    }
  }

  const workers = Math.min(FETCH_CONCURRENCY, candidates.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))

  const issues = buildWorkflowIssues(allFindings)
  const ctaCollected = allFindings.filter(
    (f) => f.check === 'cta_to_validate',
  ).length

  return {
    pages_attempted: candidates.length,
    pages_fetched: pagesFetched,
    pages_failed: pagesFailed,
    finding_count: allFindings.length - ctaCollected,
    cta_collected: ctaCollected,
    issues,
  }
}

function buildCrawlList(opts: {
  homepageUrl: string
  sampleUrls: string[]
  internalLinks: string[]
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const consider = (raw: string) => {
    if (out.length >= MAX_WORKFLOW_PAGES) return
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
