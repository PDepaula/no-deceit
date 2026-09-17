// No Deceit — tool-call classifier (PURE, zero dependencies).
//
// classify(toolName, toolInput, cfg) -> category 'A'..'G' or 'U'.
//
//   A  inspect / read-only
//   B  run / feedback (execute, do not author)
//   C  tooling / env
//   D  test scaffold
//   E  source mutation
//   F  delegation
//   G  tamper (touches No Deceit state, or a mutating `nd` subcommand)
//   U  unknown Bash shape (policy turns this into `ask` at gated tiers)
//
// This module never reads the filesystem, the clock, or the environment.
// Everything it needs is passed in via `cfg`.

/** Convert one glob (supporting **, *, ?) to an anchored RegExp. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** matches across path separators
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // swallow the slash after **
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

/** Does `absPath` match any glob in `globs`? Matches against the full path and its basename. */
function matchesAny(absPath, globs) {
  if (!absPath) return false;
  const norm = String(absPath).replace(/\\/g, '/');
  const base = norm.split('/').pop();
  return globs.some((g) => {
    const rx = globToRegExp(g);
    return rx.test(norm) || rx.test(base);
  });
}

// A path that names a No Deceit state segment, absolute or relative.
const RE_STATE_SEGMENT = /(^|\/)\.no-deceit(\/|$)/;

// The same segment, matched anywhere in a command string — after a space, '=',
// quote, or any boundary — so tamper is caught regardless of mutation shape.
const RE_STATE_SEGMENT_CMD = /\.no-deceit(\/|$|\b)/;

/** Is `absPath` under one of the No Deceit state-path prefixes? */
function underStatePath(absPath, prefixes) {
  if (!absPath) return false;
  const norm = String(absPath).replace(/\\/g, '/');
  return prefixes.some((p) => {
    const pn = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
    return norm === pn || norm.startsWith(pn + '/');
  });
}

/** Does `path` name No Deceit state — an absolute prefix or a relative `.no-deceit/` segment? */
function namesStatePath(path, prefixes) {
  if (!path) return false;
  if (underStatePath(path, prefixes)) return true;
  return RE_STATE_SEGMENT.test(String(path).replace(/\\/g, '/'));
}

// --- Bash shape detection ------------------------------------------------

const RE_MUTATING_ND = /(^|[\s;&|(])nd\s+(tier|mode|unlock|init|reset|set)\b/;
const RE_READONLY_ND = /(^|[\s;&|(])nd\s+(status|ledger|show|doctor|help)\b/;

// Shapes that author/overwrite a file.
const MUTATION_SHAPES = [
  /(^|[^0-9<>&])>>?(?![>&])/, // > or >> redirect (not >> heredoc-close, not 2>&1)
  /\btee\b/,
  /\bsed\s+-i\b/,
  /\bperl\s+-i\b/,
  /\bpatch\b/,
  /\bgit\s+apply\b/,
  /\bdd\s+.*\bof=/,
  /\binstall\s+-[^\s]*\s/, // install -m ... dest
  /\bcp\b/,
  /\bmv\b/,
  /<<-?\s*['"]?[A-Za-z_]/, // heredoc
  /\bspit\b/, // clojure file write
  /open\s*\([^)]*['"][wa]\+?['"]/, // python open(...,'w'|'a')
  /\bwrite_?[Ff]ile(Sync)?\b/, // node fs.writeFile / writeFileSync
  // NOTE: deliberately no generic `.write(` — it would misclassify a
  // sys.stdout.write() REPL probe as a file write and break the run loop.
];

// Read-only inspection commands (first token, or after a pipe).
const READONLY_CMDS = ['ls', 'cat', 'rg', 'grep', 'find', 'head', 'tail', 'wc', 'less', 'more', 'stat', 'file', 'tree', 'pwd', 'echo', 'which', 'env', 'printenv', 'date', 'df', 'du', 'ps', 'top', 'diff', 'jq', 'awk', 'sort', 'uniq', 'cut'];
const READONLY_GIT = /^git\s+(log|diff|status|show|blame|branch|remote|rev-parse|describe|ls-files|shortlog|stash\s+list)\b/;

// Commands that execute / build / run / eval (do not author source).
const RUN_CMDS = ['pytest', 'jest', 'vitest', 'mocha', 'tox', 'nox', 'make', 'cmake', 'ninja', 'cargo', 'go', 'mvn', 'gradle', 'bazel', 'rspec', 'phpunit', 'deno', 'bun', 'ruby', 'php', 'java', 'dotnet', 'psql', 'sqlite3', 'mysql', 'jupyter', 'bb', 'lein', 'clj', 'clojure', 'boot'];
const RUN_PATTERNS = [
  /\bnpm\s+(run|test|start|exec|ci)\b/,
  /\bnpm\s+t\b/,
  /\byarn\s+(run|test|start)\b/,
  /\bpnpm\s+(run|test|start)\b/,
  /\bnpx\s+/,
  /\bpython3?\s+-c\b/,
  /\bpython3?\s+-m\s+(pytest|unittest|http\.server)\b/,
  /\bpython3?\s+[^\s-][^\s]*\.py\b/, // running a .py file
  /\bnode\s+(--\S+\s+)*(-e|--eval)\b/,
  /\bnode\s+[^\s-][^\s]*\.(mjs|cjs|js|ts)\b/, // running a .js file
  /\bnode\s+--test\b/,
  /\b(clj|clojure)\s+-M\b/,
  /\b(clj|clojure)\s+-X\b/,
  /\bbb\s+(-e|-m|--eval)\b/,
  /\bcargo\s+(test|run|build|check)\b/,
  /\bgo\s+(test|run|build)\b/,
];

const PKG_MANAGER = [
  /\bnpm\s+(install|i|add|ci|update|uninstall|remove)\b/,
  /\byarn\s+(add|install|remove|up)\b/,
  /\bpnpm\s+(add|install|remove|update)\b/,
  /\bpip3?\s+(install|uninstall)\b/,
  /\bpoetry\s+(add|install|remove|update)\b/,
  /\b(clj|clojure)\s+-P\b/, // prep deps
  /\bapt(-get)?\s+(install|update)\b/,
  /\bbrew\s+(install|update|upgrade)\b/,
  /\bgem\s+install\b/,
  /\bcargo\s+add\b/,
  /\bgo\s+(get|mod)\b/,
];

/** Extract redirect / write targets from a shell command, best-effort. */
function writeTargets(cmd) {
  const targets = [];
  // > path  or  >> path
  const redir = /(?:^|[^0-9&<>])>>?\s*['"]?([^\s'";|&>]+)/g;
  let m;
  while ((m = redir.exec(cmd))) targets.push(m[1]);
  // tee path
  const tee = /\btee\s+(?:-a\s+)?['"]?([^\s'";|&]+)/g;
  while ((m = tee.exec(cmd))) targets.push(m[1]);
  // sed -i ... file  (last token-ish)
  const sedi = /\bsed\s+-i\S*\s+(?:-e\s+\S+\s+)*'[^']*'\s+['"]?([^\s'";|&]+)/g;
  while ((m = sedi.exec(cmd))) targets.push(m[1]);
  // cp/mv SRC DEST  -> DEST is the mutated path
  const cpmv = /\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+['"]?([^\s'";|&]+)/g;
  while ((m = cpmv.exec(cmd))) targets.push(m[1]);
  // python open('path','w')
  const pyopen = /open\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"][wa]/g;
  while ((m = pyopen.exec(cmd))) targets.push(m[1]);
  return targets;
}

function classifyBash(cmd, cfg) {
  const c = String(cmd || '');
  const prefixes = cfg.statePathPrefixes || [];

  // G: tamper — mutating nd subcommand, or any reference to a state path.
  if (RE_MUTATING_ND.test(c)) return 'G';
  const touchesState = prefixes.some((p) => c.includes(String(p).replace(/\/+$/, '')));
  if (touchesState || RE_STATE_SEGMENT_CMD.test(c.replace(/\\/g, '/'))) return 'G';

  // Read-only nd is inspect.
  if (RE_READONLY_ND.test(c)) return 'A';

  // E/C/D: mutation shapes — route by target path.
  const mutates = MUTATION_SHAPES.some((rx) => rx.test(c));
  if (mutates) {
    const targets = writeTargets(c);
    // A write whose target names state is tamper, absolute or relative.
    if (targets.some((t) => namesStatePath(t, prefixes))) return 'G';
    // If any target is a test path -> D; tooling path -> C; else E.
    if (targets.some((t) => matchesAny(t, cfg.testGlobs || []))) return 'D';
    if (targets.some((t) => matchesAny(t, cfg.toolingGlobs || []))) return 'C';
    return 'E';
  }

  // C: package managers / env tooling.
  if (PKG_MANAGER.some((rx) => rx.test(c))) return 'C';

  // B: run / build / test / eval.
  if (RUN_PATTERNS.some((rx) => rx.test(c))) return 'B';
  const first = c.trim().split(/\s+/)[0];
  if (RUN_CMDS.includes(first)) return 'B';

  // A: read-only inspection.
  if (READONLY_GIT.test(c.trim())) return 'A';
  if (READONLY_CMDS.includes(first)) return 'A';

  // U: unknown shape.
  return 'U';
}

export function classify(toolName, toolInput = {}, cfg = {}) {
  const prefixes = cfg.statePathPrefixes || [];

  if (toolName === 'Bash') {
    return classifyBash(toolInput.command, cfg);
  }

  if (toolName === 'Agent' || toolName === 'Task') {
    return 'F';
  }

  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
    const path = toolInput.file_path || toolInput.notebook_path || toolInput.path;
    if (namesStatePath(path, prefixes)) return 'G';
    if (matchesAny(path, cfg.testGlobs || [])) return 'D';
    if (matchesAny(path, cfg.toolingGlobs || [])) return 'C';
    return 'E';
  }

  // Read, Grep, Glob, WebFetch, WebSearch, NotebookRead, LS, and other
  // read-only tools are inspect.
  return 'A';
}
