// No Deceit — the home repo shell: layout, `nd project add`, `nd bootstrap`,
// `nd update`. Imperative (fs + git) around the pure helpers in update.mjs.
//
// The home is a git checkout with four gitignored personal dirs (projects/
// data/ state/ config/). `data/` is its own nested private git repo (R7).
// Nothing here ever edits, moves or deletes inside those dirs on update, and
// bootstrap never overwrites a link or a file it did not create.

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync, readlinkSync,
  copyFileSync, realpathSync, readdirSync,
} from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { projectPaths, loadConfig, readProjectState, homePaths, dataPaths, gitToplevel } from './state.mjs';
import {
  PRIVATE_DIRS, addManifestEntry, manifestHasProject, projectNameFrom, isRemoteSource,
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
 * governed in place (never moved), and must be its git repo's top level (the
 * repo root the hooks resolve). Registers it in the project manifest the grader
 * reads (the first existing projects.{edn,json,md} in the data home, else
 * projects.edn) and runs the equivalent of `nd init` inside it.
 */
export function projectAdd({ home, userHome = homedir(), env, source, name, summary = '' }) {
  if (!source) throw new Error('usage: nd project add <git-url|path> [--name n] [--summary "…"]');
  const remote = isRemoteSource(source);
  let target = null;
  if (!remote) {
    const abs = resolve(source);
    if (!existsSync(abs) || !lstatSync(abs).isDirectory()) throw new Error(`${source} is not a directory or a git URL`);
    target = realpathSync(abs);
    const top = realpathSync(gitToplevel(target));
    if (top !== target) {
      const personal = [home, userHome].some((d) => { try { return realpathSync(d) === top; } catch { return false; } });
      throw new Error(`${source} is inside the git repo ${top}, so sessions there would resolve to that repo; ` + (personal
        ? `make it its own project first (or move it out): git init ${target} && nd project add ${target}`
        : `govern that whole repository instead: nd project add ${top}`));
    }
  }
  const projName = name || (remote ? projectNameFrom(source) : basename(target));
  if (!/^[A-Za-z0-9][\w.-]*$/.test(projName)) throw new Error(`invalid project name "${projName}" (use --name)`);
  ensureHome(home);
  const dp = dataPaths({ ...env, ND_HOME: home });
  const manifest = dp.projectsManifests.find((f) => existsSync(f)) || dp.projectsManifests[0];
  const current = existsSync(manifest) ? readFileSync(manifest, 'utf8') : '';
  if (manifestHasProject(current, manifest, projName)) throw new Error(`project "${projName}" is already in ${manifest}`);
  if (remote) {
    target = join(home, 'projects', projName);
    if (existsSync(target)) throw new Error(`${target} already exists`);
  }
  const next = addManifestEntry(current, manifest, { name: projName, path: target, summary });
  if (remote) git(home, ['clone', '--', source, target]);
  const { state } = initProject(target, env);
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, next);
  return { name: projName, path: target, manifest, tier: state.tier, cloned: remote };
}

/** Copy every file under `from` that is absent under `to` (skipping a top-level `.git`). Returns the relative paths copied. */
function copyMissing(from, to, dryRun, rel = '') {
  const copied = [];
  for (const ent of readdirSync(join(from, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (!rel && ent.name === '.git') continue;
    if (ent.isDirectory()) { copied.push(...copyMissing(from, to, dryRun, r)); continue; }
    if (existsSync(join(to, r))) continue;
    if (!dryRun) { mkdirSync(dirname(join(to, r)), { recursive: true }); copyFileSync(join(from, r), join(to, r)); }
    copied.push(r);
  }
  return copied;
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

  // Preflight, before anything is written: a marketplace install, an older
  // skills-dir entry, or any requested link that already points elsewhere would
  // keep firing its own hooks against XDG state beside this home's. The Claude
  // checks run whatever harnesses were asked for. Re-running after the printed
  // step completes the bootstrap.
  const claudeLink = join(dirs.claude, 'skills', 'no-deceit');
  const claudeTarget = join(home, 'harness', 'claude-code');
  const blockers = [];
  const found = marketplaceInstalls(readJson(join(dirs.claude, 'plugins', 'installed_plugins.json')), readJson(join(dirs.claude, 'settings.json')));
  if (found.length) blockers.push(`No Deceit is already installed as a marketplace plugin (${found.join(', ')}). Uninstall it:  claude plugin uninstall no-deceit`);
  const a = linkAction(claudeTarget, claudeLink);
  if (a.kind === 'conflict') {
    const isHome = !lstatSync(claudeLink).isSymbolicLink() && realpathSync(claudeLink) === realpathSync(home);
    blockers.push(isHome
      ? `this home is ${claudeLink}, inside the skills dir Claude Code scans. Move the checkout out, then run bootstrap from its new location:  mv ${claudeLink} ${join(userHome, 'no-deceit')} && ${join(userHome, 'no-deceit', 'bin', 'nd')} bootstrap`
      : `${claudeLink} ${a.note.split(';')[0]} (an older install). Move it out of the skills dir:  mv ${claudeLink} ${join(userHome, 'no-deceit.old')}`);
  }
  const links = [];
  if (want('claude') && (only.includes('claude') || existsSync(dirs.claude))) links.push(['claude', claudeTarget, claudeLink]);
  const others = [];
  if (want('opencode') && (only.includes('opencode') || existsSync(dirs.opencode))) {
    others.push(['opencode', join(home, 'harness', 'opencode', 'no-deceit.ts'), join(dirs.opencode, 'plugins', 'no-deceit.ts')]);
  }
  if (want('pi') && (only.includes('pi') || existsSync(dirs.pi))) {
    others.push(['pi', join(home, 'harness', 'pi', 'no-deceit.ts'), join(dirs.pi, 'agent', 'extensions', 'no-deceit.ts')]);
  }
  for (const [h, target, linkPath] of others) {
    const o = linkAction(target, linkPath);
    if (o.kind === 'conflict') {
      blockers.push(`${linkPath} ${o.note.split(';')[0]} (an older ${h} install). Move it out of the dir ${h} loads from:  mv ${linkPath} ${join(userHome, `no-deceit-${h}.ts.old`)}`);
    }
    links.push([h, target, linkPath]);
  }
  const cursorFile = join(dirs.cursor, 'hooks.json');
  const wantCursor = want('cursor') && (only.includes('cursor') || existsSync(dirs.cursor));
  const cursorExisting = wantCursor && existsSync(cursorFile) ? readJson(cursorFile) : null;
  if (wantCursor && existsSync(cursorFile) && cursorExisting === null) blockers.push(`${cursorFile} is not valid JSON. Fix it by hand (it may hold other hooks)`);
  if (blockers.length) {
    throw new Error(`bootstrap stopped, nothing changed. Two installs would fire the hooks on every call and keep separate state.\n  ${blockers.join('\n  ')}\nThen re-run \`nd bootstrap\`.`);
  }

  say(`No Deceit home: ${home}${dryRun ? ' (dry run — nothing written)' : ''}`);
  if (!dryRun) {
    const made = ensureHome(home);
    say(made.length ? `  layout: created ${made.join(', ')}` : '  layout: projects/ data/ state/ config/ present; data/ is its own git repo');
  }

  // Continuity, once per home: copy (never move, never overwrite) the pre-home
  // XDG ledger, config and data into the home, which they stop being read from
  // once the marker is down. The migration record in state/ keeps a re-run
  // from bringing back a file the user has since deleted or replaced.
  const xdgEnv = { ...env, ND_HOME: '' };
  const homeEnv = { ...env, ND_HOME: home };
  const migrated = join(homePaths(homeEnv).stateDir, 'migrated-from-xdg');
  if (existsSync(migrated)) {
    say(`  xdg: already migrated (${readFileSync(migrated, 'utf8').trim()}); later XDG files are not copied`);
  } else {
    for (const [label, from, to] of [
      ['ledger', homePaths(xdgEnv).ledger, homePaths(homeEnv).ledger],
      ['config', homePaths(xdgEnv).configFile, homePaths(homeEnv).configFile],
    ]) {
      if (from !== to && existsSync(from) && !existsSync(to)) {
        if (!dryRun) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); }
        say(`  ${label}: copied ${from} → ${to} (the old file is left in place)`);
      }
    }
    const fromData = dataPaths(xdgEnv).dataDir;
    const toData = dataPaths(homeEnv).dataDir;
    if (fromData !== toData && existsSync(fromData)) {
      const copied = copyMissing(fromData, toData, dryRun);
      if (copied.length) {
        const tops = [...new Set(copied.map((f) => f.split('/')[0]))].sort();
        say(`  data: copied ${copied.length} file(s) (${tops.join(', ')}) from ${fromData} → ${toData}; existing files kept, the old dir is left in place`);
      }
    }
    if (!dryRun) { mkdirSync(dirname(migrated), { recursive: true }); writeFileSync(migrated, `migratedFromXdg ${new Date().toISOString()}\n`); }
  }

  for (const [h, target, linkPath] of links) {
    if (linkAction(target, linkPath).kind === 'ok') {
      say(`  ${h}: already linked (${linkPath})`);
    } else {
      if (!dryRun) { mkdirSync(dirname(linkPath), { recursive: true }); symlinkSync(target, linkPath); }
      say(`  ${h}: linked ${linkPath} → ${target}`);
    }
  }
  if (wantCursor) {
    const cursorHooks = mergeCursorHooks(cursorExisting, join(home, 'bin', 'nd'));
    if (!dryRun) { mkdirSync(dirs.cursor, { recursive: true }); writeFileSync(cursorFile, JSON.stringify(cursorHooks, null, 2) + '\n'); }
    say(`  cursor: preToolUse → ${join(home, 'bin', 'nd')} --cursor merged into ${cursorFile}`);
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
  say(`reread: ${c.reread ? 'yes' : 'no'}${c.reread ? '  (AGENTS.md / skills / agents, a hooks.json, or core/ / harness/ changed — restart your harness session)' : ''}`);
  say(`rebootstrap: ${c.rebootstrap ? 'yes' : 'no'}${c.rebootstrap ? '  (a harness entry file was added/removed/renamed — re-run `nd bootstrap`)' : ''}`);
  if (c.bbBump) say('bb.edn changed: check `bb --version` against :min-bb-version and update bb if needed.');
  return out;
}
