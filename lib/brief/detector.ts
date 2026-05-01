import Anthropic from '@anthropic-ai/sdk'

// ─── Tunables ─────────────────────────────────────────────────────────

// Lightweight call (single keyword response) — Haiku is correct.
// Even at scale this costs fractions of a paisa per detection.
const DETECT_MODEL = 'claude-haiku-4-5-20251001'
const DETECT_MAX_TOKENS = 30
// Cap input at 2000 chars per CLAUDE.md spec — detection signal is in
// the first viewport's worth of text (title, hero, intro paragraph).
const MAX_PAGE_TEXT_CHARS = 2_000

// ─── Type catalogue ───────────────────────────────────────────────────
//
// Closed set. The brief generator and downstream Claude prompts rely
// on this exact list to choose industry-specific terminology. Adding a
// new type means adding it here AND updating the brief.ts prompt's
// industry-terminology guidance.

export const BUSINESS_TYPES = [
  'clinic',
  'retail_clothing',
  'restaurant',
  'legal',
  'education',
  'ca_finance',
  'real_estate',
  'salon_beauty',
  'gym_fitness',
  'general',
] as const

export type BusinessType = (typeof BUSINESS_TYPES)[number]

// ─── Public entry point ───────────────────────────────────────────────

/**
 * Classify a website's business type from a snippet of its content.
 *
 * Single Haiku round-trip. The prompt is hard-pinned to a closed set
 * of 10 keys so the response is trivial to validate — no need for a
 * JSON schema, just a token-equality check after lowering and trimming.
 *
 * Returns 'general' on any failure path: missing API key, network
 * error, parse failure, unknown response. The brief generator
 * downgrades industry-terminology specificity when given 'general',
 * so a degraded result is still useful — just less industry-flavoured.
 *
 * Never throws.
 */
export async function detectBusinessType(args: {
  url: string
  pageText: string
}): Promise<BusinessType> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn(
      '[brief/detector] ANTHROPIC_API_KEY missing — defaulting to "general"',
    )
    return 'general'
  }

  const truncated = args.pageText.slice(0, MAX_PAGE_TEXT_CHARS)

  const prompt = `Read this website content and return ONLY one of these business type keys:
clinic | retail_clothing | restaurant | legal | education | ca_finance | real_estate | salon_beauty | gym_fitness | general

Website URL: ${args.url}
Page content (first 2000 chars): ${truncated}

Return only the key. Nothing else.`

  const client = new Anthropic({ apiKey })
  let res: Anthropic.Messages.Message
  try {
    res = await client.messages.create({
      model: DETECT_MODEL,
      max_tokens: DETECT_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    console.error(
      '[brief/detector] Claude call failed — defaulting to "general"',
      err instanceof Error ? err.message : err,
    )
    return 'general'
  }

  const block = res.content[0]
  if (!block || block.type !== 'text') return 'general'
  const raw = block.text.trim().toLowerCase()
  if (!raw) return 'general'

  // Exact match first (the prompt explicitly asks for the key alone).
  for (const t of BUSINESS_TYPES) {
    if (raw === t) return t
  }
  // Defensive substring fallback for the rare case Claude wraps the
  // key in punctuation or a sentence.
  for (const t of BUSINESS_TYPES) {
    if (raw.includes(t)) return t
  }

  console.warn(
    '[brief/detector] response did not match any known type — defaulting to "general"',
    { raw_response: raw.slice(0, 80) },
  )
  return 'general'
}
