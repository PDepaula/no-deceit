import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths, readProjectState, writeSession } from '../core/state.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'nd-hook.mjs');

function scratch({ governed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nd-hook-'));
  const env = { ...process.env, XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  delete env.FM_TASK_ID; delete env.ND_EXEMPT; delete env.ND_WORKER; delete env.ND_HEADLESS;
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  if (governed) mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runHook(event, payload, env) {
  const out = execFileSync('node', [HOOK, event], { input: JSON.stringify(payload), env, encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : null;
}

test('PreToolUse denies a Tier 1 source Write and delivers the reason', () => {
  const s = scratch();
  try {
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Write', tool_input: { file_path: join(s.repo, 'src/x.mjs') } }, s.env);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /Tier 1/);
  } finally { s.cleanup(); }
});

test('PreToolUse allows a Read (no output)', () => {
  const s = scratch();
  try {
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Read', tool_input: { file_path: join(s.repo, 'x') } }, s.env);
    assert.equal(out, null);
  } finally { s.cleanup(); }
});

test('PreToolUse in a worker session (FM_TASK_ID) is a pass-through (no output)', () => {
  const s = scratch();
  try {
    const env = { ...s.env, FM_TASK_ID: 'crew-1' };
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Write', tool_input: { file_path: join(s.repo, 'src/x.mjs') } }, env);
    assert.equal(out, null, 'a firstmate-style worker must NOT be blocked');
  } finally { s.cleanup(); }
});

test('PreToolUse in the blind grader child (ND_GRADER_CHILD=1) is a pass-through', () => {
  const s = scratch();
  try {
    const env = { ...s.env, ND_GRADER_CHILD: '1' };
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Write', tool_input: { file_path: join(s.repo, 'src/x.mjs') } }, env);
    assert.equal(out, null, 'the grader child must never be gated by No Deceit hooks');
  } finally { s.cleanup(); }
});

test('UserPromptSubmit /no-deceit:tier 2 is handled in-hook, blocks the prompt, and changes state', () => {
  const s = scratch();
  try {
    const out = runHook('UserPromptSubmit', { session_id: 's', cwd: s.repo, prompt: '/no-deceit:tier 2' }, s.env);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /Tier set to 2/);
    assert.equal(readProjectState(s.repo, s.env).tier, 2);
  } finally { s.cleanup(); }
});

test('UserPromptSubmit /no-deceit:unlock --override still unlocks in-hook', () => {
  const s = scratch();
  try {
    const out = runHook('UserPromptSubmit', { session_id: 's', cwd: s.repo, prompt: '/no-deceit:unlock --override "deadline; I know the approach"' }, s.env);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /override/);
    assert.equal(readProjectState(s.repo, s.env).unlocked, true);
  } finally { s.cleanup(); }
});

test('UserPromptSubmit /no-deceit:unlock runs the grader (mockable, never the tutor)', () => {
  const s = scratch();
  try {
    mkdirSync(projectPaths(s.repo).attemptsDir, { recursive: true });
    writeFileSync(join(projectPaths(s.repo).attemptsDir, 'default.md'), 'idk it just doesn\'t work');
    const env = { ...s.env, ND_GRADER_MOCK_JSON: JSON.stringify({ verdict: 'unlocked', criteria: { R1: { met: true, span: 'x' } } }) };
    const out = runHook('UserPromptSubmit', { session_id: 's', cwd: s.repo, prompt: '/no-deceit:unlock' }, env);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /not_yet/);
    assert.equal(readProjectState(s.repo, s.env).unlocked, false);
  } finally { s.cleanup(); }
});

test('UserPromptSubmit ordinary prompt injects tier/mode context', () => {
  const s = scratch();
  try {
    const out = runHook('UserPromptSubmit', { session_id: 's', cwd: s.repo, prompt: 'help me refactor' }, s.env);
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(out.hookSpecificOutput.additionalContext, /No Deceit is active/);
  } finally { s.cleanup(); }
});

test('SessionStart injects context and reports the gate armed', () => {
  const s = scratch();
  try {
    const out = runHook('SessionStart', { session_id: 's', cwd: s.repo, source: 'startup' }, s.env);
    assert.match(out.hookSpecificOutput.additionalContext, /No Deceit is active/);
    assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /FAILED its armed self-check/);
  } finally { s.cleanup(); }
});

test('SessionStart in an ungoverned repo stays silent', () => {
  const s = scratch({ governed: false });
  try {
    const out = runHook('SessionStart', { session_id: 's', cwd: s.repo, source: 'startup' }, s.env);
    assert.equal(out, null);
  } finally { s.cleanup(); }
});

const BIG_FENCE = '```js\n' + ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n') + '\n```';

test('PreToolUse asks on Agent at Tier 1', () => {
  const s = scratch();
  try {
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Agent', tool_input: { prompt: 'fix it' } }, s.env);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /subagent|delegat/i);
  } finally { s.cleanup(); }
});

test('Stop blocks an over-threshold fence at Tier 1 and ledgers it', () => {
  const s = scratch();
  try {
    const out = runHook('Stop', { session_id: 's', cwd: s.repo, last_assistant_message: BIG_FENCE, stop_hook_active: false }, s.env);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /Tier 1|chat text|fenced/i);
  } finally { s.cleanup(); }
});

test('Stop allows a small snippet at Tier 1', () => {
  const s = scratch();
  try {
    const out = runHook('Stop', { session_id: 's', cwd: s.repo, last_assistant_message: '```\nconst x = 1;\n```\nWhich reads easier to you?', stop_hook_active: false }, s.env);
    assert.equal(out, null);
  } finally { s.cleanup(); }
});

test('Stop in a worker session is a pass-through', () => {
  const s = scratch();
  try {
    const out = runHook('Stop', { session_id: 's', cwd: s.repo, last_assistant_message: BIG_FENCE, stop_hook_active: false }, { ...s.env, FM_TASK_ID: 'crew-1' });
    assert.equal(out, null);
  } finally { s.cleanup(); }
});

test('MessageDisplay redacts over-threshold Tier 1 code on screen', () => {
  const s = scratch();
  try {
    const out = runHook('MessageDisplay', { session_id: 's', cwd: s.repo, delta: BIG_FENCE, index: 0, final: true }, s.env);
    assert.equal(out.hookSpecificOutput.hookEventName, 'MessageDisplay');
    assert.match(out.hookSpecificOutput.displayContent, /redacted/i);
  } finally { s.cleanup(); }
});

test('PostToolUse bashEditDiff tripwire blocks a source-mutating Bash', () => {
  const s = scratch();
  try {
    const out = runHook('PostToolUse', {
      session_id: 's',
      cwd: s.repo,
      tool_name: 'Bash',
      tool_input: { command: 'python -c "open(\'x.py\',\'w\').write(\'x\')"' },
      tool_response: { bashEditDiff: { changedFiles: [join(s.repo, 'src/x.py')] } },
    }, s.env);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /bashEditDiff|slipped|Revert/i);
  } finally { s.cleanup(); }
});

test('PostToolUse does not trip a REPL/run command with no changed files', () => {
  const s = scratch();
  try {
    const out = runHook('PostToolUse', {
      session_id: 's',
      cwd: s.repo,
      tool_name: 'Bash',
      tool_input: { command: 'python -c "print(1+1)"' },
      tool_response: { stdout: '2', stderr: '', interrupted: false, isImage: false },
    }, s.env);
    assert.equal(out, null);
  } finally { s.cleanup(); }
});

test('Stop redirects a Tier 3 edited turn that is missing the narration format', () => {
  const s = scratch();
  try {
    const { preambleFile } = projectPaths(s.repo);
    mkdirSync(join(preambleFile, '..'), { recursive: true });
    writeFileSync(preambleFile, 'Overview: ship the gate.\nFirst instinct: intercept the tool call then narrate.');
    writeSession(s.env, 's', { t3ExpiresAtMs: Date.now() + 60_000, turnEdited: true });
    const out = runHook('Stop', { session_id: 's', cwd: s.repo, last_assistant_message: 'I wrote the code silently.', stop_hook_active: false }, s.env);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /What \/ why|Divergence from your first instinct/i);
  } finally { s.cleanup(); }
});

test('the plugin hook contract registers Stop, MessageDisplay, and PostToolUse', () => {
  const spec = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'hooks.json'), 'utf8'));
  assert.ok(Array.isArray(spec.hooks.Stop) && spec.hooks.Stop.length > 0);
  assert.ok(Array.isArray(spec.hooks.MessageDisplay) && spec.hooks.MessageDisplay.length > 0);
  assert.ok(Array.isArray(spec.hooks.PostToolUse) && spec.hooks.PostToolUse.length > 0);
  const postMatcher = spec.hooks.PostToolUse[0].matcher;
  assert.match(postMatcher, /Bash/);
  const preMatcher = spec.hooks.PreToolUse[0].matcher;
  assert.match(preMatcher, /Agent/);
});

const LONG_STATEMENT = 'The orders table mixes header and line data, so every read of a single order fans out across duplicated rows and the join runs on every query instead of once at load time, which is why it is slow and stale-prone. '.repeat(2);

test('Stop blocks an unlabelled statement at the default Tier 2 (locked) with the question-ending reason', () => {
  const s = scratch();
  try {
    const out = runHook('Stop', { session_id: 's', cwd: s.repo, last_assistant_message: LONG_STATEMENT, stop_hook_active: false }, s.env);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /Handing over:/);
  } finally { s.cleanup(); }
});

test('PreToolUse denies a diagram file write at Tier 2 unlocked, telling the agent to show it in chat', () => {
  const s = scratch();
  try {
    writeSession(s.env, 's', { unlocked: true });
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Write', tool_input: { file_path: join(s.repo, 'docs/flow.mmd'), content: 'graph TD' } }, s.env);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /redraws/);
  } finally { s.cleanup(); }
});

test('typed /no-deceit:handover is handled by the hook, arms exactly one turn, and re-arms the gate', () => {
  const s = scratch();
  try {
    const cmd = runHook('UserPromptSubmit', { session_id: 'h', cwd: s.repo, prompt: '/no-deceit:handover --domain etl' }, s.env);
    assert.equal(cmd.decision, 'block');
    assert.match(cmd.reason, /Handover recorded for etl/);
    // Next ordinary prompt injects the handover context.
    const next = runHook('UserPromptSubmit', { session_id: 'h', cwd: s.repo, prompt: 'ok, go' }, s.env);
    assert.match(next.hookSpecificOutput.additionalContext, /Handing over: <one line>/);
    // The relaxed turn: diagram allowed with the label; the flag is consumed.
    const ok = runHook('Stop', { session_id: 'h', cwd: s.repo, last_assistant_message: 'Here.\n```mermaid\ngraph TD\n  a-->b\n```\nHanding over: the flow', stop_hook_active: false }, s.env);
    assert.equal(ok, null);
    // The following turn is gated again.
    const again = runHook('Stop', { session_id: 'h', cwd: s.repo, last_assistant_message: 'Here.\n```mermaid\ngraph TD\n  a-->b\n```\nHanding over: the flow', stop_hook_active: false }, s.env);
    assert.equal(again.decision, 'block');
    const ledger = readFileSync(join(s.env.XDG_STATE_HOME, 'no-deceit', 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"handover"/);
  } finally { s.cleanup(); }
});

const TEACH_BODY = 'Join at load time means readers get finished rows and pay once, at the price of staleness.\nIn gd-integrations the dashboard join should move into the nightly ETL, unless finance needs same-hour totals.';

test('multi-line /no-deceit:teach captures the body as evidence and blocks the prompt (the tutor never sees it)', () => {
  const s = scratch();
  try {
    const env = { ...s.env, XDG_DATA_HOME: join(s.dir, 'share') };
    const out = runHook('UserPromptSubmit', { session_id: 't', cwd: s.repo, prompt: `/no-deceit:teach etl --project gd-integrations\n${TEACH_BODY}` }, env);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /Captured \d+ words for etl \(project gd-integrations\)/);
    assert.equal(out.hookSpecificOutput, undefined, 'no context is injected for the model');
    const dir = join(s.dir, 'share', 'no-deceit', 'evidence', 'etl');
    const [name] = readdirSync(dir);
    assert.match(readFileSync(join(dir, name), 'utf8'), /gd-integrations the dashboard join/);
    const ledger = readFileSync(join(s.env.XDG_STATE_HOME, 'no-deceit', 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"evidence_captured"/);
    assert.doesNotMatch(ledger, /nightly ETL/, 'the ledger holds the hash and path, not the evidence text');
  } finally { s.cleanup(); }
});

test('/no-deceit:teach with no body captures nothing, and /no-deceit:grade runs the transfer grader', () => {
  const s = scratch();
  try {
    const env = { ...s.env, XDG_DATA_HOME: join(s.dir, 'share') };
    const empty = runHook('UserPromptSubmit', { session_id: 't', cwd: s.repo, prompt: '/no-deceit:teach etl' }, env);
    assert.match(empty.reason, /nothing to capture/);
    runHook('UserPromptSubmit', { session_id: 't', cwd: s.repo, prompt: `/no-deceit:teach etl --project gd-integrations\n${TEACH_BODY}` }, env);
    mkdirSync(join(s.dir, 'share', 'no-deceit'), { recursive: true });
    writeFileSync(join(s.dir, 'share', 'no-deceit', 'projects.edn'), `[{:name "gd-integrations" :path "${s.repo}" :summary "nightly ETL"}]\n`);
    const mock = JSON.stringify({ verdict: 'unlocked', criteria: Object.fromEntries(['P1', 'P2', 'P3', 'P4'].map((k) => [k, { met: true, span: 'x' }])) });
    const graded = runHook('UserPromptSubmit', { session_id: 't', cwd: s.repo, prompt: '/no-deceit:grade' }, { ...env, ND_GRADER_MOCK_JSON: mock });
    assert.equal(graded.decision, 'block');
    assert.match(graded.reason, /Transfer teach-back for etl passed/);
    assert.equal(readProjectState(s.repo, env).unlocked, true);
  } finally { s.cleanup(); }
});

// --- Phase 3: curriculum and the Tier 1 gate ---

import { dataPaths } from '../core/state.mjs';
const CUR_FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'curriculum');

function withData(s) {
  s.env.ND_DATA_DIR = join(s.dir, 'data');
  return dataPaths(s.env);
}
function installCurriculum(s, topic) {
  const dp = withData(s);
  mkdirSync(dp.curriculumDir(topic), { recursive: true });
  writeFileSync(dp.curriculumOpen(topic), readFileSync(join(CUR_FIX, 'open.md')));
  writeFileSync(dp.curriculumSealed(topic), readFileSync(join(CUR_FIX, 'sealed.md')));
  return dp;
}

test('/no-deceit:tier 1 <topic> refuses without a curriculum, then succeeds and SessionStart injects its paths', () => {
  const s = scratch();
  try {
    withData(s);
    const refused = runHook('UserPromptSubmit', { session_id: 's', cwd: s.repo, prompt: '/no-deceit:tier 1 etl-basics' }, s.env);
    assert.equal(refused.decision, 'block');
    assert.match(refused.reason, /needs a curriculum/);
    assert.match(refused.reason, /nd curriculum build etl-basics/);
    assert.doesNotMatch(refused.reason, /No Deceit: No Deceit/);
    assert.equal(readProjectState(s.repo, s.env).tier, 2);

    const dp = installCurriculum(s, 'etl-basics');
    const ok = runHook('UserPromptSubmit', { session_id: 's', cwd: s.repo, prompt: '/no-deceit:tier 1 etl-basics' }, s.env);
    assert.match(ok.reason, /Tier set to 1 for topic etl-basics/);
    const st = readProjectState(s.repo, s.env);
    assert.deepEqual([st.tier, st.topic], [1, 'etl-basics']);

    const start = runHook('SessionStart', { session_id: 's2', cwd: s.repo }, s.env);
    const ctx = start.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes(dp.curriculumOpen('etl-basics')) && ctx.includes(dp.curriculumSealed('etl-basics')));
    assert.match(ctx, /never quote, recite, paraphrase or summarise/);
    assert.match(ctx, /Topic: etl-basics — curriculum unreviewed/);
  } finally { s.cleanup(); }
});

test('SessionStart with no active topic injects no curriculum paragraph', () => {
  const s = scratch();
  try {
    withData(s);
    const start = runHook('SessionStart', { session_id: 's', cwd: s.repo }, s.env);
    assert.doesNotMatch(start.hookSpecificOutput.additionalContext, /Active topic/);
  } finally { s.cleanup(); }
});

test('PreToolUse denies an agent write to the curriculum (category G) at Tier 1', () => {
  const s = scratch();
  try {
    const dp = installCurriculum(s, 'etl-basics');
    const out = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Write', tool_input: { file_path: dp.curriculumSealed('etl-basics') } }, s.env);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    const bash = runHook('PreToolUse', { session_id: 's', cwd: s.repo, tool_name: 'Bash', tool_input: { command: 'nd curriculum build etl --goal x --mission y --from a' } }, s.env);
    assert.equal(bash.hookSpecificOutput.permissionDecision, 'deny');
  } finally { s.cleanup(); }
});
