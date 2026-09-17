// No Deceit — control operations (the human's two forge-proof channels).
//
// Tier and mode change ONLY through: (1) the developer's own prompt commands,
// handled in the UserPromptSubmit hook; (2) the `nd` CLI in the developer's
// own shell. Both funnel through these functions. The model can forge neither:
// UserPromptSubmit sees the user's literal text (never model output), and the
// PreToolUse gate denies any tool call that invokes a mutating `nd`
// subcommand or touches the state paths (category G).

import { isGoverned, readProjectState, writeProjectState, readSession, writeSession, appendLedger, loadConfig, projectPaths } from './state.mjs';
import { resolveEffective } from './policy.mjs';
import { preamblePresent } from './state.mjs';

const MODES = ['coach', 'pair', 'ask'];

/**
 * Parse a control command out of a prompt. Pure.
 * Recognises only a line that STARTS with `/no-deceit:` (after trimming), so a
 * mid-sentence mention is not a command. Returns { name, arg } or null.
 */
export function parseCommand(promptText) {
  if (typeof promptText !== 'string') return null;
  const line = promptText.trim();
  const m = /^\/no-deceit:([a-z]+)\b(.*)$/.exec(line);
  if (!m) return null;
  return { name: m[1], arg: m[2].trim() };
}

export function setTier({ repoRoot, env, sessionId, tier, nowMs = Date.now() }) {
  const n = Number(tier);
  if (![1, 2, 3].includes(n)) throw new Error(`invalid tier: ${tier}`);
  const before = readProjectState(repoRoot, env);

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
  writeProjectState(repoRoot, { ...rest, tier: n });
  if (sessionId) writeSession(env, sessionId, { t3ExpiresAtMs: null });
  appendLedger(env, { event: 'tier_change', from: before.tier, to: n, sessionId: sessionId || null });
  return `Tier set to ${n}.`;
}

export function setMode({ repoRoot, env, mode, nowMs = Date.now() }) {
  if (!MODES.includes(mode)) throw new Error(`invalid mode: ${mode} (use coach|pair|ask)`);
  const before = readProjectState(repoRoot, env);
  writeProjectState(repoRoot, { ...before, mode });
  appendLedger(env, { event: 'mode_change', from: before.mode, to: mode });
  return `Mode set to ${mode}.`;
}

export function unlockOverride({ repoRoot, env, reason, nowMs = Date.now() }) {
  if (!reason || !String(reason).trim()) {
    throw new Error('unlock override requires a typed reason (this is written to the ledger; honesty, not prohibition)');
  }
  const before = readProjectState(repoRoot, env);
  writeProjectState(repoRoot, { ...before, unlocked: true });
  appendLedger(env, { event: 'unlock_override', tier: before.tier, reason: String(reason).trim() });
  return `Tier 2 unlocked by override. Recorded to the ledger: "${String(reason).trim()}".`;
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
  if (e.tier === 2) lines.push(`  Unlock: ${e.t2Unlocked ? 'unlocked (override)' : 'locked'}`);
  if (e.tier === 3) lines.push(`  Preamble: ${e.t3PreamblePresent ? 'present' : 'MISSING (source writes blocked until filled)'}`);
  for (const n of e.notes) lines.push(`  Note:  ${n}`);
  return lines.join('\n');
}
