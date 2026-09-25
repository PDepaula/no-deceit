import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraderJob, assertJobBlind, graderSpawnPlan, isGraderAuthFailure } from './grader-job.mjs';

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

test('graderSpawnPlan isolates the child without --bare (OAuth must keep working)', () => {
  const plan = graderSpawnPlan({ pluginRoot: '/plugin', model: 'haiku', jobPath: '/tmp/job.json', timeoutMs: 1 });
  const args = plan.args;
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(args.includes('--bare'), false);
  // exactly one tool, read-only, on both the availability and allow lists
  assert.equal(after('--tools'), 'Read');
  assert.equal(after('--allowedTools'), 'Read');
  assert.equal(args.filter((a) => a === '--tools').length, 1);
  assert.equal(args.filter((a) => a === '--allowedTools').length, 1);
  // no inherited settings/hooks/plugins/CLAUDE.md, no MCP, no skills, no session
  assert.equal(after('--setting-sources'), '');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args.includes('--mcp-config'), false);
  assert.ok(args.includes('--disable-slash-commands'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(after('--system-prompt-file'), '/plugin/agents/nd-grader.md');
  for (const a of ['--continue', '--resume', '--add-dir', '--plugin-dir', '--settings']) {
    assert.equal(args.includes(a), false, a);
  }
  // scratch cwd requested; env carries the child marker and nothing about auth
  assert.equal(plan.scratchCwd, true);
  assert.deepEqual(plan.envExtra, { ND_GRADER_CHILD: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  assert.equal(JSON.stringify(plan).includes('CLAUDE_CONFIG_DIR'), false);
});

test('isGraderAuthFailure recognises the not-logged-in notice', () => {
  assert.equal(isGraderAuthFailure('Not logged in · Please run /login'), true);
  assert.equal(isGraderAuthFailure('{"verdict":"unlocked"}'), false);
  assert.equal(isGraderAuthFailure('{"verdict":"unlocked","criteria":{"R1":{"met":true,"span":"a user who is not logged in gets a 401"}}}'), false);
});
