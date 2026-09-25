import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHandover, armHandoverForPrompt, parseHandoverArgs, parseCommand, setTier, HANDOVER_CONTEXT } from './control.mjs';
import { evaluate, evaluateStop, evaluateDisplay } from './gate.mjs';
import { writeSession as writeSessionSync, projectPaths, writeProjectState, readSession, readAllLedger, readProjectState, DEFAULTS } from './state.mjs';
import { summarizeLedger, formatReport } from './report.mjs';

const NOW = 1_700_000_000_000;
const LONG = 'The orders table mixes header and line data, so every read of a single order fans out across duplicated rows and the join runs on every query instead of once at load time, which is why it is slow and stale-prone. '.repeat(2);
const DIAGRAM_ANSWER = 'Here.\n```mermaid\ngraph TD\n  a-->b\n```\nHanding over: the flow';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'nd-ho-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  const repo = join(dir, 'repo');
  mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('R1: default tier is 2, for config, absent state, and an explicit state file', () => {
  const s = scratch();
  try {
    assert.equal(DEFAULTS.tier, 2);
    assert.equal(readProjectState(s.repo, s.env).tier, 2);
    writeProjectState(s.repo, { tier: 1, mode: 'ask' });
    assert.equal(readProjectState(s.repo, s.env).tier, 1, 'an explicit Tier 1 is honoured');
  } finally { s.cleanup(); }
});

test('a governed project with no state file is Tier 2 locked at the gate', () => {
  const s = scratch();
  try {
    const r = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/x.mjs') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(r.effective.tier, 2);
    assert.equal(r.decision, 'deny');
    const d = evaluate({ toolName: 'Write', toolInput: { file_path: join(s.repo, 'docs/flow.mmd') }, cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW });
    assert.equal(d.category, 'H');
    assert.equal(d.decision, 'deny');
    assert.equal(d.ledgerEntry.category, 'H');
  } finally { s.cleanup(); }
});

test('parse: /no-deceit:handover with and without args', () => {
  assert.deepEqual(parseCommand('/no-deceit:handover stuck on joins'), { name: 'handover', arg: 'stuck on joins', body: '' });
  assert.deepEqual(parseHandoverArgs('--domain etl stuck on joins'), { domain: 'etl', reason: 'stuck on joins' });
  assert.deepEqual(parseHandoverArgs(''), { domain: null, reason: null });
});

test('handover: ledgers an event, arms one turn, relaxes Stop and Display, then re-arms the gate', () => {
  const s = scratch();
  try {
    const sid = 'sess-1';
    const msg = startHandover({ repoRoot: s.repo, env: s.env, sessionId: sid, arg: '--domain etl need the answer', nowMs: NOW });
    assert.match(msg, /Handover recorded for etl \(1 in the last 7 days\)/);
    const led = readAllLedger(s.env).find((e) => e.event === 'handover');
    assert.equal(led.domain, 'etl');
    assert.equal(led.reason, 'need the answer');
    assert.equal(led.tier, 2);
    assert.equal(led.sessionId, sid);

    // Not armed until the next (non-command) prompt.
    assert.equal(evaluateStop({ text: DIAGRAM_ANSWER, cwd: s.repo, env: s.env, sessionId: sid, nowMs: NOW }).decision, 'block');

    assert.equal(armHandoverForPrompt({ env: s.env, sessionId: sid }), HANDOVER_CONTEXT);
    assert.equal(readSession(s.env, sid).handoverActive, true);

    const disp = evaluateDisplay({ text: DIAGRAM_ANSWER, cwd: s.repo, env: s.env, sessionId: sid, nowMs: NOW });
    assert.equal(disp.redact, false);

    const stop = evaluateStop({ text: DIAGRAM_ANSWER, cwd: s.repo, env: s.env, sessionId: sid, nowMs: NOW });
    assert.equal(stop.decision, 'allow');
    assert.equal(stop.consumeHandover, true);
    assert.equal(stop.ledgerEntry.event, 'handing_over');
    assert.equal(stop.ledgerEntry.authorized, true);

    // An unlabelled reply on the handover turn is blocked, and stays armed for the retry.
    const bare = evaluateStop({ text: LONG, cwd: s.repo, env: s.env, sessionId: sid, nowMs: NOW });
    assert.equal(bare.kind, 'handover_unlabelled');
    assert.equal(bare.consumeHandover, false);
  } finally { s.cleanup(); }
});

test('handover: after consumption the next turn is gated again', () => {
  const s = scratch();
  try {
    const sid = 'sess-2';
    startHandover({ repoRoot: s.repo, env: s.env, sessionId: sid, arg: '', nowMs: NOW });
    armHandoverForPrompt({ env: s.env, sessionId: sid });
    // Simulate the hook consuming the flag after an allowed Stop.
    writeSessionSync(s.env, sid, { handoverActive: false });
    assert.equal(armHandoverForPrompt({ env: s.env, sessionId: sid }), null);
    assert.equal(evaluateStop({ text: LONG, cwd: s.repo, env: s.env, sessionId: sid, nowMs: NOW }).kind, 'question_ending');
  } finally { s.cleanup(); }
});

test('handover: a stale armed flag with nothing pending is cleared on the next prompt', () => {
  const s = scratch();
  try {
    writeSessionSync(s.env, 'sess-3', { handoverActive: true, handoverPending: false });
    assert.equal(armHandoverForPrompt({ env: s.env, sessionId: 'sess-3' }), null);
    assert.equal(readSession(s.env, 'sess-3').handoverActive, false);
  } finally { s.cleanup(); }
});

test('handover at an ungated tier records nothing', () => {
  const s = scratch();
  try {
    writeProjectState(s.repo, { tier: 2, mode: 'ask', unlocked: true });
    const msg = startHandover({ repoRoot: s.repo, env: s.env, sessionId: 'x', arg: '', nowMs: NOW });
    assert.match(msg, /already open/);
    assert.equal(readAllLedger(s.env).filter((e) => e.event === 'handover').length, 0);
  } finally { s.cleanup(); }
});

test('handover: no session means no record (forge-proof channel needs the prompt hook)', () => {
  const s = scratch();
  try {
    assert.match(startHandover({ repoRoot: s.repo, env: s.env, sessionId: null, arg: '', nowMs: NOW }), /needs a session/);
    assert.equal(readAllLedger(s.env).length, 0);
  } finally { s.cleanup(); }
});

test('a worker session is never wedged by the new text-channel rules', () => {
  const s = scratch();
  try {
    const r = evaluateStop({ text: LONG, cwd: s.repo, env: { ...s.env, FM_TASK_ID: 'crew' }, sessionId: 's', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.governed, false);
  } finally { s.cleanup(); }
});

test('labelled turn without a typed handover is ledgered as unauthorized handing_over', () => {
  const s = scratch();
  try {
    const r = evaluateStop({ text: LONG + '\nHanding over: the split', cwd: s.repo, env: s.env, sessionId: 'z', nowMs: NOW });
    assert.equal(r.decision, 'allow');
    assert.equal(r.ledgerEntry.event, 'handing_over');
    assert.equal(r.ledgerEntry.authorized, false);
  } finally { s.cleanup(); }
});

test('report: handover lines per domain, labelled count, and the streak note', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const H = 3_600_000;
  const rows = [
    { ts: iso(NOW - 5 * H), event: 'handover', domain: 'data-modeling', tier: 2, sessionId: 'a' },
    { ts: iso(NOW - 4 * H), event: 'handover', domain: 'data-modeling', tier: 2, sessionId: 'a' },
    { ts: iso(NOW - 3 * H), event: 'handover', domain: 'data-modeling', tier: 2, sessionId: 'a' },
    { ts: iso(NOW - 2 * H), event: 'handover', domain: 'etl', tier: 1, sessionId: 'a' },
    { ts: iso(NOW - 2 * H), event: 'handing_over', authorized: true, tier: 2, sessionId: 'a' },
    { ts: iso(NOW - 1 * H), event: 'handing_over', authorized: false, tier: 2, sessionId: 'a' },
  ];
  const sum = summarizeLedger(rows, { sinceMs: NOW - 24 * H, untilMs: NOW, nowMs: NOW });
  assert.equal(sum.handovers.total, 4);
  assert.deepEqual(sum.handovers.byDomain, { 'data-modeling': 3, etl: 1 });
  const text = formatReport(sum);
  assert.match(text, /Handovers: 4 \(data-modeling 3, etl 1\)/);
  assert.match(text, /Labelled `Handing over:` turns: 2 \(1 without a typed/);
  assert.match(text, /data-modeling: 3 handovers this window/);
  assert.doesNotMatch(text, /etl: 1 handovers this window/);
});

test('report: no handovers prints Handovers: 0', () => {
  const sum = summarizeLedger([{ ts: new Date(NOW - 1000).toISOString(), event: 'denial', tier: 1, sessionId: 'a' }], { sinceMs: NOW - 86_400_000, untilMs: NOW, nowMs: NOW });
  assert.match(formatReport(sum), /Handovers: 0/);
});

test('setTier still works and the agent cannot forge handover state (state paths are G)', async () => {
  const { classify } = await import('./classify.mjs');
  const cfg = { statePathPrefixes: ['/h/.local/state/no-deceit'] };
  assert.equal(classify('Write', { file_path: '/h/.local/state/no-deceit/sessions/s.json', content: '{}' }, cfg), 'G');
  assert.equal(typeof setTier, 'function');
});
