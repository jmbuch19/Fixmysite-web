import { lookup } from 'node:dns/promises'

const PRIVATE_IPV4: RegExp[] = [
  /^0\./,                                       // 0.0.0.0/8 — "this network"
  /^10\./,                                      // RFC 1918 private
  /^127\./,                                     // loopback
  /^169\.254\./,                                // link-local (incl. cloud metadata 169.254.169.254)
  /^172\.(1[6-9]|2\d|3[01])\./,                 // RFC 1918 private
  /^192\.168\./,                                // RFC 1918 private
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,   // CGNAT 100.64.0.0/10
  /^(22[4-9]|23\d)\./,                          // multicast 224.0.0.0/4
  /^(24\d|25[0-5])\./,                          // reserved 240.0.0.0/4
]

const PRIVATE_IPV6: RegExp[] = [
  /^::1$/i,                                     // loopback
  /^::$/,                                       // unspecified
  /^::ffff:/i,                                  // IPv4-mapped (would otherwise hide a private IPv4)
  /^f[cd]/i,                                    // ULA fc00::/7
  /^fe[89ab]/i,                                 // link-local fe80::/10
  /^ff/i,                                       // multicast ff00::/8
]

const BLOCKED_HOSTNAMES: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.localhost$/i,
  /\.internal$/i,
]

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) return PRIVATE_IPV6.some(r => r.test(ip))
  return PRIVATE_IPV4.some(r => r.test(ip))
}

function isIpLiteral(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true
  if (hostname.includes(':')) return true
  return false
}

/**
 * SSRF guard. Call before any outbound fetch of a user-supplied URL.
 *
 * Blocks:
 *  - Non-http(s) protocols (file:, gopher:, ftp:, etc.)
 *  - Hostnames that look local (localhost, *.local, *.internal)
 *  - IP literals in private/loopback/link-local/CGNAT/multicast/reserved ranges
 *  - Hostnames that DNS-resolve to ANY of the above (defends against DNS rebinding
 *    where a single hostname returns multiple A records, some public + some private)
 *
 * TOCTOU caveat: a hostname could resolve to a public IP at check time and a
 * private IP at fetch time (DNS TTL = 1s attack). Full mitigation requires
 * pinning the resolved IP into the actual fetch (custom undici dispatcher with
 * a lookup hook). For MVP, the resolve-then-fetch window is small enough to
 * accept; revisit if we ever see scan abuse in PostHog logs.
 *
 * Returns true if safe to fetch, false otherwise. Never throws.
 */
export async function isSafeUrl(url: string): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return false

  const hostname = parsed.hostname
  if (!hostname) return false
  if (BLOCKED_HOSTNAMES.some(r => r.test(hostname))) return false

  if (isIpLiteral(hostname)) return !isPrivateIp(hostname)

  try {
    const addresses = await lookup(hostname, { all: true })
    if (addresses.length === 0) return false
    return addresses.every(({ address }) => !isPrivateIp(address))
  } catch {
    return false
  }
}
