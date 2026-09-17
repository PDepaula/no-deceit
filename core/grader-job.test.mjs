import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraderJob, assertJobBlind, graderSpawnPlan } from './grader-job.mjs';

test('buildGraderJob keeps only file-path evidence and the fixed rubric', () => {
  const job = buildGraderJob({
    kind: 'unlock',
    route: 'mental-model',
    evidencePath: '/repo/.no-deceit/attempts/t.md',
    outputPath: '/repo/.no-deceit/verdicts/t.json',
    transcript: 'tutor: have you tried recursion?',
    dialogue: 'lots of chat',
    conversation: [{ role: 'assistant', content: 'let me hint' }],
  });
  assert.equal(job.evidencePath, '/repo/.no-deceit/attempts/t.md');
  assert.equal(job.route, 'mental-model');
  assert.equal('transcript' in job, false);
  assert.equal('dialogue' in job, false);
  assert.equal('conversation' in job, false);
});

test('assertJobBlind throws if a dialogue field is smuggled in', () => {
  assert.throws(() => assertJobBlind({ evidencePath: '/x', transcript_path: '/tmp/talk.jsonl' }), /blind/i);
  assert.throws(() => assertJobBlind({ evidencePath: '/x', messages: [] }), /blind/i);
  assert.doesNotThrow(() => assertJobBlind({
    kind: 'unlock',
    route: 'mental-model',
    evidencePath: '/x',
    outputPath: '/y',
    rubric: { R1: 'x' },
  }));
});

test('graderSpawnPlan never puts tutoring text in argv, stdin, or env', () => {
  const plan = graderSpawnPlan({
    pluginRoot: '/plugin',
    model: 'haiku',
    jobPath: '/tmp/job.json',
    timeoutMs: 120000,
  });
  const blob = JSON.stringify(plan);
  assert.equal(plan.command, 'claude');
  assert.ok(plan.args.includes('--bare'));
  assert.ok(plan.args.includes('--no-session-persistence'));
  assert.ok(plan.args.includes('haiku'));
  assert.ok(plan.args.some((a) => String(a).includes('/tmp/job.json')));
  assert.equal(plan.stdin, null);
  assert.match(blob, /nd-grader\.md/);
  assert.doesNotMatch(blob, /tutor/i);
  assert.doesNotMatch(blob, /transcript/i);
  assert.doesNotMatch(blob, /dialogue/i);
  assert.equal(plan.timeoutMs, 120000);
  assert.equal(plan.envExtra.ND_GRADER_CHILD, '1');
});

test('graderSpawnPlan uses the configured model, not a hardcoded one', () => {
  const a = graderSpawnPlan({ pluginRoot: '/p', model: 'opus', jobPath: '/j', timeoutMs: 1 });
  const b = graderSpawnPlan({ pluginRoot: '/p', model: 'haiku', jobPath: '/j', timeoutMs: 1 });
  assert.ok(a.args.includes('opus'));
  assert.ok(b.args.includes('haiku'));
  assert.equal(a.args.includes('haiku'), false);
});
