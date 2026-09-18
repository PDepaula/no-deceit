import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mentalPass,
  commitPass,
  normalizeCriteria,
  finalizeUnlockVerdict,
  finalizeCheckVerdict,
  suggestDomainMode,
  MENTAL_IDS,
  COMMIT_IDS,
} from './rubric.mjs';

test('mental unlock requires R1 and R3 plus one of R2/R4', () => {
  assert.equal(mentalPass({ R1: true, R2: false, R3: true, R4: true }), true);
  assert.equal(mentalPass({ R1: true, R2: true, R3: true, R4: false }), true);
  assert.equal(mentalPass({ R1: true, R2: true, R3: true, R4: true }), true);
});

test('mental unlock fails without R1 even if everything else is met', () => {
  assert.equal(mentalPass({ R1: false, R2: true, R3: true, R4: true }), false);
});

test('mental unlock fails without R3 even if everything else is met', () => {
  assert.equal(mentalPass({ R1: true, R2: true, R3: false, R4: true }), false);
});

test('mental unlock fails when R1 and R3 are met but neither R2 nor R4', () => {
  assert.equal(mentalPass({ R1: true, R2: false, R3: true, R4: false }), false);
});

test('commit unlock requires C1 and C2; C3 is not required to pass', () => {
  assert.equal(commitPass({ C1: true, C2: true, C3: false }), true);
  assert.equal(commitPass({ C1: true, C2: false, C3: true }), false);
  assert.equal(commitPass({ C1: false, C2: true, C3: true }), false);
});

test('a criterion marked met without a quoted span is rounded down to unmet', () => {
  const n = normalizeCriteria('mental-model', {
    R1: { met: true, span: 'the walker cons-recurses' },
    R2: { met: true },
    R3: { met: true, span: 'I think dotted pairs skip the cdr' },
    R4: { met: false },
  });
  assert.equal(n.R1.met, true);
  assert.equal(n.R2.met, false);
  assert.ok(n.R2.rounded_down);
});

test('missing or non-boolean met is treated as unmet (round down)', () => {
  const n = normalizeCriteria('mental-model', {
    R1: { met: 'torn', span: 'maybe' },
    R3: { met: true, span: 'because Y' },
  });
  assert.equal(n.R1.met, false);
  assert.equal(n.R2.met, false);
  assert.equal(n.R3.met, true);
  assert.equal(n.R4.met, false);
});

test('finalizeUnlockVerdict is mechanical: LLM saying unlocked cannot upgrade a fail', () => {
  const r = finalizeUnlockVerdict({
    route: 'mental-model',
    rawCriteria: {
      R1: { met: true, span: 'supposed to parse' },
      R2: { met: false, span: null },
      R3: { met: false, span: null },
      R4: { met: false, span: null },
    },
    llmVerdict: 'unlocked',
  });
  assert.equal(r.verdict, 'not_yet');
});

test('finalizeUnlockVerdict rounds down when torn even if the formula would pass', () => {
  const r = finalizeUnlockVerdict({
    route: 'mental-model',
    rawCriteria: {
      R1: { met: true, span: 'mechanism' },
      R2: { met: true, span: 'REPL nil' },
      R3: { met: true, span: 'I think X because Y' },
      R4: { met: false, span: null },
    },
    torn: true,
  });
  assert.equal(r.verdict, 'not_yet');
});

test('finalizeUnlockVerdict unlocks only when the formula passes and not torn', () => {
  const r = finalizeUnlockVerdict({
    route: 'mental-model',
    rawCriteria: {
      R1: { met: true, span: 'mechanism' },
      R2: { met: true, span: 'REPL nil' },
      R3: { met: true, span: 'I think X because Y' },
      R4: { met: false, span: null },
    },
  });
  assert.equal(r.verdict, 'unlocked');
});

test('finalizeCheckVerdict: all met → landed; some → partial; none → not_landed', () => {
  assert.equal(finalizeCheckVerdict({ Q1: { met: true, span: 'a' }, Q2: { met: true, span: 'b' } }).verdict, 'landed');
  assert.equal(finalizeCheckVerdict({ Q1: { met: true, span: 'a' }, Q2: { met: false } }).verdict, 'partial');
  assert.equal(finalizeCheckVerdict({ Q1: { met: false }, Q2: { met: false } }).verdict, 'not_landed');
});

test('finalizeCheckVerdict rounds a torn criterion down, so all-torn is not_landed', () => {
  const r = finalizeCheckVerdict({ Q1: { met: 'torn', span: 'x' }, Q2: { met: true } });
  assert.equal(r.verdict, 'not_landed');
});

test('suggestDomainMode: repeated conceptual ⇒ coach; mostly slip ⇒ pair', () => {
  assert.equal(suggestDomainMode(['conceptual', 'conceptual', 'slip']), 'coach');
  assert.equal(suggestDomainMode(['slip', 'slip', 'slip', 'conceptual']), 'pair');
  assert.equal(suggestDomainMode([]), null);
});

test('suggestDomainMode: insufficient data ⇒ no suggestion', () => {
  assert.equal(suggestDomainMode(['conceptual']), null);
  assert.equal(suggestDomainMode(['slip']), null);
  assert.equal(suggestDomainMode(['conceptual', 'slip']), null);
});

test('rubric ids are the published binary criteria', () => {
  assert.deepEqual(MENTAL_IDS, ['R1', 'R2', 'R3', 'R4']);
  assert.deepEqual(COMMIT_IDS, ['C1', 'C2', 'C3']);
});
