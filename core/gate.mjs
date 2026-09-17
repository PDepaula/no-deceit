// No Deceit — gate orchestrator.
//
// The single entry point the hook shim (and the `nd` CLI's self-check) calls.
// It ties together the pure core (scope, classify, resolve, decide) with the
// state I/O, and — critically — wraps EVERYTHING in a fail-closed try/catch:
// any internal error becomes an explicit deny with a clear reason, never a
// bare non-zero exit that the harness might treat as a pass.

import { classify as realClassify } from './classify.mjs';
import { resolveEffective as realResolve, decide as realDecide } from './policy.mjs';
import { scopeDecision as realScope } from './scope.mjs';
import {
  loadConfig, isGoverned, readProjectState, readSession, preamblePresent, buildClassifyCfg,
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
      return { decision: 'allow', reason: null, category: null, governed: false, scopeReason: scope.reason, effective: null, ledgerEntry: null };
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
