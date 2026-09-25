// No Deceit — policy core (PURE, zero dependencies).
//
// The single source of truth for the gate. Given resolved state and a
// classified tool call, it returns allow / deny(reason) / ask. It never
// reads the filesystem, the clock, or the environment; the caller (the hook
// shim or the `nd` CLI) resolves those and passes them in. This keeps the
// policy table testable and lets per-harness adapters import it
// unchanged.
//
// THE IMPORTANT CLARIFICATION (report §5.2, and SKILL.md).
// At the *tool* layer, Tier 1 and Tier 2 are identical: the agent never has
// a write path to source. Source mutation (category E) is DENIED at Tier 1,
// Tier 2-locked, Tier 2-unlocked, and Tier 3-without-preamble; it is allowed
// only at Tier 3 once a preamble exists. What the Tier 2 unlock changes is
// the *text channel* — whether the agent may show a worked solution in chat.
// Phase 3 enforces that channel at Tier 1 / locked Tier 2 via decideTextChannel
// (Stop) and decideDisplay (MessageDisplay). "The developer types it" is
// therefore enforced for free at the file layer: with no write path, the only
// way code reaches the file is the developer's own hands.

import { DEFAULT_MAX_FENCE_LINES, overThresholdFences, diagramFences, redactGatedFences } from './fence.mjs';
import { checkTurnEnding, hasHandoverLabel } from './handover.mjs';
import { checkNarrationFormat } from './narration.mjs';

export { DEFAULT_MAX_FENCE_LINES };

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
    '.no-deceit/attempts/<task>.md (or pointing at commits of differing ' +
    'attempts) and running `nd unlock` / `/no-deceit:unlock`. A blind grader ' +
    'in a fresh process judges genuineness of engagement, not correctness. ' +
    'To skip the grader, `nd unlock --override "<reason>"` (ledgered). Until ' +
    'then, behave as Tier 1: ask a question that makes them compare or judge, not a fix.',

  T2_UNLOCKED:
    'No Deceit Tier 2 is unlocked: you may explain and show a worked solution ' +
    'in chat. You still may not write it to disk, and must not route around ' +
    'that via shell, patch, or eval — the developer types the implementation ' +
    'themselves, no copy-paste. Afterwards, write a checking-question rubric ' +
    'to .no-deceit/checks/<task>/rubric.json BEFORE you see the answer, then ' +
    'ask the question. Do not grade it yourself; the developer runs `nd check ' +
    '<task>` (or `/no-deceit:check <task>`), which spawns the same blind grader. ' +
    'You never spawn the grader.',

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

  DELEGATION:
    'No Deceit: spawning a subagent is a route around this gate — a subagent ' +
    'does not inherit the tutoring conversation and can write files the parent ' +
    'cannot. Confirm with the developer before delegating. Default to one ' +
    'linear agent in a single visible context.',

  T1_CHAT_FENCE:
    'No Deceit Tier 1 (Tutor). That turn handed over a worked solution as ' +
    'chat text — a fenced code block above the small-snippet threshold. The ' +
    'text channel is gated the same way as a file write. Retract the code. ' +
    'Ask one question that makes the developer compare two approaches or ' +
    'judge where their current attempt diverges from what they expect. Small ' +
    'illustrative snippets (a few lines of a general concept, not the ' +
    'solution) are still allowed.',

  T_CHAT_DIAGRAM:
    'No Deceit: drawing the diagram is the learning. That turn put a diagram ' +
    '(Mermaid, PlantUML, D2, DOT, mind-map, or Excalidraw JSON) in chat, and at ' +
    'this tier there is no such thing as an illustrative diagram of the ' +
    'developer\'s own system, of any size. Retract it. Ask which two elements ' +
    'of their system they would put on the page first and what the arrow ' +
    'between them is labelled. If they have drawn something, ask them to ' +
    'save it.',

  T_QUESTION_ENDING:
    'No Deceit Tier 1 / locked Tier 2: this turn neither ends with a question ' +
    'nor carries a `Handing over: <what>` line. At this tier the agent may ' +
    'not quietly deliver an answer. Either end the turn with one question ' +
    'that makes the developer compare or judge, or, if you are really ' +
    'handing something over, say so with a line `Handing over: <one line>`.',

  T_HANDOVER_UNLABELLED:
    'No Deceit: the developer typed /no-deceit:handover, so you may give the ' +
    'answer in full this turn — but the turn must still say so with a line ' +
    '`Handing over: <one line>`, so the transcript shows it. Add the label, ' +
    'then one question that checks whether it landed.',

  DIAGRAM_FILE:
    'No Deceit: drawing the diagram is the learning. Do not produce a diagram ' +
    'of the developer\'s system, in a file or in chat. Ask which two elements ' +
    'of their system they would put on the page first and what the arrow ' +
    'between them is labelled. If they have drawn something, ask them to save ' +
    'it.',

  DIAGRAM_FILE_T2_UNLOCKED:
    'No Deceit Tier 2 is unlocked: you may show a diagram in chat (a fenced ' +
    'Mermaid block), but never write one to disk — diagram files stay denied, ' +
    'and you must not route around that via shell or a renderer fed inline ' +
    'source. Show it in chat; the developer redraws it themselves.',

  T3_NARRATION:
    'No Deceit Tier 3 (Narrated Velocity) requires a what/why section and a ' +
    '`Divergence from your first instinct:` line (the value `none` is ' +
    'acceptable) on any turn that edited files. This is a format check, not ' +
    'a quality judgment. Add both in the required shape and continue — do ' +
    'not silently produce more code.',

  BASH_EDIT_DIFF:
    'No Deceit: that Bash command slipped past the mutation deny-list but ' +
    'wrote source (bashEditDiff tripwire). Revert the file change. Do not ' +
    'route around the source-write gate; at this tier the developer types ' +
    'implementation. REPL eval and test/build runs that do not write source ' +
    'remain allowed.',

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
 *   project  = { tier: 1|2 (absent => 2), mode, unlocked? }   from <repo>/.no-deceit/state.json
 *   session  = { t3ExpiresAtMs?, unlocked? }     from the session overlay
 */
export function resolveEffective({ project = {}, session = {}, preamblePresent = false, nowMs = Date.now() } = {}) {
  const notes = [];
  const baseTier = project.tier === 1 ? 1 : 2; // Tier 2 is the default; Tier 3 is only ever a grant.
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
 *   event     = { category: 'A'..'H' | 'U' }
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

  // Design artifact (Mermaid / Excalidraw / mind-map source). Denied at Tier 1
  // and Tier 2, locked or unlocked: the artifact must pass through the
  // learner's hands, so an unlock only opens the chat channel.
  if (category === 'H') {
    if (tier === 1) return { decision: 'deny', reason: REASONS.DIAGRAM_FILE };
    if (tier === 2) {
      return { decision: 'deny', reason: t2Unlocked ? REASONS.DIAGRAM_FILE_T2_UNLOCKED : REASONS.DIAGRAM_FILE };
    }
    if (!t3PreamblePresent) return { decision: 'deny', reason: REASONS.T3_NO_PREAMBLE };
    return { decision: 'allow', reason: null };
  }

  // Delegation. A subagent is a gate-bypass route, so attended sessions
  // always surface an `ask` rather than a silent allow. Tier 3 without a
  // preamble still denies, matching the source-write gate.
  if (category === 'F') {
    if (tier === 3 && !t3PreamblePresent) return { decision: 'deny', reason: REASONS.T3_NO_PREAMBLE };
    if (tier === 3) return { decision: 'ask', reason: REASONS.T3_SUBAGENT };
    return { decision: 'ask', reason: REASONS.DELEGATION };
  }

  // Unknown Bash shape.
  if (category === 'U') {
    if (tier === 3 && t3PreamblePresent) return { decision: 'allow', reason: null };
    return { decision: 'ask', reason: REASONS.UNKNOWN_BASH };
  }

  // Unrecognised category: fail closed.
  return { decision: 'deny', reason: REASONS.TAMPER };
}

/** Chat-text is gated at Tier 1 and at locked Tier 2 (same as the skill). */
export function chatTextGated(effective) {
  if (!effective) return false;
  if (effective.tier === 1) return true;
  if (effective.tier === 2 && !effective.t2Unlocked) return true;
  return false;
}

/**
 * Stop-hook decision over the assistant's completed turn. Pure.
 *   event = { text, stopHookActive?, turnEdited?, maxFenceLines?,
 *             handoverActive?, projectNouns? }
 * returns { decision: 'allow'|'block', reason, kind, labelled? }
 *
 * Gated tiers (T1 / locked T2), in order:
 *   1. handoverActive (a user-typed /no-deceit:handover armed this turn):
 *      fences, diagrams, and the question-ending rule are relaxed, but the
 *      `Handing over:` label is still required.
 *   2. a diagram fence of any size is a chat_diagram violation;
 *   3. a code fence over the threshold is a chat_fence violation;
 *   4. the turn must end with a question, carry the label, or be a short turn.
 * The label and question rules block once per turn (stopHookActive lets the
 * retry through) so a stubborn model cannot wedge the session.
 */
export function decideTextChannel(effective, event = {}) {
  const text = event.text || '';
  const maxLines = event.maxFenceLines ?? DEFAULT_MAX_FENCE_LINES;
  const allow = (extra = {}) => ({ decision: 'allow', reason: null, kind: null, ...extra });

  if (chatTextGated(effective)) {
    const labelled = hasHandoverLabel(text);

    if (event.handoverActive) {
      if (!labelled && !event.stopHookActive) {
        return { decision: 'block', reason: REASONS.T_HANDOVER_UNLABELLED, kind: 'handover_unlabelled' };
      }
      return allow({ labelled });
    }

    if (diagramFences(text).length > 0) {
      return { decision: 'block', reason: REASONS.T_CHAT_DIAGRAM, kind: 'chat_diagram' };
    }
    if (overThresholdFences(text, maxLines).length > 0) {
      return { decision: 'block', reason: REASONS.T1_CHAT_FENCE, kind: 'chat_fence' };
    }
    const ending = checkTurnEnding(text, { projectNouns: event.projectNouns });
    if (!ending.ok && !event.stopHookActive) {
      return { decision: 'block', reason: REASONS.T_QUESTION_ENDING, kind: 'question_ending' };
    }
    return allow({ labelled: ending.labelled });
  }

  // Tier 3: existence/format of narration + divergence, only on turns that
  // actually edited. Block once (respect stop_hook_active).
  if (effective.tier === 3 && effective.t3PreamblePresent && event.turnEdited) {
    if (event.stopHookActive) return allow();
    const fmt = checkNarrationFormat(text);
    if (!fmt.ok) {
      return { decision: 'block', reason: REASONS.T3_NARRATION, kind: 'narration_format' };
    }
  }
  return allow();
}

/**
 * MessageDisplay decision. Display-only; never changes the transcript.
 *   event = { text, redactionEnabled?, maxFenceLines? }
 * returns { redact, displayContent }
 */
export function decideDisplay(effective, event = {}) {
  if (!event.redactionEnabled) return { redact: false, displayContent: null };
  if (!chatTextGated(effective)) return { redact: false, displayContent: null };
  const maxLines = event.maxFenceLines ?? DEFAULT_MAX_FENCE_LINES;
  // A handover turn is the one turn where the developer asked for the answer.
  if (event.handoverActive) return { redact: false, displayContent: null };
  const r = redactGatedFences(event.text || '', maxLines);
  if (!r.redacted) return { redact: false, displayContent: null };
  return { redact: true, displayContent: r.text, kind: r.diagramCount > 0 ? 'chat_diagram' : 'chat_fence' };
}

/**
 * bashEditDiff tripwire. Pure: caller supplies already-classified leaked paths.
 * Source writes are in policy at granted Tier 3, so the tripwire is silent there.
 */
export function decideBashEditDiff(effective, event = {}) {
  const leaked = event.leaked || [];
  if (leaked.length === 0) return { decision: 'allow', reason: null, kind: null };
  if (effective.tier === 3 && effective.t3PreamblePresent) {
    return { decision: 'allow', reason: null, kind: null };
  }
  return { decision: 'block', reason: REASONS.BASH_EDIT_DIFF, kind: 'bash_edit_diff' };
}
