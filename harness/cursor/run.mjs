// Cursor preToolUse transport: read the hook JSON, call the shared core,
// print Cursor's decision object. Exit 0 always — Cursor reads the object,
// not the status (firstmate field note, cursor-agent 2026.08.11+).

import { FAIL_CLOSED_REASON } from '../../core/gate.mjs';
import { defaultEnv } from '../../core/state.mjs';
import { evaluateHarnessCall } from '../run.mjs';
import { renderCursor } from '../apply.mjs';

function failClosedObject() {
  return {
    permission: 'deny',
    user_message: FAIL_CLOSED_REASON,
    agent_message: FAIL_CLOSED_REASON,
  };
}

export function handleCursorPayload(input = {}, deps = {}) {
  const run = deps.evaluateHarnessCall || evaluateHarnessCall;
  const render = deps.renderCursor || renderCursor;
  try {
    const toolInput = input.tool_input || input.toolInput || {};
    const cwd = input.cwd
      || toolInput.working_directory
      || deps.cwd
      || process.cwd();
    const result = run({
      toolName: input.tool_name || input.toolName,
      toolInput,
      cwd,
      env: deps.env || defaultEnv(),
      sessionId: input.session_id || input.conversation_id,
    });
    return { object: render(result), exitCode: 0 };
  } catch {
    return { object: failClosedObject(), exitCode: 0 };
  }
}

function readAll(stdin) {
  return new Promise((resolve) => {
    if (!stdin || stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (c) => { data += c; });
    stdin.on('end', () => resolve(data));
  });
}

export async function runCursorHook({ stdin, stdout, env, cwd } = {}) {
  const raw = await readAll(stdin || process.stdin);
  const stripped = String(raw || '').replace(/^\uFEFF/, '').trim();
  let input;
  if (!stripped) {
    (stdout || process.stdout).write(JSON.stringify(failClosedObject()) + '\n');
    return;
  }
  try {
    input = JSON.parse(stripped);
  } catch {
    (stdout || process.stdout).write(JSON.stringify(failClosedObject()) + '\n');
    return;
  }
  const { object } = handleCursorPayload(input, { env, cwd });
  (stdout || process.stdout).write(JSON.stringify(object) + '\n');
}
