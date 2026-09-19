// Guards the distribution manifests (package.json, the Claude/Cursor plugin
// manifests) against drift: paths they point at must exist, and the fields
// each harness's native installer reads must be present. Do not test harness
// behavior here — that is pi.test.mjs / opencode.test.mjs / cursor.test.mjs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

test('package.json is npm-publishable (no private flag, name/license/repository set)', () => {
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.name, 'no-deceit');
  assert.equal(pkg.license, 'MIT');
  assert.match(pkg.repository.url, /PDepaula\/no-deceit/);
});

test('package.json main points at a real file (OpenCode `opencode plugin <module>` server-target detection)', () => {
  assert.ok(existsSync(join(repoRoot, pkg.main)), `main "${pkg.main}" does not exist`);
});

test('package.json declares a pi manifest with pi-package keyword and real resource paths', () => {
  assert.ok(pkg.keywords.includes('pi-package'));
  assert.ok(Array.isArray(pkg.pi.extensions) && pkg.pi.extensions.length > 0);
  assert.ok(Array.isArray(pkg.pi.skills) && pkg.pi.skills.length > 0);
  for (const rel of [...pkg.pi.extensions, ...pkg.pi.skills]) {
    assert.ok(existsSync(join(repoRoot, rel)), `pi manifest path "${rel}" does not exist`);
  }
});

test('package.json files allowlist covers core/adapters/bin/skills and excludes test files', () => {
  for (const dir of ['core', 'adapters', 'bin', 'skills']) {
    assert.ok(pkg.files.includes(dir), `files[] is missing "${dir}"`);
  }
  assert.ok(pkg.files.some((p) => p.startsWith('!') && p.includes('test')));
});

test('.claude-plugin/plugin.json and marketplace.json parse and agree on the plugin name', () => {
  const plugin = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin/plugin.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(plugin.name, 'no-deceit');
  assert.equal(marketplace.plugins[0].name, 'no-deceit');
  assert.equal(marketplace.plugins[0].source, './');
});

test('.cursor-plugin/plugin.json parses, names the plugin, and points hooks at the Cursor-shaped hooks.json', () => {
  const plugin = JSON.parse(readFileSync(join(repoRoot, '.cursor-plugin/plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'no-deceit');
  assert.equal(plugin.hooks, './adapters/cursor/hooks.json');
  assert.ok(existsSync(join(repoRoot, plugin.hooks)));
  const hooks = JSON.parse(readFileSync(join(repoRoot, plugin.hooks), 'utf8'));
  assert.ok(Array.isArray(hooks.hooks.preToolUse));
});
