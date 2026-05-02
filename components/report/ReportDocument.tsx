import {
  Document,
  Image as PdfImage,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import fs from 'node:fs'
import path from 'node:path'
import { formatIssueTitle } from '@/lib/report/formatTitle'
import type { Issue } from '@/lib/scan/phase2'

// ─── White-label hook (v1.1) ──────────────────────────────────────────
//
// TODO v1.1: agency white-label
// replace header with agency_name + agency_logo
// keep "Powered by fixmysite.in" in footer
// triggered by developer_partners.plan = 'agency'

// ─── Font registration ───────────────────────────────────────────────
// See lib/pdf/registerBrandFont for why we bundle the TTF locally
// instead of fetching from the @fontsource CDN.

import { registerBrandFont } from '@/lib/pdf/registerBrandFont'

registerBrandFont('report-pdf')

// ─── Logo (module-load, once per cold start) ──────────────────────────
//
// Read the cat-mark PNG into a Buffer once. If the file is missing
// (deployment artifact issue, etc.) we render a text wordmark instead.
// PDF generation must never fail because an asset is unavailable.

let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(
    path.join(process.cwd(), 'public', 'brand', 'logo-mark.png'),
  )
} catch (err) {
  console.warn(
    '[pdf] logo-mark.png not found — header will fall back to text',
    err instanceof Error ? err.message : err,
  )
}

// ─── Brand palette ────────────────────────────────────────────────────

const COLOR = {
  brand: '#0F6E56',
  brandLight: '#1D9E75',
  surface: '#E1F5EE',
  orange: '#E87C28',
  amber: '#EF9F27',
  black: '#1A1A1A',
  grey700: '#374151',
  grey600: '#4B5563',
  grey400: '#9CA3AF',
  grey200: '#E5E7EB',
  grey100: '#F5F5F5',
  white: '#FFFFFF',
} as const

// ─── Public types ─────────────────────────────────────────────────────

export type ReportPdfScan = {
  id: string
  url: string
  health_score: number | null
  completed_at: string | null
  page_count: number | null
  tier: string | null
  report_json: {
    summary?: string
    solution_map?: Array<{
      order: number
      title: string
      body: string
      priority: 'high' | 'medium' | 'low'
      effort: 'low' | 'medium' | 'high'
    }>
  } | null
}

export type ReportDocumentProps = {
  scan: ReportPdfScan
  issues: Issue[]
  // Caller passes 'Helvetica' on retry after Plus Jakarta fails to fetch.
  fontFamily?: 'Plus Jakarta Sans' | 'Helvetica'
}

// ─── Stylesheet (computed lazily so fontFamily prop can override) ─────

function buildStyles(fontFamily: string) {
  return StyleSheet.create({
    page: {
      paddingTop: 56,
      paddingBottom: 64,
      paddingHorizontal: 48,
      fontFamily,
      fontSize: 10.5,
      color: COLOR.black,
      lineHeight: 1.5,
    },
    // ─── Header (every page) ─────────────────────────────────────────
    header: {
      position: 'absolute',
      top: 24,
      left: 48,
      right: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderBottom: `0.5pt solid ${COLOR.grey200}`,
      paddingBottom: 12,
    },
    headerLogo: {
      height: 22,
      width: 30,
      objectFit: 'contain',
    },
    headerWordmark: {
      fontSize: 13,
      fontWeight: 600,
      color: COLOR.brand,
      letterSpacing: 0.4,
    },
    // ─── Title block (page 1) ────────────────────────────────────────
    titleBlock: {
      marginBottom: 18,
    },
    title: {
      fontSize: 22,
      fontWeight: 600,
      color: COLOR.black,
      marginBottom: 4,
    },
    titleMeta: {
      fontSize: 10,
      color: COLOR.grey600,
    },
    // ─── Summary card ────────────────────────────────────────────────
    summaryCard: {
      backgroundColor: COLOR.surface,
      borderRadius: 8,
      padding: 16,
      marginBottom: 20,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
    },
    scoreLabel: {
      fontSize: 8.5,
      color: COLOR.grey600,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    scoreValue: {
      fontSize: 36,
      fontWeight: 600,
      color: COLOR.brand,
      lineHeight: 1.1,
    },
    scoreOutOf: {
      fontSize: 14,
      color: COLOR.grey400,
      fontWeight: 400,
    },
    summaryText: {
      flex: 1,
      fontSize: 11,
      color: COLOR.grey700,
      lineHeight: 1.5,
    },
    countsRow: {
      marginTop: 14,
      paddingTop: 12,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
      flexDirection: 'row',
      gap: 16,
      fontSize: 10,
      color: COLOR.grey600,
    },
    countNumber: {
      fontWeight: 600,
    },
    // ─── Section heading ─────────────────────────────────────────────
    sectionTitle: {
      fontSize: 13,
      fontWeight: 600,
      color: COLOR.black,
      marginTop: 16,
      marginBottom: 8,
      paddingTop: 8,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
    },
    sectionSubtitle: {
      fontSize: 9.5,
      color: COLOR.grey600,
      fontWeight: 400,
    },
    // ─── Issue card ──────────────────────────────────────────────────
    issueCard: {
      backgroundColor: COLOR.grey100,
      borderRadius: 6,
      padding: 11,
      marginBottom: 8,
    },
    issueRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      marginTop: 5,
    },
    issueBody: {
      flex: 1,
    },
    issueTitle: {
      fontSize: 11,
      fontWeight: 600,
      color: COLOR.black,
    },
    issueSubtitle: {
      fontSize: 9,
      color: COLOR.grey600,
      marginTop: 1,
    },
    issueDetail: {
      fontSize: 10,
      color: COLOR.grey700,
      marginTop: 4,
    },
    issueAction: {
      fontSize: 10,
      color: COLOR.black,
      marginTop: 4,
    },
    issueActionLabel: {
      fontWeight: 600,
    },
    badgesRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 6,
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      fontSize: 8,
      fontWeight: 600,
    },
    badgePriorityHigh: { backgroundColor: COLOR.orange, color: COLOR.white },
    badgePriorityMedium: { backgroundColor: COLOR.amber, color: COLOR.white },
    badgePriorityLow: { backgroundColor: COLOR.brand, color: COLOR.white },
    badgeEffort: {
      backgroundColor: COLOR.grey100,
      color: COLOR.grey700,
      fontWeight: 400,
      borderRadius: 8,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
      borderBottom: `0.5pt solid ${COLOR.grey200}`,
      borderLeft: `0.5pt solid ${COLOR.grey200}`,
      borderRight: `0.5pt solid ${COLOR.grey200}`,
    },
    // ─── Solution map ────────────────────────────────────────────────
    solutionItem: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 10,
    },
    solutionNumber: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: COLOR.black,
      color: COLOR.white,
      fontSize: 9,
      fontWeight: 600,
      textAlign: 'center',
      paddingTop: 3,
    },
    solutionBody: { flex: 1 },
    solutionTitle: {
      fontSize: 11,
      fontWeight: 600,
      color: COLOR.black,
    },
    solutionText: {
      fontSize: 10,
      color: COLOR.grey700,
      marginTop: 3,
    },
    // ─── Footer (every page) ─────────────────────────────────────────
    footer: {
      position: 'absolute',
      bottom: 24,
      left: 48,
      right: 48,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
      paddingTop: 8,
    },
    footerLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    // Explicit text style for footer-row children. React-PDF doesn't
    // reliably cascade fontSize/color from a parent View to child Text
    // (only some style props inherit; behaviour varies by version), so
    // we set them on the Text directly. Without this the row renders at
    // 0pt and looks invisible.
    footerLineText: {
      fontSize: 8.5,
      color: COLOR.grey600,
    },
    footerTagline: {
      fontSize: 7.5,
      color: COLOR.grey400,
      marginTop: 2,
      fontStyle: 'italic',
    },
    emptySection: {
      fontSize: 10,
      color: COLOR.grey400,
      fontStyle: 'italic',
    },
  })
}

// ─── Status colour helper ─────────────────────────────────────────────

function statusDotColor(status: Issue['status']): string {
  if (status === 'fail') return COLOR.orange
  if (status === 'warning') return COLOR.amber
  return COLOR.brandLight
}

function priorityBadgeStyle(p: Issue['priority']) {
  if (p === 'high') return { bg: COLOR.orange, label: 'High priority' }
  if (p === 'medium') return { bg: COLOR.amber, label: 'Medium priority' }
  return { bg: COLOR.brand, label: 'Low priority' }
}

function effortLabel(e: Issue['effort']): string {
  return e === 'low' ? 'Low effort' : e === 'medium' ? 'Medium effort' : 'High effort'
}

// ─── Category section labels ──────────────────────────────────────────

const CATEGORY_TITLES: Record<Issue['category'], string> = {
  contact: 'Contact verification',
  links: 'Links & pages',
  trust: 'Trust signals',
  content: 'Content quality',
  visual: 'Visual & UI',
  workflow: 'Workflow & UX',
  technical: 'Technical health',
}

const CATEGORY_ORDER: Issue['category'][] = [
  'contact',
  'links',
  'trust',
  'content',
  'visual',
  'workflow',
  'technical',
]

// ─── Document ─────────────────────────────────────────────────────────

export function ReportDocument({
  scan,
  issues,
  fontFamily = 'Plus Jakarta Sans',
}: ReportDocumentProps) {
  const styles = buildStyles(fontFamily)
  const summary = scan.report_json?.summary ?? ''
  const solutionMap = scan.report_json?.solution_map ?? []

  const fails = issues.filter((i) => i.status === 'fail').length
  const warnings = issues.filter((i) => i.status === 'warning').length
  const oks = issues.filter((i) => i.status === 'ok').length

  const completedDate = scan.completed_at ? formatDate(scan.completed_at) : '—'
  const displayHost = resolveDisplayHost(scan.url)

  return (
    <Document
      title={`fixmysite.in report — ${displayHost}`}
      author="fixmysite.in"
      subject="Website health report"
      creator="fixmysite.in"
      producer="fixmysite.in"
    >
      <Page size="A4" style={styles.page}>
        <Header styles={styles} />

        {/* ─── Title + meta ───────────────────────────────────── */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Website health report</Text>
          <Text style={styles.titleMeta}>
            {scan.url}  ·  Completed {completedDate}
            {scan.page_count ? `  ·  ${scan.page_count} pages scanned` : ''}
          </Text>
        </View>

        {/* ─── Summary card ───────────────────────────────────── */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View>
              <Text style={styles.scoreLabel}>Health score</Text>
              <Text style={styles.scoreValue}>
                {scan.health_score ?? '—'}
                <Text style={styles.scoreOutOf}> / 100</Text>
              </Text>
            </View>
            {summary ? (
              <Text style={styles.summaryText}>{summary}</Text>
            ) : null}
          </View>
          <View style={styles.countsRow}>
            <Text>
              <Text style={[styles.countNumber, { color: COLOR.orange }]}>
                {fails}
              </Text>
              {' '}critical
            </Text>
            <Text>
              <Text style={[styles.countNumber, { color: COLOR.amber }]}>
                {warnings}
              </Text>
              {' '}warnings
            </Text>
            <Text>
              <Text style={[styles.countNumber, { color: COLOR.brandLight }]}>
                {oks}
              </Text>
              {' '}verified
            </Text>
          </View>
        </View>

        {/* ─── Per-category issue sections ────────────────────── */}
        {CATEGORY_ORDER.map((category) => {
          const sectionIssues = issues.filter((i) => i.category === category)
          if (sectionIssues.length === 0) return null
          return (
            <CategorySection
              key={category}
              title={CATEGORY_TITLES[category]}
              issues={sectionIssues}
              styles={styles}
            />
          )
        })}

        {/* ─── Solution map ───────────────────────────────────── */}
        {solutionMap.length > 0 && (
          <SolutionMapSection
            steps={solutionMap}
            styles={styles}
          />
        )}

        <Footer scanId={scan.id} styles={styles} />
      </Page>
    </Document>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────

type Styles = ReturnType<typeof buildStyles>

function Header({ styles }: { styles: Styles }) {
  return (
    <View style={styles.header} fixed>
      {LOGO_BUFFER ? (
        <PdfImage src={LOGO_BUFFER} style={styles.headerLogo} />
      ) : null}
      <Text style={styles.headerWordmark}>FIXMYSITE.IN</Text>
    </View>
  )
}

function Footer({ scanId, styles }: { scanId: string; styles: Styles }) {
  return (
    <View style={styles.footer} fixed>
      <View style={styles.footerLine}>
        <Text style={styles.footerLineText}>fixmysite.in</Text>
        <Text style={styles.footerLineText}>Scan reference: {scanId}</Text>
        <Text
          style={styles.footerLineText}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
        />
      </View>
      <Text style={styles.footerTagline}>
        Your website, finally well-behaved.
      </Text>
    </View>
  )
}

function CategorySection({
  title,
  issues,
  styles,
}: {
  title: string
  issues: Issue[]
  styles: Styles
}) {
  const problemCount = issues.filter((i) => i.status !== 'ok').length
  return (
    <View wrap={false}>
      <Text style={styles.sectionTitle}>
        {title}
        <Text style={styles.sectionSubtitle}>
          {' — '}
          {problemCount > 0
            ? `${problemCount} ${problemCount === 1 ? 'issue' : 'issues'}`
            : 'all clear'}
        </Text>
      </Text>
      {issues.map((issue, idx) => (
        <IssueCard key={`${issue.item}-${idx}`} issue={issue} styles={styles} />
      ))}
    </View>
  )
}

function IssueCard({ issue, styles }: { issue: Issue; styles: Styles }) {
  const { title, subtitle } = formatIssueTitle(issue.item)
  const showAction = issue.action && issue.status !== 'ok'
  const showBadges = issue.status !== 'ok'
  const priority = priorityBadgeStyle(issue.priority)

  return (
    <View style={styles.issueCard} wrap={false}>
      <View style={styles.issueRow}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: statusDotColor(issue.status) },
          ]}
        />
        <View style={styles.issueBody}>
          <Text style={styles.issueTitle}>{title}</Text>
          {subtitle ? (
            <Text style={styles.issueSubtitle}>{subtitle}</Text>
          ) : null}
          <Text style={styles.issueDetail}>{issue.detail}</Text>
          {showAction ? (
            <Text style={styles.issueAction}>
              <Text style={styles.issueActionLabel}>What to do: </Text>
              {issue.action}
            </Text>
          ) : null}
          {showBadges ? (
            <View style={styles.badgesRow}>
              <Text
                style={[
                  styles.badge,
                  { backgroundColor: priority.bg, color: COLOR.white },
                ]}
              >
                {priority.label}
              </Text>
              <Text style={[styles.badge, styles.badgeEffort]}>
                {effortLabel(issue.effort)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}

function SolutionMapSection({
  steps,
  styles,
}: {
  steps: NonNullable<ReportPdfScan['report_json']>['solution_map'] extends
    | infer T
    | undefined
    ? T extends ReadonlyArray<infer U>
      ? U[]
      : never
    : never
  styles: Styles
}) {
  return (
    <View>
      <Text style={styles.sectionTitle}>
        Solution map
        <Text style={styles.sectionSubtitle}> — fix these in order</Text>
      </Text>
      {steps.map((step, idx) => {
        const priority = priorityBadgeStyle(step.priority)
        return (
          <View
            key={`solution-${idx}`}
            style={styles.solutionItem}
            wrap={false}
          >
            <Text style={styles.solutionNumber}>{step.order || idx + 1}</Text>
            <View style={styles.solutionBody}>
              <Text style={styles.solutionTitle}>{step.title}</Text>
              <Text style={styles.solutionText}>{step.body}</Text>
              <View style={styles.badgesRow}>
                <Text
                  style={[
                    styles.badge,
                    { backgroundColor: priority.bg, color: COLOR.white },
                  ]}
                >
                  {priority.label}
                </Text>
                <Text style={[styles.badge, styles.badgeEffort]}>
                  {effortLabel(step.effort)}
                </Text>
              </View>
            </View>
          </View>
        )
      })}
    </View>
  )
}

// ─── Pure helpers ─────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function resolveDisplayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
