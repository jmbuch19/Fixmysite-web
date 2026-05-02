import { createServiceClient } from '@/lib/supabase/server'
import {
  buildBlueprintPdfFilename,
  generateBlueprintPdf,
} from '@/lib/pdf/blueprintGenerator'
import { sendBlueprintReadyToOwner } from '@/lib/email/sender'
import { resolveAppUrl } from '@/lib/queue/qstash'
import type { BlueprintOutput } from '@/lib/claude/blueprint'

/**
 * Render the blueprint PDF + email it to the owner. All failure paths
 * log structured warnings + return — never throw. Caller awaits this
 * so the surrounding response only completes after the email attempt
 * finishes (otherwise a serverless function can be killed before the
 * Resend send fires).
 *
 * Two callers:
 *   1. /api/blueprint/payment/verify — happy path. Owner clicks pay,
 *      Razorpay handler fires, verify flips the row, this email lands
 *      in the inbox.
 *   2. /api/subscription/webhook — safety-net path. Owner clicks pay,
 *      Razorpay captures, but verify never reaches us (cold start,
 *      tab closed mid-flight, network hiccup). Razorpay later pushes
 *      payment.captured to the webhook; the webhook flips the row
 *      and fires this same email.
 *
 * Idempotency: caller is responsible for only invoking when this is
 * the writer that just transitioned the row unpaid → paid. The
 * verify-route's "already_paid" early-return and the webhook's
 * payment_status check both ensure this email fires at most once per
 * payment.
 */
export async function sendBlueprintReadyEmailBestEffort(args: {
  blueprintId: string
  callerTag: string
}): Promise<void> {
  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from('website_blueprints')
    .select(
      'id, business_name, owner_email, blueprint_json, completed_at, created_at',
    )
    .eq('id', args.blueprintId)
    .maybeSingle()

  if (!row) {
    console.error(`[${args.callerTag}] row vanished after update`, {
      blueprint_id: args.blueprintId,
    })
    return
  }
  if (!row.blueprint_json) {
    console.error(`[${args.callerTag}] paid row has null blueprint_json`, {
      blueprint_id: args.blueprintId,
    })
    return
  }
  if (!row.owner_email) {
    console.warn(
      `[${args.callerTag}] no owner_email on file — skipping auto-send`,
      { blueprint_id: args.blueprintId },
    )
    return
  }

  const blueprintJson = row.blueprint_json as BlueprintOutput

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await generateBlueprintPdf({
      blueprint: blueprintJson,
      meta: {
        blueprintId: row.id,
        businessName: row.business_name ?? null,
        ownerName: null,
        paidAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error(`[${args.callerTag}] PDF render failed`, {
      blueprint_id: row.id,
      error: err instanceof Error ? err.message : err,
    })
    return
  }

  const filename = buildBlueprintPdfFilename(
    row.business_name ?? null,
    row.id,
    row.created_at,
  )
  const appUrl = resolveAppUrl() ?? 'https://fixmysite.in'

  const sendResult = await sendBlueprintReadyToOwner({
    to: row.owner_email,
    businessName: row.business_name ?? null,
    blueprintId: row.id,
    appUrl,
    recommendationLabel: blueprintJson.recommendation_label,
    pdfBuffer,
    pdfFilename: filename,
  })

  if (!sendResult.ok) {
    console.error(`[${args.callerTag}] Resend send failed`, {
      blueprint_id: row.id,
      owner_email: row.owner_email,
      reason: sendResult.reason,
      error: sendResult.error,
    })
    return
  }

  // Mark completed_at + status='complete'. Best-effort — if this UPDATE
  // fails the email still went, we just lose the audit trail.
  const { error: updateError } = await supabase
    .from('website_blueprints')
    .update({
      completed_at: new Date().toISOString(),
      status: 'complete',
    })
    .eq('id', row.id)
  if (updateError) {
    console.error(
      `[${args.callerTag}] completed_at update failed (email sent OK)`,
      { blueprint_id: row.id, error: updateError.message },
    )
  }
}
