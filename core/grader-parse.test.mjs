import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, parseGraderOutput } from './grader-parse.mjs';

test('extractJson reads a bare object', () => {
  assert.deepEqual(extractJson('{"verdict":"not_yet"}'), { verdict: 'not_yet' });
});

test('extractJson reads a fenced object and ignores leading prose', () => {
  const s = 'Here you go:\n```json\n{"verdict":"unlocked","criteria":{}}\n```\nthanks';
  assert.equal(extractJson(s).verdict, 'unlocked');
});

test('extractJson returns null on empty or non-json', () => {
  assert.equal(extractJson(''), null);
  assert.equal(extractJson('sorry I cannot'), null);
});

test('parseGraderOutput on invalid JSON yields not_yet with no criteria met', () => {
  const r = parseGraderOutput('not json', { route: 'mental-model' });
  assert.equal(r.verdict, 'not_yet');
  assert.equal(r.parse_error, true);
  assert.equal(r.criteria.R1.met, false);
});

test('parseGraderOutput applies the mechanical formula, not the model verdict', () => {
  const r = parseGraderOutput(JSON.stringify({
    verdict: 'unlocked',
    criteria: {
      R1: { met: true, span: 'supposed to walk cells' },
      R2: { met: true, span: 'returned nil' },
      R3: { met: false, span: null },
      R4: { met: true, span: 'tried quoting' },
    },
    error_class: 'conceptual',
    misconceptions: ['dotted pairs are lists'],
    next_smaller_question: 'What does the walker do on a cons whose cdr is not a list?',
    rubric_gap: [],
  }), { route: 'mental-model' });
  assert.equal(r.verdict, 'not_yet'); // no R3
  assert.equal(r.error_class, 'conceptual');
  assert.equal(r.misconceptions.length, 1);
});

test('parseGraderOutput torn: true rounds down a passing formula', () => {
  const r = parseGraderOutput(JSON.stringify({
    verdict: 'unlocked',
    torn: true,
    criteria: {
      R1: { met: true, span: 'mech' },
      R2: { met: true, span: 'nil' },
      R3: { met: true, span: 'I think X because Y' },
      R4: { met: false, span: null },
    },
  }), { route: 'mental-model' });
  assert.equal(r.verdict, 'not_yet');
});

test('parseGraderOutput check kind returns landed|partial|not_landed', () => {
  const r = parseGraderOutput(JSON.stringify({
    verdict: 'landed',
    criteria: { Q1: { met: true, span: 'the queue' }, Q2: { met: false } },
    misconceptions: ['thinks it is a stack'],
  }), { kind: 'check' });
  assert.equal(r.verdict, 'partial');
});
