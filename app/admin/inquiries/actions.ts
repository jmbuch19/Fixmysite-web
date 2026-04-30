'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAuthClient, isAdminEmail } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import {
  sendInquiryApprovedToClaimant,
  sendInquiryRejectedToClaimant,
} from '@/lib/email/sender'

/**
 * Approve an enterprise/institution/complex-tier inquiry — sets price,
 * marks status='approved', records who approved, then emails the
 * claimant the quote (best-effort; DB success is what matters).
 */
const approveSchema = z.object({
  inquiry_id: z.uuid(),
  quoted_price_rupees: z.coerce.number().int().min(99).max(1_000_000),
  institution_type: z
    .enum(['ngo', 'college', 'university', 'government', 'research'])
    .optional(),
  notes: z.string().max(2000).optional(),
})

export async function approveInquiry(formData: FormData): Promise<void> {
  const admin = await requireAdmin()

  const rawInst = String(formData.get('institution_type') ?? '').trim()
  const rawNotes = String(formData.get('notes') ?? '').trim()

  const parsed = approveSchema.safeParse({
    inquiry_id: formData.get('inquiry_id'),
    quoted_price_rupees: formData.get('quoted_price_rupees'),
    institution_type: rawInst === '' ? undefined : rawInst,
    notes: rawNotes === '' ? undefined : rawNotes,
  })

  if (!parsed.success) {
    const id = String(formData.get('inquiry_id') ?? '')
    redirect(`/admin/inquiries/${id}?error=invalid_input`)
  }

  const supabase = createServiceClient()
  // .update().select() returns the updated row in one round-trip — saves
  // a separate fetch and means we have everything needed for the email
  // even if status concurrently changed. .maybeSingle() handles the
  // 0-rows-matched (stale state) case cleanly.
  const { data: updated, error } = await supabase
    .from('enterprise_inquiries')
    .update({
      status: 'approved',
      manually_approved: true,
      manually_approved_by: admin.email ?? null,
      quoted_price: parsed.data.quoted_price_rupees * 100,
      institution_type: parsed.data.institution_type ?? null,
      notes: parsed.data.notes ?? null,
    })
    .eq('id', parsed.data.inquiry_id)
    .eq('status', 'otp_verified')
    .select('id, claimed_email, url_domain, url_class, quoted_price, notes')
    .maybeSingle()

  if (error) {
    console.error('[admin/inquiries] approve failed', {
      id: parsed.data.inquiry_id,
      error: error.message,
    })
    redirect(`/admin/inquiries/${parsed.data.inquiry_id}?error=db_failed`)
  }

  if (!updated) {
    redirect(`/admin/inquiries/${parsed.data.inquiry_id}?error=stale_state`)
  }

  // Best-effort email — DB succeeded already. Failure surfaces in banner
  // via &email_failed=1 so admin can follow up manually.
  const sendResult = await sendInquiryApprovedToClaimant({
    to: updated.claimed_email as string,
    hostname: updated.url_domain as string,
    url_class_label: formatUrlClassLabel(
      updated.url_class as string,
      parsed.data.institution_type,
    ),
    quoted_price_paise: updated.quoted_price as number,
    notes: (updated.notes as string | null) ?? null,
  })

  revalidatePath('/admin')
  revalidatePath('/admin/inquiries')
  const emailFailed = !sendResult.ok
  redirect(
    `/admin/inquiries/${parsed.data.inquiry_id}?approved=1${emailFailed ? '&email_failed=1' : ''}`,
  )
}

/**
 * Reject an inquiry. Notes (rejection reason) are required so we have a
 * paper trail. After DB update, emails the claimant the rejection +
 * reason (best-effort).
 */
const rejectSchema = z.object({
  inquiry_id: z.uuid(),
  notes: z.string().min(1).max(2000),
})

export async function rejectInquiry(formData: FormData): Promise<void> {
  const admin = await requireAdmin()

  const parsed = rejectSchema.safeParse({
    inquiry_id: formData.get('inquiry_id'),
    notes: String(formData.get('notes') ?? '').trim(),
  })

  if (!parsed.success) {
    const id = String(formData.get('inquiry_id') ?? '')
    redirect(`/admin/inquiries/${id}?error=invalid_input`)
  }

  const supabase = createServiceClient()
  const { data: updated, error } = await supabase
    .from('enterprise_inquiries')
    .update({
      status: 'rejected',
      manually_approved: false,
      manually_approved_by: admin.email ?? null,
      notes: parsed.data.notes,
    })
    .eq('id', parsed.data.inquiry_id)
    .eq('status', 'otp_verified')
    .select('id, claimed_email, url_domain, notes')
    .maybeSingle()

  if (error) {
    console.error('[admin/inquiries] reject failed', {
      id: parsed.data.inquiry_id,
      error: error.message,
    })
    redirect(`/admin/inquiries/${parsed.data.inquiry_id}?error=db_failed`)
  }

  if (!updated) {
    redirect(`/admin/inquiries/${parsed.data.inquiry_id}?error=stale_state`)
  }

  const sendResult = await sendInquiryRejectedToClaimant({
    to: updated.claimed_email as string,
    hostname: updated.url_domain as string,
    notes: (updated.notes as string | null) ?? parsed.data.notes,
  })

  revalidatePath('/admin')
  revalidatePath('/admin/inquiries')
  const emailFailed = !sendResult.ok
  redirect(
    `/admin/inquiries/${parsed.data.inquiry_id}?rejected=1${emailFailed ? '&email_failed=1' : ''}`,
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function requireAdmin() {
  const auth = await createAuthClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    redirect('/admin/login?error=unauthorized')
  }
  return user
}

/**
 * Format url_class for the claimant-facing approval email. For
 * institution-class inquiries, prefer the specific institution_type the
 * admin chose (NGO / Non-profit, College, etc.) — it's more accurate
 * than the generic "Institution" label.
 */
function formatUrlClassLabel(
  urlClass: string,
  institutionType?: string,
): string {
  if (urlClass === 'institution' && institutionType) {
    switch (institutionType) {
      case 'ngo':
        return 'NGO / Non-profit'
      case 'college':
        return 'College'
      case 'university':
        return 'University'
      case 'government':
        return 'Government body'
      case 'research':
        return 'Research institute'
    }
  }
  switch (urlClass) {
    case 'global_enterprise':
      return 'Global enterprise'
    case 'indian_enterprise':
      return 'Indian enterprise'
    case 'institution':
      return 'Institution'
    case 'self_serve':
      return 'Self-serve'
    default:
      return urlClass
  }
}
