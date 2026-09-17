import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRun, aggregateRuns, isUpgrade, formatAuditReport } from './audit.mjs';

const items = [
  { id: 'a', gold_verdict: 'not_yet' },
  { id: 'b', gold_verdict: 'unlocked' },
  { id: 'c', gold_verdict: 'not_landed' },
];

test('isUpgrade: unlocked over not_yet is graded_up; the reverse is not', () => {
  assert.equal(isUpgrade('not_yet', 'unlocked'), true);
  assert.equal(isUpgrade('unlocked', 'not_yet'), false);
  assert.equal(isUpgrade('not_yet', 'not_yet'), false);
  assert.equal(isUpgrade('not_landed', 'landed'), true);
  assert.equal(isUpgrade('partial', 'landed'), true);
  assert.equal(isUpgrade('landed', 'partial'), false);
});

test('scoreRun counts graded_up ids', () => {
  const s = scoreRun(items, {
    a: { verdict: 'unlocked' }, // up
    b: { verdict: 'unlocked' },
    c: { verdict: 'not_landed' },
  });
  assert.equal(s.graded_up, 1);
  assert.deepEqual(s.graded_up_ids, ['a']);
});

test('aggregateRuns gate blocks when graded_up > 0', () => {
  const runs = [
    scoreRun(items, { a: { verdict: 'not_yet' }, b: { verdict: 'unlocked' }, c: { verdict: 'not_landed' } }),
    scoreRun(items, { a: { verdict: 'unlocked' }, b: { verdict: 'unlocked' }, c: { verdict: 'not_landed' } }),
    scoreRun(items, { a: { verdict: 'not_yet' }, b: { verdict: 'unlocked' }, c: { verdict: 'not_landed' } }),
  ];
  const agg = aggregateRuns(runs);
  assert.equal(agg.graded_up, 1);
  assert.equal(agg.pass, false);
  assert.match(formatAuditReport(agg, runs), /gate: block/);
});

test('aggregateRuns gate passes only when graded_up = 0 across runs', () => {
  const obs = { a: { verdict: 'not_yet' }, b: { verdict: 'unlocked' }, c: { verdict: 'not_landed' } };
  const runs = [scoreRun(items, obs), scoreRun(items, obs), scoreRun(items, obs)];
  const agg = aggregateRuns(runs);
  assert.equal(agg.graded_up, 0);
  assert.equal(agg.pass, true);
  assert.match(formatAuditReport(agg, runs), /gate: pass/);
});
