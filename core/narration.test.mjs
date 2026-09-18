import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNarrationFormat } from './narration.mjs';

test('a what/why heading plus a divergence line passes', () => {
  const text = [
    '## What / why',
    'Editing the classifier so unknown Bash asks instead of failing open.',
    '',
    'Divergence from your first instinct: none',
  ].join('\n');
  const r = checkNarrationFormat(text);
  assert.equal(r.ok, true);
  assert.equal(r.hasWhatWhy, true);
  assert.equal(r.hasDivergence, true);
});

test('separate What and Why headings plus divergence pass', () => {
  const text = [
    '### What',
    'Wire the Stop hook.',
    '### Why',
    'The text channel was the remaining leak.',
    'Divergence from your first instinct: using a heading instead of a label',
  ].join('\n');
  const r = checkNarrationFormat(text);
  assert.equal(r.ok, true);
});

test('What: and Why: labels plus divergence pass', () => {
  const text = [
    'What: add a fence check',
    'Why: G5 is the chat leak',
    'Divergence from your first instinct: none',
  ].join('\n');
  assert.equal(checkNarrationFormat(text).ok, true);
});

test('missing the divergence callout fails (format only)', () => {
  const text = '## What / why\nI narrated at length about the architecture.';
  const r = checkNarrationFormat(text);
  assert.equal(r.ok, false);
  assert.equal(r.hasWhatWhy, true);
  assert.equal(r.hasDivergence, false);
});

test('a divergence line of "none" is acceptable', () => {
  const text = [
    '## What / why',
    'Following the stated approach.',
    'Divergence from your first instinct: none',
  ].join('\n');
  assert.equal(checkNarrationFormat(text).hasDivergence, true);
  assert.equal(checkNarrationFormat(text).ok, true);
});

test('an empty divergence value does not count', () => {
  const text = [
    '## What / why',
    'Something.',
    'Divergence from your first instinct:',
  ].join('\n');
  const r = checkNarrationFormat(text);
  assert.equal(r.hasDivergence, false);
  assert.equal(r.ok, false);
});

test('a divergence line without a what/why section fails', () => {
  const text = 'Divergence from your first instinct: none';
  const r = checkNarrationFormat(text);
  assert.equal(r.hasDivergence, true);
  assert.equal(r.hasWhatWhy, false);
  assert.equal(r.ok, false);
});

test('quality is not judged: a terse what/why still passes format', () => {
  const text = [
    '## What / why',
    'x',
    'Divergence from your first instinct: none',
  ].join('\n');
  assert.equal(checkNarrationFormat(text).ok, true);
});
