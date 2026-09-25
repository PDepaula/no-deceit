import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCommand, setTier, setMode, unlockOverride, renderStatus, renderStatusShort } from './control.mjs';
import { appendLedger, readProjectState, readSession, readLedger, projectPaths } from './state.mjs';

function scratch({ governed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nd-ctrl-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  if (governed) mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const NOW = 1_700_000_000_000;

// --- parseCommand (pure) ---
test('parses /no-deceit:tier 3', () => {
  assert.deepEqual(parseCommand('/no-deceit:tier 3'), { name: 'tier', arg: '3', body: '' });
});
test('parses /no-deceit:mode coach', () => {
  assert.deepEqual(parseCommand('/no-deceit:mode coach'), { name: 'mode', arg: 'coach', body: '' });
});
test('parses /no-deceit:status', () => {
  assert.deepEqual(parseCommand('  /no-deceit:status  '), { name: 'status', arg: '', body: '' });
});
test('parses /no-deceit:unlock with an override reason', () => {
  const r = parseCommand('/no-deceit:unlock --override "I know the fix, deadline"');
  assert.equal(r.name, 'unlock');
  assert.match(r.arg, /deadline/);
});
test('returns null for a non-command prompt', () => {
  assert.equal(parseCommand('please refactor my parser'), null);
});
test('returns null when the command is only mentioned mid-sentence', () => {
  assert.equal(parseCommand('should I run /no-deceit:tier 3 now?'), null);
});

// --- setTier ---
test('setTier 2 writes project tier and ledgers the change', () => {
  const s = scratch();
  try {
    setTier({ repoRoot: s.repo, env: s.env, sessionId: 's', tier: 2, nowMs: NOW });
    assert.equal(readProjectState(s.repo, s.env).tier, 2);
    assert.ok(readLedger(s.env, 10).some((e) => e.event === 'tier_change' && e.to === 2));
  } finally { s.cleanup(); }
});

test('setTier 3 creates a session grant with an expiry (not a project setting)', () => {
  const s = scratch();
  try {
    setTier({ repoRoot: s.repo, env: s.env, sessionId: 's', tier: 3, nowMs: NOW });
    // Project tier stays at the fallback, not 3.
    assert.notEqual(readProjectState(s.repo, s.env).tier, 3);
    const sess = readSession(s.env, 's');
    assert.ok(sess.t3ExpiresAtMs > NOW, 'grant expires in the future');
  } finally { s.cleanup(); }
});

test('setTier 3 from the shell CLI (no session id) writes a project-level grant', () => {
  const s = scratch();
  try {
    setTier({ repoRoot: s.repo, env: s.env, sessionId: null, tier: 3, nowMs: NOW });
    assert.ok(readProjectState(s.repo, s.env).t3ExpiresAtMs > NOW, 'project-level grant expires in the future');
  } finally { s.cleanup(); }
});

// --- setMode ---
test('setMode coach persists and ledgers', () => {
  const s = scratch();
  try {
    setMode({ repoRoot: s.repo, env: s.env, mode: 'coach', nowMs: NOW });
    assert.equal(readProjectState(s.repo, s.env).mode, 'coach');
    assert.ok(readLedger(s.env, 10).some((e) => e.event === 'mode_change' && e.to === 'coach'));
  } finally { s.cleanup(); }
});

// --- unlockOverride ---
test('unlockOverride requires a reason and records it to the ledger', () => {
  const s = scratch();
  try {
    setTier({ repoRoot: s.repo, env: s.env, sessionId: 's', tier: 2, nowMs: NOW });
    unlockOverride({ repoRoot: s.repo, env: s.env, reason: 'deadline, I know the approach', nowMs: NOW });
    assert.equal(readProjectState(s.repo, s.env).unlocked, true);
    const led = readLedger(s.env, 10).find((e) => e.event === 'unlock_override');
    assert.ok(led);
    assert.match(led.reason, /deadline/);
  } finally { s.cleanup(); }
});

test('unlockOverride throws when no reason is given', () => {
  const s = scratch();
  try {
    assert.throws(() => unlockOverride({ repoRoot: s.repo, env: s.env, reason: '', nowMs: NOW }), /reason/i);
  } finally { s.cleanup(); }
});

// --- status rendering ---
test('renderStatusShort shows tier and mode compactly', () => {
  const s = scratch();
  try {
    setTier({ repoRoot: s.repo, env: s.env, sessionId: 's', tier: 2, nowMs: NOW });
    setMode({ repoRoot: s.repo, env: s.env, mode: 'coach', nowMs: NOW });
    assert.match(renderStatusShort({ repoRoot: s.repo, env: s.env, sessionId: 's', nowMs: NOW }), /\[ND T2.*coach/);
  } finally { s.cleanup(); }
});

test('renderStatus reports ungoverned when there is no .no-deceit', () => {
  const s = scratch({ governed: false });
  try {
    assert.match(renderStatus({ repoRoot: s.repo, env: s.env, sessionId: 's', nowMs: NOW }), /not governed|ungoverned/i);
  } finally { s.cleanup(); }
});

test('renderStatus suggests Coach for a conceptual-heavy domain (suggestion only)', () => {
  const s = scratch();
  try {
    setMode({ repoRoot: s.repo, env: s.env, mode: 'ask', nowMs: NOW });
    for (let i = 0; i < 3; i++) {
      appendLedger(s.env, { event: 'check_grade', task: 'parser', error_class: 'conceptual', verdict: 'not_landed' });
    }
    const text = renderStatus({ repoRoot: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.match(text, /Suggested mode/);
    assert.match(text, /parser/);
    assert.match(text, /coach/i);
  } finally { s.cleanup(); }
});
