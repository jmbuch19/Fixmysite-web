# Post-deploy QA — fixmysite.in

**When to read this:** After any production deploy that touches a paid flow, an email path, a PDF render, the wizard, or a payment route. Walk top-to-bottom. Check off each row as you go.

**Time budget:** ~40 minutes if everything works, up to 2 hours if anything breaks.

**What you need open:**
- Production site in a browser tab
- Razorpay dashboard (https://dashboard.razorpay.com)
- Supabase SQL editor (https://supabase.com/dashboard/project/lusjfmzmsehkmdyvmdco/editor)
- Resend dashboard (https://resend.com/emails)
- Vercel functions logs (https://vercel.com/<your-team>/fixmysite-web/functions)
- A real card you're willing to charge ~₹250 of test payments to (refund yourself after)

---

## Pre-deploy

- [ ] **Apply pending migrations** — `npx supabase db push`
- [ ] **Verify Vercel env vars** — all of these present and pointing at PRODUCTION values, not test:
  - Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`
  - Resend: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
  - Anthropic: `ANTHROPIC_API_KEY`
  - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
  - QStash: `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
  - Cloudflare R2: `CLOUDFLARE_R2_*` (only relevant when screenshots ship)
  - App: `NEXT_PUBLIC_APP_URL` = `https://fixmysite.in`
- [ ] **Vercel deploy succeeds** — Functions tab lists every `/api` route, no build errors
- [ ] **Razorpay webhook confirmed** — dashboard → Webhooks → URL = `https://fixmysite.in/api/subscription/webhook`, status Active, events subscribed include `payment.captured` and `order.paid`

---

## Path 1 — Scan flow (₹49 small site)

| Step | Verify |
|---|---|
| Visit `https://fixmysite.in/` | Cat logo + tagline + the *"Bugbite ventures abroad soon — say hi at hello@fixmysite.in"* line visible |
| Enter a URL you control (clinic site / portfolio / friend's site) | Phase 1 runs, redirects to `/scanning/[scan_id]` |
| Scanning page shows tier + price | Price ₹49 visible, T&C checkbox visible above Pay button |
| **Click Pay without ticking T&C** | Button stays disabled — confirms client guard |
| Tick T&C → Pay ₹49 | Razorpay modal opens with brand teal theme |
| Complete payment with a real card | Modal closes, "Payment confirmed" appears, redirects to `/report/[scan_id]/full` within ~2-3 minutes (Phase 2 worker time) |
| Report renders | All sections present, no `¹` instead of `₹` anywhere |
| Download PDF (action bar) | Filename `fixmysite-[hostname]-report.pdf`, opens cleanly, ₹ renders correctly |
| Send to developer | Type your second email, submit, success message |
| Check Razorpay dashboard | Payment captured, order_id matches DB row |
| Check Supabase | `select payment_status, status, terms_accepted_at, payment_id from scans where id = '...';` — all four populated |
| Check Resend dashboard | Two emails: report-ready to owner + report-to-developer (both Delivered) |
| Check the actual inbox | Both emails arrived, PDFs attached, no broken images, subject lines correct |
| Spam check | If sent to gmail / outlook, the email shouldn't be in spam — if it is, raise a ticket with Resend or check `RESEND_FROM_EMAIL` is on a verified domain |

---

## Path 2 — Brief flow (₹99 brief on a paid scan)

| Step | Verify |
|---|---|
| From the report page, click "Get a Developer Brief" upsell | Lands on `/brief/[scan_id]` input form |
| Type a real concern (e.g. *"Make my booking flow faster"*), select 2-3 cards, enter your email | Submit fires brief generation |
| Brief preview page shows first work item | Rest is locked behind paywall |
| Tick T&C, Pay ₹99 | Razorpay modal opens |
| Complete payment | Auto-redirect to `/brief/[scan_id]/full` |
| Full brief renders | All sections, owner's verbatim words preserved exactly, no banned words leaked (no "utilize" / "leverage" / "ensure" / "robust" / "seamless") |
| Auto-email lands in inbox | Subject *"Bugbite has your developer brief ready..."*, PDF attached |
| PDF check | Filename `fixmysite-brief-[hostname]-YYYY-MM-DD.pdf`, all rupees render correctly, owner verbatim words preserved |
| Send to developer | Use a different email, success message |
| Developer email arrives | Subject *"Developer brief for [hostname]..."*, peer-to-peer body, PDF attached |
| Check Supabase | `briefs.payment_status='paid'`, `terms_accepted_at` populated, `dev_email` populated, `sent_at` populated |

---

## Path 3 — Blueprint flow (₹99 blueprint)

| Step | Verify |
|---|---|
| Visit `https://fixmysite.in/` | The "**Plan a website →**" ghost button visible under *"No website yet, or one you want to replace?"* |
| Click it | Lands on `/plan` |
| Click "Plan a website" CTA | Lands on `/plan/questions`, step 1 of 7 |
| Walk through all 7 steps with real-ish answers | Validation works on each step, "Next →" advances, business_name + owner_name + email + WhatsApp captured at step 7 |
| Submit | Loader: *"Bugbite is reading your answers and writing your blueprint…"* (~10-15s) |
| Preview page renders | Recommendation pill, understood card, paywall card with T&C checkbox + "say hi" line |
| Tick T&C, Pay ₹99 | Razorpay modal opens with email + name pre-filled from wizard |
| Complete payment | "Payment confirmed. Bugbite is unlocking your blueprint…" → `/full` |
| Full page renders | Pill row, why_right, why_not_alternative, pages, technology with avoid list, next_steps with INR cost tags, red_flags amber callouts, scan cross-sell footer, action bar |
| Download PDF | 5-page PDF, rupee glyph correct everywhere |
| Send to developer | Email arrives, peer-to-peer copy |
| Check Supabase | `select payment_status, status, terms_accepted_at, blueprint_json is not null as has_json, completed_at, dev_email from website_blueprints where id = '...';` — all populated |
| **Cold-start race test:** start another wizard run, pay, but **close the tab immediately after Razorpay confirms** | Wait 60 seconds. Check Supabase — row should still flip to `payment_status='paid'` via the webhook. Auto-email should still land. This proves the safety net we shipped on `4caf24a` works. |

---

## Cross-cutting

- [ ] **All three paywalls show the international disclaimer** mentioning Hostinger India / Razorpay / Truelancer
- [ ] **All three paywalls show the T&C checkbox** linked to `/terms` and `/privacy` (open in new tab)
- [ ] **`/terms` and `/privacy` load** (cheap check, easy miss)
- [ ] **Razorpay webhook deliveries** — dashboard → Webhooks → recent → all `200 OK` responses for the test payments above
- [ ] **Vercel function logs are quiet** — no `[verify-email] PDF render failed` or `[claude/...] failed to obtain valid` warnings tied to the test runs
- [ ] **Email rendering across providers** — at minimum hit a Gmail address AND an Outlook/Hotmail address. Spam-folder check on each.

---

## When something breaks

Reach for [`docs/dispute-handling.md`](dispute-handling.md). The same three-source-of-truth audit (Razorpay + Supabase + Resend) that resolves customer disputes also self-debugs your QA failures. Plus the canned reply text — useful when a real customer hits the bug before you do.

---

## Refunding test payments

After all paths pass:
1. Razorpay dashboard → Payments → find each test payment
2. Refund → "Full refund" → confirm
3. Refund typically lands back on the test card in 5-7 business days

Worth doing even on your own card — keeps the income statement clean and avoids needing to back out test charges later.

---

## Maintenance

This runbook is checked into the repo at `docs/post-deploy-qa.md`. Update it whenever:
- A new product type ships (add a new Path section)
- A new paywall surface ships (add it to Cross-cutting)
- A new env var becomes required (add to Pre-deploy)
- A new failure mode appears worth checking proactively

Last updated: 3 May 2026 (v1).
