# CLAUDE.md — fixmysite.in
> Rules for Claude Code. Read this file first. Always.

---

## Project Identity

- Product: **fixmysite.in**
- Type: Bootstrapped SaaS, solo founder, India-first
- Stack: Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · Supabase · Razorpay · Twilio · Resend · Serwist (PWA) · Cloudflare R2 (briefs) · Vercel
- Always PWA. Always mobile-first. Always security-first.

---

## Non-Negotiable Rules

### Security
- NEVER expose Twilio, Razorpay, Supabase service keys to the client
- ALWAYS validate and sanitise every URL input server-side before any fetch
- ALWAYS block SSRF targets: `127.0.0.1`, `localhost`, `10.x.x.x`, `192.168.x.x`, `169.254.x.x`, `::1`, `0.0.0.0`
- ALWAYS verify Razorpay webhook signatures before processing any event
- ALWAYS enforce RLS on every Supabase table
- NEVER trust `scan_id` from client without verifying `payment_status = 'paid'` server-side before returning full report
- Rate limits (Upstash Redis, sliding window):
  Phase 1 = 10/hour/IP · Phase 2 = 3/hour/IP · PDF = 5/hour/IP
  send-developer = 3/hour/IP · payment routes = 20/hour/IP
  check-previous = 20/hour/IP · classify-url = 30/hour/IP
  brief generate = 5/hour/IP · screenshot upload = 10/hour/IP
  enterprise verify-email = 5/hour/IP · enterprise verify-otp = 10/hour/IP
  subscription webhook = no IP limit (HMAC is auth)
  Implementation in `lib/security/rateLimit.ts`.

### Data
- Scan results stored in Supabase `scans` table — see SPEC.md schema
- `phase1_result` and `phase2_result` are JSONB — never store as flat columns
- `url_normalized` = lowercase, stripped trailing slash, no query params
- Never store raw HTML of scanned sites in DB
- PDF reports: generate on-demand, signed URL, 1-hour expiry

### Payments
- Razorpay order created server-side (`/api/payment/create-order`)
- Signature verified server-side (`/api/payment/verify`) before `payment_status` set to `paid`
- Phase 2 scan ONLY starts after verified payment
- Subscription webhooks handled at `/api/subscription/webhook`
- Never start a scan on unverified payment

### Agents & Scans
- Phase 1 and Phase 2 are separate API calls — never merge them
- Phase 2 checks run in parallel where possible (Twilio + link checks + SSL simultaneously)
- Twilio Lookup: one API call per unique phone number only — deduplicate before calling
- Twilio Lookup cap: max 10 unique phone numbers per scan (caps spend at ~₹17/scan). Beyond 10 — flag as "not checked" warning in report, never silently drop.
- Claude report generation: called ONCE after all checks complete — never mid-scan
- Claude model: `claude-sonnet-4-6` for the main report generation, UX audit, and brief generation. Lightweight ancillary calls (return message, business-type detection) may use Haiku 4.5 (`claude-haiku-4-5-20251001`) — they're explicitly tagged as lightweight in their respective prompts.
- Claude prompt context: pass raw check results as structured JSON, not narrative text

---

## File & Folder Structure

```
/app
  /page.tsx                              ← Landing page
  /scanning/[scan_id]/page.tsx           ← Phase 1 result + price gate
  /report/[scan_id]/page.tsx             ← Free preview
  /report/[scan_id]/full/page.tsx        ← Full report (payment-gated)
  /brief/[scan_id]/page.tsx              ← Brief generator input (post-scan upsell)
  /brief/[scan_id]/preview/page.tsx      ← Brief preview (pre-payment)
  /brief/[scan_id]/full/page.tsx         ← Full brief + PDF (post-payment)
  /subscribe/page.tsx
  /agency/page.tsx
  /admin/page.tsx
  /privacy/page.tsx
  /terms/page.tsx
  /institution/page.tsx                  ← Institution upsell stub
  /sw.ts                                 ← Serwist service worker source

/app/api
  /scan/classify-url/route.ts            ← URL classification (runs before Phase 1)
  /scan/phase1/route.ts
  /scan/check-previous/route.ts
  /scan/phase2/route.ts
  /payment/create-order/route.ts
  /payment/verify/route.ts
  /report/[scan_id]/route.ts
  /report/pdf/route.ts
  /report/send-developer/route.ts
  /brief/generate/route.ts
  /brief/pdf/route.ts
  /brief/send/route.ts
  /brief/payment/create-order/route.ts
  /brief/payment/verify/route.ts
  /enterprise/verify-email/route.ts      ← Domain match + MX check + OTP send
  /enterprise/verify-otp/route.ts        ← OTP verify → mark inquiry verified
  /subscription/create/route.ts
  /subscription/webhook/route.ts
  /admin/scans/route.ts
  /admin/briefs/route.ts
  /admin/inquiries/route.ts
  /admin/inquiries/[id]/approve/route.ts

/lib
  /scan/extractor.ts    ← HTML parsing, phone/email regex
  /scan/twilio.ts       ← Twilio Lookup wrapper
  /scan/links.ts        ← Link checker
  /scan/ssl.ts          ← SSL/certificate checker
  /scan/content.ts      ← Lorem ipsum + thin content detection
  /scan/images.ts       ← Old image detection via Last-Modified header
  /scan/ui.ts           ← UI quality checks (CTA, trust, alt text, wall of text)
  /scan/workflow.ts     ← Form audits, upload checks, CTA dead-ends (HTML layer)
  /scan/trust.ts        ← Email identity check (Standard tier only)
  /scan/returnVisit.ts  ← Previous scan lookup + fix rate computation
  /scan/classifier.ts   ← URL classification (runs before Phase 1) — imports lists from /constants/enterprise.ts
  /scan/phase1.ts       ← Phase 1 orchestrator
  /scan/phase2.ts       ← Phase 2 orchestrator
  /claude/report.ts     ← Claude report generation prompt
  /claude/uxAudit.ts    ← Claude UX audit prompt (per page, max 5)
  /claude/brief.ts      ← Claude developer brief generation prompt
  /brief/detector.ts    ← Business type detection from URL content
  /brief/screenshots.ts ← R2 upload + signed URL generation
  /enterprise/domainMatch.ts  ← Email domain vs URL domain validation
  /enterprise/otp.ts          ← OTP generation, hashing, verification
  /enterprise/emailGuard.ts   ← MX record check before sending OTP
  /pdf/generator.ts     ← PDF generation
  /email/sender.ts      ← Resend email templates
  /razorpay/client.ts   ← Razorpay server-side helpers
  /supabase/server.ts   ← Service-role client (bypasses RLS, server-only)
  /supabase/browser.ts  ← Anon-key browser client (stub — not used until user auth)
  /security/ssrf.ts     ← SSRF check function (async)
  /security/rateLimit.ts
  /analytics/posthog.ts ← PostHog client wrapper (lazy init, console fallback)

/components
  /ui/                  ← Shared UI components
  /scan/                ← Scan-specific components
  /report/              ← Report-specific components
  /brief/               ← Brief-specific components
  /enterprise/          ← Admin gate, OTP form, inquiry confirmation, domain-verify gate

/constants
  /pricing.ts           ← Tier definitions, prices, brief pricing, predefined cards, enterprise pricing
  /scan.ts              ← Check categories, status enums
  /enterprise.ts        ← Single source of truth: known domain lists (global / indian), free email providers, institution TLDs

/public
  /manifest.json
  /icons/               ← PWA icons (192, 512)
  /sw.js                ← Service worker (generated by Serwist)
```

---

## Claude Report Prompt Pattern

```typescript
const systemPrompt = `
You are a website health analyst writing for non-technical Indian business owners.
Rules:
- Plain language only. No jargon.
- Each finding: one sentence explaining the problem, one sentence on impact, one sentence on exact action.
- Solution map: ordered by priority (High first) then effort (Low first).
- Priority: High = affects customers reaching the business. Medium = affects trust. Low = affects SEO/polish.
- Effort: Low = owner or developer fixes in under 1 hour. Medium = under 1 day. High = needs planning.
- Never use words: "utilize", "leverage", "ensure", "robust", "seamless".
- If you cannot determine an appropriate finding for a check result, omit it entirely. Never fabricate findings.
- Output: valid JSON only. No markdown. No preamble.
`

const userPrompt = `
Scan results for ${url}:
${JSON.stringify(scanResults, null, 2)}

Return JSON in this exact shape:
{
  "health_score": number (0-100),
  "summary": string (one sentence),
  "issues": [
    {
      "category": "contact|links|trust|content|visual|workflow|technical",
      "item": string,
      "status": "fail|warning",
      "detail": string,
      "priority": "high|medium|low",
      "effort": "low|medium|high",
      "action": string
    }
  ],
  "solution_map": [
    {
      "order": number,
      "title": string,
      "body": string,
      "priority": "high|medium|low",
      "effort": "low|medium|high"
    }
  ]
}
`
```

---

## Workflow & UX Check Pattern

```typescript
// /lib/scan/workflow.ts
import * as cheerio from 'cheerio'

export function auditWorkflow(html: string, pageUrl: string) {
  const $ = cheerio.load(html)
  const findings: WorkflowFinding[] = []

  // --- FORMS ---
  $('form').each((_, form) => {
    const $form = $(form)
    const hasAction = !!$form.attr('action')
    const hasMethod = !!$form.attr('method')
    const hasSubmit = $form.find('[type=submit], button').length > 0
    const fileInputs = $form.find('input[type=file]')
    const labels = $form.find('label').length
    const fields = $form.find('input, select, textarea').length

    if (!hasAction || !hasMethod) {
      findings.push({
        check: 'form_no_destination',
        page: pageUrl,
        priority: 'high',
        effort: 'low',
        userImpact: 'User fills the form and clicks submit — nothing happens. Their enquiry is lost.',
      })
    }

    if (fileInputs.length > 0 && !hasSubmit) {
      findings.push({
        check: 'upload_no_submit',
        page: pageUrl,
        priority: 'high',
        effort: 'low',
        userImpact: 'User selects a file but finds no upload button. They cannot complete the action.',
      })
    }

    fileInputs.each((_, input) => {
      const accept = $(input).attr('accept')
      const nearbyText = $(input).parent().text()
      const hasSizeHint = /mb|kb|size|maximum|max/i.test(nearbyText)
      const hasTypeHint = /pdf|jpg|png|doc|format/i.test(nearbyText)

      if (!accept || !hasSizeHint) {
        findings.push({
          check: 'upload_no_rules',
          page: pageUrl,
          priority: 'high',
          effort: 'low',
          userImpact: 'No file size limit or accepted format shown. User guesses, uploads wrong file, gets an error — or gives up.',
        })
      }
    })

    if (fields > 2 && labels < fields / 2) {
      findings.push({
        check: 'form_missing_labels',
        page: pageUrl,
        priority: 'medium',
        effort: 'low',
        userImpact: 'Form fields have no labels. Users on mobile or screen readers cannot tell what to fill in.',
      })
    }

    const submitText = $form.find('[type=submit], button[type=submit]').text().trim().toLowerCase()
    if (['submit', 'send', 'go', 'ok', 'click here'].includes(submitText)) {
      findings.push({
        check: 'generic_submit_label',
        page: pageUrl,
        priority: 'low',
        effort: 'low',
        userImpact: 'Submit button says nothing useful. User is unsure what will happen when they click.',
      })
    }
  })

  // --- CTA DEAD-ENDS ---
  const ctaSelectors = ['a[href*="apply"]','a[href*="book"]','a[href*="enquire"]',
    'a[href*="register"]','a[href*="download"]','a[href*="appointment"]']

  ctaSelectors.forEach(sel => {
    $(sel).each((_, el) => {
      const href = $(el).attr('href')
      if (href) {
        // href collected for link-checker to validate — not fetched here
        findings.push({ check: 'cta_to_validate', href, page: pageUrl, priority: 'high', effort: 'low',
          userImpact: 'Primary action button may lead nowhere. Visitor intent is blocked.' })
      }
    })
  })

  // --- SEARCH BAR WITHOUT RESULTS ---
  const hasSearch = $('input[type=search], input[name=s], input[name=q]').length > 0
  const hasResultsPage = html.includes('search-results') || html.includes('?s=') || html.includes('?q=')
  if (hasSearch && !hasResultsPage) {
    findings.push({
      check: 'search_no_results',
      page: pageUrl,
      priority: 'medium',
      effort: 'medium',
      userImpact: 'Search bar is present but searching goes nowhere. Users searching for specific info leave frustrated.',
    })
  }

  return findings
}
```

---

## Claude UX Audit Prompt Pattern

Run this as a **second Claude call** — separate from the issue report generation call. Input: full visible text of page (strip HTML tags). Output: UX findings only.

```typescript
const uxAuditPrompt = `
You are auditing a business website page for user experience problems.
Read the page content below and identify workflow failures.

Page URL: ${pageUrl}
Page content:
${visibleText}

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
}
`
```

**Important:** Claude UX audit runs page-by-page, max 5 pages per scan (homepage + 4 highest-traffic pages detected). Not every page — too slow and expensive.

---

```typescript
// /lib/scan/returnVisit.ts

export async function checkPreviousScan(urlNormalized: string) {
  const { data } = await supabase
    .from('scans')
    .select('id, health_score, completed_at, report_json')
    .eq('url_normalized', urlNormalized)
    .eq('payment_status', 'paid')
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return data ?? null
}

export async function computeFixRate(
  previousScanId: string,
  newIssues: Issue[]
) {
  const { data: prevIssues } = await supabase
    .from('issues')
    .select('*')
    .eq('scan_id', previousScanId)
    .eq('status', 'fail')

  const prevHighItems = prevIssues?.filter(i => i.priority === 'high') ?? []
  if (prevHighItems.length === 0) return { fixRate: 1, resolvedCount: 0, highTotal: 0 }

  const newFailItems = new Set(newIssues.filter(i => i.status === 'fail').map(i => i.item))
  const resolved = prevHighItems.filter(i => !newFailItems.has(i.item))

  return {
    fixRate: resolved.length / prevHighItems.length,
    resolvedCount: resolved.length,
    highTotal: prevHighItems.length,
    resolvedItems: resolved.map(i => i.item),
  }
}

export function isFreeRescanEarned(fixRate: number): boolean {
  return fixRate >= 0.8
}
```

Free re-scan bypass: in `/api/scan/phase2/trigger/route.ts`, accept `free_rescan_token` (a signed JWT containing `scan_id` and `url_normalized`, issued by `/api/scan/check-previous` when `fix_rate >= 0.8`). Verify token server-side before bypassing the payment check, then call `enqueuePhase2()` as normal.

---

## Return Message Prompt Pattern

```typescript
const returnMessagePrompt = `
You are writing a 2-sentence message for a business owner who acted on our website health report and fixed their issues.

Issues they fixed: ${resolvedItems.join(', ')}
Issues still remaining: ${unchangedItems.join(', ')}

Rules:
- Reference specific fixed issues by name
- Frame impact in terms of their customers, not their website
- Warm but not effusive. Grounded. Human.
- Never say: "congratulations", "great job", "well done", "amazing"
- Maximum 2 sentences
- Plain text only, no markdown
`
```

---

## Lorem Ipsum Detection Pattern

```typescript
// /lib/scan/content.ts

const PLACEHOLDER_PATTERNS = [
  /lorem\s+ipsum/i,
  /your\s+text\s+here/i,
  /sample\s+content/i,
  /insert\s+(name|text|content)\s+here/i,
  /placeholder\s+text/i,
  /dummy\s+text/i,
  /test\s+content/i,
  /coming\s+soon/i,          // only flag if page has no other content > 100 words
  /under\s+construction/i,
]

export function detectPlaceholderText(html: string, pageUrl: string) {
  const text = stripHtml(html)
  const findings: { pattern: string; context: string; pageUrl: string }[] = []

  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      findings.push({
        pattern: match[0],
        context: text.slice(Math.max(0, match.index! - 40), match.index! + 60),
        pageUrl,
      })
    }
  }
  return findings
}
```

---

## Old Image Detection Pattern

```typescript
// /lib/scan/images.ts

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000

export async function checkImageAge(imgSrc: string) {
  if (!(await isSafeUrl(imgSrc))) return null
  try {
    const res = await fetch(imgSrc, { method: 'HEAD' })
    const lastModified = res.headers.get('last-modified')
    if (!lastModified) return null
    const date = new Date(lastModified)
    const ageMs = Date.now() - date.getTime()
    return {
      src: imgSrc,
      lastModified: date.toISOString(),
      ageYears: Math.floor(ageMs / (365 * 24 * 60 * 60 * 1000)),
      isOld: ageMs > THREE_YEARS_MS,
    }
  } catch {
    return null
  }
}

// Call for every unique img src on the page. Deduplicate before fetching.
// Never download image — HEAD only.
```

---

## UI Quality Checks Pattern

```typescript
// /lib/scan/ui.ts

export function analyseUIQuality(html: string, pageUrl: string) {
  const findings = []
  const $ = cheerio.load(html)

  // CTA check — homepage only
  if (isHomepage(pageUrl)) {
    const ctaElements = $('a.btn, button, a[href*="contact"], a[href*="appointment"], a[href*="book"]')
    if (ctaElements.length === 0) {
      findings.push({ check: 'no_cta', priority: 'medium', effort: 'low' })
    }
  }

  // Contact above fold — rough check
  const headerText = $('header').text().toLowerCase()
  const hasPhoneInHeader = /\d{10}|\+91/.test(headerText)
  if (!hasPhoneInHeader) {
    findings.push({ check: 'contact_buried', priority: 'medium', effort: 'low' })
  }

  // Trust indicators
  const bodyText = $('body').text().toLowerCase()
  const trustKeywords = ['years', 'certified', 'award', 'testimonial', 'review', 'since']
  const hasTrust = trustKeywords.some(k => bodyText.includes(k))
  if (!hasTrust) {
    findings.push({ check: 'no_trust_indicators', priority: 'low', effort: 'medium' })
  }

  // Wall of text — paragraphs without headings
  const paras = $('p').length
  const headings = $('h1, h2, h3').length
  if (paras > 5 && headings < 2) {
    findings.push({ check: 'wall_of_text', priority: 'low', effort: 'low' })
  }

  // Missing alt text
  const imgsWithoutAlt = $('img:not([alt])').length
  if (imgsWithoutAlt > 0) {
    findings.push({ check: 'missing_alt_text', count: imgsWithoutAlt, priority: 'low', effort: 'low' })
  }

  return findings
}
```

---

## SSRF Guard

The full implementation lives in `/lib/security/ssrf.ts`. Defends against IPv4/IPv6 private ranges, cloud-metadata IPs, link-local, CGNAT, multicast, IPv4-mapped IPv6, local hostnames, and DNS rebinding (resolves the hostname and rejects if any A record is private).

```typescript
import { isSafeUrl } from '@/lib/security/ssrf'

if (!(await isSafeUrl(userUrl))) {
  return new Response('Blocked URL', { status: 400 })
}
```

**Critical:** `isSafeUrl` is **async** — always `await` it. The function performs a DNS lookup as part of the safety check; calling it without `await` returns a Promise that is truthy and silently bypasses the guard.

Call before every outbound HTTP request in Phase 1 and Phase 2 — including HEAD requests for image age checks.

---

## Twilio Lookup Pattern

```typescript
// /lib/scan/twilio.ts
import twilio from 'twilio'

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

export async function lookupPhone(phone: string) {
  try {
    const result = await client.lookups.v2
      .phoneNumbers(phone)
      .fetch({ fields: 'line_type_intelligence' })
    return {
      valid: result.valid,
      lineType: result.lineTypeIntelligence?.type ?? null,
      whatsappCapable: false, // checked separately
    }
  } catch {
    return { valid: false, lineType: null, whatsappCapable: false }
  }
}
```

Deduplicate phone numbers before calling. One Twilio call per unique number.

---

## Claude Brief Generation Prompt Pattern

Third Claude call — completely separate from report and UX audit. Called once after payment verified.

```typescript
// /lib/claude/brief.ts

const briefSystemPrompt = `
You are translating a business owner's plain-language website improvement requests
into a professional technical brief for their web developer.

Your audience is TWO people simultaneously:
1. The business owner — must feel heard and understood
2. The web developer — must receive precise, actionable technical specifications

Rules:
- Preserve the owner's original words verbatim in "owner_words" field
- Detect language automatically (Hindi, Gujarati, English, Hinglish, etc.)
- Translate intent, not literally — "thoda sundar banana hai" means clean modern redesign, not decoration
- Use industry-specific terminology matching the business type
- Never invent features the owner did not ask for or imply
- Each section: owner's request → what it means → exact technical spec
- Effort estimates must be realistic for an average Indian freelance developer
- Output: valid JSON only. No markdown. No preamble.
`

const briefUserPrompt = `
Business URL: ${url}
Business type detected: ${businessType}
Page scan context: ${JSON.stringify(scanSummary)}

Owner's input:
- Original text: "${ownerText}"
- Predefined cards selected: ${JSON.stringify(selectedCards)}
- Screenshots provided: ${screenshotCount} images

${screenshotCount > 0 ? 'Screenshots are provided as image blocks above.' : ''}

Return JSON in this exact shape:
{
  "business_type": string,
  "detected_language": string (ISO 639-1 code),
  "owner_original_words": string,
  "intent_summary": string (one sentence, plain English),
  "sections": [
    {
      "title": string,
      "priority": "high|medium|low",
      "effort_days": string (e.g. "1–2 days", "3–5 days"),
      "owner_words": string (exact quote from owner input),
      "technical_brief": string (precise spec for developer),
      "screenshot_ref": string | null
    }
  ],
  "additional_recommendations": string[] (max 3, based on business type — only if highly relevant),
  "not_in_scope": string[] (things owner did NOT ask for — helps developer avoid scope creep)
}
`
```

**Screenshot handling — pass as Claude image blocks:**
```typescript
const messages = [
  {
    role: 'user',
    content: [
      // Screenshots first (if any)
      ...screenshots.map(s => ({
        type: 'image',
        source: { type: 'base64', media_type: s.mimeType, data: s.base64 }
      })),
      // Then the text prompt
      { type: 'text', text: briefUserPrompt }
    ]
  }
]
```

**Business type detection — separate lightweight Claude call:**
```typescript
// Run this before brief generation, after scan completes
const detectPrompt = `
Read this website content and return ONLY one of these business type keys:
clinic | retail_clothing | restaurant | legal | education | ca_finance |
real_estate | salon_beauty | gym_fitness | general

Website URL: ${url}
Page content (first 2000 chars): ${pageText.slice(0, 2000)}

Return only the key. Nothing else.
`
```

---

## Enterprise & Institution Patterns

### Size-Based Email Rules (summary for quick reference)

```
1–10 pages   → No email needed. Scan immediately.
11–50 pages  → Generic email OK. Scan runs.
               Phase 2 checks email identity. Flag in report if mismatch.
               Never block the scan.
50+ pages    → Domain email mandatory. Generic blocked with friendly message.
               OTP required. Scan only after OTP verified.
Enterprise   → Domain email + OTP + manual approval always.
Institution  → Domain email + OTP. Special report path.
```

### Email Identity Check (Standard tier only — 11–50 pages)

```typescript
// /lib/scan/trust.ts

const FREE_PROVIDERS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'rediffmail.com', 'ymail.com', 'icloud.com',
  'protonmail.com', 'zoho.com', 'me.com',
]

export function checkEmailIdentity(
  ownerEmail: string | null,
  siteDomain: string,
  emailsFoundOnSite: string[]
): EmailIdentityFinding | null {

  const siteHasDomainEmail = emailsFoundOnSite.some(e => {
    const d = e.split('@')[1]?.toLowerCase()
    return d && !FREE_PROVIDERS.includes(d) &&
      (d === siteDomain || d.endsWith('.' + siteDomain))
  })

  const ownerUsedFreeEmail = ownerEmail
    ? FREE_PROVIDERS.includes(ownerEmail.split('@')[1]?.toLowerCase() ?? '')
    : true

  // Mismatch: site shows domain email but owner used Gmail
  if (siteHasDomainEmail && ownerUsedFreeEmail) {
    return {
      check: 'email_identity_mismatch',
      category: 'trust',
      priority: 'medium',
      effort: 'low',
      detail: `Your website shows a domain email but you are using a personal
               email address. Customers who notice this inconsistency may
               question whether they are dealing with the real business.`,
      action: `Use your domain email consistently — for enquiries, WhatsApp
               Business, and Google Business Profile.`
    }
  }

  // Site has no domain email at all
  if (!siteHasDomainEmail) {
    return {
      check: 'no_domain_email',
      category: 'trust',
      priority: 'medium',
      effort: 'low',
      detail: `No professional domain email found on your website.`,
      action: `Set up info@${siteDomain} — costs around ₹500 per year
               and immediately signals a serious, established business.`
    }
  }

  return null
}
```

**Tone rule:** Email findings are always written as a business observation — never accusatory. *"Customers may wonder..."* not *"You are using the wrong email."*

---

### Domain-Match Verification (Complex + Enterprise + Institution)

```typescript
// /lib/enterprise/domainMatch.ts

const FREE_PROVIDERS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'rediffmail.com', 'ymail.com', 'icloud.com',
  'protonmail.com', 'zoho.com', 'me.com',
]

export function isEmailDomainValid(email: string, siteUrl: string): {
  valid: boolean
  reason?: string
} {
  const emailDomain = email.split('@')[1]?.toLowerCase()
  if (!emailDomain) return { valid: false, reason: 'invalid_email' }

  if (FREE_PROVIDERS.includes(emailDomain))
    return { valid: false, reason: 'free_provider' }

  const siteDomain = new URL(siteUrl).hostname
    .replace(/^www\./, '').toLowerCase()

  const matches = emailDomain === siteDomain ||
    emailDomain.endsWith('.' + siteDomain)

  return matches
    ? { valid: true }
    : { valid: false, reason: 'domain_mismatch' }
}
```

### Email Guard — MX Check Before Sending OTP

```typescript
// /lib/enterprise/emailGuard.ts
import dns from 'dns/promises'

export async function hasMxRecord(emailDomain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(emailDomain)
    return records.length > 0
  } catch {
    return false
  }
}
```

**Call order in `verify-email/route.ts`:**
```typescript
// 1. Validate email shape (Zod)
// 2. isEmailDomainValid() — free provider + domain match
// 3. hasMxRecord(emailDomain) — does mail server exist?
//    → if false: return 422, DO NOT insert DB row
// 4. Check for existing pending inquiry (idempotency)
//    → if exists and < 60s since last send: return 429
//    → if exists and > 60s: resend to existing row
// 5. Insert DB row (or update existing)
// 6. sendOtpEmail() → check result.success
//    → if false: roll back DB row, return 502
// 7. Return 200
```

### sendOtpEmail — Discriminated Return

```typescript
// /lib/email/sender.ts
export async function sendOtpEmail(
  to: string,
  otp: string
): Promise<{ success: true; messageId: string }
         | { success: false; reason: string }> {
  try {
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to,
      subject: 'Your fixmysite.in verification code',
      text: `Your verification code is: ${otp}\n\nValid for 15 minutes.`,
    })
    if (result.error) {
      return { success: false, reason: result.error.message }
    }
    return { success: true, messageId: result.data!.id }
  } catch (err) {
    return { success: false, reason: String(err) }
  }
}
```

### UI Messages — OTP Guard States (exact copy)

**MX check fails:**
> *"We couldn't find a mail server for [domain]. Double-check your email address or [contact us →] at hello@fixmysite.in."*

**Email send failed (Resend error):**
> *"We could not send the verification code. Please try again or [contact us →] at hello@fixmysite.in."*

**Retry too soon:**
> *"Please wait [X] seconds before requesting another code."*

**Wrong OTP entered:**
> *"Incorrect code. [X] attempts remaining."*

**OTP expired:**
> *"This code has expired. [Request a new one →]"*

**OTP locked (3 failed attempts):**
> *"Verification locked after too many attempts. [Contact us →] at hello@fixmysite.in for manual verification."*

**Rule:** Every error state includes a next action. No state leaves the user stranded.

---

```typescript
// /lib/enterprise/otp.ts
import bcrypt from 'bcryptjs'

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10)
}

export async function verifyOtp(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// Server-side enforcement:
// - OTP valid: otp_sent_at > now() - interval '15 minutes'
// - Max attempts: otp_attempts < 3
// - On 3rd failure: set status = 'locked', no further attempts allowed
```

### UI Messages (exact copy — never deviate)

**Free provider rejected:**
> *"Please use your work email at [domain]. Personal email addresses like Gmail cannot be used to verify website ownership."*

**Domain mismatch:**
> *"The email you entered doesn't match [domain]. Use an email like yourname@[domain] to verify you manage this site. No work email? [Contact us →] for manual verification."*

**OTP sent:**
> *"We've sent a 6-digit code to [email]. Check your inbox and enter it below. Valid for 15 minutes."*

**OTP locked:**
> *"This verification has been locked after too many attempts. Please [start again →] or [contact us →] for manual verification."*

**Inquiry confirmed:**
> *"Thank you. We've received your request and will be in touch within 24 hours with a quote and next steps."*

**Fun-seeker exit ("No, just curious"):**
> *"No problem. fixmysite.in is built for website owners and managers. Paste a site you manage to get started."*

---

## PDF Generation Pattern

Use `@react-pdf/renderer`. Generate server-side in `/api/report/pdf/route.ts`.

```typescript
import { renderToBuffer } from '@react-pdf/renderer'
import { ReportDocument } from '@/components/report/ReportDocument'

export async function POST(req: Request) {
  const { scan_id } = await req.json()
  // Verify payment_status = 'paid' first
  const scan = await getVerifiedScan(scan_id)
  if (!scan) return new Response('Unauthorized', { status: 401 })

  const buffer = await renderToBuffer(<ReportDocument scan={scan} />)
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="fixmysite-${scan.url_normalized}.pdf"`,
      'Cache-Control': 'private, max-age=3600',
    }
  })
}
```

---

## Email Templates (Resend)

Eight templates. All plain, professional, short.

### 1. Full report ready
```
Subject: Your website health report is ready — fixmysite.in

Hi,

Your scan of [url] is complete. [X] issues found.

[Download PDF Report] ← button

Solution map is included in the attached PDF.

— fixmysite.in
```

### 2. Send to developer
```
Subject: Website health report from [owner name / url]

Hi,

[Owner] has shared a website health report for [url] via fixmysite.in.

[X] issues found. Full solution map attached.

— fixmysite.in
```

### 3. Monthly re-scan alert
```
Subject: New issues detected on [url] — fixmysite.in

Hi,

Your monthly scan found [X] new issues on [url] since last month.

[View Report] ← button

— fixmysite.in
```

### 4. No issues found
```
Subject: [url] looks healthy — fixmysite.in

Hi,

Good news. Your scan of [url] found no issues.

We'll scan again next month.

— fixmysite.in
```

### 5. Developer brief ready (to owner)
```
Subject: Your developer brief is ready — fixmysite.in

Hi,

Your developer brief for [url] is ready.

It includes [X] improvement sections with full technical specifications.
Your original words are preserved exactly as you wrote them.

[Download Brief PDF] ← button

Share this with your developer — they'll know exactly what to build.

— fixmysite.in
```

### 6. Developer brief delivery (to developer)
```
Subject: Website improvement brief for [url] — from your client

Hi,

Your client has prepared a website improvement brief for [url] via fixmysite.in.

[X] improvement sections. Full technical specifications attached.

The brief includes the client's original words alongside developer-ready specifications.

[Download Brief PDF] ← button

— fixmysite.in
```

### 7. Enterprise inquiry received (to you — admin)
```
Subject: New enterprise inquiry — [url_class] — [url]

URL: [url]
Classification: [global_enterprise | indian_enterprise | institution]
Claimed email: [email] ✓ OTP verified
Submitted: [timestamp]

[View in admin panel →]

Set a price and approve to proceed.
```

### 8. Enterprise inquiry confirmed (to claimant)
```
Subject: We've received your request — fixmysite.in

Hi,

Thank you for reaching out about [url].

We've received your verified request and will be in touch within 24 hours with a custom quote and next steps.

— fixmysite.in
```

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=reports@fixmysite.in

# Google Maps (Phase 2 address check)
GOOGLE_MAPS_API_KEY=

# PostHog
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# Claude
ANTHROPIC_API_KEY=

# Cloudflare R2 (screenshots + brief PDFs)
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET_NAME=fixmysite-briefs
CLOUDFLARE_R2_ENDPOINT=

# Upstash QStash (background queue for Phase 2 deep scan)
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
UPSTASH_QSTASH_URL=https://qstash.upstash.io

# App
NEXT_PUBLIC_APP_URL=https://fixmysite.in
CRON_SECRET=
```

Never commit `.env.local`. All secrets server-side only except `NEXT_PUBLIC_*`.

---

## Pricing Constants

```typescript
// /constants/pricing.ts
export const SCAN_TIERS = {
  small:  { maxPages: 10,  price: 49,  label: 'Small'  },
  medium: { maxPages: 50,  price: 149, label: 'Medium' },
  large:  { maxPages: 200, price: 349, label: 'Large'  },
} as const

export const SUBSCRIPTION_PRICE = 99    // ₹/month
export const AGENCY_PRICE       = 999   // ₹/month

export function getTier(pageCount: number) {
  if (pageCount <= 10)  return SCAN_TIERS.small
  if (pageCount <= 50)  return SCAN_TIERS.medium
  if (pageCount <= 200) return SCAN_TIERS.large
  return null // enterprise — contact us
}

export const BRIEF_PRICING = {
  text_only:        { price: 99,  label: 'Developer Brief' },
  with_screenshots: { price: 199, label: 'Developer Brief + Screenshots' },
  bundle:           { price: 199, label: 'Scan + Brief Bundle' },
} as const

export const PREDEFINED_CARDS = [
  { key: 'looks_old',       label: '🎨 My website looks old' },
  { key: 'mobile_bad',      label: '📱 Doesn\'t look good on mobile' },
  { key: 'seo_poor',        label: '🔍 People can\'t find me on Google' },
  { key: 'contact_hard',    label: '📞 Customers can\'t contact me easily' },
  { key: 'products_hard',   label: '🛒 Hard to show my products/services' },
  { key: 'photos_bad',      label: '📸 My photos look bad' },
  { key: 'slow',            label: '⚡ Website feels slow' },
  { key: 'add_feature',     label: '📝 I want to add something new' },
  { key: 'booking_needed',  label: '📅 I want online booking' },
  { key: 'whatsapp_needed', label: '💬 I want WhatsApp integration' },
  { key: 'payment_needed',  label: '💳 I want to accept payments online' },
  { key: 'language_needed', label: '🌐 I want my website in another language' },
] as const
```

---

## PWA Setup (Serwist — replaces legacy next-pwa)

```typescript
// next.config.ts
import withSerwistInit from '@serwist/next'

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
})

export default withSerwist({ /* NextConfig options */ })
```

```typescript
// app/sw.ts — service worker source
import { defaultCache } from '@serwist/next/worker'
import { Serwist } from 'serwist'

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (string | { url: string; revision: string | null })[]
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [], // no scan result caching — fixmysite rule
})

serwist.addEventListeners()
```

**Why Serwist over next-pwa:** next-pwa is unmaintained and incompatible with Next.js 15+. Serwist is the maintained successor (built on Workbox), works with Next 16 + Turbopack, and is what the Next.js team currently recommends for App Router PWAs.

```json
// public/manifest.json
{
  "name": "fixmysite.in",
  "short_name": "fixmysite",
  "description": "Website health checker for Indian businesses",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#0F6E56",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

## Build Rules for Claude Code

1. **Read SPEC.md first** before writing any code
2. **Read this file (CLAUDE.md) every session** — do not rely on memory
3. Never skip SSRF check before any outbound URL fetch
4. Never return full report data without verifying `payment_status = 'paid'`
5. Never call Twilio more than once per unique phone number per scan
6. Never call Claude API mid-scan — only after all checks complete
7. Always use `url_normalized` for deduplication and storage
8. Phase 1 and Phase 2 are separate routes — never merge
9. All monetary values in paise for Razorpay (₹49 = 4900)
10. PDF generation is server-side only — never client-side
11. Subscription webhook must verify signature before any DB write
12. RLS must be verified active after every Supabase migration
13. PostHog events fire client-side for user actions, server-side for payment events
14. Every new API route needs: input validation + rate limit + error logging
15. Mobile-first CSS. Test at 375px width before desktop.
16. Return visit check (`/api/scan/check-previous`) runs at Phase 1, before showing price
17. Free re-scan token is a signed JWT — never a plain scan_id
18. Image age check: HEAD request only, never download the image
19. Lorem ipsum scan: runs on every crawled page, not just homepage
20. UI quality checks: run only after full HTML is available, not during streaming
21. Return message generated by Claude only when `fix_rate >= 0.8` — never for partial fixes
22. `issue.category` must be one of: `contact | links | trust | content | visual | workflow | technical`
23. Claude UX audit runs on max 5 pages per scan — homepage priority, then most linked-to internal pages
24. Workflow HTML checks run on ALL crawled pages — they are fast, no AI cost
25. `userImpact` field is mandatory on every workflow finding — written from user perspective always
26. Two separate Claude calls: (1) full report generation, (2) UX audit per page — never merge into one prompt
27. CLAUDE.md always takes precedence over SPEC.md on conflicts
28. Brief generation is a third separate Claude call — never merge with report or UX audit
29. Screenshots: validate jpg/png/webp only, max 5MB/file, max 10 files before uploading to R2
30. Business type detection: always Claude-detected from URL content — never hardcoded or assumed
31. Brief scan_id must be verified server-side as belonging to a paid scan before generating
32. classifyUrl() runs BEFORE Phase 1 — never skip it
33. Simple sites (1–10 pages): no email required, no verification, scan immediately
34. Standard sites (11–50 pages): generic email accepted, but Phase 2 runs email identity check — never block the scan
35. Complex sites (50+ pages): domain email mandatory, generic blocked with friendly message
36. Email identity check only runs for standard tier (11–50 pages) — not simple, not complex
37. Enterprise / institution paths never auto-scan — always require OTP verification first
38. OTP stored as bcrypt hash — never plain text in DB
39. OTP valid 15 minutes, max 3 attempts, then locked — enforced server-side. Lockout self-heals after 60 seconds — the rule-49 idempotency check resets `otp_attempts` to 0 and issues a fresh OTP. No admin intervention needed for standard lockouts.
40. Free email providers (gmail, yahoo, hotmail etc.) blocked for complex/enterprise/institution — never for simple or standard
41. Email domain must match or be subdomain of site domain for complex/enterprise/institution
42. No scan row created for enterprise/institution until inquiry is manually approved
43. Enterprise pricing set manually per inquiry — never auto-calculated
44. "Fun-seeker" exit (No, just curious) creates zero DB rows, costs zero rupees
45. Report finding `email_identity_mismatch` — written as a business observation, never accusatory
46. Before sending OTP — always run `hasMxRecord()` first. If MX check fails → return 422, do NOT insert DB row
47. `sendOtpEmail` must return a discriminated result `{ success: true } | { success: false; reason: string }` — never throw. Caller always checks success before proceeding
48. If OTP email send fails after DB row is inserted → roll back the DB row immediately. No orphaned rows ever
49. `verify-email` route is idempotent — check for existing pending inquiry before inserting. Resend to existing row if > 60 seconds since last send. Never create duplicate rows for same email + URL
50. Every OTP error state must show a next action. Never leave user stranded without a path forward. Always include manual escape: "Contact us at hello@fixmysite.in"
51. Intake is always optional — never block scan or report generation if owner skips it
52. Intake free text accepts any language — Claude detects language, never reject or validate language
53. Intake context must be prepended to ALL Claude prompts — report generation, UX audit, brief, return message
54. Never store intake in phase1_result or phase2_result — owner_intake table only
55. Post-report intake can be submitted multiple times — always upsert by scan_id, never duplicate rows
56. Budget signal from intake overrides default solution map ordering — "cheap fixes only" = Low effort actions first; "serious investment" = overhaul recommendation unlocked
57. If owner said "lost contact with developer" in intake — solution map uses DIY language, not "ask your developer"
58. Font and colour analysis runs as part of Phase 2 — CSS parsing via extractor, suggestions from Claude
59. Website age calculation uses 4 signals combined: copyright year + meta generator + image Last-Modified average + SSL issue date
60. Industry benchmarks use fixmysite.in's own scan history only — never external data, never competitor names
61. Follow-up questions (Layer 2) max 5 — only show questions triggered by Phase 1 findings
62. If owner mentioned specific concern in text box and we found it — reference their exact words
63. Recommendation (surgical/partial/overhaul) uses combined signal: health_score + site_age_years + owner budget signal
64. Font suggestions matched to business type — never generic "use a nice font"
65. Colour palette suggestion: always 3 colours (primary, secondary, accent) — never just "improve colours"
66. Overhaul recommendation only when site_age >= 5 AND health_score < 60 — never recommend overhaul for healthy old sites
67. Blueprint Engine is a fourth Claude call — completely separate from report, UX audit, and brief
68. Blueprint questions are cascading — never show all questions at once, branch based on answers
69. Blueprint always explains why the recommended type is right AND why alternatives are wrong
70. Blueprint technology suggestions must use Indian context — Razorpay not Stripe, Hostinger not AWS, Indian developer rates
71. Blueprint payment gate: same pattern as scan — create-order → verify → unlock full blueprint
72. Never recommend "custom build" for businesses with budget under ₹50,000 — redirect to feature or platform
73. Blueprint PDF uses same @react-pdf/renderer pattern as report PDF — server-side only
74. Spark Report is the **fifth separate Claude call** — never merge with report / UX audit / brief / blueprint. Separate prompt, separate call, Sonnet 4.6.
75. Spark prompt: Phase 1 always gets 60% of the response weight — Start is the only thing that matters now. Phases 2 and 3 stay deliberately smaller.
76. Spark prompt: `one_thing_today` must be achievable in 2 hours, no equipment needed. This is the most important line on the page.
77. Spark prompt: Indian tools only — Framer, Canva, Behance, Instagram, Fiverr India, Truelancer, college networks. Never Squarespace. Never Upwork US rates. Never patronising — these users have been oversold to before.
78. Spark prompt: honest timelines always — if it takes 6 months to earn ₹10,000/month at 10 hours/week, say so. Overselling income potential to creative builders is a brand-trust failure.
79. **The question engine is a prompt compiler** — applies to Brief, Blueprint, and Spark equally. Every cascading click adds structured context to the Claude prompt without the user writing a sentence. The user expresses themselves through choices; the platform does the writing for Claude. This is not a UX gimmick — it is the core reason these products work better than ChatGPT for non-technical Indian users.

---

## Common Mistakes to Avoid

| Mistake | Correct approach |
|---|---|
| Calling Phase 2 without payment verification | Always check `payment_status = 'paid'` or valid free_rescan JWT |
| Exposing Twilio creds in client component | Server-side only via API route |
| Storing scan HTML in DB | Store extracted structured data only |
| Calling Claude once per issue | Call Claude once with all issues together |
| Using `fetch(userUrl)` directly | Always run `isSafeUrl()` first |
| Razorpay amount in rupees | Always in paise: ₹49 → `4900` |
| Skipping RLS | Check after every migration |
| Caching scan results in service worker | Never cache dynamic scan data |
| Downloading images to check age | HEAD request only — read `Last-Modified` header |
| Hardcoding return message | Always Claude-generated, never static string |
| Giving free re-scan for partial fixes | Only when `fix_rate >= 0.8` — strictly enforced |
| Running UI checks on homepage only | Run HTML workflow checks on ALL crawled pages |
| Merging UX audit into main report prompt | Two separate Claude calls — UX audit is per-page |
| Writing findings from owner's perspective | Always user's perspective: "user tries to... and cannot..." |
| Running Claude UX audit on all pages | Max 5 pages — homepage + 4 most linked internal pages |
| Flagging CTA hrefs in workflow.ts | Only collect them — pass to link checker for HTTP validation |
| Passing raw screenshot binary to Claude | Always base64 encode, pass as image block |
| Making brief screenshots publicly accessible | R2 private bucket only — signed URLs, 1hr expiry |
| Generating brief without verifying scan payment | brief.scan_id must belong to paid scan — verify server-side |
| Hardcoding business type | Always Claude-detected from URL content |
| Merging brief prompt with report prompt | Five separate Claude calls: report / UX audit / brief / blueprint / spark — never collapse |
| Recommending Squarespace, Upwork US rates, or any non-Indian tool in Spark | Indian tools only: Framer, Canva, Behance, Instagram, Fiverr India, Truelancer |
| Giving Spark Phase 1, 2, 3 equal weight in the response | Phase 1 always gets 60% — Start is the only thing that matters now |
| Patronising language in Spark output | These users are smart and have been oversold to before — direction, not motivation |
| Treating the cascading question engine as a UX gimmick | It is a prompt compiler — every click adds structured Claude context. Never replace with a flat form. |
| Accepting gmail for enterprise claim | Free providers blocked for complex/enterprise/institution — never for simple/standard |
| Running Phase 1 before classifyUrl | classifyUrl always runs first — no exceptions |
| Blocking standard site for using Gmail | Standard sites (11–50 pages) are never blocked — flag in report instead |
| Running email identity check on simple sites | Only runs for standard tier (11–50 pages) |
| Running email identity check on complex sites | Complex sites are blocked before scan if no domain email — check is irrelevant |
| Storing OTP as plain text | Always bcrypt hash before storing |
| Auto-approving enterprise inquiry | Manual approval only — you set the price, you approve |
| Creating scan row before enterprise approval | No scan row until manually approved and paid |
| Allowing subdomain mismatch | mail.tatamotors.com is valid for tatamotors.com — check correctly |
| Writing email finding accusatorially | Always frame as business observation: "customers may wonder..." not "you are wrong" |
| Skipping MX check before OTP send | Always run hasMxRecord() first — catches domains with no mail server |
| Letting sendOtpEmail throw | Always return discriminated result — never throw, caller checks success |
| Leaving orphaned DB row on email failure | Roll back inquiry row immediately if sendOtpEmail returns success:false |
| Creating duplicate inquiry rows on retry | Check for existing pending row first — resend to it if > 60s |
| Showing error with no next action | Every error state must include a path forward — retry or contact us |

---

## v1.1 Roadmap

Items deferred from v1 — not blocking ship, worth picking up after first paid scans land.

- **Shared page cache in phase2 orchestrator.** Today `content.ts`, `ui.ts`, and `workflow.ts` each fetch the same crawl pages independently — up to ~40 redundant GETs per scan against the customer's own site. Fix: fetch each crawled URL once in the phase2 orchestrator and fan the HTML out to all three modules. Same change should let `images.ts` accumulate image URLs across the wider crawl instead of homepage-only.
- **CTA cross-reference.** `workflow.ts` collects `cta_to_validate` hrefs but never surfaces them — link checker has already finished by the time workflow runs. Wire post-hoc cross-reference: workflow CTAs that link checker confirmed broken get a dedicated workflow finding ("primary action button leads to a 404").
- **Per-URL link frequency for content scan priority.** Extractor dedupes internal links by pathname, losing how many times each URL appears on the homepage. Page selection in `content.ts` falls back to first-appearance order. Track frequency in the extractor and rank candidate pages by it.
- **UX audit tier-gating.** UX audit costs ~₹4-5 per scan (5 Sonnet calls). On a ₹49 Small-tier scan that's ~10% margin gone; on Medium (₹149) it's 3%. Two options to evaluate after the first 50 paid scans show real cost patterns: (A) gate UX audit to Medium + Large tiers only, or (B) cap Small tier at 3 pages and Medium+ at 5. Decision should be data-driven — keep current 5-page default until we see real conversion + finding-quality numbers.

---

## Brand Rules

- Always: **fixmysite.in** (lowercase, .in always shown)
- Primary colour: `#0F6E56` (teal)
- Accent: `#1D9E75`
- Light surface: `#E1F5EE`
- Font: clean sans-serif, no decorative fonts
- Tone: direct, plain, non-technical, no jargon
- Never: "robust", "seamless", "leverage", "utilize", "ensure"
- Reports written for a clinic owner in Rajkot — not a developer
