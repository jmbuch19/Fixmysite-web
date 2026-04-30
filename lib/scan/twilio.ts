import twilio from 'twilio'

let _client: ReturnType<typeof twilio> | null = null

function getClient(): ReturnType<typeof twilio> | null {
  if (_client) return _client
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  _client = twilio(sid, token)
  return _client
}

/**
 * True when both Twilio creds are present in env. Lets the orchestrator
 * skip Twilio checks entirely (rather than emit "not configured" findings)
 * in dev or staging environments without credentials.
 */
export function hasTwilioCredentials(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
}

export type PhoneLookupResult =
  | {
      ok: true
      phone: string
      valid: boolean
      line_type: string | null
      whatsapp_capable: false // not yet implemented; CLAUDE.md says checked separately
    }
  | {
      ok: false
      phone: string
      reason: 'not_configured' | 'lookup_failed' | 'invalid_format'
      error?: string
    }

/**
 * Look up a single phone number via Twilio Lookup v2 API with the
 * `line_type_intelligence` field (mobile / landline / voip / tollfree).
 *
 * Never throws — returns a discriminated result so the caller can
 * distinguish configuration issues from actual lookup failures.
 *
 * Per CLAUDE.md rule 5: callers must deduplicate before invoking. The
 * wrapper does not dedupe internally — `lookupPhones` (below) does.
 *
 * Phone must be in E.164 form (`+91XXXXXXXXXX`). Phase 1's extractor
 * already canonicalises Indian numbers to that shape.
 */
export async function lookupPhone(phone: string): Promise<PhoneLookupResult> {
  if (!phone || !phone.startsWith('+')) {
    return { ok: false, phone, reason: 'invalid_format' }
  }

  const client = getClient()
  if (!client) {
    return { ok: false, phone, reason: 'not_configured' }
  }

  try {
    const result = await client.lookups.v2
      .phoneNumbers(phone)
      .fetch({ fields: 'line_type_intelligence' })
    return {
      ok: true,
      phone,
      valid: result.valid ?? false,
      line_type: result.lineTypeIntelligence?.type ?? null,
      whatsapp_capable: false,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[twilio] lookup failed', { phone, error: msg })
    return { ok: false, phone, reason: 'lookup_failed', error: msg }
  }
}

/**
 * Deduplicate + look up multiple phones in parallel. Per CLAUDE.md rule 5
 * — one Twilio call per unique number per scan, never more.
 */
export async function lookupPhones(
  phones: string[],
): Promise<PhoneLookupResult[]> {
  const unique = Array.from(new Set(phones.filter(Boolean)))
  if (unique.length === 0) return []
  return Promise.all(unique.map((p) => lookupPhone(p)))
}
