// No Deceit — control operations (the human's two forge-proof channels).
//
// Tier and mode change ONLY through: (1) the developer's own prompt commands,
// handled in the UserPromptSubmit hook; (2) the `nd` CLI in the developer's
// own shell. Both funnel through these functions. The model can forge neither:
// UserPromptSubmit sees the user's literal text (never model output), and the
// PreToolUse gate denies any tool call that invokes a mutating `nd`
// subcommand or touches the state paths (category G).

import { basename } from 'node:path';
import { dataPaths, isGoverned, readProjectState, writeProjectState, readSession, writeSession, appendLedger, loadConfig, readLedger, readAllLedger } from './state.mjs';
import { resolveEffective, chatTextGated } from './policy.mjs';
import { preamblePresent } from './state.mjs';
import { readCurriculum } from './curriculum-io.mjs';
import { curriculumReady, tier1Refusal, curriculumContext, isReviewed } from './curriculum.mjs';
import { suggestModesByDomain, domainOf, DEFAULT_WINDOW_MS } from './report.mjs';
import { unlockOverride as applyUnlockOverride } from './grader.mjs';

const MODES = ['coach', 'pair', 'ask'];

/**
 * Parse a control command out of a prompt. Pure.
 * Recognises only a prompt whose FIRST line STARTS with `/no-deceit:` (after
 * trimming), so a mid-sentence mention is not a command. Returns
 * { name, arg, body } or null; `body` is everything after line 1 (the
 * teach-back for `/no-deceit:teach`), '' for a one-line command.
 */
export function parseCommand(promptText) {
  if (typeof promptText !== 'string') return null;
  const text = promptText.replace(/^\s+/, '');
  const nl = text.search(/\r?\n/);
  const line = (nl < 0 ? text : text.slice(0, nl)).trim();
  const m = /^\/no-deceit:([a-z]+)\b(.*)$/.exec(line);
  if (!m) return null;
  const body = nl < 0 ? '' : text.slice(nl).replace(/^\r?\n/, '').replace(/\s+$/, '');
  return { name: m[1], arg: m[2].trim(), body };
}

/**
 * Set the tier. `topic` (Tier 1 or 2) records the active topic, which makes the
 * Tier 2 unlock apply per topic; Tier 1 with a topic in effect (given or
 * already stored) needs a ready curriculum (R2) and otherwise refuses with the
 * two ways to get one. `clearTopic` drops
 * the active topic. Neither given: the topic is left as it was.
 */
export function setTier({ repoRoot, env, sessionId, tier, topic = null, clearTopic = false, nowMs = Date.now() }) {
  const n = Number(tier);
  if (![1, 2, 3].includes(n)) throw new Error(`invalid tier: ${tier}`);
  const before = readProjectState(repoRoot, env);
  if (n === 3 && (topic || clearTopic)) throw new Error('a topic applies to Tier 1 or Tier 2, not to a Tier 3 grant');
  const nextTopic = clearTopic ? null : (topic || before.topic || null);
  if (n === 1 && nextTopic) {
    const cur = readCurriculum(env, nextTopic);
    const ready = curriculumReady({ ...cur, minChars: loadConfig(env).curriculumMinChars });
    if (!ready.ok) throw new Error(tier1Refusal(nextTopic, ready.missing, { stored: !topic }));
  }

  if (n === 3) {
    // Tier 3 is a grant that expires, never a project setting (D2). When a
    // session id is present (the in-prompt command), scope the grant to the
    // session; from the shell CLI (no session id) it is a project-level
    // time-boxed grant so it still resolves in the hook.
    const cfg = loadConfig(env);
    const expiresAtMs = nowMs + cfg.t3TimeboxMinutes * 60_000;
    if (sessionId) writeSession(env, sessionId, { t3ExpiresAtMs: expiresAtMs });
    else writeProjectState(repoRoot, { ...before, t3ExpiresAtMs: expiresAtMs });
    appendLedger(env, { event: 'tier_change', from: before.tier, to: 3, grant: true, expiresAtMs, sessionId: sessionId || null });
    return `Tier 3 granted for ${cfg.t3TimeboxMinutes} min (expires, then falls back to Tier ${before.tier}). A non-trivial .no-deceit/t3/preamble.md is still required before source can be written.`;
  }

  // Tier 1 / 2 are project settings. Clear any active Tier 3 grant.
  const { t3ExpiresAtMs, ...rest } = before;
  writeProjectState(repoRoot, { ...rest, tier: n, topic: nextTopic });
  if (sessionId) writeSession(env, sessionId, { t3ExpiresAtMs: null });
  appendLedger(env, {
    event: 'tier_change', from: before.tier, to: n, sessionId: sessionId || null,
    ...(nextTopic !== before.topic ? { topic: nextTopic } : {}),
  });
  const scoped = nextTopic ? ` for topic ${nextTopic}${n === 2 ? ' (its Tier 2 unlock is per topic)' : ''}` : '';
  return `Tier set to ${n}${scoped}.`;
}

export function setMode({ repoRoot, env, mode, sessionId, nowMs = Date.now() }) {
  if (!MODES.includes(mode)) throw new Error(`invalid mode: ${mode} (use coach|pair|ask)`);
  const before = readProjectState(repoRoot, env);
  writeProjectState(repoRoot, { ...before, mode });
  appendLedger(env, { event: 'mode_change', from: before.mode, to: mode, sessionId: sessionId || null });
  return `Mode set to ${mode}.`;
}

export function unlockOverride({ repoRoot, env, reason, sessionId, nowMs = Date.now() }) {
  return applyUnlockOverride({ repoRoot, env, reason, sessionId, nowMs });
}

function effectiveNow({ repoRoot, env, sessionId, nowMs }) {
  const project = readProjectState(repoRoot, env);
  const session = readSession(env, sessionId);
  return resolveEffective({ project, session, preamblePresent: preamblePresent(repoRoot, env), nowMs });
}

export function renderStatusShort({ repoRoot, env, sessionId, nowMs = Date.now() }) {
  if (!isGoverned(repoRoot)) return '[ND off]';
  const e = effectiveNow({ repoRoot, env, sessionId, nowMs });
  const lock = e.tier === 2 ? (e.t2Unlocked ? '·unlocked' : '·locked') : '';
  return `[ND T${e.tier}·${e.mode}${lock}]`;
}

function curriculumNote(env, topic) {
  const cur = readCurriculum(env, topic);
  const ready = curriculumReady({ ...cur, minChars: loadConfig(env).curriculumMinChars });
  if (!ready.ok) return ' — no ready curriculum';
  return isReviewed(cur.open) ? ' — curriculum reviewed' : ' — curriculum unreviewed (review mission, sources and outline: `nd curriculum review ' + topic + '`)';
}

/** Curriculum paths and rules for the active topic, for SessionStart / prompt context. '' when none. */
export function topicContext({ repoRoot, env, sessionId, nowMs = Date.now() }) {
  const e = effectiveNow({ repoRoot, env, sessionId, nowMs });
  if (!e.topic) return '';
  const dp = dataPaths(env);
  const cur = readCurriculum(env, e.topic);
  const ready = curriculumReady({ ...cur, minChars: loadConfig(env).curriculumMinChars }).ok;
  return curriculumContext({
    topic: e.topic,
    openPath: dp.curriculumOpen(e.topic),
    sealedPath: dp.curriculumSealed(e.topic),
    tier: e.tier,
    ready,
    reviewed: ready && isReviewed(cur.open),
  });
}

export function renderStatus({ repoRoot, env, sessionId, nowMs = Date.now() }) {
  if (!isGoverned(repoRoot)) {
    return `No Deceit: this project is not governed (no .no-deceit directory). Run \`nd init\` to opt in.`;
  }
  const e = effectiveNow({ repoRoot, env, sessionId, nowMs });
  const lines = [
    `No Deceit — governed.`,
    `  Tier:  ${e.tier}${e.tier === 3 ? ' (Narrated Velocity, granted)' : e.tier === 2 ? ' (Guided)' : ' (Tutor)'}`,
    `  Mode:  ${e.mode}`,
  ];
  if (e.topic) lines.push(`  Topic: ${e.topic}${curriculumNote(env, e.topic)}`);
  if (e.tier === 2) lines.push(`  Unlock: ${e.t2Unlocked ? 'unlocked' : 'locked'}${e.topic ? ` (for ${e.topic})` : ''}`);
  const project = readProjectState(repoRoot, env);
  if (project.lastDiagnosis && project.lastDiagnosis.error_class) {
    lines.push(`  Last error_class: ${project.lastDiagnosis.error_class}`);
  }
  const suggestions = suggestModesByDomain(readLedger(env, 50));
  if (suggestions.length) {
    lines.push(
      '  Suggested mode (evidence; you choose): ' +
      suggestions.map((s) => `${s.domain} → ${s.mode}`).join('; ') +
      ' (repeated conceptual ⇒ Coach, mostly slip ⇒ Pair)',
    );
  }
  if (e.tier === 3) lines.push(`  Preamble: ${e.t3PreamblePresent ? 'present' : 'MISSING (source writes blocked until filled)'}`);
  for (const n of e.notes) lines.push(`  Note:  ${n}`);
  return lines.join('\n');
}

/**
 * Parse `/no-deceit:handover [--domain <d>] [why...]`. Pure.
 */
export function parseHandoverArgs(arg) {
  let rest = String(arg || '').trim();
  let domain = null;
  const m = /^--domain[=\s]+(\S+)\s*(.*)$/.exec(rest);
  if (m) { domain = m[1]; rest = m[2].trim(); }
  return { domain, reason: rest || null };
}

/**
 * The developer's own act: ask for the answer. Ledgers a `handover` and arms
 * the text-channel relaxation for exactly the next turn. Rides the
 * UserPromptSubmit channel only, so the model cannot issue it.
 */
export function startHandover({ repoRoot, env, sessionId, arg, nowMs = Date.now() }) {
  if (!isGoverned(repoRoot)) return 'No Deceit: this project is not governed, so there is nothing to hand over.';
  if (!sessionId) return 'No Deceit: handover needs a session, and none was provided. Nothing recorded.';
  const e = effectiveNow({ repoRoot, env, sessionId, nowMs });
  if (!chatTextGated(e)) {
    return `The text channel is already open at Tier ${e.tier}${e.tier === 2 ? ' (unlocked)' : ''}; nothing to relax, nothing recorded.`;
  }
  const { domain, reason } = parseHandoverArgs(arg);
  appendLedger(env, {
    event: 'handover',
    ...(domain ? { domain } : {}),
    project: basename(repoRoot),
    tier: e.tier,
    reason,
    sessionId,
  });
  writeSession(env, sessionId, { handoverPending: true, handoverActive: false });
  const label = domain || 'unscoped';
  const n = readAllLedger(env).filter((x) => x.event === 'handover'
    && (domainOf(x) || 'unscoped') === label
    && Date.parse(x.ts) >= nowMs - DEFAULT_WINDOW_MS).length;
  return `Handover recorded for ${label} (${n} in the last 7 days). Next turn: the agent may answer in full, ` +
    `and must say so with a \`Handing over:\` line. Nothing else changes; Tier ${e.tier} ` +
    `${e.tier === 2 ? '(locked) ' : ''}applies again after that.`;
}

export const HANDOVER_CONTEXT =
  'The developer has explicitly asked for the answer and this is recorded (their own ' +
  '/no-deceit:handover). Give it, in full, and end with `Handing over: <one line>`. ' +
  'Then one question that checks whether it landed.';

/**
 * Called on every non-command prompt. Arms a pending handover for this turn
 * (returns the context to inject) or clears a stale armed flag. Returns null
 * when nothing is armed.
 */
export function armHandoverForPrompt({ env, sessionId }) {
  if (!sessionId) return null;
  const sess = readSession(env, sessionId);
  if (sess.handoverPending) {
    writeSession(env, sessionId, { handoverPending: false, handoverActive: true });
    return HANDOVER_CONTEXT;
  }
  if (sess.handoverActive) writeSession(env, sessionId, { handoverActive: false });
  return null;
}
