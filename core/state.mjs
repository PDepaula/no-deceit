// No Deceit — state I/O (the imperative shell around the pure core).
//
// Owns every path, every disk read/write, and the append-only ledger. State
// lives on disk, outside the conversation, so it survives compaction,
// --resume, restarts, and harness switches. Home (`ND_HOME`) or XDG paths are
// used (not the Claude-only plugin data dir) so the OpenCode/Cursor/Pi
// adapters share one state and one ledger.
//
// Zero external dependencies: Node core config format is JSON (a TOML parser
// would be a dependency, which D6 forbids).

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const DEFAULTS = {
  tier: 2, // R1: Tier 2 is the default for every governed project.
  mode: 'ask', // 'coach' | 'pair' | 'ask'
  t3TimeboxMinutes: 120,
  preambleMinChars: 40,
  graderModel: 'haiku',
  graderTimeoutMs: 120_000,
  attemptMinChars: 80,
  auditRuns: 3,
  tier1MaxFenceLines: 6,
  projectNouns: [], // names of the developer's systems; a turn naming one is never a 'short turn'
  messageDisplayRedaction: true,
  tripwireIgnoreGlobs: [
    '**/.pytest_cache/**', '**/__pycache__/**', '**/*.pyc',
    '**/node_modules/**', '**/.git/**', '**/coverage/**', '**/.nyc_output/**',
    '**/dist/**', '**/build/**', '**/.next/**', '**/*.egg-info/**',
    '**/.tox/**', '**/.mypy_cache/**', '**/.ruff_cache/**', '**/target/**',
  ],
  testGlobs: [
    'test/**', 'tests/**', 'spec/**',
    '**/*_test.*', '**/*.test.*', '**/*.spec.*',
    '**/conftest.py', '**/test_*.py',
  ],
  toolingGlobs: [
    '**/deps.edn', '**/shadow-cljs.edn', '**/bb.edn',
    '**/package.json', '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock',
    '**/pyproject.toml', '**/poetry.lock', '**/requirements*.txt', '**/setup.cfg', '**/tox.ini',
    '**/Cargo.toml', '**/Cargo.lock', '**/go.mod', '**/go.sum',
    '**/Dockerfile', '**/docker-compose*.yml', '**/Makefile', '**/CMakeLists.txt',
    '**/tsconfig.json', '**/.eslintrc*', '**/.prettierrc*', '**/biome.json',
    '**/.github/**', '**/*.lock',
  ],
};

function xdg(env, varName, fallbackSub) {
  const base = env[varName] || join(env.HOME || homedir(), ...fallbackSub);
  return base;
}

/**
 * A checkout is a No Deceit *home* once `nd bootstrap` has dropped the
 * `.nd-home` marker in it (the gitignored projects/ data/ state/ config/ dirs
 * live beside it). Returns the home root for a checkout root, else null.
 */
export function detectHome(checkoutRoot) {
  return existsSync(join(checkoutRoot, '.nd-home')) ? checkoutRoot : null;
}

/**
 * Env with `ND_HOME` defaulted from the checkout the shim runs from. An
 * explicit `ND_HOME` (even the empty string, which turns the home off and
 * falls back to XDG) always wins.
 */
export function withDetectedHome(env, checkoutRoot) {
  if (env.ND_HOME !== undefined) return env;
  const home = detectHome(checkoutRoot);
  return home ? { ...env, ND_HOME: home } : env;
}

/** The checkout this code runs from (core/..): the candidate home for `defaultEnv`. */
export const CHECKOUT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `process.env` plus the home auto-detected from the running checkout. Shims use this; tests pass their own env. */
export function defaultEnv() {
  return withDetectedHome(process.env, CHECKOUT_ROOT);
}

/**
 * Home-scoped paths: config file, state dir, ledger, sessions dir. With a home
 * (`ND_HOME`) they are `<home>/config` and `<home>/state`; otherwise the XDG
 * fallback (~/.config/no-deceit, ~/.local/state/no-deceit).
 */
export function homePaths(env = process.env) {
  const stateDir = env.ND_HOME ? join(env.ND_HOME, 'state') : join(xdg(env, 'XDG_STATE_HOME', ['.local', 'state']), 'no-deceit');
  const configDir = env.ND_HOME ? join(env.ND_HOME, 'config') : join(xdg(env, 'XDG_CONFIG_HOME', ['.config']), 'no-deceit');
  return {
    stateDir,
    configDir,
    configFile: join(configDir, 'config.json'),
    ledger: join(stateDir, 'ledger.jsonl'),
    sessionsDir: join(stateDir, 'sessions'),
  };
}

/**
 * The No Deceit data home (evidence, verdicts, curricula, project manifest).
 * Resolution: `ND_DATA_DIR`, else `<ND_HOME>/data` (a checkout used as the
 * home, whose gitignored data/ may itself be a nested private git repo), else
 * the XDG fallback `$XDG_DATA_HOME/no-deceit` (~/.local/share/no-deceit). This
 * only computes paths; it never creates a directory or a git repo. Layout per
 * the redesign report §5.2: evidence/<topic>/, verdicts/<topic>/,
 * curricula/<topic>/curriculum.md, refs/<topic>/, projects.{edn,json,md}.
 */
export function dataPaths(env = process.env) {
  const dataDir = env.ND_DATA_DIR
    || (env.ND_HOME ? join(env.ND_HOME, 'data') : join(xdg(env, 'XDG_DATA_HOME', ['.local', 'share']), 'no-deceit'));
  return {
    dataDir,
    evidenceDir: (topic) => join(dataDir, 'evidence', topic),
    verdictsDir: (topic) => join(dataDir, 'verdicts', topic),
    curriculumFile: (topic) => join(dataDir, 'curricula', topic, 'curriculum.md'),
    refsDir: (topic) => join(dataDir, 'refs', topic),
    projectsManifests: ['projects.edn', 'projects.json', 'projects.md'].map((n) => join(dataDir, n)),
  };
}

/** Project-scoped paths under <repo>/.no-deceit. */
export function projectPaths(repoRoot) {
  const dir = join(repoRoot, '.no-deceit');
  return {
    dir,
    stateFile: join(dir, 'state.json'),
    attemptsDir: join(dir, 'attempts'),
    verdictsDir: join(dir, 'verdicts'),
    checksDir: join(dir, 'checks'),
    t3Dir: join(dir, 't3'),
    preambleFile: join(dir, 't3', 'preamble.md'),
    gitignore: join(dir, '.gitignore'),
  };
}

/** Resolve the git top-level for a working directory, falling back to cwd. */
export function gitToplevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return cwd;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

/** Merge the user config file over the built-in defaults. */
export function loadConfig(env = process.env) {
  const { configFile } = homePaths(env);
  const user = readJson(configFile, {});
  return { ...DEFAULTS, ...user };
}

/** Whether this project has opted in (a .no-deceit directory exists). */
export function isGoverned(repoRoot) {
  return existsSync(projectPaths(repoRoot).dir);
}

export function readProjectState(repoRoot, env = process.env) {
  const cfg = loadConfig(env);
  const raw = readJson(projectPaths(repoRoot).stateFile, {});
  return {
    tier: raw.tier === 1 || raw.tier === 2 ? raw.tier : (cfg.tier === 1 ? 1 : 2),
    mode: raw.mode || cfg.mode,
    unlocked: Boolean(raw.unlocked),
    lastUnlock: raw.lastUnlock || null,
    lastDiagnosis: raw.lastDiagnosis || null,
    pendingTutorNote: raw.pendingTutorNote || null,
    unlockedTopics: Array.isArray(raw.unlockedTopics) ? raw.unlockedTopics : [],
    ...(raw.t3ExpiresAtMs != null ? { t3ExpiresAtMs: raw.t3ExpiresAtMs } : {}),
  };
}

export function writeProjectState(repoRoot, state) {
  writeJson(projectPaths(repoRoot).stateFile, state);
}

export function readSession(env, sessionId) {
  if (!sessionId) return {};
  const { sessionsDir } = homePaths(env);
  return readJson(join(sessionsDir, `${sessionId}.json`), {});
}

export function writeSession(env, sessionId, patch) {
  const { sessionsDir } = homePaths(env);
  const file = join(sessionsDir, `${sessionId}.json`);
  const current = readJson(file, {});
  writeJson(file, { ...current, ...patch });
}

/** Is a non-trivial Tier 3 preamble present? */
export function preamblePresent(repoRoot, env = process.env) {
  const { preambleFile } = projectPaths(repoRoot);
  try {
    const size = statSync(preambleFile).size;
    if (size < loadConfig(env).preambleMinChars) return false;
    const text = readFileSync(preambleFile, 'utf8').trim();
    return text.length >= loadConfig(env).preambleMinChars;
  } catch {
    return false;
  }
}

/** Append one entry to the append-only ledger, stamping a timestamp. */
export function appendLedger(env, entry) {
  const { ledger } = homePaths(env);
  mkdirSync(dirname(ledger), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  appendFileSync(ledger, line + '\n');
}

function parseLedgerLines(lines) {
  return lines.map((l) => {
    try { return JSON.parse(l); } catch { return { raw: l }; }
  });
}

/** Read the last `limit` ledger entries (chronological order). */
export function readLedger(env, limit = 50) {
  const { ledger } = homePaths(env);
  try {
    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean);
    return parseLedgerLines(lines.slice(-limit));
  } catch {
    return [];
  }
}

/** Read the whole ledger (Phase 5 report). Missing file → []. */
export function readAllLedger(env) {
  const { ledger } = homePaths(env);
  try {
    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean);
    return parseLedgerLines(lines);
  } catch {
    return [];
  }
}

/**
 * The spellings of a state path a command is likely to use: the absolute
 * path and its `~/`, `$HOME/` and `${HOME}/` forms when it sits under HOME.
 * A relative spelling of a home's state/ config/ data/ is not matched: those
 * names are ordinary in any repo (an accepted gap, docs/verification).
 */
function statePathSpellings(abs, userHome) {
  const out = [abs];
  if (userHome && abs.startsWith(userHome.replace(/\/+$/, '') + '/')) {
    const rest = abs.slice(userHome.replace(/\/+$/, '').length);
    out.push(`~${rest}`, `$HOME${rest}`, `\${HOME}${rest}`);
  }
  return out;
}

/** Build the config object the classifier needs, with the state-path prefixes in every spelling. */
export function buildClassifyCfg(config, repoRoot, env = process.env) {
  const home = homePaths(env);
  const proj = projectPaths(repoRoot);
  // The data home holds evidence and verdicts: writes and Bash references to it
  // are tamper territory like the state dirs. Reads are not hook-enforced; the
  // tutor is instructed not to read evidence files (§3.5). The `.nd-home`
  // marker decides where state and config live, so it is state too.
  const abs = [proj.dir, home.stateDir, home.configDir, dataPaths(env).dataDir];
  if (env.ND_HOME) abs.push(join(env.ND_HOME, '.nd-home'));
  return {
    statePathPrefixes: abs.flatMap((p) => statePathSpellings(p, env.HOME || homedir())),
    testGlobs: config.testGlobs,
    toolingGlobs: config.toolingGlobs,
    ndBin: 'nd',
  };
}
