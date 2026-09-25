// Shared imperative shell for harness adapters: map the tool call, call the
// unchanged core evaluate(), append the ledger. No per-harness policy.

import { evaluate } from '../core/gate.mjs';
import { appendLedger, gitToplevel } from '../core/state.mjs';
import { mapTool } from './map-tool.mjs';

export function evaluateHarnessCall(input) {
  const mapped = mapTool(input.toolName, input.toolInput);
  const cwd = input.cwd;
  const repoRoot = input.repoRoot || gitToplevel(cwd);
  const result = evaluate({
    toolName: mapped.toolName,
    toolInput: mapped.toolInput,
    cwd: repoRoot,
    env: input.env,
    sessionId: input.sessionId,
    nowMs: input.nowMs,
  });
  if (result.ledgerEntry) {
    try { appendLedger(input.env, result.ledgerEntry); } catch { /* never fail the gate on a ledger write */ }
  }
  return result;
}
