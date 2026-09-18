import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFences, overThresholdFences, redactOverThresholdFences, DEFAULT_MAX_FENCE_LINES } from './fence.mjs';

test('default snippet threshold is 6 lines', () => {
  assert.equal(DEFAULT_MAX_FENCE_LINES, 6);
});

test('extractFences finds a backtick fence and counts body lines', () => {
  const text = 'intro\n```js\none\ntwo\nthree\n```\noutro';
  const fences = extractFences(text);
  assert.equal(fences.length, 1);
  assert.equal(fences[0].lang, 'js');
  assert.equal(fences[0].lineCount, 3);
  assert.equal(fences[0].closed, true);
  assert.equal(fences[0].body, 'one\ntwo\nthree');
});

test('extractFences supports tildes and counts blank body lines', () => {
  const text = '~~~\nkeep\n\nthis\n~~~';
  const fences = extractFences(text);
  assert.equal(fences.length, 1);
  assert.equal(fences[0].lineCount, 3);
});

test('inline backticks are not fences', () => {
  assert.equal(extractFences('use `reduce` or a loop').length, 0);
});

test('a 6-line fence is at the threshold, not above it', () => {
  const body = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
  const text = '```\n' + body + '\n```';
  assert.equal(extractFences(text)[0].lineCount, 6);
  assert.equal(overThresholdFences(text).length, 0);
});

test('a 7-line fence is over the default threshold', () => {
  const body = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
  const text = '```python\n' + body + '\n```';
  const over = overThresholdFences(text);
  assert.equal(over.length, 1);
  assert.equal(over[0].lineCount, 7);
});

test('the max-lines argument is tunable', () => {
  const text = '```\n1\n2\n3\n```';
  assert.equal(overThresholdFences(text, 2).length, 1);
  assert.equal(overThresholdFences(text, 3).length, 0);
});

test('an unclosed fence at EOF still counts its body', () => {
  const body = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
  const text = '```js\n' + body;
  const fences = extractFences(text);
  assert.equal(fences.length, 1);
  assert.equal(fences[0].closed, false);
  assert.equal(fences[0].lineCount, 7);
  assert.equal(overThresholdFences(text).length, 1);
});

test('redactOverThresholdFences replaces only over-threshold bodies', () => {
  const small = '```\nok\n```';
  const big = '```js\n' + ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n') + '\n```';
  const text = `see:\n${small}\nand:\n${big}`;
  const { text: out, redacted, count } = redactOverThresholdFences(text);
  assert.equal(redacted, true);
  assert.equal(count, 1);
  assert.match(out, /```\nok\n```/);
  assert.match(out, /redacted/i);
  assert.doesNotMatch(out, /\n[a]\n[b]\n[c]\n/);
});

test('redactOverThresholdFences is a no-op when every fence is small', () => {
  const text = '```\nsmall\n```';
  const r = redactOverThresholdFences(text);
  assert.equal(r.redacted, false);
  assert.equal(r.text, text);
});
