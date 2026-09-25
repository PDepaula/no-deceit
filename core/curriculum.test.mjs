import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTierArgs, curriculumReady, tier1Refusal, keywordsFromSealed, renderKeywordItems, replaceKeywordSection,
  checkKeywordList, checkOpen, checkSealed, checkCurriculum, reviewView, setFrontmatterScalar, isReviewed,
  parseConcepts, parseSources, curriculumContext, escapeKeyword,
} from './curriculum.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'curriculum');
const open = readFileSync(join(FIX, 'open.md'), 'utf8');
const sealed = readFileSync(join(FIX, 'sealed.md'), 'utf8');

test('parseTierArgs: positional topic, --topic, --no-topic, and errors', () => {
  assert.deepEqual(parseTierArgs('1 etl-basics'), { tier: '1', topic: 'etl-basics', clearTopic: false, error: null });
  assert.equal(parseTierArgs('1 --topic etl').topic, 'etl');
  assert.equal(parseTierArgs(['2', '--no-topic']).clearTopic, true);
  assert.equal(parseTierArgs('2').topic, null);
  assert.match(parseTierArgs('1 ../x').error, /must be a slug/);
  assert.match(parseTierArgs('3 etl').error, /not to a Tier 3/);
  assert.match(parseTierArgs('1 etl --no-topic').error, /not both/);
  assert.equal(parseTierArgs('1 --topic=etl').error, 'unknown option --topic=etl; use --topic <t> or --no-topic');
  assert.equal(parseTierArgs('1 -x').error, 'unknown option -x; use --topic <t> or --no-topic');
  assert.equal(parseTierArgs('1 --topic').error, '--topic needs a value');
  assert.equal(parseTierArgs('1 --topic --no-topic').error, '--topic needs a value');
  assert.equal(parseTierArgs('1 etl extra').error, 'unexpected argument extra');
  assert.equal(parseTierArgs('1 --topic etl other').error, 'unexpected argument other');
  assert.equal(parseTierArgs('1 etl --topic other').error, 'unexpected argument other');
});

test('curriculumReady: both files, non-trivial, mission and a concept', () => {
  assert.equal(curriculumReady({ open, sealed }).ok, true);
  assert.deepEqual(curriculumReady({ open: null, sealed }).missing, ['open.md does not exist']);
  assert.match(curriculumReady({ open, sealed: null }).missing[0], /sealed\.md does not exist/);
  assert.match(curriculumReady({ open: 'tiny', sealed }).missing[0], /too short/);
  assert.match(curriculumReady({ open: open.replace(/^mission:.*\n/m, ''), sealed }).missing[0], /no mission/);
  assert.match(curriculumReady({ open, sealed: 'x'.repeat(400) }).missing[0], /no concept/);
  assert.equal(curriculumReady({ open: 'a', sealed: 'b', minChars: 1 }).ok, false);
});

test('tier1Refusal names both ways to get a curriculum', () => {
  assert.doesNotMatch(tier1Refusal('etl', ['sealed.md does not exist']), /--no-topic/);
  assert.match(tier1Refusal('etl', ['sealed.md does not exist'], { stored: true }), /nd tier 1 --no-topic/);
  const m = tier1Refusal('etl', ['sealed.md does not exist']);
  assert.match(m, /nd curriculum build etl/);
  assert.match(m, /write open\.md and sealed\.md yourself/);
});

test('keywordsFromSealed: union, case-insensitive dedupe, alphabetical, hints tracked', () => {
  const { keywords, hints } = keywordsFromSealed(sealed);
  assert.deepEqual(keywords, ['batch', 'join', 'materialised view', 'query time', 'replay', 'staleness', 'stream']);
  assert.deepEqual(hints, [{ concept: 'C2', term: 'query time', why: 'no neutral term names the read-side option' }]);
});

test('renderKeywordItems escapes emphasis characters and replaceKeywordSection swaps only that section', () => {
  assert.equal(renderKeywordItems(['*in*', 'a_b']), '- \\*in\\*\n- a\\_b');
  assert.equal(escapeKeyword('->'), '->');
  const out = replaceKeywordSection(open, ['alpha', 'beta']);
  assert.match(out, /## Keywords\n\n- alpha\n- beta\n$/);
  assert.ok(out.includes('### Session 2'));
  assert.deepEqual(checkKeywordList(out), []);
});

test('checkKeywordList: the fixture is clean; each rule violation is named', () => {
  assert.deepEqual(checkKeywordList(open), []);
  const mk = (body) => `## Keywords\n\n${body}\n`;
  const codes = (body) => checkKeywordList(mk(body)).map((p) => p.code);
  assert.deepEqual(codes('- b\n- a'), ['not_alphabetical']);
  assert.deepEqual(codes('- a\n- A'), ['duplicate']);
  assert.deepEqual(codes('- **a**'), ['emphasis']);
  assert.deepEqual(codes('- `a`'), ['emphasis']);
  assert.deepEqual(codes('- \\*a\\*'), []);
  assert.deepEqual(codes('- a — the first letter'), ['definition']);
  assert.deepEqual(codes('- a: the first letter'), ['definition']);
  assert.deepEqual(codes('- one two three four five six seven'), ['too_long']);
  assert.deepEqual(codes('### Group\n- a'), ['heading']);
  assert.deepEqual(codes('Some intro.\n- a'), ['prose']);
  assert.deepEqual(codes('- a\n\n- b'), ['grouped']);
  assert.deepEqual(codes(''), ['empty']);
  assert.deepEqual(checkKeywordList('# no section'), [{ code: 'no_section' }]);
});

test('checkOpen / checkSealed / checkCurriculum accept the fixture', () => {
  assert.deepEqual(checkOpen(open), []);
  assert.deepEqual(checkSealed(sealed), []);
  assert.deepEqual(checkCurriculum({ open, sealed }), { ok: true, problems: [] });
});

test('checkOpen flags unstructured sources and thin sessions', () => {
  const bad = open.replace(/    access: paid\n/, '').replace('- Unlocks: naming where each join in the report happens.\n', '');
  const p = checkOpen(bad);
  assert.ok(p.some((x) => /source S1 has no access/.test(x)));
  assert.ok(p.some((x) => /session 1 has no "- Unlocks:"/.test(x)));
  assert.ok(checkOpen(open.replace('access: open', 'access: sometimes')).some((x) => /access must be one of/.test(x)));
});

test('checkSealed flags missing criteria, kind, untagged traps, hint reason and undeclared steps', () => {
  const p1 = checkSealed(sealed.replace('  Criteria: Names a real job, states what input becomes unbounded, names one cost (late records, replay) and a condition under which the batch is still better.\n', ''));
  assert.ok(p1.some((x) => /C1: every transfer prompt needs its Criteria/.test(x)));
  assert.ok(checkSealed(sealed.replace('**Kind.** concept\n**Threshold.** yes', '**Kind.** idea\n**Threshold.** yes')).some((x) => /C1: kind must be/.test(x)));
  assert.ok(checkSealed(sealed.replace('(from: common-usage)', '')).some((x) => /origin tag/.test(x)));
  assert.ok(checkSealed(sealed.replace(' (no neutral term names the read-side option)', '')).some((x) => /hint keyword/.test(x)));
  const withSteps = sealed.replace('part: sealed\n', 'part: sealed\nsteps:\n  - id: 1\n    title: "x"\n').replace('**Depends on.** C1\n', '**Unlocks.** 9\n**Depends on.** C1\n');
  assert.ok(checkSealed(withSteps).some((x) => /not a declared step/.test(x)));
  assert.deepEqual(checkSealed('no concepts here'), ['sealed.md has no concept ("### C1. Title" heading)']);
});

test('parseConcepts and parseSources read the structured parts', () => {
  const cs = parseConcepts(sealed);
  assert.deepEqual(cs.map((c) => c.id), ['C1', 'C2']);
  assert.equal(cs[0].fields.kind, 'concept');
  assert.match(cs[1].fields['transfer prompts'], /Criteria:/);
  const src = parseSources(open);
  assert.equal(src.length, 2);
  assert.deepEqual([src[0].id, src[0].access, src[1].url], ['S1', 'paid', 'https://example.invalid/pipeline']);
});

test('reviewView shows mission, sources and outline, never keywords or sealed content', () => {
  const v = reviewView(open);
  assert.match(v, /Mission: I own a small reporting pipeline/);
  assert.match(v, /S1 Designing Data-Intensive Applications/);
  assert.match(v, /### Session 1/);
  assert.match(v, /Keywords: 7 \(not shown/);
  assert.doesNotMatch(v, /materialised view/);
  assert.doesNotMatch(v, /Claim|Mechanism|trap/i);
});

test('setFrontmatterScalar replaces or adds a key; isReviewed reads it', () => {
  assert.equal(isReviewed(open), false);
  const yes = setFrontmatterScalar(open, 'reviewed', 'yes');
  assert.equal(isReviewed(yes), true);
  assert.equal(yes.match(/^reviewed:/gm).length, 1);
  assert.match(setFrontmatterScalar('---\ntopic: a\n---\nbody', 'built', 'today'), /^---\ntopic: a\nbuilt: today\n---\nbody$/);
});

test('curriculumContext: paths and the never-quote rule; sealed stays sealed at Tier 2 too', () => {
  const t1 = curriculumContext({ topic: 'etl', openPath: '/d/open.md', sealedPath: '/d/sealed.md', tier: 1 });
  assert.match(t1, /learner part \/d\/open\.md; sealed part \/d\/sealed\.md/);
  assert.match(t1, /never quote, recite, paraphrase or summarise/);
  assert.match(t1, /never reveal a concept before the developer has attempted it/);
  assert.match(t1, /ask why they grouped it that way/);
  assert.match(t1, /not yet reviewed/);
  assert.match(curriculumContext({ topic: 'etl', openPath: 'o', sealedPath: 's', tier: 2, reviewed: true }), /still stays sealed/);
  assert.match(curriculumContext({ topic: 'etl', ready: false }), /no ready curriculum/);
  assert.equal(curriculumContext({ topic: null }), '');
});
