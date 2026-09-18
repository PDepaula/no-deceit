// OpenCode plugin body. The .ts entry re-exports a wired factory; tests
// call this with an env seam so they do not need OpenCode installed.

import { FAIL_CLOSED_REASON } from '../../core/gate.mjs';
import { evaluateHarnessCall } from '../run.mjs';
import { applyOpenCode } from '../apply.mjs';

export function createOpenCodePlugin(deps = {}) {
  const run = deps.evaluateHarnessCall || evaluateHarnessCall;
  const apply = deps.applyOpenCode || applyOpenCode;
  const env = deps.env;

  return async function NoDeceit({ directory, worktree }) {
    const cwd = worktree || directory;
    return {
      'tool.execute.before': async (input, output) => {
        let result;
        try {
          result = run({
            toolName: input && input.tool,
            toolInput: (output && output.args) || {},
            cwd,
            env: env || process.env,
            sessionId: (input && (input.sessionID || input.sessionId)) || undefined,
          });
        } catch {
          throw new Error(FAIL_CLOSED_REASON);
        }
        apply(result);
      },
    };
  };
}
