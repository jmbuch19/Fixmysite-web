# SPEC.md — fixmysite.in
> Version 1.1 · Bootstrapped · Solo founder · Ahmedabad

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
| Framework | Next.js 14 (App Router) |
| Hosting | Vercel |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email magic link) |
| Payments | Razorpay |
| Email | Resend |
| Phone verification | Twilio Lookup API |
| PDF generation | Puppeteer (Vercel-compatible) or `@react-pdf/renderer` |
| Analytics | PostHog |
| PWA | next-pwa |
| Styling | Tailwind CSS |

**No mobile app. PWA only.**

---

## 3. PWA Configuration

- `manifest.json` with name, short_name, icons (192×192, 512×512), theme_color `#0F6E56`
- `next-pwa` configured in `next.config.js`
- Offline fallback page: *"You're offline. Paste your URL when back online."*
- `start_url`: `/`
- `display`: `standalone`
- Install prompt handled via `beforeinstallprompt` event
- Service worker caches: static assets, fonts only. Never cache scan results.

---

## 4. Scan Architecture — Two Phases

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

## 5. Pricing Structure

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

## 6. Return Visit Intelligence

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

## 7. Database Schema (Supabase)

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
scan_id     uuid references scans(id)
dev_email   text
sent_at     timestamptz
status      text -- sent | failed
```

---

## 8. API Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/scan/phase1` | Pre-scan: reachability + page count |
| POST | `/api/scan/check-previous` | Check if URL has prior paid scan |
| POST | `/api/scan/phase2` | Deep scan (auth: valid payment_id or free_rescan) || POST | `/api/payment/create-order` | Razorpay order creation |
| POST | `/api/payment/verify` | Razorpay signature verification |
| GET | `/api/report/[scan_id]` | Fetch report JSON |
| POST | `/api/report/pdf` | Generate + return PDF |
| POST | `/api/report/send-developer` | Email report to developer |
| POST | `/api/subscription/create` | Create Razorpay subscription |
| POST | `/api/subscription/webhook` | Razorpay subscription events |
| GET | `/api/admin/scans` | Admin: list all scans (protected) |

All routes: rate-limited, input-validated, error-logged.

---

## 9. Security

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

## 10. Page Structure

```
/                    → Landing + URL input
/scanning/[scan_id]  → Phase 1 result + pricing gate
/report/[scan_id]    → Free preview (pre-payment)
/report/[scan_id]/full → Full report (post-payment)
/subscribe           → Monthly plan page
/agency              → Agency / white-label plan
/admin               → Internal admin (protected)
/privacy             → Privacy policy
/terms               → Terms of service
```

---

## 11. SEO & Discovery

- Static landing page: fully SSR, fast TTFB
- Meta: *"Free website health check for Indian businesses. Detect broken phone numbers, links, SSL issues instantly."*
- sitemap.xml auto-generated
- robots.txt: allow all except `/admin`, `/api`
- Structured data: `WebApplication` schema
- OG image: auto-generated per scan result (shareable)
- Target keywords: website health check India, broken website checker, fix my website, website audit tool India

---

## 12. Analytics (PostHog)

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

---

## 13. Revenue Model Summary

| Stream | Price | Notes |
|---|---|---|
| One-time scan (Small) | ₹49 | Core product |
| One-time scan (Medium) | ₹149 | Auto-detected |
| One-time scan (Large) | ₹349 | Auto-detected |
| Monthly re-scan | ₹99/month | Subscription |
| Agency / white-label | ₹999/month | B2B |
| Developer leads | ₹200–500/lead | Future phase |

Target PAT: 25% at scale. Gross margin per scan: ~88%.

---

## 14. Launch Checklist

- [ ] Domain live: fixmysite.in (GoDaddy → Vercel)
- [ ] Supabase project created, schema migrated
- [ ] Razorpay test mode → live mode
- [ ] Twilio account + Lookup API key
- [ ] Resend domain verified
- [ ] PostHog project created
- [ ] PWA manifest + icons
- [ ] Privacy policy + Terms live
- [ ] Rate limiting active
- [ ] SSRF protection active
- [ ] PDF generation tested
- [ ] End-to-end payment flow tested
- [ ] Send-to-developer email tested
- [ ] Mobile PWA install tested (Android Chrome)
