import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectPaths, readProjectState, readLedger, writeProjectState } from './state.mjs';
import { ITEMS } from '../gold/unlock-gold.mjs';
import {
  gradeUnlockAttempt,
  runUnlock,
  runCheck,
  runAudit,
  withTimeout,
} from './grader.mjs';
import { parseUnlockArgs } from './unlock-args.mjs';
import { scoreRun, aggregateRuns } from './audit.mjs';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'nd-grader-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  const repo = join(dir, 'repo');
  mkdirSync(projectPaths(repo).dir, { recursive: true });
  mkdirSync(projectPaths(repo).attemptsDir, { recursive: true });
  mkdirSync(projectPaths(repo).verdictsDir, { recursive: true });
  mkdirSync(projectPaths(repo).checksDir, { recursive: true });
  writeProjectState(repo, { tier: 2, mode: 'coach', unlocked: false });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function passingMentalInvoke() {
  return async () => ({
    verdict: 'unlocked',
    criteria: {
      R1: { met: true, span: 'cons-recurse on list cells' },
      R2: { met: true, span: 'returns nil' },
      R3: { met: true, span: 'I think dotted pairs skip the cdr walk' },
      R4: { met: true, span: 'Tried quoting' },
    },
    error_class: 'conceptual',
    misconceptions: ['dotted pairs are lists'],
    next_smaller_question: 'What does the walker do when the cdr is not a list?',
    rubric_gap: [],
  });
}

test('parseUnlockArgs reads override, appeal, git, files, since, and task', () => {
  assert.deepEqual(parseUnlockArgs('--override "deadline now"'), {
    task: 'default', override: 'deadline now', appeal: false, git: false, files: [], since: null,
  });
  const r = parseUnlockArgs('parser --git --files src/a.js,src/b.js --since abc');
  assert.equal(r.task, 'parser');
  assert.equal(r.git, true);
  assert.deepEqual(r.files, ['src/a.js', 'src/b.js']);
  assert.equal(r.since, 'abc');
  assert.equal(parseUnlockArgs('--appeal').appeal, true);
});

test('prefilter reject does not call the LLM', async () => {
  let called = 0;
  const r = await gradeUnlockAttempt({
    route: 'mental-model',
    evidenceText: 'idk it just doesn\'t work',
    invoke: async () => { called++; return {}; },
  });
  assert.equal(called, 0);
  assert.equal(r.verdict, 'not_yet');
  assert.equal(r.source, 'prefilter');
});

test('ambiguous / torn evidence yields not_yet, not unlocked', async () => {
  const r = await gradeUnlockAttempt({
    route: 'mental-model',
    evidenceText: 'The walker is supposed to cons-recurse on list cells. It returns nil on `(a . b)` because I think dotted pairs skip the cdr walk — the failing REPL result was nil, not a pair. Tried quoting; same result.',
    invoke: async () => ({
      torn: true,
      verdict: 'unlocked',
      criteria: {
        R1: { met: true, span: 'cons-recurse' },
        R2: { met: true, span: 'nil' },
        R3: { met: true, span: 'I think dotted pairs skip the cdr walk' },
        R4: { met: true, span: 'quoting' },
      },
    }),
  });
  assert.equal(r.verdict, 'not_yet');
});

test('invoke is given a blind job with no tutoring dialogue', async () => {
  let seen;
  await gradeUnlockAttempt({
    route: 'mental-model',
    evidenceText: 'The walker is supposed to cons-recurse on list cells. It returns nil on `(a . b)` because I think dotted pairs skip the cdr walk — the failing REPL result was nil. Tried quoting.',
    dialogue: 'Tutor: have you thought about recursion? Learner: sort of.',
    transcript: 'lots of chat',
    invoke: async (ctx) => {
      seen = ctx;
      return passingMentalInvoke()();
    },
  });
  assert.ok(seen.job);
  assert.equal('dialogue' in seen.job, false);
  assert.equal('transcript' in seen.job, false);
  assert.equal('conversation' in seen.job, false);
  assert.ok(seen.job.evidencePath);
});

test('grader timeout defaults to not_yet', async () => {
  const r = await gradeUnlockAttempt({
    route: 'mental-model',
    evidenceText: 'The walker is supposed to cons-recurse on list cells. It returns nil on `(a . b)` because I think dotted pairs skip the cdr walk — the failing REPL result was nil. Tried quoting.',
    timeoutMs: 20,
    invoke: async () => new Promise((resolve) => setTimeout(resolve, 500, { verdict: 'unlocked' })),
  });
  assert.equal(r.verdict, 'not_yet');
  assert.equal(r.source, 'timeout');
});

test('grader throw defaults to not_yet', async () => {
  const r = await gradeUnlockAttempt({
    route: 'mental-model',
    evidenceText: 'The walker is supposed to cons-recurse on list cells. It returns nil on `(a . b)` because I think dotted pairs skip the cdr walk — the failing REPL result was nil. Tried quoting.',
    invoke: async () => { throw new Error('boom'); },
  });
  assert.equal(r.verdict, 'not_yet');
  assert.equal(r.source, 'grader_failure');
});

test('withTimeout rejects after the budget', async () => {
  await assert.rejects(
    () => withTimeout(new Promise((r) => setTimeout(r, 100, 'x')), 10),
    /timeout/i,
  );
});

test('runUnlock override unlocks and ledgers the typed reason', async () => {
  const s = scratch();
  try {
    const msg = await runUnlock({
      repoRoot: s.repo, env: s.env, override: 'deadline; I know the approach',
    });
    assert.match(msg, /override/i);
    assert.equal(readProjectState(s.repo, s.env).unlocked, true);
    const led = readLedger(s.env, 20).find((e) => e.event === 'unlock_override');
    assert.match(led.reason, /deadline/);
  } finally { s.cleanup(); }
});

test('runUnlock grades a mental-model file, writes a verdict, and ledgers', async () => {
  const s = scratch();
  try {
    writeFileSync(
      join(projectPaths(s.repo).attemptsDir, 'parser.md'),
      'The walker is supposed to cons-recurse on list cells. It returns nil on `(a . b)` because I think dotted pairs skip the cdr walk — the failing REPL result was nil. Tried quoting.',
    );
    const msg = await runUnlock({
      repoRoot: s.repo, env: s.env, task: 'parser', invoke: passingMentalInvoke(),
    });
    assert.match(msg, /unlocked/i);
    assert.equal(readProjectState(s.repo, s.env).unlocked, true);
    const verdict = JSON.parse(readFileSync(join(projectPaths(s.repo).verdictsDir, 'parser.json'), 'utf8'));
    assert.equal(verdict.verdict, 'unlocked');
    assert.ok(readLedger(s.env, 20).some((e) => e.event === 'unlock_grade' && e.verdict === 'unlocked'));
  } finally { s.cleanup(); }
});

test('one appeal per verdict is enforced; a second appeal is refused', async () => {
  const s = scratch();
  try {
    writeFileSync(
      join(projectPaths(s.repo).attemptsDir, 'default.md'),
      'The walker is supposed to cons-recurse on list cells. It returns nil on `(a . b)` because I think dotted pairs skip the cdr walk — the failing REPL result was nil. Tried quoting.',
    );
    await runUnlock({
      repoRoot: s.repo, env: s.env, invoke: async () => ({
        verdict: 'not_yet',
        criteria: {
          R1: { met: true, span: 'cons-recurse' },
          R2: { met: false, span: null },
          R3: { met: false, span: null },
          R4: { met: false, span: null },
        },
        next_smaller_question: 'Where does the cdr walk run?',
      }),
    });
    assert.equal(readProjectState(s.repo, s.env).unlocked, false);
    await runUnlock({ repoRoot: s.repo, env: s.env, appeal: true, invoke: passingMentalInvoke() });
    assert.equal(readProjectState(s.repo, s.env).unlocked, true);
    assert.ok(readLedger(s.env, 20).some((e) => e.event === 'unlock_appeal'));
    await assert.rejects(
      () => runUnlock({ repoRoot: s.repo, env: s.env, appeal: true, invoke: passingMentalInvoke() }),
      /one appeal/i,
    );
  } finally { s.cleanup(); }
});

test('override remains available after a grader failure', async () => {
  const s = scratch();
  try {
    writeFileSync(
      join(projectPaths(s.repo).attemptsDir, 'default.md'),
      'The walker is supposed to cons-recurse on list cells. It returns nil on `(a . b)` because I think dotted pairs skip the cdr walk — the failing REPL result was nil. Tried quoting.',
    );
    await runUnlock({
      repoRoot: s.repo, env: s.env,
      invoke: async () => { throw new Error('no model'); },
    });
    assert.equal(readProjectState(s.repo, s.env).unlocked, false);
    await runUnlock({ repoRoot: s.repo, env: s.env, override: 'I choose velocity' });
    assert.equal(readProjectState(s.repo, s.env).unlocked, true);
  } finally { s.cleanup(); }
});

test('runCheck requires the rubric file to be older than the answer (written first)', async () => {
  const s = scratch();
  try {
    const dir = join(projectPaths(s.repo).checksDir, 'heap');
    mkdirSync(dir, { recursive: true });
    const rubric = join(dir, 'rubric.json');
    const answer = join(dir, 'answer.md');
    writeFileSync(answer, 'it is a stack I guess');
    utimesSync(answer, new Date('2020-01-01'), new Date('2020-01-01'));
    writeFileSync(rubric, JSON.stringify({
      question: 'What was inverted?',
      criteria: { Q1: 'Names the compare-sign inversion' },
    }));
    utimesSync(rubric, new Date('2024-01-01'), new Date('2024-01-01'));
    await assert.rejects(
      () => runCheck({ repoRoot: s.repo, env: s.env, task: 'heap', invoke: async () => ({}) }),
      /before/i,
    );
  } finally { s.cleanup(); }
});

test('runCheck records landed|partial|not_landed and misconceptions on the ledger', async () => {
  const s = scratch();
  try {
    const dir = join(projectPaths(s.repo).checksDir, 'heap');
    mkdirSync(dir, { recursive: true });
    const rubric = join(dir, 'rubric.json');
    const answer = join(dir, 'answer.md');
    writeFileSync(rubric, JSON.stringify({
      question: 'What was inverted?',
      criteria: { Q1: 'Names the compare-sign inversion', Q2: 'Says how to falsify' },
    }));
    utimesSync(rubric, new Date('2020-01-01'), new Date('2020-01-01'));
    writeFileSync(answer, 'compare() had the subtract operands swapped, so the heap order inverted. Swapping them should reverse observed order.');
    utimesSync(answer, new Date('2024-01-01'), new Date('2024-01-01'));
    const msg = await runCheck({
      repoRoot: s.repo, env: s.env, task: 'heap',
      invoke: async () => ({
        verdict: 'landed',
        error_class: 'slip',
        misconceptions: [],
        criteria: {
          Q1: { met: true, span: 'subtract operands swapped' },
          Q2: { met: true, span: 'Swapping them should reverse observed order' },
        },
      }),
    });
    assert.match(msg, /landed/);
    const led = readLedger(s.env, 20).find((e) => e.event === 'check_grade');
    assert.equal(led.verdict, 'landed');
    assert.equal(led.error_class, 'slip');
  } finally { s.cleanup(); }
});

test('runAudit with an oracle invoke reports graded_up = 0 and the gate passes', async () => {
  const r = await runAudit({
    items: ITEMS,
    runs: 3,
    invoke: async ({ item }) => ({
      verdict: item.gold_verdict,
      criteria: item.gold_criteria || {},
      error_class: item.gold_error_class || 'conceptual',
      misconceptions: [],
    }),
  });
  assert.equal(r.graded_up, 0);
  assert.equal(r.pass, true);
});

test('runAudit with an inflating invoke reports graded_up > 0 and the gate blocks', async () => {
  const r = await runAudit({
    items: ITEMS,
    runs: 3,
    invoke: async ({ item }) => {
      if (item.route === 'commit-history') {
        return { verdict: 'unlocked', criteria: { C1: { met: true, span: 'x' }, C2: { met: true, span: 'y' }, C3: { met: true, span: 'z' } } };
      }
      if (item.route === 'check') {
        const criteria = {};
        for (const id of Object.keys(item.gold_criteria || { Q1: 1 })) {
          criteria[id] = { met: true, span: 'inflated' };
        }
        return { verdict: 'landed', criteria };
      }
      return {
        verdict: 'unlocked',
        criteria: {
          R1: { met: true, span: 'x' },
          R2: { met: true, span: 'y' },
          R3: { met: true, span: 'z' },
          R4: { met: true, span: 'w' },
        },
      };
    },
  });
  assert.ok(r.graded_up > 0);
  assert.equal(r.pass, false);
  const blocked = aggregateRuns(r.runScores);
  assert.equal(blocked.pass, false);
});

test('scoreRun treats an inflated fail-case as graded_up', () => {
  const s = scoreRun(
    [{ id: 'fluent-empty-01', gold_verdict: 'not_yet' }],
    { 'fluent-empty-01': { verdict: 'unlocked' } },
  );
  assert.equal(s.graded_up, 1);
});
