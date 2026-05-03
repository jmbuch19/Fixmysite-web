# Dispute handling runbook — fixmysite.in

**When to read this:** A customer emails saying "I paid but I didn't get my report / brief / blueprint." Or Razorpay sends a chargeback notification. Or a card issuer flags a dispute.

**What you'll have at the end:** Confidence about whether the claim is true, false, or a real bug — plus the exact action to take.

---

## The three sources of truth

Cross-reference all three. Two-of-three agreement is the answer.

| Source | URL / Tool | What it tells you |
|---|---|---|
| **Razorpay dashboard** | https://dashboard.razorpay.com/app/payments | Did the charge actually happen? When, on what card, captured vs. authorised vs. failed. |
| **Supabase DB** | https://supabase.com/dashboard/project/lusjfmzmsehkmdyvmdco/editor (SQL editor) | Did our system register the payment? Did we generate the report/brief/blueprint? When? |
| **Resend dashboard** | https://resend.com/emails | Did the auto-email actually leave our server? Did it deliver, bounce, or hit spam? |

Open all three in browser tabs before responding.

---

## Step-by-step audit

### Step 1 — Get an identifier from the customer

Ask for **any one** of these (in order of preference):
1. **`payment_id`** — starts with `pay_` (Razorpay-issued, on their bank statement / Razorpay receipt email)
2. **`order_id`** — starts with `order_`
3. **Email address used at scan / brief / blueprint flow**
4. **URL they scanned** (for scans only)
5. **Approximate amount + date** (last resort, fuzzy)

If they can't produce any of these, the claim is suspicious — politely ask for the bank statement screenshot.

### Step 2 — Verify the payment in Razorpay

Razorpay dashboard → Payments → search by `payment_id` / `order_id` / email.

Outcomes:
- **"Captured"** → Money was actually taken. Proceed to Step 3.
- **"Authorised"** → Money is held but not yet captured. Should not happen for our flows (we capture immediately). If you see this, contact Razorpay support.
- **"Failed"** → They didn't actually pay. Show them the failure reason. Offer to retry payment.
- **Not found** → Either wrong identifier, wrong account (test vs. live), or false claim. Ask for the bank statement screenshot before proceeding.

### Step 3 — Find the row in our DB

In Supabase SQL editor, run **one** of:

```sql
-- By Razorpay payment ID (most reliable)
select * from scans              where payment_id = 'pay_XXXXXXXXXXXXXX';
select * from briefs             where payment_id = 'pay_XXXXXXXXXXXXXX';
select * from website_blueprints where payment_id = 'pay_XXXXXXXXXXXXXX';

-- By Razorpay order ID
select * from scans              where razorpay_order_id = 'order_XXXXXXXXXXXXXX';
select * from briefs             where razorpay_order_id = 'order_XXXXXXXXXXXXXX';
select * from website_blueprints where razorpay_order_id = 'order_XXXXXXXXXXXXXX';

-- By customer email (recent first)
select * from scans              order by created_at desc limit 50;
select * from briefs             where owner_email = 'them@example.com' order by created_at desc;
select * from website_blueprints where owner_email = 'them@example.com' order by created_at desc;

-- By URL (scans only)
select * from scans where url_normalized like '%theirsite.com%' order by created_at desc;
```

### Step 4 — Read the row state

| `payment_status` | `status` | `*_json` field | What it means |
|---|---|---|---|
| `paid` | `complete` | populated | Done. Email was sent. Most "I didn't get it" claims land here — check Resend (Step 5). |
| `paid` | `paid` (not `complete`) | populated | Generated and unlocked, but auto-email didn't fire successfully. Real bug. Investigate logs. |
| `paid` | `phase1_complete` / `generated` (scan / blueprint) | null | Paid but generation hasn't run / failed. Real bug. Manually re-trigger. |
| `unpaid` | anything | n/a | Our DB never registered the payment. If Razorpay says "captured" → webhook + verify both missed (the cold-start race). Manually flip + generate. |
| Row not found | n/a | n/a | The scan/brief/blueprint row doesn't exist for this payment. Investigate (likely a wrong-environment payment or our row was deleted). |

### Step 5 — Verify email delivery in Resend

Resend dashboard → Emails → search by recipient email or message ID.

Outcomes:
- **Delivered** → The email landed in their inbox or spam. Most common cause of "I didn't get it" — they need to check spam. Resend the URL by reply.
- **Bounced** → The email address is invalid. Ask for an alternative; resend manually.
- **Spam-marked** → Their provider flagged it. Reply with the URL inline; do NOT resend the same email (rate-limit risk).
- **Not found** → The email was never sent. If `*_json` is populated but no Resend record, the auto-email path failed. Generate manually.

---

## The four scenarios + canned responses

### Scenario A — Paid, generated, email delivered (most common)

> Razorpay: captured · DB: `paid` + `complete` · Resend: delivered

**Reality:** Email is in their spam folder.

**Reply:**
> Hi — confirmed your payment of ₹X for <product> on <date>. The email was delivered to <their_email> at <timestamp> from `reports@fixmysite.in`. Most likely it landed in your spam or promotions folder — check there first.
>
> If you still can't find it, here is the direct link: <URL>
>
> Let me know if it works.

### Scenario B — Paid, generated, email bounced

> Razorpay: captured · DB: `paid` + `complete` · Resend: bounced

**Reality:** They typed an invalid email at intake.

**Reply:**
> Hi — confirmed your payment. The email I tried to send to <bounced_email> bounced (delivery failed). Please reply with another email address you can receive at, and I'll resend the report immediately.

Then on confirmation, manually resend via Resend dashboard or re-trigger the route.

### Scenario C — Paid but auto-email never fired (real bug)

> Razorpay: captured · DB: `paid` + (`phase1_complete` / `paid` not `complete`) · Resend: nothing for this customer

**Reality:** The row got marked paid but generation or delivery silently failed. This is an actual code bug.

**Action:**
1. Manually re-trigger the worker:
   - Scans: re-publish phase 2 via the QStash dashboard, or `POST /api/scan/phase2/trigger` with the `scan_id`.
   - Briefs: `POST /api/brief/generate` with the right body (manual).
   - Blueprints: `POST /api/blueprint/generate` with `{blueprint_id}` then the auto-email path will fire.
2. Once delivered, reply to the customer:
   > Hi — apologies, our system flagged your scan as paid but didn't fire the email. I've manually resent it just now. Let me know if you receive it within 5 minutes.
3. Investigate the logs to find why the auto-email path failed (PDF render error? Resend down? Owner_email missing?). Patch the bug.

### Scenario D — Razorpay says paid, our DB doesn't know (the cold-start race)

> Razorpay: captured · DB: `unpaid` or row missing · Resend: nothing

**Reality:** Both `/payment/verify` (browser-side) and the webhook (server-side) failed to land the payment. Rare since the Razorpay webhook fallback shipped in commit `4caf24a`, but possible if the webhook itself was misconfigured or the merchant URL was unreachable.

**Action:**
1. Verify the Razorpay webhook is configured: dashboard → Webhooks → confirm the URL points to `https://fixmysite.in/api/subscription/webhook` and is "Active".
2. Manually flip the row in Supabase:
   ```sql
   update website_blueprints
   set payment_status = 'paid',
       status = 'paid',
       payment_id = 'pay_XXXXXXXXXXXXXX'  -- from Razorpay
   where razorpay_order_id = 'order_XXXXXXXXXXXXXX';
   ```
3. Trigger the auto-email path manually (re-call the verify-email helper or `POST /api/blueprint/generate`).
4. Reply to customer (use Scenario C reply text — apology + manual resend).
5. **Crucial:** investigate why the webhook didn't fire. Check Razorpay dashboard → Webhooks → recent deliveries.

### Scenario E — They didn't actually pay

> Razorpay: not found / failed · DB: nothing · Resend: nothing

**Reality:** Either (a) the payment failed and they thought it succeeded, or (b) they're trying to game us.

**Reply:**
> Hi — I checked our payment system and our gateway, but I can't find any successful payment for the email / order ID you mentioned. Your most recent payment attempt may have failed at the bank's end.
>
> Could you reply with a screenshot of the charge from your bank statement or your card app? I can then trace the exact transaction and either resend the report or refund you if the charge didn't reach us.

If they can't produce evidence, the matter ends there.

---

## Spotting false claims

Patterns to watch for:
- Vague details ("I paid yesterday with my card") with no payment_id, order_id, or email
- Pressure tactics ("Refund me NOW or I'll dispute")
- Inconsistent details (different email each follow-up)
- Asking for refund + delivery ("send me the report and refund me")

For all of these, ask for a bank statement screenshot. Genuine customers can produce one in 30 seconds; bad-faith claimants disappear.

---

## Refund vs. resend decision tree

| Situation | Action |
|---|---|
| Real bug, customer calm | Resend manually + apology. Refund only if requested. |
| Real bug, customer angry | Refund immediately + send the report anyway. Goodwill is cheaper than a chargeback. |
| Email in spam, customer found it | No action needed — close the loop. |
| Bad email address, fixed by reply | Resend, no refund. |
| They didn't pay | Polite explanation, no refund (there's nothing to refund). |
| Chargeback already initiated | Submit Razorpay dispute response with: payment_id, terms_accepted_at timestamp, generation timestamp, email-delivery timestamp, the report PDF itself. Razorpay sides with you when the trail is intact. |

---

## Razorpay chargeback response — what to attach

When Razorpay opens a dispute:
1. **Proof of consent:** the `terms_accepted_at` timestamp from the row + a screenshot of the live unlock card with the T&C checkbox visible.
2. **Proof of order binding:** the `razorpay_order_id` from our DB matches the `payment_id` Razorpay disputes against.
3. **Proof of delivery:** the report / brief / blueprint PDF rendered for that row, plus the Resend delivery log showing the email landed at the customer's address.
4. **Customer correspondence:** any email thread where you offered to resend.

Attach all four. Most chargebacks resolve in our favour with this evidence package.

---

## Maintenance

This runbook is checked into the repo at `docs/dispute-handling.md`. Update it whenever:
- A new product type ships (add a column to the table queries)
- The DB schema changes (column names, status enums)
- A new failure mode appears that doesn't fit the four scenarios

Last updated: 3 May 2026 (v1).
