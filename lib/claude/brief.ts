import Anthropic from '@anthropic-ai/sdk'
import type { BusinessType } from '@/lib/brief/detector'

// ─── Tunables ─────────────────────────────────────────────────────────

const BRIEF_MODEL = 'claude-sonnet-4-6'
// Briefs span multiple sections with full technical specs per section.
// 4000 tokens is a comfortable ceiling — avoids truncation on briefs
// with 6+ sections without burning unnecessary headroom.
const BRIEF_MAX_TOKENS = 4_000
const BRIEF_TEMPERATURE = 0  // deterministic — same inputs → same brief

// ─── Public types ─────────────────────────────────────────────────────

export type BriefSection = {
  title: string
  priority: 'high' | 'medium' | 'low'
  effort_days: string  // free text — Claude returns "1–2 days", "3–5 days"
  owner_words: string  // verbatim from owner input — preserved by prompt rule
  technical_brief: string
  screenshot_ref: string | null
}

export type BriefOutput = {
  business_type: string
  detected_language: string  // ISO 639-1 ("en", "hi", "gu", or "mixed")
  owner_original_words: string
  intent_summary: string
  sections: BriefSection[]
  additional_recommendations: string[]
  not_in_scope: string[]
}

export type BriefScanSummary = {
  url: string
  page_count: number | null
  tier: string | null
  ssl?: { basicValid: boolean; detail: string } | null
  phones_found?: number
  emails_found?: number
}

export type BriefInput = {
  url: string
  businessType: BusinessType
  scanSummary: BriefScanSummary
  ownerText: string
  // Already mapped from card keys to human-readable labels (emoji
  // stripped) by the API route — see cardKeysToLabels in
  // constants/pricing.ts. The brief generator never sees raw keys.
  selectedCards: string[]
  screenshotCount?: number  // 0 in v1.0.x — R2 upload ships in v1.1
}

// ─── System prompt — hardened version of CLAUDE.md spec ───────────────

const SYSTEM_PROMPT = `You are translating a business owner's plain-language website improvement requests into a professional technical brief for their web developer.

Your audience is TWO people simultaneously:
1. The business owner — must feel heard and understood
2. The web developer — must receive precise, actionable technical specifications

Rules:
- Preserve the owner's original words verbatim in "owner_words" field — never paraphrase, never translate, never edit punctuation
- Detect language automatically (Hindi, Gujarati, English, Hinglish, etc.) and report it as an ISO 639-1 code; use "mixed" when more than one language is present
- Translate intent, not literally — "thoda sundar banana hai" means clean modern redesign, not literal decoration
- Use industry-specific terminology matching the business type (e.g., for "clinic" use "appointment booking" not "calendar widget"; for "restaurant" use "menu management" not "product catalogue")
- Never invent features the owner did not ask for or imply — if it's not in their words or selected cards, it does not belong in sections; surface it in additional_recommendations only if highly relevant to the business type
- Each section follows the pattern: owner's request → what it means in plain English → exact technical spec the developer can quote against
- Effort estimates must be realistic for an average Indian freelance developer working solo (so "design overhaul" is 5–10 days, not 1 day)
- "not_in_scope" exists to prevent scope creep — list things the developer might assume but the owner did NOT ask for, so the dev knows the boundary
- Never use the words: "utilize", "leverage", "ensure", "robust", "seamless"
- If you cannot determine an appropriate section for an owner request, omit it entirely. Never fabricate sections.
- Output: valid JSON only. No markdown. No preamble. No trailing commentary.`

// ─── Public entry point ───────────────────────────────────────────────

/**
 * Generate the developer brief from owner intake. Returns a strictly-
 * validated BriefOutput, or null on any failure.
 *
 * Two-pass strategy: try once, retry once with a strict-JSON reminder
 * appended. Both attempts use temperature 0 so the retry isn't trying
 * to "creative" its way out of the failure — the reminder just nudges
 * past markdown-fence wrapping if Claude slipped.
 *
 * Never throws. The orchestrator (API route) maps null → 500.
 */
export async function generateBrief(
  input: BriefInput,
): Promise<BriefOutput | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn(
      '[claude/brief] ANTHROPIC_API_KEY missing — skipping brief',
    )
    return null
  }

  const client = new Anthropic({ apiKey })
  const userPrompt = buildUserPrompt(input)

  // First attempt
  const first = await callClaude(client, userPrompt)
  if (first) {
    const finalized = finalizeBrief(first)
    if (finalized) return finalized
  }

  // Retry — strict reminder appended. Same temp, same prompt body.
  const strict =
    userPrompt +
    '\n\n## Reminder\nReturn ONLY valid JSON. No markdown fences. No explanatory text. Start with `{` and end with `}`. Preserve the owner\'s original text verbatim in every owner_words field.'
  const second = await callClaude(client, strict)
  if (second) {
    const finalized = finalizeBrief(second)
    if (finalized) return finalized
  }

  console.error('[claude/brief] failed to obtain valid brief after retry')
  return null
}

// ─── Prompt construction ──────────────────────────────────────────────

function buildUserPrompt(input: BriefInput): string {
  const screenshotCount = input.screenshotCount ?? 0
  const cardsBlock =
    input.selectedCards.length > 0
      ? input.selectedCards.join('; ')
      : '(none selected)'

  return `Business URL: ${input.url}
Business type detected: ${input.businessType}
Page scan context: ${JSON.stringify(input.scanSummary)}

Owner's input:
- Original text: """${input.ownerText}"""
- Predefined concerns selected: ${cardsBlock}
- Screenshots provided: ${screenshotCount} ${screenshotCount === 1 ? 'image' : 'images'}

${
  screenshotCount > 0
    ? 'Screenshots are provided as image blocks above. Reference them by their position (e.g. "screenshot 1") in the screenshot_ref field of the section they relate to.'
    : 'No screenshots — set screenshot_ref to null on every section.'
}

Return JSON in this exact shape:
{
  "business_type": string,
  "detected_language": string (ISO 639-1 code, or "mixed"),
  "owner_original_words": string (the owner's text, verbatim),
  "intent_summary": string (one sentence, plain English),
  "sections": [
    {
      "title": string (short label for this work item),
      "priority": "high" | "medium" | "low",
      "effort_days": string (e.g. "1–2 days", "3–5 days", "1–2 weeks"),
      "owner_words": string (exact quote from the owner's text or selected card label that motivated this section),
      "technical_brief": string (precise spec for the developer — what to build, where, with what behaviour),
      "screenshot_ref": string | null
    }
  ],
  "additional_recommendations": string[] (max 3, only if highly relevant to the detected business type),
  "not_in_scope": string[] (things the owner did NOT ask for — sets boundaries for the developer)
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
      model: BRIEF_MODEL,
      max_tokens: BRIEF_MAX_TOKENS,
      temperature: BRIEF_TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })
  } catch (err) {
    console.error(
      '[claude/brief] API call failed',
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
      '[claude/brief] JSON.parse failed (truncated):',
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

function finalizeBrief(parsed: unknown): BriefOutput | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>

  const business_type = strField(obj.business_type)
  const detected_language = strField(obj.detected_language)
  const owner_original_words = strField(obj.owner_original_words)
  const intent_summary = strField(obj.intent_summary)

  // All four headline fields are required — a brief without intent
  // summary or business_type is not a brief.
  if (
    !business_type ||
    !detected_language ||
    !owner_original_words ||
    !intent_summary
  ) {
    return null
  }

  if (!Array.isArray(obj.sections)) return null
  const sections: BriefSection[] = []
  for (const raw of obj.sections) {
    const section = validateSection(raw)
    if (section) sections.push(section)
  }
  // A brief with zero valid sections is degenerate. Better to fail
  // here than to ship the user a "0 sections" brief.
  if (sections.length === 0) return null

  const additional_recommendations = Array.isArray(obj.additional_recommendations)
    ? obj.additional_recommendations
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 3)
    : []

  const not_in_scope = Array.isArray(obj.not_in_scope)
    ? obj.not_in_scope.filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0,
      )
    : []

  return {
    business_type,
    detected_language,
    owner_original_words,
    intent_summary,
    sections,
    additional_recommendations,
    not_in_scope,
  }
}

function validateSection(raw: unknown): BriefSection | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const title = strField(r.title)
  const effort_days = strField(r.effort_days)
  const owner_words = strField(r.owner_words)
  const technical_brief = strField(r.technical_brief)

  if (!title || !effort_days || !owner_words || !technical_brief) return null

  const priority = isPriority(r.priority) ? r.priority : null
  if (!priority) return null

  // screenshot_ref is genuinely optional — null is a valid value, NOT
  // an error condition. Coerce missing/non-string to null.
  const screenshot_ref =
    typeof r.screenshot_ref === 'string' && r.screenshot_ref.trim().length > 0
      ? r.screenshot_ref.trim()
      : null

  return {
    title,
    priority,
    effort_days,
    owner_words,
    technical_brief,
    screenshot_ref,
  }
}

function strField(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function isPriority(v: unknown): v is 'high' | 'medium' | 'low' {
  return v === 'high' || v === 'medium' || v === 'low'
}
