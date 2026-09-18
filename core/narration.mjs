// No Deceit — Tier 3 narration / divergence FORMAT check (PURE).
//
// Existence and shape only. Narration *quality* is advisory in SKILL.md.
// Required:
//   1. A what/why section (combined heading, separate headings, or What:/Why: labels)
//   2. A `Divergence from your first instinct:` line with a non-empty value
//      ("none" is acceptable).

const DIVERGENCE = /^Divergence from your first instinct:\s*(\S.*)$/im;

const COMBINED_HEADING = /^#{1,6}\s*what\s*(?:\/|&|and)\s*why\b/im;
const WHAT_HEADING = /^#{1,6}\s*what\b/im;
const WHY_HEADING = /^#{1,6}\s*why\b/im;
const WHAT_LABEL = /^\s*(?:\*{0,2}|_{0,2})what:\s*\S/im;
const WHY_LABEL = /^\s*(?:\*{0,2}|_{0,2})why:\s*\S/im;

function headingHasBody(text, headingRe) {
  const m = headingRe.exec(text);
  if (!m) return false;
  const after = text.slice(m.index + m[0].length);
  // Body is "present" if anything non-whitespace exists before the next heading
  // or the divergence label or EOF. Format only — one character is enough.
  const next = after.search(/\n#{1,6}\s|\nDivergence from your first instinct:/i);
  const slice = (next === -1 ? after : after.slice(0, next)).trim();
  return slice.length > 0;
}

export function checkNarrationFormat(text) {
  const src = String(text ?? '');
  const div = src.match(DIVERGENCE);
  const hasDivergence = Boolean(div && div[1] && div[1].trim());

  const combined = COMBINED_HEADING.test(src) && headingHasBody(src, COMBINED_HEADING);
  const separateHeadings = headingHasBody(src, WHAT_HEADING) && headingHasBody(src, WHY_HEADING);
  const labels = WHAT_LABEL.test(src) && WHY_LABEL.test(src);
  const hasWhatWhy = combined || separateHeadings || labels;

  return { ok: hasWhatWhy && hasDivergence, hasWhatWhy, hasDivergence };
}
