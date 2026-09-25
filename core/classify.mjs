// No Deceit — tool-call classifier (PURE, zero dependencies).
//
// classify(toolName, toolInput, cfg) -> category 'A'..'H' or 'U'.
//
//   A  inspect / read-only
//   B  run / feedback (execute, do not author)
//   C  tooling / env
//   D  test scaffold
//   E  source mutation
//   F  delegation
//   G  tamper (touches No Deceit state, or a mutating `nd` subcommand)
//   H  design artifact (Mermaid / Excalidraw / mind-map / other diagram source,
//      as a file write or a diagram renderer invocation)
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

// The undotted home state/config dirs (~/.config/no-deceit, ~/.local/state/no-deceit,
// or their XDG-var forms). Tilde, $HOME, and relative spellings all reduce to one of
// these location-anchored segments, so match the segment rather than a resolved prefix
// — and never a bare 'no-deceit' token, which is the repo's own name.
const RE_HOME_STATE_CMD = /(?:\.config\/|\.local\/state\/|XDG_(?:CONFIG|STATE)_HOME\}?\/)no-deceit(\/|$|\b)/;

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

// --- Design-artifact (category H) detection ------------------------------------

const RE_DIAGRAM_PATH = /\.(excalidraw(\.json)?|mmd|mermaid|drawio|puml|d2|dot)$/i;
const RE_MARKDOWN_PATH = /\.(md|markdown)$/i;
// A mermaid/plantuml/d2/dot fence opener, or a mind-map block, in written content.
const RE_DIAGRAM_CONTENT = /(^|\n)\s*(`{3,}|~{3,})\s*(mermaid|mmd|plantuml|puml|d2|dot|graphviz|excalidraw|mindmap)\b|(^|\n)\s*mindmap\s*(\n|$)/i;

function isDiagramPath(path) {
  return Boolean(path) && RE_DIAGRAM_PATH.test(String(path).replace(/\\/g, '/'));
}

/** Does content written to a markdown file carry a diagram fence or mind-map block? */
function markdownCarriesDiagram(path, content) {
  return Boolean(path) && RE_MARKDOWN_PATH.test(String(path)) && RE_DIAGRAM_CONTENT.test(String(content || ''));
}

// Diagram renderers. A Bash command that invokes one is diagram creation (H),
// whatever feeds it, the learner's own file included: they render in their own
// terminal. Matched on the raw command, no shell-quote parsing, and only in
// command position: at the start, after a shell operator, `(`, `$(`, a backtick,
// `{` or an opening quote (so quoted text leans toward blocking), or after a
// launcher word and its flags. `dot` counts only with a `-T` flag. A renderer
// name merely mentioned as an argument (`grep -rn mmdc`, `cat plantuml-notes.md`,
// `ls dotfiles`) is not an invocation.
const RE_RENDERER_CMD = new RegExp(
  '(?:(?:^|[|;&\\n(`\'"{])\\s*(?:[A-Za-z_]\\w*=\\S*\\s+)*' +
  '|\\b(?:npx|bunx|dlx|exec|xargs|env|command|time|nice|nohup|sudo|sh|bash|then|do|else)(?:\\s+-\\S+)*\\s+)' +
  '(?:[^\\s\'"|;&]*/)?' +
  '(?:(?:mmdc|plantuml|excalidraw-cli|d2|@mermaid-js/mermaid-cli)(?=[\\s;|&)@]|$)|dot\\s+-T)',
);

// --- Bash shape detection ------------------------------------------------

const RE_MUTATING_ND = /(^|[\s;&|(])nd\s+(tier|mode|unlock|init|reset|set|check)\b/;
const RE_READONLY_ND = /(^|[\s;&|(])nd\s+(status|ledger|show|doctor|help|audit|report)\b/;

// Unambiguous file-authoring shapes: specific syntax that always writes, so
// they route by target before run/pkg-manager commands are considered.
const AUTHORING_SHAPES = [
  /(^|[^0-9<>&])>>?(?![>&])/, // > or >> redirect (not >> heredoc-close, not 2>&1)
  /\btee\b/,
  /\bsed\s+-i\b/,
  /\bperl\s+-i\b/,
  /\bg?awk\s+-i\b/, // gawk in-place edit (-i inplace)
  /\bruby\s+-i\b/, // ruby in-place edit
  /\bgit\s+apply\b/,
  /<<-?\s*['"]?[A-Za-z_]/, // heredoc
  /\bspit\b/, // clojure file write
  /open\s*\([^)]*['"][wa]\+?['"]/, // python open(...,'w'|'a')
  /\bwrite_?[Ff]ile(Sync)?\b/, // node fs.writeFile / writeFileSync
  // NOTE: deliberately no generic `.write(` — it would misclassify a
  // sys.stdout.write() REPL probe as a file write and break the run loop.
];

// Wrappers that run another command; a leading one must not hide the real
// command word from command-position detection.
const WRAPPER_CMDS = new Set(['env', 'nice', 'time', 'nohup', 'sudo', 'command', 'stdbuf', 'ionice', 'xargs']);

// Strip leading VAR=val assignments and wrapper commands (with their options)
// so `env cp …` / `sudo mv …` expose their real command word.
function stripWrappers(cmd) {
  let s = String(cmd).trim();
  for (;;) {
    const assign = s.match(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/);
    if (assign) { s = s.slice(assign[0].length); continue; }
    const opt = s.match(/^-\S*\s+/);
    if (opt) { s = s.slice(opt[0].length); continue; }
    const word = s.match(/^(\S+)(?:\s+|$)/);
    if (word && WRAPPER_CMDS.has(word[1])) { s = s.slice(word[0].length); continue; }
    break;
  }
  return s;
}

// Bare-word mutation commands. These share their name with subcommands and
// arguments (`npm run patch-package`, `docker cp`, `git mv`), so they only
// count when the word is in command position: at the start, or right after a
// pipe / ; / && / || / ( separator.
const COMMAND_MUTATORS = [
  /(^|[;&|(])\s*patch\s/,
  /(^|[;&|(])\s*cp\s/,
  /(^|[;&|(])\s*mv\s/,
  /(^|[;&|(])\s*dd\s+.*\bof=/,
];

// Read-only inspection commands (first token, or after a pipe).
const READONLY_CMDS = ['ls', 'cat', 'rg', 'grep', 'find', 'head', 'tail', 'wc', 'less', 'more', 'stat', 'file', 'tree', 'pwd', 'echo', 'which', 'env', 'printenv', 'date', 'df', 'du', 'ps', 'top', 'diff', 'jq', 'awk', 'sort', 'uniq', 'cut', 'cd', 'pushd', 'popd', 'export', 'set', 'umask', 'mkdir', 'true', 'false', ':'];
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
  /\bcargo\s+(add|install)\b/,
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

// Split a command into segments on the shell operators && || ; | and newlines,
// leaving operators that appear inside single/double quotes untouched.
function splitSegments(cmd) {
  const segs = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '\n' || ch === ';') { segs.push(cur); cur = ''; continue; }
    if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) { segs.push(cur); cur = ''; i++; continue; }
    if (ch === '|') { segs.push(cur); cur = ''; continue; }
    cur += ch;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

// Most-restrictive-wins rank across the segments of a compound command.
const CATEGORY_RANK = { G: 6, H: 5.5, E: 5, U: 4, C: 3, D: 3, B: 2, A: 1 };

function classifyBash(cmd, cfg) {
  const c = String(cmd || '');
  const prefixes = cfg.statePathPrefixes || [];

  // G: tamper is judged on the whole command so a state reference anywhere wins.
  if (RE_MUTATING_ND.test(c)) return 'G';
  const nc = c.replace(/\\/g, '/');
  const touchesState = prefixes.some((p) => c.includes(String(p).replace(/\/+$/, '')));
  if (touchesState || RE_STATE_SEGMENT_CMD.test(nc) || RE_HOME_STATE_CMD.test(nc)) return 'G';

  // H: any diagram renderer invocation, judged on the whole raw command.
  if (RE_RENDERER_CMD.test(c)) return 'H';
  // Diagram content written into markdown: the heredoc body lives on later lines,
  // so the per-segment router cannot see it.
  if (AUTHORING_SHAPES.some((rx) => rx.test(c)) && writeTargets(c).some((t) => markdownCarriesDiagram(t, c))) return 'H';

  // Classify each segment; return the most restrictive category.
  const segs = splitSegments(c);
  const list = segs.length ? segs : [c];
  let worst = null;
  for (const seg of list) {
    const cat = classifyBashSegment(seg, cfg);
    if (worst === null || CATEGORY_RANK[cat] > CATEGORY_RANK[worst]) worst = cat;
  }
  return worst;
}

function classifyBashSegment(cmd, cfg) {
  const c = String(cmd || '');
  const prefixes = cfg.statePathPrefixes || [];

  // G: tamper — mutating nd subcommand, or any reference to a state path.
  if (RE_MUTATING_ND.test(c)) return 'G';
  const nc = c.replace(/\\/g, '/');
  const touchesState = prefixes.some((p) => c.includes(String(p).replace(/\/+$/, '')));
  if (touchesState || RE_STATE_SEGMENT_CMD.test(nc) || RE_HOME_STATE_CMD.test(nc)) return 'G';

  // Read-only nd is inspect.
  if (RE_READONLY_ND.test(c)) return 'A';

  // E/C/D: route a file mutation by its target path.
  const routeByTarget = () => {
    const targets = writeTargets(c);
    // A write whose target names state is tamper, absolute or relative.
    if (targets.some((t) => namesStatePath(t, prefixes))) return 'G';
    // A write to a diagram source, or diagram content into markdown, is H.
    if (targets.some((t) => isDiagramPath(t) || markdownCarriesDiagram(t, c))) return 'H';
    // If any target is a test path -> D; tooling path -> C; else E.
    if (targets.some((t) => matchesAny(t, cfg.testGlobs || []))) return 'D';
    if (targets.some((t) => matchesAny(t, cfg.toolingGlobs || []))) return 'C';
    return 'E';
  };

  // Unambiguous file-authoring shapes first (specific, target-bearing syntax).
  if (AUTHORING_SHAPES.some((rx) => rx.test(c))) return routeByTarget();

  // C: package managers / env tooling.
  if (PKG_MANAGER.some((rx) => rx.test(c))) return 'C';

  // B: run / build / test / eval.
  if (RUN_PATTERNS.some((rx) => rx.test(c))) return 'B';
  // Command-word detection runs on the wrapper-stripped command so a wrapper
  // prefix cannot hide the real command.
  const bare = stripWrappers(c);
  const first = bare.split(/\s+/)[0];
  if (RUN_CMDS.includes(first)) return 'B';

  // Bare-word mutation commands only when in command position.
  if (COMMAND_MUTATORS.some((rx) => rx.test(bare))) return routeByTarget();

  // A: read-only inspection.
  if (READONLY_GIT.test(bare)) return 'A';
  if (READONLY_CMDS.includes(first)) return 'A';

  // U: unknown shape.
  return 'U';
}

// The new text a Write/Edit/MultiEdit/NotebookEdit call would put on disk.
function writtenContent(input) {
  const parts = [input.content, input.new_string, input.new_source];
  if (Array.isArray(input.edits)) for (const e of input.edits) parts.push(e && e.new_string);
  return parts.filter((x) => typeof x === 'string').join('\n');
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
    if (isDiagramPath(path)) return 'H';
    if (markdownCarriesDiagram(path, writtenContent(toolInput))) return 'H';
    if (matchesAny(path, cfg.testGlobs || [])) return 'D';
    if (matchesAny(path, cfg.toolingGlobs || [])) return 'C';
    return 'E';
  }

  // Read, Grep, Glob, WebFetch, WebSearch, NotebookRead, LS, and other
  // read-only tools are inspect.
  return 'A';
}
