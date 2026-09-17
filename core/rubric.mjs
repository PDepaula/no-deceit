// No Deceit — fixed rubrics and mechanical verdicts (PURE).
//
// The rubric is fixed before evidence is read. Expertise never flows into the
// verdict; it only fills diagnosis fields. Correctness of a hypothesis is
// NOT an unlock criterion. Round down when torn: a missing span, a non-boolean
// `met`, or an explicit torn flag is unmet.

export const MENTAL_IDS = ['R1', 'R2', 'R3', 'R4'];
export const COMMIT_IDS = ['C1', 'C2', 'C3'];

export const MENTAL_RUBRIC = {
  R1: 'States what the code is supposed to do as a mechanism, not the task title.',
  R2: 'States what it actually does, with evidence (error, output, REPL result).',
  R3: 'Names a suspected locus as a falsifiable "I think X because Y".',
  R4: 'Says what was tried or ruled out.',
};

export const COMMIT_RUBRIC = {
  C1: 'There are at least two attempts.',
  C2: 'The attempts differ in data structure, strategy, or framing — not cosmetics.',
  C3: 'There is evidence the attempts were actually run.',
};

/** Pass = R1 ∧ R3, plus one of R2/R4. */
export function mentalPass(flags) {
  return Boolean(flags.R1) && Boolean(flags.R3) && (Boolean(flags.R2) || Boolean(flags.R4));
}

/** Pass = C1 ∧ C2. C3 is diagnostic, not required. */
export function commitPass(flags) {
  return Boolean(flags.C1) && Boolean(flags.C2);
}

function idsFor(route) {
  return route === 'commit-history' ? COMMIT_IDS : MENTAL_IDS;
}

export function normalizeCriterion(raw) {
  if (!raw || typeof raw !== 'object') {
    return { met: false, span: null, rounded_down: 'missing' };
  }
  const span = raw.span == null ? null : String(raw.span).trim() || null;
  if (raw.met !== true) {
    return { met: false, span, rounded_down: raw.met === true ? null : 'not_true' };
  }
  if (!span) return { met: false, span: null, rounded_down: 'met without span' };
  return { met: true, span };
}

export function normalizeCriteria(route, rawCriteria = {}) {
  const out = {};
  for (const id of idsFor(route)) {
    out[id] = normalizeCriterion(rawCriteria[id]);
  }
  return out;
}

function flagsOf(normalized) {
  const flags = {};
  for (const [id, c] of Object.entries(normalized)) flags[id] = c.met;
  return flags;
}

/**
 * Mechanical unlock verdict. The LLM's `verdict` field cannot upgrade a fail.
 * An explicit torn flag rounds an otherwise-passing formula down to not_yet.
 */
export function finalizeUnlockVerdict({ route, rawCriteria, llmVerdict, torn = false } = {}) {
  const criteria = normalizeCriteria(route, rawCriteria);
  const flags = flagsOf(criteria);
  const formula = route === 'commit-history' ? commitPass(flags) : mentalPass(flags);
  let verdict = formula ? 'unlocked' : 'not_yet';
  if (torn) verdict = 'not_yet';
  // Never upgrade. If the model said not_yet, round down even if formula passed.
  if (llmVerdict === 'not_yet') verdict = 'not_yet';
  return { verdict, criteria };
}

export function finalizeCheckVerdict(rawCriteria = {}, ids = null, torn = false) {
  const criteria = {};
  const idList = Array.isArray(ids) ? ids : Object.keys(rawCriteria);
  for (const id of idList) criteria[id] = normalizeCriterion(rawCriteria[id]);
  if (torn) {
    return { verdict: 'not_landed', criteria };
  }
  const mets = Object.values(criteria).filter((c) => c.met).length;
  const total = Object.values(criteria).length;
  let verdict = 'not_landed';
  if (total > 0 && mets === total) verdict = 'landed';
  else if (mets > 0) verdict = 'partial';
  return { verdict, criteria };
}

/**
 * error_class trend → suggested domain mode.
 * Repeated conceptual ⇒ Coach; mostly slip ⇒ Pair. Returns null if no signal.
 */
export function suggestDomainMode(classes, window = 5) {
  const recent = (classes || []).filter((c) => c === 'slip' || c === 'conceptual').slice(-window);
  if (recent.length === 0) return null;
  const conceptual = recent.filter((c) => c === 'conceptual').length;
  const slip = recent.filter((c) => c === 'slip').length;
  if (conceptual >= 2 && conceptual > slip) return 'coach';
  if (slip >= 2 && slip > conceptual) return 'pair';
  return null;
}

export const PREFILTER_NEXT_QUESTION = {
  empty:
    'Write what the code is supposed to do as a mechanism — not the task title — and one falsifiable guess: "I think X because Y".',
  too_short:
    'That is too short to show a model. Name the mechanism you think the code implements, and one place you think it diverges, with a because.',
  error_paste:
    'Put the error text aside. In your own words: what is the code supposed to do as a mechanism, and where do you think it actually diverges?',
  too_few_attempts:
    'Need two attempts that differ in data structure, strategy, or framing — not formatting or a rename. What did you try that was actually a different approach?',
  no_shared_unit:
    'The attempts need to touch the same unit (the same file or function) so they are two tries at one problem, not two unrelated edits.',
};
