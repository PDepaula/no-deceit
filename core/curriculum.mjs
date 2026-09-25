// No Deceit — curriculum format rules (PURE, zero dependencies).
//
// A curriculum is two files under <data>/curricula/<topic>/ (format doc:
// docs/curriculum-format.md):
//   open.md    the learner's part: mission, sources, reading sessions, one flat
//              keyword list. Nothing in it shows the shape of the topic.
//   sealed.md  the tutor's and grader's part: concept map, per-concept claim,
//              mechanism, traps, and transfer prompts with their criteria.
//
// This module decides what counts as a ready (Tier 1) curriculum, checks the
// two files against the format, and owns the keyword-list rules: it derives the
// list from the sealed concepts and audits a list for grouping and emphasis.
// It reads no file, clock or env; the shell (core/curriculum-io.mjs, core/scout.mjs)
// supplies text. The line-based parsing is deliberate, so a Babashka port
// needs no YAML library.

import { isSlug, parseFrontmatter as parseFrontmatterLf } from './evidence.mjs';

export const KINDS = ['concept', 'procedure', 'fact'];
export const ACCESS = ['open', 'browser-only', 'paid'];
export const DEFAULT_MIN_CHARS = 300;

/**
 * Parse the arguments of `nd tier` / `/no-deceit:tier`: `<tier> [<topic>]`,
 * `--topic <t>`, `--no-topic`. Pure. `tier` is returned as the
 * raw token (setTier validates it); only the topic can produce `error` here.
 */
export function parseTierArgs(input) {
  const tokens = Array.isArray(input) ? input.filter((t) => t !== '') : String(input ?? '').trim().split(/\s+/).filter(Boolean);
  let tier = null;
  let topic = null;
  let clearTopic = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--topic') topic = tokens[++i] ?? null;
    else if (t === '--no-topic') clearTopic = true;
    else if (t.startsWith('-')) continue;
    else if (tier === null) tier = t;
    else if (topic === null) topic = t;
  }
  let error = null;
  if (topic !== null && clearTopic) error = 'pass either a topic or --no-topic, not both';
  else if (topic !== null && !isSlug(topic)) error = `topic "${topic}" must be a slug (lowercase letters, digits, . _ -)`;
  else if (tier === '3' && (topic !== null || clearTopic)) error = 'a topic applies to Tier 1 or Tier 2, not to a Tier 3 grant';
  return { tier, topic, clearTopic, error };
}

/** The refusal `nd tier 1 --topic <t>` gives, naming both ways to get a curriculum. */
export function tier1Refusal(topic, missing) {
  return (
    `Tier 1 for "${topic}" needs a curriculum, and ${missing.join('; ')}. ` +
    `Two ways to get one: (1) \`nd curriculum build ${topic} --goal "<what you must be able to do>" ` +
    `--mission "<why you are learning it>" --from <path|url> [--from ...]\` has the scout draft both files ` +
    `for you to review; (2) write open.md and sealed.md yourself under the curricula/${topic}/ directory of ` +
    `the data home (format: docs/curriculum-format.md; \`nd doctor\` prints the data home).`
  );
}

// --- text helpers -------------------------------------------------------

function lines(text) { return String(text ?? '').replace(/\r\n/g, '\n').split('\n'); }

function parseFrontmatter(text) { return parseFrontmatterLf(String(text ?? '').replace(/\r\n/g, '\n')); }

function sectionLines(text, heading) {
  const ls = lines(parseFrontmatter(text).body);
  const start = ls.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`).test(l));
  if (start < 0) return null;
  let end = ls.length;
  for (let i = start + 1; i < ls.length; i++) if (/^##\s/.test(ls[i])) { end = i; break; }
  return ls.slice(start + 1, end);
}

/** The raw frontmatter block (between the --- fences), or ''. */
function frontmatterText(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text ?? '').replace(/\r\n/g, '\n'));
  return m ? m[1] : '';
}

/** Set (or add) a top-level scalar key in the frontmatter. Pure. */
export function setFrontmatterScalar(text, key, value) {
  const src = String(text ?? '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---(\n?)([\s\S]*)$/.exec(src);
  if (!m) return `---\n${key}: ${value}\n---\n${src}`;
  const re = new RegExp(`^${key}\\s*:.*$`, 'm');
  const fm = re.test(m[1]) ? m[1].replace(re, `${key}: ${value}`) : `${m[1]}\n${key}: ${value}`;
  return `---\n${fm}\n---${m[2] || '\n'}${m[3]}`;
}

// --- sources (structured; open.md frontmatter) ---------------------------

/**
 * The entries under `sources:` in the frontmatter, each a { key: rawValue } map.
 * Entries start at a `- ` item; `key: value` lines below it belong to it.
 * Comment lines are skipped. Block-style values other than `key: value` are ignored.
 */
export function parseSources(text) {
  const fm = lines(frontmatterText(text));
  const at = fm.findIndex((l) => /^sources\s*:/.test(l));
  if (at < 0) return null;
  const out = [];
  let cur = null;
  for (let i = at + 1; i < fm.length; i++) {
    const l = fm[i];
    if (/^\S/.test(l)) break; // next top-level key
    if (/^\s*#/.test(l) || !l.trim()) continue;
    const item = /^\s+-\s+(.*)$/.exec(l);
    const body = item ? item[1] : l.trim();
    if (item) { cur = {}; out.push(cur); }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(body);
    if (kv && cur) cur[kv[1]] = kv[2].trim();
  }
  return out;
}

// --- keywords ------------------------------------------------------------

/** Escape the characters Markdown would read as emphasis or code. */
export function escapeKeyword(term) {
  return String(term).replace(/[\\*_`~]/g, (c) => `\\${c}`);
}

/** Undo escapeKeyword: the term as written in the sealed part. */
export function unescapeKeyword(text) {
  return String(text).replace(/\\([\\*_`~])/g, '$1');
}

/** Sort key: lowercase, code-unit order (same as `compare` on strings in Clojure). */
function keywordKey(term) { return String(term).toLowerCase(); }

function splitTerms(text) {
  return String(text ?? '').split(';').map((t) => t.trim()).filter(Boolean);
}

/** Split sealed.md into concept blocks: [{ id, title, fields: {name: text} }]. */
export function parseConcepts(sealedText) {
  const ls = lines(parseFrontmatter(sealedText).body);
  const blocks = [];
  let cur = null;
  for (const l of ls) {
    const h = /^#{3,4}\s+(C\d+)\.\s+(.+?)\s*$/.exec(l);
    if (h) { cur = { id: h[1], title: h[2], raw: [] }; blocks.push(cur); continue; }
    if (/^#{1,4}\s/.test(l)) { cur = null; continue; }
    if (cur) cur.raw.push(l);
  }
  return blocks.map((b) => {
    const fields = {};
    let name = null;
    for (const l of b.raw) {
      const f = /^\*\*([^*]+?)\.\*\*\s*(.*)$/.exec(l);
      if (f) { name = f[1].trim().toLowerCase(); fields[name] = f[2]; continue; }
      if (name) fields[name] += `\n${l}`;
    }
    for (const k of Object.keys(fields)) fields[k] = fields[k].trim();
    return { id: b.id, title: b.title, fields };
  });
}

/**
 * The keyword list the sealed map implies: every concept's `Keywords` (semicolon
 * separated) and `Hint keywords` (each `term (why no neutral term exists)`),
 * de-duplicated case-insensitively and sorted. { keywords, hints }.
 */
export function keywordsFromSealed(sealedText) {
  const seen = new Map();
  const hints = [];
  for (const c of parseConcepts(sealedText)) {
    for (const t of splitTerms(c.fields.keywords)) if (!seen.has(keywordKey(t))) seen.set(keywordKey(t), t);
    for (const raw of splitTerms(c.fields['hint keywords'])) {
      const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(raw);
      const term = (m ? m[1] : raw).trim();
      hints.push({ concept: c.id, term, why: m ? m[2].trim() : '' });
      if (term && !seen.has(keywordKey(term))) seen.set(keywordKey(term), term);
    }
  }
  const keywords = [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, t]) => t);
  return { keywords, hints };
}

/** The markdown list body: one `- term` per line, alphabetical, escaped, no grouping. */
export function renderKeywordItems(keywords) {
  return keywords.map((k) => `- ${escapeKeyword(k)}`).join('\n');
}

/** Replace the `## Keywords` section of open.md with the given keywords. */
export function replaceKeywordSection(openText, keywords) {
  const ls = lines(openText);
  const start = ls.findIndex((l) => /^##\s+Keywords\s*$/.test(l));
  const block = ['## Keywords', '', ...renderKeywordItems(keywords).split('\n'), ''];
  if (start < 0) return `${ls.join('\n').replace(/\s+$/, '')}\n\n${block.join('\n')}`;
  let end = ls.length;
  for (let i = start + 1; i < ls.length; i++) if (/^##\s/.test(ls[i])) { end = i; break; }
  return [...ls.slice(0, start), ...block, ...ls.slice(end)].join('\n').replace(/\s+$/, '') + '\n';
}

/**
 * Audit the `## Keywords` list of open.md against the format rules. Returns a
 * list of { code, keyword?, line? } (empty when clean). Codes: no_section,
 * empty, heading, prose, grouped, emphasis, definition, too_long, duplicate,
 * not_alphabetical.
 */
export function checkKeywordList(openText) {
  const sec = sectionLines(openText, 'Keywords');
  if (!sec) return [{ code: 'no_section' }];
  const problems = [];
  const items = [];
  let sawBlankAfterItem = false;
  sec.forEach((l, i) => {
    if (!l.trim()) { if (items.length) sawBlankAfterItem = true; return; }
    if (/^#{1,6}\s/.test(l)) { problems.push({ code: 'heading', line: l.trim() }); return; }
    const m = /^-\s+(.*\S)\s*$/.exec(l);
    if (!m) { problems.push({ code: 'prose', line: l.trim() }); return; }
    if (sawBlankAfterItem) { problems.push({ code: 'grouped', keyword: m[1] }); sawBlankAfterItem = false; }
    items.push({ raw: m[1], at: i });
  });
  if (!items.length) problems.push({ code: 'empty' });
  const keys = new Set();
  let prev = null;
  for (const { raw } of items) {
    const stripped = raw.replace(/\\[\\*_`~]/g, '');
    if (/[*_`~]/.test(stripped)) problems.push({ code: 'emphasis', keyword: raw });
    if (/\s[—–]\s|\s--\s|:\s/.test(raw)) problems.push({ code: 'definition', keyword: raw });
    if (raw.split(/\s+/).length > 6) problems.push({ code: 'too_long', keyword: raw });
    const term = unescapeKeyword(raw);
    const k = keywordKey(term);
    if (keys.has(k)) problems.push({ code: 'duplicate', keyword: raw });
    keys.add(k);
    if (prev !== null && k < prev) problems.push({ code: 'not_alphabetical', keyword: raw });
    prev = k;
  }
  return problems;
}

export function keywordProblemText(p) {
  const what = {
    no_section: 'open.md has no "## Keywords" section',
    empty: 'the keyword list is empty',
    heading: 'the keyword list has a heading (one flat list, no groups)',
    prose: 'the keyword section holds text that is not a list item (no intro, no definitions)',
    grouped: 'a blank line splits the keyword list (one flat list, not grouped)',
    emphasis: 'a keyword carries bold, italic or code formatting',
    definition: 'a keyword carries a definition',
    too_long: 'a keyword is a sentence, not a term',
    duplicate: 'a keyword is listed twice',
    not_alphabetical: 'the keyword list is not alphabetical',
  }[p.code] || p.code;
  const at = p.keyword || p.line;
  return at ? `${what}: ${at}` : what;
}

// --- open / sealed checks -----------------------------------------------

/** Problems with open.md as a whole (advisory; the scout output must pass). */
export function checkOpen(openText) {
  const problems = [];
  const { meta } = parseFrontmatter(openText);
  if (!meta.topic) problems.push('open.md frontmatter has no topic');
  if (!meta.mission) problems.push('open.md frontmatter has no mission');
  for (const h of ['Mission', 'Sources', 'Reading sessions']) {
    if (!sectionLines(openText, h)) problems.push(`open.md has no "## ${h}" section`);
  }
  const sources = parseSources(openText);
  if (!sources || !sources.length) problems.push('open.md frontmatter lists no sources');
  else {
    sources.forEach((s, i) => {
      const id = s.id || s.title || `#${i + 1}`;
      for (const k of ['title', 'sections', 'verified', 'access']) {
        if (!s[k]) problems.push(`source ${id} has no ${k}`);
      }
      if (s.access && !ACCESS.includes(s.access)) problems.push(`source ${id}: access must be one of ${ACCESS.join(', ')}`);
    });
  }
  const sessions = sectionLines(openText, 'Reading sessions') || [];
  const sessionBlocks = sessions.join('\n').split(/^###\s+/m).slice(1);
  if (!sessionBlocks.length) problems.push('open.md has no "### Session" under Reading sessions');
  sessionBlocks.forEach((b, i) => {
    for (const f of ['Read', 'Practice', 'Unlocks']) {
      if (!new RegExp(`^-\\s+${f}:\\s*\\S`, 'm').test(b)) problems.push(`session ${i + 1} has no "- ${f}:" line`);
    }
  });
  for (const p of checkKeywordList(openText)) problems.push(keywordProblemText(p));
  return problems;
}

/** Steps declared in sealed.md frontmatter (`steps:` list), as ids. */
export function parseStepIds(sealedText) {
  const fm = lines(frontmatterText(sealedText));
  const at = fm.findIndex((l) => /^steps\s*:/.test(l));
  if (at < 0) return null;
  const ids = [];
  for (let i = at + 1; i < fm.length; i++) {
    if (/^\S/.test(fm[i])) break;
    const m = /^\s+-\s+id\s*:\s*(.+?)\s*$/.exec(fm[i]);
    if (m) ids.push(m[1].replace(/^["']|["']$/g, ''));
  }
  return ids;
}

/** Problems with sealed.md as a whole. */
export function checkSealed(sealedText) {
  const problems = [];
  const concepts = parseConcepts(sealedText);
  if (!concepts.length) return ['sealed.md has no concept ("### C1. Title" heading)'];
  const steps = parseStepIds(sealedText);
  for (const c of concepts) {
    const f = c.fields;
    const at = `${c.id}`;
    for (const k of ['claim', 'mechanism', 'keywords']) if (!f[k]) problems.push(`${at} has no ${k}`);
    if (!KINDS.includes((f.kind || '').split(/\s/)[0].toLowerCase())) problems.push(`${at}: kind must be one of ${KINDS.join(', ')}`);
    const prompts = (f['transfer prompts'] || '').split('\n');
    const nPrompt = prompts.filter((l) => /^\s*(?:-\s+)?Prompt:\s*\S/.test(l)).length;
    const nCrit = prompts.filter((l) => /^\s*(?:-\s+)?Criteria:\s*\S/.test(l)).length;
    if (!nPrompt) problems.push(`${at} has no transfer prompt ("- Prompt:" then "  Criteria:")`);
    else if (nCrit !== nPrompt) problems.push(`${at}: every transfer prompt needs its Criteria written with it (${nPrompt} prompts, ${nCrit} criteria)`);
    const traps = (f['misconception traps'] || '').split('\n').filter((l) => /^\s*-\s+/.test(l));
    for (const t of traps) if (!/\(from:\s*[^)]+\)\s*$/.test(t)) problems.push(`${at}: a misconception trap has no origin tag "(from: ...)"`);
    const unlocks = (f.unlocks || '').trim();
    if (steps && unlocks && !steps.includes(unlocks.split(/[\s,]/)[0])) problems.push(`${at}: unlocks "${unlocks}" is not a declared step`);
    for (const h of splitTerms(f['hint keywords'])) {
      if (!/\([^()]+\)\s*$/.test(h)) problems.push(`${at}: hint keyword "${h}" needs its reason in parentheses (no neutral term exists)`);
    }
  }
  return problems;
}

/** Both files against the format. { ok, problems }. */
export function checkCurriculum({ open, sealed }) {
  const problems = [
    ...(open == null ? ['open.md is missing'] : checkOpen(open)),
    ...(sealed == null ? ['sealed.md is missing'] : checkSealed(sealed)),
  ];
  return { ok: problems.length === 0, problems };
}

// --- the Tier 1 precondition --------------------------------------------

/**
 * Is a curriculum ready for Tier 1 (R2)? Both files present and non-trivial:
 * at least `minChars` each, open.md names a mission, sealed.md has at least one
 * concept. A cheap structural check, like the Tier 3 preamble check; the full
 * format audit is `nd curriculum check`. `open` / `sealed` are file text or null.
 * Returns { ok, missing: [why...] }.
 */
export function curriculumReady({ open = null, sealed = null, minChars = DEFAULT_MIN_CHARS } = {}) {
  const missing = [];
  if (open == null) missing.push('open.md does not exist');
  else if (String(open).trim().length < minChars) missing.push(`open.md is too short (under ${minChars} characters)`);
  else if (!parseFrontmatter(open).meta.mission) missing.push('open.md has no mission in its frontmatter');
  if (sealed == null) missing.push('sealed.md does not exist');
  else if (String(sealed).trim().length < minChars) missing.push(`sealed.md is too short (under ${minChars} characters)`);
  else if (!parseConcepts(sealed).length) missing.push('sealed.md has no concept ("### C1. Title" heading)');
  return { ok: missing.length === 0, missing };
}

/** `reviewed:` in open.md frontmatter (advisory only, R2). */
export function isReviewed(openText) {
  return /^(yes|true)\b/i.test(parseFrontmatter(openText).meta.reviewed || '');
}

function unquote(v) { return String(v ?? '').replace(/^\[|\]$/g, '').replace(/"/g, ''); }

// --- the captain's spoiler-free review view ------------------------------

/**
 * What a reviewer reads: the mission, the sources, and the reading-session
 * outline. No keywords and nothing from sealed.md, so review does not spoil it.
 */
export function reviewView(openText) {
  const { meta } = parseFrontmatter(openText);
  const out = [`Topic: ${meta.topic || '(none)'}`, `Reviewed: ${isReviewed(openText) ? 'yes' : 'no'}`, '', `Mission: ${meta.mission || '(missing)'}`, '', 'Sources:'];
  for (const s of parseSources(openText) || []) {
    out.push(`  ${s.id ? `${s.id} ` : ''}${unquote(s.title) || '(untitled)'} — ${unquote(s.sections) || 'no sections'} (${s.access || '?'}, verified ${s.verified || '?'})`);
  }
  out.push('', 'Reading sessions:');
  for (const l of sectionLines(openText, 'Reading sessions') || []) if (l.trim()) out.push(`  ${l}`);
  const n = (sectionLines(openText, 'Keywords') || []).filter((l) => /^-\s/.test(l)).length;
  out.push('', `Keywords: ${n} (not shown; they are the learner's to group).`);
  return out.join('\n');
}

// --- the tutor's context -------------------------------------------------

/** The paragraph SessionStart / prompt context carries for an active topic. */
export function curriculumContext({ topic, openPath, sealedPath, tier, ready = true, reviewed = false }) {
  if (!topic) return '';
  const head = `Active topic: ${topic}.`;
  if (!ready) return `${head} It has no ready curriculum (open.md and sealed.md under the data home), so curriculum-bound tutoring is not available for it.`;
  return (
    `${head} Curriculum for this topic: learner part ${openPath}; sealed part ${sealedPath}` +
    `${reviewed ? '' : ' (not yet reviewed by the developer)'}. ` +
    `You may read sealed.md to steer your questions, but never quote, recite, paraphrase or summarise it to the developer, ` +
    `and never present its concept map, mechanisms or traps as your own answer. Keep everything you say unprimed: no grouping, ` +
    `emphasis or ordering of concepts the developer has not yet produced. Do not quote any source the curriculum lists under answer_keys_do_not_quote. ` +
    (tier === 1
      ? `At Tier 1, never reveal a concept before the developer has attempted it: ask, compare their own map or explanation with the sealed one, and question the gaps; when their grouping differs from the sealed map, ask why they grouped it that way instead of marking it wrong.`
      : `The developer is not at Tier 1 for this topic; the sealed part still stays sealed.`)
  );
}
