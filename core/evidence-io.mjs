// No Deceit — evidence capture (imperative shell).
//
// Evidence is captured only from channels the model cannot forge: the user's
// literal `/no-deceit:teach` prompt (UserPromptSubmit) or a file the developer
// hands to `nd evidence add`. It always lands as a file under the data home
// (`dataPaths().evidenceDir(topic)`) before anything grades it, so the grader
// protocol stays "evidence by path, never inline". Every capture is ledgered as
// `evidence_captured`. Diagrams are stored raw; parsing is not done here.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { dataPaths, appendLedger, readAllLedger } from './state.mjs';
import {
  parseTeachArgs, isSlug, countWords, detectDiagrams, evidenceKindForFile, evidenceStamp,
  evidenceFileName, renderTeachFile, normalizeBody, parseFrontmatter,
} from './evidence.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Write `name` exclusively into `dir`, retrying with -2, -3 … on a same-second collision. */
function writeNew(dir, name, write) {
  mkdirSync(dir, { recursive: true });
  const ext = name.includes('.') ? name.slice(name.indexOf('.')) : '';
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : `${stem}-${n}${ext}`;
    try {
      write(join(dir, candidate), { flag: 'wx' });
      return join(dir, candidate);
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('could not pick a free evidence file name');
}

/**
 * `/no-deceit:teach <topic> --project <p>` + body. Writes
 * `<data>/evidence/<topic>/<ts>-teach.md` with frontmatter, ledgers
 * `evidence_captured`, and returns the message shown to the developer (the hook
 * blocks the prompt, so the tutor never receives the teach-back in conversation).
 */
export function captureTeach({ env, sessionId = null, arg, body, nowMs = Date.now() }) {
  const { topic, project, error } = parseTeachArgs(arg);
  if (error) return `No Deceit: ${error}. Nothing captured.`;
  if (!String(body ?? '').trim()) {
    return 'No Deceit: nothing to capture. Put your explanation on the lines after the command (same prompt). Nothing captured.';
  }
  const stored = normalizeBody(body);
  const hash = sha256(stored);
  const { kinds, invalid } = detectDiagrams(stored);
  const capturedAt = new Date(nowMs).toISOString();
  const text = renderTeachFile({ topic, project, body: stored, sha256: hash, capturedAt, diagrams: kinds });
  const file = writeNew(dataPaths(env).evidenceDir(topic), evidenceFileName(evidenceStamp(nowMs), 'teach-back', 'md'), (p, o) => writeFileSync(p, text, o));
  const words = countWords(stored);
  appendLedger(env, {
    event: 'evidence_captured', topic, project, kind: 'teach-back', path: file, sha256: hash, words,
    ...(kinds.length ? { diagrams: kinds } : {}), sessionId,
  });
  const warn = invalid.length ? ` Warning: ${invalid.join('; ')} (stored raw; the grader will read it as text).` : '';
  return `Captured ${words} words for ${topic}${project ? ` (project ${project})` : ''}` +
    `${kinds.length ? `, with ${kinds.join(' + ')}` : ''}. \`/no-deceit:grade\` when ready, or keep going.${warn}`;
}

/**
 * `nd evidence add <topic> <path> [--project p]`: copy a developer-written file
 * under the evidence dir, hash it, write a `.meta.json` sidecar, ledger it.
 * Throws with a usable message on a bad topic, missing file, or invalid diagram.
 */
export function addEvidenceFile({ env, sessionId = null, topic, filePath, project = null, nowMs = Date.now() }) {
  if (!isSlug(topic)) throw new Error(`topic "${topic}" must be a slug (lowercase letters, digits, . _ -)`);
  if (project !== null && !isSlug(project)) throw new Error(`project "${project}" must be a slug (lowercase letters, digits, . _ -)`);
  if (!filePath) throw new Error('usage: nd evidence add <topic> <path> [--project <p>]');
  let text;
  try { text = readFileSync(filePath, 'utf8'); } catch { throw new Error(`cannot read ${filePath}`); }
  const { kind, ext, error } = evidenceKindForFile(basename(filePath), text);
  if (error) throw new Error(`${basename(filePath)}: ${error}`);
  const hash = sha256(text);
  const dir = dataPaths(env).evidenceDir(topic);
  const dest = writeNew(dir, evidenceFileName(evidenceStamp(nowMs), kind, ext), (p, o) => writeFileSync(p, text, o));
  const words = countWords(text);
  const { kinds } = detectDiagrams(text);
  writeFileSync(`${dest}.meta.json`, JSON.stringify({
    topic, project, kind, sha256: hash, source: basename(filePath), captured: new Date(nowMs).toISOString(),
  }, null, 2) + '\n');
  appendLedger(env, {
    event: 'evidence_captured', topic, project, kind, path: dest, sha256: hash, words,
    ...(kinds.length ? { diagrams: kinds } : {}), sessionId,
  });
  return { path: dest, kind, sha256: hash, words };
}

/**
 * Newest evidence file for a topic, or null. Capture order comes from the
 * append-only ledger, not file names: same-second captures share a stamp.
 */
export function latestEvidence(env, topic) {
  const dir = dataPaths(env).evidenceDir(topic);
  const rows = readAllLedger(env).filter((e) =>
    e.event === 'evidence_captured' && e.topic === topic && e.path && dirname(e.path) === dir && existsSync(e.path));
  return rows.length ? rows[rows.length - 1].path : null;
}

/** Project a piece of evidence claims: teach frontmatter, or the .meta.json sidecar. */
export function evidenceProject(evidencePath) {
  try {
    const meta = JSON.parse(readFileSync(`${evidencePath}.meta.json`, 'utf8'));
    if (meta && meta.project) return meta.project;
  } catch { /* not a copied file */ }
  if (extname(evidencePath) === '.md') {
    try { return parseFrontmatter(readFileSync(evidencePath, 'utf8')).meta.project || null; } catch { /* unreadable */ }
  }
  return null;
}

/** Topic of the most recent captured evidence (so `/no-deceit:grade` needs no argument). */
export function lastEvidenceTopic(env) {
  const rows = readAllLedger(env).filter((e) => e.event === 'evidence_captured' && e.topic);
  return rows.length ? rows[rows.length - 1].topic : null;
}
