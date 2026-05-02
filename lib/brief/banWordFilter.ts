import type { BriefOutput } from '@/lib/claude/brief'

/**
 * Post-process filter that rewrites BRAND.md banned words in Claude's
 * generated text fields.
 *
 * The system prompt instructs Claude to avoid these words, but the
 * curl-test in slice 1 caught one slip ("ensure" leaked into a
 * technical_brief). A prompt rule is a soft guarantee; this filter is
 * the hard guarantee — every shipped brief is scrubbed before it
 * touches the database, the UI, or an email body.
 *
 * Critical rule: NEVER scrub `owner_words` or `owner_original_words`.
 * Those are the owner's verbatim text. If the owner literally wrote
 * "ensure", that stays. The scrubber only fixes Claude's words. The
 * brief's whole credibility rests on owners seeing their own language
 * preserved exactly.
 */

type Replacement = { pattern: RegExp; replacement: string }

const BANNED_REPLACEMENTS: ReadonlyArray<Replacement> = [
  // \b prevents matching inside other words ("utilization" stays clean
  // because we want plain replacements; for partial-word coverage we'd
  // need stems, which is more disruptive).
  { pattern: /\butilize/gi, replacement: 'use' },
  { pattern: /\bleverage/gi, replacement: 'use' },
  { pattern: /\bensure/gi, replacement: 'make sure' },
  { pattern: /\brobust/gi, replacement: 'strong' },
  { pattern: /\bseamless/gi, replacement: 'smooth' },
]

/**
 * Apply all banned-word replacements to a string. Preserves case shape:
 *   "Ensure"  → "Make sure"
 *   "ENSURE"  → "MAKE SURE"
 *   "ensure"  → "make sure"
 */
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

/**
 * Scrub banned words across every Claude-authored text field in a
 * BriefOutput. Owner verbatim fields are passed through untouched.
 */
export function scrubBriefBannedWords(brief: BriefOutput): BriefOutput {
  return {
    // Verbatim — never scrub
    owner_original_words: brief.owner_original_words,
    detected_language: brief.detected_language,
    business_type: brief.business_type,

    // Claude-generated — scrub
    intent_summary: scrubText(brief.intent_summary),
    sections: brief.sections.map((s) => ({
      title: scrubText(s.title),
      priority: s.priority,
      effort_days: scrubText(s.effort_days),
      // owner_words is the verbatim owner quote — never scrub
      owner_words: s.owner_words,
      technical_brief: scrubText(s.technical_brief),
      screenshot_ref: s.screenshot_ref,
    })),
    additional_recommendations: brief.additional_recommendations.map(scrubText),
    not_in_scope: brief.not_in_scope.map(scrubText),
  }
}

// Exported for unit testing if we ever wire vitest up.
export { scrubText as _scrubTextForTesting }
