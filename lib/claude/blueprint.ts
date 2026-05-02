import Anthropic from '@anthropic-ai/sdk'

// ─── Tunables ─────────────────────────────────────────────────────────

const BLUEPRINT_MODEL = 'claude-sonnet-4-6'
// Blueprints span ~12 distinct sections (understood, why_right,
// why_not_alternative, pages_needed, features_needed,
// features_not_needed, technology, next_steps, red_flags, plus
// strings and arrays inside each). 6000 tokens leaves headroom for
// detailed reasoning without truncation.
const BLUEPRINT_MAX_TOKENS = 6_000
const BLUEPRINT_TEMPERATURE = 0  // deterministic — same answers → same blueprint

// ─── Public types ─────────────────────────────────────────────────────

export type BlueprintRecommendation =
  | 'feature'
  | 'platform'
  | 'ecommerce'
  | 'custom'

export type BlueprintPage = {
  name: string
  purpose: string
}

export type BlueprintNextStep = {
  step: number
  action: string
  cost: string | null
}

export type BlueprintTechnology = {
  platform: string
  reason: string
  hosting: string
  avoid: string[]
  avoid_reasons: string[]
}

export type BlueprintOutput = {
  // Detected from the owner's free-text answer. Same lightweight pattern
  // as brief — Claude returns it inline rather than a separate
  // detector call. ISO 639-1 code or "mixed".
  detected_language: string

  understood: string
  recommendation: BlueprintRecommendation
  recommendation_label: string
  timeline_days: string
  budget_range: string
  why_right: string[]
  why_not_alternative: string[]
  pages_needed: BlueprintPage[]
  features_needed: string[]
  features_not_needed: string[]
  technology: BlueprintTechnology
  next_steps: BlueprintNextStep[]
  red_flags: string[] | null
}

export type BlueprintInput = {
  blueprintId: string
  // Identity (any may be null — wizard collects them but a malformed
  // draft still has a chance of being completed later).
  businessType: string | null
  businessName: string | null
  ownerName: string | null
  ownerEmail: string | null
  whatsappNumber: string | null
  // Cascading question answers — flat record. Includes branch-2
  // questions, scale, expectations, geography, language, practical
  // reality, plus our newer fields (business_location, operating_mode,
  // existing_presence, domain_status, domain_status_other, domain_ideas).
  answers: Record<string, string | string[]>
  freeText: string | null
}

// ─── System prompt — SPEC §20 hardened ────────────────────────────────

const SYSTEM_PROMPT = `You are a website technology advisor for Indian small businesses.
Your job is to recommend exactly what kind of website a business needs and explain clearly why — in plain language a non-technical owner understands.

Rules:
- Be specific. Generic advice has no value to a small business owner.
- Always explain why the recommended option is right AND why the alternative options are NOT right for this business right now.
- Technology suggestions must be realistic for an average Indian freelance developer working solo, with Indian hosting budgets.
- Use Indian context throughout: Razorpay (not Stripe), Hostinger India / BigRock / Hosting Raja (not GoDaddy US pricing), Indian developer marketplaces. Real prices in INR.
- Detect the language of the owner's free-text answer (English, Hindi, Gujarati, Hinglish, etc.) and report it as an ISO 639-1 code in detected_language; use "mixed" when more than one language is present. Detection is for our records only.
- Always write the blueprint itself in English — every string field, every array entry, every reason. The owner may have written to us in Gujarati or Hindi; we still respond in English. This is non-negotiable.
- Hard constraint: never recommend "custom" build for a business whose budget answer is under ₹50,000 — that is, when the budget is "under_5k", "5k_20k", or "20k_1l". For those budgets, recommend "feature" or "platform" instead. A custom build at low budget always disappoints.
- E-commerce sub-types: under ~100 products → "ecommerce" with WooCommerce; 500+ products with inventory complexity → "ecommerce" with custom or Shopify; otherwise pick the lighter option.
- Owner's existing online presence matters. If they have a Google Business Profile, Instagram, Facebook page, WhatsApp Business, or marketplace listing, the recommendation should consolidate what they have rather than recommend yet another channel. Surface this in why_right or pages_needed.
- Respect the operating_mode answer. A fixed-location business needs a "Find us / Directions" page; an on-call business needs a clear service-area page; an online-only business needs trust + about copy more than a physical address.
- next_steps cost field: use "Free", a price like "₹500/yr", or null when there is no monetary cost. Always include the rupee symbol when it is a price.
- Never invent features the owner did not ask for or imply.
- Never use the words: "robust", "seamless", "leverage", "utilize", "ensure".
- Output: valid JSON only. No markdown. No preamble. No trailing commentary.`

// ─── Public entry point ───────────────────────────────────────────────

/**
 * Generate the full blueprint from the wizard intake. Returns a
 * strictly-validated BlueprintOutput, or null on any failure. Never
 * throws — the orchestrator (API route) maps null → 500.
 *
 * Two-pass strategy mirrors the brief generator: try once, retry once
 * with a strict-JSON reminder appended. Both attempts use temperature
 * 0 so the retry isn't trying to "creative" its way out — the reminder
 * just nudges past markdown-fence wrapping if Claude slipped.
 */
export async function generateBlueprint(
  input: BlueprintInput,
): Promise<BlueprintOutput | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn(
      '[claude/blueprint] ANTHROPIC_API_KEY missing — skipping generation',
    )
    return null
  }

  const client = new Anthropic({ apiKey })
  const userPrompt = buildUserPrompt(input)

  const first = await callClaude(client, userPrompt)
  if (first) {
    const finalized = finalizeBlueprint(first)
    if (finalized) return finalized
  }

  const strict =
    userPrompt +
    '\n\n## Reminder\nReturn ONLY valid JSON. No markdown fences. No explanatory text. Start with `{` and end with `}`. Detected_language is required and must be a short ISO 639-1 code or "mixed".'
  const second = await callClaude(client, strict)
  if (second) {
    const finalized = finalizeBlueprint(second)
    if (finalized) return finalized
  }

  console.error(
    '[claude/blueprint] failed to obtain valid blueprint after retry',
  )
  return null
}

// ─── Prompt construction ──────────────────────────────────────────────

function buildUserPrompt(input: BlueprintInput): string {
  const identityBlock = [
    `- Business type: ${input.businessType ?? '(not given)'}`,
    `- Business name: ${input.businessName ?? '(not given)'}`,
    `- Owner: ${input.ownerName ?? '(not given)'}`,
    `- Email: ${input.ownerEmail ?? '(not given)'}`,
    `- WhatsApp: ${input.whatsappNumber ?? '(not given)'}`,
  ].join('\n')

  const freeTextBlock = input.freeText && input.freeText.trim().length > 0
    ? `"""${input.freeText}"""`
    : '(owner did not write anything in the free-text box)'

  return `Business intake:
${identityBlock}

Cascading question answers:
${JSON.stringify(input.answers, null, 2)}

Owner's own words (any language):
${freeTextBlock}

Return JSON in this exact shape:
{
  "detected_language": string (ISO 639-1 code, or "mixed"),
  "understood": string (2-3 sentences — what we understood about the business, written so the owner feels heard),
  "recommendation": "feature" | "platform" | "ecommerce" | "custom",
  "recommendation_label": string (e.g. "Feature Website", "Platform Website", "E-commerce Website", "Custom Build"),
  "timeline_days": string (e.g. "5–7 days", "3–6 weeks"),
  "budget_range": string (e.g. "₹8,000–₹15,000"),
  "why_right": string[] (3-5 specific reasons this recommendation fits THIS business — reference their actual answers, not generalities),
  "why_not_alternative": string[] (2-3 reasons the simpler OR more complex option is wrong for them right now),
  "pages_needed": [{ "name": string, "purpose": string }],
  "features_needed": string[],
  "features_not_needed": string[],
  "technology": {
    "platform": string (e.g. "WordPress with Astra theme", "Custom Next.js", "Shopify Basic"),
    "reason": string (one or two sentences on why this platform suits THIS business),
    "hosting": string (e.g. "Hostinger India ₹179/mo plan", "Cloudflare Pages free tier"),
    "avoid": string[] (technologies this owner should NOT pick),
    "avoid_reasons": string[] (parallel array — reason for each "avoid" entry; same length and order)
  },
  "next_steps": [{ "step": number (1-indexed), "action": string, "cost": string | null }],
  "red_flags": string[] | null (anything in the answers that should give the owner pause — e.g. mismatch between budget and timeline, unrealistic expectations; null when nothing notable)
}`
}

// ─── Claude call ──────────────────────────────────────────────────────

async function callClaude(
  client: Anthropic,
  userPrompt: string,
): Promise<unknown | null> {
  let res: Anthropic.Messages.Message
  try {
    res = await client.messages.create({
      model: BLUEPRINT_MODEL,
      max_tokens: BLUEPRINT_MAX_TOKENS,
      temperature: BLUEPRINT_TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })
  } catch (err) {
    console.error(
      '[claude/blueprint] API call failed',
      err instanceof Error ? err.message : err,
    )
    return null
  }

  const block = res.content[0]
  if (!block || block.type !== 'text') return null
  const raw = block.text.trim()
  if (!raw) return null

  const stripped = stripMarkdownFences(raw)
  try {
    return JSON.parse(stripped)
  } catch {
    console.warn(
      '[claude/blueprint] JSON.parse failed (truncated):',
      stripped.slice(0, 200),
    )
    return null
  }
}

function stripMarkdownFences(text: string): string {
  const m = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  if (m && m[1]) return m[1].trim()
  return text
}

// ─── Strict shape validation ──────────────────────────────────────────

function finalizeBlueprint(parsed: unknown): BlueprintOutput | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>

  const detected_language = strField(obj.detected_language)
  const understood = strField(obj.understood)
  const recommendation_label = strField(obj.recommendation_label)
  const timeline_days = strField(obj.timeline_days)
  const budget_range = strField(obj.budget_range)

  if (
    !detected_language ||
    !understood ||
    !recommendation_label ||
    !timeline_days ||
    !budget_range
  ) {
    return null
  }

  if (!isRecommendation(obj.recommendation)) return null
  const recommendation = obj.recommendation

  const why_right = strArray(obj.why_right)
  const why_not_alternative = strArray(obj.why_not_alternative)
  const features_needed = strArray(obj.features_needed)
  const features_not_needed = strArray(obj.features_not_needed)

  if (why_right.length === 0 || why_not_alternative.length === 0) return null

  const pages_needed = Array.isArray(obj.pages_needed)
    ? obj.pages_needed
        .map(validatePage)
        .filter((p): p is BlueprintPage => p !== null)
    : []
  if (pages_needed.length === 0) return null

  const technology = validateTechnology(obj.technology)
  if (!technology) return null

  const next_steps = Array.isArray(obj.next_steps)
    ? obj.next_steps
        .map(validateNextStep)
        .filter((n): n is BlueprintNextStep => n !== null)
    : []
  if (next_steps.length === 0) return null

  // red_flags is genuinely nullable. Empty array also coerces to null
  // so the UI has a single "render or skip" check.
  const red_flags_raw = Array.isArray(obj.red_flags)
    ? strArray(obj.red_flags)
    : null
  const red_flags =
    red_flags_raw && red_flags_raw.length > 0 ? red_flags_raw : null

  return {
    detected_language,
    understood,
    recommendation,
    recommendation_label,
    timeline_days,
    budget_range,
    why_right,
    why_not_alternative,
    pages_needed,
    features_needed,
    features_not_needed,
    technology,
    next_steps,
    red_flags,
  }
}

function validatePage(raw: unknown): BlueprintPage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const name = strField(r.name)
  const purpose = strField(r.purpose)
  if (!name || !purpose) return null
  return { name, purpose }
}

function validateNextStep(raw: unknown): BlueprintNextStep | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const step = typeof r.step === 'number' ? Math.floor(r.step) : null
  const action = strField(r.action)
  if (step === null || step < 1 || !action) return null
  const cost =
    typeof r.cost === 'string' && r.cost.trim().length > 0
      ? r.cost.trim()
      : null
  return { step, action, cost }
}

function validateTechnology(raw: unknown): BlueprintTechnology | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const platform = strField(r.platform)
  const reason = strField(r.reason)
  const hosting = strField(r.hosting)
  if (!platform || !reason || !hosting) return null
  const avoid = strArray(r.avoid)
  const avoid_reasons = strArray(r.avoid_reasons)
  // Parallel arrays — Claude is instructed to keep them aligned. If
  // they don't match length, trim to the shorter length so the UI
  // never indexes past the end.
  const len = Math.min(avoid.length, avoid_reasons.length)
  return {
    platform,
    reason,
    hosting,
    avoid: avoid.slice(0, len),
    avoid_reasons: avoid_reasons.slice(0, len),
  }
}

function strField(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0,
  )
}

function isRecommendation(v: unknown): v is BlueprintRecommendation {
  return (
    v === 'feature' || v === 'platform' || v === 'ecommerce' || v === 'custom'
  )
}
