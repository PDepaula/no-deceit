// No Deceit — PURE helpers for the home repo: the project manifest entry,
// marketplace-install detection, the harness link plan, and `nd update`'s
// "what changed" classification. No fs / git / clock / env reads here; the
// shell in home.mjs feeds these strings and applies the results.

/** The gitignored, personal directories of a home. `nd update` never touches them. */
export const PRIVATE_DIRS = ['projects', 'data', 'state', 'config'];

/** One `data/projects.edn` line: `{:name "x" :path "/abs" :summary "…"}`. Double quotes in values become single quotes (the manifest reader has no escapes). */
export function renderManifestEntry({ name, path, summary = '' }) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, "'").replace(/\s+/g, ' ').trim()}"`;
  return `{:name ${q(name)} :path ${q(path)} :summary ${q(summary)}}`;
}

/** True when manifest text (`projects.edn` maps or a `projects.json` array) already names project `name`. */
export function manifestHasProject(text, fileName, name) {
  if (/\.json$/.test(fileName)) {
    let list;
    try { list = JSON.parse(text); } catch { return false; }
    return Array.isArray(list) && list.some((p) => p && p.name === name);
  }
  for (const [map] of String(text ?? '').matchAll(/\{[^{}]*\}/g)) {
    const n = /:name\s+"([^"]*)"/.exec(map);
    if (n && n[1] === name) return true;
  }
  return false;
}

/**
 * The manifest text with one project added, in that manifest's own format.
 * Only projects.edn and projects.json carry the path an unlock resolves; a
 * projects.md is free text, so it is refused rather than half-registered.
 */
export function addManifestEntry(text, fileName, { name, path, summary = '' }) {
  const cur = String(text ?? '');
  if (/\.json$/.test(fileName)) {
    let list = [];
    if (cur.trim()) {
      try { list = JSON.parse(cur); } catch { list = null; }
      if (!Array.isArray(list)) throw new Error(`${fileName} is not a JSON array of {name, path, summary}; fix it, then re-run`);
    }
    return JSON.stringify([...list, { name, path, summary }], null, 2) + '\n';
  }
  if (/\.edn$/.test(fileName)) {
    return cur + (cur && !cur.endsWith('\n') ? '\n' : '') + renderManifestEntry({ name, path, summary }) + '\n';
  }
  throw new Error(`${fileName} is free text, so the grader cannot resolve a project path from it; move its entries to projects.edn or projects.json, then re-run`);
}

/** A project name from a git URL: last segment, `.git` stripped. */
export function projectNameFrom(source) {
  const seg = String(source ?? '').replace(/[/\\]+$/, '').split(/[/\\:]/).pop() || '';
  return seg.replace(/\.git$/, '');
}

/** URLs and scp-style remotes are cloned; anything else is a local path. */
export function isRemoteSource(source) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(source) || /^[\w.-]+@[\w.-]+:/.test(source);
}

/**
 * Marketplace/plugin installs of No Deceit found in Claude Code's own records.
 * `installedJson` is `~/.claude/plugins/installed_plugins.json`, `settingsJson`
 * `~/.claude/settings.json` (either may be null). A marketplace install and a
 * bootstrapped skills-dir link both load the hooks, which then fire twice.
 */
export function marketplaceInstalls(installedJson, settingsJson) {
  const found = new Set();
  const isOurs = (key) => /^no-deceit@/.test(key) && !/@skills-dir$/.test(key);
  for (const key of Object.keys((installedJson && installedJson.plugins) || {})) if (isOurs(key)) found.add(key);
  for (const [key, on] of Object.entries((settingsJson && settingsJson.enabledPlugins) || {})) if (on && isOurs(key)) found.add(key);
  return [...found].sort();
}

/**
 * Merge Cursor's `preToolUse` entry for this home into a hooks.json object.
 * Any earlier No Deceit entry (`nd --cursor`, bare or absolute) is replaced.
 */
export function mergeCursorHooks(existing, ndPath) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const hooks = { ...(base.hooks || {}) };
  const ours = { command: `${ndPath} --cursor`, failClosed: true, timeout: 20 };
  const others = (Array.isArray(hooks.preToolUse) ? hooks.preToolUse : []).filter((h) => !/(^|\/)nd --cursor$/.test(String((h && h.command) || '')));
  hooks.preToolUse = [...others, ours];
  return { version: 1, ...base, hooks };
}

/** Shell-quote free PATH hint for `bin/`. */
export function pathHint(binDir) {
  return `export PATH="${binDir}:$PATH"`;
}

/**
 * Classify `git diff --name-status old new` lines for `nd update`.
 * reread: something a running session read at launch changed: AGENTS.md /
 * skills / agents (the tutor), a hooks.json (Claude Code's hook table), or
 * core/ and harness/ (loaded in-process once by the OpenCode and Pi adapters).
 * rebootstrap: a harness entry file was added, removed or renamed (symlinks
 * survive content edits, not a renamed target). bbBump: bb.edn changed.
 */
export function classifyChanges(nameStatus) {
  const rows = String(nameStatus ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [status, ...paths] = l.split(/\t/);
    return { status: status[0], paths };
  });
  const touched = (re) => rows.some((r) => r.paths.some((p) => re.test(p)));
  return {
    reread: touched(/^(AGENTS\.md|CLAUDE\.md|skills\/|agents\/|hooks\/hooks\.json$|core\/|harness\/)/),
    rebootstrap: rows.some((r) => 'ADR'.includes(r.status) && r.paths.some((p) => /^harness\/[^/]+\/[^/]+$/.test(p) || /^\.(claude|cursor)-plugin\//.test(p))),
    bbBump: touched(/^bb\.edn$/),
    releaseFiles: rows.filter((r) => 'AMR'.includes(r.status)).map((r) => r.paths[r.paths.length - 1]).filter((p) => /^docs\/releases\/[^/]+\.md$/.test(p)).sort(versionCompare),
  };
}

function versionKey(p) {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(p);
  return m ? m.slice(1).map(Number) : [Infinity];
}

/** Ascending by version number in the file name, then by name. */
export function versionCompare(a, b) {
  const ka = versionKey(a); const kb = versionKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
