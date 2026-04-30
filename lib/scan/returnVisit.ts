import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'
import type { Issue } from '@/lib/scan/phase2'

// ─── Tunables ──────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000
const FREE_RESCAN_THRESHOLD = 0.8

// Lightweight call (2-sentence message) — Haiku is fine here. The main
// report-generation call will use Sonnet per CLAUDE.md, but this tone-
// shaping call doesn't need that depth.
const RETURN_MESSAGE_MODEL = 'claude-haiku-4-5-20251001'
const RETURN_MESSAGE_MAX_TOKENS = 300

// CLAUDE.md prompt rule: "Never say 'congratulations', 'great job',
// 'well done', 'amazing'." If Claude slips, suppress the message
// rather than ship it — owner sees the rescan token but no warm copy.
const BANNED_PHRASE_RE =
  /\b(congratulations|congratulate|great\s+job|well\s+done|amazing)\b/i

// ─── Types ─────────────────────────────────────────────────────────────

export type PreviousScanSummary = {
  id: string
  url_normalized: string
  health_score: number | null
  completed_at: string  // ISO 8601
  days_since: number
}

export type FixRateResult = {
  fixRate: number              // 0–1
  resolvedCount: number
  highTotal: number
  resolvedItems: string[]      // items resolved (were fail/high, no longer fail)
  unchangedItems: string[]     // items still failing
  newIssuesCount: number       // new fail items not present in previous scan
}

export type ReturnVisitOutcome = {
  previous_scan_id: string | null
  fix_rate: number | null
  resolved_count: number | null
  new_issues_count: number | null
  unchanged_count: number | null
  is_free_rescan: boolean
  return_message: string | null
}

// ─── checkPreviousScan ─────────────────────────────────────────────────

/**
 * Find the most recent paid + completed scan for a normalised URL.
 *
 * Used at Phase 1 stage (`/api/scan/check-previous`) to drive the
 * return-visit UX, AND inside Phase 2 to feed `computeFixRate`. Caller
 * normalises the URL before passing in — this function does an exact
 * match.
 *
 * The current in-flight scan is excluded by `status='complete'` —
 * Phase 2 transitions to `complete` only after this step runs, so the
 * filter naturally skips it.
 */
export async function checkPreviousScan(
  urlNormalized: string,
): Promise<PreviousScanSummary | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('scans')
    .select('id, url_normalized, health_score, completed_at')
    .eq('url_normalized', urlNormalized)
    .eq('payment_status', 'paid')
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  const completedAtMs = new Date(data.completed_at as string).getTime()
  const daysSince = Math.floor((Date.now() - completedAtMs) / MS_PER_DAY)

  return {
    id: data.id as string,
    url_normalized: data.url_normalized as string,
    health_score: (data.health_score as number | null) ?? null,
    completed_at: data.completed_at as string,
    days_since: daysSince,
  }
}

// ─── computeFixRate ────────────────────────────────────────────────────

/**
 * Compute the fix-rate for a return-visit scan.
 *
 * Compares the current scan's issues against the previous scan's
 * `fail` + `priority='high'` items. An item is "resolved" when its
 * `item` key is no longer present in the new scan's failing set.
 *
 * `item` is a stable identifier across scans (phone number, page URL,
 * `<bucket>:<pageUrl>` key, etc.) — that stability is what makes
 * cross-scan matching work. Per-scan modules build their `item` keys
 * with that contract in mind.
 *
 * If the previous scan had zero fail/high issues, fixRate is 1 (nothing
 * to fix → trivially fixed). The free-rescan path will fire in this
 * case, which feels right — "your last scan was clean and this one
 * still is" deserves the warm message.
 */
export async function computeFixRate(
  previousScanId: string,
  newIssues: Issue[],
): Promise<FixRateResult> {
  const supabase = createServiceClient()
  const { data: prevIssues } = await supabase
    .from('issues')
    .select('item, priority, status')
    .eq('scan_id', previousScanId)
    .eq('status', 'fail')

  const prevHigh = (prevIssues ?? []).filter(
    (i) => i.priority === 'high',
  )

  if (prevHigh.length === 0) {
    return {
      fixRate: 1,
      resolvedCount: 0,
      highTotal: 0,
      resolvedItems: [],
      unchangedItems: [],
      newIssuesCount: 0,
    }
  }

  const newFailItems = new Set(
    newIssues.filter((i) => i.status === 'fail').map((i) => i.item),
  )
  const resolved: string[] = []
  const unchanged: string[] = []
  for (const i of prevHigh) {
    const item = i.item as string
    if (newFailItems.has(item)) unchanged.push(item)
    else resolved.push(item)
  }

  const prevItems = new Set(prevHigh.map((i) => i.item as string))
  let newIssuesCount = 0
  for (const i of newIssues) {
    if (i.status === 'fail' && !prevItems.has(i.item)) newIssuesCount += 1
  }

  return {
    fixRate: resolved.length / prevHigh.length,
    resolvedCount: resolved.length,
    highTotal: prevHigh.length,
    resolvedItems: resolved,
    unchangedItems: unchanged,
    newIssuesCount,
  }
}

// ─── isFreeRescanEarned ────────────────────────────────────────────────

export function isFreeRescanEarned(fixRate: number): boolean {
  return fixRate >= FREE_RESCAN_THRESHOLD
}

// ─── Return message generation (Claude) ────────────────────────────────

/**
 * Generate the warm 2-sentence message for an owner who earned the
 * free re-scan. Lightweight Claude call (Haiku) — separate from the
 * main report generation Sonnet call.
 *
 * Returns `null` (and logs) on:
 *   - Missing API key (server config issue)
 *   - Claude error / network failure
 *   - Empty response
 *   - Banned-phrase violation ("congratulations", "great job", etc.)
 *
 * The free-rescan eligibility is independent of message generation —
 * if Claude is down, the owner still gets the rescan, they just
 * don't see the warm copy.
 */
export async function generateReturnMessage(args: {
  resolvedItems: string[]
  unchangedItems: string[]
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn(
      '[returnMessage] ANTHROPIC_API_KEY missing — skipping return message',
    )
    return null
  }

  const prompt = buildReturnMessagePrompt(args)
  const client = new Anthropic({ apiKey })

  let res: Anthropic.Messages.Message
  try {
    res = await client.messages.create({
      model: RETURN_MESSAGE_MODEL,
      max_tokens: RETURN_MESSAGE_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    console.error(
      '[returnMessage] Claude call failed',
      err instanceof Error ? err.message : err,
    )
    return null
  }

  const block = res.content[0]
  if (!block || block.type !== 'text') return null
  const text = block.text.trim()
  if (!text) return null

  if (BANNED_PHRASE_RE.test(text)) {
    console.warn(
      '[returnMessage] Claude used banned phrase, suppressing:',
      text,
    )
    return null
  }

  return text
}

function buildReturnMessagePrompt(args: {
  resolvedItems: string[]
  unchangedItems: string[]
}): string {
  // Empty arrays still produce coherent prompts — Claude handles the
  // "(none)" case gracefully and the suppression rules below catch
  // anything tone-deaf.
  const resolved = args.resolvedItems.length
    ? args.resolvedItems.join(', ')
    : '(none specified)'
  const unchanged = args.unchangedItems.length
    ? args.unchangedItems.join(', ')
    : '(none)'

  return `You are writing a 2-sentence message for a business owner who acted on our website health report and fixed their issues.

Write the message AS Bugbite — our scanner mascot, a black cat with an orange wrench-curl tail. Speak in third person about Bugbite. Examples of Bugbite's voice:
- "Bugbite remembers your last visit."
- "Bugbite is glad to see the new contact form working."
- "Bugbite checked everything again."

Issues they fixed: ${resolved}
Issues still remaining: ${unchanged}

Rules:
- Open with "Bugbite" — the mascot is the speaker
- Reference at least one specific fixed issue by name (so the owner feels seen)
- Frame impact in terms of their customers, not their website
- Warm but not effusive. Grounded. Human-sounding even though it's a cat.
- Never say: "congratulations", "great job", "well done", "amazing"
- Maximum 2 sentences
- Plain text only, no markdown
- Never say "I" — always third person about Bugbite`
}

// ─── Phase 2 orchestrator step ─────────────────────────────────────────

/**
 * Run the full return-visit pipeline for a Phase 2 scan: look up the
 * prior scan, compute fix-rate, and (if earned) generate the return
 * message. Always returns a complete `ReturnVisitOutcome` — fields are
 * null when there's no prior scan or no message.
 *
 * Called from runPhase2 after `runChecks` returns and before the final
 * UPDATE flips the row to status='complete'. The caller merges the
 * returned fields into that UPDATE.
 *
 * Never throws — Claude failures degrade to `return_message: null` and
 * a console.warn. Free-rescan eligibility is decided purely from the
 * DB-derived fix-rate, independent of Claude.
 */
export async function runReturnVisitStep(args: {
  urlNormalized: string
  newIssues: Issue[]
}): Promise<ReturnVisitOutcome> {
  const empty: ReturnVisitOutcome = {
    previous_scan_id: null,
    fix_rate: null,
    resolved_count: null,
    new_issues_count: null,
    unchanged_count: null,
    is_free_rescan: false,
    return_message: null,
  }

  const previous = await checkPreviousScan(args.urlNormalized)
  if (!previous) return empty

  const fix = await computeFixRate(previous.id, args.newIssues)
  const earned = isFreeRescanEarned(fix.fixRate)

  let returnMessage: string | null = null
  if (earned) {
    returnMessage = await generateReturnMessage({
      resolvedItems: fix.resolvedItems,
      unchangedItems: fix.unchangedItems,
    })
  }

  return {
    previous_scan_id: previous.id,
    fix_rate: round2(fix.fixRate),
    resolved_count: fix.resolvedCount,
    new_issues_count: fix.newIssuesCount,
    unchanged_count: fix.unchangedItems.length,
    is_free_rescan: earned,
    return_message: returnMessage,
  }
}

// `fix_rate` is `numeric(4,2)` in Postgres. Round to two decimals so
// 0.8333... persists cleanly as 0.83 instead of triggering precision
// errors at insert time.
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
