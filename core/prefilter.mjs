// No Deceit — deterministic pre-filter for the Tier 2 unlock grader (PURE).
//
// Runs before any LLM call. A reject is `not_yet` with no model spend.
// Zero dependencies; no fs/clock/env reads — the caller supplies text and
// parsed commits.

export const DEFAULT_MIN_CHARS = 80;

const ERROR_LINE = new RegExp(
  String.raw`^\s*(` +
    [
      'at\\s+\\S+',
      'Error:',
      'TypeError:',
      'ReferenceError:',
      'SyntaxError:',
      'RangeError:',
      'AssertionError:',
      'Traceback\\s*\\(most recent call last\\)',
      'File\\s+".+",\\s+line\\s+\\d+',
      'Caused by:',
      '\\[ERROR\\]',
      'error TS\\d+',
      'FAILED',
      'java\\.\\w+\\.',
      'panic:',
      'fatal:',
      'Exception in thread',
      'npm ERR!',
      'FAIL\\s+',
    ].join('|') +
    `)`,
  'i',
);

function trimmed(text) {
  return String(text ?? '').trim();
}

function linesOf(text) {
  return trimmed(text).split(/\r?\n/).filter((l) => l.trim().length > 0);
}

export function errorLineRatio(text) {
  const lines = linesOf(text);
  if (lines.length === 0) return 0;
  const hits = lines.filter((l) => ERROR_LINE.test(l)).length;
  return hits / lines.length;
}

function normalizeForOverlap(text) {
  return trimmed(text).toLowerCase().replace(/\s+/g, ' ');
}

function overlapRatio(a, b) {
  const na = normalizeForOverlap(a);
  const nb = normalizeForOverlap(b);
  if (!na || !nb) return 0;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = na.length < nb.length ? na.length : nb.length;
    const longer = na.length < nb.length ? nb.length : na.length;
    return shorter / longer;
  }
  // token Jaccard on words of length >= 4, so "const" noise does not dominate
  const words = (s) => new Set(s.split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  const A = words(na);
  const B = words(nb);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/**
 * Mental-model route. evidence is the developer-written attempt text.
 * options.errorText, when present, is the error they would be pasting.
 */
export function prefilterMentalModel(evidence, options = {}) {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const text = trimmed(evidence);
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length < minChars) return { ok: false, reason: 'too_short' };
  if (errorLineRatio(text) >= 0.6) return { ok: false, reason: 'error_paste' };
  if (options.errorText && overlapRatio(text, options.errorText) >= 0.8) {
    return { ok: false, reason: 'error_paste' };
  }
  return { ok: true, reason: null };
}

function patchLines(patch) {
  return String(patch || '').split(/\r?\n/);
}

function changedPairs(patch) {
  const removed = [];
  const added = [];
  for (const line of patchLines(patch)) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { removed, added };
}

function stripSpace(s) {
  return s.replace(/\s+/g, '');
}

function stripFormat(s) {
  return s.replace(/\s+/g, '').replace(/[;,{}\[\]"'`]/g, '');
}

export function classifyPatch(file) {
  const status = file.status || 'modify';
  const similarity = file.similarity ?? 0;
  if (status === 'rename' && (similarity >= 100 || !trimmed(file.patch))) {
    return 'rename';
  }
  const patch = file.patch || '';
  if (!trimmed(patch)) return 'empty';
  const { removed, added } = changedPairs(patch);
  if (removed.length === 0 && added.length === 0) return 'empty';
  const spaceEqual =
    removed.map(stripSpace).join('\0') === added.map(stripSpace).join('\0') ||
    (removed.length === added.length && removed.every((r, i) => stripSpace(r) === stripSpace(added[i])));
  if (spaceEqual) return 'whitespace';
  const formatEqual =
    removed.map(stripFormat).filter(Boolean).join('\0') === added.map(stripFormat).filter(Boolean).join('\0');
  if (formatEqual) return 'format';
  return 'substantive';
}

function canonicalPath(file) {
  return file.path || file.to || file.from;
}

/**
 * Commit-history route. commits: [{ hash, subject, files: [{ path, status, from, similarity, patch }] }]
 * Drops whitespace/rename/format-only diffs, then requires ≥ 2 remaining
 * commits that touch the same unit (file path, following renames).
 */
export function prefilterCommitHistory(commits) {
  if (!Array.isArray(commits) || commits.length === 0) {
    return { ok: false, reason: 'too_few_attempts', commits: [] };
  }

  const kept = [];
  for (const commit of commits) {
    const files = [];
    for (const file of commit.files || []) {
      if (classifyPatch(file) === 'substantive') files.push(file);
    }
    if (files.length > 0) kept.push({ ...commit, files });
  }

  if (kept.length < 2) return { ok: false, reason: 'too_few_attempts', commits: kept };

  const units = new Map(); // path -> set of commit hashes
  for (const commit of kept) {
    for (const file of commit.files) {
      const paths = [canonicalPath(file), file.from].filter(Boolean);
      for (const p of paths) {
        if (!units.has(p)) units.set(p, new Set());
        units.get(p).add(commit.hash);
      }
    }
  }

  let shared = false;
  for (const hashes of units.values()) {
    if (hashes.size >= 2) { shared = true; break; }
  }
  if (!shared) return { ok: false, reason: 'no_shared_unit', commits: kept };
  return { ok: true, reason: null, commits: kept };
}

// --- Transfer route ---------------------------------------------------------

export const SOURCE_PASTE_THRESHOLD = 0.8;
const SHINGLE = 5;
const MIN_NODES = 3;

function wordTokens(text) {
  return String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function shingles(tokens) {
  const out = new Set();
  for (let i = 0; i + SHINGLE <= tokens.length; i++) out.add(tokens.slice(i, i + SHINGLE).join(' '));
  return out;
}

/**
 * Fraction of the evidence's 5-word runs that also occur in the source texts.
 * A paraphrase shares vocabulary but not word runs; a paste shares nearly all.
 */
export function sourceOverlap(evidence, sourceTexts = []) {
  const ev = shingles(wordTokens(evidence));
  if (ev.size === 0) return 0;
  const src = new Set();
  for (const t of sourceTexts) for (const s of shingles(wordTokens(t))) src.add(s);
  if (src.size === 0) return 0;
  let hit = 0;
  for (const s of ev) if (src.has(s)) hit++;
  return hit / ev.size;
}

const URL_RE = /https?:\/\/\S+/gi;

/** The text with fenced blocks removed (diagram source is not prose). */
export function proseOf(text) {
  return String(text ?? '').replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(\n\s*\2[^\n]*|$)/g, '$1').trim();
}

/**
 * The parsed diagrams of a summary envelope. An unreadable envelope or one whose
 * entries are all `parsed: false` yields [], which every consumer treats as no summary.
 */
export function parsedDiagrams(summary) {
  return (summary && Array.isArray(summary.diagrams) ? summary.diagrams : []).filter((d) => d && d.parsed !== false);
}

/** Nodes across the parsed diagrams; null when none was parsed. */
function nodeCount(summary) {
  const ds = parsedDiagrams(summary);
  if (ds.length === 0) return null;
  return ds.reduce((n, d) => n + (Array.isArray(d && d.nodes) ? d.nodes.length : 0), 0);
}

/**
 * Transfer route. evidence is the captured teach-back / diagram source.
 * options: minChars, sourceTexts (curriculum + refs text, for source_paste),
 * summary (parsed diagram envelope, optional), diagramFile (evidence IS a
 * diagram file, so it has no prose). A missing summary never rejects.
 */
export function prefilterTransfer(evidence, options = {}) {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const text = trimmed(evidence);
  if (!text) return { ok: false, reason: 'empty' };
  // A bare link (or a link plus a few words) is a pointer to the source, not a teach-back.
  const hasUrl = (text.match(URL_RE) || []).length > 0;
  if (hasUrl && text.replace(URL_RE, ' ').replace(/[^a-z0-9]/gi, '').length < 40) {
    return { ok: false, reason: 'source_paste' };
  }
  if (!options.diagramFile && text.length < minChars) return { ok: false, reason: 'too_short' };
  const nodes = nodeCount(options.summary);
  const prose = options.diagramFile ? '' : proseOf(text);
  if (nodes !== null && nodes < MIN_NODES && prose.length < minChars) {
    return { ok: false, reason: 'too_few_nodes' };
  }
  if (sourceOverlap(text, options.sourceTexts || []) >= SOURCE_PASTE_THRESHOLD) {
    return { ok: false, reason: 'source_paste' };
  }
  return { ok: true, reason: null };
}
