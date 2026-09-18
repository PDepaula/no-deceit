import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../core/state.mjs';
import { handleCursorPayload } from './cursor/run.mjs';

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), 'cursor', 'hooks.json');

function scratch({ governed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nd-cur-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  delete env.FM_TASK_ID; delete env.ND_EXEMPT; delete env.ND_WORKER; delete env.ND_HEADLESS;
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  if (governed) mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('Cursor payload at Tier 1 Write emits permission deny on stdout object', () => {
  const s = scratch();
  try {
    const { object, exitCode } = handleCursorPayload({
      tool_name: 'Write',
      tool_input: { path: join(s.repo, 'src/x.mjs'), contents: 'x' },
      cwd: s.repo,
      session_id: 's',
    }, { env: s.env });
    assert.equal(exitCode, 0);
    assert.equal(object.permission, 'deny');
    assert.match(object.agent_message, /Tier 1/);
    assert.equal(object.user_message, object.agent_message);
  } finally { s.cleanup(); }
});

test('Cursor payload for Read emits permission allow', () => {
  const s = scratch();
  try {
    const { object, exitCode } = handleCursorPayload({
      tool_name: 'Read',
      tool_input: { path: join(s.repo, 'src/x.mjs') },
      cwd: s.repo,
      session_id: 's',
    }, { env: s.env });
    assert.equal(exitCode, 0);
    assert.equal(object.permission, 'allow');
  } finally { s.cleanup(); }
});

test('Cursor Shell source redirect at Tier 1 is denied', () => {
  const s = scratch();
  try {
    const { object } = handleCursorPayload({
      tool_name: 'Shell',
      tool_input: { command: `echo x > ${join(s.repo, 'src/x.mjs')}` },
      cwd: s.repo,
      session_id: 's',
    }, { env: s.env });
    assert.equal(object.permission, 'deny');
  } finally { s.cleanup(); }
});

test('Cursor Task at Tier 1 emits permission ask (not enforced by Cursor preToolUse)', () => {
  const s = scratch();
  try {
    const { object } = handleCursorPayload({
      tool_name: 'Task',
      tool_input: { prompt: 'fix it' },
      cwd: s.repo,
      session_id: 's',
    }, { env: s.env });
    assert.equal(object.permission, 'ask');
    assert.match(object.agent_message, /subagent|delegat/i);
  } finally { s.cleanup(); }
});

test('Cursor worker session is a pass-through allow', () => {
  const s = scratch();
  try {
    const { object } = handleCursorPayload({
      tool_name: 'Write',
      tool_input: { path: join(s.repo, 'src/x.mjs') },
      cwd: s.repo,
      session_id: 's',
    }, { env: { ...s.env, FM_TASK_ID: 'crew-1' } });
    assert.equal(object.permission, 'allow');
  } finally { s.cleanup(); }
});

test('malformed Cursor evaluation fail-closes to deny, exit 0', () => {
  const s = scratch();
  try {
    const { object, exitCode } = handleCursorPayload({
      tool_name: 'Write',
      tool_input: { path: join(s.repo, 'src/x.mjs') },
      cwd: s.repo,
    }, {
      env: s.env,
      evaluateHarnessCall: () => { throw new Error('boom'); },
    });
    assert.equal(exitCode, 0);
    assert.equal(object.permission, 'deny');
    assert.match(object.agent_message, /fail-closed|gate error/i);
  } finally { s.cleanup(); }
});

test('adapters/cursor/hooks.json registers preToolUse → nd --cursor failClosed', () => {
  const cfg = JSON.parse(readFileSync(HOOKS, 'utf8'));
  assert.equal(cfg.version, 1);
  const hooks = cfg.hooks.preToolUse;
  assert.ok(Array.isArray(hooks) && hooks.length >= 1);
  const hit = hooks.find((h) => String(h.command).includes('--cursor'));
  assert.ok(hit, 'preToolUse must invoke nd --cursor');
  assert.equal(hit.failClosed, true);
});
