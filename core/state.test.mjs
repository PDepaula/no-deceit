import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULTS,
  loadConfig,
  readProjectState,
  writeProjectState,
  readSession,
  writeSession,
  preamblePresent,
  appendLedger,
  readLedger,
  projectPaths,
  homePaths,
} from './state.mjs';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'nd-state-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('loadConfig returns built-in defaults when no config file exists', () => {
  const s = scratch();
  try {
    const cfg = loadConfig(s.env);
    assert.equal(cfg.tier, DEFAULTS.tier);
    assert.equal(cfg.mode, DEFAULTS.mode);
    assert.ok(Array.isArray(cfg.testGlobs) && cfg.testGlobs.length > 0);
  } finally { s.cleanup(); }
});

test('loadConfig merges a user config file over defaults', () => {
  const s = scratch();
  try {
    const { configFile } = homePaths(s.env);
    mkdirSync(join(configFile, '..'), { recursive: true });
    writeFileSync(configFile, JSON.stringify({ mode: 'coach', t3TimeboxMinutes: 30 }));
    const cfg = loadConfig(s.env);
    assert.equal(cfg.mode, 'coach');
    assert.equal(cfg.t3TimeboxMinutes, 30);
    assert.equal(cfg.tier, DEFAULTS.tier); // untouched default preserved
  } finally { s.cleanup(); }
});

test('readProjectState returns defaults when no state file exists', () => {
  const s = scratch();
  try {
    const st = readProjectState(s.repo, s.env);
    assert.equal(st.tier, 1);
    assert.equal(st.unlocked, false);
  } finally { s.cleanup(); }
});

test('project state round-trips through disk', () => {
  const s = scratch();
  try {
    mkdirSync(projectPaths(s.repo).dir, { recursive: true });
    writeProjectState(s.repo, { tier: 2, mode: 'coach', unlocked: true });
    const st = readProjectState(s.repo, s.env);
    assert.equal(st.tier, 2);
    assert.equal(st.mode, 'coach');
    assert.equal(st.unlocked, true);
  } finally { s.cleanup(); }
});

test('session state round-trips including a Tier 3 expiry', () => {
  const s = scratch();
  try {
    writeSession(s.env, 'sess-1', { t3ExpiresAtMs: 123456789 });
    const sess = readSession(s.env, 'sess-1');
    assert.equal(sess.t3ExpiresAtMs, 123456789);
  } finally { s.cleanup(); }
});

test('preamblePresent is false when the file is missing, true when non-trivial', () => {
  const s = scratch();
  try {
    assert.equal(preamblePresent(s.repo, s.env), false);
    const { preambleFile } = projectPaths(s.repo);
    mkdirSync(join(preambleFile, '..'), { recursive: true });
    writeFileSync(preambleFile, 'tiny');
    assert.equal(preamblePresent(s.repo, s.env), false); // below min length
    writeFileSync(preambleFile, 'Overview: build the gate.\nFirst instinct: intercept the tool call in a PreToolUse hook.');
    assert.equal(preamblePresent(s.repo, s.env), true);
  } finally { s.cleanup(); }
});

test('ledger appends JSONL lines with a timestamp and reads them back', () => {
  const s = scratch();
  try {
    appendLedger(s.env, { event: 'tier_change', from: 1, to: 2 });
    appendLedger(s.env, { event: 'denial', category: 'E', tier: 1 });
    const lines = readLedger(s.env, 10);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].event, 'tier_change');
    assert.equal(lines[1].event, 'denial');
    assert.ok(lines[0].ts, 'entry has a timestamp');
  } finally { s.cleanup(); }
});
