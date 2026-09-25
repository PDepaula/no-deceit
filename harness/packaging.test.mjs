// Guards the distribution manifests (package.json, the Claude/Cursor plugin
// manifests, the harness/claude-code skills-dir plugin) against drift: paths they point at must exist, and the fields
// each harness's native installer reads must be present. Do not test harness
// behavior here — that is pi.test.mjs / opencode.test.mjs / cursor.test.mjs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

test('package.json is private and carries no npm publish surface (main/files/bin)', () => {
  assert.equal(pkg.private, true);
  assert.equal(pkg.name, 'no-deceit');
  assert.equal(pkg.main, undefined);
  assert.equal(pkg.files, undefined);
  assert.equal(pkg.bin, undefined);
  assert.match(pkg.repository.url, /PDepaula\/no-deceit/);
});

test('package.json declares a pi manifest with pi-package keyword and real resource paths', () => {
  assert.ok(pkg.keywords.includes('pi-package'));
  assert.ok(Array.isArray(pkg.pi.extensions) && pkg.pi.extensions.length > 0);
  assert.ok(Array.isArray(pkg.pi.skills) && pkg.pi.skills.length > 0);
  for (const rel of [...pkg.pi.extensions, ...pkg.pi.skills]) {
    assert.ok(existsSync(join(repoRoot, rel)), `pi manifest path "${rel}" does not exist`);
  }
});

test('.claude-plugin/plugin.json and marketplace.json parse and agree on the plugin name', () => {
  const plugin = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin/plugin.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(plugin.name, 'no-deceit');
  assert.equal(marketplace.plugins[0].name, 'no-deceit');
  // A marketplace install caches only the `source` directory, so it must stay the repo root
  // (harness/claude-code reaches ../../hooks and would be cut off from the core).
  assert.equal(marketplace.plugins[0].source, './');
  assert.ok(existsSync(join(repoRoot, 'hooks/hooks.json')));
});

test('versions agree across package.json and both plugin manifests', () => {
  const claude = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin/plugin.json'), 'utf8'));
  const claudeHome = JSON.parse(readFileSync(join(repoRoot, 'harness/claude-code/.claude-plugin/plugin.json'), 'utf8'));
  const cursor = JSON.parse(readFileSync(join(repoRoot, '.cursor-plugin/plugin.json'), 'utf8'));
  assert.deepEqual([claude.version, claudeHome.version, cursor.version], [pkg.version, pkg.version, pkg.version]);
});

test('harness/claude-code is a skills-dir plugin: manifest, hooks forwarding to ../../hooks, skills/agents symlinks', () => {
  const dir = join(repoRoot, 'harness/claude-code');
  const plugin = JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'no-deceit');
  const rootHooks = JSON.parse(readFileSync(join(repoRoot, 'hooks/hooks.json'), 'utf8'));
  const homeHooks = JSON.parse(readFileSync(join(dir, 'hooks/hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(homeHooks.hooks), Object.keys(rootHooks.hooks));
  for (const groups of Object.values(homeHooks.hooks)) {
    for (const g of groups) for (const h of g.hooks) {
      assert.match(h.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/run\.mjs/);
    }
  }
  assert.match(readFileSync(join(dir, 'hooks/run.mjs'), 'utf8'), /import '\.\.\/\.\.\/\.\.\/hooks\/nd-hook\.mjs'/);
  assert.ok(existsSync(join(dir, '../../hooks/nd-hook.mjs')));
  for (const l of ['skills', 'agents']) {
    assert.ok(lstatSync(join(dir, l)).isSymbolicLink(), `${l} must be a symlink`);
    assert.ok(existsSync(join(dir, l)), `${l} symlink dangles`);
  }
});

test('.cursor-plugin/plugin.json parses, names the plugin, and points hooks at the Cursor-shaped hooks.json', () => {
  const plugin = JSON.parse(readFileSync(join(repoRoot, '.cursor-plugin/plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'no-deceit');
  assert.equal(plugin.hooks, './harness/cursor/hooks.json');
  assert.ok(existsSync(join(repoRoot, plugin.hooks)));
  const hooks = JSON.parse(readFileSync(join(repoRoot, plugin.hooks), 'utf8'));
  assert.ok(Array.isArray(hooks.hooks.preToolUse));
});

test('the personal home dirs are gitignored', () => {
  const ignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8').split('\n');
  for (const d of ['/projects/', '/data/', '/state/', '/config/']) assert.ok(ignore.includes(d), `${d} missing from .gitignore`);
});

test('the npm 0.7.2 deprecation stub is self-contained and publishes nothing but a notice', () => {
  const dir = join(repoRoot, 'docs/releases/npm-0.7.2');
  const stub = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(stub.name, 'no-deceit');
  assert.equal(stub.version, '0.7.2');
  assert.deepEqual(stub.files.sort(), ['README.md', 'postinstall.js']);
  assert.equal(stub.dependencies, undefined);
  assert.equal(stub.bin, undefined);
  assert.match(stub.scripts.postinstall, /postinstall\.js/);
  assert.ok(existsSync(join(dir, 'postinstall.js')) && existsSync(join(dir, 'README.md')));
});
