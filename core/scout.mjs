// No Deceit — `nd curriculum` operations (the imperative shell).
//
// build: spawn the scout (mockable seam), validate what it printed against the
// format, regenerate the keyword list from the sealed map, and write the two files.
// The scout structures knowledge; the tutor teaches from it; the grader grades
// against it. None of the three is the others, and only `nd` spawns the scout.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { appendLedger, dataPaths, loadConfig } from './state.mjs';
import { isSlug } from './evidence.mjs';
import { executeSpawnPlan, pluginRoot } from './grader.mjs';
import { buildScoutJob, classifySource, parseScoutOutput, scoutSpawnPlan } from './scout-job.mjs';
import {
  checkCurriculum, keywordsFromSealed, replaceKeywordSection, reviewView, setFrontmatterScalar, parseConcepts,
} from './curriculum.mjs';
import { readCurriculum } from './curriculum-io.mjs';

/** The scout's mockable seam: a test or dry run points ND_SCOUT_MOCK_FILE at a canned stdout. */
function invokeFromEnv(env) {
  if (env.ND_SCOUT_MOCK_FILE) return async () => readFileSync(env.ND_SCOUT_MOCK_FILE, 'utf8');
  return null;
}

export async function runCurriculumBuild({
  env = process.env,
  topic,
  goal,
  mission,
  from = [],
  projects = [],
  force = false,
  invoke,
  spawnImpl,
  model,
  timeoutMs,
  cwd = process.cwd(),
  nowMs = Date.now(),
  sessionId = null,
} = {}) {
  if (!topic) throw new Error('usage: nd curriculum build <topic> --goal "<...>" --mission "<...>" --from <path|url> [--from ...] [--projects a,b] [--force]');
  if (!isSlug(topic)) throw new Error(`topic "${topic}" must be a slug (lowercase letters, digits, . _ -)`);
  if (!goal || !String(goal).trim()) throw new Error('a curriculum is built backward from what you must be able to do: pass --goal "<the capability you want when done>"');
  if (!mission || !String(mission).trim()) throw new Error('a curriculum needs your mission: pass --mission "<why you are learning this>"');
  if (!from.length) throw new Error('give the scout something to read: --from <path|url> (your notes, a chapter export, a page); it does not search for sources on its own');
  const dp = dataPaths(env);
  if (!force && (existsSync(dp.curriculumOpen(topic)) || existsSync(dp.curriculumSealed(topic)))) {
    throw new Error(`a curriculum for "${topic}" already exists at ${dp.curriculumDir(topic)}; pass --force to rebuild it (review status resets)`);
  }
  const cfg = loadConfig(env);
  const sources = from.map((f) => (classifySource(f).kind === 'url' ? classifySource(f) : { kind: 'path', ref: resolve(cwd, f) }));
  for (const s of sources) if (s.kind === 'path' && !existsSync(s.ref)) throw new Error(`--from path does not exist: ${s.ref}`);

  const root = pluginRoot();
  const job = buildScoutJob({ topic, goal: String(goal).trim(), mission: String(mission).trim(), sources, projects, formatDocPath: join(root, 'docs', 'curriculum-format.md') });
  const scratch = mkdtempSync(join(tmpdir(), 'nd-scout-job-'));
  const jobPath = join(scratch, 'job.json');
  const useModel = model || cfg.curriculumModel;
  let text;
  try {
    writeFileSync(jobPath, JSON.stringify(job));
    const mock = invokeFromEnv(env) || invoke;
    if (mock) text = await mock({ job, jobPath });
    else {
      const plan = scoutSpawnPlan({ pluginRoot: root, model: useModel, jobPath, timeoutMs: timeoutMs || cfg.scoutTimeoutMs });
      try { text = await executeSpawnPlan(plan, { env, spawnImpl }); } catch (e) {
        if (e && e.code === 'TIMEOUT') throw new Error(`the scout timed out after ${plan.timeoutMs} ms (raise scoutTimeoutMs in config.json, or give it less to read)`);
        throw e;
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const parsed = parseScoutOutput(text);
  const reject = (problems) => {
    const file = join(dp.curriculumDir(topic), 'build-rejected.txt');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, String(text));
    throw new Error(`the scout's output was rejected, nothing was written (raw output: ${file}):\n  - ${problems.join('\n  - ')}`);
  };
  if (!parsed.open || !parsed.sealed) reject([`output lacks ${[!parsed.open && 'open.md', !parsed.sealed && 'sealed.md'].filter(Boolean).join(' and ')} (expected <<<ND-FILE ...>>> blocks)`]);

  // The keyword list is derived from the sealed map, never trusted from the scout.
  const { keywords } = keywordsFromSealed(parsed.sealed);
  let open = replaceKeywordSection(parsed.open, keywords);
  open = setFrontmatterScalar(open, 'built', `${new Date(nowMs).toISOString().slice(0, 10)} by nd-scout (${useModel})`);
  open = setFrontmatterScalar(open, 'reviewed', 'no');
  const check = checkCurriculum({ open, sealed: parsed.sealed });
  if (!check.ok) reject(check.problems);

  mkdirSync(dp.curriculumDir(topic), { recursive: true });
  writeFileSync(dp.curriculumOpen(topic), open);
  writeFileSync(dp.curriculumSealed(topic), parsed.sealed);
  const concepts = parseConcepts(parsed.sealed).length;
  appendLedger(env, { event: 'curriculum_built', topic, model: useModel, concepts, keywords: keywords.length, sources: sources.length, sessionId });
  return (
    `Curriculum for ${topic} built: ${concepts} concepts, ${keywords.length} keywords, at ${dp.curriculumDir(topic)}. ` +
    `Review only the mission, sources and outline: \`nd curriculum review ${topic}\`; then \`nd curriculum reviewed ${topic}\`. ` +
    `Do not open sealed.md; it is for the tutor and the grader.`
  );
}

/** `nd curriculum check <topic>`: audit both files against the format. Read-only; prints problems, never sealed content. */
export function checkCurriculumFiles({ env = process.env, topic }) {
  if (!topic || !isSlug(topic)) throw new Error('usage: nd curriculum check <topic>');
  const r = checkCurriculum(readCurriculum(env, topic));
  if (r.ok) return `Curriculum ${topic}: format ok.`;
  return `Curriculum ${topic}: ${r.problems.length} problem(s):\n${r.problems.map((p) => `  - ${p}`).join('\n')}`;
}

/** `nd curriculum review <topic>`: mission, sources, outline. Nothing from sealed.md. */
export function reviewCurriculumFiles({ env = process.env, topic }) {
  if (!topic || !isSlug(topic)) throw new Error('usage: nd curriculum review <topic>');
  const { open } = readCurriculum(env, topic);
  if (open == null) throw new Error(`no curriculum for "${topic}" (${dataPaths(env).curriculumOpen(topic)} is missing)`);
  return reviewView(open);
}

/** `nd curriculum reviewed <topic>`: set `reviewed: yes`. Advisory only; Tier 1 never requires it. */
export function markReviewed({ env = process.env, topic, sessionId = null }) {
  if (!topic || !isSlug(topic)) throw new Error('usage: nd curriculum reviewed <topic>');
  const dp = dataPaths(env);
  const { open } = readCurriculum(env, topic);
  if (open == null) throw new Error(`no curriculum for "${topic}"`);
  writeFileSync(dp.curriculumOpen(topic), setFrontmatterScalar(open, 'reviewed', 'yes'));
  appendLedger(env, { event: 'curriculum_reviewed', topic, sessionId });
  return `Curriculum ${topic} marked reviewed (advisory; Tier 1 never required it).`;
}
