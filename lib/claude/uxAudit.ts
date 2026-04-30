import Anthropic from '@anthropic-ai/sdk'
import * as cheerio from 'cheerio'
import { isSafeUrl } from '@/lib/security/ssrf'
import { normalizeUrl } from '@/lib/scan/extractor'
import type { Issue } from '@/lib/scan/phase2'
import type { ReportIntake } from '@/lib/claude/report'

// ─── Tunables ──────────────────────────────────────────────────────────

const UX_AUDIT_MODEL = 'claude-sonnet-4-6'
const UX_AUDIT_MAX_TOKENS = 1_000
const UX_AUDIT_TEMPERATURE = 0  // deterministic — same page → same findings

// CLAUDE.md rule 23: max 5 pages per scan — homepage + 4 highest-traffic
// internal pages. UX audits are the most expensive Claude call we make
// (Sonnet, full visible text), so the cap is firm.
const MAX_PAGES_PER_SCAN = 5

// Visible text bounds. Anything below MIN is too sparse to audit
// (probably a 404 or near-empty page). Anything above MAX is truncated
// — UX problems usually surface in the first 2–3 viewports of content,
// and 10k chars (~2k tokens) leaves room for the prompt overhead and
// output budget while staying well under Sonnet's context limit.
const MIN_VISIBLE_TEXT_CHARS = 200
const MAX_VISIBLE_TEXT_CHARS = 10_000

const FETCH_TIMEOUT_MS = 8_000
const FETCH_CONCURRENCY = 5

const USER_AGENT =
  'Mozilla/5.0 (compatible; fixmysite.in/1.0; +https://fixmysite.in)'

// Banned words from the prompt — Claude occasionally slips. We suppress
// individual findings rather than the whole audit so one bad finding
// doesn't drop a page's good findings too.
const BANNED_WORDS_RE = /\b(utilize|leverage|ensure|robust|seamless)\b/i

// ─── Types ─────────────────────────────────────────────────────────────

export type UxFinding = {
  finding: string             // short label
  user_experience: string     // what the user experiences
  business_impact: string     // what it costs the business
  action: string              // EXTENSION beyond CLAUDE.md schema —
                              // required because Issue.action is mandatory
                              // on every issue we surface in the report
  priority: 'high' | 'medium' | 'low'
  effort: 'low' | 'medium' | 'high'
}

export type UxAuditPageResult = {
  pageUrl: string
  primary_user_task: string
  task_completable: boolean
  ux_findings: UxFinding[]
}

// ─── Single-page audit ─────────────────────────────────────────────────

/**
 * Run the Claude UX audit on one page. Returns null on:
 *   - Missing API key
 *   - Page text below MIN_VISIBLE_TEXT_CHARS (nothing to audit)
 *   - Network / API error
 *   - JSON parse / shape validation failure
 *
 * Pages whose visible text is too short are dropped silently rather
 * than dispatched to Claude — saves API spend on near-empty 404 pages
 * the crawler picked up.
 */
export async function runUxAudit(opts: {
  pageUrl: string
  html: string
  intake?: ReportIntake | null
}): Promise<UxAuditPageResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[claude/uxAudit] ANTHROPIC_API_KEY missing — skipping')
    return null
  }

  const visibleText = extractVisibleText(opts.html)
  if (visibleText.length < MIN_VISIBLE_TEXT_CHARS) return null

  const prompt = buildPrompt({
    pageUrl: opts.pageUrl,
    visibleText: truncate(visibleText, MAX_VISIBLE_TEXT_CHARS),
    intake: opts.intake ?? null,
  })

  const client = new Anthropic({ apiKey })
  const parsed = await callClaude(client, prompt)
  if (!parsed) return null

  return validateResult(parsed, opts.pageUrl)
}

// ─── Cross-page orchestrator ───────────────────────────────────────────

export type UxAuditOutput = {
  pages_attempted: number
  pages_audited: number    // pages where Claude returned a valid result
  pages_skipped_empty: number  // pages dropped for too-short visible text
  pages_failed: number     // fetch failed or Claude returned null
  finding_count: number
  results: UxAuditPageResult[]
  issues: Issue[]
}

/**
 * Run UX audits across the top N pages of a scan. Selection mirrors
 * content.ts / workflow.ts: homepage first, then phase1 sample URLs,
 * then homepage internal links — natural order is the "most prominent"
 * proxy until we track per-URL link frequency in the extractor (v1.1).
 *
 * Pages are fetched + audited in parallel up to FETCH_CONCURRENCY.
 * Failed fetches and null Claude results are counted but don't fail
 * the orchestrator — partial audits are better than no audits.
 *
 * TODO v1.1: consume the shared per-scan page cache so we don't refetch
 * pages that content.ts and workflow.ts already pulled (logged at
 * CLAUDE.md → v1.1 Roadmap). Today this adds 5 more GETs per scan.
 */
export async function runUxAuditAcrossPages(opts: {
  homepageUrl: string
  sampleUrls: string[]
  internalLinks: string[]
  intake?: ReportIntake | null
}): Promise<UxAuditOutput> {
  const candidates = pickCandidatePages(opts).slice(0, MAX_PAGES_PER_SCAN)
  if (candidates.length === 0) {
    return emptyOutput()
  }

  let pagesAudited = 0
  let pagesSkippedEmpty = 0
  let pagesFailed = 0
  const results: UxAuditPageResult[] = []
  const issues: Issue[] = []

  let cursor = 0
  const intake = opts.intake ?? null

  async function worker() {
    while (true) {
      const idx = cursor++
      if (idx >= candidates.length) return
      const url = candidates[idx]!
      const html = await fetchPageHtml(url)
      if (!html) {
        pagesFailed += 1
        continue
      }
      // Quick visible-text length check before paying for a Claude call.
      // runUxAudit will re-do the strip internally; the duplicate work
      // is cheap compared to a Sonnet round-trip.
      const visibleText = extractVisibleText(html)
      if (visibleText.length < MIN_VISIBLE_TEXT_CHARS) {
        pagesSkippedEmpty += 1
        continue
      }
      const result = await runUxAudit({ pageUrl: url, html, intake })
      if (!result) {
        pagesFailed += 1
        continue
      }
      pagesAudited += 1
      results.push(result)
      issues.push(...buildIssuesFromResult(result))
    }
  }

  const workers = Math.min(FETCH_CONCURRENCY, candidates.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))

  return {
    pages_attempted: candidates.length,
    pages_audited: pagesAudited,
    pages_skipped_empty: pagesSkippedEmpty,
    pages_failed: pagesFailed,
    finding_count: issues.length,
    results,
    issues,
  }
}

// ─── Issue translation ─────────────────────────────────────────────────

/**
 * Translate per-page UX findings into report issues.
 *
 * Each UX finding becomes one Issue, `category: 'workflow'`. The
 * `item` is keyed `ux:<finding-slug>:<pageUrl>` so the same finding
 * on a different page tracks separately for fix-rate matching, and
 * different findings on the same page don't collide.
 *
 * Findings whose user_experience or business_impact contains a banned
 * word are silently dropped here — the prompt forbids them and we
 * don't want to ship findings that violate the tone rules even if
 * Claude slipped.
 */
function buildIssuesFromResult(result: UxAuditPageResult): Issue[] {
  const issues: Issue[] = []
  for (const f of result.ux_findings) {
    const detailParts = [f.user_experience.trim(), f.business_impact.trim()]
      .filter(Boolean)
    const detail = detailParts.join(' ')
    if (BANNED_WORDS_RE.test(detail) || BANNED_WORDS_RE.test(f.action)) {
      console.warn(
        '[claude/uxAudit] banned word in finding — suppressing',
        { pageUrl: result.pageUrl, finding: f.finding },
      )
      continue
    }
    if (!detail || !f.action.trim()) continue

    issues.push({
      category: 'workflow',
      item: `ux:${slugify(f.finding)}:${result.pageUrl}`,
      status: f.priority === 'high' ? 'fail' : 'warning',
      priority: f.priority,
      effort: f.effort,
      detail,
      action: f.action.trim(),
    })
  }
  return issues
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

// ─── Internal: HTML → visible text ─────────────────────────────────────

function extractVisibleText(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, noscript, template, head').remove()
  return $('body').text().replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return (
    text.slice(0, max) +
    '\n\n[content truncated — first ' + max + ' characters shown]'
  )
}

// ─── Internal: prompt construction ─────────────────────────────────────

function buildPrompt(args: {
  pageUrl: string
  visibleText: string
  intake: ReportIntake | null
}): string {
  const intakeBlock = buildIntakeBlock(args.intake)
  const intakePrefix = intakeBlock ? intakeBlock + '\n\n' : ''
  return `${intakePrefix}You are auditing a business website page for user experience problems.
Read the page content below and identify workflow failures.

Page URL: ${args.pageUrl}
Page content:
${args.visibleText}

Ask yourself:
1. What is the single most likely task a visitor comes to this page to do?
2. Can that task be completed from start to finish based on what is visible?
3. Where would a real user stop, get confused, or give up?

Also check for:
- Instructions that are incomplete (upload section with no rules, form with no guidance)
- Contradictions (different information in different places)
- Jargon with no explanation
- A process described in words but no actual mechanism to do it on the page
- Missing confirmation — user does something but receives no feedback

Rules for your findings:
- Write every finding from the USER's perspective, not the website owner's
- One sentence: what the user experiences. One sentence: what it costs the business.
- Never use the words: "ensure", "robust", "seamless", "utilize", "leverage"
- If you cannot determine an appropriate finding, omit it entirely. Never fabricate findings.
- If the page is simple and has no workflow problems, return an empty array

Return only valid JSON, no preamble:
{
  "primary_user_task": string,
  "task_completable": boolean,
  "ux_findings": [
    {
      "finding": string (short label, under 80 characters),
      "user_experience": string (one sentence — what the user experiences),
      "business_impact": string (one sentence — what it costs the business),
      "action": string (one sentence — the specific fix the owner should apply),
      "priority": "high|medium|low",
      "effort": "low|medium|high"
    }
  ]
}`
}

function buildIntakeBlock(intake: ReportIntake | null): string | null {
  if (!intake) return null
  const text = intake.text?.trim()
  const cards = intake.cards?.filter(Boolean) ?? []
  if (!text && cards.length === 0) return null
  const lines = ['## Owner intake (their plain-language goals)']
  if (cards.length > 0) lines.push(`Selected concerns: ${cards.join(', ')}`)
  if (text) lines.push(`Owner's own words: ${text}`)
  lines.push(
    'Weight findings that align with the owner\'s stated concerns when relevant.',
  )
  return lines.join('\n')
}

// ─── Internal: Claude call ─────────────────────────────────────────────

async function callClaude(
  client: Anthropic,
  prompt: string,
): Promise<unknown | null> {
  let res: Anthropic.Messages.Message
  try {
    res = await client.messages.create({
      model: UX_AUDIT_MODEL,
      max_tokens: UX_AUDIT_MAX_TOKENS,
      temperature: UX_AUDIT_TEMPERATURE,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    console.error(
      '[claude/uxAudit] API call failed',
      err instanceof Error ? err.message : err,
    )
    return null
  }
  const block = res.content[0]
  if (!block || block.type !== 'text') return null
  const raw = block.text.trim()
  if (!raw) return null
  const stripped = stripMarkdownFences(raw)
  try {
    return JSON.parse(stripped)
  } catch {
    console.warn(
      '[claude/uxAudit] JSON.parse failed (truncated):',
      stripped.slice(0, 200),
    )
    return null
  }
}

function stripMarkdownFences(text: string): string {
  const m = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  if (m && m[1]) return m[1].trim()
  return text
}

// ─── Internal: response validation ─────────────────────────────────────

function validateResult(
  parsed: unknown,
  pageUrl: string,
): UxAuditPageResult | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>

  const primary =
    typeof obj.primary_user_task === 'string'
      ? obj.primary_user_task.trim()
      : ''
  if (!primary) return null

  const completable =
    typeof obj.task_completable === 'boolean' ? obj.task_completable : null
  if (completable === null) return null

  if (!Array.isArray(obj.ux_findings)) return null

  const findings: UxFinding[] = []
  for (const raw of obj.ux_findings) {
    const f = validateFinding(raw)
    if (f) findings.push(f)
  }

  return {
    pageUrl,
    primary_user_task: primary,
    task_completable: completable,
    ux_findings: findings,
  }
}

function validateFinding(raw: unknown): UxFinding | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const finding = strField(r.finding)
  const ux = strField(r.user_experience)
  const impact = strField(r.business_impact)
  const action = strField(r.action)
  if (!finding || !ux || !impact || !action) return null
  const priority = isPriority(r.priority) ? r.priority : null
  const effort = isEffort(r.effort) ? r.effort : null
  if (!priority || !effort) return null
  return {
    finding,
    user_experience: ux,
    business_impact: impact,
    action,
    priority,
    effort,
  }
}

function strField(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function isPriority(v: unknown): v is 'high' | 'medium' | 'low' {
  return v === 'high' || v === 'medium' || v === 'low'
}

function isEffort(v: unknown): v is 'low' | 'medium' | 'high' {
  return v === 'low' || v === 'medium' || v === 'high'
}

// ─── Internal: page selection ──────────────────────────────────────────

function pickCandidatePages(opts: {
  homepageUrl: string
  sampleUrls: string[]
  internalLinks: string[]
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const consider = (raw: string) => {
    if (out.length >= MAX_PAGES_PER_SCAN) return
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

// ─── Internal: page fetcher ────────────────────────────────────────────

async function fetchPageHtml(url: string): Promise<string | null> {
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

function emptyOutput(): UxAuditOutput {
  return {
    pages_attempted: 0,
    pages_audited: 0,
    pages_skipped_empty: 0,
    pages_failed: 0,
    finding_count: 0,
    results: [],
    issues: [],
  }
}
