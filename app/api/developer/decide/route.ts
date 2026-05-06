import { createServiceClient } from '@/lib/supabase/server'
import { verifyApprovalToken } from '@/lib/developer/approvalToken'
import { sendDeveloperApprovedToPartner } from '@/lib/email/sender'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/developer/decide?token=...
 *
 * The endpoint behind the Approve / Reject one-click links in the
 * admin notification email. The token is an HMAC-signed JWT (jose
 * HS256) carrying { partner_id, action } — see
 * lib/developer/approvalToken.ts.
 *
 * GET (not POST) is the deliberate choice: clicking a link in an
 * email is the founder's intent, and the token's HMAC signature is
 * the authorisation. POST forms would force the founder onto a
 * confirmation page — the user explicitly asked for "no friction."
 *
 * Idempotency / pre-fetcher safety: Gmail and Outlook may pre-render
 * email links to detect phishing. The first hit applies the action;
 * later hits read the row's current state (verified=true OR
 * active=false) and short-circuit to a "Already decided" page without
 * mutating anything or re-firing the welcome email. Single-use
 * semantics enforced at the row level, not the token.
 *
 * Always returns HTML (text/html) — the founder is reading this in
 * a browser tab, not parsing JSON. Status is 200 across the happy +
 * already-decided + token-expired branches; only token-tampering and
 * server errors surface 4xx/5xx.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return htmlPage({
      status: 400,
      title: 'Missing token',
      body:
        'This link is missing its authorisation token. Open the original ' +
        'admin notification email and click Approve or Reject from there.',
    })
  }

  const verified = await verifyApprovalToken(token)
  if (!verified.ok) {
    if (verified.reason === 'expired') {
      return htmlPage({
        status: 200,
        title: 'Link expired',
        body:
          'This approval link has expired. The auto-approval cron runs ' +
          'hourly and approves any pending registration older than 48 ' +
          'hours, so the partner has likely been notified already. To ' +
          'verify, check the developer_partners row in Supabase.',
      })
    }
    return htmlPage({
      status: 403,
      title: 'Invalid link',
      body:
        'This approval link is invalid or has been tampered with. Open ' +
        'the original admin notification email and try again.',
    })
  }

  const supabase = createServiceClient()
  const { data: partner, error: loadError } = await supabase
    .from('developer_partners')
    .select(
      'id, name, email, city, skills, verified, active, decision_method',
    )
    .eq('id', verified.partnerId)
    .maybeSingle()

  if (loadError) {
    console.error('[developer/decide] load failed', {
      partner_id: verified.partnerId,
      error: loadError.message,
    })
    return htmlPage({
      status: 500,
      title: 'Server error',
      body: 'Could not load the partner record. Please try again in a moment.',
    })
  }

  if (!partner) {
    return htmlPage({
      status: 404,
      title: 'Partner not found',
      body:
        'This partner record no longer exists. It may have been deleted ' +
        'manually. No action taken.',
    })
  }

  // ─── Idempotency: short-circuit if the row was already decided ─────
  if (verified.action === 'approve' && partner.verified) {
    const methodNote =
      partner.decision_method === 'auto'
        ? ' (auto-approved after 48 hours).'
        : '.'
    return htmlPage({
      status: 200,
      title: 'Already approved',
      body: `${partner.name} was already approved${methodNote} The welcome email has been sent.`,
    })
  }
  if (verified.action === 'reject' && partner.active === false) {
    return htmlPage({
      status: 200,
      title: 'Already rejected',
      body: `${partner.name} was already rejected. No email was sent to the applicant.`,
    })
  }

  // ─── Apply the decision ────────────────────────────────────────────
  if (verified.action === 'approve') {
    const nowIso = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('developer_partners')
      .update({
        verified: true,
        verified_at: nowIso,
        decision_method: 'admin',
      })
      .eq('id', partner.id)
      // Race guard: only flip if still pending. Two clicks in flight
      // simultaneously cleanly resolves to one update + one already-
      // decided render.
      .eq('verified', false)

    if (updateError) {
      console.error('[developer/decide] approve update failed', {
        partner_id: partner.id,
        error: updateError.message,
      })
      return htmlPage({
        status: 500,
        title: 'Server error',
        body: 'Could not approve. Please try again or set verified=true in Supabase.',
      })
    }

    // Welcome email — fire-and-log. Approval is the durable fact; if
    // Resend hiccups the founder can re-send manually from the
    // admin panel (when it ships) or by replying to the partner's
    // original confirmation email.
    const sendResult = await sendDeveloperApprovedToPartner({
      to: partner.email,
      name: partner.name,
      city: partner.city,
      skills: (partner.skills ?? []) as string[],
    })
    if (!sendResult.ok) {
      console.error('[developer/decide] approval email send failed', {
        partner_id: partner.id,
        partner_email: partner.email,
        reason: sendResult.reason,
        error: sendResult.error,
      })
    }

    return htmlPage({
      status: 200,
      title: 'Approved',
      body: `${partner.name} is now a Certified Partner. ${
        sendResult.ok
          ? 'Welcome email sent.'
          : 'Welcome email failed to send — check the runtime logs.'
      }`,
    })
  }

  // action === 'reject'
  const { error: updateError } = await supabase
    .from('developer_partners')
    .update({ active: false })
    .eq('id', partner.id)
    .eq('active', true)

  if (updateError) {
    console.error('[developer/decide] reject update failed', {
      partner_id: partner.id,
      error: updateError.message,
    })
    return htmlPage({
      status: 500,
      title: 'Server error',
      body: 'Could not reject. Please try again or set active=false in Supabase.',
    })
  }

  return htmlPage({
    status: 200,
    title: 'Rejected',
    body: `${partner.name} has been rejected. No email was sent to the applicant.`,
  })
}

// ─── HTML helper ──────────────────────────────────────────────────────

/**
 * Minimal branded confirmation page. No client JS, no fetch — the
 * founder reads this once and closes the tab. Inline CSS keeps the
 * route self-contained (no shared layout dependency, no hydration
 * cost). Brand teal matches the rest of the product so the page
 * doesn't look like a stranger landed in their inbox.
 */
function htmlPage(args: {
  status: number
  title: string
  body: string
}): Response {
  const safeTitle = escapeHtml(args.title)
  const safeBody = escapeHtml(args.body)
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${safeTitle} — fixmysite.in</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #18181b;
      background: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      max-width: 480px;
      width: 100%;
      background: #fff;
      border: 1px solid #e4e4e7;
      border-radius: 16px;
      padding: 32px;
    }
    .brand {
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #0F6E56;
    }
    h1 {
      margin: 8px 0 16px;
      font-size: 24px;
      line-height: 1.25;
      letter-spacing: -0.01em;
    }
    p { margin: 0; color: #3f3f46; }
    a { color: #0F6E56; }
  </style>
</head>
<body>
  <main class="card">
    <p class="brand">fixmysite.in</p>
    <h1>${safeTitle}</h1>
    <p>${safeBody}</p>
  </main>
</body>
</html>`
  return new Response(html, {
    status: args.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
