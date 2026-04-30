import { isSafeUrl } from '@/lib/security/ssrf'
import type { Issue } from '@/lib/scan/phase2'

// ─── Tunables ──────────────────────────────────────────────────────────

// Three calendar years (close enough — a leap year shifts this by one
// day, which is irrelevant for "is this image stale").
const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

const HEAD_TIMEOUT_MS = 8_000
const MAX_IMAGES_PER_SCAN = 50
const IMAGE_CONCURRENCY = 4

const USER_AGENT =
  'Mozilla/5.0 (compatible; fixmysite.in/1.0; +https://fixmysite.in)'

// ─── Types ─────────────────────────────────────────────────────────────

export type ImageAge = {
  src: string
  lastModified: string  // ISO 8601
  ageYears: number      // floored
  isOld: boolean        // true when age > THREE_YEARS_MS
}

export type ImageCheckResult =
  | { ok: true; age: ImageAge }
  | {
      ok: false
      src: string
      reason:
        | 'blocked'
        | 'no_last_modified'   // header missing — most CDNs strip it
        | 'invalid_date'       // header present but unparseable
        | 'http_error'
        | 'timeout'
        | 'network'
    }

// ─── Single-image check ────────────────────────────────────────────────

/**
 * HEAD-only age check for one image. Reads the `Last-Modified` response
 * header and computes age vs. now. Never downloads the image body.
 *
 * Returns a discriminated result rather than null/boolean so the
 * orchestrator can distinguish "we couldn't check" (no header, network)
 * from "we checked and it's recent" — useful for telemetry.
 *
 * Many CDNs (Cloudflare, ImageKit) strip Last-Modified. Those return
 * `no_last_modified` and are silently dropped from the report — not
 * actionable for the owner.
 */
export async function checkImageAge(imgSrc: string): Promise<ImageCheckResult> {
  if (!(await isSafeUrl(imgSrc))) {
    return { ok: false, src: imgSrc, reason: 'blocked' }
  }
  let res: Response
  try {
    res = await fetch(imgSrc, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    })
  } catch (err) {
    const e = err as { name?: string }
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { ok: false, src: imgSrc, reason: 'timeout' }
    }
    return { ok: false, src: imgSrc, reason: 'network' }
  }
  if (!res.ok) {
    return { ok: false, src: imgSrc, reason: 'http_error' }
  }
  // Re-validate post-redirect target — defends DNS rebinding via 30x.
  if (res.url !== imgSrc && !(await isSafeUrl(res.url))) {
    return { ok: false, src: imgSrc, reason: 'blocked' }
  }

  const lastModified = res.headers.get('last-modified')
  if (!lastModified) {
    return { ok: false, src: imgSrc, reason: 'no_last_modified' }
  }
  const ms = Date.parse(lastModified)
  if (Number.isNaN(ms)) {
    return { ok: false, src: imgSrc, reason: 'invalid_date' }
  }

  const ageMs = Date.now() - ms
  return {
    ok: true,
    age: {
      src: imgSrc,
      lastModified: new Date(ms).toISOString(),
      ageYears: Math.floor(ageMs / ONE_YEAR_MS),
      isOld: ageMs > THREE_YEARS_MS,
    },
  }
}

// ─── Bulk check ────────────────────────────────────────────────────────

export type ImagesChecksOutput = {
  images_found: number
  images_checked: number
  images_skipped_cap: number
  images_with_no_header: number
  old_images: ImageAge[]
  results: ImageCheckResult[]
}

/**
 * Run age checks across the homepage's image list. The caller passes
 * an already-deduped list (extractor dedupes by absolute href). We
 * cap at MAX_IMAGES_PER_SCAN — a 50-photo gallery doesn't need every
 * image checked to detect "this site's photos are stale".
 *
 * Concurrency 4 matches the link checker; HEAD requests are cheap but
 * we don't want to hammer one CDN.
 */
export async function checkImages(imageUrls: string[]): Promise<ImagesChecksOutput> {
  const found = imageUrls.length
  const queue = imageUrls.slice(0, MAX_IMAGES_PER_SCAN)
  const skippedCap = Math.max(0, found - queue.length)

  const results: ImageCheckResult[] = new Array(queue.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const idx = cursor++
      if (idx >= queue.length) return
      results[idx] = await checkImageAge(queue[idx]!)
    }
  }

  const workers = Math.min(IMAGE_CONCURRENCY, queue.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))

  const oldImages: ImageAge[] = []
  let noHeaderCount = 0
  for (const r of results) {
    if (r.ok) {
      if (r.age.isOld) oldImages.push(r.age)
    } else if (r.reason === 'no_last_modified') {
      noHeaderCount += 1
    }
  }

  return {
    images_found: found,
    images_checked: queue.length,
    images_skipped_cap: skippedCap,
    images_with_no_header: noHeaderCount,
    old_images: oldImages,
    results,
  }
}

// ─── Issue translation ─────────────────────────────────────────────────

/**
 * Aggregate old-image findings into a single warning per scan. Listing
 * each old image individually would add noise — the report just needs
 * to tell the owner "your photos look stale, replace them".
 *
 * The oldest age is included in the detail copy so the message lands
 * harder ("over 7 years old" reads sharper than "over 3 years old").
 */
export function buildImageIssues(output: ImagesChecksOutput): Issue[] {
  if (output.old_images.length === 0) return []

  const oldest = output.old_images.reduce(
    (max, a) => (a.ageYears > max ? a.ageYears : max),
    0,
  )
  const count = output.old_images.length
  const ageWord = oldest >= 4 ? `over ${oldest} years old` : 'over 3 years old'

  return [
    {
      category: 'visual',
      item: 'old_images_homepage',
      status: 'warning',
      priority: 'medium',
      effort: 'low',
      detail: `${count} ${count === 1 ? 'photo' : 'photos'} on your homepage ${count === 1 ? 'is' : 'are'} ${ageWord}. Customers expect to see current work and recent results.`,
      action:
        'Replace outdated photos with recent images of your work, products, or premises.',
    },
  ]
}
