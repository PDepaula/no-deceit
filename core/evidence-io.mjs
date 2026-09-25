// No Deceit — evidence capture (imperative shell).
//
// Evidence is captured only from channels the model cannot forge: the user's
// literal `/no-deceit:teach` prompt (UserPromptSubmit) or a file the developer
// hands to `nd evidence add`. It always lands as a file under the data home
// (`dataPaths().evidenceDir(topic)`) before anything grades it, so the grader
// protocol stays "evidence by path, never inline". Every capture is ledgered as
// `evidence_captured`, but which evidence is newest is read from the data home
// alone, so a cloned or moved data/ still grades. Diagrams are stored raw;
// parsing is not done here.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { dataPaths, appendLedger } from './state.mjs';
import {
  parseTeachArgs, isSlug, countWords, detectDiagrams, evidenceKindForFile, evidenceStamp,
  evidenceSeqPrefix, evidenceFileName, renderTeachFile, normalizeBody, parseFrontmatter,
} from './evidence.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Write a new evidence file into `dir` under the next free same-second sequence for `stamp`. */
function writeNew(dir, stamp, kind, ext, write) {
  mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir);
  for (let seq = 1; seq < 100; seq++) {
    if (existing.some((n) => n.startsWith(evidenceSeqPrefix(stamp, seq)))) continue;
    const file = join(dir, evidenceFileName(stamp, seq, kind, ext));
    try {
      write(file, { flag: 'wx' });
      return file;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('could not pick a free evidence file name');
}

/**
 * `/no-deceit:teach <topic> --project <p>` + body. Writes
 * `<data>/evidence/<topic>/<ts>-<nn>-teach.md` with frontmatter, ledgers
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
  const file = writeNew(dataPaths(env).evidenceDir(topic), evidenceStamp(nowMs), 'teach-back', 'md', (p, o) => writeFileSync(p, text, o));
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
  const dest = writeNew(dir, evidenceStamp(nowMs), kind, ext, (p, o) => writeFileSync(p, text, o));
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

const isEvidenceFile = (n) => !n.endsWith('.meta.json') && !n.endsWith('.summary.json');

/** Newest evidence file for a topic, or null: `<stamp>-<nn>-` names sort in capture order. */
export function latestEvidence(env, topic) {
  const dir = dataPaths(env).evidenceDir(topic);
  let names;
  try { names = readdirSync(dir).filter(isEvidenceFile).sort(); } catch { return null; }
  return names.length ? join(dir, names[names.length - 1]) : null;
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

/**
 * Topic of the most recent captured evidence (so `/no-deceit:grade` needs no
 * argument): newest stamp across topics, file mtime only as the last tiebreak.
 */
export function lastEvidenceTopic(env) {
  let topics;
  try { topics = readdirSync(join(dataPaths(env).dataDir, 'evidence')).filter(isSlug); } catch { return null; }
  let best = null;
  for (const topic of topics) {
    const path = latestEvidence(env, topic);
    if (!path) continue;
    const name = basename(path);
    const key = { topic, stamp: name.slice(0, name.indexOf('Z') + 1), mtime: statSync(path).mtimeMs };
    if (!best || key.stamp > best.stamp || (key.stamp === best.stamp && key.mtime > best.mtime)) best = key;
  }
  return best ? best.topic : null;
}
