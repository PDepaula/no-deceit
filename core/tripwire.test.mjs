import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leakedSourceWrites, parseChangedFiles } from './tripwire.mjs';
import { decideBashEditDiff, REASONS } from './policy.mjs';

const cfg = {
  statePathPrefixes: ['/repo/.no-deceit'],
  testGlobs: ['test/**', '**/*.test.*', '**/*_test.*'],
  toolingGlobs: ['**/package.json', '**/Makefile'],
  tripwireIgnoreGlobs: ['**/.pytest_cache/**', '**/__pycache__/**', '**/*.pyc'],
};

test('parseChangedFiles accepts bashEditDiff.changedFiles as strings', () => {
  assert.deepEqual(
    parseChangedFiles({ bashEditDiff: { changedFiles: ['src/a.mjs', 'src/b.mjs'] } }),
    ['src/a.mjs', 'src/b.mjs'],
  );
});

test('parseChangedFiles accepts {path} objects and a bare array', () => {
  assert.deepEqual(
    parseChangedFiles({ bashEditDiff: { changedFiles: [{ path: '/repo/src/a.mjs' }] } }),
    ['/repo/src/a.mjs'],
  );
  assert.deepEqual(parseChangedFiles({ bashEditDiff: ['src/a.mjs'] }), ['src/a.mjs']);
});

test('parseChangedFiles is empty when the field is missing (REPL/run has nothing to trip)', () => {
  assert.deepEqual(parseChangedFiles({ stdout: '4' }), []);
  assert.deepEqual(parseChangedFiles(null), []);
  assert.deepEqual(parseChangedFiles({ bashEditDiff: { changedFiles: [] } }), []);
});

test('a file-mutating Bash that writes source is leaked (category E)', () => {
  const leaked = leakedSourceWrites(['/repo/src/main.mjs'], cfg);
  assert.equal(leaked.length, 1);
  assert.equal(leaked[0].category, 'E');
});

test('a diagram source written by Bash is leaked (category H)', () => {
  const leaked = leakedSourceWrites(['/repo/docs/arch.mmd', '/repo/src/app.py'], cfg);
  assert.deepEqual(leaked.map((x) => x.category), ['H', 'E']);
});

test('a test-path write is not a source leak', () => {
  assert.equal(leakedSourceWrites(['/repo/test/foo.test.mjs'], cfg).length, 0);
});

test('a tooling-path write is not a source leak', () => {
  assert.equal(leakedSourceWrites(['/repo/package.json'], cfg).length, 0);
});

test('pytest cache / pyc writes are ignored so the run loop is not blocked', () => {
  assert.equal(leakedSourceWrites(['/repo/.pytest_cache/v/cache/nodeids', '/repo/src/__pycache__/a.pyc'], cfg).length, 0);
});

test('a REPL/run with no changed files does not leak', () => {
  assert.equal(leakedSourceWrites([], cfg).length, 0);
});

const T1 = { tier: 1, t2Unlocked: false, t3PreamblePresent: false };
const T2 = { tier: 2, t2Unlocked: true, t3PreamblePresent: false };
const T3 = { tier: 3, t2Unlocked: false, t3PreamblePresent: true };

test('decideBashEditDiff blocks leaked source at Tier 1 and Tier 2', () => {
  const hits = [{ file: '/repo/src/x.mjs', category: 'E' }];
  const r1 = decideBashEditDiff(T1, { leaked: hits });
  assert.equal(r1.decision, 'block');
  assert.equal(r1.reason, REASONS.BASH_EDIT_DIFF);
  const r2 = decideBashEditDiff(T2, { leaked: hits });
  assert.equal(r2.decision, 'block');
});

test('decideBashEditDiff allows leaked-looking writes at granted Tier 3 (source writes are in policy)', () => {
  const r = decideBashEditDiff(T3, { leaked: [{ file: '/repo/src/x.mjs', category: 'E' }] });
  assert.equal(r.decision, 'allow');
});

test('decideBashEditDiff is a no-op when nothing leaked', () => {
  assert.equal(decideBashEditDiff(T1, { leaked: [] }).decision, 'allow');
});
