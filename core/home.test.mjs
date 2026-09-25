import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, readlinkSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureHome, projectAdd, bootstrap, update, initProject } from './home.mjs';
import { homePaths, dataPaths, detectHome, withDetectedHome } from './state.mjs';

const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const GIT_ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'nd-home-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function commit(repo, file, text, msg = 'c') {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), text);
  g(repo, 'add', '-A');
  g(repo, ...GIT_ID, 'commit', '-q', '-m', msg);
}

test('ND_HOME points state, config and data at the home; empty ND_HOME falls back to XDG', () => {
  const env = { ND_HOME: '/h', XDG_STATE_HOME: '/xs', XDG_CONFIG_HOME: '/xc', HOME: '/u' };
  assert.equal(homePaths(env).ledger, '/h/state/ledger.jsonl');
  assert.equal(homePaths(env).configFile, '/h/config/config.json');
  assert.equal(dataPaths(env).dataDir, '/h/data');
  assert.equal(homePaths({ ...env, ND_HOME: '' }).ledger, '/xs/no-deceit/ledger.jsonl');
});

test('withDetectedHome uses the .nd-home marker but never overrides an explicit ND_HOME', () => {
  const s = scratch();
  try {
    assert.equal(detectHome(s.dir), null);
    assert.deepEqual(withDetectedHome({}, s.dir), {});
    writeFileSync(join(s.dir, '.nd-home'), '');
    assert.equal(withDetectedHome({}, s.dir).ND_HOME, s.dir);
    assert.equal(withDetectedHome({ ND_HOME: '' }, s.dir).ND_HOME, '');
    assert.equal(withDetectedHome({ ND_HOME: '/x' }, s.dir).ND_HOME, '/x');
  } finally { s.cleanup(); }
});

test('ensureHome creates the four dirs, the marker, and data/ as its own git repo; idempotent', () => {
  const s = scratch();
  try {
    const made = ensureHome(s.dir);
    assert.ok(['projects', 'data', 'state', 'config', 'data/.git'].every((m) => made.includes(m)));
    assert.ok(existsSync(join(s.dir, '.nd-home')));
    assert.ok(existsSync(join(s.dir, 'data', '.git')));
    assert.deepEqual(ensureHome(s.dir), []);
  } finally { s.cleanup(); }
});

test('projectAdd adopts a local dir in place, registers it in projects.edn, opts it in at Tier 2', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const app = join(s.dir, 'app'); mkdirSync(app);
    const r = projectAdd({ home, env: { ND_HOME: '' }, source: app, summary: 'the app' });
    assert.equal(r.name, 'app');
    assert.equal(r.cloned, false);
    assert.equal(r.tier, 2);
    assert.ok(existsSync(join(app, '.no-deceit', 'state.json')));
    assert.match(readFileSync(join(home, 'data', 'projects.edn'), 'utf8'), /:name "app" :path ".*app" :summary "the app"/);
    assert.throws(() => projectAdd({ home, env: { ND_HOME: '' }, source: app }), /already in/);
    assert.throws(() => projectAdd({ home, env: { ND_HOME: '' }, source: join(s.dir, 'missing') }), /not a directory/);
  } finally { s.cleanup(); }
});

test('projectAdd clones a remote into projects/<name>', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const origin = join(s.dir, 'origin.git');
    g(s.dir, 'init', '-q', '-b', 'main', origin);
    commit(origin, 'a.txt', 'a');
    const r = projectAdd({ home, env: { ND_HOME: '' }, source: `file://${origin}`, name: 'cloned' });
    assert.equal(r.cloned, true);
    assert.equal(r.path, join(home, 'projects', 'cloned'));
    assert.ok(existsSync(join(home, 'projects', 'cloned', 'a.txt')));
    assert.ok(existsSync(join(home, 'projects', 'cloned', '.no-deceit', 'state.json')));
  } finally { s.cleanup(); }
});

function fakeUser(dir, { claude = true, opencode = false, pi = false, cursor = false } = {}) {
  const u = join(dir, 'user');
  if (claude) mkdirSync(join(u, '.claude', 'plugins'), { recursive: true });
  if (opencode) mkdirSync(join(u, '.config', 'opencode'), { recursive: true });
  if (pi) mkdirSync(join(u, '.pi'), { recursive: true });
  if (cursor) mkdirSync(join(u, '.cursor'), { recursive: true });
  return u;
}

test('bootstrap links each detected harness, is idempotent, and writes nothing on --dry-run', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir, { claude: true, opencode: true, pi: true, cursor: true });
    const env = { ND_HOME: '', HOME: userHome, XDG_STATE_HOME: join(s.dir, 'xs') };

    const dry = bootstrap({ home, userHome, env, dryRun: true });
    assert.ok(dry.some((l) => /dry run/.test(l)));
    assert.ok(!existsSync(join(home, '.nd-home')));
    assert.ok(!existsSync(join(userHome, '.claude', 'skills', 'no-deceit')));

    bootstrap({ home, userHome, env });
    const claude = join(userHome, '.claude', 'skills', 'no-deceit');
    assert.equal(readlinkSync(claude), join(home, 'harness', 'claude-code'));
    assert.equal(readlinkSync(join(userHome, '.config', 'opencode', 'plugins', 'no-deceit.ts')), join(home, 'harness', 'opencode', 'no-deceit.ts'));
    assert.equal(readlinkSync(join(userHome, '.pi', 'agent', 'extensions', 'no-deceit.ts')), join(home, 'harness', 'pi', 'no-deceit.ts'));
    const cursor = JSON.parse(readFileSync(join(userHome, '.cursor', 'hooks.json'), 'utf8'));
    assert.deepEqual(cursor.hooks.preToolUse.map((h) => h.command), [`${join(home, 'bin', 'nd')} --cursor`]);

    const again = bootstrap({ home, userHome, env });
    assert.ok(again.some((l) => /already linked/.test(l)));
    assert.equal(JSON.parse(readFileSync(join(userHome, '.cursor', 'hooks.json'), 'utf8')).hooks.preToolUse.length, 1);
  } finally { s.cleanup(); }
});

test('bootstrap detects a marketplace install, tells the user to uninstall, and does not link Claude', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir);
    writeFileSync(join(userHome, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'no-deceit@no-deceit': [{}] } }));
    const out = bootstrap({ home, userHome, env: { ND_HOME: '', HOME: userHome } }).join('\n');
    assert.match(out, /already installed as a marketplace plugin \(no-deceit@no-deceit\)/);
    assert.match(out, /claude plugin uninstall no-deceit/);
    assert.ok(!existsSync(join(userHome, '.claude', 'skills', 'no-deceit')));
  } finally { s.cleanup(); }
});

test('bootstrap never replaces an existing skills-dir entry that points elsewhere', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir);
    const old = join(s.dir, 'old-clone'); mkdirSync(old);
    mkdirSync(join(userHome, '.claude', 'skills'), { recursive: true });
    symlinkSync(old, join(userHome, '.claude', 'skills', 'no-deceit'));
    const out = bootstrap({ home, userHome, env: { ND_HOME: '', HOME: userHome } }).join('\n');
    assert.match(out, /CONFLICT .*no-deceit already a symlink to /);
    assert.equal(readlinkSync(join(userHome, '.claude', 'skills', 'no-deceit')), old);
  } finally { s.cleanup(); }
});

test('bootstrap copies (not moves) a pre-home XDG ledger once', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir, { claude: false });
    const xs = join(s.dir, 'xs');
    mkdirSync(join(xs, 'no-deceit'), { recursive: true });
    writeFileSync(join(xs, 'no-deceit', 'ledger.jsonl'), '{"event":"x"}\n');
    const env = { ND_HOME: '', HOME: userHome, XDG_STATE_HOME: xs };
    bootstrap({ home, userHome, env });
    assert.equal(readFileSync(join(home, 'state', 'ledger.jsonl'), 'utf8'), '{"event":"x"}\n');
    assert.ok(existsSync(join(xs, 'no-deceit', 'ledger.jsonl')));
    writeFileSync(join(home, 'state', 'ledger.jsonl'), '{"event":"newer"}\n');
    bootstrap({ home, userHome, env });
    assert.equal(readFileSync(join(home, 'state', 'ledger.jsonl'), 'utf8'), '{"event":"newer"}\n');
  } finally { s.cleanup(); }
});

function twoClones(s) {
  const origin = join(s.dir, 'origin'); g(s.dir, 'init', '-q', '-b', 'main', origin);
  commit(origin, 'README.md', 'v1');
  const home = join(s.dir, 'home'); g(s.dir, 'clone', '-q', origin, home);
  g(home, 'config', 'user.name', 't'); g(home, 'config', 'user.email', 't@t');
  return { origin, home };
}

test('update fast-forwards, prints release notes and reread/rebootstrap, and leaves private dirs untouched', () => {
  const s = scratch();
  try {
    const { origin, home } = twoClones(s);
    ensureHome(home);
    writeFileSync(join(home, 'data', 'projects.edn'), 'mine\n');
    writeFileSync(join(home, 'config', 'config.json'), '{}');
    assert.match(update({ home }).join('\n'), /up to date/);
    commit(origin, 'docs/releases/v0.9.0.md', '# v0.9.0\nwhy it matters');
    commit(origin, 'AGENTS.md', 'new contract');
    commit(origin, 'harness/pi/no-deceit.ts', 'x');
    const out = update({ home }).join('\n');
    assert.match(out, /fast-forward/);
    assert.match(out, /--- docs\/releases\/v0\.9\.0\.md\n# v0\.9\.0\nwhy it matters/);
    assert.match(out, /reread: yes/);
    assert.match(out, /rebootstrap: yes/);
    assert.equal(readFileSync(join(home, 'data', 'projects.edn'), 'utf8'), 'mine\n');
    assert.equal(readFileSync(join(home, 'config', 'config.json'), 'utf8'), '{}');
    assert.equal(g(home, 'rev-parse', 'HEAD'), g(origin, 'rev-parse', 'HEAD'));
  } finally { s.cleanup(); }
});

test('update refuses when local commits make the history diverge, and changes nothing', () => {
  const s = scratch();
  try {
    const { origin, home } = twoClones(s);
    commit(home, 'local.txt', 'mine', 'local');
    commit(origin, 'remote.txt', 'theirs', 'remote');
    const before = g(home, 'rev-parse', 'HEAD');
    assert.throws(() => update({ home }), /not an ancestor|only fast-forwards/);
    assert.equal(g(home, 'rev-parse', 'HEAD'), before);
  } finally { s.cleanup(); }
});

test('update explains a checkout with no upstream', () => {
  const s = scratch();
  try {
    g(s.dir, 'init', '-q', '-b', 'main', join(s.dir, 'r'));
    assert.throws(() => update({ home: join(s.dir, 'r') }), /no upstream/);
  } finally { s.cleanup(); }
});

test('initProject is what nd init does: Tier 2 default state and a local gitignore', () => {
  const s = scratch();
  try {
    const { paths, state } = initProject(s.dir, { ND_HOME: '' });
    assert.equal(state.tier, 2);
    assert.ok(existsSync(paths.gitignore));
    assert.ok(lstatSync(paths.dir).isDirectory());
  } finally { s.cleanup(); }
});
