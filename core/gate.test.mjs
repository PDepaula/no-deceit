import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate } from './gate.mjs';
import { projectPaths, writeProjectState, writeSession } from './state.mjs';

function scratch({ governed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nd-gate-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  if (governed) mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const NOW = 1_700_000_000_000;

test('ungoverned project is a pass-through allow', () => {
  const s = scratch({ governed: false });
  try {
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.governed, false);
  } finally { s.cleanup(); }
});

test('firstmate crewmate (FM_TASK_ID) is a pass-through even when opted in', () => {
  const s = scratch();
  try {
    const env = { ...s.env, FM_TASK_ID: 'some-task' };
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.governed, false);
  } finally { s.cleanup(); }
});

test('Tier 1 governed: writing source is denied', () => {
  const s = scratch();
  try {
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'deny');
    assert.equal(r.category, 'E');
    assert.ok(r.ledgerEntry, 'a denial produces a ledger entry');
  } finally { s.cleanup(); }
});

test('Tier 1 governed: reading is allowed', () => {
  const s = scratch();
  try {
    const r = evaluate({ toolName: 'Read', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
  } finally { s.cleanup(); }
});

test('Tier 1 governed: running tests is allowed (REPL/run loop stays open)', () => {
  const s = scratch();
  try {
    const r = evaluate({ toolName: 'Bash', toolInput: { command: 'pytest -q' }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.category, 'B');
  } finally { s.cleanup(); }
});

test('Tier 2 override-unlocked: source still denied, reason is the show-they-type one', () => {
  const s = scratch();
  try {
    writeProjectState(s.repo, { tier: 2, mode: 'coach', unlocked: true });
    const r = evaluate({ toolName: 'Edit', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'deny');
    assert.match(r.reason, /developer types/i);
  } finally { s.cleanup(); }
});

test('Tier 3 granted with preamble: source is allowed', () => {
  const s = scratch();
  try {
    const { preambleFile } = projectPaths(s.repo);
    mkdirSync(join(preambleFile, '..'), { recursive: true });
    writeFileSync(preambleFile, 'Overview: build the thing.\nFirst instinct: iterate in the REPL then wire it up.');
    writeSession(s.env, 's', { t3ExpiresAtMs: NOW + 60_000 });
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.effective.tier, 3);
  } finally { s.cleanup(); }
});

test('Tier 3 granted WITHOUT preamble: source is denied', () => {
  const s = scratch();
  try {
    writeSession(s.env, 's', { t3ExpiresAtMs: NOW + 60_000 });
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'deny');
    assert.match(r.reason, /preamble/i);
  } finally { s.cleanup(); }
});

test('expired Tier 3 grant falls back to project tier and denies source', () => {
  const s = scratch();
  try {
    writeProjectState(s.repo, { tier: 1, mode: 'coach' });
    writeSession(s.env, 's', { t3ExpiresAtMs: NOW - 1 });
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'deny');
    assert.equal(r.effective.tier, 1);
  } finally { s.cleanup(); }
});

test('tamper: writing the state file is denied at any tier', () => {
  const s = scratch();
  try {
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: projectPaths(s.repo).stateFile }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'deny');
    assert.equal(r.category, 'G');
  } finally { s.cleanup(); }
});

test('tamper: a mutating nd subcommand via Bash is denied', () => {
  const s = scratch();
  try {
    const r = evaluate({ toolName: 'Bash', toolInput: { command: 'nd tier 3' }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'deny');
    assert.equal(r.category, 'G');
  } finally { s.cleanup(); }
});

test('fail-closed: an internal error yields an explicit deny, not a silent allow', () => {
  const s = scratch();
  try {
    const boom = () => { throw new Error('kaboom'); };
    const r = evaluate(
      { toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW },
      { classify: boom },
    );
    assert.equal(r.decision, 'deny');
    assert.match(r.reason, /fail.?closed|error/i);
  } finally { s.cleanup(); }
});
