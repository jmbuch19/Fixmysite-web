import {
  Document,
  Font,
  Image as PdfImage,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import fs from 'node:fs'
import path from 'node:path'
import type { BriefOutput, BriefSection } from '@/lib/claude/brief'

// ─── White-label hook (v1.1) ──────────────────────────────────────────
// TODO v1.1: agency white-label
// replace header with agency_name + agency_logo
// keep "Powered by fixmysite.in" in footer
// triggered by developer_partners.plan = 'agency'

// ─── Font registration (mirrors ReportDocument exactly) ──────────────

const PJS_400 =
  'https://cdn.jsdelivr.net/npm/@fontsource/plus-jakarta-sans@5.0.0/files/plus-jakarta-sans-latin-400-normal.ttf'
const PJS_600 =
  'https://cdn.jsdelivr.net/npm/@fontsource/plus-jakarta-sans@5.0.0/files/plus-jakarta-sans-latin-600-normal.ttf'

try {
  Font.register({
    family: 'Plus Jakarta Sans',
    fonts: [
      { src: PJS_400, fontWeight: 400 },
      { src: PJS_600, fontWeight: 600 },
    ],
  })
} catch (err) {
  console.warn(
    '[brief-pdf] Plus Jakarta Sans registration failed — Helvetica will be used',
    err instanceof Error ? err.message : err,
  )
}

// ─── Logo (module-load) ───────────────────────────────────────────────

let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(
    path.join(process.cwd(), 'public', 'brand', 'logo-mark.png'),
  )
} catch (err) {
  console.warn(
    '[brief-pdf] logo-mark.png not found — header will fall back to text',
    err instanceof Error ? err.message : err,
  )
}

// ─── Brand palette (matches ReportDocument exactly) ──────────────────

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

export type BriefPdfMeta = {
  hostname: string         // e.g. "drgauravchhaya.com"
  scanUrl: string          // full URL e.g. "https://www.drgauravchhaya.com"
  briefId: string
  paidAt: string | null    // ISO timestamp, null falls back to "today"
  hasScreenshots: boolean  // for the v1.1 with_screenshots tier
}

export type BriefDocumentProps = {
  brief: BriefOutput
  meta: BriefPdfMeta
  // Caller passes 'Helvetica' on retry after Plus Jakarta fails to fetch.
  fontFamily?: 'Plus Jakarta Sans' | 'Helvetica'
}

// ─── Stylesheet ───────────────────────────────────────────────────────

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
    // Header
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
    headerLogo: { height: 22, width: 30, objectFit: 'contain' },
    headerWordmark: {
      fontSize: 13,
      fontWeight: 600,
      color: COLOR.brand,
      letterSpacing: 0.4,
    },
    // Title block (page 1)
    titleBlock: { marginBottom: 16 },
    title: {
      fontSize: 22,
      fontWeight: 600,
      color: COLOR.black,
      marginBottom: 6,
    },
    subHeaderRow: {
      fontSize: 9.5,
      color: COLOR.grey600,
      marginTop: 2,
    },
    subHeaderLabel: {
      fontWeight: 600,
      color: COLOR.grey700,
    },
    // Intent Summary card (teal callout) — page 1 only
    intentCard: {
      backgroundColor: COLOR.surface,
      borderLeft: `3pt solid ${COLOR.brand}`,
      borderRadius: 6,
      padding: 14,
      marginBottom: 18,
    },
    intentLabel: {
      fontSize: 8.5,
      color: COLOR.brand,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      fontWeight: 600,
      marginBottom: 4,
    },
    intentBody: {
      fontSize: 11,
      color: COLOR.black,
      lineHeight: 1.5,
    },
    // Owner verbatim quote within intent card
    ownerQuoteContainer: {
      marginTop: 12,
      paddingTop: 12,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
    },
    ownerQuoteLabel: {
      fontSize: 8.5,
      color: COLOR.grey600,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    ownerQuoteText: {
      fontSize: 10.5,
      color: COLOR.grey700,
      fontStyle: 'italic',
    },
    // Section header (work items)
    sectionsTitle: {
      fontSize: 13,
      fontWeight: 600,
      color: COLOR.black,
      marginTop: 8,
      marginBottom: 10,
      paddingTop: 8,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
    },
    // Work item card
    workItem: {
      backgroundColor: COLOR.grey100,
      borderRadius: 6,
      padding: 12,
      marginBottom: 10,
    },
    workItemTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    workItemNumber: {
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
    workItemBody: { flex: 1 },
    workItemTitle: {
      fontSize: 11.5,
      fontWeight: 600,
      color: COLOR.black,
    },
    badgesRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 5,
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      fontSize: 8,
      fontWeight: 600,
    },
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
    // Owner-words callout inside each work item
    ownerCallout: {
      marginTop: 10,
      paddingLeft: 10,
      borderLeft: `2pt solid ${COLOR.brand}`,
      backgroundColor: 'transparent',
    },
    ownerCalloutLabel: {
      fontSize: 8,
      color: COLOR.brand,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      fontWeight: 600,
    },
    ownerCalloutText: {
      fontSize: 10,
      color: COLOR.grey700,
      fontStyle: 'italic',
      marginTop: 2,
    },
    // Technical brief paragraph
    techLabel: {
      fontSize: 8.5,
      color: COLOR.grey600,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      fontWeight: 600,
      marginTop: 10,
    },
    techBody: {
      fontSize: 10,
      color: COLOR.grey700,
      marginTop: 3,
      lineHeight: 1.55,
    },
    // Recommendations + not-in-scope sections
    listSectionTitle: {
      fontSize: 13,
      fontWeight: 600,
      color: COLOR.black,
      marginTop: 18,
      marginBottom: 8,
      paddingTop: 8,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
    },
    listSectionHelp: {
      fontSize: 9.5,
      color: COLOR.grey600,
      marginBottom: 8,
    },
    listItem: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 6,
    },
    listMarker: {
      width: 10,
      fontSize: 10,
    },
    listBody: {
      flex: 1,
      fontSize: 10,
      color: COLOR.grey700,
      lineHeight: 1.5,
    },
    // Screenshots note (with_screenshots tier only)
    screenshotsNote: {
      marginTop: 14,
      backgroundColor: COLOR.surface,
      borderRadius: 6,
      padding: 10,
      fontSize: 9.5,
      color: COLOR.grey700,
      fontStyle: 'italic',
    },
    // Footer (every page)
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
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────

function priorityBadgeStyle(p: BriefSection['priority']) {
  if (p === 'high') return { bg: COLOR.orange, label: 'High priority' }
  if (p === 'medium') return { bg: COLOR.amber, label: 'Medium priority' }
  return { bg: COLOR.brand, label: 'Low priority' }
}

function humanBusinessType(key: string): string {
  switch (key) {
    case 'clinic':
      return 'Medical clinic'
    case 'retail_clothing':
      return 'Retail / clothing'
    case 'restaurant':
      return 'Restaurant'
    case 'legal':
      return 'Legal practice'
    case 'education':
      return 'Education'
    case 'ca_finance':
      return 'CA / finance'
    case 'real_estate':
      return 'Real estate'
    case 'salon_beauty':
      return 'Salon / beauty'
    case 'gym_fitness':
      return 'Gym / fitness'
    case 'general':
    default:
      return 'General business'
  }
}

function formatDate(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// ─── Document ─────────────────────────────────────────────────────────

export function BriefDocument({
  brief,
  meta,
  fontFamily = 'Plus Jakarta Sans',
}: BriefDocumentProps) {
  const styles = buildStyles(fontFamily)

  return (
    <Document
      title={`fixmysite.in developer brief — ${meta.hostname}`}
      author="fixmysite.in"
      subject="Developer brief"
      creator="fixmysite.in"
      producer="fixmysite.in"
    >
      <Page size="A4" style={styles.page}>
        <Header styles={styles} />

        {/* ─── Title + sub-header (page 1) ─────────────────────── */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Developer Brief</Text>
          <Text style={styles.subHeaderRow}>
            <Text style={styles.subHeaderLabel}>Prepared for: </Text>
            {meta.scanUrl}
          </Text>
          <Text style={styles.subHeaderRow}>
            <Text style={styles.subHeaderLabel}>Business type: </Text>
            {humanBusinessType(brief.business_type)}
          </Text>
          <Text style={styles.subHeaderRow}>
            <Text style={styles.subHeaderLabel}>Prepared by: </Text>
            fixmysite.in via Bugbite — {formatDate(meta.paidAt)}
          </Text>
        </View>

        {/* ─── Intent summary card ─────────────────────────────── */}
        <View style={styles.intentCard}>
          <Text style={styles.intentLabel}>What Bugbite understood</Text>
          <Text style={styles.intentBody}>{brief.intent_summary}</Text>
          <View style={styles.ownerQuoteContainer}>
            <Text style={styles.ownerQuoteLabel}>
              Owner&apos;s original words
            </Text>
            <Text style={styles.ownerQuoteText}>
              &ldquo;{brief.owner_original_words}&rdquo;
            </Text>
          </View>
        </View>

        {/* ─── Sections (work items) ───────────────────────────── */}
        <Text style={styles.sectionsTitle}>
          Work items ({brief.sections.length})
        </Text>
        {brief.sections.map((section, idx) => (
          <WorkItem
            key={`section-${idx}`}
            section={section}
            order={idx + 1}
            styles={styles}
          />
        ))}

        {/* ─── Recommendations ────────────────────────────────── */}
        {brief.additional_recommendations.length > 0 && (
          <View>
            <Text style={styles.listSectionTitle}>
              Bugbite&apos;s additional recommendations
            </Text>
            <Text style={styles.listSectionHelp}>
              Optional improvements that fit this business type. Not required
              to ship the work above.
            </Text>
            {brief.additional_recommendations.map((rec, idx) => (
              <View key={`rec-${idx}`} style={styles.listItem} wrap={false}>
                <Text style={[styles.listMarker, { color: COLOR.brand }]}>
                  ✓
                </Text>
                <Text style={styles.listBody}>{rec}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ─── Not in scope ───────────────────────────────────── */}
        {brief.not_in_scope.length > 0 && (
          <View>
            <Text style={styles.listSectionTitle}>Not in scope</Text>
            <Text style={styles.listSectionHelp}>
              For your developer&apos;s reference — things the owner did NOT
              ask for. Show this list to anyone who tries to add more.
            </Text>
            {brief.not_in_scope.map((item, idx) => (
              <View key={`not-${idx}`} style={styles.listItem} wrap={false}>
                <Text style={[styles.listMarker, { color: COLOR.grey400 }]}>
                  ✗
                </Text>
                <Text style={styles.listBody}>{item}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ─── Screenshots note (with_screenshots tier only) ──── */}
        {meta.hasScreenshots && (
          <Text style={styles.screenshotsNote}>
            Note: this brief was generated with screenshot context. Sections
            referencing &ldquo;screenshot 1&rdquo;, &ldquo;screenshot 2&rdquo;
            etc. correspond to the images the owner uploaded — Bugbite
            integrated their visual context into the technical specifications.
          </Text>
        )}

        <Footer briefId={meta.briefId} styles={styles} />
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

function Footer({ briefId, styles }: { briefId: string; styles: Styles }) {
  return (
    <View style={styles.footer} fixed>
      <View style={styles.footerLine}>
        <Text style={styles.footerLineText}>fixmysite.in</Text>
        <Text style={styles.footerLineText}>Brief reference: {briefId}</Text>
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

function WorkItem({
  section,
  order,
  styles,
}: {
  section: BriefSection
  order: number
  styles: Styles
}) {
  const priority = priorityBadgeStyle(section.priority)
  return (
    <View style={styles.workItem} wrap={false}>
      <View style={styles.workItemTopRow}>
        <Text style={styles.workItemNumber}>{order}</Text>
        <View style={styles.workItemBody}>
          <Text style={styles.workItemTitle}>{section.title}</Text>
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
              {section.effort_days}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.ownerCallout}>
        <Text style={styles.ownerCalloutLabel}>Owner said</Text>
        <Text style={styles.ownerCalloutText}>
          &ldquo;{section.owner_words}&rdquo;
        </Text>
      </View>

      <Text style={styles.techLabel}>What to build</Text>
      <Text style={styles.techBody}>{section.technical_brief}</Text>
    </View>
  )
}
