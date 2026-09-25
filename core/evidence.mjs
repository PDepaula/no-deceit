// No Deceit — evidence capture rules (PURE).
//
// Decides what a piece of learner evidence is (teach-back, Mermaid,
// Excalidraw, mind map), whether it is well-formed, and how it is written to
// disk. No fs/clock/env reads and no hashing: the shell (core/evidence-io.mjs)
// supplies the timestamp and sha256.
//
// Diagrams are captured RAW. This module never parses a diagram into nodes and
// edges: that is the Babashka parser's job (PORTING.md, step 7). Its output is a
// summary file next to the evidence file (`summaryPathFor`); when there is none,
// the grader reads the raw source and reports G1–G5 as `unknown`.

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const EXCALIDRAW_TYPES = ['excalidraw', 'excalidraw/clipboard'];

/** A topic or project name is a path segment, so it must be a plain slug. */
export function isSlug(name) {
  return typeof name === 'string' && SLUG_RE.test(name) && !name.includes('..');
}

/**
 * Parse `<topic> --project <p>` (the text after `/no-deceit:teach`). Pure.
 * Returns { topic, project, error }. `error` is set when the topic is missing
 * or either name is not a slug.
 */
export function parseTeachArgs(arg) {
  const tokens = String(arg ?? '').trim().split(/\s+/).filter(Boolean);
  let topic = null;
  let project = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--project') project = tokens[++i] ?? null;
    else if (t.startsWith('--project=')) project = t.slice('--project='.length) || null;
    else if (!t.startsWith('-') && topic === null) topic = t;
  }
  let error = null;
  if (!topic) error = 'missing topic: /no-deceit:teach <topic> --project <project>, then the explanation on the next lines';
  else if (!isSlug(topic)) error = `topic "${topic}" must be a slug (lowercase letters, digits, . _ -)`;
  else if (project !== null && !isSlug(project)) error = `project "${project}" must be a slug (lowercase letters, digits, . _ -)`;
  return { topic, project, error };
}

export function countWords(text) {
  const m = String(text ?? '').trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** The body as stored: no leading blank lines, no trailing whitespace, one final newline. */
export function normalizeBody(body) {
  return String(body ?? '').replace(/^(\s*\n)+/, '').replace(/\s+$/, '') + '\n';
}

/** Validate Excalidraw JSON text: parses, and `type` is excalidraw or excalidraw/clipboard. */
export function validateExcalidraw(text) {
  let obj;
  try { obj = JSON.parse(String(text)); } catch { return { ok: false, type: null, elements: 0, error: 'not valid JSON' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, type: null, elements: 0, error: 'not a JSON object' };
  const type = typeof obj.type === 'string' ? obj.type : null;
  if (!EXCALIDRAW_TYPES.includes(type)) {
    return { ok: false, type, elements: 0, error: `type is ${JSON.stringify(type)}, expected "excalidraw" or "excalidraw/clipboard"` };
  }
  const elements = Array.isArray(obj.elements) ? obj.elements.length : 0;
  return { ok: true, type, elements, error: null };
}

const RE_OBSIDIAN = /(^|\n)\s*excalidraw-plugin\s*:|(^|\n)#\s*Excalidraw Data\b/;

/** Is this an Obsidian `.excalidraw.md` (drawing embedded in markdown, maybe LZ-compressed)? */
export function isObsidianExcalidraw(text) {
  return RE_OBSIDIAN.test(String(text ?? ''));
}

const RE_MERMAID_FENCE = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(mermaid|mmd)\b/i;
const RE_JSON_FENCE = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(json|excalidraw)[^\n]*\n([\s\S]*?)(\n[ \t]*\2|$)/gi;
const RE_EXCALIDRAW_START = /\{\s*"type"\s*:\s*"excalidraw/;

/** Markdown outline: ≥ 3 list items with nesting, or list items carrying -> / → links. */
export function looksLikeMindmapText(text) {
  const items = String(text ?? '').split(/\r?\n/).filter((l) => /^\s*([-*+]|\d+\.)\s+\S/.test(l));
  if (items.length < 3) return false;
  const nested = items.some((l) => /^(\s{2,}|\t)/.test(l));
  const linked = items.some((l) => /<->|->|→|↔|\[\[[^\]]+\]\]/.test(l));
  return nested || linked;
}

/**
 * Which diagram kinds does a teach-back body contain? Returns
 * { kinds: ['mermaid'|'excalidraw'|'mindmap-text', ...], invalid: [msg] }.
 * A JSON block that looks like Excalidraw but fails validation is reported in
 * `invalid` (capture still succeeds; the shell shows the warning).
 */
export function detectDiagrams(text) {
  const t = String(text ?? '');
  const kinds = [];
  const invalid = [];
  if (RE_MERMAID_FENCE.test(t)) kinds.push('mermaid');

  let excal = false;
  for (const m of t.matchAll(RE_JSON_FENCE)) {
    const body = m[4];
    if (!RE_EXCALIDRAW_START.test(body) && !/"elements"\s*:/.test(body)) continue;
    const v = validateExcalidraw(body);
    if (v.ok) excal = true;
    else invalid.push(`excalidraw JSON block: ${v.error}`);
  }
  if (!excal && !invalid.length) {
    const i = t.search(RE_EXCALIDRAW_START);
    if (i >= 0) {
      const j = t.lastIndexOf('}');
      const v = validateExcalidraw(t.slice(i, j + 1));
      if (v.ok) excal = true;
      else invalid.push(`excalidraw JSON: ${v.error}`);
    }
  }
  if (excal) kinds.push('excalidraw');
  if (isObsidianExcalidraw(t) && !kinds.includes('excalidraw')) kinds.push('excalidraw');
  if (looksLikeMindmapText(t)) kinds.push('mindmap-text');
  return { kinds, invalid };
}

/**
 * Classify a file for `nd evidence add`. Returns { kind, ext, error }.
 * Excalidraw files are validated (a bad `type` is rejected); an Obsidian
 * `.excalidraw.md` is accepted on its markers because its drawing may be
 * LZ-compressed, which only the Babashka parser can decode.
 */
export function evidenceKindForFile(filename, text) {
  const name = String(filename ?? '').toLowerCase();
  if (/\.(mmd|mermaid)$/.test(name)) {
    return String(text ?? '').trim() ? { kind: 'mermaid', ext: name.endsWith('.mermaid') ? 'mermaid' : 'mmd', error: null }
      : { kind: null, ext: null, error: 'the Mermaid file is empty' };
  }
  if (name.endsWith('.excalidraw.md')) {
    return isObsidianExcalidraw(text) ? { kind: 'excalidraw', ext: 'excalidraw.md', error: null }
      : { kind: null, ext: null, error: 'not an Obsidian Excalidraw file (no excalidraw-plugin frontmatter or "# Excalidraw Data" section)' };
  }
  if (/\.(excalidraw(\.json)?|json)$/.test(name)) { // a bare .json is accepted only if it is Excalidraw (clipboard export)
    const v = validateExcalidraw(text);
    return v.ok ? { kind: 'excalidraw', ext: 'excalidraw', error: null } : { kind: null, ext: null, error: `not Excalidraw: ${v.error}` };
  }
  if (/\.(md|markdown|txt)$/.test(name)) {
    if (!String(text ?? '').trim()) return { kind: null, ext: null, error: 'the file is empty' };
    const { kinds } = detectDiagrams(text);
    return { kind: kinds.includes('mindmap-text') && !kinds.includes('mermaid') ? 'mindmap-text' : 'pasted-text', ext: 'md', error: null };
  }
  return { kind: null, ext: null, error: 'unsupported file type (use .md, .txt, .mmd, .mermaid, .excalidraw, .excalidraw.md, or an Excalidraw .json)' };
}

/** `2026-09-24T10-11-32Z`: sortable, filename-safe. */
export function evidenceStamp(nowMs) {
  return new Date(nowMs).toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

/** Evidence file name for a stamp + kind + extension. */
export function evidenceFileName(stamp, kind, ext) {
  return `${stamp}-${kind === 'teach-back' ? 'teach' : kind}.${ext}`;
}

/**
 * The teach-back file: frontmatter (topic, project, kind, sha256 of the body,
 * capture time) followed by the body exactly as typed.
 */
export function renderTeachFile({ topic, project, kind = 'teach-back', body, sha256, capturedAt, diagrams = [] }) {
  const lines = [
    '---',
    `topic: ${topic}`,
    `project: ${project ?? ''}`,
    `kind: ${kind}`,
    `sha256: ${sha256}`,
    `captured: ${capturedAt}`,
  ];
  if (diagrams.length) lines.push(`diagrams: [${diagrams.join(', ')}]`);
  lines.push('---', '');
  return lines.join('\n') + normalizeBody(body);
}

/** Split a teach file into its flat frontmatter and body. Missing frontmatter → {}. */
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(text ?? ''));
  if (!m) return { meta: {}, body: String(text ?? '') };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2] };
}

/**
 * SEAM: where a Babashka parser's summary plugs in. The parser reads an
 * evidence file and writes `<evidence file>.summary.json` beside it (envelope
 * shape in PORTING.md, step 7). `nd grade` passes that path to the grader
 * as `summaryPath` when the file exists, and otherwise omits it.
 */
export function summaryPathFor(evidencePath) {
  return `${evidencePath}.summary.json`;
}
