// Phase 3: the Tier 1 curriculum precondition, per-topic Tier 2 unlock, the scout
// build pipeline (mocked), and the curriculum context. No live model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTier, renderStatus, topicContext, unlockOverride } from './control.mjs';
import { resolveEffective } from './policy.mjs';
import { classify } from './classify.mjs';
import { dataPaths, projectPaths, readProjectState, writeProjectState, readLedger, buildClassifyCfg, loadConfig } from './state.mjs';
import { runCurriculumBuild, checkCurriculumFiles, reviewCurriculumFiles, markReviewed } from './scout.mjs';
import { parseScoutOutput, scoutSpawnPlan, buildScoutJob, classifySource } from './scout-job.mjs';
import { evaluate } from './gate.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'curriculum');
const OPEN = readFileSync(join(FIX, 'open.md'), 'utf8');
const SEALED = readFileSync(join(FIX, 'sealed.md'), 'utf8');

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'nd-cur-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir, ND_DATA_DIR: join(dir, 'data') };
  const repo = join(dir, 'repo');
  mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
function install(env, topic, { open = OPEN, sealed = SEALED } = {}) {
  const dp = dataPaths(env);
  mkdirSync(dp.curriculumDir(topic), { recursive: true });
  if (open != null) writeFileSync(dp.curriculumOpen(topic), open);
  if (sealed != null) writeFileSync(dp.curriculumSealed(topic), sealed);
}
const scoutText = (open = OPEN.replace(/^## Keywords[\s\S]*$/m, '## Keywords\n\n- placeholder\n'), sealed = SEALED) =>
  `<<<ND-FILE open.md>>>\n${open.replace('built: 2026-09-25 by nd-scout (sonnet)', 'built: pending')}\n<<<ND-END>>>\n<<<ND-FILE sealed.md>>>\n${sealed}\n<<<ND-END>>>\n`;

// --- Tier 1 precondition (R2) ---

test('nd tier 1 --topic refuses without a curriculum and names the two ways to get one', () => {
  const s = scratch();
  try {
    assert.throws(() => setTier({ repoRoot: s.repo, env: s.env, tier: 1, topic: 'etl-basics' }),
      (e) => /open\.md does not exist/.test(e.message) && /sealed\.md does not exist/.test(e.message)
        && /nd curriculum build etl-basics/.test(e.message) && /write open\.md and sealed\.md yourself/.test(e.message));
    assert.equal(readProjectState(s.repo, s.env).tier, 2, 'a refusal changes nothing');
    install(s.env, 'etl-basics', { sealed: null });
    assert.throws(() => setTier({ repoRoot: s.repo, env: s.env, tier: 1, topic: 'etl-basics' }), /sealed\.md does not exist/);
    install(s.env, 'etl-basics', { open: 'stub', sealed: SEALED });
    assert.throws(() => setTier({ repoRoot: s.repo, env: s.env, tier: 1, topic: 'etl-basics' }), /too short/);
  } finally { s.cleanup(); }
});

test('nd tier 1 --topic succeeds with both files, records the topic, and does not need reviewed:', () => {
  const s = scratch();
  try {
    install(s.env, 'etl-basics');
    const msg = setTier({ repoRoot: s.repo, env: s.env, tier: 1, topic: 'etl-basics' });
    assert.match(msg, /Tier set to 1 for topic etl-basics/);
    const st = readProjectState(s.repo, s.env);
    assert.deepEqual([st.tier, st.topic], [1, 'etl-basics']);
    assert.equal(readLedger(s.env).at(-1).topic, 'etl-basics');
  } finally { s.cleanup(); }
});

test('Tier 1 without a topic keeps today’s behaviour (no curriculum needed); Tier 2 accepts a topic without one', () => {
  const s = scratch();
  try {
    setTier({ repoRoot: s.repo, env: s.env, tier: 1 });
    assert.equal(readProjectState(s.repo, s.env).topic, null);
    setTier({ repoRoot: s.repo, env: s.env, tier: 2, topic: 'anything' });
    assert.equal(readProjectState(s.repo, s.env).topic, 'anything');
    setTier({ repoRoot: s.repo, env: s.env, tier: 2, clearTopic: true });
    assert.equal(readProjectState(s.repo, s.env).topic, null);
    assert.throws(() => setTier({ repoRoot: s.repo, env: s.env, tier: 3, topic: 'x' }), /not to a Tier 3/);
  } finally { s.cleanup(); }
});

test('plain Tier 1 checks the stored topic: refused without its curriculum, allowed with one or with --no-topic', () => {
  const s = scratch();
  try {
    setTier({ repoRoot: s.repo, env: s.env, tier: 2, topic: 'foo' });
    assert.throws(() => setTier({ repoRoot: s.repo, env: s.env, tier: 1 }), /Tier 1 for "foo" needs a curriculum/);
    assert.deepEqual([readProjectState(s.repo, s.env).tier, readProjectState(s.repo, s.env).topic], [2, 'foo']);
    setTier({ repoRoot: s.repo, env: s.env, tier: 3 });
    assert.throws(() => setTier({ repoRoot: s.repo, env: s.env, tier: 1 }), /Tier 1 for "foo" needs a curriculum/);
    install(s.env, 'foo');
    assert.match(setTier({ repoRoot: s.repo, env: s.env, tier: 1 }), /Tier set to 1 for topic foo/);
    setTier({ repoRoot: s.repo, env: s.env, tier: 2, topic: 'bar' });
    assert.match(setTier({ repoRoot: s.repo, env: s.env, tier: 1, clearTopic: true }), /^Tier set to 1\.$/);
    assert.equal(readProjectState(s.repo, s.env).topic, null);
  } finally { s.cleanup(); }
});

test('open.md with CRLF line endings is a ready curriculum', () => {
  const s = scratch();
  try {
    install(s.env, 'etl-basics', { open: OPEN.replace(/\n/g, '\r\n') });
    assert.match(setTier({ repoRoot: s.repo, env: s.env, tier: 1, topic: 'etl-basics' }), /Tier set to 1 for topic etl-basics/);
  } finally { s.cleanup(); }
});

test('nd status names the topic and nudges while the curriculum is unreviewed', () => {
  const s = scratch();
  try {
    install(s.env, 'etl-basics');
    setTier({ repoRoot: s.repo, env: s.env, tier: 1, topic: 'etl-basics' });
    assert.match(renderStatus({ repoRoot: s.repo, env: s.env }), /Topic: etl-basics — curriculum unreviewed \(review mission, sources and outline: `nd curriculum review etl-basics`\)/);
    markReviewed({ env: s.env, topic: 'etl-basics' });
    assert.match(renderStatus({ repoRoot: s.repo, env: s.env }), /Topic: etl-basics — curriculum reviewed/);
    install(s.env, 'etl-basics', { open: null, sealed: null });
    writeFileSync(dataPaths(s.env).curriculumOpen('etl-basics'), 'stub');
    assert.match(renderStatus({ repoRoot: s.repo, env: s.env }), /no ready curriculum/);
  } finally { s.cleanup(); }
});

// --- SessionStart / prompt context ---

test('topicContext injects both paths for the active topic and nothing without one', () => {
  const s = scratch();
  try {
    assert.equal(topicContext({ repoRoot: s.repo, env: s.env }), '');
    install(s.env, 'etl-basics');
    setTier({ repoRoot: s.repo, env: s.env, tier: 1, topic: 'etl-basics' });
    const c = topicContext({ repoRoot: s.repo, env: s.env });
    const dp = dataPaths(s.env);
    assert.ok(c.includes(dp.curriculumOpen('etl-basics')) && c.includes(dp.curriculumSealed('etl-basics')));
    assert.match(c, /never quote, recite, paraphrase or summarise/);
    assert.match(c, /never reveal a concept before the developer has attempted it/);
  } finally { s.cleanup(); }
});

// --- per-topic Tier 2 unlock ---

test('resolveEffective: with a topic, the unlock is per topic; without one, project-level', () => {
  const project = { tier: 2, unlocked: true, unlockedTopics: ['etl'], topic: null };
  assert.equal(resolveEffective({ project }).t2Unlocked, true, 'no active topic: today’s behaviour');
  assert.equal(resolveEffective({ project: { ...project, topic: 'etl' } }).t2Unlocked, true);
  const other = resolveEffective({ project: { ...project, topic: 'caching' } });
  assert.equal(other.t2Unlocked, false, 'a pass for etl does not open caching');
  assert.equal(other.topic, 'caching');
  assert.equal(resolveEffective({ project: { tier: 2, unlocked: false, unlockedTopics: [], topic: 'etl' }, session: { unlockedTopics: ['etl'] } }).t2Unlocked, true);
  assert.equal(resolveEffective({ project: { ...project, topic: 'a' }, session: { topic: 'etl' } }).t2Unlocked, true, 'the session topic wins');
});

test('the gate reads the topic: the same project is locked for another topic, unlocked for a passed one', () => {
  const s = scratch();
  try {
    writeProjectState(s.repo, { ...readProjectState(s.repo, s.env), tier: 2, unlocked: true, unlockedTopics: ['etl'], topic: 'caching' });
    const call = { toolName: 'Write', toolInput: { file_path: join(s.repo, 'src/a.mjs') }, cwd: s.repo, env: s.env, sessionId: 's' };
    assert.match(evaluate(call).reason, /not unlocked/);
    writeProjectState(s.repo, { ...readProjectState(s.repo, s.env), topic: 'etl' });
    assert.match(evaluate(call).reason, /Tier 2 is unlocked/);
  } finally { s.cleanup(); }
});

test('an override in a topic session unlocks that topic', () => {
  const s = scratch();
  try {
    setTier({ repoRoot: s.repo, env: s.env, tier: 2, topic: 'caching' });
    unlockOverride({ repoRoot: s.repo, env: s.env, reason: 'deadline' });
    const st = readProjectState(s.repo, s.env);
    assert.deepEqual(st.unlockedTopics, ['caching']);
    assert.equal(resolveEffective({ project: st }).t2Unlocked, true);
  } finally { s.cleanup(); }
});

// --- tamper: the agent cannot build or bless a curriculum ---

test('category G: the agent may not run nd curriculum build/reviewed or write curricula; check and review are reads', () => {
  const s = scratch();
  try {
    const cfg = buildClassifyCfg(loadConfig(s.env), s.repo, s.env);
    assert.equal(classify('Bash', { command: 'nd curriculum build etl --goal x' }, cfg), 'G');
    assert.equal(classify('Bash', { command: 'nd curriculum reviewed etl' }, cfg), 'G');
    assert.equal(classify('Write', { file_path: dataPaths(s.env).curriculumSealed('etl') }, cfg), 'G');
    assert.equal(classify('Bash', { command: `cat ${dataPaths(s.env).curriculumOpen('etl')} > /dev/null` }, cfg), 'G');
    assert.notEqual(classify('Bash', { command: 'nd curriculum check etl' }, cfg), 'G');
    assert.notEqual(classify('Bash', { command: 'nd curriculum review etl' }, cfg), 'G');
  } finally { s.cleanup(); }
});

// --- the scout ---

const allowedToolsOf = (args) => {
  const i = args.indexOf('--allowedTools') + 1;
  const end = args.findIndex((a, j) => j >= i && a.startsWith('--'));
  return args.slice(i, end < 0 ? args.length : end);
};

test('scout spawn plan: fresh claude -p, read/fetch tools only, scoped Read, no skip-permissions, scout marker', () => {
  const plan = scoutSpawnPlan({ pluginRoot: '/p', model: 'sonnet', jobPath: '/j.json', timeoutMs: 5, readDirs: ['/job'], readFiles: ['/src/a.md'] });
  assert.equal(plan.command, 'claude');
  assert.ok(!plan.args.includes('--bare'));
  assert.ok(!plan.args.some((a) => /skip-permissions|bypassPermissions/.test(a)));
  assert.equal(plan.args[plan.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(plan.args[plan.args.indexOf('--tools') + 1], 'Read,WebFetch');
  assert.deepEqual(allowedToolsOf(plan.args), ['WebFetch', 'Read(//job/**)', 'Read(//src/a.md)']);
  assert.ok(!plan.args.some((a) => /Write|Bash|Edit/.test(a)));
  assert.throws(() => scoutSpawnPlan({ pluginRoot: '/p', jobPath: '/j.json', readFiles: ['rel.md'] }), /must be absolute/);
  assert.equal(plan.args[plan.args.indexOf('--system-prompt-file') + 1], '/p/agents/nd-scout.md');
  assert.equal(plan.envExtra.ND_SCOUT_CHILD, '1');
  assert.equal(plan.timeoutMs, 5);
});

test('scout job and output parsing', () => {
  assert.deepEqual(classifySource('https://x.test/a'), { kind: 'url', ref: 'https://x.test/a' });
  assert.deepEqual(classifySource('notes.md'), { kind: 'path', ref: 'notes.md' });
  assert.deepEqual(buildScoutJob({ topic: 't', goal: 'g', mission: 'm' }), { topic: 't', goal: 'g', mission: 'm', sources: [], projects: [] });
  const p = parseScoutOutput('chatter\n<<<ND-FILE open.md>>>\nA\n\n<<<ND-END>>>\n<<<ND-FILE sealed.md>>>\nB\n<<<ND-END>>>\n');
  assert.deepEqual(p, { open: 'A\n', sealed: 'B\n' });
  assert.deepEqual(parseScoutOutput('nothing'), { open: null, sealed: null });
});

const BUILD = (s, extra = {}) => ({ env: s.env, topic: 'etl-basics', goal: 'place each join', mission: 'own my pipeline', from: [join(FIX, 'open.md')], cwd: s.dir, nowMs: Date.UTC(2026, 8, 25), ...extra });

test('nd curriculum build writes both files, regenerates keywords from the sealed map, stamps built/reviewed', async () => {
  const s = scratch();
  try {
    let seenJob;
    const msg = await runCurriculumBuild(BUILD(s, { invoke: async ({ job }) => { seenJob = job; return scoutText(); } }));
    assert.match(msg, /2 concepts, 7 keywords/);
    assert.equal(seenJob.goal, 'place each join');
    assert.equal(seenJob.sources[0].kind, 'path');
    assert.match(seenJob.formatDocPath, /curriculum-format\.md$/);
    const dp = dataPaths(s.env);
    const open = readFileSync(dp.curriculumOpen('etl-basics'), 'utf8');
    assert.match(open, /^built: 2026-09-25 by nd-scout \(sonnet\)$/m);
    assert.match(open, /^reviewed: no$/m);
    assert.match(open, /## Keywords\n\n- batch\n- join\n- materialised view\n- query time\n- replay\n- staleness\n- stream\n$/);
    assert.ok(!open.includes('placeholder'));
    assert.equal(readFileSync(dp.curriculumSealed('etl-basics'), 'utf8'), SEALED.replace(/\s+$/, '') + '\n');
    assert.equal(readLedger(s.env).at(-1).event, 'curriculum_built');
    // then Tier 1 works, and refusing to overwrite is the default
    setTier({ repoRoot: s.repo, env: s.env, tier: 1, topic: 'etl-basics' });
    await assert.rejects(runCurriculumBuild(BUILD(s, { invoke: async () => scoutText() })), /already exists.*--force/);
    await runCurriculumBuild(BUILD(s, { force: true, invoke: async () => scoutText() }));
  } finally { s.cleanup(); }
});

test('nd curriculum build spawns the scout with Read scoped to its job dir, the topic dir and the --from files', async () => {
  const s = scratch();
  try {
    let seen;
    const spawnImpl = (command, args) => {
      const allowed = allowedToolsOf(args);
      const jobDir = allowed[1].slice('Read(/'.length, -'/**)'.length);
      const job = JSON.parse(readFileSync(join(jobDir, 'job.json'), 'utf8'));
      seen = { command, args, allowed, job, formatDoc: readFileSync(job.formatDocPath, 'utf8') };
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => { child.stdout.emit('data', scoutText()); child.emit('close', 0); });
      return child;
    };
    await runCurriculumBuild(BUILD(s, { from: [join(FIX, 'open.md'), 'https://x.test/page'], spawnImpl }));
    assert.equal(seen.command, 'claude');
    assert.ok(!seen.args.some((a) => /skip-permissions|bypassPermissions/.test(a)));
    assert.equal(seen.args[seen.args.indexOf('--permission-mode') + 1], 'dontAsk');
    const jobDir = dirname(seen.job.formatDocPath);
    assert.deepEqual(seen.allowed, [
      'WebFetch',
      `Read(/${jobDir}/**)`,
      `Read(/${resolve(dataPaths(s.env).curriculumDir('etl-basics'))}/**)`,
      `Read(/${realpathSync(join(FIX, 'open.md'))})`,
    ]);
    assert.deepEqual(seen.job.sources.map((x) => x.kind), ['path', 'url']);
    assert.match(seen.formatDoc, /./);
    assert.ok(!existsSync(jobDir), 'the job dir is removed after the build');
    await assert.rejects(runCurriculumBuild(BUILD(s, { force: true, from: [FIX], spawnImpl })), /not a file/);
  } finally { s.cleanup(); }
});

test('nd curriculum build rejects a bad scout output and writes nothing', async () => {
  const s = scratch();
  try {
    const bad = SEALED.replace(/\*\*Transfer prompts\.\*\*[\s\S]*?(?=\n### C2|$)/, '');
    await assert.rejects(runCurriculumBuild(BUILD(s, { invoke: async () => scoutText(undefined, bad) })), /rejected, nothing was written[\s\S]*no transfer prompt/);
    await assert.rejects(runCurriculumBuild(BUILD(s, { invoke: async () => 'no blocks at all' })), /lacks open\.md and sealed\.md/);
    assert.ok(!existsSync(dataPaths(s.env).curriculumOpen('etl-basics')));
    assert.ok(existsSync(join(dataPaths(s.env).curriculumDir('etl-basics'), 'build-rejected.txt')));
  } finally { s.cleanup(); }
});

test('nd curriculum build needs a goal, a mission, a source, and a slug topic; the mock env seam works', async () => {
  const s = scratch();
  try {
    await assert.rejects(runCurriculumBuild(BUILD(s, { goal: '' })), /--goal/);
    await assert.rejects(runCurriculumBuild(BUILD(s, { mission: null })), /--mission/);
    await assert.rejects(runCurriculumBuild(BUILD(s, { from: [] })), /--from/);
    await assert.rejects(runCurriculumBuild(BUILD(s, { topic: '../x' })), /slug/);
    await assert.rejects(runCurriculumBuild(BUILD(s, { from: ['/no/such/file'] })), /does not exist/);
    const mock = join(s.dir, 'mock.txt');
    writeFileSync(mock, scoutText());
    await runCurriculumBuild(BUILD(s, { env: { ...s.env, ND_SCOUT_MOCK_FILE: mock } }));
    assert.ok(existsSync(dataPaths(s.env).curriculumSealed('etl-basics')));
  } finally { s.cleanup(); }
});

test('check, review and reviewed: review shows no sealed content; reviewed is advisory and ledgered', () => {
  const s = scratch();
  try {
    install(s.env, 'etl-basics');
    assert.match(checkCurriculumFiles({ env: s.env, topic: 'etl-basics' }), /format ok/);
    install(s.env, 'etl-basics', { open: OPEN.replace('- backpressure\n', '- z\n') });
    assert.match(checkCurriculumFiles({ env: s.env, topic: 'etl-basics' }), /not alphabetical/);
    const r = reviewCurriculumFiles({ env: s.env, topic: 'etl-basics' });
    assert.match(r, /Mission:/);
    assert.doesNotMatch(r, /Claim|Mechanism|Criteria/);
    assert.match(markReviewed({ env: s.env, topic: 'etl-basics' }), /advisory/);
    assert.match(readFileSync(dataPaths(s.env).curriculumOpen('etl-basics'), 'utf8'), /^reviewed: yes$/m);
    assert.equal(readLedger(s.env).at(-1).event, 'curriculum_reviewed');
    assert.throws(() => reviewCurriculumFiles({ env: s.env, topic: 'nope' }), /no curriculum/);
  } finally { s.cleanup(); }
});
