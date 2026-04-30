import tls from 'node:tls'
import { isSafeUrl } from '@/lib/security/ssrf'
import type { Issue } from '@/lib/scan/phase2'

// ─── Tunables ──────────────────────────────────────────────────────────

const TLS_TIMEOUT_MS = 10_000
const TLS_PORT = 443
const MS_PER_DAY = 1000 * 60 * 60 * 24

// ─── Types ─────────────────────────────────────────────────────────────

export type SslCertInfo = {
  issuer: string             // CN of the issuer (e.g. "Let's Encrypt R3")
  subject: string            // CN of the cert (e.g. "fixmysite.in")
  validFrom: string          // ISO 8601
  validTo: string            // ISO 8601
  daysUntilExpiry: number    // floored; negative if already expired
  isExpired: boolean
  isSelfSigned: boolean      // always false on the ok-path; self-signed
                             // certs return ok:false reason:'self_signed'
}

export type SslCheckResult =
  | { ok: true; cert: SslCertInfo }
  | {
      ok: false
      reason: 'timeout' | 'connection_failed' | 'self_signed' | 'not_configured'
    }

// ─── Single-host check ─────────────────────────────────────────────────

/**
 * TLS-only certificate inspection. Opens a TLS connection to
 * `<hostname>:443`, captures the peer certificate, then closes. We never
 * issue an HTTP request — this is a cert check, not a page check.
 *
 * `rejectUnauthorized: false` so we still receive the certificate even
 * when chain validation would otherwise fail (e.g. self-signed). We then
 * inspect `socket.authorizationError` plus issuer/subject equality to
 * detect self-signed certs ourselves.
 *
 * SSRF gate: although we don't fetch a page, a TLS handshake to a
 * private IP could still be used to fingerprint internal services.
 * `isSafeUrl(\`https://${hostname}/\`)` reuses the existing guard
 * (private IP ranges, DNS rebinding, link-local).
 *
 * Expired certificates are NOT failures from this function's
 * perspective — we still want the dates so `buildSslIssues` can emit
 * "expired N days ago" with a real number. Failure reasons are reserved
 * for cases where we cannot get a usable cert at all.
 */
export async function checkSsl(hostname: string): Promise<SslCheckResult> {
  if (!hostname) {
    return { ok: false, reason: 'not_configured' }
  }
  if (!(await isSafeUrl(`https://${hostname}/`))) {
    return { ok: false, reason: 'not_configured' }
  }

  return new Promise<SslCheckResult>((resolve) => {
    let settled = false
    const settle = (r: SslCheckResult) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        // socket already destroyed — fine
      }
      resolve(r)
    }

    const socket = tls.connect({
      host: hostname,
      port: TLS_PORT,
      servername: hostname,        // SNI — required for multi-tenant hosts
      rejectUnauthorized: false,   // collect cert even if untrusted
      timeout: TLS_TIMEOUT_MS,
    })

    socket.setTimeout(TLS_TIMEOUT_MS, () => {
      settle({ ok: false, reason: 'timeout' })
    })

    socket.once('error', () => {
      settle({ ok: false, reason: 'connection_failed' })
    })

    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(true)
      if (!cert || Object.keys(cert).length === 0) {
        settle({ ok: false, reason: 'connection_failed' })
        return
      }

      // Self-signed detection. Two paths:
      //   1. Node's chain validator already flagged it.
      //   2. Issuer.CN === Subject.CN with no parent in the chain.
      //      (`issuerCertificate === cert` is how Node represents
      //      "the chain points back at itself".)
      const authErr = String(socket.authorizationError ?? '')
      const flaggedSelfSigned = authErr.includes('SELF_SIGNED')

      // Node types CN as `string | string[]` — multi-CN certs (rare,
      // mostly legacy CA root certs) come back as arrays. Take the
      // first entry; we only use CN for self-signed comparison and
      // a human-readable label.
      const issuerCN = firstCN(cert.issuer?.CN)
      const subjectCN = firstCN(cert.subject?.CN)
      const chainTerminates =
        !cert.issuerCertificate || cert.issuerCertificate === cert
      const looksSelfSigned =
        chainTerminates && issuerCN !== '' && issuerCN === subjectCN

      if (flaggedSelfSigned || looksSelfSigned) {
        settle({ ok: false, reason: 'self_signed' })
        return
      }

      const validFromMs = Date.parse(cert.valid_from ?? '')
      const validToMs = Date.parse(cert.valid_to ?? '')
      if (Number.isNaN(validFromMs) || Number.isNaN(validToMs)) {
        // Cert came back but dates are unparseable — nothing actionable
        // to put in the report. Treat as a connection-class failure.
        settle({ ok: false, reason: 'connection_failed' })
        return
      }

      const now = Date.now()
      const daysUntilExpiry = Math.floor((validToMs - now) / MS_PER_DAY)

      settle({
        ok: true,
        cert: {
          issuer: issuerCN || firstCN(cert.issuer?.O) || 'unknown',
          subject: subjectCN || firstCN(cert.subject?.O) || 'unknown',
          validFrom: new Date(validFromMs).toISOString(),
          validTo: new Date(validToMs).toISOString(),
          daysUntilExpiry,
          isExpired: validToMs < now,
          isSelfSigned: false,
        },
      })
    })
  })
}

function firstCN(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

// ─── Issue translation ─────────────────────────────────────────────────

/**
 * Translate an SslCheckResult into user-facing issues. Returns an empty
 * array when the cert is healthy (>90 days remaining) or when the check
 * was silently skipped (`not_configured`).
 *
 * The "no SSL at all" case (http:// site) is handled by the orchestrator
 * via `buildNoSslIssue()` — `checkSsl` is never called for those.
 */
export function buildSslIssues(result: SslCheckResult): Issue[] {
  if (!result.ok) {
    switch (result.reason) {
      case 'not_configured':
        return []

      case 'timeout':
      case 'connection_failed':
        return [
          {
            category: 'technical',
            item: 'ssl_check_failed',
            status: 'warning',
            priority: 'medium',
            effort: 'low',
            detail: 'Could not verify SSL certificate.',
            action:
              'Confirm your site loads over https in a browser. If it does not, ask your host to set up an SSL certificate.',
          },
        ]

      case 'self_signed':
        return [
          {
            category: 'trust',
            item: 'ssl_self_signed',
            status: 'warning',
            priority: 'medium',
            effort: 'low',
            detail:
              'Self-signed certificate — browsers warn visitors this site may not be secure.',
            action:
              "Replace the self-signed certificate with a free Let's Encrypt certificate via your hosting provider.",
          },
        ]
    }
  }

  const { cert } = result
  const days = cert.daysUntilExpiry

  if (cert.isExpired) {
    const daysAgo = Math.abs(days)
    return [
      {
        category: 'trust',
        item: 'ssl_expired',
        status: 'fail',
        priority: 'high',
        effort: 'low',
        detail: `SSL certificate expired ${daysAgo} ${daysAgo === 1 ? 'day' : 'days'} ago. Visitors see a security warning.`,
        action:
          'Renew your SSL certificate immediately — most hosting providers do this in one click.',
      },
    ]
  }

  if (days < 14) {
    return [
      {
        category: 'trust',
        item: 'ssl_expiring',
        status: 'fail',
        priority: 'high',
        effort: 'low',
        detail: `SSL certificate expires in ${days} ${days === 1 ? 'day' : 'days'}. Renew immediately to avoid browser warnings.`,
        action: 'Renew your SSL certificate today via your hosting provider.',
      },
    ]
  }

  if (days <= 30) {
    return [
      {
        category: 'trust',
        item: 'ssl_expiring',
        status: 'warning',
        priority: 'medium',
        effort: 'low',
        detail: `SSL certificate expires in ${days} days. Renew within the next two weeks.`,
        action: 'Schedule renewal with your hosting provider this week.',
      },
    ]
  }

  if (days <= 90) {
    return [
      {
        category: 'trust',
        item: 'ssl_expiring',
        status: 'warning',
        priority: 'low',
        effort: 'low',
        detail: `SSL certificate expires in ${days} days. Schedule renewal soon.`,
        action: 'Add a reminder to renew before the expiry date.',
      },
    ]
  }

  // > 90 days remaining — healthy, no issue
  return []
}

/**
 * Issue for the http:// case (no SSL at all). The orchestrator emits
 * this directly when `phase1_result.ssl.basicValid === false`, without
 * calling `checkSsl` — Phase 1 already determined the site is not
 * served over HTTPS, so a TLS handshake would just confirm the obvious.
 */
export function buildNoSslIssue(): Issue {
  return {
    category: 'trust',
    item: 'ssl_missing',
    status: 'fail',
    priority: 'high',
    effort: 'low',
    detail:
      'No SSL certificate. Browsers mark this site as Not Secure. Customers will not trust it.',
    action:
      "Ask your hosting provider to enable a free SSL certificate — Let's Encrypt is included with most hosts.",
  }
}
