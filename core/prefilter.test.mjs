import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefilterMentalModel, prefilterCommitHistory } from './prefilter.mjs';

const MIN = 80;

test('mental-model: empty text is rejected before any LLM call', () => {
  const r = prefilterMentalModel('', { minChars: MIN });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty');
});

test('mental-model: whitespace-only text is rejected', () => {
  const r = prefilterMentalModel('   \n\t  ', { minChars: MIN });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty');
});

test('mental-model: below minimum length is rejected', () => {
  const r = prefilterMentalModel('idk it just doesn\'t work', { minChars: MIN });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_short');
});

test('mental-model: a restated stack trace is rejected as an error paste', () => {
  const evidence = [
    'Error: Cannot read properties of undefined (reading \'map\')',
    '    at parse (src/parser.js:41:18)',
    '    at Object.<anonymous> (src/cli.js:12:1)',
    '    at Module._compile (node:internal/modules/cjs/loader:1521:14)',
    'TypeError: Cannot read properties of undefined (reading \'map\')',
    '    at reduce (src/parser.js:88:9)',
  ].join('\n');
  const r = prefilterMentalModel(evidence, { minChars: MIN });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'error_paste');
});

test('mental-model: nearly copying a provided error text is rejected', () => {
  const err = 'AssertionError: expected 3 to equal 4\n    at Context.<anonymous> (test/add.test.js:10:12)';
  const r = prefilterMentalModel(`I got this:\n${err}\n${err}`, { minChars: MIN, errorText: err });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'error_paste');
});

test('mental-model: terse-but-genuine engagement passes the pre-filter', () => {
  const evidence =
    'The walker is supposed to cons-recurse on list cells. It returns nil on ' +
    '`(a . b)` because I think dotted pairs skip the cdr walk — the failing ' +
    'REPL result was nil, not a pair. Tried quoting; same result.';
  const r = prefilterMentalModel(evidence, { minChars: MIN });
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
});

test('commit-history: fewer than two substantive commits is rejected', () => {
  const r = prefilterCommitHistory([
    { hash: 'a', subject: 'wip', files: [{ path: 'src/x.js', patch: '+const x = 1\n' }] },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_few_attempts');
});

test('commit-history: two commits on different files (no shared unit) is rejected', () => {
  const r = prefilterCommitHistory([
    { hash: 'a', subject: 'a', files: [{ path: 'src/a.js', patch: '+export const a = 1\n' }] },
    { hash: 'b', subject: 'b', files: [{ path: 'src/b.js', patch: '+export const b = 2\n' }] },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_shared_unit');
});

test('commit-history: rename-only commits are dropped and then rejected', () => {
  const r = prefilterCommitHistory([
    { hash: 'a', subject: 'rename 1', files: [{ path: 'src/b.js', status: 'rename', from: 'src/a.js', similarity: 100, patch: '' }] },
    { hash: 'b', subject: 'rename 2', files: [{ path: 'src/c.js', status: 'rename', from: 'src/b.js', similarity: 100, patch: '' }] },
    { hash: 'c', subject: 'rename 3', files: [{ path: 'src/d.js', status: 'rename', from: 'src/c.js', similarity: 100, patch: '' }] },
  ]);
  assert.equal(r.ok, false);
});

test('commit-history: whitespace-only diffs are dropped', () => {
  const r = prefilterCommitHistory([
    {
      hash: 'a',
      subject: 'spaces',
      files: [{ path: 'src/x.js', patch: '-const x=1\n+const x = 1\n' }],
    },
    {
      hash: 'b',
      subject: 'more spaces',
      files: [{ path: 'src/x.js', patch: '-  return x\n+    return x\n' }],
    },
  ]);
  assert.equal(r.ok, false);
});

test('commit-history: format-only (semicolons/commas) diffs are dropped', () => {
  const r = prefilterCommitHistory([
    {
      hash: 'a',
      subject: 'prettier',
      files: [{ path: 'src/x.js', patch: '-const x = 1\n+const x = 1;\n' }],
    },
    {
      hash: 'b',
      subject: 'trailing comma',
      files: [{ path: 'src/x.js', patch: '-  foo(1, 2)\n+  foo(1, 2,)\n' }],
    },
  ]);
  assert.equal(r.ok, false);
});

test('commit-history: two substantive strategy-different commits on one file pass', () => {
  const r = prefilterCommitHistory([
    {
      hash: 'a',
      subject: 'try a list',
      files: [{ path: 'src/walk.js', patch: '+function walk(xs) { return xs.reduce((a, b) => a + b, 0) }\n' }],
    },
    {
      hash: 'b',
      subject: 'try a tree',
      files: [{ path: 'src/walk.js', patch: '-function walk(xs) { return xs.reduce((a, b) => a + b, 0) }\n+function walk(node) { return node ? node.val + walk(node.left) + walk(node.right) : 0 }\n' }],
    },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.commits.length, 2);
});
