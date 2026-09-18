import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IDLE_CAP_MS,
  DEFAULT_WINDOW_MS,
  formatReport,
  parseReportArgs,
  suggestModesByDomain,
  summarizeLedger,
} from './report.mjs';

const NOW = Date.parse('2026-09-17T20:00:00.000Z');
const HOUR = 3_600_000;
const MIN = 60_000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function summarize(entries, extra = {}) {
  return summarizeLedger(entries, {
    nowMs: NOW,
    sinceMs: NOW - DEFAULT_WINDOW_MS,
    untilMs: NOW,
    idleCapMs: 24 * HOUR,
    ...extra,
  });
}

test('empty ledger yields zeros and an empty-window flag', () => {
  const s = summarize([]);
  assert.equal(s.empty, true);
  assert.equal(s.learningMs[1], 0);
  assert.equal(s.learningMs[2], 0);
  assert.equal(s.learningMs[3], 0);
  assert.equal(s.delegatedSessions, 0);
  assert.equal(s.unlocks.count, 0);
  assert.equal(s.checks.landed, 0);
  assert.equal(s.checks.not_landed, 0);
  assert.deepEqual(s.suggestions, []);
});

test('a single in-window event does not invent time-in-tier', () => {
  const s = summarize([
    { ts: iso(NOW - HOUR), event: 'denial', tier: 1 },
  ]);
  assert.equal(s.empty, false);
  assert.equal(s.learningMs[1], 0);
  assert.equal(s.learningMs[3], 0);
});

test('time-in-tier splits attended Tier 1/2 from Tier 3', () => {
  const s = summarize([
    { ts: iso(NOW - 4 * HOUR), event: 'tier_change', from: 1, to: 1, sessionId: 'att-1' },
    { ts: iso(NOW - 3 * HOUR), event: 'denial', tier: 1, sessionId: 'att-1' },
    { ts: iso(NOW - 3 * HOUR), event: 'tier_change', from: 1, to: 2, sessionId: 'att-1' },
    { ts: iso(NOW - 2 * HOUR), event: 'denial', tier: 2, sessionId: 'att-1' },
    { ts: iso(NOW - 2 * HOUR), event: 'tier_change', from: 2, to: 3, grant: true, sessionId: 'att-1' },
    { ts: iso(NOW - HOUR), event: 'denial', tier: 3, sessionId: 'att-1' },
  ]);
  assert.equal(s.learningMs[1], HOUR);
  assert.equal(s.learningMs[2], HOUR);
  assert.equal(s.learningMs[3], HOUR);
  assert.equal(s.learning12Ms, 2 * HOUR);
});

test('Delegated markers count sessions and never steal attended tier hours', () => {
  const s = summarize([
    { ts: iso(NOW - 3 * HOUR), event: 'tier_change', to: 1, sessionId: 'att-1' },
    { ts: iso(NOW - 2 * HOUR), event: 'denial', tier: 1, sessionId: 'att-1' },
    { ts: iso(NOW - 2 * HOUR), event: 'delegated', sessionId: 'crew-a', taskId: 'task-a' },
    { ts: iso(NOW - HOUR), event: 'delegated', sessionId: 'crew-b', taskId: 'task-b' },
    { ts: iso(NOW - HOUR), event: 'denial', tier: 1, sessionId: 'att-1' },
    { ts: iso(NOW - 30 * MIN), event: 'denial', tier: 1, sessionId: 'att-1' },
  ]);
  assert.equal(s.learningMs[1], 2 * HOUR + 30 * MIN);
  assert.equal(s.learningMs[3], 0);
  assert.equal(s.delegatedSessions, 2);
  assert.deepEqual(s.delegatedTaskIds, ['task-a', 'task-b']);
  assert.equal(s.delegatedMs, undefined);
});

test('interleaved attended sessions attribute time-in-tier per session', () => {
  const base = NOW - 3 * HOUR;
  const t = (m) => iso(base + m * MIN);
  const s = summarize([
    { ts: t(0), event: 'tier_change', to: 1, sessionId: 'att-a' },
    { ts: t(5), event: 'tier_change', to: 3, grant: true, sessionId: 'att-b' },
    { ts: t(10), event: 'denial', tier: 1, sessionId: 'att-a' },
    { ts: t(15), event: 'denial', tier: 3, sessionId: 'att-b' },
    { ts: t(20), event: 'denial', tier: 1, sessionId: 'att-a' },
    { ts: t(25), event: 'denial', tier: 3, sessionId: 'att-b' },
  ]);
  assert.equal(s.learningMs[1], 20 * MIN);
  assert.equal(s.learningMs[3], 20 * MIN);
  assert.equal(s.learning12Ms, 20 * MIN);
});

test('sessionless events never bridge into a fabricated tier span', () => {
  const s = summarize([
    { ts: iso(NOW - 3 * HOUR), event: 'check_grade', verdict: 'landed', task: 'parser' },
    { ts: iso(NOW - 3 * HOUR + 8 * MIN), event: 'check_grade', verdict: 'landed', task: 'heap' },
  ]);
  assert.equal(s.learningMs[1], 0);
  assert.equal(s.learningMs[2], 0);
  assert.equal(s.learningMs[3], 0);
  assert.equal(s.learning12Ms, 0);
});

test('events outside the window do not count toward unlocks or time', () => {
  const s = summarizeLedger([
    { ts: iso(NOW - DEFAULT_WINDOW_MS - HOUR), event: 'unlock_grade', verdict: 'unlocked', task: 'old' },
    { ts: iso(NOW - DEFAULT_WINDOW_MS - HOUR), event: 'check_grade', verdict: 'landed', task: 'old' },
    { ts: iso(NOW - HOUR), event: 'unlock_grade', verdict: 'not_yet', task: 'new' },
  ], { nowMs: NOW, sinceMs: NOW - DEFAULT_WINDOW_MS, untilMs: NOW, idleCapMs: 24 * HOUR });
  assert.equal(s.unlocks.count, 1);
  assert.equal(s.unlocks.unlocked, 0);
  assert.equal(s.unlocks.not_yet, 1);
  assert.equal(s.checks.landed, 0);
});

test('unlock count splits grader unlocked vs not_yet; checks split landed vs not_landed', () => {
  const s = summarize([
    { ts: iso(NOW - 4 * HOUR), event: 'unlock_grade', verdict: 'unlocked', task: 'parser' },
    { ts: iso(NOW - 3 * HOUR), event: 'unlock_grade', verdict: 'not_yet', task: 'heap' },
    { ts: iso(NOW - 2 * HOUR), event: 'unlock_override', reason: 'deadline' },
    { ts: iso(NOW - 90 * MIN), event: 'check_grade', verdict: 'landed', task: 'parser' },
    { ts: iso(NOW - 80 * MIN), event: 'check_grade', verdict: 'not_landed', task: 'heap' },
    { ts: iso(NOW - 70 * MIN), event: 'check_grade', verdict: 'partial', task: 'heap' },
  ]);
  assert.equal(s.unlocks.count, 2);
  assert.equal(s.unlocks.unlocked, 1);
  assert.equal(s.unlocks.not_yet, 1);
  assert.equal(s.unlocks.overrides, 1);
  assert.equal(s.checks.landed, 1);
  assert.equal(s.checks.not_landed, 1);
  assert.equal(s.checks.partial, 1);
});

test('Coach-domain misconceptions roll up by task', () => {
  const s = summarize([
    {
      ts: iso(NOW - HOUR), event: 'unlock_grade', verdict: 'unlocked', task: 'parser',
      error_class: 'conceptual', misconceptions: ['dotted pairs skip the cdr'],
    },
    {
      ts: iso(NOW - 50 * MIN), event: 'check_grade', verdict: 'not_landed', task: 'parser',
      error_class: 'conceptual', misconceptions: ['walker is iterative', 'dotted pairs skip the cdr'],
    },
    {
      ts: iso(NOW - 40 * MIN), event: 'check_grade', verdict: 'landed', task: 'css',
      error_class: 'slip', misconceptions: ['missed a semicolon'],
    },
  ]);
  assert.deepEqual(s.misconceptionsByDomain.parser, ['dotted pairs skip the cdr', 'walker is iterative']);
  assert.deepEqual(s.misconceptionsByDomain.css, ['missed a semicolon']);
});

test('gaps longer than the idle cap are not counted as time-in-tier', () => {
  const s = summarizeLedger([
    { ts: iso(NOW - 3 * HOUR), event: 'denial', tier: 1, sessionId: 'att-1' },
    { ts: iso(NOW - HOUR), event: 'denial', tier: 1, sessionId: 'att-1' },
  ], { nowMs: NOW, sinceMs: NOW - DEFAULT_WINDOW_MS, untilMs: NOW, idleCapMs: 30 * MIN });
  assert.equal(s.learningMs[1], 30 * MIN);
});

test('suggestModesByDomain: conceptual-heavy domain ⇒ Coach; slip-heavy ⇒ Pair; insufficient ⇒ none', () => {
  const suggestions = suggestModesByDomain([
    { task: 'parser', error_class: 'conceptual' },
    { task: 'parser', error_class: 'conceptual' },
    { task: 'parser', error_class: 'conceptual' },
    { task: 'css', error_class: 'slip' },
    { task: 'css', error_class: 'slip' },
    { task: 'css', error_class: 'slip' },
    { task: 'one-off', error_class: 'conceptual' },
    { task: 'tied', error_class: 'conceptual' },
    { task: 'tied', error_class: 'slip' },
  ]);
  const byDomain = Object.fromEntries(suggestions.map((x) => [x.domain, x.mode]));
  assert.equal(byDomain.parser, 'coach');
  assert.equal(byDomain.css, 'pair');
  assert.equal(byDomain['one-off'], undefined);
  assert.equal(byDomain.tied, undefined);
});

test('summarizeLedger surfaces per-domain suggestions from in-window error_class rows', () => {
  const s = summarize([
    { ts: iso(NOW - HOUR), event: 'unlock_grade', task: 'parser', error_class: 'conceptual', verdict: 'unlocked' },
    { ts: iso(NOW - 50 * MIN), event: 'check_grade', task: 'parser', error_class: 'conceptual', verdict: 'not_landed' },
    { ts: iso(NOW - 40 * MIN), event: 'check_grade', task: 'parser', error_class: 'conceptual', verdict: 'partial' },
  ]);
  assert.equal(s.suggestions.length, 1);
  assert.equal(s.suggestions[0].domain, 'parser');
  assert.equal(s.suggestions[0].mode, 'coach');
});

test('parseReportArgs defaults to a 7-day window ending at now', () => {
  const w = parseReportArgs([], NOW);
  assert.equal(w.untilMs, NOW);
  assert.equal(w.sinceMs, NOW - DEFAULT_WINDOW_MS);
});

test('parseReportArgs accepts --since/--until as relative durations and ISO dates', () => {
  const rel = parseReportArgs(['--since', '2d', '--until', '1d'], NOW);
  assert.equal(rel.sinceMs, NOW - 2 * 24 * HOUR);
  assert.equal(rel.untilMs, NOW - 24 * HOUR);
  const abs = parseReportArgs(['--since', '2026-09-10', '--until', '2026-09-17T20:00:00.000Z'], NOW);
  assert.equal(abs.sinceMs, Date.parse('2026-09-10T00:00:00.000Z'));
  assert.equal(abs.untilMs, NOW);
});

test('formatReport names the Delegated lane honestly and handles an empty ledger', () => {
  const empty = formatReport(summarize([]), { nowMs: NOW });
  assert.match(empty, /empty|nothing to summarise|no entries/i);
  assert.match(empty, /Delegated/i);

  const full = formatReport(summarize([
    { ts: iso(NOW - 2 * HOUR), event: 'tier_change', to: 1 },
    { ts: iso(NOW - HOUR), event: 'denial', tier: 1 },
    { ts: iso(NOW - HOUR), event: 'delegated', sessionId: 'crew-a', taskId: 'fm-1' },
    { ts: iso(NOW - 30 * MIN), event: 'delegated', sessionId: 'crew-b', taskId: 'fm-2' },
    {
      ts: iso(NOW - 20 * MIN), event: 'unlock_grade', verdict: 'unlocked', task: 'parser',
      error_class: 'conceptual', misconceptions: ['dotted pairs skip the cdr'],
    },
    { ts: iso(NOW - 10 * MIN), event: 'check_grade', verdict: 'landed', task: 'parser', error_class: 'conceptual' },
    { ts: iso(NOW - 5 * MIN), event: 'check_grade', verdict: 'not_landed', task: 'parser', error_class: 'conceptual' },
  ]), { nowMs: NOW });
  assert.match(full, /Tier 1\/2/);
  assert.match(full, /Tier 3/);
  assert.match(full, /Delegated/);
  assert.match(full, /no learning claimed/i);
  assert.match(full, /Unlocks:/);
  assert.match(full, /landed/);
  assert.match(full, /not.landed/i);
  assert.match(full, /parser/);
  assert.match(full, /dotted pairs skip the cdr/);
});

test('DEFAULT_IDLE_CAP_MS is a 30-minute honesty cap on sparse gaps', () => {
  assert.equal(DEFAULT_IDLE_CAP_MS, 30 * MIN);
});
