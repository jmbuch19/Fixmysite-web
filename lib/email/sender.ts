import { Resend } from 'resend'
import { formatIssueTitle } from '@/lib/report/formatTitle'

let _resend: Resend | null = null

function getResend(): Resend | null {
  if (_resend) return _resend
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  _resend = new Resend(key)
  return _resend
}

const FROM = process.env.RESEND_FROM_EMAIL ?? 'reports@fixmysite.in'

export type SendResult =
  | { ok: true; id?: string }
  | { ok: false; reason: 'no_api_key' | 'send_failed'; error?: string }

// ─── Internal — shared send pipeline ──────────────────────────────────

async function send(args: {
  to: string
  subject: string
  text: string
  context: string // for log lines, e.g. 'otp', 'inquiry_approved'
}): Promise<SendResult> {
  const resend = getResend()
  if (!resend) {
    console.warn('[email] RESEND_API_KEY missing — not sent', {
      context: args.context,
      to: args.to,
    })
    return { ok: false, reason: 'no_api_key' }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: args.to,
      subject: args.subject,
      text: args.text,
    })

    if (error) {
      console.error('[email] Resend send failed', {
        context: args.context,
        to: args.to,
        error: error.message,
      })
      return { ok: false, reason: 'send_failed', error: error.message }
    }

    console.info('[email] sent', {
      context: args.context,
      to: args.to,
      id: data?.id,
    })
    return { ok: true, id: data?.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[email] Resend exception', {
      context: args.context,
      to: args.to,
      error: msg,
    })
    return { ok: false, reason: 'send_failed', error: msg }
  }
}

// ─── 1. OTP verification (existing) ──────────────────────────────────

/**
 * Send the 6-digit OTP for the enterprise / institution path.
 * Plain-text body, 15-min validity stated explicitly.
 */
export async function sendOtpEmail(args: {
  to: string
  otp: string
  hostname: string
}): Promise<SendResult> {
  const subject = `Bugbite needs to verify you own ${args.hostname}`
  const text = [
    'Hi,',
    '',
    `Bugbite wants to scan ${args.hostname} but needs to confirm you manage it first.`,
    '',
    `Your 6-digit code: ${args.otp}`,
    '',
    'The code expires in 15 minutes. If you did not request this, ignore this email.',
    '',
    'Trouble verifying? Reply to this email or write to hello@fixmysite.in.',
    '',
    '— fixmysite.in',
  ].join('\n')

  return send({ to: args.to, subject, text, context: 'otp' })
}

// ─── 2. New inquiry — admin notification (CLAUDE.md template 7) ──────

/**
 * Notify the admin (ADMIN_EMAIL) when a fresh inquiry hits 'otp_verified'.
 * Subject encodes the URL class so admin can scan their inbox at a glance.
 * Falls back to no-op (`no_api_key`) if ADMIN_EMAIL is unset — never throws.
 */
export async function sendInquiryReceivedToAdmin(args: {
  inquiry_id: string
  url: string
  url_class: string
  hostname: string
  claimed_email: string
  submitted_at: string
  admin_panel_url: string // absolute, e.g. https://fixmysite.in/admin/inquiries/<id>
}): Promise<SendResult> {
  const adminAddr = process.env.ADMIN_EMAIL?.trim()
  if (!adminAddr) {
    console.warn(
      '[email] ADMIN_EMAIL not set — inquiry admin notification skipped',
      { inquiry_id: args.inquiry_id },
    )
    return { ok: false, reason: 'no_api_key' }
  }

  const subject = `New enterprise inquiry — ${args.url_class} — ${args.hostname}`
  const text = [
    `URL: ${args.url}`,
    `Classification: ${args.url_class}`,
    `Claimed email: ${args.claimed_email} ✓ OTP verified`,
    `Submitted: ${formatTimestamp(args.submitted_at)}`,
    '',
    `Review in admin panel: ${args.admin_panel_url}`,
    '',
    'Set a price and approve to proceed.',
    '',
    '— fixmysite.in',
  ].join('\n')

  return send({
    to: adminAddr,
    subject,
    text,
    context: 'inquiry_received_admin',
  })
}

// ─── 3. Inquiry confirmation — to claimant (CLAUDE.md template 8) ────

/**
 * Send the claimant a courtesy confirmation that their request was
 * received. Mirrors the success-card copy on the OTP verification UI so
 * the claimant has both an in-browser acknowledgement AND a permanent
 * record in their inbox.
 */
export async function sendInquiryReceivedToClaimant(args: {
  to: string
  hostname: string
}): Promise<SendResult> {
  const subject = `Bugbite has your request for ${args.hostname}`
  const text = [
    'Hi,',
    '',
    `Thank you for reaching out about ${args.hostname}.`,
    '',
    "Bugbite handles large sites at a custom price. We'll be in touch within 24 hours with a quote and next steps.",
    '',
    'Questions, or want to expedite? Reply to this email or write to hello@fixmysite.in.',
    '',
    '— fixmysite.in',
  ].join('\n')

  return send({
    to: args.to,
    subject,
    text,
    context: 'inquiry_received_claimant',
  })
}

// ─── 4. Inquiry approved — to claimant ───────────────────────────────

/**
 * Sent when admin approves an inquiry and sets a quote. The claimant gets
 * the price and an invitation to reply (replies route to the verified
 * Workspace inbox, since RESEND_FROM_EMAIL is an alias of jaydeep@).
 *
 * If `institution_type` is set, surface it in the email so the claimant
 * sees we've correctly classified them.
 */
export async function sendInquiryApprovedToClaimant(args: {
  to: string
  hostname: string
  url_class_label: string // already formatted — "Indian enterprise", "NGO / Non-profit", etc.
  quoted_price_paise: number
  notes: string | null
}): Promise<SendResult> {
  const priceRupees = (args.quoted_price_paise / 100).toLocaleString('en-IN')
  const subject = `Bugbite is ready to scan ${args.hostname} — quote inside`

  const lines = [
    'Hi,',
    '',
    `Thank you for verifying ownership of ${args.hostname}.`,
    '',
    "Bugbite is ready to run. Here's the quote:",
    '',
    `  Site: ${args.hostname}`,
    `  Type: ${args.url_class_label}`,
    `  Price: ₹${priceRupees}`,
    '',
  ]

  if (args.notes && args.notes.trim()) {
    lines.push('Notes from our review:', args.notes.trim(), '')
  }

  lines.push(
    'Reply to this email to confirm and we will send payment instructions.',
    '',
    'If you have questions about scope or timing, reply with what you need — we will work it out.',
    '',
    '— fixmysite.in',
  )

  return send({
    to: args.to,
    subject,
    text: lines.join('\n'),
    context: 'inquiry_approved',
  })
}

// ─── 5. Inquiry rejected — to claimant ───────────────────────────────

/**
 * Sent when admin rejects an inquiry. Always includes the reason from the
 * notes field (notes are required for rejection per the action handler).
 * Per rule #50 — even rejection ends with a path forward (reply-back option).
 */
export async function sendInquiryRejectedToClaimant(args: {
  to: string
  hostname: string
  notes: string
}): Promise<SendResult> {
  const subject = `Your fixmysite.in scan request for ${args.hostname}`
  const text = [
    'Hi,',
    '',
    `Thank you for reaching out about ${args.hostname}.`,
    '',
    "After review, Bugbite isn't able to take this scan on at this time.",
    '',
    args.notes.trim(),
    '',
    'If circumstances change or you have questions, reply to this email — we are happy to talk.',
    '',
    '— fixmysite.in',
  ].join('\n')

  return send({
    to: args.to,
    subject,
    text,
    context: 'inquiry_rejected',
  })
}

// ─── 6. Send report to developer (CLAUDE.md template 2) ────────────────

/**
 * Forward a paid scan's solution map to the owner's developer.
 *
 * The PDF attachment promised in CLAUDE.md template 2 isn't generated yet
 * (item 5 in the build queue). Until then we inline the solution map as
 * plain text — same priority + effort + action data the developer would
 * have read from the PDF, just rendered as numbered list. When the PDF
 * generator lands, switch to the attachment route and drop the inline
 * dump.
 */
export async function sendReportToDeveloper(args: {
  to: string
  scanUrl: string
  hostname: string
  issueCount: number
  solutionMap: ReadonlyArray<{
    item: string
    detail: string
    action: string
    priority: 'high' | 'medium' | 'low'
    effort: 'low' | 'medium' | 'high'
  }>
}): Promise<SendResult> {
  const subject = `Bugbite found ${args.issueCount} ${args.issueCount === 1 ? 'issue' : 'issues'} on ${args.hostname}`
  const lines: string[] = [
    'Hi,',
    '',
    `Your client ran ${args.scanUrl} through fixmysite.in. Bugbite (our scanner) found ${args.issueCount} ${args.issueCount === 1 ? 'thing' : 'things'} worth your attention.`,
    '',
    'Full solution map below — ordered by priority and effort, most impactful and easiest fixes first.',
    '',
  ]

  if (args.solutionMap.length === 0) {
    lines.push('No actionable issues — the site passed every check we ran.')
    lines.push('')
  } else {
    args.solutionMap.forEach((issue, i) => {
      // Stored issue.item is a stable identifier
      // (e.g. `form_no_destination:https://...`). Humanize before the
      // developer reads it — same helper the report UI uses, so the
      // email and the on-screen report are always in sync.
      const { title, subtitle } = formatIssueTitle(issue.item)
      lines.push(`${i + 1}. ${title}`)
      if (subtitle) lines.push(`   ${subtitle}`)
      lines.push(`   ${issue.action || issue.detail}`)
      lines.push(`   Priority: ${issue.priority} · Effort: ${issue.effort}`)
      lines.push('')
    })
  }

  lines.push('Questions? Reply to this email or write to hello@fixmysite.in.')
  lines.push('')
  lines.push('— fixmysite.in')

  return send({
    to: args.to,
    subject,
    text: lines.join('\n'),
    context: 'send_developer',
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
    timeZoneName: 'short',
  })
}
