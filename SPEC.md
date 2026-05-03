# SPEC.md — fixmysite.in
> Version 1.2 · Bootstrapped · Solo founder · Ahmedabad

---

## 1. Product Summary

**fixmysite.in** is a two-phase website health scanner for Indian local businesses. It detects broken contact info, dead links, SSL issues, outdated content, and trust failures — then delivers a plain-language solution map. Non-technical business owners are the primary audience.

**Tagline:** Is your website working for you?

**Core loop:**
1. User pastes URL
2. Phase 1 pre-scan → page count detected → price confirmed
3. User pays → Phase 2 deep scan begins
4. Free preview shown (partial, blurred locked items)
5. Full report + solution map unlocked after ₹49
6. PDF downloadable · email deliverable · send-to-developer option

---

## 2. Technology Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Runtime | React 19 |
| Styling | Tailwind v4 |
| Hosting | Vercel |
| Database | Supabase (PostgreSQL, Mumbai region) |
| Auth | Supabase Auth (magic link — admin only) |
| Payments | Razorpay |
| Email | Resend |
| Phone verification | Twilio Lookup API |
| PDF generation | `@react-pdf/renderer` (server-side) |
| Analytics | PostHog |
| PWA | Serwist (`@serwist/next`) |
| File storage | Cloudflare R2 (private bucket) |
| Rate limiting | Upstash Redis |

**No mobile app. PWA only.**

---

## 3. PWA Configuration

- `manifest.json` with name, short_name, icons (192×192, 512×512), theme_color `#0F6E56`
- Serwist configured in `next.config.ts` — see CLAUDE.md PWA section
- Service worker source: `app/sw.ts` → compiled to `public/sw.js`
- Offline fallback page: *"You're offline. Paste your URL when back online."*
- `start_url`: `/`
- `display`: `standalone`
- Install prompt handled via `beforeinstallprompt` event
- Service worker caches: static assets, fonts only. Never cache scan results.

---

## 4. Audience Segmentation & URL Classification

Every URL submitted to fixmysite.in follows one of five paths. Classification runs before Phase 1. No URL ever hits a dead end.

---

### Email Verification — Size-Based Rules

Email requirements are determined by **page count**, not just domain type. This is the primary gate.

| Size | Pages | Email Rule | Scan behaviour |
|---|---|---|---|
| Simple | 1–10 | Not required | Scan immediately, no email needed |
| Standard | 11–50 | Generic OK to scan | Scan runs; missing/mismatched domain email flagged in report |
| Complex | 50+ | Domain email mandatory | Generic blocked; domain email + OTP required |
| Enterprise (known large) | Any | Domain email + OTP + manual approval | No self-serve ever |
| Institution (.ac.in etc.) | Any | Domain email + OTP | Special report path |

---

### Simple Sites (1–10 pages)

- No email required at all
- No verification
- Phase 1 → payment → Phase 2 → report
- Generic email fine if owner wants report emailed
- No flags related to email in report
- Target: tutor, freelancer, single-page clinic brochure

---

### Standard Sites (11–50 pages)

- Email optional — asked only for report delivery
- Generic email (Gmail etc.) fully accepted to scan
- **Phase 2 runs an email identity check:**
  - Does the site itself show a domain email anywhere? (extracted by `extractor.ts`)
  - If yes + owner submitted Gmail → flag in report as Trust issue
  - If site has no domain email at all → separate flag in report
- Owner is never blocked — they always get their scan
- The report itself becomes the persuasion tool

**Report finding — mismatch (site has domain email, owner used Gmail):**
> *"Your website shows info@jaydeebjewellers.com as your contact email — but you submitted this scan using a Gmail address. Customers who notice this may wonder if you're the real owner. Use your domain email consistently across all platforms."*
> Priority: Medium · Effort: Low

**Report finding — no domain email anywhere:**
> *"Your website has no professional domain email. Adding info@[yourdomain] costs around ₹500/year and immediately signals that this is a serious business."*
> Priority: Medium · Effort: Low

---

### Complex Sites (50+ pages)

- Domain email mandatory before scan starts
- Generic email → friendly block:
  > *"This looks like a detailed business website with [X] pages. To scan it, please use your work email at [domain] — something like yourname@[domain]. This helps us confirm you manage this site."*
- Domain email entered → OTP sent → verified → scan proceeds as self-serve
- Known large Indian corps → inquiry flow (manual approval)
- If page count > 200 → enterprise contact regardless of email

---

### Five Paths (post page-count + email check)

```
URL submitted → Phase 1 page count detected
      ↓
┌─────────────────────────────────────────────────────┐
│ Path A — Known global large site                    │
│ (amazon.com, meta.com, google.com, etc.)            │
│ → "Are you the admin?" gate                         │
│ → Domain email + OTP                                │
│ → Enterprise inquiry → manual follow-up             │
│ Price: ₹49,999+                                     │
├─────────────────────────────────────────────────────┤
│ Path B — Known large Indian corp                    │
│ (tatamotors.com, reliancedigital.in, etc.)          │
│ → "Are you the admin?" gate                         │
│ → Domain email + OTP                                │
│ → Enterprise India inquiry → manual follow-up       │
│ Price: ₹9,999–₹24,999                              │
├─────────────────────────────────────────────────────┤
│ Path C — Institution / Non-Profit                   │
│ (.ac.in / .edu.in / .gov.in / .org.in / .ngo.in)   │
│ → Domain email + OTP                                │
│ → Special report (accessibility, dept audit, etc.)  │
│ Price: ₹999–₹4,999                                 │
├─────────────────────────────────────────────────────┤
│ Path D — Self-serve (core market)                   │
│ 1–10 pages: no email needed                         │
│ 11–50 pages: generic email OK, flag in report       │
│ 50+ pages: domain email + OTP required              │
│ Price: ₹49 / ₹149 / ₹349                          │
├─────────────────────────────────────────────────────┤
│ Path E — Fun-seeker / no intent                     │
│ Clicked "No, just curious" on admin gate            │
│ → Graceful exit: "Try a site you manage"            │
│ → No scan, no DB row, no cost                       │
└─────────────────────────────────────────────────────┘
```

---

### Classification Logic

```typescript
// /lib/scan/classifier.ts

export type UrlClass =
  | 'global_enterprise'    // Path A
  | 'indian_enterprise'    // Path B
  | 'institution'          // Path C
  | 'self_serve'           // Path D

const GLOBAL_ENTERPRISE_DOMAINS = [
  'amazon.com', 'amazon.in', 'meta.com', 'facebook.com',
  'google.com', 'apple.com', 'microsoft.com', 'netflix.com',
  'uber.com', 'airbnb.com', 'twitter.com', 'linkedin.com',
  // expand as needed — Tranco global top 500
]

const INDIAN_ENTERPRISE_DOMAINS = [
  'tatamotors.com', 'tata.com', 'reliancedigital.in',
  'flipkart.com', 'myntra.com', 'snapdeal.com',
  'infosys.com', 'wipro.com', 'hdfcbank.com',
  'icicibank.com', 'sbi.co.in', 'airtel.in', 'jio.com',
  // expand as needed — Tranco India top 500
]

const INSTITUTION_TLDS = [
  '.ac.in', '.edu.in', '.gov.in', '.gov',
  '.org.in', '.ngo.in', '.mil.in', '.res.in',
]

export function classifyUrl(hostname: string): UrlClass {
  const clean = hostname.replace(/^www\./, '').toLowerCase()

  if (GLOBAL_ENTERPRISE_DOMAINS.some(d =>
    clean === d || clean.endsWith('.' + d)))
    return 'global_enterprise'

  if (INDIAN_ENTERPRISE_DOMAINS.some(d =>
    clean === d || clean.endsWith('.' + d)))
    return 'indian_enterprise'

  if (INSTITUTION_TLDS.some(tld => clean.endsWith(tld)))
    return 'institution'

  return 'self_serve'
}
```

---

### Email Identity Check — Phase 2 (Standard sites only)

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

  // Only runs for standard tier (11–50 pages)
  const siteHasDomainEmail = emailsFoundOnSite.some(e => {
    const d = e.split('@')[1]?.toLowerCase()
    return d && !FREE_PROVIDERS.includes(d) &&
      (d === siteDomain || d.endsWith('.' + siteDomain))
  })

  const ownerUsedFreeEmail = ownerEmail
    ? FREE_PROVIDERS.includes(ownerEmail.split('@')[1]?.toLowerCase())
    : true

  if (siteHasDomainEmail && ownerUsedFreeEmail) {
    return {
      check: 'email_identity_mismatch',
      category: 'trust',
      priority: 'medium',
      effort: 'low',
      detail: `Your website shows a domain email but you used a personal 
               email for this scan. Use your domain email consistently.`,
      action: `Switch to your domain email as your primary address 
               on all platforms including WhatsApp Business.`
    }
  }

  if (!siteHasDomainEmail) {
    return {
      check: 'no_domain_email',
      category: 'trust',
      priority: 'medium',
      effort: 'low',
      detail: `No professional domain email found on your website.`,
      action: `Set up info@${siteDomain} — costs ~₹500/year 
               and immediately signals a serious business.`
    }
  }

  return null
}
```

---

### Domain-Match Verification (Complex + Enterprise + Institution)

**Rule:** For 50+ page sites, enterprise, and institution paths — email domain must match the website domain. Free providers always blocked.

```typescript
// /lib/enterprise/domainMatch.ts

export function isEmailDomainValid(
  email: string,
  siteUrl: string
): { valid: boolean; reason?: string } {
  const emailDomain = email.split('@')[1]?.toLowerCase()
  if (!emailDomain) return { valid: false, reason: 'invalid_email' }

  if (FREE_PROVIDERS.includes(emailDomain))
    return { valid: false, reason: 'free_provider' }

  const siteDomain = new URL(siteUrl).hostname
    .replace(/^www\./, '').toLowerCase()

  const matches = emailDomain === siteDomain ||
    emailDomain.endsWith('.' + siteDomain)

  return matches ? { valid: true } : { valid: false, reason: 'domain_mismatch' }
}
```

---

### OTP Verification Flow

```
User enters work email (e.g. webmaster@tatamotors.com)
      ↓
isEmailDomainValid() → pass
      ↓
6-digit OTP generated → hashed (bcrypt) → stored
      ↓
OTP sent via Resend to that email
      ↓
User enters OTP (15 min window, max 3 attempts)
      ↓
For self-serve complex (50+ pages): scan proceeds
For enterprise / institution: inquiry created → you follow up
```

---

### "Are You The Admin?" UI Flow

Shown when `classifyUrl` returns `global_enterprise` or `indian_enterprise`:

> *"This looks like a large commercial website.*
> *fixmysite.in is built for Indian small businesses — but we scan large sites too, at a different price.*
> *Are you responsible for this website?"*

**[Yes, I manage this site]** → domain email input → OTP → inquiry created → you follow up within 24hr
**[No, just curious]** → *"No problem. Paste a website you manage."* → graceful exit → zero DB rows

---

### Institution Path — Special Report Focus

When `classifyUrl` returns `institution`:

Additional Phase 2 checks:
- Accessibility: alt text coverage %, colour contrast (WCAG AA)
- Department pages: each sub-domain / department scanned separately
- Outdated content: past event dates, expired deadlines still showing
- Critical workflows: admission form, grievance portal, donation form — full workflow audit
- Faculty/contact directory: broken profiles, outdated designations

Institution pricing (after domain-match OTP verified):

| Institution Type | Domain Signal | Price |
|---|---|---|
| NGO / Non-profit | `.ngo.in`, `.org.in` | ₹999 |
| College / University | `.ac.in`, `.edu.in` | ₹2,999 |
| Government body | `.gov.in`, `.gov` | ₹4,999 |
| Research institute | `.res.in` | ₹2,999 |

---

## 5. Scan Architecture — Two Phases

### Phase 0 — Owner Intake Form (Pre-Scan + Post-Phase1)

Two conversation layers — before and after Phase 1 — so Claude has owner context before generating the report.

#### Layer 1 — Pre-Scan Intake (shown after URL entered, before Phase 1)

Optional. Takes 45 seconds. Stored in `scans.intake_form` JSONB.

**Section A — About Your Business**
```
Business type (confirms Claude's auto-detection):
○ Medical / Healthcare  ○ Legal / CA / Finance
○ Education / Coaching  ○ Retail / Shop
○ Restaurant / Food     ○ Real Estate
○ Salon / Beauty        ○ Hotel / Travel
○ Manufacturing         ○ Other: [text]

Where are most of your customers?
○ My city  ○ My state  ○ All India  ○ International

How do customers find you? (multi-select)
☐ Google search    ☐ Google Maps
☐ WhatsApp         ☐ Walk-in / offline
☐ Social media     ☐ The website itself
```

**Section B — About Your Website**
```
Who manages your website?
○ A developer / agency (I call them when needed)
○ I built it myself (WordPress, Wix, etc.)
○ A student / relative built it
○ I manage it myself regularly
○ I don't know

When was it last updated?
○ Within 6 months  ○ 1–2 years ago
○ 3–5 years ago    ○ 5+ years ago  ○ I don't know

Do you get enquiries through the website?
○ Yes, regularly  ○ Occasionally  ○ Rarely / never
```

**Section C — What Bothers You**
```
Why are you scanning today? (multi-select)
☐ I think something is broken
☐ Customers complained they couldn't reach me
☐ I want to improve but don't know where to start
☐ Haven't checked in a long time
☐ Someone suggested I check it

What do you MOST want from your website? (pick one)
○ More people to find me on Google
○ Customers to contact me easily
○ People to trust my business
○ Online booking / appointments
○ Sell products online
○ Show my work / portfolio
○ Just a basic presence

Anything specific you want us to look at?
[Plain text — any language]
```

**Section D — Budget Signal**
```
If we find problems, what are you open to?
○ Quick cheap fixes only (under ₹2,000)
○ Moderate fixes (₹2,000–₹10,000)
○ Proper redesign if needed (₹10,000+)
○ Just tell me what's wrong — I'll decide later
```

#### Layer 2 — Post-Phase1 Follow-Up (shown on /scanning/[scan_id], before payment)

Maximum 5 questions. Each triggered only if relevant to what Phase 1 found. Stored in `scans.followup_form` JSONB.

```typescript
// Trigger logic — show only relevant questions
const followUps = []

if (phones.length > 0)
  followUps.push({
    id: 'phone_working',
    q: `We found ${phones[0]} on your site. Is it currently active?`,
    type: 'yes_no_unsure'
  })

if (siteAge > 3)
  followUps.push({
    id: 'planning_redesign',
    q: `Your site appears to be from ${year}. Are you already planning a redesign?`,
    type: 'yes_no'
  })

if (!hasContactForm)
  followUps.push({
    id: 'wants_contact_form',
    q: `We didn't find a contact form. Would you like one added?`,
    type: 'yes_no_already_have'
  })

if (hasProductPages)
  followUps.push({
    id: 'payment_working',
    q: `We found product pages. Can customers currently pay online?`,
    type: 'yes_no_unsure'
  })

if (hasWhatsAppButton)
  followUps.push({
    id: 'whatsapp_active',
    q: `We found a WhatsApp button. Is that number active on WhatsApp?`,
    type: 'yes_no'
  })
```

#### How Claude Uses Owner Context

All intake + follow-up answers merged into `scans.owner_context` JSONB and passed into every Claude prompt:

```typescript
const ownerContext = {
  businessType,        // confirmed or Claude-detected
  customerReach,       // city / state / india / international
  discoveryChannels,   // ['google', 'walkin', 'whatsapp']
  siteManager,         // 'developer' | 'self' | 'unknown'
  lastUpdated,         // '3_5_years' | 'within_6_months' etc.
  receivesEnquiries,   // 'regularly' | 'rarely' | 'never'
  primaryGoal,         // 'contact_easily' | 'google_seo' etc.
  specificConcern,     // owner's own words in their language
  budgetSignal,        // 'cheap_fixes' | 'moderate' | 'redesign'
  followUps: {
    phoneWorking,      // 'yes' | 'no' | 'unsure'
    planningRedesign,  // 'yes' | 'no'
    wantsContactForm,  // 'yes' | 'no' | 'already_have'
    paymentWorking,    // 'yes' | 'no' | 'unsure'
    whatsappActive,    // 'yes' | 'no'
  }
}
```

**Claude system prompt addition:**
```
Owner provided this context before the scan:
${JSON.stringify(ownerContext)}

Use this to:
1. Prioritise findings matching owner's primary goal
2. Calibrate effort estimates to budget signal
3. If owner mentioned a specific concern and we found it —
   reference their exact words in that finding
4. Tone: if siteManager='self' → plain language, no jargon
          if siteManager='developer' → technical terms OK
5. Recommendation (surgical/partial/overhaul) combines:
   health_score + site_age + owner's budget signal
6. If owner said their phone is working but Twilio says
   otherwise — flag the discrepancy explicitly
```

**The Magic Moment:**
Owner writes: *"मेरा contact form काम नहीं करता"*
Report says: *"You mentioned your contact form isn't working — and you're right. We found that the form on your contact page has no destination address (missing action attribute). Every enquiry submitted there disappears into nothing. Your developer can fix this in under 30 minutes."*

They feel heard. Not just scanned.

#### New DB Columns

```sql
-- Add to scans table
intake_form    jsonb    -- pre-scan owner answers (Layer 1)
followup_form  jsonb    -- post-phase1 owner answers (Layer 2)
owner_context  jsonb    -- merged context passed to Claude
```

---

### Phase 1 — Pre-scan (free, ~5 seconds)

Triggered immediately on URL submit. No payment required.

Checks:
- Site reachability (HTTP HEAD request)
- `robots.txt` — crawl permission
- `sitemap.xml` — page count estimate
- If no sitemap: crawl homepage links, estimate pages
- Basic SSL validity (certificate present, not expired)

Output:
```
nirujclinic.com is reachable.
We found ~23 pages.
This is a Small scan → ₹49
```

Pricing gate shown. User confirms → Razorpay opens.

### Phase 2 — Deep scan (post-payment)

Runs in background after payment confirmed. Results stream to UI as checks complete.

**Contact Layer**
- All phone numbers extracted via regex from full page HTML
- Each number → Twilio Lookup API (active? landline/mobile? WhatsApp-capable?)
- All email addresses → MX record check + SMTP handshake (no mail sent)
- WhatsApp numbers → Twilio Lookup (WhatsApp-capable flag)
- Physical address → Google Maps Geocoding API (resolves? correct pin?)

**Links & Pages**
- All internal links → HTTP status check (200/301/404/500)
- All external links → HTTP status check
- Contact form endpoint → reachable? (GET only, no submit)
- Appointment/booking links → reachable?

**Trust Signals**
- SSL certificate: valid, expiry date
- Copyright year in footer: outdated?
- Google Business NAP match (if detectable)
- Social profile links: do they resolve?
- Google Maps embed: present and loading?

**Technical Health**
- Page load response time (ms)
- `robots.txt` presence
- `sitemap.xml` presence
- Meta title and description: present? length acceptable?
- Favicon: present?

**Content Quality**
- Lorem ipsum detection: scan all visible text for placeholder strings
  - Patterns: "lorem ipsum", "your text here", "sample content", "coming soon" (on non-placeholder pages), "insert name here", "placeholder", "dummy text", "test content"
  - Flag exact location: page URL + element type (heading / paragraph / button)
- Thin content: pages with fewer than 50 words of visible text
- Missing About page, missing Contact page (common for small business sites)

**Visual & UI Checks**
- Old images: HTTP HEAD on every `<img>` src → read `Last-Modified` header
  - Flag images with `Last-Modified` older than 3 years
  - Report: filename, URL, last modified date
- Missing alt text on images (accessibility + SEO)
- No clear CTA (call-to-action) visible on homepage: check for buttons, prominent links
- Contact info buried: phone/address not in header or above-the-fold
- No trust indicators: years in business, certifications, awards, testimonials section
- Wall of text: paragraph blocks with no headings or subheadings detected
- Tiny font size (CSS `font-size` below 13px on body text if detectable)
- Navigation overload: more than 7 menu items → cognitive overload flag
- Footer completeness: address, phone, email, copyright all present?
- Above-the-fold clarity: does homepage communicate what business does within 3 seconds?

**Typography & Font Checks (Vitamin Pack)**
- Extract all `font-family` declarations from CSS
- More than 3 font families → flag as confusing
- System fonts only (Arial, Times New Roman, Georgia) → flag as dated
- Decorative font used for body text → flag as hard to read on mobile
- No web font loaded → flag as no typographic identity
- Comic Sans / Papyrus → critical flag (firm but kind)
- Claude suggests 2–3 alternatives matched to business type:
  - Clinic → *"Consider Inter or Lato — clean, medical, trustworthy"*
  - Jewellery → *"Consider Playfair Display + Lato — elegant, readable"*
  - Restaurant → *"Consider Poppins — warm, approachable, modern"*

**Colour & Brand Checks (Vitamin Pack)**
- Extract CSS `color`, `background-color`, `--primary` variables
- Text vs background contrast ratio check (WCAG AA minimum 4.5:1)
- White text on light background → flag
- Dark text on dark background → flag
- More than 5 distinct brand colours → scattered brand identity
- No consistent primary colour → no brand identity
- Neon or clashing combinations → flag with specific suggestion
- Claude suggests 3-colour palette (primary, secondary, accent) matched to business type

**Website Age Assessment (Vitamin Pack)**
Four signals combined:
- Copyright year in footer (most reliable)
- `<meta name="generator">` tag (reveals CMS version + release year)
- Average `Last-Modified` of page images (proxy for last content update)
- SSL certificate issue date (if old and never renewed → site untouched)

Age tiers:
- Under 2 years → minor refresh suggestions only
- 2–4 years → moderate update recommended
- 4+ years AND score < 60 → full overhaul conversation

Report finding example:
> *"Based on your footer copyright and image dates, this website appears to have last been updated in 2019 — 6 years ago. A site that looked modern in 2019 now signals to visitors that the business may be inactive."*

**Surgical vs Overhaul Recommendation (Vitamin Pack)**

After all checks complete, Claude makes a holistic recommendation:

```
health_score >= 70                    → Surgical fixes (2–3 days)
health_score 40–69                    → Significant updates (1–2 weeks)
health_score < 40                     → Full overhaul (3–4 weeks)
site_age >= 5 years AND score < 60    → Full overhaul regardless
```

Three possible recommendations:

**Surgical:** *"Your website's foundation is solid. The issues we found are specific and fixable without redesigning anything."*

**Partial redesign:** *"Your website has structural problems that individual fixes won't solve. We recommend redesigning the homepage, contact page, and services page while keeping the rest."*

**Full overhaul:** *"This website was built in [year] and shows it. The most cost-effective path forward is a fresh build rather than patching the existing site."*

**Industry Benchmark (Vitamin Pack)**
- Aggregate data only — no competitor names, no specific URLs
- *"The average health score for clinics in Ahmedabad is 61/100. Your score is 34/100."*
- *"Clinics with scores above 70 typically have: online booking, working contact form, professional domain email."*
- Benchmarks built from fixmysite.in's own scan history — no external data needed

**Workflow & User Experience (HTML layer)**

Forms:
- `<form>` present but no `action` or `method` attribute → goes nowhere
- `<input type="file">` present but no nearby submit button
- `<input type="file">` with no `accept` attribute shown to user (file type not communicated)
- File upload input with no size limit mentioned in surrounding text
- Form fields with no `<label>` → user doesn't know what to fill
- Required fields not marked (`required` attribute missing, no asterisk visible)
- Submit button text is generic: "Submit", "Send", "Go" with zero context
- No success/error message state detectable in HTML (no hidden confirmation div)
- Multi-step form with no step indicator
- Date fields with no format hint (DD/MM/YYYY ambiguity)
- Phone/mobile fields with no country code guidance

CTAs & Buttons:
- "Apply Now", "Book Now", "Enquire", "Register" buttons linking to 404
- "Download Brochure" / "Download Form" links returning non-200
- CTA button linking to an email that fails MX check
- WhatsApp button with number not WhatsApp-capable (Twilio cross-check)
- Payment/checkout button present but payment gateway script not detected in page
- Login / Register links present but destination unreachable
- Search bar present but no results page detectable

Dead-ends:
- Page with primary content but zero next-action available (no button, no link, no form)
- "Coming soon" section blocking core functionality
- Appointment/booking page exists but calendar or booking widget script not loading

**Workflow & User Experience (Claude AI layer)**

After HTML checks, Claude reads the full page and performs a user journey audit:

For each page Claude asks:
1. What is the most likely reason a visitor lands on this page?
2. Can that task be completed start to finish?
3. Where would a real user get confused, stuck, or give up?

Claude flags:
- Ambiguous CTAs ("Click here", "Learn more" with no context)
- Missing instructions on upload/form sections
- Incomplete workflows (steps 1–2 visible, step 3 missing or broken)
- Contradictory information (different hours in header vs footer)
- No confirmation path after form submission
- Jargon without explanation (GSTIN, CIN, NOC — no tooltip or help text)
- Mobile usability issues detectable from HTML (buttons too close, tiny tap targets)
- Process described in text but no actual mechanism to do it on the page

All Claude UX findings written from the user's perspective, not the owner's.

**Claude Agent**
After all checks complete — HTML layer + Claude UX layer both done — Claude (`claude-sonnet-4-20250514`) generates:
- Plain-language finding per issue, written for a non-technical owner
- User impact: what a real visitor experiences at this exact failure point
- Priority: High / Medium / Low
- Effort: Low / Medium / High
- Specific action the owner or developer must take
- Solution map ordered by priority × effort

---

## 6. Pricing Structure

### Scan tiers (by pages detected in Phase 1)

| Tier | Pages | Price |
|---|---|---|
| Small | ≤ 10 pages | ₹49 |
| Medium | 11–50 pages | ₹149 |
| Large | 51–200 pages | ₹349 |
| Enterprise | 200+ pages | Contact |

Price shown and confirmed before any payment is taken.

### Subscription

- ₹99/month — monthly re-scan of registered URL
- Alert email + WhatsApp if new issues detected
- Cancel anytime

### Agency / White Label

- ₹999/month — unlimited scans, PDF carries agency branding
- Managed via admin panel

---

## 7. Return Visit Intelligence

When a URL is submitted that already has a previous **completed, paid scan** in the DB:

### Detection
Query `scans` table: `WHERE url_normalized = ? AND payment_status = 'paid' AND status = 'complete' ORDER BY created_at DESC LIMIT 1`

If a previous scan exists → trigger comparison flow instead of standard flow.

### Comparison Logic
Phase 2 runs normally. After results are collected, compare new `issues` against previous scan's `issues` for same `url_normalized`:

```
resolved_count   = issues that were 'fail' last time, now 'ok'
new_count        = issues that are 'fail' now but were not flagged last time
unchanged_count  = issues that were 'fail' last time and still 'fail'
high_resolved    = resolved issues where priority = 'high'
high_total       = total high priority issues from previous scan
fix_rate         = high_resolved / high_total (if high_total > 0)
```

### Free Re-scan Rule
**Condition:** `fix_rate >= 0.8` (80% or more of High priority issues are resolved)

If condition met:
- Phase 2 scan is **free** — no Razorpay payment required
- Full report unlocked immediately
- Warm return message shown (see below)
- PostHog event: `free_rescan_earned`

If condition NOT met:
- Normal payment required
- Show progress message: *"You've fixed X of Y critical issues since your last scan. Almost there."*
- PostHog event: `return_visit_paid`

### Return Message (when free re-scan earned)

Shown at top of full report. Claude generates this dynamically based on what was fixed. Tone: warm, specific, encouraging. Never generic.

Example outputs (Claude writes these, not hardcoded):
- *"Your landline is back, your links are clean, and your SSL is solid. The patients who tried to call before — they'll get through now."*
- *"Three of your four critical issues are resolved. Your website is doing its job again."*
- *"Good work acting on the report. The fixes you made are the ones that matter most to someone searching for you."*

Rules for Claude when writing return message:
- Reference specific issues that were fixed (by name, not category)
- Never use the word "congratulations"
- Never say "great job" or "well done"
- Keep it to 2 sentences maximum
- Business-impact framing — what this means for their customers, not for their website

### DB Changes for Return Visit

Add to `scans` table:
```sql
previous_scan_id   uuid references scans(id)  -- null for first scan
is_free_rescan     boolean default false
fix_rate           numeric(4,2)               -- 0.00 to 1.00
resolved_count     int
new_issues_count   int
unchanged_count    int
return_message     text                        -- Claude-generated
```

### API Route Addition
```
POST /api/scan/check-previous   → returns previous scan summary if URL exists
```

Called at Phase 1 stage, before showing price. If previous scan found:
- Show: *"We've scanned this site before (last scan: 12 March 2025). Checking if your fixes worked..."*
- Phase 1 still runs
- Price shown only if free re-scan not earned

---

### Free Preview (shown before payment on Medium/Large or after payment gate on Small)

- Phase 1 results: reachability, page count, SSL
- First 2 contact findings (one pass, one fail)
- Remaining items blurred with lock overlay
- Broken items count visible: *"4 issues found"*
- CTA: *"Get full report — ₹49"*

### Full Report (post-payment)

Sections:
1. **Return message** — if free re-scan earned, Claude-generated warm message at top
2. **Summary card** — site URL, scan date, total issues, health score (0–100), delta vs last scan if applicable
3. **Contact verification** — each phone, email, WhatsApp with status and note
4. **Links & pages** — broken links list with exact URLs
5. **Trust signals** — SSL expiry, copyright year, social links
6. **Content quality** — lorem ipsum findings, thin pages, missing pages
7. **Visual & UI** — old images (with Last-Modified dates), missing alt text, CTA gaps, trust indicators
8. **Workflow & UX** — form problems, broken upload flows, dead-end CTAs, Claude user journey findings
9. **Technical health** — speed, meta tags, sitemap, favicon
10. **Solution map** — all issues ordered by priority × effort, each with exact action + user impact
11. **Send to developer** — enter developer email → report emailed automatically

### PDF Report

- Generated server-side via `@react-pdf/renderer`
- Branded: fixmysite.in header, scan date, URL, owner details if provided
- Downloadable instantly post-payment
- Also attached to confirmation email via Resend
- PDF includes full solution map with checkboxes (printable)

### Email Delivery

Triggered events → Resend:
1. Payment confirmed → full report email (PDF attached)
2. Send-to-developer clicked → report emailed to developer
3. Monthly re-scan (subscription) → alert email with diff from last scan
4. Scan complete notification (if user navigated away)

---

## 8. Database Schema (Supabase)

### `scans`
```sql
id                uuid primary key default gen_random_uuid()
url               text not null
url_normalized    text not null
page_count        int
tier              text -- small | medium | large | enterprise
status            text -- phase1_complete | paid | scanning | complete | failed
phase1_result     jsonb
phase2_result     jsonb
report_json       jsonb
health_score      int
created_at        timestamptz default now()
completed_at      timestamptz
payment_id        text
payment_status    text
owner_email       text
previous_scan_id  uuid references scans(id)
is_free_rescan    boolean default false
fix_rate          numeric(4,2)
resolved_count    int
new_issues_count  int
unchanged_count   int
return_message    text
```

### `issues`
```sql
id          uuid primary key default gen_random_uuid()
scan_id     uuid references scans(id)
category    text -- contact | links | trust | content | visual | workflow | technical
item        text
status      text -- ok | fail | warning
detail      text
priority    text -- high | medium | low
effort      text -- low | medium | high
action      text
```

### `subscriptions`
```sql
id              uuid primary key default gen_random_uuid()
url             text not null
owner_email     text not null
plan            text -- monthly | agency
razorpay_sub_id text
status          text -- active | cancelled | paused
last_scan_id    uuid references scans(id)
next_scan_at    timestamptz
created_at      timestamptz default now()
```

### `developer_sends`
```sql
id          uuid primary key default gen_random_uuid()
scan_id     uuid references scans(id) on delete cascade
dev_email   text
sent_at     timestamptz
status      text -- sent | failed
```

### `enterprise_inquiries`
```sql
id                  uuid primary key default gen_random_uuid()
url                 text not null
url_normalized      text not null
url_class           text not null  -- global_enterprise | indian_enterprise | institution
claimed_email       text not null
email_domain        text not null  -- extracted from claimed_email
url_domain          text not null  -- extracted from submitted URL
domain_match        boolean not null
otp_code            text           -- hashed, not plain
otp_sent_at         timestamptz
otp_verified        boolean default false
otp_verified_at     timestamptz
otp_attempts        int default 0
manually_approved   boolean default false
manually_approved_by text          -- admin email
status              text default 'pending'
                    -- pending | otp_verified | approved | rejected | converted
institution_type    text           -- ngo | college | university | government | research
quoted_price        int            -- in paise, set manually before approval
notes               text           -- internal notes
created_at          timestamptz default now()
updated_at          timestamptz default now()
```

### `briefs`
```sql
id                uuid primary key default gen_random_uuid()
scan_id           uuid references scans(id)
owner_input       text                        -- original words, any language, preserved verbatim
detected_language text                        -- Claude-detected (en | hi | gu | mr | ta | etc.)
business_type     text                        -- Claude-detected from URL (clinic | retail | restaurant | etc.)
screenshots       jsonb                       -- array of R2 signed URLs
predefined_selections jsonb                   -- array of selected nudge card keys
brief_json        jsonb                       -- structured brief output from Claude
brief_pdf_url     text                        -- R2 signed URL, 24hr expiry
payment_id        text
payment_status    text default 'unpaid'
owner_email       text
dev_email         text
created_at        timestamptz default now()
sent_at           timestamptz
```

### `developer_partners` (introduced §19)
```sql
id               uuid primary key default gen_random_uuid()
name             text not null
email            text unique not null
phone            text not null
city             text not null
skills           text[]
portfolio_url    text
years_exp        int
plan             text default 'free'  -- free | agency
rating           numeric(3,2)
jobs_completed   int default 0
referral_count   int default 0
earnings_total   int default 0        -- in paise
verified         boolean default false
active           boolean default true
agency_name      text
agency_logo_url  text                 -- R2 signed URL
created_at       timestamptz default now()
updated_at       timestamptz default now()
```

### `developer_leads` (introduced §19)
```sql
id               uuid primary key default gen_random_uuid()
scan_id          uuid references scans(id)
developer_id     uuid references developer_partners(id)
status           text default 'sent'
                 -- sent | accepted | declined | completed
fee_paise        int
fee_collected    boolean default false
owner_rating     int                  -- 1–5 stars
owner_review     text
sent_at          timestamptz default now()
responded_at     timestamptz
completed_at     timestamptz
```

---

## 9. API Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/scan/classify-url` | Classify URL before Phase 1 — returns path type |
| POST | `/api/scan/phase1` | Pre-scan: reachability + page count |
| POST | `/api/scan/check-previous` | Check if URL has prior paid scan |
| POST | `/api/scan/phase2` | Deep scan (auth: valid payment_id or free_rescan) |
| POST | `/api/payment/create-order` | Razorpay order creation |
| POST | `/api/payment/verify` | Razorpay signature verification |
| GET | `/api/report/[scan_id]` | Fetch report JSON |
| POST | `/api/report/pdf` | Generate + return PDF |
| POST | `/api/report/send-developer` | Email report to developer |
| POST | `/api/enterprise/verify-email` | Validate domain match + send OTP |
| POST | `/api/enterprise/verify-otp` | Verify OTP → create inquiry |
| GET | `/api/admin/inquiries` | Admin: list enterprise inquiries (protected) |
| POST | `/api/admin/inquiries/[id]/approve` | Admin: approve + set price |
| POST | `/api/brief/generate` | Generate developer brief from owner input + screenshots |
| POST | `/api/brief/pdf` | Generate brief as downloadable PDF |
| POST | `/api/brief/send` | Email brief to developer |
| POST | `/api/brief/payment/create-order` | Razorpay order for brief |
| POST | `/api/brief/payment/verify` | Verify brief payment |
| POST | `/api/subscription/create` | Create Razorpay subscription |
| POST | `/api/subscription/webhook` | Razorpay subscription events |
| GET | `/api/admin/scans` | Admin: list all scans (protected) |
| GET | `/api/admin/briefs` | Admin: list all briefs (protected) |
| POST | `/api/developer/register` | Submit partner registration (§17) |
| GET | `/api/developer/profile/[id]` | Public partner profile (§17) |
| POST | `/api/developer/lead/accept` | Accept a lead (§17) |
| POST | `/api/developer/lead/decline` | Decline a lead (§17) |
| GET | `/api/developer/dashboard` | Dashboard data (auth, §19) |
| POST | `/api/admin/developer/approve` | Admin: approve partner (§17) |
| POST | `/api/admin/developer/reject` | Admin: reject partner (§17) |

All routes: rate-limited, input-validated, error-logged.

---

## 10. Security

- All API routes: input sanitisation, URL validation (no private IPs, no localhost, no internal ranges)
- SSRF protection: block `127.0.0.1`, `10.x`, `192.168.x`, `169.254.x`, `::1`
- Razorpay webhook: signature verified on every event
- Twilio credentials: server-side only, never exposed to client
- Supabase: RLS enabled on all tables
- Rate limiting: 5 scans/hour per IP (Phase 1), 1 scan/hour per IP (Phase 2)
- No user accounts required for one-time scan
- HTTPS enforced, HSTS headers set
- CSP headers configured in `next.config.js`
- PDF download: signed URL with 1-hour expiry

---

## 11. Page Structure

```
/                         → Landing + URL input
/scanning/[scan_id]       → Phase 1 result + pricing gate
/report/[scan_id]         → Free preview (pre-payment)
/report/[scan_id]/full    → Full report (post-payment)
/brief/[scan_id]          → Developer brief generator (post-scan upsell)
/brief/[scan_id]/preview  → Brief preview (pre-payment)
/brief/[scan_id]/full     → Full brief + PDF download (post-payment)
/subscribe                → Monthly plan page
/agency                   → Agency / white-label plan
/admin                    → Internal admin (protected)
/privacy                  → Privacy policy
/terms                    → Terms of service
/developer                → Developer landing page (§17)
/developer/dashboard      → Agency dashboard (auth, §19)
/developer/register       → Partner registration (§17)
/developer/profile/[id]   → Public partner profile (§17)
/developer/report/[token] → Receiving developer view (§17)
/institution              → Institution upsell stub (§4)
```

---

## 12. SEO & Discovery

- Static landing page: fully SSR, fast TTFB
- Meta: *"Free website health check for Indian businesses. Detect broken phone numbers, links, SSL issues instantly."*
- sitemap.xml auto-generated
- robots.txt: allow all except `/admin`, `/api`
- Structured data: `WebApplication` schema
- OG image: auto-generated per scan result (shareable)
- Target keywords: website health check India, broken website checker, fix my website, website audit tool India

---

## 13. Analytics (PostHog)

Events to track:

| Event | Properties |
|---|---|
| `url_submitted` | url, timestamp |
| `previous_scan_found` | url, days_since_last_scan |
| `free_rescan_earned` | url, fix_rate, resolved_count |
| `return_visit_paid` | url, fix_rate, resolved_count |
| `phase1_complete` | page_count, tier, price |
| `payment_initiated` | tier, price |
| `payment_complete` | tier, price, scan_id |
| `report_viewed` | scan_id |
| `pdf_downloaded` | scan_id |
| `report_sent_to_developer` | scan_id |
| `subscription_created` | plan |
| `pwa_installed` | platform |
| `lorem_ipsum_found` | scan_id, count |
| `old_images_found` | scan_id, count, oldest_image_years |
| `brief_started` | scan_id, input_method (text\|screenshot\|predefined\|mixed) |
| `brief_payment_complete` | scan_id, price |
| `brief_generated` | scan_id, business_type, language |
| `brief_pdf_downloaded` | scan_id |
| `brief_sent_to_developer` | scan_id |
| `predefined_card_selected` | card_key, scan_id |
| `screenshot_uploaded` | scan_id, count |
| `fun_seeker_exit` | hostname, url_class (§4 Path E) |
| `developer_cta_clicked` | source (landing / report / email) (§17) |
| `developer_registered` | city, skills_count (§17) |
| `developer_approved` | developer_id (§17) |
| `developer_lead_sent` | scan_id, developer_id (§17) |
| `developer_lead_accepted` | lead_id (§17) |
| `developer_lead_declined` | lead_id (§17) |
| `agency_plan_subscribed` | developer_id (§17) |
| `white_label_report_downloaded` | scan_id (§17) |

---

## 14. Revenue Model Summary

| Stream | Price | Path | Notes |
|---|---|---|---|
| One-time scan (Small) | ₹49 | Self-serve | Core product |
| One-time scan (Medium) | ₹149 | Self-serve | Auto-detected |
| One-time scan (Large) | ₹349 | Self-serve | Auto-detected |
| Developer brief (text + predefined) | ₹99 | Self-serve | Post-scan upsell |
| Developer brief + screenshots | ₹199 | Self-serve | Post-scan upsell |
| Bundle: scan + brief | ₹199 | Self-serve | Discounted bundle |
| Monthly re-scan | ₹99/month | Self-serve | Subscription |
| Agency / white-label | ₹999/month | Self-serve | B2B |
| NGO / Non-profit scan | ₹999 | Institution | Domain verified |
| College / University scan | ₹2,999 | Institution | Domain verified |
| Government body scan | ₹4,999 | Institution | Domain verified |
| Enterprise India scan | ₹9,999–₹24,999 | Enterprise | Manual approval |
| Global enterprise scan | ₹49,999+ | Enterprise | Manual approval |
| Developer leads | ₹200–500/lead | Future | Future phase |

Target PAT: 25% at scale. Gross margin per scan: ~88%.

### Enterprise Pricing Constants
```typescript
export const ENTERPRISE_PRICING = {
  institution_ngo:        { price: 99900,   label: 'NGO / Non-profit' },
  institution_college:    { price: 299900,  label: 'College / University' },
  institution_government: { price: 499900,  label: 'Government body' },
  indian_enterprise_min:  { price: 999900,  label: 'Enterprise India (min)' },
  indian_enterprise_max:  { price: 2499900, label: 'Enterprise India (max)' },
  global_enterprise_min:  { price: 4999900, label: 'Global Enterprise (min)' },
  // All in paise. Actual price set manually per inquiry.
} as const
```

### Brief Pricing Constants
```typescript
export const BRIEF_PRICING = {
  text_only:    { price: 99,  label: 'Brief — text & selections' },
  with_screenshots: { price: 199, label: 'Brief — with screenshots' },
  bundle:       { price: 199, label: 'Scan + Brief bundle' },
} as const
```

---

## 15. Developer Brief Generator

### Purpose
After a health scan, the owner may want to go beyond fixing problems — they want to improve their website. But they cannot communicate technical requirements to their developer. This module translates plain human intent (in any Indian language) into a structured, professional developer brief.

### Three Input Methods

**1. Plain text — any language**
Free-text box. Owner writes naturally:
- *"मुझे ये पेज थोड़ा सुंदर बनाना हे"*
- *"contact page kaam nathi karti"*
- *"I want people to book appointment online"*
Claude detects language, preserves original words in brief, translates intent.

**2. Screenshots (up to 10)**
Owner uploads screenshots of pages that feel "off". No explanation needed.
Claude analyses each screenshot visually and infers what is wrong and what the owner likely wants changed.
Storage: Cloudflare R2, private bucket, signed URL per screenshot.

**3. Predefined nudge cards**
For owners who cannot articulate. Tap cards that apply:

| Card Key | Label |
|---|---|
| `looks_old` | 🎨 My website looks old |
| `mobile_bad` | 📱 Doesn't look good on mobile |
| `seo_poor` | 🔍 People can't find me on Google |
| `contact_hard` | 📞 Customers can't contact me easily |
| `products_hard` | 🛒 Hard to show my products/services |
| `photos_bad` | 📸 My photos look bad |
| `slow` | ⚡ Website feels slow |
| `add_feature` | 📝 I want to add something new |
| `booking_needed` | 📅 I want online booking |
| `whatsapp_needed` | 💬 I want WhatsApp integration |
| `payment_needed` | 💳 I want to accept payments online |
| `language_needed` | 🌐 I want my website in another language |

Owner can mix all three methods.

### Business Type Detection
Claude reads the scanned URL content and detects business category:

| Business Type | Key signals Claude looks for |
|---|---|
| `clinic` | doctor, patient, appointment, medicine, health |
| `retail_clothing` | fabric, saree, dress, kurti, cloth, stitch |
| `restaurant` | menu, food, dining, reservation, cuisine |
| `legal` | advocate, lawyer, court, legal, LLB |
| `education` | school, college, tuition, classes, students |
| `ca_finance` | chartered, audit, tax, GST, finance |
| `real_estate` | property, flat, rent, sale, builder |
| `salon_beauty` | salon, beauty, hair, skin, spa |
| `gym_fitness` | gym, fitness, trainer, workout |
| `general` | fallback for unrecognised types |

Business type shapes the brief language, terminology, and recommendations.

### Brief Output Structure

```json
{
  "business_type": "retail_clothing",
  "detected_language": "hi",
  "owner_original_words": "मुझे ये पेज थोड़ा सुंदर बनाना हे",
  "intent_summary": "Owner wants the product listing page to look cleaner and more appealing",
  "sections": [
    {
      "title": "Visual Redesign — Product Listing Page",
      "priority": "high",
      "effort": "3–5 days",
      "owner_words": "मुझे ये पेज थोड़ा सुंदर बनाना हे",
      "technical_brief": "Redesign product grid with card layout, white background, consistent 400×400px images. Remove marquee text. Add fabric category filter: Saree / Suit / Kurti / Dress Material. Colour swatch filter (12 standard colours). WhatsApp order button on each product card.",
      "screenshot_ref": "screenshot_02.jpg"
    }
  ],
  "additional_recommendations": [
    "Based on business type (retail clothing), consider adding size guide page",
    "WhatsApp catalogue integration would suit this business well"
  ]
}
```

### Brief PDF Format

Page 1: Cover — business name, URL, date, "Prepared via fixmysite.in"
Page 2: Owner's Request — original words + screenshot thumbnails
Page 3+: Technical sections — one section per improvement, priority tagged
Last page: Additional recommendations based on business type

### Upsell Placement

Shown at bottom of full health report:

> *"Your website health issues are mapped. Want to go further? Tell us what you'd like to improve — in your own words, in any language. We'll prepare a brief your developer will understand."*
> **[Create Developer Brief — ₹99]**

Bundle offer shown if scan was just purchased:
> *"Add a Developer Brief for just ₹150 more (save ₹49)"*

---

## 16. Website Health Centre Architecture

### The Gaurav Principle

Dr. Gaurav Chhaya has practised medicine in Ahmedabad for 25 years. In that time he has not lost a single patient to negligence — not one who came to him and was sent away without care, without follow-up, without being pointed to the right next step.

fixmysite.in is built on the same principle.

A business that scans its website with us is not a transaction. It is a patient. We remember them. We watch for them. We alert them before they notice something is wrong. We refer them to the right people when we cannot fix something ourselves. We are available when something breaks at 11pm.

**Once a business comes to fixmysite.in, we never let go through negligence.**

---

### The Patient File

Every URL that touches fixmysite.in gets a permanent longitudinal record. This is the moat. Not the scan. Not the report. The memory.

```
nirujclinic.com — Website Patient File
─────────────────────────────────────────
First visit:     12 Apr 2025  Score: 34/100  Issues: 11
Second visit:    18 May 2025  Score: 71/100  Issues: 4  ← free re-scan earned
Third visit:     12 Aug 2025  Score: 88/100  Issues: 1
Annual plan:     Renewed Jan 2026
Monitor status:  Active — monthly scan + WhatsApp alerts

Issue history:
  ✅ Landline fixed              (flagged Apr → fixed May)
  ✅ Facebook link fixed         (flagged Apr → fixed May)
  ✅ Turkish spam links removed  (flagged Apr → fixed May)
  ✅ Copyright year updated      (flagged Apr → fixed May)
  ⏳ Yahoo email → domain email  (flagged Apr — still pending)
  ✅ SSL expiry renewed          (auto-detected Aug, renewed Aug)

Developer: Ramesh Shah (referred via fixmysite.in brief, May 2025)
Plan: Annual Protection — renews Jan 2027
```

This file is more valuable than any individual scan fee.
It is the relationship.

---

### The Complete Health Centre

```
🔬 DIAGNOSTIC LAB
   Scan → Report → Score
   ₹49 / ₹149 / ₹349

        ↓

📋 SPECIALIST REFERRAL
   Developer Brief — plain language → technical spec
   ₹99 / ₹199

        ↓

🏥 TREATMENT ROOM
   Fix Packages — vetted freelancers, fixed scope, fixed price
   ₹299–₹2,999 per fix

        ↓

💊 PHARMACY
   Self-serve micro-tools
   Free–₹99 per tool

        ↓

🏠 HOME CARE
   Monthly Monitor + Weekly Vitals + Uptime Alerts
   ₹49–₹199/month

        ↓

🚑 EMERGENCY WARD
   Website down? WhatsApp us. Triaged in 30 min.
   ₹999 emergency fee + fix cost

        ↓

📋 HEALTH INSURANCE
   Annual Protection Plan
   ₹999/year

        ↓

🎓 HEALTH EDUCATION
   Newsletter + Certificate + Trust Badge
   Free → ₹99

        ↓

🔄 REFERRAL NETWORK
   Developer marketplace + owner referral programme
   20% platform fee on fixes
```

---

### Service Bunches — Detail

#### Bunch 1 — Treatment Room
*"We found what's broken. Now we fix it."*

Vetted freelancers fix specific issues within 48 hours. You operate as marketplace. Fixed scope prevents disputes.

| Fix | Price | You earn |
|---|---|---|
| Update phone / email / address | ₹299 | ₹60 |
| Repair broken links | ₹499 | ₹100 |
| Fix contact form | ₹799 | ₹160 |
| Renew / fix SSL | ₹999 | ₹200 |
| Remove spam / malware links | ₹1,499 | ₹300 |
| WhatsApp button integration | ₹1,499 | ₹300 |

80% to freelancer · 20% platform fee · Fixed or full refund guarantee.

#### Bunch 2 — Specialist Clinic
*"Beyond fixing. Actually improving."*

Improvement packages. Fixed scope, fixed price, delivered by vetted developers.

| Package | What | Price |
|---|---|---|
| Contact Refresh | Phone, email, address, hours updated | ₹999 |
| Speed Boost | Image compression, basic optimisation | ₹1,999 |
| Mobile Fix | Site usable on phone | ₹2,999 |
| Trust Builder | Testimonials, SSL, Google reviews | ₹1,999 |
| SEO Starter | Meta tags, sitemap, Search Console | ₹2,999 |
| WhatsApp Pro | Business API, catalogue, auto-reply | ₹2,499 |

#### Bunch 3 — Pharmacy
*"Tools the owner uses themselves."*

Standalone micro-tools. Each one a reason to return to fixmysite.in.

| Tool | Price | Purpose |
|---|---|---|
| Google My Business Checker | ₹29 | Does GMB match website? |
| Meta Tag Writer | ₹19 | Claude writes SEO tags from plain form |
| Image Compressor | Free | Lead magnet — builds return habit |
| Favicon Generator | ₹19 | Upload logo → favicon pack |
| Sitemap Generator | ₹29 | Enter URL → download sitemap.xml |
| WhatsApp Link Generator | Free | Pre-filled message, correct format |
| Health Score Certificate | ₹99 | Downloadable PDF — trust badge for website |

The Health Score Certificate is a backlink engine. Every certificate on a business website links back to fixmysite.in.

#### Bunch 4 — Home Care
*"We visit regularly so you don't have to worry."*

| Plan | What | Price |
|---|---|---|
| Monthly Monitor | Full re-scan + email diff report | ₹99/month |
| Weekly Vitals | Reachability + SSL + phone check every Monday | ₹199/month |
| Uptime Alerts | Ping every 5 min · WhatsApp if down within 2 min | ₹49/month |

1,000 subscribers at ₹99/month = ₹99,000/month passive. This is the recurring revenue engine.

#### Bunch 5 — Emergency Ward
*"Something broke. Fix it NOW."*

Owner WhatsApps fixmysite.in: *"Mera site band ho gaya"*
- Triage within 30 minutes
- Developer assigned within 2 hours
- ₹999 emergency fee + fix cost
- After-hours: human + AI triage

#### Bunch 6 — Health Insurance
*"Pay once. Stay protected all year."*

**Annual Website Protection Plan — ₹999/year**
- 2 full scans
- Monthly vital signs
- 1 minor emergency fix included
- 10% off any fix package
- Priority WhatsApp support
- Renewal reminder 30 days before expiry

LTV maximiser. Owner pays ₹999. You retain them for years.

#### Bunch 7 — Health Education
*"Know what your website needs before it breaks."*

**Weekly Newsletter — Free**
One tip per week for non-technical business owners. Builds trust. Drives return visits. Feeds the funnel.

*Example: "This week: why your WhatsApp number on your website might be sending customers to a stranger's phone."*

**Health Score Certificate — ₹99**
PDF certificate with score, scan date, fixmysite.in seal.
Owner embeds on website as trust badge.
Every certificate = one backlink to fixmysite.in.

#### Bunch 8 — Referral Network
*"You healed. Now refer someone."*

**Owner Referral — ₹50 cashback**
Share link. Friend scans and pays. Referrer gets ₹50 off next scan.

**Developer Partner Programme**
- Developers register as fixmysite.in Certified Partners
- Receive referrals from report's "send to developer" flow
- Pay ₹200/lead or 10% of first project value
- Rated and reviewed by owners after each job

---

### Re-engagement Flows

Patients who go silent get called back. Gently. Specifically. Never generically.

**30-day silence:**
> *"It's been a month since your fixmysite.in scan. One of the issues we flagged — your landline — is worth a 5-minute fix. Want us to check if it's been resolved? Free re-check for this one item."*

**90-day silence:**
> *"Three months since we checked nirujclinic.com. Websites change — new issues appear. Your last score was 71/100. A quick re-scan will tell you where you stand today."*

**Anniversary:**
> *"One year ago today, fixmysite.in found 11 issues on your website. You fixed 10 of them. That's a good year. Ready for your annual checkup?"*

All re-engagement via WhatsApp primary, email fallback. Triggered by Supabase cron. Written by Claude with site-specific context — never generic.

---

### The Lifetime Customer Journey

```
Day 1     Paste URL → ₹49 scan → 11 issues found
Day 3     Buy Developer Brief → ₹99
Day 14    Developer fixes issues → free re-scan earned
Day 14    Score: 34 → 71 → warm return message
Day 30    Subscribe to Monthly Monitor → ₹99/month
Day 90    Buy Annual Protection Plan → ₹999
Day 180   Refer a friend → ₹50 cashback
Year 2    Annual renewal → still a patient
Year 5    They've never lost a customer to a broken website again
```

**One ₹49 scan. Lifetime relationship.**

That is the Gaurav Principle in product form.

---

### New DB Tables Required (future phases)

```sql
-- Fix marketplace
fix_requests (id, scan_id, fix_type, price, status, freelancer_id, created_at)
fix_freelancers (id, name, email, phone, specialities, rating, active)

-- Micro-tools
tool_uses (id, tool_key, url, payment_id, created_at)

-- Uptime monitoring
uptime_monitors (id, url, owner_email, plan, last_checked_at, status)
uptime_incidents (id, monitor_id, started_at, resolved_at, alert_sent)

-- Health certificates
certificates (id, scan_id, url, score, issued_at, pdf_url, public_token)

-- Re-engagement
reengagement_queue (id, url_normalized, owner_email, trigger, scheduled_at, sent_at)

-- Developer partners
developer_partners (id, name, email, phone, skills, rating, referral_count, active)
```

---

### North Star Metric

**Not scans. Not revenue. Not signups.**

**Websites that are healthier today than they were a year ago — because of fixmysite.in.**

That is the number that matters.
That is what Gaurav measures when he says he hasn't lost a patient in 25 years.

---

## 17. Developer Persona & Partner Network

### Three Developer Personas

**Persona 1 — The Receiving Developer**
A client forwarded them a fixmysite.in report or brief. They land on the platform for the first time via an email link. They did not come looking — they were referred. They need to view the report without paying again and understand what the client wants fixed.

**Persona 2 — The Proactive Developer**
Has multiple clients. Scans their clients' sites before handover, after fixes, or on a monthly basis. Uses fixmysite.in as a professional tool. Would pay ₹999/month for unlimited agency scans and white-label reports.

**Persona 3 — The Partner Developer**
Wants inbound client referrals from fixmysite.in. Registers as a certified partner. Appears in the developer marketplace when owners need someone to fix their issues. Pays per lead or commission on first job.

---

### "Are You a Developer?" CTA — Three Placement Points

**1. Landing page — secondary CTA below main scan input**
```
[Scan my site — ₹49]

─────────────────────────────
Are you a web developer?
Scan your clients' sites, deliver professional
reports, and get referrals from fixmysite.in.
[Developer tools →]
```

**2. Full report page — below "Send to developer" section**
```
[Send to my developer] ← owner action

─────────────────────────────
Developer reading this report?
[Join our partner network →]
Get client referrals. Scan unlimited sites.
Grow your practice.
```

**3. Report email delivered to developer — footer**
```
You received this report via fixmysite.in.

Are you a web developer?
Join our developer network — get client referrals,
scan unlimited sites, and grow your practice.
[Join free →]
```

---

### Developer Landing Page — /developer

Three paths shown clearly:

```
┌─────────────────────────────────────────────┐
│ 1. Scan a client site                       │
│    Same scan flow as owner                  │
│    Report delivered to you                  │
│    Forward to client or act on it yourself  │
│    Agency plan: ₹999/month — unlimited      │
├─────────────────────────────────────────────┤
│ 2. View a report sent to you                │
│    "My client shared a fixmysite report"    │
│    Enter report access token from email     │
│    Full report + solution map — no payment  │
│    Owner already paid                       │
├─────────────────────────────────────────────┤
│ 3. Join the partner network                 │
│    Get matched to clients near you          │
│    Receive WhatsApp leads                   │
│    Get rated. Build your reputation.        │
│    [Register free →]                        │
└─────────────────────────────────────────────┘
```

---

### Developer Registration Flow (Partner Network)

```
Developer clicks "Join partner network"
          ↓
Registration form:
  Name · Email · WhatsApp number · City
  Skills: HTML/CSS · WordPress · React · Next.js ·
          Shopify · Custom dev · SEO · WhatsApp API
  Portfolio URL (optional)
  Years of experience (dropdown)
          ↓
You review in admin panel — approval within 48 hours
          ↓
Approved → "fixmysite.in Certified Partner" badge
          ↓
Public profile live at /developer/profile/[id]
          ↓
Appears in developer marketplace inside reports
```

---

### Lead Matching Logic

When owner clicks "Find a developer" inside report:

```
Owner city (from scan context or entered)
    +
Issues in report (contact / links / trust /
  workflow / technical / visual / content)
    +
Budget signal (scan tier = proxy for budget)
    ↓
Match: city first → skills → rating
    ↓
Top 3 partners shown:
  Name · City · Skills · Rating · Jobs completed
  "Contact via fixmysite.in" button
    ↓
Developer WhatsApp notification:
  "New lead — nirujclinic.com (Ahmedabad)
   Needs: contact form + SSL fix
   Budget signal: Small site (₹49 scan)
   Interested? Reply YES to connect."
    ↓
Developer accepts → owner gets developer WhatsApp
    ↓
Job done → owner rates developer (1–5 stars)
    ↓
Platform fee: ₹200/lead
```

---

### Developer Dashboard (Agency Plan — ₹999/month)

Route: `/developer/dashboard` — magic link auth

```
My clients               Active monitors
────────────             ────────────────
nirujclinic.com  88/100  3 sites monthly plan
jaydeebjewels.in 71/100  WhatsApp alerts on
kapilcloth.com   45/100  ← needs attention

Recent scans     Open leads       Earnings
────────────     ──────────       ───────────
6 this month     2 new leads      ₹2,400
```

Features:
- Scan unlimited client sites
- White-label PDF reports
- Bulk report download (ZIP)
- Client health history + score trend
- Lead inbox: accept / decline
- Earnings dashboard

---

### White-Label Reports (Agency Plan)

Developer sets agency name + logo in dashboard settings.

PDF report header:
```
[Developer Agency Name] — Website Health Report
Powered by fixmysite.in
```

Owner gets branded report from their developer.
Developer looks professional. fixmysite.in gets attribution.

---

### New Pages

```
/developer                    ← Developer landing page
/developer/dashboard          ← Agency dashboard (auth)
/developer/register           ← Partner registration
/developer/profile/[id]       ← Public partner profile
/developer/report/[token]     ← View report received by email
```

### New API Routes

```
POST /api/developer/register          ← Submit registration
GET  /api/developer/profile/[id]      ← Public profile
POST /api/developer/lead/accept       ← Accept a lead
POST /api/developer/lead/decline      ← Decline a lead
GET  /api/developer/dashboard         ← Dashboard data (auth)
POST /api/admin/developer/approve     ← Admin approves partner
POST /api/admin/developer/reject      ← Admin rejects partner
```

### New DB Tables

```sql
developer_partners (
  id               uuid primary key default gen_random_uuid()
  name             text not null
  email            text unique not null
  phone            text not null
  city             text not null
  skills           text[]
  portfolio_url    text
  years_exp        int
  plan             text default 'free'  -- free | agency
  rating           numeric(3,2)
  jobs_completed   int default 0
  referral_count   int default 0
  earnings_total   int default 0        -- in paise
  verified         boolean default false
  active           boolean default true
  agency_name      text
  agency_logo_url  text                 -- R2 signed URL
  created_at       timestamptz default now()
  updated_at       timestamptz default now()
)

developer_leads (
  id               uuid primary key default gen_random_uuid()
  scan_id          uuid references scans(id)
  developer_id     uuid references developer_partners(id)
  status           text default 'sent'
                   -- sent | accepted | declined | completed
  fee_paise        int
  fee_collected    boolean default false
  owner_rating     int                  -- 1–5 stars
  owner_review     text
  sent_at          timestamptz default now()
  responded_at     timestamptz
  completed_at     timestamptz
)
```

### PostHog Events (Developer)

| Event | Properties |
|---|---|
| `developer_cta_clicked` | source (landing / report / email) |
| `developer_registered` | city, skills_count |
| `developer_approved` | developer_id |
| `developer_lead_sent` | scan_id, developer_id |
| `developer_lead_accepted` | lead_id |
| `developer_lead_declined` | lead_id |
| `agency_plan_subscribed` | developer_id |
| `white_label_report_downloaded` | scan_id |

---

- All API routes: input sanitisation, URL validation (no private IPs, no localhost, no internal ranges)
- SSRF protection: async `isSafeUrl()` — always await before any outbound fetch
- Razorpay webhook: signature verified on every event
- Twilio credentials: server-side only, never exposed to client
- Supabase: RLS enabled on all tables, service-role-only access
- Rate limits (Upstash Redis, sliding window):
  - Phase 1: 10/hour/IP
  - Phase 2: 3/hour/IP
  - PDF download: 5/hour/IP
  - Send to developer: 3/hour/IP
  - Payment routes: 20/hour/IP
  - check-previous: 20/hour/IP
  - Subscription webhook: no IP limit (HMAC is auth)
  - Brief generate: 5/hour/IP
  - Screenshot upload: 10/hour/IP
- No user accounts required for one-time scan or brief
- HTTPS enforced, HSTS headers set
- CSP headers configured in `next.config.ts`
- PDF + screenshot download: signed URL with 1-hour expiry (brief PDF: 24-hour expiry)
- Screenshots stored in R2 private bucket — never publicly accessible
- Brief screenshots: deleted from R2 after 30 days

---

## 18. Launch Checklist

- [ ] Domain live: fixmysite.in (GoDaddy → Vercel)
- [ ] Supabase project created, schema migrated (all 6 tables including enterprise_inquiries)
- [ ] Razorpay test mode → live mode
- [ ] Twilio account + Lookup API key
- [ ] Resend domain verified
- [ ] PostHog project created
- [ ] Cloudflare R2 bucket created (private, Mumbai region)
- [ ] PWA manifest + icons
- [ ] Privacy policy + Terms live
- [ ] Upstash Redis connected, rate limits active
- [ ] SSRF protection active (async isSafeUrl)
- [ ] PDF generation tested (report + brief)
- [ ] Screenshot upload + R2 storage tested
- [ ] End-to-end payment flow tested (scan + brief)
- [ ] Send-to-developer email tested
- [ ] Mobile PWA install tested (Android Chrome)
- [ ] Brief generator tested with Hindi + Gujarati input
- [ ] Business type detection tested across 5 business types
- [ ] URL classifier tested: global / indian enterprise / institution / self-serve
- [ ] Domain-match validation tested (gmail rejected, work email accepted)
- [ ] OTP flow tested end-to-end
- [ ] "Are you the admin?" gate tested with known large domain
- [ ] Admin inquiry panel tested — approve + set price flow
- [ ] Institution path tested with .ac.in domain
- [ ] Fun-seeker graceful exit tested ("No, just curious" path)

---

## 19. Patient Intake System

### Philosophy

Before Gaurav bhai examines a patient he asks questions. Family history. Current symptoms. What's bothering you most. What do you want from this visit. The examination that follows is 10x more targeted because of those answers.

fixmysite.in does the same.

Every question is optional. Every text box accepts any language — Hindi, Gujarati, English, Hinglish, anything. The owner who fills nothing still gets a good report. The owner who fills everything gets a report that feels written specifically for them.

**That gap — between good and "feels written for me" — is the entire value of the intake system.**

---

### Two Conversation Moments

```
PRE-SCAN INTAKE (before payment)
"Tell us about yourself and what you want"
Shown after Phase 1, before PriceGate
Takes 60 seconds. All optional.
Feeds Claude context before report generation.

POST-REPORT CONSULTATION (after payment, inside full report)
"Now that you've seen the results, tell us more"
Shown inside /report/[scan_id]/full
Takes 2 minutes. All optional.
Deepens solution map. Feeds Developer Brief.
```

---

### Pre-Scan Intake Form

Shown after Phase 1 result, before PriceGate. Framing:
> *"60 seconds of answers make your report 10x more useful. All optional — skip anything."*

#### Section A — About Your Business
```
What kind of business do you run?
○ Clinic / Hospital / Healthcare
○ Legal (Lawyer / CA / Consultant)
○ Education (School / Tuition / Coaching)
○ Restaurant / Food / Catering
○ Retail / Shop / Clothing
○ Real Estate / Property
○ Hotel / Travel / Tourism
○ Beauty / Salon / Wellness
○ Manufacturing / Industrial
○ Other: [text box]

How long has this business been running?
○ Less than 1 year
○ 1–3 years
○ 3–10 years
○ More than 10 years

Where are most of your customers?
○ Local (same city)
○ State-wide
○ All India
○ International
```

#### Section B — How Customers Find You
```
How do most customers find your business? (tick all that apply)
☐ Google search
☐ WhatsApp referrals / word of mouth
☐ Walk-in / physical signage
☐ Social media (Instagram / Facebook)
☐ Justdial / Sulekha / Indiamart
☐ The website itself
☐ I'm not sure

What do customers do when they land on your website?
☐ Call the phone number
☐ Fill the contact form
☐ WhatsApp us
☐ Visit our physical location
☐ Book an appointment
☐ Buy something online
☐ Just look around — we're not sure
```

#### Section C — Your Website Situation
```
Who manages your website?
○ A developer / agency I hired
○ I manage it myself
○ No one — it was built once and left
○ I don't know

When was the website last updated?
○ Within the last 6 months
○ 1–2 years ago
○ 3–5 years ago
○ More than 5 years ago
○ I honestly don't know

Have customers complained about the website?
○ Yes — they say they can't contact us
○ Yes — they can't find information
○ Yes — it looks bad on mobile
○ Yes — other: [text box]
○ No complaints that I know of

Do you currently get enquiries through the website?
○ Yes, regularly
○ Yes, occasionally
○ Rarely or never
○ I don't track this
```

#### Section D — What You Want From This Scan
```
What matters most to you right now? (pick up to 3)
☐ Fix things that stop customers contacting me
☐ Make the website look more professional
☐ Get found better on Google
☐ Make it work properly on mobile
☐ Add new features (booking, payment, WhatsApp)
☐ Understand if I need a full redesign
☐ Just want to know what's broken

How do you feel about your website right now?
○ Embarrassed — it looks outdated
○ Neutral — it works but could be better
○ Proud — just want to check it's healthy
○ Unsure — I haven't really looked at it properly

What is your appetite for fixing things?
○ Quick cheap fixes only (under ₹2,000)
○ Moderate investment if it makes a difference (₹2,000–₹10,000)
○ Serious investment for proper results (₹10,000+)
○ I will do it myself if you tell me what to do
```

#### Section E — Open Question (any language)
```
Is there anything specific bothering you about your website?
Write in any language — Hindi, Gujarati, English, anything.

[                                                    ]
[                                                    ]

Examples:
"Mera contact form kaam nahi karta"
"Logo sahi nahi dikhta mobile pe"
"मुझे नहीं पता क्यों Google पर नहीं आती मेरी साइट"
"contact page j kaam nathi karti"
```

---

### Post-Report Consultation Form

Shown inside `/report/[scan_id]/full` after owner reads the findings. Framing:
> *"You've seen what's broken. Tell us what matters most — we'll personalise your solution map."*

#### Level 1 — Reaction to Report
```
What surprised you most in the report?
○ The phone / contact issues
○ The broken links
○ The design / visual problems
○ The workflow problems
○ How old the site is
○ Nothing surprised me — I knew it was bad
○ Nothing surprised me — it's better than I expected

Which issues concern you most? (tick all that apply)
☐ Customers can't reach me
☐ The site looks unprofessional
☐ People can't find me on Google
☐ The site doesn't work on mobile
☐ There are security issues
☐ The content is outdated
☐ Workflow / form problems
```

#### Level 2 — Diving Deeper
```
For the issues we flagged — do you know why they exist?
○ Yes — my developer built it wrong and left
○ Yes — I tried to update it myself and broke something
○ Yes — it worked before, something changed
○ No — I have no idea
○ Some of them — [text box]

Do you have access to your website backend?
○ Yes — I can make changes myself
○ Yes — but I need a developer to help me
○ No — only my developer has access
○ I don't know what that means

Is your developer still available?
○ Yes — I have an ongoing relationship
○ Sometimes — they are hard to reach
○ No — I have lost contact with them
○ I never had a proper developer
○ Not applicable
```

#### Level 3 — What Happens Next
```
After seeing this report, what do you want to do?
○ Fix the critical issues myself right now
○ Send this to my existing developer
○ Find a new developer through fixmysite.in
○ Get a developer brief prepared (₹99)
○ I need to think about it

What is your timeline?
○ Urgent — this week
○ Soon — within a month
○ No rush
○ Only if it is easy and cheap

Anything else you want to tell us?
[                                                    ]
[  Any language, any length.                        ]
[                                                    ]
```

---

### Vitamin Pack — Additional Report Sections

After intake data is collected, Phase 2 runs additional checks:

#### Font Analysis
Claude reads CSS `font-family` declarations and flags:

| Finding | Priority |
|---|---|
| More than 3 font families | Medium |
| System fonts only (Arial, Times New Roman) | Low |
| Decorative font used for body text | Medium |
| No font loaded — browser default renders | Low |
| Comic Sans / Papyrus detected | High |

Claude suggests 2 alternatives matched to business type:
- Clinic → *"Inter or Lato — clean, medical, trustworthy"*
- Jewellery → *"Playfair Display + Lato — elegant, readable"*
- Restaurant → *"Poppins — warm, approachable, modern"*

#### Colour & Brand Analysis
Claude reads CSS colour variables and checks:

- Text vs background contrast ratio (WCAG AA = 4.5:1 minimum)
- More than 5 distinct colours → brand is scattered
- No consistent primary colour → no brand identity
- Neon or clashing combinations → flagged with suggestion

Suggests 3-colour palette (primary, secondary, accent) matched to business type.

#### Website Age Assessment
Four signals combined to estimate site age:

```typescript
// Signal 1: Copyright year in footer
// Signal 2: <meta name="generator"> version tag
// Signal 3: Average Last-Modified of images (HEAD requests)
// Signal 4: SSL certificate issue date
```

Age-based recommendation:
- Under 2 years → minor refresh suggestions
- 2–4 years → moderate update recommended
- 4+ years → full overhaul conversation opened

#### Surgical vs Overhaul Recommendation

```
health_score >= 70                  → Surgical fixes (2–3 dev days)
health_score 40–69                  → Significant updates (1–2 weeks)
health_score < 40                   → Full overhaul (3–4 weeks)
site_age >= 5 years + score < 60    → Overhaul regardless of score
```

Plain-language recommendation written by Claude — specific to this site's findings and owner's budget signal from intake.

#### Industry Benchmark
Aggregate data only — no competitor names, no URLs:

> *"We have scanned 47 clinic websites in Gujarat. The average health score is 58/100. Your score is 34/100 — below average. Clinics scoring above 70 typically have working contact forms, a professional domain email, and online appointment booking."*

---

### How Intake Context Feeds Claude

All intake responses are serialised into a context block prepended to every Claude prompt:

```typescript
const patientContext = `
OWNER INTAKE — ${url}
─────────────────────
Business: ${businessType} · running ${businessAge}
Customers: ${customerGeography}
Discovery channels: ${discoveryChannels.join(', ')}
Website managed by: ${websiteManager}
Last updated: ${lastUpdated}
Known complaints: ${knownComplaints.join(', ')}
Primary goals: ${primaryGoals.join(', ')}
Owner sentiment: ${ownerSentiment}
Budget signal: ${budgetSignal}
Owner free text (original language): "${ownerFreeText}"

Post-report responses (if available):
Most concerning: ${concerningIssues.join(', ')}
Developer access: ${developerAccess}
Developer available: ${developerAvailable}
Intended next action: ${nextAction}
Timeline: ${timeline}
Post-report free text: "${postReportFreeText}"
`
```

**Effect on report quality:**

| Owner said | Claude does |
|---|---|
| "Customers can't contact me" | Contact findings → High priority regardless of score |
| "Embarrassed — looks outdated" | Font, colour, age sections elevated |
| "Lost contact with developer" | Action steps written as DIY, not "ask your developer" |
| "Google pe nahi aati" | SEO section gets plain-language explanation |
| "Do it myself" | Every action = DIY instruction |
| "Budget: serious investment" | Overhaul recommendation unlocked |
| "Budget: cheap fixes only" | Only Low effort actions in solution map |

---

### Updated Report Section Order

```
1.  Return message (if return visit, fix_rate >= 0.8)
2.  Summary card + health score + industry benchmark
3.  Our Recommendation (surgical / partial / overhaul)
4.  Contact verification
5.  Links & pages
6.  Trust signals
7.  Content quality (lorem ipsum, thin pages)
8.  Visual & UI
9.  Typography & fonts        ← Vitamin Pack
10. Colour & brand            ← Vitamin Pack
11. Website age assessment    ← Vitamin Pack
12. Workflow & UX
13. Technical health
14. Solution map (personalised by intake)
15. Developer Brief upsell (if developer_available = 'lost contact')
16. Send to developer
```

---

### DB Table

```sql
owner_intake (
  id                   uuid primary key default gen_random_uuid()
  scan_id              uuid references scans(id) on delete cascade

  -- Section A
  business_type        text
  business_age         text
  customer_geography   text

  -- Section B
  discovery_channels   text[]
  customer_actions     text[]

  -- Section C
  website_manager      text
  last_updated_signal  text
  known_complaints     text[]
  complaint_detail     text
  enquiry_frequency    text

  -- Section D
  primary_goals        text[]
  owner_sentiment      text
  budget_signal        text

  -- Section E
  free_text            text
  free_text_language   text   -- Claude-detected ISO 639-1

  -- Post-report Level 1
  surprise_factor      text
  concerning_issues    text[]

  -- Post-report Level 2
  knows_why            text
  knows_why_detail     text
  has_backend_access   text
  developer_available  text

  -- Post-report Level 3
  next_action          text
  timeline             text
  post_free_text       text
  post_free_text_language text

  created_at           timestamptz default now()
  updated_at           timestamptz default now()
)
```

---

### New API Routes

```
POST /api/intake/pre-scan     ← Save pre-scan intake (upsert by scan_id)
POST /api/intake/post-report  ← Save post-report responses (upsert by scan_id)
GET  /api/intake/[scan_id]    ← Fetch intake for report personalisation
```

---

### New Pages / Components

```
components/intake/PreScanIntake.tsx   ← 5-section form, shown before PriceGate
components/intake/PostReportIntake.tsx ← 3-level form, shown inside full report
components/intake/IntakeProgress.tsx  ← Visual "X of 5 sections" indicator
```

---

### Build Rules (addition to CLAUDE.md)

- Intake is always optional — never block scan or report if skipped
- Free text fields accept any language — Claude detects language, never reject
- Intake context prepended to ALL Claude prompts — report, UX audit, brief, return message
- Never store intake responses in phase1_result or phase2_result — separate table only
- Post-report intake can be submitted multiple times — always upsert, never duplicate
- Budget signal from intake overrides default solution map ordering

---

### Launch Checklist Additions

- [ ] Pre-scan intake form renders and saves correctly
- [ ] Post-report intake form renders inside full report page
- [ ] Intake context correctly prepended to Claude report prompt
- [ ] Free text in Hindi / Gujarati accepted and stored correctly
- [ ] Solution map personalisation tested with different budget signals
- [ ] Intake skipped entirely → report generates normally

---

## 20. Website Blueprint Engine

### Philosophy

fixmysite.in has three doors:

- **Door 1** — for businesses with a sick website (Health Scan, §5)
- **Door 2** — for businesses with no website yet (this section, the Blueprint Engine)
- **Door 3** — for creative builders with an idea or skill but no business yet (Spark Report, §21)

Same platform. Same soul. Three different journeys.

The Blueprint Engine is not a form. It is a conversation that builds a complete picture — through cascading Yes/No questions and open text — so Claude can produce a genuine, reasoned technology recommendation. Not a template. Not a guess. A specific answer to a specific business situation.

**"A website doctor who also does family planning — and a startup advisor for creative builders."**

> **Build principle — the question engine is a prompt compiler.**
> The cascading flow is not a UX gimmick. Every click adds structured context to the Claude prompt without the user writing a sentence. By the time they submit, fixmysite.in has compiled a 400–500 word structured context block that gives Claude everything needed for a specific, personalised report. **The user expresses themselves through choices, not writing. The platform does the writing for Claude.** This principle applies to every Claude-driven product on the platform — Brief, Blueprint, and Spark all share it.

---

### Landing Page Integration

Single landing page. User self-selects at the top:

```
What would you like to do today?

○ Check my existing website for problems    → /scan
○ Plan a new website from scratch           → /plan
○ Start my journey from an idea or skill    → /plan/questions (Spark path, §21)
```

All three options visible above the fold. None dominates. Owner knows immediately which door is theirs.

The third door routes through the same `/plan/questions` URL — Branch 1 of the wizard ("What brings you here today?") splits Door 2 (Blueprint flow) from Door 3 (Spark flow) based on the answer.

---

### The Question Engine — Cascading Logic

Questions unlock based on previous answers. Not a flat form — a branching conversation. Each branch builds the Claude context block that produces the recommendation.

#### Branch 1 — What Are You?
```
What best describes your business?
○ Physical business (shop, clinic, office, studio)
○ Service provider (consultant, trainer, freelancer)
○ Product seller (manufacturer, trader, retailer)
○ Institution (school, NGO, trust, society)
○ Creative practice (artist, writer, musician, chef)
○ Just starting — not sure yet
```

#### Branch 2 — Business Reality
*(questions differ by Branch 1 answer)*

**Physical business path:**
```
How many customers visit you per month?
○ Under 50  ○ 50–200  ○ 200–1,000  ○ 1,000+

Do customers currently find you via Google search?
○ Yes  ○ No  ○ I don't know

Do you take appointments or bookings?
○ Yes — customers call to book
○ Yes — walk-in only
○ No — not applicable
```

**Service provider path:**
```
Do you work with clients locally or remotely?
○ Local only
○ Mix of local and remote
○ Fully remote / anywhere in India
○ International clients

How do you currently get new clients?
○ Word of mouth only
○ Social media
○ Existing platforms (Upwork, Fiverr, etc.)
○ I struggle to get clients — that's the problem
```

**Product seller path:**
```
How many products do you sell?
○ Under 20  ○ 20–100  ○ 100–500  ○ 500+

Do you currently sell online?
○ No — everything offline
○ Yes — via WhatsApp
○ Yes — via Amazon / Flipkart / marketplace
○ Yes — I have a basic site already

Do customers need accounts to track orders?
○ Yes  ○ No  ○ Not sure
```

**Institution path:**
```
What does your institution do?
○ Education (school, college, coaching)
○ Non-profit / NGO / trust
○ Religious / cultural organisation
○ Healthcare institution
○ Other: [text box]

Do you need to collect donations or fees online?
○ Yes  ○ No  ○ Maybe later

Do you publish regular content (events, news, notices)?
○ Yes — frequently  ○ Occasionally  ○ No
```

#### Branch 3 — Turnover & Scale
```
Approximate monthly turnover?
○ Pre-revenue / just starting
○ Under ₹1 lakh
○ ₹1–5 lakh
○ ₹5–20 lakh
○ ₹20 lakh+
○ Prefer not to say

How many people work in your business?
○ Just me
○ 2–5 people
○ 6–20 people
○ More than 20
```

#### Branch 4 — Expectations
```
What do you want a website to do for you?
(tick all that apply)
☐ Help new customers find me on Google
☐ Show my work / portfolio / products / menu
☐ Let customers contact or book me without calling
☐ Accept payments online
☐ Build trust — look professional
☐ Sell products directly (e-commerce)
☐ Collect leads / enquiries
☐ Reduce my dependency on WhatsApp for business

What does success look like in 6 months?
○ More phone calls from new customers
○ Online bookings without me being involved
○ Direct online sales
○ Being found on Google for my service
○ Looking professional enough to charge more
○ I honestly don't know yet
```

#### Branch 5 — Geographical Reach
```
Where are your customers?
○ One city only
○ Multiple cities in one state
○ Pan-India
○ International
○ Mix of local and national

Do you need the website in multiple languages?
○ English only is fine
○ Hindi or Gujarati also needed
○ Regional language primarily
○ Multiple languages needed
```

#### Branch 6 — Technical Reality
```
Have you tried building a website before?
○ Never tried
○ Tried — got confused and stopped
○ Had one built — don't have access to it
○ Have one — not happy with it

Do you have a domain name?
○ Yes: [text box]
○ No — have a name in mind: [text box]
○ No — need help choosing

Do you have a logo?
○ Yes — professionally designed
○ Yes — made myself (WhatsApp DP etc.)
○ No logo yet

Budget for the website?
○ Under ₹5,000 (basic only)
○ ₹5,000–₹20,000 (proper small business site)
○ ₹20,000–₹1,00,000 (serious investment)
○ Above ₹1 lakh (custom / complex)
○ Not sure — depends on what I need

Timeline?
○ This week — urgent
○ Within a month
○ No rush — get it right
○ Just exploring for now
```

#### Branch 7 — Open Question (any language)
```
Tell us about your business in your own words.
What do you do, who are your customers, and what is
the one thing you most want your website to do for you?

[                                                      ]
[  Any language. Any length.                          ]
[                                                      ]

Examples people have written:
"Maro kapda no business 6e. Customer Instagram thi aave 6e
 pan website nathi. Hu chahun 6u ke online order pan aave."
"I am a CA in Pune. Clients come via referrals only.
 I want a site that looks professional when they Google me."
"NGO for blind children in Hyderabad. Need donation button."
```

---

### Claude Blueprint Prompt

```typescript
// /lib/blueprint/generator.ts

const blueprintSystemPrompt = `
You are a website technology advisor for Indian small businesses.
Your job is to recommend exactly what kind of website a business needs
and explain clearly why — in plain language a non-technical owner understands.

Rules:
- Be specific. Generic advice has no value.
- Always explain why the recommended option is right AND
  why the alternative options are NOT right for this business.
- Technology suggestions must be realistic for Indian freelance developers
  and Indian hosting budgets.
- Use Indian context: mention Razorpay not Stripe, mention
  Hostinger/BigRock not GoDaddy US pricing, mention
  Indian developer marketplaces.
- Never use words: "robust", "seamless", "leverage", "utilize", "ensure"
- Output: valid JSON only. No markdown. No preamble.
`

const blueprintUserPrompt = `
Business intake answers:
${JSON.stringify(answers, null, 2)}

Owner's own words (${detectedLanguage}):
"${freeText}"

Return JSON in this exact shape:
{
  "understood": string (2-3 sentences — what we understood about the business),
  "recommendation": "feature" | "platform" | "ecommerce" | "custom",
  "recommendation_label": string (e.g. "Feature Website"),
  "timeline_days": string (e.g. "5–7 days"),
  "budget_range": string (e.g. "₹8,000–₹15,000"),
  "why_right": string[] (3-5 reasons this is correct for them),
  "why_not_alternative": string[] (2-3 reasons the other option is wrong for them now),
  "pages_needed": [
    { "name": string, "purpose": string }
  ],
  "features_needed": string[],
  "features_not_needed": string[],
  "technology": {
    "platform": string,
    "reason": string,
    "hosting": string,
    "avoid": string[],
    "avoid_reasons": string[]
  },
  "next_steps": [
    { "step": number, "action": string, "cost": string | null }
  ],
  "red_flags": string[] | null
}
`
```

---

### Blueprint Output — Four Recommendation Types

**Type 1 — Feature Website**
5–8 pages. No database. No backend. No login.
For: clinic, CA, tutor, freelancer, restaurant, salon.
Timeline: 5–7 days. Budget: ₹5,000–₹20,000.

**Type 2 — Platform Website**
Database + backend + user accounts.
For: coaching institute, hospital with patient records,
     marketplace, membership organisation.
Timeline: 3–6 weeks. Budget: ₹30,000–₹1,00,000.

**Type 3 — E-commerce Website**
Product catalogue + cart + payment + order management.
For: clothing retailer, food brand, manufacturer direct sales.
Timeline: 2–4 weeks. Budget: ₹20,000–₹80,000.
Sub-types: Simple (under 100 products) → WooCommerce.
           Complex (500+ products, inventory) → Custom or Shopify.

**Type 4 — Custom Build**
Complex logic, integrations, or scale requirements.
For: large NGO, multi-branch institution, funded startup.
Timeline: 6–16 weeks. Budget: ₹1,00,000+.
Note: Refer to agency, not individual freelancer.

---

### Why Alternatives Are Wrong — Claude Always Explains Both

This is the differentiator. Every recommendation explains:
- Why this type is right ✓
- Why the simpler option is not enough ✗
- Why the more complex option is overkill ✗

Example for a physiotherapy clinic:

> **Why a feature website is right:**
> You need patients to find you on Google and book appointments. Five pages does that. A contact form with email notification handles bookings. WhatsApp button handles the rest. Done in a week.

> **Why a platform is overkill for you:**
> You don't need patient records online, online prescriptions, or payment processing. Adding a database now means 6 weeks of development and ₹50,000+ for features you won't use for years. Build simple. Expand when the need is real.

---

### Pricing

```
Website Blueprint Report — ₹99
- Full recommendation with reasoning
- Page list + feature list
- Technology suggestion with Indian context
- Step-by-step next actions
- Downloadable PDF
- "Find a developer" connection to partner network
```

Cross-sell:
- "Already have a site? Scan it for ₹49 →"
- Bundle: Blueprint + first-year monthly monitor = ₹999

---

### New Pages

```
/plan                          ← Blueprint landing page
/plan/questions                ← Cascading question engine
/plan/blueprint/[id]           ← Free preview (understanding + recommendation type)
/plan/blueprint/[id]/full      ← Full paid blueprint (₹99)
/plan/blueprint/[id]/pdf       ← PDF download
```

---

### New API Routes

```
POST /api/blueprint/create          ← Save answers, create blueprint row
POST /api/blueprint/generate        ← Claude generates blueprint JSON
POST /api/blueprint/payment/create-order
POST /api/blueprint/payment/verify
GET  /api/blueprint/[id]            ← Fetch blueprint (gated by payment)
POST /api/blueprint/pdf             ← Generate PDF
POST /api/blueprint/send-developer  ← Email blueprint to developer
```

---

### New DB Table

```sql
website_blueprints (
  id                    uuid primary key default gen_random_uuid()

  -- Identity (all optional)
  business_type         text
  business_name         text
  owner_name            text
  owner_email           text

  -- Answers
  answers               jsonb not null default '{}'
  free_text             text
  free_text_language    text   -- Claude-detected ISO 639-1

  -- Claude output
  recommendation        text   -- feature | platform | ecommerce | custom
  blueprint_json        jsonb
  health_score          int    -- not applicable here, always null

  -- Payment
  payment_id            text
  razorpay_order_id     text unique
  payment_status        text default 'unpaid'

  -- State
  status                text default 'draft'
                        -- draft | generated | paid | complete
  created_at            timestamptz default now()
  completed_at          timestamptz
)
```

---

### PostHog Events

| Event | Properties |
|---|---|
| `blueprint_started` | business_type |
| `blueprint_questions_completed` | business_type, question_count |
| `blueprint_generated` | recommendation_type |
| `blueprint_payment_initiated` | amount |
| `blueprint_payment_complete` | amount |
| `blueprint_pdf_downloaded` | blueprint_id |
| `blueprint_developer_referred` | blueprint_id |
| `blueprint_to_scan_crosssell` | blueprint_id |

---

### Launch Checklist Additions

- [ ] /plan landing page live
- [ ] Question engine branching tested for all 5 business types
- [ ] Claude blueprint generation tested end to end
- [ ] Blueprint PDF generation tested
- [ ] ₹99 payment flow tested
- [ ] "Find a developer" connection to partner network tested
- [ ] Cross-sell "scan for ₹49" link tested from blueprint page

---

## 21. Spark Report — Creative Builder Path

### Philosophy

The Blueprint Engine (§20) was designed for business owners who have customers, turnover, and a clear need. But there is a second person who lands on fixmysite.in/plan with something equally real — not a business, but an idea. A design student in Vadodara. A photographer in Surat who wants to go freelance. A working professional who builds websites on weekends and wants to know if it could become something more.

This person cannot answer questions about monthly turnover or customer geography. Every question feels like it was written for someone else. They close the tab.

The Spark Report is built for them.

**The Spark Report does not plan a website. It plans a journey.**

---

### The Third Door

```
Door 1: Fix my site      → Health Scan (existing, §5)
Door 2: Plan my site     → Blueprint Engine (existing, §20)
Door 3: Start my journey → Spark Report (this section)
```

Triggered at the very first question of the /plan/questions wizard:

```
What brings you here today?

○ I have a business and need a website
  → existing Blueprint question flow (§20)

○ I have an idea or skill and want to build something
  → Spark Report flow

○ I want to learn web design or development
  → Spark Report flow

○ I'm just exploring — not sure yet
  → Short version of Spark Report flow
```

---

### The Creative Builder Persona

```
Age:          18–28 typically (not exclusively)
Situation:    Student / early career / side-hustle seeker
Has:          Creative energy, ideas, design sense, skills
Doesn't have: Business, customers, turnover, budget clarity
Goal:         "I want to build something.
               Tell me what that something should be."
Language:     Hindi / Gujarati / English / Hinglish
Platform:     Mostly mobile
Motivation:   Side income → serious business → career pivot
```

---

### Spark Report Question Flow

Four branches. All optional. All mobile-friendly. No question assumes an existing business.

#### Branch A — What's The Idea?
```
What excites you most right now?
○ Showcasing my creative work
  (design, art, photography, writing, music)
○ Teaching something I know well
○ Selling something I make
  (handmade, digital products, art prints)
○ Building a community around a topic
○ Offering a service
  (design, coding, tutoring, content creation)
○ Something specific: [text box — any language]
```

#### Branch B — Where Are You Right Now?
```
How would you describe your situation?
○ Student — this is a side project
○ Working — exploring as a second income
○ Freelancing already — want to grow
○ Between things — this is the main focus
○ Just curious — no pressure

Do you have anything to show yet?
○ Just ideas in my head
○ Sketches / mood boards / notes somewhere
○ A portfolio on Behance / Dribbble / Instagram
○ A few completed projects for clients or friends
○ Already charging for this work
```

#### Branch C — Time and Technology
```
How much time can you give this per week?
○ Under 5 hours (hobby pace)
○ 5–15 hours (serious side project)
○ 15–30 hours (main focus alongside other work)
○ Full time — this is it

How comfortable are you with technology?
○ I can use Canva and basic tools
○ I have made a basic website before
○ I know HTML and CSS basics
○ I can code — looking for direction not basics

Budget for tools and hosting?
○ ₹0 — needs to be free to start
○ Under ₹500 per month
○ Under ₹2,000 per month
○ Open — if it genuinely makes sense
```

#### Branch D — The Dream Question
```
Finish this sentence in your own words:

"One year from now, I want people to know me for..."

[text box — any language, any length]
[Examples shown below input:]
"meri photography ke liye"
"being the go-to designer for Gujarati small businesses"
"teaching animation to students who can't afford classes"

This is the most important thing the user answers.
The rest shapes the path. This defines the destination.
```

---

### The Question Engine As Prompt Compiler

The cascading question flow is not a form. It is a **prompt compiler** — see the Build Principle in §20.

```
User clicks 12 answers + writes 1 sentence
      ↓
fixmysite.in compiles structured prompt
      ↓
Claude receives full context
      ↓
Claude produces specific 3-phase roadmap
      ↓
User never had to write a paragraph
      ↓
No token waste. No vague output. No dead ends.
```

This is the core UX value of the question engine across all three doors — Brief, Blueprint, Spark.

---

### Claude Spark Prompt

```typescript
// /lib/claude/spark.ts

const sparkSystemPrompt = `
You are a career and creative business advisor for young Indians
who want to turn their skills and ideas into real income.

Your audience: students, early-career professionals, freelancers
starting out. They have energy and ideas but not yet customers or
turnover.

Rules:
- Be specific. Generic advice ("build a portfolio") is useless.
  Specific advice ("open Framer today, put one project on a page,
  share the link with one person by tonight") is what they need.
- Three phases always: Start → First client → Scale.
  Never give all three at once with equal weight —
  Phase 1 is the only thing that matters right now.
- Honest timelines. If it takes 6 months to earn ₹10,000/month,
  say so. Do not oversell. These users have been oversold to before.
- One thing to do today. Always. Concrete. Achievable in 2 hours.
- "Not yet" list. What they should NOT do yet —
  stops them from building infrastructure before they have clients.
- Indian context throughout: mention Framer, Canva, Behance,
  Instagram, Fiverr India, local WhatsApp groups, college networks.
  Not Squarespace. Not Upwork US rates.
- Free and low-cost first. Only suggest paid tools when free
  options genuinely cannot serve the need.
- Never use: "utilize", "leverage", "ensure", "robust", "seamless"
- Never be patronising. They are smart. They just need direction.
- Output: valid JSON only. No markdown. No preamble.
`

const sparkUserPrompt = `
Creative builder intake:
${JSON.stringify(answers, null, 2)}

Dream statement (${detectedLanguage}):
"${dreamStatement}"

Return JSON in this exact shape:
{
  "we_heard": string (2-3 sentences — what we understood about them and their goal. Reference their dream statement directly.),
  "path_type": "portfolio_to_freelance" | "maker_to_seller" | "knowledge_to_teacher" | "community_builder" | "service_provider",
  "honest_timeline": string (realistic months-to-first-income estimate based on their time commitment),

  "phase_1": {
    "what": string,
    "why": string (why this before anything else),
    "timeline": string (e.g. "2–3 weekends"),
    "cost": string (e.g. "₹0–₹500"),
    "how": string (specific tools and approach — Indian context),
    "pages_or_steps_needed": string[],
    "first_step": string (what to do in the next 2 hours)
  },

  "phase_2": {
    "what": string,
    "when": string (after what milestone does phase 2 begin),
    "where_to_find_clients": string[] (specific Indian platforms, channels, communities)
  },

  "phase_3": {
    "what": string,
    "when": string,
    "what_it_looks_like": string (concrete example of productised service with ₹ pricing)
  },

  "not_yet": string[] (3-5 things they should NOT build or spend on yet — with brief reason),

  "one_thing_today": string (single action, achievable in 2 hours, no equipment needed),

  "if_they_asked": {
    "what_platform": string,
    "what_to_charge": string,
    "what_to_call_themselves": string
  }
}
`
```

---

### Spark Report Output — Display Structure

```
Page: /plan/spark/[id]

1. "Here's what Bugbite understood" card
   we_heard — teal callout, their dream statement quoted

2. Path-type pill
   "Portfolio → Freelance" / "Maker → Seller" etc.
   With honest timeline: "6–9 months to first ₹10,000 month
   at 10 hours/week"

3. Phase 1 — START HERE
   Large, prominent. Everything else is smaller.
   What / Why / How / Cost / Timeline
   Tools listed with links
   Pages/steps needed

4. Phase 2 — After [milestone]
   Smaller card. Greyed slightly.
   "Unlock this when Phase 1 is done"

5. Phase 3 — The real business
   Even smaller. Furthest away.
   What it could look like with real ₹ numbers

6. Not yet list
   Honest. Short. Prevents expensive mistakes.

7. One thing to do today
   Bold. Orange #E87C28. Boxed separately.
   This is the most important line on the page.

8. Upsell (soft, not pushy):
   "Ready to plan the actual website?
    Get a full Blueprint for ₹99 →"
```

---

### Pricing

```
Spark Report — ₹49
OR free with waitlist email signup
```

**Rationale for the free option:** Creative builders have limited budgets. They become the best word-of-mouth channel. A design student who gets real value tells 20 friends. A clinic owner tells 2. Free Spark → ₹99 Blueprint when ready → ₹99 Developer Brief → ₹49 monthly monitor. The lifetime value of a creative builder who grows into a real business is higher than a one-time ₹49 scan.

**Bundle:** Spark (free) + Blueprint (₹99) shown as upgrade on Spark result page.

**Token cost note:** A useful Spark JSON output is ~3–5K tokens. Sonnet 4.6 cost ~₹3–5 per Spark. At 1,000 sparks/month free, that's a ₹3,000–5,000/month subsidy — acceptable LTV bet at the founder's discretion. Revisit if Sparks scale past 5,000/month without Blueprint conversions.

---

### New Pages

```
/plan/questions    → existing, add Door 3 trigger at Branch 1
/plan/spark/[id]   → Spark Report result page
```

### New API Routes

```
POST /api/spark/generate   → Claude Spark call (fifth separate Claude call)
GET  /api/spark/[id]       → Fetch spark report
```

### New DB Table

```sql
spark_reports (
  id                uuid primary key default gen_random_uuid()
  answers           jsonb not null default '{}'
  dream_statement   text
  dream_language    text    -- Claude-detected ISO 639-1
  path_type         text    -- portfolio_to_freelance | maker_to_seller | etc.
  spark_json        jsonb
  payment_status    text default 'unpaid'  -- or 'free'
  owner_email       text
  created_at        timestamptz default now()
)
```

### CLAUDE.md Addition

Spark Report is the **fifth separate Claude call** — never merged with report / UX audit / brief / blueprint. Separate prompt. Separate call. Sonnet 4.6.

Spark prompt rules:
- Always three phases: Start → First client → Scale
- Phase 1 always gets 60% of the response weight
- One thing today: always achievable in 2 hours
- Indian tools only: Framer, Canva, Behance, Instagram, Fiverr India
- Honest timelines: never oversell
- Never patronising — they are smart, they need direction

---

### PostHog Events

| Event | Properties |
|---|---|
| `spark_started` | path_type |
| `spark_questions_completed` | answer_count, has_dream_statement |
| `spark_generated` | path_type, detected_language |
| `spark_blueprint_upgrade_clicked` | spark_id |
| `spark_free_claimed` | spark_id |

---

### Launch Checklist Additions

- [ ] Door 3 trigger added to /plan/questions Branch 1
- [ ] /plan/spark/[id] page built and tested
- [ ] Spark generation tested for all 5 path types
- [ ] Free vs paid flow tested
- [ ] Blueprint upgrade CTA tested from Spark result page
- [ ] Dream statement in Hindi/Gujarati tested end to end
