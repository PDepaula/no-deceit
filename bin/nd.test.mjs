import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths, readProjectState } from '../core/state.mjs';

const ND = join(dirname(fileURLToPath(import.meta.url)), 'nd');

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'nd-cli-'));
  const env = { ...process.env, XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  delete env.CLAUDECODE; delete env.CURSOR_AGENT; delete env.PI_CODING_AGENT;
  delete env.FM_TASK_ID; delete env.ND_ALLOW_AGENT;
  return { dir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
// Each subcommand runs with cwd=dir; dir is not a git repo, so gitToplevel falls back to cwd.
function run(args, env, cwd, expectFail = false) {
  try {
    return { out: execFileSync('node', [ND, ...args], { env, cwd, encoding: 'utf8' }), code: 0 };
  } catch (e) {
    if (!expectFail) throw e;
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status };
  }
}

test('nd init opts the project in and nd tier persists', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    assert.ok(existsSync(projectPaths(s.dir).dir));
    run(['tier', '2'], s.env, s.dir);
    assert.equal(readProjectState(s.dir, s.env).tier, 2);
  } finally { s.cleanup(); }
});

test('nd refuses a mutating subcommand inside an agent shell (CLAUDECODE)', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    const env = { ...s.env, CLAUDECODE: '1' };
    const r = run(['tier', '3'], env, s.dir, true);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /refusing to run a state-changing/);
    // Tier unchanged.
    assert.notEqual(readProjectState(s.dir, s.env).tier, 3);
  } finally { s.cleanup(); }
});

test('nd check is refused inside an agent shell (tutor cannot spawn the grader)', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    const r = run(['check', 'heap'], { ...s.env, CLAUDECODE: '1' }, s.dir, true);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /refusing to run a state-changing/);
  } finally { s.cleanup(); }
});

test('nd audit --oracle reports graded_up 0 and exits 0', () => {
  const s = scratch();
  try {
    const r = run(['audit', '--oracle'], s.env, s.dir);
    assert.match(r.out, /graded_up: 0/);
    assert.match(r.out, /gate: pass/);
  } finally { s.cleanup(); }
});

test('nd audit --inflate reports graded_up > 0 and the gate blocks', () => {
  const s = scratch();
  try {
    const r = run(['audit', '--inflate'], s.env, s.dir, true);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /graded_up: [1-9]/);
    assert.match(r.out, /gate: block/);
  } finally { s.cleanup(); }
});

test('nd audit is allowed inside an agent shell (read-only release gate)', () => {
  const s = scratch();
  try {
    const r = run(['audit', '--oracle'], { ...s.env, CLAUDECODE: '1' }, s.dir);
    assert.match(r.out, /gate: pass/);
  } finally { s.cleanup(); }
});

test('nd unlock --override still unlocks from the developer shell', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    const r = run(['unlock', '--override', 'deadline, I know the approach'], s.env, s.dir);
    assert.match(r.out, /override/);
    assert.equal(readProjectState(s.dir, s.env).unlocked, true);
  } finally { s.cleanup(); }
});

test('nd status (read-only) is allowed inside an agent shell', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    const env = { ...s.env, CLAUDECODE: '1' };
    const r = run(['status'], env, s.dir);
    assert.match(r.out, /governed/);
  } finally { s.cleanup(); }
});

test('nd refuses a mutating subcommand inside a Cursor agent shell', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    const r = run(['tier', '3'], { ...s.env, CURSOR_AGENT: '1' }, s.dir, true);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /refusing to run a state-changing/);
  } finally { s.cleanup(); }
});

test('nd refuses a mutating subcommand inside a Pi agent shell', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    const r = run(['tier', '3'], { ...s.env, PI_CODING_AGENT: 'true' }, s.dir, true);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /refusing to run a state-changing/);
  } finally { s.cleanup(); }
});

test('nd --cursor prints a deny object and exits 0 for a Tier 1 Write', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { path: join(s.dir, 'src/x.mjs'), contents: 'x' },
      cwd: s.dir,
      session_id: 's',
    });
    const out = execFileSync('node', [ND, '--cursor'], {
      env: s.env, cwd: s.dir, encoding: 'utf8', input: payload,
    });
    const obj = JSON.parse(out);
    assert.equal(obj.permission, 'deny');
    assert.match(obj.agent_message, /Tier 1/);
  } finally { s.cleanup(); }
});

test('nd --cursor prints permission allow for a Read', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    const payload = JSON.stringify({
      tool_name: 'Read',
      tool_input: { path: join(s.dir, 'src/x.mjs') },
      cwd: s.dir,
      session_id: 's',
    });
    const out = execFileSync('node', [ND, '--cursor'], {
      env: s.env, cwd: s.dir, encoding: 'utf8', input: payload,
    });
    assert.equal(JSON.parse(out).permission, 'allow');
  } finally { s.cleanup(); }
});
