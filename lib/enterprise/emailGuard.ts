import { resolveMx } from 'node:dns/promises'

const DEFAULT_TIMEOUT_MS = 3000

/**
 * MX record check before sending an OTP (build rule #46).
 *
 * Sending to a domain with no MX record wastes a Resend quota slot, leaks
 * an OTP into the void, and (if combined with a DB insert) creates an
 * inquiry the user can never complete. Run this BEFORE any DB write or
 * OTP generation in `/api/enterprise/verify-email`.
 *
 * Failure modes treated as "no MX":
 *   - NXDOMAIN (domain doesn't exist)
 *   - ENODATA (domain exists but has no MX records)
 *   - DNS timeout (3s default — DNS should be fast; if it isn't, be safe)
 *   - any other DNS error
 *
 * Returns `true` only on a successful resolution that yielded ≥ 1 record.
 */
export async function hasMxRecord(
  emailDomain: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const records = await Promise.race([
      resolveMx(emailDomain),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('mx_lookup_timeout')),
          timeoutMs,
        ),
      ),
    ])
    return Array.isArray(records) && records.length > 0
  } catch {
    return false
  }
}
