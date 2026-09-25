import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { projectPaths, dataPaths, homePaths, readProjectState, readAllLedger, buildClassifyCfg, loadConfig } from './state.mjs';
import { captureTeach, addEvidenceFile, latestEvidence, lastEvidenceTopic } from './evidence-io.mjs';
import { parseFrontmatter, summaryPathFor } from './evidence.mjs';
import { runGrade, runCheck } from './grader.mjs';
import { classify } from './classify.mjs';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'nd-grade-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'share'), HOME: dir };
  const repo = join(dir, 'repo');
  mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const NOW = Date.UTC(2026, 8, 24, 10, 11, 12);
const TEACH = 'Join at load time means readers get finished rows and pay once, at the price of staleness.\nIn gd-integrations the dashboard join should move into the nightly ETL, unless finance needs same-hour totals.';
const PASS = { verdict: 'unlocked', criteria: { P1: { met: true, span: 'a' }, P2: { met: true, span: 'b' }, P3: { met: true, span: 'c' }, P4: { met: true, span: 'd' } }, structure: { G1: 'met' }, misconceptions: ['stale is fine'] };
const withManifest = (s, [file, text] = [1, JSON.stringify([{ name: 'gd-integrations', path: s.repo, summary: 'nightly ETL' }])]) => {
  mkdirSync(dataPaths(s.env).dataDir, { recursive: true });
  writeFileSync(dataPaths(s.env).projectsManifests[file], text);
};

test('data home: ND_DATA_DIR > ND_HOME/data > XDG_DATA_HOME fallback; it is tamper territory', () => {
  assert.equal(dataPaths({ ND_DATA_DIR: '/x', ND_HOME: '/h' }).dataDir, '/x');
  assert.equal(dataPaths({ ND_HOME: '/h' }).dataDir, '/h/data');
  assert.equal(dataPaths({ XDG_DATA_HOME: '/s' }).dataDir, '/s/no-deceit');
  assert.equal(dataPaths({ HOME: '/u' }).dataDir, '/u/.local/share/no-deceit');
  const s = scratch();
  try {
    const cfg = buildClassifyCfg(loadConfig(s.env), s.repo, s.env);
    const ev = join(dataPaths(s.env).evidenceDir('etl'), 'x-teach.md');
    assert.equal(classify('Write', { file_path: ev, content: 'x' }, cfg), 'G');
    assert.equal(classify('Bash', { command: `cat ${ev}` }, cfg), 'G');
    assert.equal(classify('Bash', { command: 'cat ~/.local/share/no-deceit/evidence/etl/x.md' }, cfg), 'G');
    assert.equal(classify('Bash', { command: 'nd evidence add etl notes.md' }, cfg), 'G');
    assert.equal(classify('Bash', { command: 'nd grade etl' }, cfg), 'G');
    assert.equal(existsSync(dataPaths(s.env).dataDir), false, 'computing paths creates nothing');
  } finally { s.cleanup(); }
});

test('captureTeach writes the evidence file with frontmatter and ledgers evidence_captured', () => {
  const s = scratch();
  try {
    const msg = captureTeach({ env: s.env, sessionId: 'sess', arg: 'etl --project gd-integrations', body: `${TEACH}\n`, nowMs: NOW });
    assert.match(msg, /Captured \d+ words for etl \(project gd-integrations\)/);
    assert.match(msg, /\/no-deceit:grade/);
    const dir = dataPaths(s.env).evidenceDir('etl');
    const [name] = readdirSync(dir);
    assert.equal(name, '2026-09-24T10-11-12Z-01-teach.md');
    const { meta, body } = parseFrontmatter(readFileSync(join(dir, name), 'utf8'));
    assert.deepEqual([meta.topic, meta.project, meta.kind], ['etl', 'gd-integrations', 'teach-back']);
    assert.equal(meta.sha256, createHash('sha256').update(body).digest('hex'));
    const [row] = readAllLedger(s.env);
    assert.equal(row.event, 'evidence_captured');
    assert.deepEqual([row.topic, row.project, row.kind, row.sha256, row.sessionId], ['etl', 'gd-integrations', 'teach-back', meta.sha256, 'sess']);
    assert.ok(row.words > 10);
    // same second → a second file, not an overwrite
    captureTeach({ env: s.env, arg: 'etl', body: TEACH, nowMs: NOW });
    assert.equal(readdirSync(dir).length, 2);
    assert.equal(lastEvidenceTopic(s.env), 'etl');
  } finally { s.cleanup(); }
});

test('captureTeach refuses an empty body or a bad topic and writes nothing', () => {
  const s = scratch();
  try {
    assert.match(captureTeach({ env: s.env, arg: 'etl', body: '  \n' }), /nothing to capture/);
    assert.match(captureTeach({ env: s.env, arg: '../x', body: TEACH }), /slug/);
    assert.equal(existsSync(dataPaths(s.env).dataDir), false);
    assert.deepEqual(readAllLedger(s.env), []);
  } finally { s.cleanup(); }
});

test('captureTeach records raw diagrams, and warns on unparseable Excalidraw without failing', () => {
  const s = scratch();
  try {
    const m = captureTeach({ env: s.env, arg: 'etl', body: `${TEACH}\n\`\`\`mermaid\nflowchart TD\n A-->B\n\`\`\``, nowMs: NOW });
    assert.match(m, /with mermaid/);
    assert.deepEqual(readAllLedger(s.env)[0].diagrams, ['mermaid']);
    const w = captureTeach({ env: s.env, arg: 'etl2', body: `${TEACH}\n\`\`\`json\n{"type":"figma","elements":[]}\n\`\`\``, nowMs: NOW });
    assert.match(w, /Warning: excalidraw JSON block/);
  } finally { s.cleanup(); }
});

test('addEvidenceFile copies, hashes, writes a sidecar, ledgers; rejects a bad Excalidraw type', () => {
  const s = scratch();
  try {
    const src = join(s.dir, 'map.excalidraw');
    const text = '{"type":"excalidraw","version":2,"elements":[{"id":"a","type":"rectangle"}]}';
    writeFileSync(src, text);
    const r = addEvidenceFile({ env: s.env, topic: 'etl', filePath: src, project: 'bondly', nowMs: NOW });
    assert.equal(r.kind, 'excalidraw');
    assert.equal(readFileSync(r.path, 'utf8'), text);
    assert.equal(r.sha256, createHash('sha256').update(text).digest('hex'));
    assert.equal(JSON.parse(readFileSync(`${r.path}.meta.json`, 'utf8')).project, 'bondly');
    assert.equal(readAllLedger(s.env)[0].kind, 'excalidraw');
    assert.equal(latestEvidence(s.env, 'etl'), r.path, 'sidecars are never picked as evidence');
    writeFileSync(src, '{"type":"figma"}');
    assert.throws(() => addEvidenceFile({ env: s.env, topic: 'etl', filePath: src }), /not Excalidraw/);
    assert.throws(() => addEvidenceFile({ env: s.env, topic: 'Bad Topic', filePath: src }), /slug/);
    assert.throws(() => addEvidenceFile({ env: s.env, topic: 'etl', filePath: join(s.dir, 'nope.md') }), /cannot read/);
    const mm = join(s.dir, 'a.mmd'); writeFileSync(mm, 'flowchart TD\n A-->B\n');
    assert.equal(addEvidenceFile({ env: s.env, topic: 'etl', filePath: mm, nowMs: NOW + 5000 }).kind, 'mermaid');
  } finally { s.cleanup(); }
});

test('runGrade: pass writes a verdict file, ledgers transfer_grade, unlocks Tier 2, leaves a tutor note', async () => {
  const s = scratch();
  try {
    withManifest(s);
    captureTeach({ env: s.env, arg: 'etl --project gd-integrations', body: TEACH, nowMs: NOW });
    let seen;
    const out = await runGrade({
      repoRoot: s.repo, env: s.env, sessionId: 'sess', nowMs: NOW + 1000,
      invoke: async (ctx) => { seen = ctx.job; return PASS; },
    });
    assert.match(out, /passed/);
    assert.equal(seen.kind, 'transfer');
    assert.equal(seen.projectsPath, dataPaths(s.env).projectsManifests[1]);
    assert.equal('curriculumPath' in seen, false);
    assert.equal('summaryPath' in seen, false, 'no parser summary: the seam is simply absent');
    const verdictFile = join(dataPaths(s.env).verdictsDir('etl'), '2026-09-24T10-11-13Z.json');
    const v = JSON.parse(readFileSync(verdictFile, 'utf8'));
    assert.equal(v.verdict, 'unlocked');
    assert.equal(v.project, 'gd-integrations');
    assert.ok(Object.values(v.structure).every((x) => x === 'unknown'), 'no summary → G1–G5 unknown');
    const g = readAllLedger(s.env).find((e) => e.event === 'transfer_grade');
    assert.deepEqual([g.topic, g.project, g.kind, g.verdict], ['etl', 'gd-integrations', 'teach-back', 'unlocked']);
    assert.equal(g.criteria.P2, true);
    const st = readProjectState(s.repo, s.env);
    assert.equal(st.unlocked, true);
    assert.deepEqual(st.unlockedTopics, ['etl']);
    assert.match(st.pendingTutorNote, /stale is fine/);
  } finally { s.cleanup(); }
});

test('runGrade: a pass unlocks the project the evidence names, not the repo the command runs in', async () => {
  const s = scratch();
  try {
    withManifest(s);
    const here = join(s.dir, 'here');
    mkdirSync(projectPaths(here).dir, { recursive: true });
    captureTeach({ env: s.env, arg: 'etl --project gd-integrations', body: TEACH, nowMs: NOW });
    const out = await runGrade({ repoRoot: here, env: s.env, invoke: async () => PASS });
    assert.match(out, new RegExp(`Tier 2 is unlocked for gd-integrations \\(${s.repo}\\)`));
    assert.equal(readProjectState(here, s.env).unlocked, false);
    assert.match(readProjectState(here, s.env).pendingTutorNote, /stale is fine/, 'the tutor note stays where the developer is');
    assert.equal(readProjectState(s.repo, s.env).unlocked, true);
    assert.deepEqual(readProjectState(s.repo, s.env).unlockedTopics, ['etl']);
  } finally { s.cleanup(); }
});

test('runGrade: a pass whose project does not resolve to a governed repo is recorded but unlocks nothing', async () => {
  const cases = [
    ['etl', [1, JSON.stringify([])], /Not unlocked: the evidence names no project/],
    ['etl --project gd-integrations', [2, '- gd-integrations: nightly ETL\n'], /Not unlocked: .*projects\.md gives no path for project "gd-integrations"/],
    ['etl --project gd-integrations', [1, JSON.stringify([{ name: 'gd-integrations', path: 'elsewhere' }])], /Not unlocked: .*elsewhere \(project "gd-integrations"\) is not a governed repo/],
  ];
  for (const [arg, manifest, why] of cases) {
    const s = scratch();
    try {
      withManifest(s, manifest);
      captureTeach({ env: s.env, arg, body: TEACH, nowMs: NOW });
      const out = await runGrade({ repoRoot: s.repo, env: s.env, invoke: async () => PASS });
      assert.match(out, /passed/);
      assert.match(out, why);
      assert.equal(out.split('\n').length, 2, 'one line says why');
      assert.equal(readProjectState(s.repo, s.env).unlocked, false);
      assert.deepEqual(readProjectState(s.repo, s.env).unlockedTopics, []);
      const g = readAllLedger(s.env).find((e) => e.event === 'transfer_grade');
      assert.deepEqual([g.topic, g.verdict], ['etl', 'unlocked']);
    } finally { s.cleanup(); }
  }
});

test('runGrade grades the evidence captured last, even within one second and across kinds', async () => {
  const s = scratch();
  try {
    withManifest(s);
    const a = join(s.dir, 'a.md'); writeFileSync(a, `${TEACH} (a)`);
    const b = join(s.dir, 'b.md'); writeFileSync(b, `${TEACH} (b)`);
    addEvidenceFile({ env: s.env, topic: 'etl', filePath: a, nowMs: NOW });
    const second = addEvidenceFile({ env: s.env, topic: 'etl', filePath: b, nowMs: NOW });
    assert.equal(latestEvidence(s.env, 'etl'), second.path);
    const mm = join(s.dir, 'm.mmd'); writeFileSync(mm, 'flowchart TD\n A-->B\n');
    const mermaid = addEvidenceFile({ env: s.env, topic: 'etl', filePath: mm, nowMs: NOW });
    assert.equal(latestEvidence(s.env, 'etl'), mermaid.path);
    captureTeach({ env: s.env, arg: 'etl', body: `${TEACH} (c)`, nowMs: NOW });
    let seen;
    await runGrade({ env: s.env, topic: 'etl', invoke: async (ctx) => { seen = ctx.job; return PASS; } });
    assert.match(readFileSync(seen.evidencePath, 'utf8'), /\(c\)/);
  } finally { s.cleanup(); }
});

test('newest evidence and the default topic come from the data home alone, with no ledger', async () => {
  const s = scratch();
  try {
    withManifest(s);
    captureTeach({ env: s.env, arg: 'etl', body: `${TEACH} (old)`, nowMs: NOW });
    captureTeach({ env: s.env, arg: 'joins', body: `${TEACH} (a)`, nowMs: NOW + 2000 });
    const mm = join(s.dir, 'm.mmd'); writeFileSync(mm, 'flowchart TD\n A-->B\n');
    const last = addEvidenceFile({ env: s.env, topic: 'joins', filePath: mm, nowMs: NOW + 2000 });
    rmSync(homePaths(s.env).stateDir, { recursive: true, force: true });
    assert.equal(lastEvidenceTopic(s.env), 'joins');
    assert.equal(latestEvidence(s.env, 'joins'), last.path);
    assert.match(latestEvidence(s.env, 'etl'), /-01-teach\.md$/);
    let seen;
    await runGrade({ env: s.env, invoke: async (ctx) => { seen = ctx.job; return PASS; } });
    assert.equal(seen.evidencePath, last.path);
  } finally { s.cleanup(); }
});

test('runGrade rejects a topic that is not a slug and writes nothing', async () => {
  const s = scratch();
  try {
    withManifest(s);
    await assert.rejects(runGrade({ env: s.env, topic: '../../x', invoke: async () => PASS }), /slug/);
    assert.deepEqual(readAllLedger(s.env), []);
    assert.equal(existsSync(join(dataPaths(s.env).dataDir, 'verdicts')), false);
  } finally { s.cleanup(); }
});

test('runGrade: a summary file plugs in through summaryPath, and curriculumPath is passed when it exists', async () => {
  const s = scratch();
  try {
    withManifest(s);
    const dp = dataPaths(s.env);
    mkdirSync(join(dp.dataDir, 'curricula', 'etl'), { recursive: true });
    writeFileSync(dp.curriculumFile('etl'), '### Where the join happens\n');
    const src = join(s.dir, 'a.mmd');
    writeFileSync(src, 'flowchart TD\n P[Join placement] -->|apply because reads dominate| G[gd-integrations dashboard]\n G --> Q[nightly ETL]\n');
    const { path } = addEvidenceFile({ env: s.env, topic: 'etl', filePath: src, nowMs: NOW });
    writeFileSync(summaryPathFor(path), JSON.stringify({ version: 1, diagrams: [{ kind: 'mermaid', nodes: [{ id: 'P' }, { id: 'G' }, { id: 'Q' }], edges: [] }] }));
    let seen;
    await runGrade({ env: s.env, topic: 'etl', invoke: async (ctx) => { seen = ctx.job; return PASS; } });
    assert.equal(seen.summaryPath, summaryPathFor(path));
    assert.equal(seen.curriculumPath, dp.curriculumFile('etl'));
    const [vf] = readdirSync(dp.verdictsDir('etl')).filter((n) => !n.includes('.job.'));
    assert.equal(JSON.parse(readFileSync(join(dp.verdictsDir('etl'), vf), 'utf8')).structure.G1, 'met');
  } finally { s.cleanup(); }
});

test('runGrade: prefilter reject (source_paste) is not_yet with no model call; not_yet leaves the tutor a question', async () => {
  const s = scratch();
  try {
    withManifest(s);
    captureTeach({ env: s.env, arg: 'etl', body: 'see https://example.com/some-chapter', nowMs: NOW });
    let called = false;
    const out = await runGrade({ repoRoot: s.repo, env: s.env, invoke: async () => { called = true; return PASS; } });
    assert.equal(called, false);
    assert.match(out, /source_paste/);
    assert.equal(readProjectState(s.repo, s.env).unlocked, false);
    assert.match(readProjectState(s.repo, s.env).pendingTutorNote, /next_smaller_question/);
  } finally { s.cleanup(); }
});

test('runGrade: a missing manifest, topic, or evidence is a clear error, not a silent pass', async () => {
  const s = scratch();
  try {
    await assert.rejects(runGrade({ env: s.env }), /no topic/);
    await assert.rejects(runGrade({ env: s.env, topic: 'etl' }), /no evidence for "etl"/);
    captureTeach({ env: s.env, arg: 'etl', body: TEACH, nowMs: NOW });
    await assert.rejects(runGrade({ env: s.env, topic: 'etl' }), /no project manifest/);
  } finally { s.cleanup(); }
});

test('runGrade: a grader failure or torn verdict rounds down', async () => {
  const s = scratch();
  try {
    withManifest(s);
    captureTeach({ env: s.env, arg: 'etl', body: TEACH, nowMs: NOW });
    const boom = await runGrade({ repoRoot: s.repo, env: s.env, invoke: async () => { throw new Error('x'); } });
    assert.match(boom, /^not_yet \(grader_failure/);
    const torn = await runGrade({ repoRoot: s.repo, env: s.env, invoke: async () => ({ ...PASS, torn: true }) });
    assert.match(torn, /^not_yet/);
  } finally { s.cleanup(); }
});

test('runCheck --project puts the project on the check_grade ledger row', async () => {
  const s = scratch();
  try {
    const dir = join(projectPaths(s.repo).checksDir, 't1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'rubric.json'), JSON.stringify({ Q1: 'names the cause' }));
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(join(dir, 'answer.md'), 'because the cache is stale');
    await runCheck({ repoRoot: s.repo, env: s.env, task: 't1', project: 'bondly', invoke: async () => ({ criteria: { Q1: { met: true, span: 'stale' } } }) });
    const row = readAllLedger(s.env).find((e) => e.event === 'check_grade');
    assert.equal(row.project, 'bondly');
  } finally { s.cleanup(); }
});
