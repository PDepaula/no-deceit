// Pi extension body. The .ts entry re-exports a wired factory; tests call
// this with an env seam so they do not need Pi installed.

import { FAIL_CLOSED_REASON } from '../../core/gate.mjs';
import { evaluateHarnessCall } from '../run.mjs';
import { applyPi } from '../apply.mjs';

export function createPiExtension(deps = {}) {
  const run = deps.evaluateHarnessCall || evaluateHarnessCall;
  const apply = deps.applyPi || applyPi;
  const env = deps.env;

  return function noDeceit(pi) {
    pi.on('tool_call', (event, ctx) => {
      try {
        const result = run({
          toolName: event && event.toolName,
          toolInput: (event && event.input) || {},
          cwd: (ctx && ctx.cwd) || deps.cwd || process.cwd(),
          env: env || process.env,
          sessionId: (ctx && (ctx.sessionId || ctx.sessionID)) || undefined,
        });
        return apply(result);
      } catch {
        return { block: true, reason: FAIL_CLOSED_REASON };
      }
    });
  };
}
