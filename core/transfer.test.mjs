import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSFER_RUBRIC, STRUCTURE_RUBRIC, transferPass, finalizeTransferVerdict, normalizeStructure,
} from './rubric.mjs';
import { prefilterTransfer, sourceOverlap, proseOf } from './prefilter.mjs';
import { buildGraderJob, assertJobBlind, JOB_KEYS, graderSpawnPlan } from './grader-job.mjs';
import { parseGraderOutput } from './grader-parse.mjs';

const met = (...ids) => Object.fromEntries(ids.map((i) => [i, { met: true, span: `span ${i}` }]));

test('rubric has P1–P5 and G1–G5', () => {
  assert.deepEqual(Object.keys(TRANSFER_RUBRIC), ['P1', 'P2', 'P3', 'P4', 'P5']);
  assert.deepEqual(Object.keys(STRUCTURE_RUBRIC), ['G1', 'G2', 'G3', 'G4', 'G5']);
});

test('transferPass = P1 ∧ P2 ∧ P4 ∧ (P3 ∨ P5)', () => {
  assert.equal(transferPass({ P1: true, P2: true, P4: true, P3: true }), true);
  assert.equal(transferPass({ P1: true, P2: true, P4: true, P5: true }), true);
  assert.equal(transferPass({ P1: true, P2: true, P4: true }), false);
  assert.equal(transferPass({ P1: true, P2: true, P3: true, P5: true }), false); // no judgment
  assert.equal(transferPass({ P1: true, P4: true, P3: true }), false); // no project locus
  assert.equal(transferPass({ P2: true, P4: true, P3: true }), false);
  assert.equal(transferPass({}), false);
});

test('finalizeTransferVerdict is mechanical: rounds down, never upgrades, span required', () => {
  const pass = met('P1', 'P2', 'P4', 'P3');
  assert.equal(finalizeTransferVerdict({ rawCriteria: pass }).verdict, 'unlocked');
  assert.equal(finalizeTransferVerdict({ rawCriteria: pass, llmVerdict: 'not_yet' }).verdict, 'not_yet');
  assert.equal(finalizeTransferVerdict({ rawCriteria: pass, torn: true }).verdict, 'not_yet');
  assert.equal(finalizeTransferVerdict({ rawCriteria: met('P1'), llmVerdict: 'unlocked' }).verdict, 'not_yet');
  const noSpan = { ...pass, P4: { met: true, span: '' } };
  const r = finalizeTransferVerdict({ rawCriteria: noSpan });
  assert.equal(r.verdict, 'not_yet');
  assert.equal(r.criteria.P4.rounded_down, 'met without span');
});

test('G structure: unknown without a summary, and G5 always unknown (needs a render); never fails the verdict', () => {
  const raw = { G1: 'met', G2: 'unmet', G3: 'met', G4: 'unmet', G5: 'met' };
  assert.deepEqual(Object.values(normalizeStructure(raw)), ['unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
  assert.deepEqual(normalizeStructure(raw, { hasSummary: true }), { G1: 'met', G2: 'unmet', G3: 'met', G4: 'unmet', G5: 'unknown' });
  assert.equal(normalizeStructure({ G1: 'maybe' }, { hasSummary: true }).G1, 'unknown');
  const r = finalizeTransferVerdict({ rawCriteria: met('P1', 'P2', 'P4', 'P5'), rawStructure: { G2: 'unmet' }, hasSummary: true });
  assert.equal(r.verdict, 'unlocked');
  assert.equal(r.structure.G2, 'unmet');
});

test('prefilterTransfer: empty, too_short, source_paste (excerpt and bare URL), too_few_nodes', () => {
  const src = 'An ETL-time join materialises the combined rows ahead of any read, so the cost is paid once per load instead of once per read.';
  assert.equal(prefilterTransfer('  ').reason, 'empty');
  assert.equal(prefilterTransfer('short thing').reason, 'too_short');
  assert.equal(prefilterTransfer(src, { sourceTexts: [`## Mechanism\n${src} The end.`] }).reason, 'source_paste');
  assert.equal(prefilterTransfer('see https://example.com/chapter-10 for it').reason, 'source_paste');
  const own = 'In my words: doing the join during the load means readers get finished rows and only pay once, at the price of staleness, which suits gd-integrations.';
  assert.equal(prefilterTransfer(own, { sourceTexts: [src] }).ok, true);
  const tiny = { diagrams: [{ kind: 'mermaid', nodes: [{ id: 'a' }, { id: 'b' }] }] };
  assert.equal(prefilterTransfer('flowchart TD\n a --> b', { summary: tiny, diagramFile: true }).reason, 'too_few_nodes');
  // No summary: nothing fails because a summary is missing.
  assert.equal(prefilterTransfer('flowchart TD\n a --> b', { diagramFile: true }).ok, true);
  assert.equal(sourceOverlap('one two', ['one two']), 0); // fewer than one 5-word run
  assert.equal(proseOf('words\n```mermaid\nA-->B\n```\nmore').includes('A-->B'), false);
});

test('transfer job carries curriculumPath/projectsPath/summaryPath and stays blind', () => {
  for (const k of ['curriculumPath', 'projectsPath', 'summaryPath']) assert.ok(JOB_KEYS.includes(k));
  const job = buildGraderJob({ kind: 'transfer', evidencePath: '/e', projectsPath: '/p', curriculumPath: '/c', summaryPath: '/e.summary.json', outputPath: '/o' });
  assert.equal(job.route, 'transfer');
  assert.deepEqual(job.rubric, TRANSFER_RUBRIC);
  assert.equal(assertJobBlind(job), true);
  assert.equal('summaryPath' in buildGraderJob({ kind: 'transfer', evidencePath: '/e', projectsPath: '/p' }), false);
  assert.throws(() => assertJobBlind({ ...job, transcript: 'x' }), /forbidden/);
  assert.throws(() => assertJobBlind({ ...job, chat: 'x' }), /forbidden/);
  assert.throws(() => assertJobBlind({ ...job, notes: 'x' }), /unknown field/);
  assert.throws(() => assertJobBlind(buildGraderJob({ kind: 'transfer', evidencePath: '/e' })), /projects manifest/);
  assert.match(graderSpawnPlan({ pluginRoot: '/r', jobPath: '/j' }).args.at(-1), /projectsPath, summaryPath/);
});

test('parseGraderOutput transfer: verdict recomputed, structure normalised, garbage rounds down', () => {
  const out = JSON.stringify({
    verdict: 'unlocked', criteria: met('P1', 'P2', 'P4', 'P3'), structure: { G1: 'met', G3: 'unmet' },
    error_class: 'conceptual', misconceptions: ['late joins always win'],
  });
  const withSummary = parseGraderOutput(out, { kind: 'transfer', hasSummary: true });
  assert.equal(withSummary.verdict, 'unlocked');
  assert.equal(withSummary.structure.G1, 'met');
  assert.deepEqual(withSummary.misconceptions, ['late joins always win']);
  const raw = parseGraderOutput(out, { kind: 'transfer' });
  assert.equal(raw.structure.G1, 'unknown');
  const bad = parseGraderOutput('no json here', { kind: 'transfer' });
  assert.equal(bad.verdict, 'not_yet');
  assert.equal(bad.parse_error, true);
});
