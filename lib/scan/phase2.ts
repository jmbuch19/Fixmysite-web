import { revalidateTag } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { SERVICE_COUNTERS_TAG } from '@/lib/stats/serviceCounters'
import type { Phase1Result } from '@/lib/scan/phase1'
import {
  hasTwilioCredentials,
  lookupPhones,
  type PhoneLookupResult,
} from '@/lib/scan/twilio'
import {
  buildLinkIssues,
  checkLinks,
  type LinkCheckResult,
} from '@/lib/scan/links'
import {
  buildNoSslIssue,
  buildSslIssues,
  checkSsl,
  type SslCheckResult,
} from '@/lib/scan/ssl'
import {
  runContentChecks,
  type ContentChecksOutput,
} from '@/lib/scan/content'
import {
  buildImageIssues,
  checkImages,
  type ImagesChecksOutput,
} from '@/lib/scan/images'
import { runUiChecks, type UiChecksOutput } from '@/lib/scan/ui'
import {
  runWorkflowChecks,
  type WorkflowChecksOutput,
} from '@/lib/scan/workflow'
import { runReturnVisitStep } from '@/lib/scan/returnVisit'
import { generateReport, type ReportOutput } from '@/lib/claude/report'
import {
  runUxAuditAcrossPages,
  type UxAuditOutput,
} from '@/lib/claude/uxAudit'

/**
 * Phase 2 orchestrator (scaffold).
 *
 * Status state machine per SPEC §8 scans schema:
 *
 *     phase1_complete  ─(payment verify)─▶  paid
 *           paid       ─(this fn)──────────▶  scanning
 *         scanning     ─(this fn ok)───────▶  complete
 *         scanning     ─(this fn error)────▶  failed
 *
 * Idempotency contract:
 *   - status='paid'        → acquire lock (paid→scanning) and run
 *   - status='scanning'    → another call holds the lock; reject 'in_progress'
 *   - status='complete'    → already done; return success with `alreadyComplete: true`
 *   - status='failed'      → reject 'previously_failed' (admin must intervene)
 *   - status='phase1_complete' or null → reject 'not_paid' (payment-verify never ran)
 *
 * The paid→scanning lock acquisition is a conditional UPDATE (`.eq('status', 'paid')`)
 * — atomic at the row level. Two concurrent callers cannot both transition the row
 * to 'scanning'; the second sees count=0 and bails with 'in_progress'.
 *
 * Real Phase 2 work (Twilio Lookup, link checks, Claude calls, etc.) lands in the
 * `runChecks` private function below. Today it sleeps 1s and emits a skeleton
 * report_json + phase2_result so the rest of the pipeline (report page, PDF,
 * email) has real (if empty) data to render against.
 */

export type Phase2Outcome =
  | {
      ok: true
      scan_id: string
      health_score: number | null
      already_complete: boolean
    }
  | {
      ok: false
      scan_id: string
      reason:
        | 'scan_not_found'
        | 'not_paid'
        | 'in_progress'
        | 'previously_failed'
        | 'db_error'
        | 'orchestrator_error'
      message?: string
    }

type ScanRow = {
  id: string
  url: string
  url_normalized: string
  status: string | null
  payment_status: string
  tier: string | null
  page_count: number | null
  health_score: number | null
  phase1_result: Phase1Result | null
}

/**
 * Issue shape stored in BOTH `scans.report_json.issues` (jsonb, used by
 * the report page for one-shot rendering) and the relational `issues`
 * table (used by /lib/scan/returnVisit.ts for fix-rate comparison across
 * scans of the same URL — SPEC §7).
 *
 * `item` should be a stable identifier for the same finding across scans
 * (e.g. the phone number itself, or a check key like "ssl_expiry") so
 * fix-rate can match resolved-vs-still-broken issues by item value.
 */
export type Issue = {
  category:
    | 'contact'
    | 'links'
    | 'trust'
    | 'content'
    | 'visual'
    | 'workflow'
    | 'technical'
  item: string
  status: 'ok' | 'fail' | 'warning'
  detail: string
  priority: 'high' | 'medium' | 'low'
  effort: 'low' | 'medium' | 'high'
  action: string
}

export async function runPhase2(scan_id: string): Promise<Phase2Outcome> {
  const supabase = createServiceClient()

  // ─── Read current state ──────────────────────────────────────────────
  const { data: scan, error: loadError } = await supabase
    .from('scans')
    .select(
      'id, url, url_normalized, status, payment_status, tier, page_count, health_score, phase1_result',
    )
    .eq('id', scan_id)
    .maybeSingle()

  if (loadError) {
    console.error('[phase2] failed to load scan', { scan_id, error: loadError.message })
    return { ok: false, scan_id, reason: 'db_error', message: loadError.message }
  }
  if (!scan) {
    return { ok: false, scan_id, reason: 'scan_not_found' }
  }

  const row = scan as ScanRow

  // ─── Pre-flight checks ───────────────────────────────────────────────
  if (row.payment_status !== 'paid') {
    return { ok: false, scan_id, reason: 'not_paid' }
  }
  if (row.status === 'complete') {
    return {
      ok: true,
      scan_id,
      health_score: row.health_score,
      already_complete: true,
    }
  }
  if (row.status === 'scanning') {
    return { ok: false, scan_id, reason: 'in_progress' }
  }
  if (row.status === 'failed') {
    // Admin must reset to 'paid' to retry. We don't auto-retry to avoid
    // burning external API credits (Twilio, Claude, Maps) on bad inputs.
    return { ok: false, scan_id, reason: 'previously_failed' }
  }

  // ─── Acquire lock: paid → scanning ───────────────────────────────────
  // Conditional update is atomic at the row level. If status changed
  // between our SELECT above and this UPDATE (race), count returns 0 and
  // we bail without running.
  const { count: lockCount, error: lockError } = await supabase
    .from('scans')
    .update({ status: 'scanning' }, { count: 'exact' })
    .eq('id', scan_id)
    .eq('status', 'paid')

  if (lockError) {
    console.error('[phase2] lock acquisition failed', {
      scan_id,
      error: lockError.message,
    })
    return { ok: false, scan_id, reason: 'db_error', message: lockError.message }
  }
  if ((lockCount ?? 0) === 0) {
    // Lost the race — re-read to give the caller a useful reason
    const { data: refetch } = await supabase
      .from('scans')
      .select('status')
      .eq('id', scan_id)
      .maybeSingle()
    if (refetch?.status === 'complete') {
      return {
        ok: true,
        scan_id,
        health_score: row.health_score,
        already_complete: true,
      }
    }
    if (refetch?.status === 'scanning') {
      return { ok: false, scan_id, reason: 'in_progress' }
    }
    return { ok: false, scan_id, reason: 'not_paid' }
  }

  // ─── Run checks (scaffold today; real checks land in upcoming sub-tasks)
  let result: Awaited<ReturnType<typeof runChecks>>
  try {
    result = await runChecks(row)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[phase2] orchestrator error', { scan_id, error: msg })
    // Transition scanning → failed so the row isn't stuck in scanning forever.
    await supabase
      .from('scans')
      .update({ status: 'failed' })
      .eq('id', scan_id)
      .eq('status', 'scanning')
    return { ok: false, scan_id, reason: 'orchestrator_error', message: msg }
  }

  // ─── Claude report generation (summary + health_score + solution_map)
  // The check modules built authoritative issues with real contextual
  // data. Claude's role here is the analyst layer ON TOP of those facts:
  //   - one-sentence summary
  //   - calibrated health_score (0–100)
  //   - ordered, refined solution_map (we pre-sort and let Claude polish)
  //
  // Returns null on missing API key, network error, or validation
  // failure after a strict-reminder retry. On null, we keep our
  // heuristic health_score and synthesize a generic summary — the
  // owner still sees a complete report, just without the warm copy.
  const ssl = row.phase1_result?.ssl ?? {
    basicValid: false,
    detail: 'unknown',
  }
  const claudeReport: ReportOutput | null = await generateReport({
    url: row.url,
    phase1: {
      url: row.phase1_result?.finalUrl ?? row.url,
      pageCount: row.page_count ?? 0,
      tier: row.tier ?? 'unknown',
      ssl,
      phoneCount: (row.phase1_result?.homepage?.phones ?? []).length,
      emailCount: (row.phase1_result?.homepage?.emails ?? []).length,
    },
    issues: result.issues,
    intake: null, // owner_intake table is v1.1 — wire when it lands
  })

  // Merge Claude outputs over the heuristic fallbacks. `result.issues`
  // is unchanged either way — Claude never authors issues.
  const finalHealthScore =
    claudeReport?.health_score ?? result.health_score
  const finalReportJson = {
    ...result.report_json,
    health_score: finalHealthScore,
    summary: claudeReport?.summary ?? result.report_json.summary,
    solution_map: claudeReport?.solution_map ?? [],
    generated_by_claude: claudeReport !== null,
  }

  // ─── Return-visit check (BEFORE issue insert + status flip) ──────────
  // Looks up the most recent paid+complete scan for this normalised URL,
  // computes fix-rate over previous fail/high issues, and (if the owner
  // earned the free rescan) generates a 2-sentence Claude return message.
  // Always returns a complete outcome — null fields when no prior scan
  // exists. Never throws; Claude failures degrade to return_message:null.
  const returnVisit = await runReturnVisitStep({
    urlNormalized: row.url_normalized,
    newIssues: result.issues,
  })

  // ─── Insert relational issues BEFORE flipping status ──────────────────
  // The status='complete' flip is the publish point. Inserting issues
  // first means /report/full never sees a complete scan with empty
  // issues. If insert fails, abort and transition to failed — the scan
  // can be re-run by an admin reset rather than leaving inconsistent state.
  if (result.issues.length > 0) {
    const issueRows = result.issues.map((i) => ({
      scan_id,
      category: i.category,
      item: i.item,
      status: i.status,
      detail: i.detail,
      priority: i.priority,
      effort: i.effort,
      action: i.action,
    }))
    const { error: issuesError } = await supabase
      .from('issues')
      .insert(issueRows)
    if (issuesError) {
      console.error('[phase2] issues table insert failed', {
        scan_id,
        error: issuesError.message,
      })
      await supabase
        .from('scans')
        .update({ status: 'failed' })
        .eq('id', scan_id)
        .eq('status', 'scanning')
      return {
        ok: false,
        scan_id,
        reason: 'db_error',
        message: issuesError.message,
      }
    }
  }

  // ─── Persist results: scanning → complete ────────────────────────────
  // The return-visit fields are written here regardless of whether the
  // free rescan was earned — `previous_scan_id`, `fix_rate`,
  // `resolved_count`, and the new/unchanged counts are useful history
  // metrics on every return scan. `is_free_rescan` and `return_message`
  // are gated to the >=0.8 fix-rate path inside runReturnVisitStep.
  const { error: persistError } = await supabase
    .from('scans')
    .update({
      status: 'complete',
      report_json: finalReportJson,
      phase2_result: result.phase2_result,
      health_score: finalHealthScore,
      completed_at: new Date().toISOString(),
      previous_scan_id: returnVisit.previous_scan_id,
      fix_rate: returnVisit.fix_rate,
      resolved_count: returnVisit.resolved_count,
      new_issues_count: returnVisit.new_issues_count,
      unchanged_count: returnVisit.unchanged_count,
      is_free_rescan: returnVisit.is_free_rescan,
      return_message: returnVisit.return_message,
    })
    .eq('id', scan_id)
    .eq('status', 'scanning')

  if (persistError) {
    console.error('[phase2] persist failed', {
      scan_id,
      error: persistError.message,
    })
    await supabase
      .from('scans')
      .update({ status: 'failed' })
      .eq('id', scan_id)
      .eq('status', 'scanning')
    return {
      ok: false,
      scan_id,
      reason: 'db_error',
      message: persistError.message,
    }
  }

  // Bust the homepage service-counter cache so the new completion
  // shows up on the next render. 'max' = stale-while-revalidate so
  // the next homepage hit serves the cached value immediately and
  // fetches the fresh count in the background. Best-effort — a
  // counter that lags is acceptable; a failed scan persist is not.
  try {
    revalidateTag(SERVICE_COUNTERS_TAG, 'max')
  } catch (err) {
    console.warn('[phase2] revalidateTag failed', {
      scan_id,
      error: err instanceof Error ? err.message : err,
    })
  }

  return {
    ok: true,
    scan_id,
    health_score: result.health_score,
    already_complete: false,
  }
}

// ─── Check pipeline ──────────────────────────────────────────────────────

type ChecksOutput = {
  health_score: number | null
  issues: Issue[]
  report_json: Record<string, unknown>
  phase2_result: Record<string, unknown>
}

type CheckOutcome = 'completed' | 'skipped:no_phones' | 'skipped:not_configured'

// Hard cap on per-scan Twilio lookups. At ~$0.04/lookup this caps Twilio
// spend at ~₹17 per scan (10 × ₹1.65 ≈ ₹16.50). Numbers beyond the cap are
// reported as "not checked" so the owner sees what was skipped — never
// silently dropped.
const MAX_PHONE_LOOKUPS_PER_SCAN = 10

/**
 * Runs Phase 2 deep-scan checks. Each check that lands here is a real
 * detector; checks not yet implemented are explicitly marked 'skipped'
 * in `phase2_result.checks` so the rendered report (and the admin
 * panel) can be honest about what was actually run.
 *
 * Currently implemented:
 *   ✓ Twilio Lookup — phone number verification (mobile/landline/voip/active)
 *
 * Not yet implemented (sub-tasks 4+):
 *   - Link checker (200/301/404/500 across all internal + external)
 *   - SSL certificate (expiry, chain validity)
 *   - Lorem ipsum / placeholder text detection
 *   - Old image detection (Last-Modified > 3 years)
 *   - Workflow + UX audit (forms, CTAs, dead-ends)
 *   - Trust signals (NAP match, social profiles)
 *   - Email identity check (Standard tier — owner email vs site domain)
 *
 * Invocation: this orchestrator runs inside `/api/scan/phase2/worker`,
 * which is POSTed to by QStash with a signed payload published from
 * `/api/scan/phase2/trigger`. The worker route carries `maxDuration=300`
 * to fit the long tail (Twilio + 3 Claude calls + Maps).
 */
async function runChecks(scan: ScanRow): Promise<ChecksOutput> {
  const generatedAt = new Date().toISOString()
  const allPhones = scan.phase1_result?.homepage?.phones ?? []
  // Apply the per-scan cost cap. Excess phones are reported below as a
  // single "not checked" warning so the owner knows what was skipped.
  const phones = allPhones.slice(0, MAX_PHONE_LOOKUPS_PER_SCAN)
  const phonesSkipped = Math.max(0, allPhones.length - phones.length)
  const issues: Issue[] = []

  // ─── Twilio Lookup ───────────────────────────────────────────────────
  let twilioOutcome: CheckOutcome = 'completed'
  let phoneResults: PhoneLookupResult[] = []

  if (!hasTwilioCredentials()) {
    twilioOutcome = 'skipped:not_configured'
  } else if (phones.length === 0) {
    twilioOutcome = 'skipped:no_phones'
  } else {
    phoneResults = await lookupPhones(phones)
    issues.push(...buildPhoneIssues(phoneResults))
  }

  if (phonesSkipped > 0) {
    issues.push({
      category: 'contact',
      item: 'phone_lookup_cap',
      status: 'warning',
      detail: `Your homepage lists ${allPhones.length} phone numbers. We verified the first ${phones.length} and did not check the remaining ${phonesSkipped} to keep the scan affordable.`,
      priority: 'low',
      effort: 'low',
      action:
        'If a number not shown above is your main contact line, move it higher on the page or list fewer numbers — many numbers also confuse customers about which one to call.',
    })
  }

  // ─── Link Checker ────────────────────────────────────────────────────
  // Phase 1 collected up to 250 same-host internal links from the homepage
  // (extractor's HOMEPAGE_LINK_CAP). links.ts caps at 200 unique URLs per
  // scan and emits a 'link_check_capped' technical warning if more were
  // found — same shape as the Twilio cost-cap finding above.
  const internalLinks = scan.phase1_result?.homepage?.internalLinks ?? []
  let linkOutcome: 'completed' | 'skipped:no_links' = 'completed'
  let linkResults: LinkCheckResult[] = []
  let linksCapped = 0
  if (internalLinks.length === 0) {
    linkOutcome = 'skipped:no_links'
  } else {
    const linkCheck = await checkLinks(internalLinks)
    linkResults = linkCheck.results
    linksCapped = linkCheck.capped
    issues.push(...buildLinkIssues(linkResults, linksCapped))
  }

  // ─── SSL Certificate ─────────────────────────────────────────────────
  // Two paths:
  //   1. Phase 1 already determined the site is HTTP-only
  //      (basicValid === false) → skip the TLS handshake and emit the
  //      "no SSL" finding directly. No point opening a socket to confirm.
  //   2. Otherwise, hit <hostname>:443 with `tls.connect`, inspect the
  //      cert, translate to issue(s) via buildSslIssues.
  //
  // The hostname comes from `phase1_result.finalUrl` (post-redirect)
  // because that's the canonical URL the rest of the pipeline scanned —
  // a user who entered http:// but redirected to https:// gets the
  // https:// host checked, not the original input.
  let sslOutcome: 'completed' | 'skipped:no_ssl' | 'skipped:not_configured' =
    'completed'
  let sslResult: SslCheckResult | null = null

  if (scan.phase1_result?.ssl?.basicValid === false) {
    issues.push(buildNoSslIssue())
    sslOutcome = 'skipped:no_ssl'
  } else {
    let hostname = ''
    try {
      hostname = new URL(scan.phase1_result?.finalUrl ?? scan.url).hostname
    } catch {
      hostname = ''
    }
    if (!hostname) {
      sslOutcome = 'skipped:not_configured'
    } else {
      sslResult = await checkSsl(hostname)
      issues.push(...buildSslIssues(sslResult))
    }
  }

  // ─── Content checks (placeholder text + thin content) ───────────────
  // CLAUDE.md rule 19 + 20: lorem ipsum scan runs on every crawled page,
  // not just the homepage. Capped at 20 pages per scan; runContentChecks
  // dedups + prioritises (homepage first, then sitemap, then internal
  // links by appearance order).
  const homepageUrl = scan.phase1_result?.finalUrl ?? scan.url
  const sampleUrls = scan.phase1_result?.pageCount?.sampleUrls ?? []
  const contentInternalLinks = scan.phase1_result?.homepage?.internalLinks ?? []
  let contentOutput: ContentChecksOutput | null = null
  let contentOutcome: 'completed' | 'skipped:no_pages' = 'completed'
  if (!homepageUrl) {
    contentOutcome = 'skipped:no_pages'
  } else {
    contentOutput = await runContentChecks({
      homepageUrl,
      sampleUrls,
      internalLinks: contentInternalLinks,
    })
    issues.push(...contentOutput.issues)
  }

  // ─── Image age (homepage only, HEAD requests) ───────────────────────
  // CLAUDE.md rule 18: HEAD only, never download the image. We read the
  // Last-Modified header to compute age; CDNs that strip it return
  // `no_last_modified` and are silently dropped (not actionable).
  const homepageImages = scan.phase1_result?.homepage?.images ?? []
  let imagesOutput: ImagesChecksOutput | null = null
  let imagesOutcome: 'completed' | 'skipped:no_images' = 'completed'
  if (homepageImages.length === 0) {
    imagesOutcome = 'skipped:no_images'
  } else {
    imagesOutput = await checkImages(homepageImages)
    issues.push(...buildImageIssues(imagesOutput))
  }

  // ─── UI quality (homepage only) ──────────────────────────────────────
  // SPEC §20 Vitamin Pack — surface-level visual checks. Runs on the
  // homepage only; the homepage is where new visitors land and where
  // CTA / nav / h1 problems matter most. TODO v1.1: extend to crawl
  // pages once the per-scan page cache lands (see workflow.ts TODO).
  let uiOutput: UiChecksOutput | null = null
  let uiOutcome: 'completed' | 'skipped:no_homepage' = 'completed'
  if (!homepageUrl) {
    uiOutcome = 'skipped:no_homepage'
  } else {
    uiOutput = await runUiChecks(homepageUrl)
    issues.push(...uiOutput.issues)
  }

  // ─── Workflow audit (every crawled page) ─────────────────────────────
  // CLAUDE.md rule 24: HTML workflow checks run on ALL crawled pages.
  // No AI cost, no external API — pure cheerio parsing. Same crawl page
  // set as content.ts (homepage + sample + top internal links, capped
  // at 20). TODO v1.1: collapse into shared per-scan page cache.
  let workflowOutput: WorkflowChecksOutput | null = null
  let workflowOutcome: 'completed' | 'skipped:no_pages' = 'completed'
  if (!homepageUrl) {
    workflowOutcome = 'skipped:no_pages'
  } else {
    workflowOutput = await runWorkflowChecks({
      homepageUrl,
      sampleUrls,
      internalLinks: contentInternalLinks,
    })
    issues.push(...workflowOutput.issues)
  }

  // ─── UX audit (Claude, max 5 pages per CLAUDE.md rule 23) ───────────
  // Runs AFTER the HTML-only workflow check so its findings are
  // additive — workflow.ts catches the structural failures (form has
  // no action, upload has no rules), uxAudit catches the experiential
  // failures (page describes a process but provides no mechanism, the
  // primary task is not completable from what's visible). Different
  // checks, different costs — workflow is free cheerio parsing,
  // uxAudit is one Sonnet call per page.
  //
  // Must run BEFORE the main Claude report so its issues feed into
  // the summary + solution_map.
  let uxAuditOutput: UxAuditOutput | null = null
  let uxAuditOutcome: 'completed' | 'skipped:no_pages' = 'completed'
  if (!homepageUrl) {
    uxAuditOutcome = 'skipped:no_pages'
  } else {
    uxAuditOutput = await runUxAuditAcrossPages({
      homepageUrl,
      sampleUrls,
      internalLinks: contentInternalLinks,
      intake: null, // owner_intake table is v1.1 — wire when it lands
    })
    issues.push(...uxAuditOutput.issues)
  }

  // ─── Health score (rough, until Claude scoring lands) ────────────────
  // -10 per fail, -5 per warning, capped 0..100. This is a placeholder
  // until the Claude report-generation prompt produces a real score.
  let healthScore = 100
  for (const i of issues) {
    if (i.status === 'fail') healthScore -= 10
    if (i.status === 'warning') healthScore -= 5
  }
  healthScore = Math.max(0, Math.min(100, healthScore))

  // ─── Build the user-facing summary ───────────────────────────────────
  const summary = buildSummary({
    phonesChecked: phoneResults.length,
    issues,
    twilioOutcome,
  })

  return {
    health_score: healthScore,
    issues,
    report_json: {
      health_score: healthScore,
      summary,
      issues,
      solution_map: [],
      generated_at: generatedAt,
    },
    phase2_result: {
      mode: 'partial',
      generated_at: generatedAt,
      url: scan.url,
      url_normalized: scan.url_normalized,
      tier: scan.tier,
      page_count: scan.page_count,
      checks: {
        twilio_lookup:
          twilioOutcome === 'completed'
            ? {
                status: 'completed',
                numbers_found: allPhones.length,
                numbers_checked: phoneResults.length,
                numbers_skipped_cap: phonesSkipped,
                results: phoneResults,
              }
            : twilioOutcome,
        link_checker:
          linkOutcome === 'completed'
            ? {
                status: 'completed',
                links_found: internalLinks.length,
                links_checked: linkResults.length,
                links_skipped_cap: linksCapped,
                broken_count: linkResults.filter((r) => !r.ok).length,
              }
            : linkOutcome,
        ssl_certificate:
          sslOutcome === 'completed'
            ? {
                status: 'completed',
                cert: sslResult && sslResult.ok ? sslResult.cert : null,
                reason:
                  sslResult && !sslResult.ok ? sslResult.reason : null,
              }
            : sslOutcome,
        content_scan:
          contentOutcome === 'completed' && contentOutput
            ? {
                status: 'completed',
                pages_attempted: contentOutput.pages_attempted,
                pages_fetched: contentOutput.pages_fetched,
                pages_failed: contentOutput.pages_failed,
                placeholder_findings: contentOutput.placeholder_findings,
                thin_content_findings: contentOutput.thin_content_findings,
              }
            : contentOutcome,
        image_age:
          imagesOutcome === 'completed' && imagesOutput
            ? {
                status: 'completed',
                images_found: imagesOutput.images_found,
                images_checked: imagesOutput.images_checked,
                images_skipped_cap: imagesOutput.images_skipped_cap,
                images_with_no_header: imagesOutput.images_with_no_header,
                old_image_count: imagesOutput.old_images.length,
              }
            : imagesOutcome,
        ui_quality:
          uiOutcome === 'completed' && uiOutput
            ? {
                status: 'completed',
                fetched: uiOutput.fetched,
                finding_count: uiOutput.finding_count,
              }
            : uiOutcome,
        workflow_audit:
          workflowOutcome === 'completed' && workflowOutput
            ? {
                status: 'completed',
                pages_attempted: workflowOutput.pages_attempted,
                pages_fetched: workflowOutput.pages_fetched,
                pages_failed: workflowOutput.pages_failed,
                finding_count: workflowOutput.finding_count,
                cta_collected: workflowOutput.cta_collected,
              }
            : workflowOutcome,
        ux_audit:
          uxAuditOutcome === 'completed' && uxAuditOutput
            ? {
                status: 'completed',
                pages_attempted: uxAuditOutput.pages_attempted,
                pages_audited: uxAuditOutput.pages_audited,
                pages_skipped_empty: uxAuditOutput.pages_skipped_empty,
                pages_failed: uxAuditOutput.pages_failed,
                finding_count: uxAuditOutput.finding_count,
              }
            : uxAuditOutcome,
        trust_signals: 'skipped',
        email_identity: 'skipped',
      },
    },
  }
}

// Twilio Lookup v2 returns line types in camelCase per their docs:
// mobile | landline | fixedVoip | nonFixedVoip | tollFree | personal |
// premium | sharedCost | uan | voicemail | pager.
// We translate to plain-English labels for the report and group them
// into reachability buckets for issue translation.

function isVoipLineType(t: string | null): boolean {
  return t === 'fixedVoip' || t === 'nonFixedVoip'
}

function isUnreachableLineType(t: string | null): boolean {
  // Voicemail = reaches a recording. Pager = legacy paging service.
  // Either one means a customer dialing the listed number does not
  // reach a person — same business impact as a dead number.
  return t === 'voicemail' || t === 'pager'
}

function lineTypeLabel(t: string | null): string {
  switch (t) {
    case 'mobile':
      return 'mobile'
    case 'landline':
      return 'landline'
    case 'fixedVoip':
    case 'nonFixedVoip':
      return 'VoIP'
    case 'tollFree':
      return 'toll-free'
    case 'voicemail':
      return 'voicemail'
    case 'pager':
      return 'pager'
    case 'personal':
      return 'personal'
    case 'premium':
      return 'premium-rate'
    case 'sharedCost':
      return 'shared-cost'
    case 'uan':
      return 'UAN'
    default:
      return ''
  }
}

/**
 * Translate Twilio Lookup results into user-facing issues.
 * One issue per unique phone number.
 *
 * Status mapping:
 *   - valid + mobile/landline/tollFree/etc → ok
 *   - valid + fixedVoip / nonFixedVoip     → warning (less trust for businesses)
 *   - valid + voicemail / pager            → fail (no human reaches the customer)
 *   - !valid                               → fail (dead number)
 *   - lookup_failed / invalid_format       → warning (couldn't verify, retry)
 *   - not_configured                       → handled at orchestrator level (skipped, no issue)
 */
function buildPhoneIssues(results: PhoneLookupResult[]): Issue[] {
  const issues: Issue[] = []

  for (const r of results) {
    if (!r.ok) {
      // not_configured is handled at orchestrator level (whole check skipped)
      // — only lookup_failed and invalid_format reach this branch.
      if (r.reason === 'not_configured') continue

      issues.push({
        category: 'contact',
        item: r.phone,
        status: 'warning',
        detail:
          'We could not verify this number with our phone-checker. It may still work — but we recommend confirming.',
        priority: 'medium',
        effort: 'low',
        action:
          'Confirm the number is correct on your website. If it is, no action needed.',
      })
      continue
    }

    if (!r.valid) {
      issues.push({
        category: 'contact',
        item: r.phone,
        status: 'fail',
        detail:
          'This phone number is not active. Customers calling this number cannot reach your business.',
        priority: 'high',
        effort: 'low',
        action:
          'Update the number on your website to one that is in service today.',
      })
      continue
    }

    if (isUnreachableLineType(r.line_type)) {
      const label = lineTypeLabel(r.line_type) || 'this type of'
      issues.push({
        category: 'contact',
        item: r.phone,
        status: 'fail',
        detail: `This number connects to ${label} — customers calling it do not reach a person at your business.`,
        priority: 'high',
        effort: 'low',
        action:
          'Replace this number with a mobile or landline that a person actually answers.',
      })
      continue
    }

    if (isVoipLineType(r.line_type)) {
      issues.push({
        category: 'contact',
        item: r.phone,
        status: 'warning',
        detail:
          'This is a VoIP number. Some customers do not trust virtual numbers for businesses.',
        priority: 'medium',
        effort: 'medium',
        action:
          'Consider listing a mobile or landline number alongside the VoIP number.',
      })
      continue
    }

    // Active mobile / landline / tollFree / personal / etc.
    const label = lineTypeLabel(r.line_type)
    issues.push({
      category: 'contact',
      item: r.phone,
      status: 'ok',
      detail: label
        ? `Active ${label} number — verified.`
        : 'Active phone number — verified.',
      priority: 'low',
      effort: 'low',
      action: 'No action needed.',
    })
  }

  return issues
}

function buildSummary(args: {
  phonesChecked: number
  issues: Issue[]
  twilioOutcome: CheckOutcome
}): string {
  const fails = args.issues.filter((i) => i.status === 'fail').length
  const warnings = args.issues.filter((i) => i.status === 'warning').length

  if (args.twilioOutcome === 'skipped:not_configured') {
    return 'Initial deep scan complete. Phone verification was not configured on this server — other checks will land in upcoming releases.'
  }
  if (args.twilioOutcome === 'skipped:no_phones') {
    return 'Initial deep scan complete. No phone numbers found on the homepage to verify.'
  }
  if (fails === 0 && warnings === 0) {
    return `Phone verification complete. All ${args.phonesChecked} ${args.phonesChecked === 1 ? 'number' : 'numbers'} verified active.`
  }
  const parts: string[] = []
  if (fails > 0) parts.push(`${fails} broken`)
  if (warnings > 0) parts.push(`${warnings} to review`)
  return `Phone verification complete — ${args.phonesChecked} checked, ${parts.join(' and ')}.`
}
