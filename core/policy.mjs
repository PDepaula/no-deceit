// No Deceit — policy core (PURE, zero dependencies).
//
// The single source of truth for the gate. Given resolved state and a
// classified tool call, it returns allow / deny(reason) / ask. It never
// reads the filesystem, the clock, or the environment; the caller (the hook
// shim or the `nd` CLI) resolves those and passes them in. This keeps the
// policy table testable and lets future per-harness adapters import it
// unchanged.
//
// THE IMPORTANT CLARIFICATION (report §5.2, and SKILL.md:147-149).
// At the *tool* layer, Tier 1 and Tier 2 are identical: the agent never has
// a write path to source. Source mutation (category E) is DENIED at Tier 1,
// Tier 2-locked, Tier 2-unlocked, and Tier 3-without-preamble; it is allowed
// only at Tier 3 once a preamble exists. What the Tier 2 unlock changes is
// the *text channel* — whether the agent may show a worked solution in chat
// — which surfaces here only as a different deny reason. "The developer types
// it" is therefore enforced for free: with no write path, the only way code
// reaches the file is the developer's own hands.

export const REASONS = {
  T1:
    'No Deceit Tier 1 (Tutor). Writing source is blocked, and that includes ' +
    'other routes such as shell redirects, sed -i, patch/git apply, or REPL ' +
    'file writes — routing around this block is itself a violation. Do not ' +
    'produce the solution in chat either. Ask one question that makes the ' +
    'developer compare two approaches or judge where their current attempt ' +
    'diverges from what they expect. If it fits, name the smallest expression ' +
    'they could evaluate in their REPL to test that, and ask them to predict ' +
    'the result first.',

  T2_LOCKED:
    'No Deceit Tier 2 is not unlocked for this task, so writing source is ' +
    'blocked (as in Tier 1) — do not route around it via shell, patch, or ' +
    'eval. The developer unlocks by writing their mental model to ' +
    '.no-deceit/attempts/<task>.md or pointing at commits of differing ' +
    'attempts, then running `nd unlock` (or, to unlock anyway, ' +
    '`nd unlock --override "<reason>"`). Until then, behave as Tier 1: ask a ' +
    'question that makes them compare or judge, not a fix.',

  T2_UNLOCKED:
    'No Deceit Tier 2 is unlocked: you may explain and show a worked solution ' +
    'in chat. You still may not write it to disk, and must not route around ' +
    'that via shell, patch, or eval — the developer types the implementation ' +
    'themselves, no copy-paste. Afterwards, ask one checking question about ' +
    'the concept, not just whether the code runs.',

  T3_NO_PREAMBLE:
    'No Deceit Tier 3 (Narrated Velocity) needs the developer\'s high-level ' +
    'overview and naive first-instinct approach before any code is written. ' +
    'Ask them for both, or ask them to fill .no-deceit/t3/preamble.md, then ' +
    'grant Tier 3 with `nd tier 3`. Do not write source until the preamble ' +
    'exists.',

  T3_SUBAGENT:
    'No Deceit Tier 3 defaults to one linear agent in a single visible ' +
    'context, since the point of this tier is retained understanding, not ' +
    'maximum throughput. Confirm with the developer before spawning parallel ' +
    'subagents or delegating.',

  TAMPER:
    'No Deceit: that call would change the tier or write to No Deceit\'s own ' +
    'state or ledger, which the agent may never do. Tier and mode change only ' +
    'through the developer\'s own prompt commands (/no-deceit:tier, :mode) or ' +
    'their own shell (`nd`). A denied tool call is the system working as ' +
    'intended; do not route around it.',

  UNKNOWN_BASH:
    'No Deceit could not classify this shell command, so at the current tier ' +
    'it is being surfaced for the developer to approve rather than run ' +
    'silently. If it writes source, it is blocked; if it only inspects or ' +
    'runs code, the developer can allow it.',
};

/**
 * Resolve raw on-disk state into the effective policy state.
 * Pure: the caller supplies preamblePresent (a file check) and nowMs (the clock).
 *
 *   project  = { tier: 1|2, mode, unlocked? }   from <repo>/.no-deceit/state.json
 *   session  = { t3ExpiresAtMs?, unlocked? }     from the session overlay
 */
export function resolveEffective({ project = {}, session = {}, preamblePresent = false, nowMs = Date.now() } = {}) {
  const notes = [];
  const baseTier = project.tier === 2 ? 2 : 1; // Tier 3 is only ever a grant.
  const mode = project.mode || 'ask';

  // A Tier 3 grant can come from the session overlay (the in-prompt
  // /no-deceit:tier 3, which carries a session id) or from the project state
  // (the `nd tier 3` shell command, which has no session id). Honor the
  // later-expiring of the two.
  let tier = baseTier;
  let t3Active = false;
  const grants = [session.t3ExpiresAtMs, project.t3ExpiresAtMs].filter((x) => x != null);
  if (grants.length > 0) {
    const latest = Math.max(...grants);
    if (latest > nowMs) {
      tier = 3;
      t3Active = true;
    } else {
      notes.push(`Tier 3 grant expired; fell back to Tier ${baseTier}.`);
    }
  }

  const t2Unlocked = Boolean(project.unlocked) || Boolean(session.unlocked);

  return {
    tier,
    mode,
    t2Unlocked,
    t3Active,
    t3PreamblePresent: Boolean(preamblePresent),
    notes,
  };
}

/**
 * The gate decision. Pure.
 *   effective = output of resolveEffective
 *   event     = { category: 'A'..'G' | 'U' }
 * returns { decision: 'allow'|'deny'|'ask', reason: string|null }
 */
export function decide(effective, event) {
  const { category } = event;
  const { tier, t2Unlocked, t3PreamblePresent } = effective;

  // Tamper is denied at every tier.
  if (category === 'G') return { decision: 'deny', reason: REASONS.TAMPER };

  // Inspect / run / tooling / test scaffold: allowed at every tier.
  if (category === 'A' || category === 'B' || category === 'C' || category === 'D') {
    return { decision: 'allow', reason: null };
  }

  // Source mutation.
  if (category === 'E') {
    if (tier === 1) return { decision: 'deny', reason: REASONS.T1 };
    if (tier === 2) {
      return { decision: 'deny', reason: t2Unlocked ? REASONS.T2_UNLOCKED : REASONS.T2_LOCKED };
    }
    // tier 3
    if (!t3PreamblePresent) return { decision: 'deny', reason: REASONS.T3_NO_PREAMBLE };
    return { decision: 'allow', reason: null };
  }

  // Delegation.
  if (category === 'F') {
    if (tier === 1 || tier === 2) return { decision: 'allow', reason: null };
    // tier 3
    if (!t3PreamblePresent) return { decision: 'deny', reason: REASONS.T3_NO_PREAMBLE };
    return { decision: 'ask', reason: REASONS.T3_SUBAGENT };
  }

  // Unknown Bash shape.
  if (category === 'U') {
    if (tier === 3 && t3PreamblePresent) return { decision: 'allow', reason: null };
    return { decision: 'ask', reason: REASONS.UNKNOWN_BASH };
  }

  // Unrecognised category: fail closed.
  return { decision: 'deny', reason: REASONS.TAMPER };
}
