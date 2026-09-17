// No Deceit — state I/O (the imperative shell around the pure core).
//
// Owns every path, every disk read/write, and the append-only ledger. State
// lives on disk, outside the conversation, so it survives compaction,
// --resume, restarts, and harness switches. XDG paths are used (not the
// Claude-only plugin data dir) so future OpenCode/Cursor/Pi adapters share
// one state and one ledger.
//
// Zero external dependencies: Node core config format is JSON (a TOML parser
// would be a dependency, which D6 forbids).

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const DEFAULTS = {
  tier: 1,
  mode: 'ask', // 'coach' | 'pair' | 'ask'
  t3TimeboxMinutes: 120,
  preambleMinChars: 40,
  graderModel: 'haiku',
  graderTimeoutMs: 120_000,
  attemptMinChars: 80,
  auditRuns: 3,
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

/** Home-scoped (XDG) paths: config file, state dir, ledger, sessions dir. */
export function homePaths(env = process.env) {
  const stateDir = join(xdg(env, 'XDG_STATE_HOME', ['.local', 'state']), 'no-deceit');
  const configDir = join(xdg(env, 'XDG_CONFIG_HOME', ['.config']), 'no-deceit');
  return {
    stateDir,
    configDir,
    configFile: join(configDir, 'config.json'),
    ledger: join(stateDir, 'ledger.jsonl'),
    sessionsDir: join(stateDir, 'sessions'),
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
    tier: raw.tier === 2 ? 2 : 1,
    mode: raw.mode || cfg.mode,
    unlocked: Boolean(raw.unlocked),
    lastUnlock: raw.lastUnlock || null,
    lastDiagnosis: raw.lastDiagnosis || null,
    pendingTutorNote: raw.pendingTutorNote || null,
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

/** Read the last `limit` ledger entries (chronological order). */
export function readLedger(env, limit = 50) {
  const { ledger } = homePaths(env);
  try {
    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
  } catch {
    return [];
  }
}

/** Build the config object the classifier needs, with absolute state-path prefixes. */
export function buildClassifyCfg(config, repoRoot, env = process.env) {
  const home = homePaths(env);
  const proj = projectPaths(repoRoot);
  return {
    statePathPrefixes: [proj.dir, home.stateDir, home.configDir],
    testGlobs: config.testGlobs,
    toolingGlobs: config.toolingGlobs,
    ndBin: 'nd',
  };
}
