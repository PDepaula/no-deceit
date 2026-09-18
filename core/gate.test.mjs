import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, evaluateStop, evaluateDisplay, evaluatePostToolUse } from './gate.mjs';
import { projectPaths, writeProjectState, writeSession, homePaths } from './state.mjs';

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
    assert.equal(r.ledgerEntry, null);
  } finally { s.cleanup(); }
});

test('a worker session in an ungoverned repo does not ledger Delegated', () => {
  const s = scratch({ governed: false });
  try {
    const env = { ...s.env, FM_TASK_ID: 'crew-ungoverned' };
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.ledgerEntry, null);
  } finally { s.cleanup(); }
});

test('firstmate crewmate (FM_TASK_ID) is a pass-through even when opted in', () => {
  const s = scratch();
  try {
    const env = { ...s.env, FM_TASK_ID: 'some-task' };
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.governed, false);
    assert.equal(r.ledgerEntry && r.ledgerEntry.event, 'delegated');
    assert.equal(r.ledgerEntry.lane, 'delegated');
    assert.equal(r.ledgerEntry.taskId, 'some-task');
    const r2 = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env, sessionId: 's', nowMs: NOW });
    assert.equal(r2.decision, 'allow');
    assert.equal(r2.ledgerEntry, null, 'one delegated marker per session, not one per tool call');
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

test('Tier 1 governed: Agent is ask (not a silent allow)', () => {
  const s = scratch();
  try {
    const r = evaluate({ toolName: 'Agent', toolInput: { prompt: 'write the fix' }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'ask');
    assert.equal(r.category, 'F');
    assert.ok(r.ledgerEntry);
  } finally { s.cleanup(); }
});

test('worker exemption still pass-throughs Agent', () => {
  const s = scratch();
  try {
    const env = { ...s.env, FM_TASK_ID: 'crew-1' };
    const r = evaluate({ toolName: 'Agent', toolInput: {}, cwd: s.repo, env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.governed, false);
  } finally { s.cleanup(); }
});

const BIG_FENCE = '```js\n' + ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n') + '\n```';
const SMALL_FENCE = '```\nconst x = 1;\n```';
const NARRATED = '## What / why\nDoing the thing.\nDivergence from your first instinct: none';

test('evaluateStop: over-threshold fence at Tier 1 is a violation with a ledger entry', () => {
  const s = scratch();
  try {
    const r = evaluateStop({ text: BIG_FENCE, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'block');
    assert.equal(r.kind, 'chat_fence');
    assert.ok(r.ledgerEntry);
    assert.equal(r.ledgerEntry.event, 'violation');
  } finally { s.cleanup(); }
});

test('evaluateStop: small snippet at Tier 1 is allowed', () => {
  const s = scratch();
  try {
    const r = evaluateStop({ text: SMALL_FENCE, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
  } finally { s.cleanup(); }
});

test('evaluateStop: worker sessions are pass-through even with a big fence', () => {
  const s = scratch();
  try {
    const r = evaluateStop({ text: BIG_FENCE, cwd: s.repo, env: { ...s.env, FM_TASK_ID: 'crew-1' }, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.governed, false);
  } finally { s.cleanup(); }
});

test('evaluateStop: Tier 3 missing narration after an edit redirects', () => {
  const s = scratch();
  try {
    const { preambleFile } = projectPaths(s.repo);
    mkdirSync(join(preambleFile, '..'), { recursive: true });
    writeFileSync(preambleFile, 'Overview: ship it.\nFirst instinct: iterate in the REPL then wire it up.');
    writeSession(s.env, 's', { t3ExpiresAtMs: NOW + 60_000, turnEdited: true });
    const r = evaluateStop({ text: 'done.', cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'block');
    assert.equal(r.kind, 'narration_format');
    assert.equal(r.consumeTurnEdited, true);
  } finally { s.cleanup(); }
});

test('evaluateStop: Tier 3 present narration after an edit passes', () => {
  const s = scratch();
  try {
    const { preambleFile } = projectPaths(s.repo);
    mkdirSync(join(preambleFile, '..'), { recursive: true });
    writeFileSync(preambleFile, 'Overview: ship it.\nFirst instinct: iterate in the REPL then wire it up.');
    writeSession(s.env, 's', { t3ExpiresAtMs: NOW + 60_000, turnEdited: true });
    const r = evaluateStop({ text: NARRATED, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.consumeTurnEdited, true);
  } finally { s.cleanup(); }
});

test('evaluateDisplay: redacts over-threshold Tier 1 code', () => {
  const s = scratch();
  try {
    const r = evaluateDisplay({ text: BIG_FENCE, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.redact, true);
    assert.match(r.displayContent, /redacted/i);
  } finally { s.cleanup(); }
});

test('evaluateDisplay: ungoverned is a no-op', () => {
  const s = scratch({ governed: false });
  try {
    const r = evaluateDisplay({ text: BIG_FENCE, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.redact, false);
  } finally { s.cleanup(); }
});

test('evaluateDisplay: messageDisplayRedaction false leaves the text alone', () => {
  const s = scratch();
  try {
    const { configFile } = homePaths(s.env);
    mkdirSync(join(configFile, '..'), { recursive: true });
    writeFileSync(configFile, JSON.stringify({ messageDisplayRedaction: false }));
    const r = evaluateDisplay({ text: BIG_FENCE, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.redact, false);
  } finally { s.cleanup(); }
});

test('evaluatePostToolUse: file-mutating Bash with bashEditDiff source files is caught', () => {
  const s = scratch();
  try {
    const r = evaluatePostToolUse({
      toolName: 'Bash',
      toolInput: { command: 'python -c "open(\'src/x.py\',\'w\').write(\'x\')"' },
      toolResponse: { bashEditDiff: { changedFiles: [join(s.repo, 'src/x.py')] } },
      cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW,
    });
    assert.equal(r.decision, 'block');
    assert.ok(r.ledgerEntry);
    assert.equal(r.ledgerEntry.kind, 'bash_edit_diff');
  } finally { s.cleanup(); }
});

test('evaluatePostToolUse: a REPL/run command with no changed files is not caught', () => {
  const s = scratch();
  try {
    const r = evaluatePostToolUse({
      toolName: 'Bash',
      toolInput: { command: 'python -c "print(1+1)"' },
      toolResponse: { stdout: '2', stderr: '', interrupted: false, isImage: false },
      cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW,
    });
    assert.equal(r.decision, 'allow');
    assert.equal(r.markTurnEdited, false);
  } finally { s.cleanup(); }
});

test('evaluatePostToolUse: Write marks the turn as edited for the narration check', () => {
  const s = scratch();
  try {
    const r = evaluatePostToolUse({
      toolName: 'Write',
      toolInput: { file_path: join(s.repo, 'src/x.mjs') },
      toolResponse: { filePath: join(s.repo, 'src/x.mjs'), success: true },
      cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW,
    });
    assert.equal(r.decision, 'allow');
    assert.equal(r.markTurnEdited, true);
  } finally { s.cleanup(); }
});
