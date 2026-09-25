import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  renderManifestEntry, manifestHasProject, projectNameFrom, isRemoteSource,
  marketplaceInstalls, mergeCursorHooks, classifyChanges, versionCompare,
} from './update.mjs';
import { manifestProjectPath } from './evidence.mjs';

test('renderManifestEntry round-trips through the grader manifest reader', () => {
  const line = renderManifestEntry({ name: 'bondly', path: '/x/bondly', summary: 'a "quoted"\nsummary' });
  assert.equal(line, `{:name "bondly" :path "/x/bondly" :summary "a 'quoted' summary"}`);
  assert.equal(manifestProjectPath(`${line}\n`, 'projects.edn', 'bondly'), '/x/bondly');
  assert.ok(manifestHasProject(`${line}\n`, 'bondly'));
  assert.ok(!manifestHasProject(`${line}\n`, 'other'));
});

test('projectNameFrom / isRemoteSource', () => {
  assert.equal(projectNameFrom('https://github.com/a/b.git'), 'b');
  assert.equal(projectNameFrom('git@github.com:a/b.git'), 'b');
  assert.equal(projectNameFrom('/home/x/app/'), 'app');
  assert.ok(isRemoteSource('https://github.com/a/b.git'));
  assert.ok(isRemoteSource('git@github.com:a/b.git'));
  assert.ok(!isRemoteSource('/home/x/app'));
  assert.ok(!isRemoteSource('./app'));
});

test('marketplaceInstalls finds no-deceit@<marketplace>, ignores others and the skills-dir load', () => {
  const installed = { plugins: { 'no-deceit@no-deceit': [{}], 'caveman@caveman': [{}], 'no-deceit@skills-dir': [{}] } };
  assert.deepEqual(marketplaceInstalls(installed, null), ['no-deceit@no-deceit']);
  assert.deepEqual(marketplaceInstalls(null, { enabledPlugins: { 'no-deceit@x': true, 'no-deceit@y': false } }), ['no-deceit@x']);
  assert.deepEqual(marketplaceInstalls(null, null), []);
});

test('mergeCursorHooks appends ours, keeps others, and replaces an earlier No Deceit entry', () => {
  const other = { command: 'other-tool', timeout: 5 };
  const first = mergeCursorHooks({ version: 1, hooks: { preToolUse: [other], stop: [{ command: 'x' }] } }, '/h/bin/nd');
  assert.deepEqual(first.hooks.preToolUse.map((h) => h.command), ['other-tool', '/h/bin/nd --cursor']);
  assert.deepEqual(first.hooks.stop, [{ command: 'x' }]);
  const again = mergeCursorHooks(mergeCursorHooks({ hooks: { preToolUse: [{ command: 'nd --cursor' }] } }, '/old/bin/nd'), '/h/bin/nd');
  assert.deepEqual(again.hooks.preToolUse.map((h) => h.command), ['/h/bin/nd --cursor']);
  assert.equal(mergeCursorHooks(null, '/h/bin/nd').version, 1);
});

test('classifyChanges: release notes in version order, reread, rebootstrap, bb bump', () => {
  const ns = [
    'M\tskills/no-deceit/SKILL.md',
    'A\tdocs/releases/v0.10.0.md',
    'A\tdocs/releases/v0.9.1.md',
    'M\tdocs/releases/v0.2.0.md',
    'M\tcore/gate.mjs',
    'R100\tharness/pi/old.ts\tharness/pi/no-deceit.ts',
    'M\tbb.edn',
  ].join('\n');
  const c = classifyChanges(ns);
  assert.deepEqual(c.releaseFiles, ['docs/releases/v0.2.0.md', 'docs/releases/v0.9.1.md', 'docs/releases/v0.10.0.md']);
  assert.deepEqual([c.reread, c.rebootstrap, c.bbBump], [true, true, true]);
  const quiet = classifyChanges('M\tcore/gate.mjs\nM\tharness/pi/extension.mjs');
  assert.deepEqual([quiet.reread, quiet.rebootstrap, quiet.bbBump, quiet.releaseFiles], [false, false, false, []]);
  assert.equal(classifyChanges('').rebootstrap, false);
});

test('versionCompare orders numerically, not lexically', () => {
  assert.ok(versionCompare('v0.9.0.md', 'v0.10.0.md') < 0);
});
