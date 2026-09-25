// No Deceit — `Handing over:` label and question-ending checks (PURE).
//
// At Tier 1 and locked Tier 2 the tier does not forbid an answer, it forbids
// the *unlabelled* answer: a turn must end with a question, or carry a
// `Handing over: <what>` line naming what was handed over. Format only — the
// hook never judges whether the turn really was a handover.
//
// Short-turn allowance (report §7): a turn under ~40 words, with no fence and
// no project noun, passes unlabelled ("Captured. Ready when you are.").

import { extractFences } from './fence.mjs';

export const SHORT_TURN_WORDS = 40;

const HANDING_OVER = /^\s*(?:\*{1,2}|_{1,2})?Handing over:(?:\*{1,2}|_{1,2})?\s*(\S.*)$/im;

export function hasHandoverLabel(text) {
  const m = String(text ?? '').match(HANDING_OVER);
  return Boolean(m && m[1] && m[1].replace(/[*_`\s]/g, '').length > 0);
}

/** Does the last non-empty line end in a question mark (ignoring trailing markup)? */
export function endsWithQuestion(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  const last = lines[lines.length - 1].replace(/[\s*_`"')\]>”’]+$/u, '');
  return last.endsWith('?');
}

export function wordCount(text) {
  const t = String(text ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
}

function mentionsNoun(text, nouns) {
  const lower = String(text ?? '').toLowerCase();
  return (nouns || []).some((n) => {
    const w = String(n || '').trim().toLowerCase();
    return w && lower.includes(w);
  });
}

/**
 * Is this turn an allowed short unlabelled turn?
 *   under SHORT_TURN_WORDS words, no fence at all, no project noun.
 */
export function isShortTurn(text, { projectNouns = [], maxWords = SHORT_TURN_WORDS } = {}) {
  return wordCount(text) < maxWords
    && extractFences(text).length === 0
    && !mentionsNoun(text, projectNouns);
}

/**
 * checkTurnEnding(text, opts) -> { ok, labelled, reason }
 *   ok when: labelled, or ends with a question, or an allowed short turn.
 */
export function checkTurnEnding(text, opts = {}) {
  const labelled = hasHandoverLabel(text);
  if (labelled) return { ok: true, labelled: true, reason: 'label' };
  if (endsWithQuestion(text)) return { ok: true, labelled: false, reason: 'question' };
  if (isShortTurn(text, opts)) return { ok: true, labelled: false, reason: 'short' };
  return { ok: false, labelled: false, reason: 'unlabelled' };
}
