import type { BlueprintOutput } from '@/lib/claude/blueprint'

/**
 * Post-process filter that rewrites BRAND.md banned words in Claude's
 * generated blueprint text. Mirrors the brief filter exactly — every
 * shipped blueprint is scrubbed before it touches the database, the
 * preview UI, the paid full page, the PDF, or any email body.
 *
 * Unlike the brief, the blueprint has no verbatim "owner_words" field
 * to preserve — every text field is Claude-authored. detected_language
 * (ISO code) and recommendation (enum) skip the scrub for trivial
 * reasons, not preservation rules.
 */

type Replacement = { pattern: RegExp; replacement: string }

const BANNED_REPLACEMENTS: ReadonlyArray<Replacement> = [
  { pattern: /\butilize/gi, replacement: 'use' },
  { pattern: /\bleverage/gi, replacement: 'use' },
  { pattern: /\bensure/gi, replacement: 'make sure' },
  { pattern: /\brobust/gi, replacement: 'strong' },
  { pattern: /\bseamless/gi, replacement: 'smooth' },
]

function scrubText(text: string): string {
  let out = text
  for (const { pattern, replacement } of BANNED_REPLACEMENTS) {
    out = out.replace(pattern, (matched) => preserveCase(matched, replacement))
  }
  return out
}

function preserveCase(matched: string, replacement: string): string {
  if (matched === matched.toUpperCase() && matched !== matched.toLowerCase()) {
    return replacement.toUpperCase()
  }
  if (matched[0] === matched[0]?.toUpperCase()) {
    return (replacement[0]?.toUpperCase() ?? '') + replacement.slice(1)
  }
  return replacement
}

export function scrubBlueprintBannedWords(
  blueprint: BlueprintOutput,
): BlueprintOutput {
  return {
    detected_language: blueprint.detected_language,
    understood: scrubText(blueprint.understood),
    recommendation: blueprint.recommendation,
    recommendation_label: scrubText(blueprint.recommendation_label),
    timeline_days: scrubText(blueprint.timeline_days),
    budget_range: scrubText(blueprint.budget_range),
    why_right: blueprint.why_right.map(scrubText),
    why_not_alternative: blueprint.why_not_alternative.map(scrubText),
    pages_needed: blueprint.pages_needed.map((p) => ({
      name: scrubText(p.name),
      purpose: scrubText(p.purpose),
    })),
    features_needed: blueprint.features_needed.map(scrubText),
    features_not_needed: blueprint.features_not_needed.map(scrubText),
    technology: {
      platform: scrubText(blueprint.technology.platform),
      reason: scrubText(blueprint.technology.reason),
      hosting: scrubText(blueprint.technology.hosting),
      avoid: blueprint.technology.avoid.map(scrubText),
      avoid_reasons: blueprint.technology.avoid_reasons.map(scrubText),
    },
    next_steps: blueprint.next_steps.map((n) => ({
      step: n.step,
      action: scrubText(n.action),
      cost: n.cost,
    })),
    red_flags:
      blueprint.red_flags === null
        ? null
        : blueprint.red_flags.map(scrubText),
  }
}

export { scrubText as _scrubTextForTesting }
