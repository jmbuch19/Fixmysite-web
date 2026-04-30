import bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'

const OTP_LENGTH = 6
const OTP_TTL_MS = 15 * 60 * 1000 // 15 minutes per SPEC §4
const MAX_ATTEMPTS = 3

export const OTP_CONSTANTS = {
  LENGTH: OTP_LENGTH,
  TTL_MS: OTP_TTL_MS,
  TTL_MINUTES: 15,
  MAX_ATTEMPTS,
} as const

/**
 * Generate a 6-digit OTP using Node's CSPRNG. Math.random would be
 * acceptable for the entropy here (OTPs are short-lived and rate-limited),
 * but `randomInt` is just as fast and removes any debate about RNG quality
 * in security-adjacent code.
 */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0')
}

/** bcrypt hash — cost 10 is the standard for short tokens. */
export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10)
}

/** Constant-time comparison via bcrypt. */
export async function verifyOtpHash(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** True if the OTP was sent more than 15 minutes ago. */
export function isOtpExpired(sentAt: Date | string): boolean {
  const sent = typeof sentAt === 'string' ? new Date(sentAt) : sentAt
  return Date.now() - sent.getTime() > OTP_TTL_MS
}

/** True if the user has used up their attempt budget. */
export function isLockedOut(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS
}
