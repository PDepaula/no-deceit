// No Deceit — the home repo shell: layout, `nd project add`, `nd bootstrap`,
// `nd update`. Imperative (fs + git) around the pure helpers in update.mjs.
//
// The home is a git checkout with four gitignored personal dirs (projects/
// data/ state/ config/). `data/` is its own nested private git repo (R7).
// Nothing here ever edits, moves or deletes inside those dirs on update, and
// bootstrap never overwrites a link or a file it did not create.

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync, readlinkSync,
  appendFileSync, copyFileSync, realpathSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { projectPaths, loadConfig, readProjectState, homePaths } from './state.mjs';
import {
  PRIVATE_DIRS, renderManifestEntry, manifestHasProject, projectNameFrom, isRemoteSource,
  marketplaceInstalls, mergeCursorHooks, pathHint, classifyChanges,
} from './update.mjs';

function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/** Opt a repo in: create `.no-deceit/` with the default-tier state. Returns the state. */
export function initProject(repoRoot, env) {
  const p = projectPaths(repoRoot);
  for (const d of [p.dir, p.attemptsDir, p.verdictsDir, p.checksDir, p.t3Dir]) mkdirSync(d, { recursive: true });
  if (!existsSync(p.stateFile)) writeFileSync(p.stateFile, JSON.stringify({ tier: loadConfig(env).tier === 1 ? 1 : 2, mode: 'ask', unlocked: false }, null, 2) + '\n');
  if (!existsSync(p.gitignore)) writeFileSync(p.gitignore, '# Local No Deceit state — not shared.\nstate.json\nverdicts/\n');
  return { paths: p, state: readProjectState(repoRoot, env) };
}

/** Create projects/ data/ state/ config/, the `.nd-home` marker, and `data/`'s nested git repo. Idempotent. */
export function ensureHome(home) {
  const made = [];
  for (const d of PRIVATE_DIRS) {
    if (!existsSync(join(home, d))) { mkdirSync(join(home, d), { recursive: true }); made.push(d); }
  }
  const marker = join(home, '.nd-home');
  if (!existsSync(marker)) writeFileSync(marker, 'This checkout is a No Deceit home; see `nd bootstrap`.\n');
  const dataDir = join(home, 'data');
  if (!existsSync(join(dataDir, '.git'))) {
    git(dataDir, ['init', '-q']);
    made.push('data/.git');
  }
  return made;
}

/**
 * `nd project add <git-url|path> [--name n] [--summary s] [--path]`.
 * A remote is cloned into projects/<name>; an existing local directory is
 * governed in place (never moved). Registers it in data/projects.edn (the
 * P2 manifest) and runs the equivalent of `nd init` inside it.
 */
export function projectAdd({ home, env, source, name, summary = '' }) {
  if (!source) throw new Error('usage: nd project add <git-url|path> [--name n] [--summary "…"]');
  const projName = name || projectNameFrom(source);
  if (!/^[A-Za-z0-9][\w.-]*$/.test(projName)) throw new Error(`invalid project name "${projName}" (use --name)`);
  ensureHome(home);
  const manifest = join(home, 'data', 'projects.edn');
  const current = existsSync(manifest) ? readFileSync(manifest, 'utf8') : '';
  if (manifestHasProject(current, projName)) throw new Error(`project "${projName}" is already in ${manifest}`);
  let target;
  if (isRemoteSource(source)) {
    target = join(home, 'projects', projName);
    if (existsSync(target)) throw new Error(`${target} already exists`);
    git(home, ['clone', '--', source, target]);
  } else {
    target = resolve(source);
    if (!existsSync(target) || !lstatSync(target).isDirectory()) throw new Error(`${source} is not a directory or a git URL`);
    target = realpathSync(target);
  }
  const { state } = initProject(target, env);
  appendFileSync(manifest, (current && !current.endsWith('\n') ? '\n' : '') + renderManifestEntry({ name: projName, path: target, summary }) + '\n');
  return { name: projName, path: target, manifest, tier: state.tier, cloned: isRemoteSource(source) };
}

function linkAction(target, linkPath) {
  let st = null;
  try { st = lstatSync(linkPath); } catch { /* absent */ }
  if (!st) return { kind: 'create', linkPath, target };
  if (st.isSymbolicLink()) {
    let cur = readlinkSync(linkPath);
    if (!cur.startsWith('/')) cur = resolve(dirname(linkPath), cur);
    let same = cur === target;
    if (!same) try { same = realpathSync(cur) === realpathSync(target); } catch { /* dangling */ }
    if (same) return { kind: 'ok', linkPath, target };
    return { kind: 'conflict', linkPath, target, note: `already a symlink to ${cur}; remove it yourself if it should point at this home (a second copy would fire the hooks twice)` };
  }
  return { kind: 'conflict', linkPath, target, note: 'exists and is not a symlink; move it aside yourself' };
}

/**
 * Work out (and unless dryRun, apply) the bootstrap. Harnesses default to
 * those whose user-level config dir exists. Returns lines to print.
 */
export function bootstrap({ home, userHome = homedir(), env, only = [], dryRun = false }) {
  const out = [];
  const say = (l) => out.push(l);
  const want = (h) => (only.length ? only.includes(h) : true);
  const dirs = {
    claude: join(userHome, '.claude'),
    opencode: join(userHome, '.config', 'opencode'),
    pi: join(userHome, '.pi'),
    cursor: join(userHome, '.cursor'),
  };

  say(`No Deceit home: ${home}${dryRun ? ' (dry run — nothing written)' : ''}`);
  if (!dryRun) {
    const made = ensureHome(home);
    say(made.length ? `  layout: created ${made.join(', ')}` : '  layout: projects/ data/ state/ config/ present; data/ is its own git repo');
  }

  // Ledger continuity: copy (never move) the pre-home XDG ledger once.
  const xdgLedger = homePaths({ ...env, ND_HOME: '' }).ledger;
  const homeLedger = join(home, 'state', 'ledger.jsonl');
  if (existsSync(xdgLedger) && !existsSync(homeLedger)) {
    if (!dryRun) copyFileSync(xdgLedger, homeLedger);
    say(`  ledger: copied ${xdgLedger} → ${homeLedger} (the old file is left in place)`);
  }

  const links = [];
  let cursorHooks = null;

  if (want('claude') && (only.includes('claude') || existsSync(dirs.claude))) {
    const found = marketplaceInstalls(readJson(join(dirs.claude, 'plugins', 'installed_plugins.json')), readJson(join(dirs.claude, 'settings.json')));
    if (found.length) {
      say(`  claude: SKIPPED — No Deceit is already installed as a marketplace plugin (${found.join(', ')}). Both would fire the hooks on every call.`);
      say('          Uninstall it first, then re-run `nd bootstrap`:  claude plugin uninstall no-deceit');
    } else {
      links.push(['claude', join(home, 'harness', 'claude-code'), join(dirs.claude, 'skills', 'no-deceit')]);
    }
  }
  if (want('opencode') && (only.includes('opencode') || existsSync(dirs.opencode))) {
    links.push(['opencode', join(home, 'harness', 'opencode', 'no-deceit.ts'), join(dirs.opencode, 'plugins', 'no-deceit.ts')]);
  }
  if (want('pi') && (only.includes('pi') || existsSync(dirs.pi))) {
    links.push(['pi', join(home, 'harness', 'pi', 'no-deceit.ts'), join(dirs.pi, 'agent', 'extensions', 'no-deceit.ts')]);
  }
  for (const [h, target, linkPath] of links) {
    const a = linkAction(target, linkPath);
    if (a.kind === 'create') {
      if (!dryRun) { mkdirSync(dirname(linkPath), { recursive: true }); symlinkSync(target, linkPath); }
      say(`  ${h}: linked ${linkPath} → ${target}`);
    } else if (a.kind === 'ok') {
      say(`  ${h}: already linked (${linkPath})`);
    } else {
      say(`  ${h}: CONFLICT ${linkPath} ${a.note}`);
    }
  }
  if (want('cursor') && (only.includes('cursor') || existsSync(dirs.cursor))) {
    const file = join(dirs.cursor, 'hooks.json');
    let existing = null;
    if (existsSync(file)) {
      existing = readJson(file);
      if (existing === null) say(`  cursor: CONFLICT ${file} is not valid JSON; fix it, then re-run`);
    }
    if (!existsSync(file) || existing !== null) {
      cursorHooks = mergeCursorHooks(existing, join(home, 'bin', 'nd'));
      if (!dryRun) { mkdirSync(dirs.cursor, { recursive: true }); writeFileSync(file, JSON.stringify(cursorHooks, null, 2) + '\n'); }
      say(`  cursor: preToolUse → ${join(home, 'bin', 'nd')} --cursor merged into ${file}`);
    }
  }

  say(`  PATH:   not edited. Add to your shell profile:  ${pathHint(join(home, 'bin'))}`);
  say('  next:   nd project add <git-url|path> --summary "…"   then start your harness inside the project');
  say('  Restart any running harness session: hooks and skills are read at launch.');
  return out;
}


/**
 * `nd update`: fetch, fast-forward only, then report. Never merges, stashes,
 * resets or forces, and never touches projects/ data/ state/ config/.
 */
export function update({ home }) {
  const out = [];
  const say = (l) => out.push(l);
  const run = (...a) => git(home, a);
  let upstream;
  try { upstream = run('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'); }
  catch { throw new Error('this checkout has no upstream branch; `git branch --set-upstream-to origin/main` first'); }
  const old = run('rev-parse', 'HEAD');
  run('fetch', '--quiet');
  const target = run('rev-parse', '@{u}');
  if (old === target) { say(`No Deceit is up to date (${old.slice(0, 7)}).`); return out; }
  let canFf = true;
  try { run('merge-base', '--is-ancestor', old, target); } catch { canFf = false; }
  if (!canFf) throw new Error(`refusing: HEAD ${old.slice(0, 7)} is not an ancestor of ${upstream} (${target.slice(0, 7)}) — local commits or a diverged history. nd update only fast-forwards; resolve it with git yourself.`);
  run('merge', '--ff-only', '--quiet', target);
  say(`Updated ${old.slice(0, 7)} → ${target.slice(0, 7)} (fast-forward; projects/ data/ state/ config/ untouched).`);
  const c = classifyChanges(run('diff', '--name-status', old, target));
  if (c.releaseFiles.length) {
    say('');
    say('Release notes since your last update:');
    for (const f of c.releaseFiles) {
      say('');
      say(`--- ${f}`);
      say(readFileSync(join(home, f), 'utf8').trimEnd());
    }
  } else {
    say('No new release notes between these commits.');
  }
  say('');
  say(`reread: ${c.reread ? 'yes' : 'no'}${c.reread ? '  (AGENTS.md / skills / agents changed — restart your harness session)' : ''}`);
  say(`rebootstrap: ${c.rebootstrap ? 'yes' : 'no'}${c.rebootstrap ? '  (a harness entry file was added/removed/renamed — re-run `nd bootstrap`)' : ''}`);
  if (c.bbBump) say('bb.edn changed: check `bb --version` against :min-bb-version and update bb if needed.');
  return out;
}

