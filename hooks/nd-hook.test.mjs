import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths, readProjectState } from '../core/state.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'nd-hook.mjs');

function scratch({ governed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nd-hook-'));
  const env = { ...process.env, XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  delete env.FM_TASK_ID; delete env.ND_EXEMPT; delete env.ND_WORKER; delete env.ND_HEADLESS;
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  if (governed) mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runHook(event, payload, env) {
  const out = execFileSync('node', [HOOK, event], { input: JSON.stringify(payload), env, encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : null;
}

test('PreToolUse denies a Tier 1 source Write and delivers the reason', () => {
  const s = scratch();
  try {
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Write', tool_input: { file_path: join(s.repo, 'src/x.mjs') } }, s.env);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /Tier 1/);
  } finally { s.cleanup(); }
});

test('PreToolUse allows a Read (no output)', () => {
  const s = scratch();
  try {
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Read', tool_input: { file_path: join(s.repo, 'x') } }, s.env);
    assert.equal(out, null);
  } finally { s.cleanup(); }
});

test('PreToolUse in a worker session (FM_TASK_ID) is a pass-through (no output)', () => {
  const s = scratch();
  try {
    const env = { ...s.env, FM_TASK_ID: 'crew-1' };
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Write', tool_input: { file_path: join(s.repo, 'src/x.mjs') } }, env);
    assert.equal(out, null, 'a firstmate-style worker must NOT be blocked');
  } finally { s.cleanup(); }
});

test('UserPromptSubmit /no-deceit:tier 2 is handled in-hook, blocks the prompt, and changes state', () => {
  const s = scratch();
  try {
    const out = runHook('UserPromptSubmit', { session_id: 's', cwd: s.repo, prompt: '/no-deceit:tier 2' }, s.env);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /Tier set to 2/);
    assert.equal(readProjectState(s.repo, s.env).tier, 2);
  } finally { s.cleanup(); }
});

test('UserPromptSubmit ordinary prompt injects tier/mode context', () => {
  const s = scratch();
  try {
    const out = runHook('UserPromptSubmit', { session_id: 's', cwd: s.repo, prompt: 'help me refactor' }, s.env);
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(out.hookSpecificOutput.additionalContext, /No Deceit is active/);
  } finally { s.cleanup(); }
});

test('SessionStart injects context and reports the gate armed', () => {
  const s = scratch();
  try {
    const out = runHook('SessionStart', { session_id: 's', cwd: s.repo, source: 'startup' }, s.env);
    assert.match(out.hookSpecificOutput.additionalContext, /No Deceit is active/);
    assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /FAILED its armed self-check/);
  } finally { s.cleanup(); }
});

test('SessionStart in an ungoverned repo stays silent', () => {
  const s = scratch({ governed: false });
  try {
    const out = runHook('SessionStart', { session_id: 's', cwd: s.repo, source: 'startup' }, s.env);
    assert.equal(out, null);
  } finally { s.cleanup(); }
});
