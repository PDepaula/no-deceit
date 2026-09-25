import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasHandoverLabel, endsWithQuestion, isShortTurn, checkTurnEnding, wordCount } from './handover.mjs';
import { decideTextChannel, REASONS } from './policy.mjs';

const T1 = { tier: 1, mode: 'coach', t2Unlocked: false, t3Active: false, t3PreamblePresent: false, notes: [] };
const T2_LOCKED = { ...T1, tier: 2 };
const T2_UNLOCKED = { ...T1, tier: 2, t2Unlocked: true };
const T3 = { ...T1, tier: 3, t3Active: true, t3PreamblePresent: true };

const LONG = 'The orders table mixes header and line data, so every read of a single order fans out across duplicated rows and the join that should happen once at load time happens on every query instead. '.repeat(2);

test('label: a Handing over: line with a value counts; empty or absent does not', () => {
  assert.equal(hasHandoverLabel('Blah.\nHanding over: the join placement'), true);
  assert.equal(hasHandoverLabel('**Handing over:** the join placement'), true);
  assert.equal(hasHandoverLabel('Handing over:'), false);
  assert.equal(hasHandoverLabel('Handing over: **'), false);
  assert.equal(hasHandoverLabel('I am handing over the design'), false);
});

test('question ending: last prose line, ignoring trailing markup', () => {
  assert.equal(endsWithQuestion('Thoughts.\nWhich join moves first?'), true);
  assert.equal(endsWithQuestion('Thoughts.\n**Which join moves first?**'), true);
  assert.equal(endsWithQuestion('Which one?\n```\nx\n```'), false);
  assert.equal(endsWithQuestion('Which one? Ok here you go.'), false);
  assert.equal(endsWithQuestion(''), false);
});

test('short turn: under 40 words, no fence, no project noun', () => {
  assert.equal(isShortTurn('Captured. Ready when you are.'), true);
  assert.equal(isShortTurn('Captured, bondly is next.', { projectNouns: ['Bondly'] }), false);
  assert.equal(isShortTurn('Ok.\n```\nx\n```'), false);
  assert.equal(isShortTurn('word '.repeat(40)), false);
  assert.equal(wordCount('  a b  c '), 3);
});

test('checkTurnEnding: long unlabelled statement fails; label, question, short pass', () => {
  assert.equal(checkTurnEnding(LONG).ok, false);
  assert.equal(checkTurnEnding(LONG + '\nHanding over: the split').ok, true);
  assert.equal(checkTurnEnding(LONG + '\nWhat would you split first?').ok, true);
  assert.equal(checkTurnEnding('Captured. Ready when you are.').ok, true);
});

test('T1 and locked T2: an unlabelled long statement is a question_ending violation', () => {
  for (const e of [T1, T2_LOCKED]) {
    const r = decideTextChannel(e, { text: LONG });
    assert.equal(r.decision, 'block');
    assert.equal(r.kind, 'question_ending');
    assert.equal(r.reason, REASONS.T_QUESTION_ENDING);
  }
});

test('the question-ending block fires once: the stop-hook retry is allowed', () => {
  assert.equal(decideTextChannel(T1, { text: LONG, stopHookActive: true }).decision, 'allow');
});

test('T1: a labelled turn passes and reports labelled', () => {
  const r = decideTextChannel(T1, { text: LONG + '\nHanding over: the split' });
  assert.equal(r.decision, 'allow');
  assert.equal(r.labelled, true);
});

test('a label does not excuse a big code fence or a diagram fence', () => {
  const big = 'Handing over: fix\n```js\n' + 'a\n'.repeat(8) + '```\n';
  assert.equal(decideTextChannel(T1, { text: big }).kind, 'chat_fence');
  const dia = 'Handing over: design\n```mermaid\ngraph TD\n```\n';
  assert.equal(decideTextChannel(T1, { text: dia }).kind, 'chat_diagram');
});

test('T2 unlocked and T3: the question-ending rule does not apply', () => {
  assert.equal(decideTextChannel(T2_UNLOCKED, { text: LONG }).decision, 'allow');
  assert.equal(decideTextChannel(T3, { text: LONG }).decision, 'allow');
});

test('handoverActive: fences, diagrams, and the question rule are relaxed, the label is required', () => {
  const dia = 'Here.\n```mermaid\ngraph TD\n  a-->b\n```\nHanding over: the flow';
  const r = decideTextChannel(T2_LOCKED, { text: dia, handoverActive: true });
  assert.equal(r.decision, 'allow');
  assert.equal(r.labelled, true);
  const bare = decideTextChannel(T2_LOCKED, { text: LONG, handoverActive: true });
  assert.equal(bare.decision, 'block');
  assert.equal(bare.kind, 'handover_unlabelled');
  assert.equal(decideTextChannel(T2_LOCKED, { text: LONG, handoverActive: true, stopHookActive: true }).decision, 'allow');
});
