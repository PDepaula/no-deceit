#!/usr/bin/env node
// No Deceit — Claude Code hook shim.
//
// One entry point for every event; the event name is argv[2]. Reads the hook
// payload as JSON on stdin, calls the tested core, and prints the Claude Code
// hook-output JSON. It is deliberately thin: all policy lives in ../core.
//
// Fail-closed: on PreToolUse, ANY error becomes an explicit `deny` decision,
// never a bare non-zero exit that the harness might treat as a pass.

import { evaluate, evaluateStop, evaluateDisplay, evaluatePostToolUse } from '../core/gate.mjs';
import { decide, REASONS } from '../core/policy.mjs';
import { appendLedger, gitToplevel, isGoverned, readProjectState, writeProjectState, writeSession } from '../core/state.mjs';
import { parseCommand, setTier, setMode, renderStatus, renderStatusShort, startHandover, armHandoverForPrompt } from '../core/control.mjs';
import { parseUnlockArgs, parseCheckArgs, parseGradeArgs } from '../core/unlock-args.mjs';
import { runUnlock, runCheck, runGrade } from '../core/grader.mjs';
import { captureTeach } from '../core/evidence-io.mjs';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    // If nothing is piped, don't hang forever.
    if (process.stdin.isTTY) resolve('');
  });
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function contextFacts(repoRoot, env, sessionId, { consumeNote = false } = {}) {
  const badge = renderStatusShort({ repoRoot, env, sessionId });
  const status = renderStatus({ repoRoot, env, sessionId });
  let extra = '';
  if (isGoverned(repoRoot)) {
    const project = readProjectState(repoRoot, env);
    if (project.pendingTutorNote) {
      extra += `\n${project.pendingTutorNote}`;
      if (consumeNote) writeProjectState(repoRoot, { ...project, pendingTutorNote: null });
    } else if (project.lastDiagnosis && project.lastDiagnosis.error_class) {
      extra += `\nGrader diagnosis: ${project.lastDiagnosis.error_class}; misconceptions: ${(project.lastDiagnosis.misconceptions || []).join('; ') || '(none)'}.`;
    }
  }
  return (
    `No Deceit is active in this project. ${badge}\n` +
    `${status}\n` +
    `Your tier is stored outside this conversation and you cannot change it — ` +
    `tier and mode change only through the developer's own /no-deceit: prompt ` +
    `commands or their own \`nd\` shell CLI. A denied tool call is the system ` +
    `working as intended; do not route around it. You never spawn the grader.` +
    extra
  );
}

/** Armed self-check: prove the policy core loaded and denies a Tier 1 source write. */
function armedSelfCheck() {
  try {
    const r = decide(
      { tier: 1, mode: 'coach', t2Unlocked: false, t3Active: false, t3PreamblePresent: false, notes: [] },
      { category: 'E' },
    );
    if (r.decision === 'deny' && r.reason === REASONS.T1) return { armed: true };
    return { armed: false, why: 'policy core returned an unexpected decision' };
  } catch (err) {
    return { armed: false, why: String((err && err.message) || err) };
  }
}

async function main() {
  const event = process.argv[2];
  const raw = await readStdin();
  let input = {};
  try { input = raw ? JSON.parse(raw) : {}; } catch { input = {}; }
  const env = process.env;

  if (event === 'PreToolUse') {
    let result;
    try {
      const repoRoot = gitToplevel(input.cwd || process.cwd());
      result = evaluate({
        toolName: input.tool_name,
        toolInput: input.tool_input || {},
        cwd: repoRoot,
        env,
        sessionId: input.session_id,
      });
    } catch (err) {
      result = { decision: 'deny', reason: `No Deceit gate error (fail-closed): ${String((err && err.message) || err)}`, ledgerEntry: { event: 'gate_error', error: String(err) } };
    }
    if (result.ledgerEntry) { try { appendLedger(env, result.ledgerEntry); } catch { /* never fail the gate on a ledger write */ } }
    if (result.decision === 'allow') return; // no output == allow
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision, // 'deny' | 'ask'
        permissionDecisionReason: result.reason,
      },
    });
    return;
  }

  if (event === 'SessionStart') {
    const repoRoot = gitToplevel(input.cwd || process.cwd());
    if (!isGoverned(repoRoot)) return; // ungoverned: stay silent
    const check = armedSelfCheck();
    let context = contextFacts(repoRoot, env, input.session_id);
    if (!check.armed) {
      context =
        `WARNING: the No Deceit gate FAILED its armed self-check (${check.why}). ` +
        `The enforcement gate may not be blocking. Tell the developer loudly; ` +
        `do not assume tier rules are enforced.\n\n` + context;
    }
    emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
    return;
  }

  if (event === 'UserPromptSubmit') {
    const repoRoot = gitToplevel(input.cwd || process.cwd());
    const cmd = parseCommand(input.prompt || '');
    if (cmd) {
      let message;
      try {
        if (cmd.name === 'tier') {
          message = setTier({ repoRoot, env, sessionId: input.session_id, tier: cmd.arg });
        } else if (cmd.name === 'mode') {
          message = setMode({ repoRoot, env, sessionId: input.session_id, mode: cmd.arg });
        } else if (cmd.name === 'unlock') {
          const args = parseUnlockArgs(cmd.arg);
          message = await runUnlock({ repoRoot, env, sessionId: input.session_id, ...args });
        } else if (cmd.name === 'check') {
          const args = parseCheckArgs(cmd.arg);
          message = await runCheck({ repoRoot, env, sessionId: input.session_id, task: args.task, project: args.project });
        } else if (cmd.name === 'teach') {
          // The teach-back is evidence: capture it to the data home and block the
          // prompt, so the tutor never sees it before the blind grader does.
          message = captureTeach({ env, sessionId: input.session_id, arg: cmd.arg, body: cmd.body });
        } else if (cmd.name === 'grade') {
          message = await runGrade({ repoRoot, env, sessionId: input.session_id, ...parseGradeArgs(cmd.arg) });
        } else if (cmd.name === 'handover') {
          message = startHandover({ repoRoot, env, sessionId: input.session_id, arg: cmd.arg });
        } else if (cmd.name === 'status') {
          message = renderStatus({ repoRoot, env, sessionId: input.session_id });
        } else {
          message = `Unknown No Deceit command: ${cmd.name}. Try tier, mode, unlock, check, teach, grade, handover, or status.`;
        }
      } catch (err) {
        message = `No Deceit: ${String((err && err.message) || err)}`;
      }
      // Block the prompt: it is a control command, handled by the hook, and
      // must not be executed by the model. The reason is shown to the developer.
      emit({ decision: 'block', reason: `[No Deceit] ${message}` });
      return;
    }
    // Not a command: inject the current tier/mode as context, when governed.
    if (isGoverned(repoRoot)) {
      let handover = null;
      try { handover = armHandoverForPrompt({ env, sessionId: input.session_id }); } catch { /* never wedge a prompt on session I/O */ }
      emit({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: contextFacts(repoRoot, env, input.session_id, { consumeNote: true }) + (handover ? `\n${handover}` : '') } });
    }
    return;
  }

  if (event === 'Stop') {
    let result;
    try {
      const repoRoot = gitToplevel(input.cwd || process.cwd());
      result = evaluateStop({
        text: input.last_assistant_message || '',
        stopHookActive: Boolean(input.stop_hook_active),
        cwd: repoRoot,
        env,
        sessionId: input.session_id,
      });
    } catch (err) {
      result = { decision: 'block', reason: `No Deceit gate error (fail-closed): ${String((err && err.message) || err)}`, ledgerEntry: { event: 'gate_error', error: String(err) } };
    }
    if ((result.consumeTurnEdited || result.consumeHandover) && input.session_id) {
      try {
        writeSession(env, input.session_id, {
          ...(result.consumeTurnEdited ? { turnEdited: false } : {}),
          ...(result.consumeHandover ? { handoverActive: false } : {}),
        });
      } catch { /* never fail the gate on session I/O */ }
    }
    if (result.ledgerEntry) { try { appendLedger(env, result.ledgerEntry); } catch { /* never fail the gate on a ledger write */ } }
    if (result.decision === 'block') {
      emit({ decision: 'block', reason: result.reason });
    }
    return;
  }

  if (event === 'MessageDisplay') {
    const delta = input.delta || '';
    if (!delta) return;
    let result;
    try {
      const repoRoot = gitToplevel(input.cwd || process.cwd());
      result = evaluateDisplay({
        text: delta,
        cwd: repoRoot,
        env,
        sessionId: input.session_id,
      });
    } catch {
      return; // fail-open: show the original
    }
    if (result.redact && result.displayContent != null) {
      emit({ hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: result.displayContent } });
    }
    return;
  }

  if (event === 'PostToolUse') {
    let result;
    try {
      const repoRoot = gitToplevel(input.cwd || process.cwd());
      result = evaluatePostToolUse({
        toolName: input.tool_name,
        toolInput: input.tool_input || {},
        toolResponse: input.tool_response || {},
        cwd: repoRoot,
        env,
        sessionId: input.session_id,
      });
    } catch (err) {
      result = { decision: 'block', reason: `No Deceit gate error (fail-closed): ${String((err && err.message) || err)}`, ledgerEntry: { event: 'gate_error', error: String(err) } };
    }
    if (result.markTurnEdited && input.session_id) {
      try { writeSession(env, input.session_id, { turnEdited: true }); } catch { /* never fail the gate on session I/O */ }
    }
    if (result.ledgerEntry) { try { appendLedger(env, result.ledgerEntry); } catch { /* never fail the gate on a ledger write */ } }
    if (result.decision === 'block') {
      emit({ decision: 'block', reason: result.reason });
    }
    return;
  }

  // Unknown event: no-op.
}

main().catch((err) => {
  // Absolute last resort. For a PreToolUse this still fails closed via exit 2.
  if (process.argv[2] === 'PreToolUse') {
    process.stderr.write(`No Deceit gate crashed (fail-closed deny): ${String((err && err.message) || err)}`);
    process.exit(2);
  }
  process.exit(0);
});
