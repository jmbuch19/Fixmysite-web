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
import type { BlueprintOutput } from '@/lib/claude/blueprint'

// ─── Font registration (locally bundled — see lib/pdf/registerBrandFont) ─
//
// We bundle Plus Jakarta Sans inside public/fonts/ instead of fetching
// from the @fontsource CDN at render time. Two reasons:
//   1. @fontsource v5 dropped TTF entirely; only ships woff/woff2 which
//      @react-pdf cannot reliably consume. Old CDN URLs silently 404'd
//      and every PDF fell back to built-in Helvetica.
//   2. Built-in PDF Helvetica has no rupee glyph (₹ → superscript 1),
//      which is unacceptable for a product that quotes Indian prices on
//      every page.
// The variable TTF is registered once for both 400 and 600 — bold and
// regular render visually similar in the PDF, which we accept in
// exchange for guaranteed rupee rendering and zero network dependency.

import { registerBrandFont } from '@/lib/pdf/registerBrandFont'

registerBrandFont('blueprint-pdf')

// ─── Logo (module-load) ───────────────────────────────────────────────

let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(
    path.join(process.cwd(), 'public', 'brand', 'logo-mark.png'),
  )
} catch (err) {
  console.warn(
    '[blueprint-pdf] logo-mark.png not found — header will fall back to text',
    err instanceof Error ? err.message : err,
  )
}

// ─── Brand palette (matches BriefDocument exactly) ───────────────────

const COLOR = {
  brand: '#0F6E56',
  brandLight: '#1D9E75',
  surface: '#E1F5EE',
  orange: '#E87C28',
  amber: '#EF9F27',
  amberSurface: '#FEF3E1',
  black: '#1A1A1A',
  grey700: '#374151',
  grey600: '#4B5563',
  grey400: '#9CA3AF',
  grey200: '#E5E7EB',
  grey100: '#F5F5F5',
  white: '#FFFFFF',
} as const

// ─── Public types ─────────────────────────────────────────────────────

export type BlueprintPdfMeta = {
  blueprintId: string
  businessName: string | null
  ownerName: string | null
  paidAt: string | null   // ISO timestamp; null falls back to "today"
}

export type BlueprintDocumentProps = {
  blueprint: BlueprintOutput
  meta: BlueprintPdfMeta
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
    // Title block
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
    // Recommendation badge row
    recBadgeRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 10,
      flexWrap: 'wrap',
    },
    recBadgeBrand: {
      backgroundColor: COLOR.brand,
      color: COLOR.white,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      fontSize: 9.5,
      fontWeight: 600,
    },
    recBadgeOutline: {
      backgroundColor: COLOR.white,
      color: COLOR.grey700,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      fontSize: 9.5,
      fontWeight: 400,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
      borderBottom: `0.5pt solid ${COLOR.grey200}`,
      borderLeft: `0.5pt solid ${COLOR.grey200}`,
      borderRight: `0.5pt solid ${COLOR.grey200}`,
    },
    // Understood card (teal callout)
    understoodCard: {
      backgroundColor: COLOR.surface,
      borderLeft: `3pt solid ${COLOR.brand}`,
      borderRadius: 6,
      padding: 14,
      marginTop: 16,
      marginBottom: 18,
    },
    understoodLabel: {
      fontSize: 8.5,
      color: COLOR.brand,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      fontWeight: 600,
      marginBottom: 4,
    },
    understoodBody: {
      fontSize: 11,
      color: COLOR.black,
      lineHeight: 1.5,
    },
    // Section heading
    sectionTitle: {
      fontSize: 13,
      fontWeight: 600,
      color: COLOR.black,
      marginTop: 14,
      marginBottom: 8,
      paddingTop: 8,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
    },
    sectionHelp: {
      fontSize: 9.5,
      color: COLOR.grey600,
      marginBottom: 8,
    },
    // Bullet list (why_right / why_not_alternative / features)
    listItem: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 6,
    },
    listMarker: {
      width: 12,
      fontSize: 10,
      fontWeight: 600,
    },
    listBody: {
      flex: 1,
      fontSize: 10,
      color: COLOR.grey700,
      lineHeight: 1.5,
    },
    // Page card (numbered)
    pageCard: {
      backgroundColor: COLOR.grey100,
      borderRadius: 6,
      padding: 12,
      marginBottom: 8,
    },
    pageCardRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    pageCardNumber: {
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
    pageCardBody: { flex: 1 },
    pageCardName: {
      fontSize: 11,
      fontWeight: 600,
      color: COLOR.black,
    },
    pageCardPurpose: {
      fontSize: 10,
      color: COLOR.grey700,
      marginTop: 3,
      lineHeight: 1.5,
    },
    // Two-column features
    featureCol: {
      flex: 1,
    },
    featureColRow: {
      flexDirection: 'row',
      gap: 18,
    },
    featureColLabel: {
      fontSize: 9,
      color: COLOR.grey600,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      fontWeight: 600,
      marginBottom: 6,
    },
    // Technology block
    techCard: {
      backgroundColor: COLOR.grey100,
      borderRadius: 6,
      padding: 14,
    },
    techPlatform: {
      fontSize: 11.5,
      fontWeight: 600,
      color: COLOR.black,
    },
    techReason: {
      fontSize: 10,
      color: COLOR.grey700,
      marginTop: 5,
      lineHeight: 1.5,
    },
    techLabel: {
      fontSize: 8.5,
      color: COLOR.grey600,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      fontWeight: 600,
      marginTop: 12,
    },
    techBody: {
      fontSize: 10,
      color: COLOR.grey700,
      marginTop: 3,
    },
    techAvoidContainer: {
      marginTop: 12,
      paddingTop: 10,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
    },
    techAvoidItem: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 6,
    },
    techAvoidName: {
      fontWeight: 600,
      color: COLOR.black,
    },
    // Next-step card
    stepCard: {
      backgroundColor: COLOR.white,
      borderRadius: 6,
      padding: 12,
      marginBottom: 8,
      borderTop: `0.5pt solid ${COLOR.grey200}`,
      borderBottom: `0.5pt solid ${COLOR.grey200}`,
      borderLeft: `0.5pt solid ${COLOR.grey200}`,
      borderRight: `0.5pt solid ${COLOR.grey200}`,
    },
    stepCardRow: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
    },
    stepCardNumber: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: COLOR.brand,
      color: COLOR.white,
      fontSize: 9,
      fontWeight: 600,
      textAlign: 'center',
      paddingTop: 3,
    },
    stepCardBody: { flex: 1 },
    stepCardAction: {
      fontSize: 10,
      color: COLOR.grey700,
      lineHeight: 1.5,
    },
    stepCardCost: {
      fontSize: 9,
      color: COLOR.brand,
      fontWeight: 600,
      marginTop: 3,
    },
    // Red flags
    redFlagCard: {
      backgroundColor: COLOR.amberSurface,
      borderLeft: `3pt solid ${COLOR.amber}`,
      borderRadius: 6,
      padding: 12,
      marginBottom: 8,
    },
    redFlagText: {
      fontSize: 10,
      color: COLOR.grey700,
      lineHeight: 1.5,
    },
    // Footer
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

function formatDate(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// ─── Document ─────────────────────────────────────────────────────────

export function BlueprintDocument({
  blueprint,
  meta,
  fontFamily = 'Plus Jakarta Sans',
}: BlueprintDocumentProps) {
  const styles = buildStyles(fontFamily)
  const subjectName = meta.businessName ?? 'your business'
  const greetingName = meta.ownerName ? meta.ownerName.split(' ')[0] : null

  return (
    <Document
      title={`fixmysite.in website blueprint — ${subjectName}`}
      author="fixmysite.in"
      subject="Website blueprint"
      creator="fixmysite.in"
      producer="fixmysite.in"
    >
      <Page size="A4" style={styles.page}>
        <Header styles={styles} />

        {/* ─── Title block ─────────────────────────────────────── */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Website Blueprint</Text>
          {meta.businessName && (
            <Text style={styles.subHeaderRow}>
              <Text style={styles.subHeaderLabel}>Prepared for: </Text>
              {meta.businessName}
            </Text>
          )}
          {greetingName && (
            <Text style={styles.subHeaderRow}>
              <Text style={styles.subHeaderLabel}>Owner: </Text>
              {meta.ownerName}
            </Text>
          )}
          <Text style={styles.subHeaderRow}>
            <Text style={styles.subHeaderLabel}>Prepared by: </Text>
            fixmysite.in via Bugbite — {formatDate(meta.paidAt)}
          </Text>

          <View style={styles.recBadgeRow}>
            <Text style={styles.recBadgeBrand}>
              {blueprint.recommendation_label}
            </Text>
            <Text style={styles.recBadgeOutline}>
              Timeline: {blueprint.timeline_days}
            </Text>
            <Text style={styles.recBadgeOutline}>
              Budget: {blueprint.budget_range}
            </Text>
          </View>
        </View>

        {/* ─── Understood card ─────────────────────────────────── */}
        <View style={styles.understoodCard}>
          <Text style={styles.understoodLabel}>What Bugbite understood</Text>
          <Text style={styles.understoodBody}>{blueprint.understood}</Text>
        </View>

        {/* ─── Why right ───────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Why this is right for you</Text>
        {blueprint.why_right.map((item, i) => (
          <View key={`right-${i}`} style={styles.listItem} wrap={false}>
            <Text style={[styles.listMarker, { color: COLOR.brand }]}>✓</Text>
            <Text style={styles.listBody}>{item}</Text>
          </View>
        ))}

        {/* ─── Why not alternatives ────────────────────────────── */}
        <Text style={styles.sectionTitle}>
          Why simpler or more complex would not work
        </Text>
        {blueprint.why_not_alternative.map((item, i) => (
          <View key={`not-${i}`} style={styles.listItem} wrap={false}>
            <Text style={[styles.listMarker, { color: COLOR.amber }]}>✗</Text>
            <Text style={styles.listBody}>{item}</Text>
          </View>
        ))}

        {/* ─── Pages ───────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Pages your site needs</Text>
        {blueprint.pages_needed.map((page, i) => (
          <View key={`page-${i}`} style={styles.pageCard} wrap={false}>
            <View style={styles.pageCardRow}>
              <Text style={styles.pageCardNumber}>{i + 1}</Text>
              <View style={styles.pageCardBody}>
                <Text style={styles.pageCardName}>{page.name}</Text>
                <Text style={styles.pageCardPurpose}>{page.purpose}</Text>
              </View>
            </View>
          </View>
        ))}

        {/* ─── Features (two columns) ──────────────────────────── */}
        <Text style={styles.sectionTitle}>Features</Text>
        <View style={styles.featureColRow} wrap={false}>
          <View style={styles.featureCol}>
            <Text style={styles.featureColLabel}>What to build</Text>
            {blueprint.features_needed.length > 0 ? (
              blueprint.features_needed.map((f, i) => (
                <View key={`fn-${i}`} style={styles.listItem}>
                  <Text style={[styles.listMarker, { color: COLOR.brand }]}>
                    ✓
                  </Text>
                  <Text style={styles.listBody}>{f}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.listBody}>None.</Text>
            )}
          </View>
          <View style={styles.featureCol}>
            <Text style={styles.featureColLabel}>What to skip</Text>
            {blueprint.features_not_needed.length > 0 ? (
              blueprint.features_not_needed.map((f, i) => (
                <View key={`fnn-${i}`} style={styles.listItem}>
                  <Text style={[styles.listMarker, { color: COLOR.grey400 }]}>
                    –
                  </Text>
                  <Text style={styles.listBody}>{f}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.listBody}>None.</Text>
            )}
          </View>
        </View>

        {/* ─── Technology ──────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Technology suggestion</Text>
        <View style={styles.techCard}>
          <Text style={styles.techPlatform}>
            {blueprint.technology.platform}
          </Text>
          <Text style={styles.techReason}>{blueprint.technology.reason}</Text>
          <Text style={styles.techLabel}>Hosting</Text>
          <Text style={styles.techBody}>{blueprint.technology.hosting}</Text>

          {blueprint.technology.avoid.length > 0 && (
            <View style={styles.techAvoidContainer}>
              <Text style={styles.techLabel}>Avoid</Text>
              {blueprint.technology.avoid.map((name, i) => (
                <View key={`av-${i}`} style={styles.techAvoidItem}>
                  <Text style={styles.listBody}>
                    <Text style={styles.techAvoidName}>{name}</Text>
                    {blueprint.technology.avoid_reasons[i] ? (
                      <Text> — {blueprint.technology.avoid_reasons[i]}</Text>
                    ) : null}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ─── Next steps ──────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Step-by-step next actions</Text>
        {blueprint.next_steps.map((step) => (
          <View key={`step-${step.step}`} style={styles.stepCard} wrap={false}>
            <View style={styles.stepCardRow}>
              <Text style={styles.stepCardNumber}>{step.step}</Text>
              <View style={styles.stepCardBody}>
                <Text style={styles.stepCardAction}>{step.action}</Text>
                {step.cost && (
                  <Text style={styles.stepCardCost}>{step.cost}</Text>
                )}
              </View>
            </View>
          </View>
        ))}

        {/* ─── Red flags (only if any) ─────────────────────────── */}
        {blueprint.red_flags && blueprint.red_flags.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Things to watch out for</Text>
            {blueprint.red_flags.map((flag, i) => (
              <View key={`rf-${i}`} style={styles.redFlagCard} wrap={false}>
                <Text style={styles.redFlagText}>{flag}</Text>
              </View>
            ))}
          </View>
        )}

        <Footer blueprintId={meta.blueprintId} styles={styles} />
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

function Footer({
  blueprintId,
  styles,
}: {
  blueprintId: string
  styles: Styles
}) {
  return (
    <View style={styles.footer} fixed>
      <View style={styles.footerLine}>
        <Text style={styles.footerLineText}>fixmysite.in</Text>
        <Text style={styles.footerLineText}>
          Blueprint reference: {blueprintId}
        </Text>
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
