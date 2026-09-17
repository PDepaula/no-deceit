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
  delete env.CLAUDECODE; delete env.FM_TASK_ID; delete env.ND_ALLOW_AGENT;
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

test('nd status (read-only) is allowed inside an agent shell', () => {
  const s = scratch();
  try {
    run(['init'], s.env, s.dir);
    const env = { ...s.env, CLAUDECODE: '1' };
    const r = run(['status'], env, s.dir);
    assert.match(r.out, /governed/);
  } finally { s.cleanup(); }
});
