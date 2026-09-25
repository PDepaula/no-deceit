// No Deceit — gate orchestrator.
//
// The single entry point the hook shim (and the `nd` CLI's self-check) calls.
// It ties together the pure core (scope, classify, resolve, decide) with the
// state I/O, and — critically — wraps EVERYTHING in a fail-closed try/catch:
// any internal error becomes an explicit deny with a clear reason, never a
// bare non-zero exit that the harness might treat as a pass.

import { classify as realClassify } from './classify.mjs';
import {
  resolveEffective as realResolve,
  decide as realDecide,
  decideTextChannel,
  decideDisplay,
  decideBashEditDiff,
  chatTextGated,
} from './policy.mjs';
import { scopeDecision as realScope } from './scope.mjs';
import { leakedSourceWrites, parseChangedFiles } from './tripwire.mjs';
import { basename } from 'node:path';
import {
  loadConfig, isGoverned, readProjectState, readSession, writeSession, preamblePresent, buildClassifyCfg,
} from './state.mjs';

export const FAIL_CLOSED_REASON =
  'No Deceit gate error: the gate could not evaluate this call, so it is ' +
  'denied (fail-closed) rather than silently allowed. Tell the developer the ' +
  'gate hit an internal error; do not treat this as permission to proceed.';

/**
 * evaluate(input, deps?) -> {
 *   decision, reason, category, governed, scopeReason, effective, ledgerEntry
 * }
 * input: { toolName, toolInput, cwd, env, sessionId, nowMs }
 * deps:  test seams for the pure functions (default to the real ones).
 */
export function evaluate(input, deps = {}) {
  const {
    classify = realClassify,
    resolveEffective = realResolve,
    decide = realDecide,
    scopeDecision = realScope,
  } = deps;
  const { toolName, toolInput = {}, cwd, env = process.env, sessionId, nowMs = Date.now() } = input;

  try {
    const repoRoot = input.repoRoot || cwd;

    // Step 0: scope. Ungoverned or worker/headless => pass-through no-op.
    const governed = isGoverned(repoRoot);
    const scope = scopeDecision({ hasNoDeceitDir: governed, env });
    if (!scope.inScope) {
      // Still a pass-through allow (no enforcement). Opted-in worker/headless
      // sessions get one Delegated ledger marker so Phase 5 can name that lane
      // honestly; ungoverned repos stay silent. Logging must never fail-close
      // an exempt session.
      let ledgerEntry = null;
      try {
        if (governed && String(scope.reason).startsWith('exempt')) {
          const delegatedKey = sessionId || env.FM_TASK_ID || env.ND_WORKER || env.ND_EXEMPT || env.ND_HEADLESS || 'worker';
          const sess = readSession(env, delegatedKey);
          if (!sess.delegatedLogged) {
            writeSession(env, delegatedKey, { delegatedLogged: true });
            ledgerEntry = {
              event: 'delegated',
              lane: 'delegated',
              sessionId: sessionId || null,
              taskId: env.FM_TASK_ID || null,
              reason: scope.reason,
            };
          }
        }
      } catch { /* never wedge a worker on a ledger marker */ }
      return { decision: 'allow', reason: null, category: null, governed: false, scopeReason: scope.reason, effective: null, ledgerEntry };
    }

    const config = loadConfig(env);
    const project = readProjectState(repoRoot, env);
    const session = readSession(env, sessionId);
    const effective = resolveEffective({ project, session, preamblePresent: preamblePresent(repoRoot, env), nowMs });

    const cfg = buildClassifyCfg(config, repoRoot, env);
    const category = classify(toolName, toolInput, cfg);
    const { decision, reason } = decide(effective, { category });

    let ledgerEntry = null;
    if (decision === 'deny' || decision === 'ask') {
      ledgerEntry = {
        event: decision === 'deny' ? 'denial' : 'ask',
        tier: effective.tier,
        mode: effective.mode,
        category,
        tool: toolName,
        target: toolInput.file_path || toolInput.notebook_path || toolInput.command || null,
        sessionId: sessionId || null,
      };
    }

    return { decision, reason, category, governed: true, scopeReason: scope.reason, effective, ledgerEntry };
  } catch (err) {
    // Fail closed: an error is a deny, and it is recorded.
    return {
      decision: 'deny',
      reason: FAIL_CLOSED_REASON,
      category: null,
      governed: true,
      scopeReason: 'error',
      effective: null,
      ledgerEntry: { event: 'gate_error', error: String(err && err.message || err), tool: input.toolName || null },
    };
  }
}

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function passThrough(scopeReason) {
  return {
    decision: 'allow',
    reason: null,
    kind: null,
    governed: false,
    scopeReason,
    effective: null,
    ledgerEntry: null,
    redact: false,
    displayContent: null,
    markTurnEdited: false,
    consumeTurnEdited: false,
  };
}

function loadContext(input, scopeDecision) {
  const env = input.env || process.env;
  const repoRoot = input.repoRoot || input.cwd;
  const governed = isGoverned(repoRoot);
  const scope = scopeDecision({ hasNoDeceitDir: governed, env });
  if (!scope.inScope) return { inScope: false, scope, repoRoot, env };
  const nowMs = input.nowMs ?? Date.now();
  const config = loadConfig(env);
  const project = readProjectState(repoRoot, env);
  const session = readSession(env, input.sessionId);
  const effective = realResolve({
    project,
    session,
    preamblePresent: preamblePresent(repoRoot, env),
    nowMs,
  });
  return { inScope: true, scope, repoRoot, env, config, project, session, effective };
}

/**
 * Stop-hook evaluation: fence check (T1 / locked T2) and Tier 3 narration format.
 */
export function evaluateStop(input, deps = {}) {
  const { scopeDecision = realScope } = deps;
  try {
    const ctx = loadContext(input, scopeDecision);
    if (!ctx.inScope) return passThrough(ctx.scope.reason);
    const { effective, config, session } = ctx;
    const r = decideTextChannel(effective, {
      text: input.text || '',
      stopHookActive: Boolean(input.stopHookActive),
      turnEdited: Boolean(session.turnEdited),
      maxFenceLines: config.tier1MaxFenceLines,
      handoverActive: Boolean(session.handoverActive),
      projectNouns: [...(config.projectNouns || []), basename(ctx.repoRoot || '')],
    });
    let ledgerEntry = null;
    if (r.decision === 'block') {
      ledgerEntry = {
        event: 'violation',
        kind: r.kind,
        tier: effective.tier,
        mode: effective.mode,
        sessionId: input.sessionId || null,
      };
    } else if (r.labelled && chatTextGated(effective)) {
      // A labelled handover the developer did not (necessarily) ask for is
      // still ledgered, so `nd report` and the offline audit can count it.
      ledgerEntry = {
        event: 'handing_over',
        authorized: Boolean(session.handoverActive),
        tier: effective.tier,
        mode: effective.mode,
        sessionId: input.sessionId || null,
      };
    }
    return {
      ...r,
      governed: true,
      scopeReason: ctx.scope.reason,
      effective,
      ledgerEntry,
      consumeTurnEdited: Boolean(session.turnEdited),
      // The relaxed turn ends at the first Stop that is not blocked (a block
      // retries the same turn, so it must stay armed).
      consumeHandover: Boolean(session.handoverActive) && r.decision !== 'block',
    };
  } catch (err) {
    return {
      decision: 'block',
      reason: FAIL_CLOSED_REASON,
      kind: null,
      governed: true,
      scopeReason: 'error',
      effective: null,
      ledgerEntry: { event: 'gate_error', error: String((err && err.message) || err) },
      consumeTurnEdited: false,
    };
  }
}

/**
 * MessageDisplay evaluation. Fail-open: a broken redaction must not hide the
 * original (and cannot block anyway).
 */
export function evaluateDisplay(input, deps = {}) {
  const { scopeDecision = realScope } = deps;
  try {
    const ctx = loadContext(input, scopeDecision);
    if (!ctx.inScope) return passThrough(ctx.scope.reason);
    const r = decideDisplay(ctx.effective, {
      text: input.text || '',
      redactionEnabled: ctx.config.messageDisplayRedaction !== false,
      maxFenceLines: ctx.config.tier1MaxFenceLines,
      handoverActive: Boolean(ctx.session.handoverActive),
    });
    return { ...r, governed: true, scopeReason: ctx.scope.reason, effective: ctx.effective, ledgerEntry: r.redact ? { event: 'redaction', kind: r.kind || 'chat_fence', tier: ctx.effective.tier, sessionId: input.sessionId || null } : null };
  } catch {
    return { redact: false, displayContent: null, governed: true, scopeReason: 'error', ledgerEntry: null };
  }
}

/**
 * PostToolUse evaluation: mark the turn as edited, and trip the bashEditDiff
 * detective when a Bash command wrote category-E source.
 */
export function evaluatePostToolUse(input, deps = {}) {
  const { scopeDecision = realScope } = deps;
  try {
    const ctx = loadContext(input, scopeDecision);
    if (!ctx.inScope) return passThrough(ctx.scope.reason);
    const toolName = input.toolName;
    let markTurnEdited = EDIT_TOOLS.has(toolName);

    if (toolName !== 'Bash') {
      return {
        decision: 'allow',
        reason: null,
        kind: null,
        governed: true,
        scopeReason: ctx.scope.reason,
        effective: ctx.effective,
        ledgerEntry: null,
        markTurnEdited,
        leaked: [],
      };
    }

    const classifyCfg = {
      ...buildClassifyCfg(ctx.config, ctx.repoRoot, ctx.env),
      tripwireIgnoreGlobs: ctx.config.tripwireIgnoreGlobs || [],
    };
    const leaked = leakedSourceWrites(parseChangedFiles(input.toolResponse), classifyCfg);
    const r = decideBashEditDiff(ctx.effective, { leaked });
    let ledgerEntry = null;
    if (r.decision === 'block') {
      markTurnEdited = true;
      ledgerEntry = {
        event: 'violation',
        kind: 'bash_edit_diff',
        tier: ctx.effective.tier,
        mode: ctx.effective.mode,
        tool: 'Bash',
        target: (input.toolInput && input.toolInput.command) || null,
        files: leaked.map((x) => x.file),
        sessionId: input.sessionId || null,
      };
    }
    return {
      ...r,
      governed: true,
      scopeReason: ctx.scope.reason,
      effective: ctx.effective,
      ledgerEntry,
      markTurnEdited,
      leaked,
    };
  } catch (err) {
    return {
      decision: 'block',
      reason: FAIL_CLOSED_REASON,
      kind: null,
      governed: true,
      scopeReason: 'error',
      effective: null,
      ledgerEntry: { event: 'gate_error', error: String((err && err.message) || err), tool: input.toolName || null },
      markTurnEdited: false,
      leaked: [],
    };
  }
}
