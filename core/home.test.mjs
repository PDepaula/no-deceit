import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, readlinkSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureHome, projectAdd, bootstrap, update, initProject } from './home.mjs';
import { homePaths, dataPaths, detectHome, withDetectedHome, loadConfig } from './state.mjs';
import { manifestProjectPath } from './evidence.mjs';

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

test('projectAdd refuses a subdirectory of a git repo, naming the top level and advising git init, and changes nothing', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    mkdirSync(join(s.dir, 'mono', 'pkg'), { recursive: true });
    const mono = realpathSync(join(s.dir, 'mono'));
    g(mono, 'init', '-q');
    assert.throws(() => projectAdd({ home, env: { ND_HOME: '' }, source: join(mono, 'pkg'), name: 'pkg' }),
      (e) => e.message.includes(mono) && e.message.includes(`git init ${join(mono, 'pkg')} && nd project add ${join(mono, 'pkg')}`));
    assert.ok(!existsSync(join(mono, 'pkg', '.no-deceit')));
    assert.ok(!existsSync(join(home, 'data', 'projects.edn')));
    const r = projectAdd({ home, env: { ND_HOME: '' }, source: mono });
    assert.equal(r.path, mono);
    assert.ok(existsSync(join(mono, '.no-deceit', 'state.json')));
  } finally { s.cleanup(); }
});

test('projectAdd refuses a scratch dir under the home\'s projects/ and advises git init, never governing the home', () => {
  const s = scratch();
  try {
    mkdirSync(join(s.dir, 'home'));
    const home = realpathSync(join(s.dir, 'home'));
    g(home, 'init', '-q');
    const scratchDir = join(home, 'projects', 'scratch'); mkdirSync(scratchDir, { recursive: true });
    assert.throws(() => projectAdd({ home, env: { ND_HOME: '' }, source: scratchDir }), (e) =>
      e.message.includes(`git init ${scratchDir} && nd project add ${scratchDir}`)
      && [...e.message.matchAll(/nd project add (\S+)/g)].every((m) => m[1] === scratchDir));
    assert.ok(!existsSync(join(scratchDir, '.no-deceit')));
    assert.ok(!existsSync(join(home, '.no-deceit')));
    g(scratchDir, 'init', '-q');
    assert.equal(projectAdd({ home, env: { ND_HOME: '' }, source: scratchDir }).path, scratchDir);
    assert.ok(existsSync(join(scratchDir, '.no-deceit', 'state.json')));
  } finally { s.cleanup(); }
});

test('projectAdd names a local "." source after the real directory', () => {
  const s = scratch();
  const cwd = process.cwd();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const app = join(s.dir, 'my-app'); mkdirSync(app);
    process.chdir(app);
    assert.equal(projectAdd({ home, env: { ND_HOME: '' }, source: '.' }).name, 'my-app');
  } finally { process.chdir(cwd); s.cleanup(); }
});

test('projectAdd registers in the manifest the grader reads: ND_DATA_DIR, and an existing projects.json', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const data = join(s.dir, 'elsewhere');
    const app = join(s.dir, 'app'); mkdirSync(app);
    const env = { ND_HOME: '', ND_DATA_DIR: data };
    const r = projectAdd({ home, env, source: app });
    const dp = dataPaths({ ...env, ND_HOME: home });
    assert.equal(r.manifest, dp.projectsManifests[0]);
    assert.equal(manifestProjectPath(readFileSync(r.manifest, 'utf8'), r.manifest, 'app'), r.path);
    assert.ok(!existsSync(join(home, 'data', 'projects.edn')));

    const home2 = join(s.dir, 'home2'); mkdirSync(join(home2, 'data'), { recursive: true });
    writeFileSync(join(home2, 'data', 'projects.json'), JSON.stringify([{ name: 'old', path: '/old' }]));
    const r2 = projectAdd({ home: home2, env: { ND_HOME: '' }, source: app });
    assert.equal(r2.manifest, join(home2, 'data', 'projects.json'));
    assert.ok(!existsSync(join(home2, 'data', 'projects.edn')), 'a new projects.edn would shadow projects.json');
    const text = readFileSync(r2.manifest, 'utf8');
    assert.equal(manifestProjectPath(text, r2.manifest, 'old'), '/old');
    assert.equal(manifestProjectPath(text, r2.manifest, 'app'), r2.path);
    assert.throws(() => projectAdd({ home: home2, env: { ND_HOME: '' }, source: app }), /already in/);

    const home3 = join(s.dir, 'home3'); mkdirSync(join(home3, 'data'), { recursive: true });
    writeFileSync(join(home3, 'data', 'projects.md'), '- old: my old app\n');
    assert.throws(() => projectAdd({ home: home3, env: { ND_HOME: '' }, source: app }), /free text/);
    assert.equal(readFileSync(join(home3, 'data', 'projects.md'), 'utf8'), '- old: my old app\n');
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

test('bootstrap stops on a marketplace install with the uninstall step, and changes nothing until it is gone', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir);
    const xs = join(s.dir, 'xs');
    mkdirSync(join(xs, 'no-deceit'), { recursive: true });
    writeFileSync(join(xs, 'no-deceit', 'ledger.jsonl'), '{"event":"x"}\n');
    const env = { ND_HOME: '', HOME: userHome, XDG_STATE_HOME: xs };
    const installed = join(userHome, '.claude', 'plugins', 'installed_plugins.json');
    writeFileSync(installed, JSON.stringify({ version: 2, plugins: { 'no-deceit@no-deceit': [{}] } }));
    assert.throws(() => bootstrap({ home, userHome, env }), /nothing changed[\s\S]*marketplace plugin \(no-deceit@no-deceit\)[\s\S]*claude plugin uninstall no-deceit/);
    assert.throws(() => bootstrap({ home, userHome, env, dryRun: true }), /claude plugin uninstall no-deceit/);
    assert.ok(!existsSync(join(home, '.nd-home')));
    assert.ok(!existsSync(join(home, 'state')));
    assert.ok(!existsSync(join(userHome, '.claude', 'skills', 'no-deceit')));

    writeFileSync(installed, JSON.stringify({ version: 2, plugins: {} }));
    bootstrap({ home, userHome, env });
    assert.ok(existsSync(join(home, '.nd-home')));
    assert.equal(readlinkSync(join(userHome, '.claude', 'skills', 'no-deceit')), join(home, 'harness', 'claude-code'));
    assert.equal(readFileSync(join(home, 'state', 'ledger.jsonl'), 'utf8'), '{"event":"x"}\n');
  } finally { s.cleanup(); }
});

test('bootstrap stops on an older skills-dir entry with the move-aside step, and never replaces it', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir);
    const old = join(s.dir, 'old-clone'); mkdirSync(old);
    const link = join(userHome, '.claude', 'skills', 'no-deceit');
    mkdirSync(join(userHome, '.claude', 'skills'), { recursive: true });
    symlinkSync(old, link);
    assert.throws(() => bootstrap({ home, userHome, env: { ND_HOME: '', HOME: userHome } }), new RegExp(`nothing changed[\\s\\S]*already a symlink to ${old}[\\s\\S]*mv ${link} ${join(userHome, 'no-deceit.old')}\n`));
    assert.equal(readlinkSync(link), old);
    assert.ok(!existsSync(join(home, '.nd-home')));
  } finally { s.cleanup(); }
});

test('bootstrap runs the Claude preflight whatever harness flags are passed', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir, { opencode: true, pi: true, cursor: true });
    writeFileSync(join(userHome, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'no-deceit@no-deceit': [{}] } }));
    for (const only of [['opencode'], ['pi'], ['cursor']]) {
      assert.throws(() => bootstrap({ home, userHome, env: { ND_HOME: '', HOME: userHome }, only }), /nothing changed[\s\S]*claude plugin uninstall no-deceit/);
    }
    assert.ok(!existsSync(join(home, '.nd-home')));
    assert.ok(!existsSync(join(userHome, '.config', 'opencode', 'plugins')));
    assert.ok(!existsSync(join(userHome, '.cursor', 'hooks.json')));
  } finally { s.cleanup(); }
});

test('bootstrap run from a home inside the skills dir says to move the checkout out first', () => {
  const s = scratch();
  try {
    const userHome = fakeUser(s.dir);
    const home = join(userHome, '.claude', 'skills', 'no-deceit'); mkdirSync(home, { recursive: true });
    assert.throws(() => bootstrap({ home, userHome, env: { ND_HOME: '', HOME: userHome } }),
      new RegExp(`inside the skills dir[\\s\\S]*mv ${home} ${join(userHome, 'no-deceit')} && ${join(userHome, 'no-deceit', 'bin', 'nd')} bootstrap`));
    assert.ok(!existsSync(join(home, '.nd-home')));
  } finally { s.cleanup(); }
});

test('bootstrap treats a skills-dir symlink to the home root as an older link to move out, not as the checkout', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir);
    const link = join(userHome, '.claude', 'skills', 'no-deceit');
    mkdirSync(join(userHome, '.claude', 'skills'), { recursive: true });
    symlinkSync(home, link);
    let msg = '';
    try { bootstrap({ home, userHome, env: { ND_HOME: '', HOME: userHome } }); } catch (e) { msg = e.message; }
    assert.match(msg, new RegExp(`nothing changed[\\s\\S]*already a symlink to ${home}[\\s\\S]*mv ${link} ${join(userHome, 'no-deceit.old')}\n`));
    assert.doesNotMatch(msg, /inside the skills dir/);
    assert.equal(readlinkSync(link), home);
    assert.ok(!existsSync(join(home, '.nd-home')));
  } finally { s.cleanup(); }
});

test('bootstrap stops, with nothing changed, when an OpenCode or Pi link or the Cursor hooks file conflicts', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir, { claude: false, opencode: true, pi: true, cursor: true });
    const env = { ND_HOME: '', HOME: userHome };
    const old = join(s.dir, 'old-clone', 'no-deceit.ts'); mkdirSync(dirname(old), { recursive: true }); writeFileSync(old, '');
    const cases = [
      ['opencode', join(userHome, '.config', 'opencode', 'plugins', 'no-deceit.ts')],
      ['pi', join(userHome, '.pi', 'agent', 'extensions', 'no-deceit.ts')],
    ];
    for (const [h, link] of cases) {
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(old, link);
      assert.throws(() => bootstrap({ home, userHome, env, only: [h] }),
        new RegExp(`nothing changed[\\s\\S]*already a symlink to ${old}[\\s\\S]*mv ${link} ${join(userHome, `no-deceit-${h}.ts.old`)}`));
      assert.ok(!existsSync(join(home, '.nd-home')));
      assert.equal(readlinkSync(link), old);
      rmSync(link);
    }
    writeFileSync(join(userHome, '.cursor', 'hooks.json'), '{ not json');
    assert.throws(() => bootstrap({ home, userHome, env, only: ['cursor'] }), /nothing changed[\s\S]*hooks\.json is not valid JSON/);
    assert.ok(!existsSync(join(home, '.nd-home')));
    assert.equal(readFileSync(join(userHome, '.cursor', 'hooks.json'), 'utf8'), '{ not json');

    rmSync(join(userHome, '.cursor', 'hooks.json'));
    bootstrap({ home, userHome, env });
    assert.ok(existsSync(join(home, '.nd-home')));
    assert.equal(readlinkSync(cases[0][1]), join(home, 'harness', 'opencode', 'no-deceit.ts'));
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

test('bootstrap carries XDG config and data into the home: copies absent files, overwrites nothing, reports it', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir, { claude: false });
    const xc = join(s.dir, 'xc'); const xd = join(s.dir, 'xd');
    const env = { ND_HOME: '', HOME: userHome, XDG_STATE_HOME: join(s.dir, 'xs'), XDG_CONFIG_HOME: xc, XDG_DATA_HOME: xd };
    mkdirSync(join(xc, 'no-deceit'), { recursive: true });
    writeFileSync(join(xc, 'no-deceit', 'config.json'), '{"graderModel":"sonnet"}');
    const xdata = join(xd, 'no-deceit');
    mkdirSync(join(xdata, 'curricula', 'etl'), { recursive: true });
    writeFileSync(join(xdata, 'curricula', 'etl', 'curriculum.md'), '# etl');
    mkdirSync(join(xdata, 'evidence', 'etl'), { recursive: true });
    writeFileSync(join(xdata, 'evidence', 'etl', 'a-teach.md'), 'teach');
    writeFileSync(join(xdata, 'projects.edn'), '{:name "app" :path "/app"}\n');
    mkdirSync(join(xdata, '.git'));
    writeFileSync(join(xdata, '.git', 'HEAD'), 'ref: refs/heads/other\n');
    mkdirSync(join(home, 'data', 'evidence', 'etl'), { recursive: true });
    writeFileSync(join(home, 'data', 'evidence', 'etl', 'a-teach.md'), 'mine');

    const dry = bootstrap({ home, userHome, env, dryRun: true }).join('\n');
    assert.match(dry, /config: copied/);
    assert.ok(!existsSync(join(home, 'config', 'config.json')));

    const out = bootstrap({ home, userHome, env }).join('\n');
    assert.match(out, /config: copied .*config\.json/);
    assert.match(out, /data: copied 2 file\(s\) \(curricula, projects\.edn\)/);
    const homeEnv = { ...env, ND_HOME: home };
    assert.equal(loadConfig(homeEnv).graderModel, 'sonnet');
    assert.ok(existsSync(dataPaths(homeEnv).curriculumFile('etl')));
    assert.equal(readFileSync(join(home, 'data', 'evidence', 'etl', 'a-teach.md'), 'utf8'), 'mine');
    assert.notEqual(readFileSync(join(home, 'data', '.git', 'HEAD'), 'utf8'), 'ref: refs/heads/other\n');
    assert.ok(existsSync(join(xdata, 'projects.edn')) && existsSync(join(xc, 'no-deceit', 'config.json')));

    writeFileSync(join(home, 'config', 'config.json'), '{"graderModel":"opus"}');
    assert.doesNotMatch(bootstrap({ home, userHome, env }).join('\n'), /config: copied|data: copied/);
    assert.equal(loadConfig(homeEnv).graderModel, 'opus');
  } finally { s.cleanup(); }
});

test('the XDG carry-over is one-shot: a re-run never brings back files deleted from the home', () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'); mkdirSync(home);
    const userHome = fakeUser(s.dir, { claude: false });
    const xs = join(s.dir, 'xs'); const xc = join(s.dir, 'xc'); const xd = join(s.dir, 'xd');
    const env = { ND_HOME: '', HOME: userHome, XDG_STATE_HOME: xs, XDG_CONFIG_HOME: xc, XDG_DATA_HOME: xd };
    mkdirSync(join(xs, 'no-deceit'), { recursive: true });
    writeFileSync(join(xs, 'no-deceit', 'ledger.jsonl'), '{"event":"old"}\n');
    mkdirSync(join(xc, 'no-deceit'), { recursive: true });
    writeFileSync(join(xc, 'no-deceit', 'config.json'), '{"graderModel":"sonnet"}');
    mkdirSync(join(xd, 'no-deceit', 'evidence', 'etl'), { recursive: true });
    writeFileSync(join(xd, 'no-deceit', 'evidence', 'etl', 'a-teach.md'), 'bad teach-back');
    writeFileSync(join(xd, 'no-deceit', 'projects.edn'), '{:name "app" :path "/app"}\n');

    const first = bootstrap({ home, userHome, env }).join('\n');
    assert.match(first, /data: copied 2 file/);
    const teach = join(home, 'data', 'evidence', 'etl', 'a-teach.md');
    assert.ok(existsSync(teach));

    rmSync(teach);
    rmSync(join(home, 'data', 'projects.edn'));
    writeFileSync(join(home, 'data', 'projects.json'), '[]');
    rmSync(join(home, 'config', 'config.json'));
    rmSync(join(home, 'state', 'ledger.jsonl'));

    const again = bootstrap({ home, userHome, env }).join('\n');
    assert.match(again, /already migrated/);
    assert.doesNotMatch(again, /(ledger|config|data): copied/);
    for (const f of [teach, join(home, 'data', 'projects.edn'), join(home, 'config', 'config.json'), join(home, 'state', 'ledger.jsonl')]) {
      assert.ok(!existsSync(f), `${f} was brought back`);
    }
    assert.ok(existsSync(join(xd, 'no-deceit', 'evidence', 'etl', 'a-teach.md')), 'the XDG originals are never deleted');
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
