# BRAND.md — fixmysite.in
> Brand guidelines for Claude Code. Read before touching any UI, CSS, or copy.

---

## Identity

**Product name:** fixmysite.in
- Always lowercase in product UI, nav, copy
- Always uppercase in logo: **FIXMYSITE.IN**
- Always include `.in` — never just "fixmysite"
- Never: Fix My Site, FixMySite, fix my site

**Mascot name:** Bugbite
- Always: Bugbite (capital B, one word)
- Never: Bug Bite, bugbite, BugBite
- Bugbite speaks in third person always
  → "Bugbite found 4 issues" never "I found 4 issues"
- Voice: curious, action-oriented, warm. Never robotic.
- Use Bugbite in: scan progress, empty states, error states,
  email subjects, loading states, 404 page, CTAs
- Bugbite is the cat. The cat is Bugbite. They are the same.

**Tagline:** Your website, finally well-behaved.
- Sentence case always
- Period at the end always
- Never all-caps in body copy
- Placement: below hero headline, below logo in formal contexts

**Mascot:** Bugbite — black cat with orange wrench-curl tail
- Always appears above or beside the wordmark
- Never distorted, recoloured, or used without the wrench tail detail
- Favicon: cat face only (no text, no background)

---

## Bugbite Copy — Reference Library

Every Bugbite line follows one rule: **short, active, warm.**

### Scan progress
```
"Bugbite is checking your phone numbers..."
"Bugbite is reading your contact form..."
"Bugbite is running through your links..."
"Bugbite is checking your SSL certificate..."
"Bugbite is analysing your content..."
"Bugbite is almost done..."
```

### Results
```
"Bugbite found 4 problems."          ← issues found
"Bugbite checked everything. Your website is clean."  ← zero issues
"Bugbite found something new since last month."       ← re-scan
"Bugbite remembers your last visit. Let's see what changed." ← return visit
```

### States & errors
```
"Bugbite is on it..."                ← loading
"Bugbite couldn't reach this site. Check the URL and try again." ← unreachable
"Even Bugbite can't find this page." ← 404
"Bugbite ran into a problem. Try again or email hello@fixmysite.in" ← error
```

### CTAs & prompts
```
"Let Bugbite check."                 ← scan button alt
"See what Bugbite found →"           ← report link
"Add Bugbite to your home screen."   ← PWA install
"Bugbite finds the bugs. You fix them. We make the introduction." ← developer page
```

### Email subjects
```
"Bugbite found 4 issues on nirujclinic.com"
"Bugbite checked your site — here's the report"
"Bugbite spotted something new on your website"
"Bugbite ran your monthly check"
"Your Bugbite report is ready"
```

### Enterprise / large site
```
"This is a large website. Bugbite handles those too — at a different price."
```

### Rules for writing new Bugbite copy
- Always third person: "Bugbite found" never "I found"
- Always active: "Bugbite is checking" never "checks are running"
- Always short: one sentence maximum
- Never: "Bugbite has successfully completed the verification process"
- Always: "Bugbite is done."

---

```css
/* Primary — product identity */
--color-brand-teal:        #0F6E56;   /* logo text, CTAs, headers, links */
--color-brand-teal-light:  #1D9E75;   /* hover states, accents */
--color-brand-teal-surface:#E1F5EE;   /* card backgrounds, badges */

/* Accent — mascot + personality */
--color-brand-orange:      #E87C28;   /* tagline, High priority badges, accents */
--color-brand-orange-light:#FDF0E6;   /* orange card backgrounds */

/* Neutral */
--color-black:             #1A1A1A;   /* body text, cat body */
--color-white:             #FFFFFF;   /* page background */
--color-grey-100:          #F5F5F5;   /* subtle section bg */
--color-grey-400:          #9CA3AF;   /* placeholder text, disabled */
--color-grey-600:          #4B5563;   /* secondary text */

/* Status — issue severity */
--color-status-high:       #E87C28;   /* High priority — orange (matches cat) */
--color-status-medium:     #EF9F27;   /* Medium priority — amber */
--color-status-low:        #0F6E56;   /* Low priority — teal */
--color-status-ok:         #1D9E75;   /* Passing checks — green */
--color-status-fail:       #E87C28;   /* Failed checks — orange */
--color-status-warning:    #EF9F27;   /* Warning checks — amber */

/* Scan states */
--color-state-queued:      #9CA3AF;   /* grey — waiting */
--color-state-scanning:    #EF9F27;   /* amber — in progress */
--color-state-complete:    #1D9E75;   /* green — done */
--color-state-failed:      #E24B4A;   /* red — error (only use case for red) */

/* Payment confirmation */
--color-payment-confirmed: #1D9E75;   /* emerald strip */
```

**Usage rules:**
- Teal `#0F6E56` = primary action colour. CTAs, nav, headings.
- Orange `#E87C28` = accent only. Tagline, High priority, cat elements.
- Red `#E24B4A` = scan failed state ONLY. Never for priority badges.
- Never use lime green. Never use the original logo lime green.
- Dark mode: black background `#000000` for logo card only — not the product UI.

---

## Logo Files

```
/public/brand/
  logo-light.png         ← cat + FIXMYSITE.IN + tagline, white background
  logo-dark.png          ← cat + FIXMYSITE.IN + tagline, black background
  logo-mark.png          ← cat only, transparent background (for favicon source)
  logo-horizontal.svg    ← cat + wordmark side by side (future, if needed)

/public/icons/
  icon-192.png           ← cat face only, 192×192, for PWA manifest
  icon-512.png           ← full cat with wrench tail, 512×512, for PWA manifest
  favicon.ico            ← cat face, multi-size ICO pack (16/32/48)
  apple-touch-icon.png   ← cat face, 180×180, for iOS
```

**Favicon spec:**
- 16×16: orange eyes on black — silhouette readable
- 32×32: cat head with ears, eyes, whiskers
- 180×180 (Apple): full cat head, no text
- 512×512 (PWA): full cat with wrench tail, no text, transparent bg

---

## Typography

```css
/* Headings */
font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
font-weight: 600 (headings) / 500 (subheadings) / 400 (body)

/* Monospace (URLs, scan IDs, code) */
font-family: 'JetBrains Mono', 'Fira Code', monospace;

/* Size scale */
--text-xs:   11px;   /* scan reference IDs, microcopy */
--text-sm:   13px;   /* card body, labels */
--text-base: 15px;   /* body text */
--text-lg:   18px;   /* section headings */
--text-xl:   22px;   /* page headings */
--text-2xl:  28px;   /* hero headline */
--text-hero: 36px;   /* landing page hero */
```

---

## Voice & Tone

**fixmysite.in speaks like a knowledgeable friend. Not a consultant. Not a bot.**

### Always
- Plain language. If a clinic owner in Rajkot can't understand it, rewrite it.
- Specific. "Your landline +91-79-XXXXXX is inactive" not "phone issue detected."
- Direct. Say what it is. Say what to do. Stop.
- Warm but not effusive. Care without gushing.
- Active voice. "We found 4 issues" not "4 issues were found."

### Never
- "Robust", "seamless", "leverage", "utilize", "ensure"
- "Congratulations", "great job", "well done", "amazing"
- Passive voice for findings
- Technical jargon without plain-language translation
- Accusatory framing ("you made an error") — always observational ("customers may notice...")
- Fake urgency ("Act now!")

### Tone by context
| Context | Tone |
|---|---|
| Landing page | Confident, clear, slightly playful |
| Scan in progress | Calm, informative |
| Free preview | Helpful, creates curiosity without manipulation |
| Full report findings | Precise, plain, action-oriented |
| Solution map | Practical, specific, prioritised |
| Return visit (fixes made) | Warm, grounded, never effusive |
| Error states | Honest, helpful, always gives next action |
| Enterprise inquiry | Professional, respectful |
| Developer-facing | Peer-to-peer, technical precision OK |

### Multilingual note
- UI labels and CTAs: English
- Free text inputs: accept any language — Hindi, Gujarati, Hinglish, English
- Report findings: English always (developer must read them)
- Error messages: English, but warm enough to not feel foreign

---

## UI Component Rules

### Buttons
```
Primary CTA:    bg #0F6E56, text white, rounded-md
                "Scan my site", "Get full report — ₹49", "Pay ₹49"

Secondary:      border #0F6E56, text #0F6E56, transparent bg
                "Send to developer", "Download PDF"

Destructive:    bg #E24B4A (scan failed state ONLY)

Disabled:       opacity 50%, cursor not-allowed
                Never hide disabled buttons — they are promises

Loading state:  Same as primary, reduced opacity, spinner left of label
```

### Cards
```
Default:        bg white, border #E5E7EB (0.5px), rounded-md, shadow-sm
Issue card:     Same + left border 3px in status colour
Section header: bg #F5F5F5, text #1A1A1A, font-weight 500
```

### Priority Badges
```
High:    bg #E87C28, text white   → "High"
Medium:  bg #EF9F27, text white   → "Medium"
Low:     bg #0F6E56, text white   → "Low"
```

### Effort Tags
```
All effort levels: bg #F5F5F5, text #4B5563, font-size 11px
→ "Low effort"  "Medium effort"  "High effort"
```

### Status Indicators
```
Dot colours:
  ok:      #1D9E75 (green)
  fail:    #E87C28 (orange)
  warning: #EF9F27 (amber)
  
Tag colours (match dot):
  ok tag:      bg #E1F5EE, text #0F6E56   → "OK"
  fail tag:    bg #FDF0E6, text #E87C28   → "Broken"
  warning tag: bg #FEF3C7, text #92400E   → "Warning"
```

### Scan State Strip
```
Payment confirmed: bg #1D9E75, text white  → emerald
Scan queued:       bg #F5F5F5, text #4B5563 → grey
Scan running:      bg #FEF3C7, text #92400E → amber
Scan complete:     bg #E1F5EE, text #0F6E56 → teal
Scan failed:       bg #FEE2E2, text #991B1B → red
```

---

## Layout Rules

- **Mobile-first.** Design at 375px first. Test at 375px before desktop.
- **Max content width:** 720px centered. Never full-bleed text.
- **Nav:** logo left, minimal links right. No hamburger menu unless absolutely necessary.
- **Section spacing:** 2rem between sections on mobile, 3rem on desktop.
- **Report sections:** collapsible accordion on mobile, expanded on desktop.
- **No sidebars.** Single column always.

---

## Animation Rules

- Scan progress: subtle pulse on the scanning indicator
- Status transition scanning → complete: 600ms pause before rendering report
- Page transitions: none (Next.js default, no custom transitions)
- Loading states: spinner only on buttons — never full-page spinners
- Never: parallax, scroll animations, hover zoom on images

---

## Email Templates — Brand Rules

All emails from fixmysite.in:
- From: `reports@fixmysite.in`
- Reply-to: `hello@fixmysite.in`
- Subject lines: plain, specific, no emoji
- Body: plain text preferred. If HTML: white background, teal CTA button, no images except logo
- Footer: always includes `hello@fixmysite.in` as escape hatch
- Sign-off: `— fixmysite.in` (em dash, space, name)
- Never: "Dear valued customer", "We hope this email finds you well"

---

## PDF Report — Brand Rules

- Header: cat logo (mark only) + FIXMYSITE.IN in teal, left-aligned
- Sub-header: scan URL, date, health score
- Body: Plus Jakarta Sans, 11pt body, 14pt headings
- Priority badges: same colours as web
- Footer: fixmysite.in + scan reference ID + page numbers
- Agency white-label: replace header logo + name — keep "Powered by fixmysite.in" in footer

---

## PWA Manifest

```json
{
  "name": "fixmysite.in",
  "short_name": "fixmysite",
  "description": "Website health checker for Indian businesses. Your website, finally well-behaved.",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#0F6E56",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

---

## Social & Meta

```html
<!-- OG / Twitter card defaults -->
<meta property="og:title" content="fixmysite.in — Your website, finally well-behaved." />
<meta property="og:description" content="We scan your website and tell you exactly what's broken — in plain language, no jargon." />
<meta property="og:image" content="https://fixmysite.in/brand/og-default.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />

<!-- Per-scan OG image (dynamic) -->
og:title  → "nirujclinic.com — 4 issues found"
og:image  → generated card with health score + cat mark
```

---

## What To Never Do

- Never use red for priority badges — red is for scan failure only
- Never hide disabled buttons — disable, never hide
- Never use lime green anywhere — it was the first logo iteration
- Never use "fixmysite" without ".in" in product UI
- Never write findings accusatorially
- Never leave an error state without a next action
- Never use the cat without the wrench-tail detail
- Never recolour the cat (it is always black + orange accents)
- Never use more than 3 font weights on one page
- Never full-page loading spinners

---

## Quick Reference Card

```
Logo:        Cat + FIXMYSITE.IN + tagline
Tagline:     "Your website, finally well-behaved."
Teal:        #0F6E56  → primary
Orange:      #E87C28  → accent, High priority
Font:        Plus Jakarta Sans
Favicon:     Cat face only
Voice:       Knowledgeable friend. Plain. Specific. Warm.
Mobile:      375px first. Always.
```
