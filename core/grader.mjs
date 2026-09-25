// No Deceit — blind unlock / checking-question grader (imperative shell).
//
// Spawned only from the hook or `nd` CLI, never by the tutor agent. Evidence
// travels by file path. The LLM is optional and mockable; a pre-filter reject,
// timeout, or spawn failure is `not_yet` (honesty valve still available).

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prefilterMentalModel, prefilterCommitHistory, prefilterTransfer, parsedDiagrams, DEFAULT_MIN_CHARS } from './prefilter.mjs';
import {
  MENTAL_RUBRIC, COMMIT_RUBRIC, TRANSFER_RUBRIC, PREFILTER_NEXT_QUESTION, TRANSFER_PREFILTER_NEXT_QUESTION,
  finalizeUnlockVerdict, finalizeTransferVerdict,
} from './rubric.mjs';
import { parseFrontmatter, summaryPathFor, evidenceStamp, isSlug, manifestProjectPath } from './evidence.mjs';
import { latestEvidence, evidenceProject, lastEvidenceTopic } from './evidence-io.mjs';
import { parseGraderOutput } from './grader-parse.mjs';
import { buildGraderJob, assertJobBlind, graderSpawnPlan, defaultGraderModel, isGraderAuthFailure } from './grader-job.mjs';
import { collectGitEvidence, commitsToEvidenceText } from './git-evidence.mjs';
import { scoreRun, aggregateRuns, formatAuditReport } from './audit.mjs';
import {
  loadConfig, projectPaths, readProjectState, writeProjectState, appendLedger, dataPaths, isGoverned,
} from './state.mjs';

export function pluginRoot(fromUrl = import.meta.url) {
  return join(dirname(fileURLToPath(fromUrl)), '..');
}

export function withTimeout(promise, ms, label = 'grader timeout') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(Object.assign(new Error(label), { code: 'TIMEOUT' }));
    }, ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function emptyUnlockCriteria(route) {
  return finalizeUnlockVerdict({ route, rawCriteria: {} }).criteria;
}

function notYet(source, extra = {}) {
  return {
    verdict: 'not_yet',
    source,
    calledLlm: source !== 'prefilter',
    criteria: extra.criteria || emptyUnlockCriteria(extra.route || 'mental-model'),
    error_class: extra.error_class || 'conceptual',
    misconceptions: extra.misconceptions || [],
    next_smaller_question: extra.next_smaller_question || PREFILTER_NEXT_QUESTION.too_short,
    rubric_gap: extra.rubric_gap || [],
    parse_error: Boolean(extra.parse_error),
    prefilter_reason: extra.prefilter_reason || null,
  };
}

export function executeSpawnPlan(plan, { env = process.env, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    // Blind child: run in an empty scratch dir so no project files or
    // CLAUDE.md are discoverable from its cwd.
    const scratch = plan.scratchCwd ? mkdtempSync(join(tmpdir(), 'nd-grader-')) : null;
    const cleanup = () => { if (scratch) rmSync(scratch, { recursive: true, force: true }); };
    let child;
    try {
      child = spawnImpl(plan.command, plan.args, {
        env: { ...env, ...plan.envExtra },
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(scratch ? { cwd: scratch } : {}),
      });
    } catch (e) {
      cleanup();
      reject(Object.assign(e, { code: 'GRADER_FAILURE' }));
      return;
    }
    let out = '';
    let err = '';
    if (child.stdout) child.stdout.on('data', (d) => { out += d; });
    if (child.stderr) child.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      cleanup();
      reject(Object.assign(new Error('grader timeout'), { code: 'TIMEOUT' }));
    }, plan.timeoutMs || 120_000);
    child.on('error', (e) => { clearTimeout(t); cleanup(); reject(Object.assign(e, { code: 'GRADER_FAILURE' })); });
    child.on('close', (code) => {
      clearTimeout(t);
      cleanup();
      if (isGraderAuthFailure(out) || isGraderAuthFailure(err)) {
        reject(Object.assign(
          new Error('grader cannot authenticate (Not logged in): run `claude /login` or set ANTHROPIC_API_KEY'),
          { code: 'GRADER_AUTH' },
        ));
        return;
      }
      if (code !== 0 && !String(out).trim()) {
        reject(Object.assign(new Error(err.trim() || `grader exit ${code}`), { code: 'GRADER_FAILURE' }));
        return;
      }
      resolve(out);
    });
  });
}

/**
 * `nd doctor --grader-probe`: run a minimal grader child (same isolation flags, trivial
 * prompt) and report whether it can authenticate. Never grades anything.
 */
export async function probeGraderAuth({ env = process.env, spawnImpl, model, timeoutMs = 20_000 } = {}) {
  const plan = graderSpawnPlan({
    pluginRoot: pluginRoot(),
    model: model || defaultGraderModel(),
    jobPath: '(probe)',
    timeoutMs,
    probe: true,
  });
  try {
    const out = String(await executeSpawnPlan(plan, { env, spawnImpl })).trim();
    if (/^ok\b/i.test(out)) {
      return { ok: true, message: 'grader can authenticate (minimal child answered)' };
    }
    return { ok: false, code: 'GRADER_FAILURE', message: `grader probe failed: the child answered "${out.split('\n')[0]}" instead of ok` };
  } catch (e) {
    if (e && e.code === 'GRADER_AUTH') {
      return { ok: false, code: 'GRADER_AUTH', message: 'grader cannot authenticate: the child printed "Not logged in". Run `claude /login` (or set ANTHROPIC_API_KEY); until then every unlock rounds down.' };
    }
    return { ok: false, code: (e && e.code) || 'GRADER_FAILURE', message: `grader probe failed: ${(e && e.message) || e}` };
  }
}

export function liveInvoke({ env, pluginRoot: root, model, timeoutMs, jobPath }) {
  const plan = graderSpawnPlan({
    pluginRoot: root || pluginRoot(),
    model: model || defaultGraderModel(),
    jobPath,
    timeoutMs,
  });
  return executeSpawnPlan(plan, { env });
}

export function makeLiveInvoke(env, { spawnImpl } = {}) {
  return async ({ job, plan }) => {
    assertJobBlind(job);
    mkdirSync(dirname(plan.jobPath), { recursive: true });
    writeFileSync(plan.jobPath, JSON.stringify(job));
    return executeSpawnPlan(plan, { env, spawnImpl });
  };
}

export function invokeFromEnv(env = process.env, fallback) {
  if (typeof fallback === 'function') return fallback;
  if (env.ND_GRADER_MOCK_JSON) {
    return async () => JSON.parse(env.ND_GRADER_MOCK_JSON);
  }
  if (env.ND_GRADER_MOCK_FILE) {
    return async () => JSON.parse(readFileSync(env.ND_GRADER_MOCK_FILE, 'utf8'));
  }
  return null; // caller uses liveInvoke
}

/**
 * Grade one unlock attempt. `invoke(ctx)` is the mockable LLM seam.
 * ctx = { job, plan, item? }. Dialogue fields on the call are dropped.
 */
export async function gradeUnlockAttempt({
  route = 'mental-model',
  evidenceText = '',
  commits = null,
  errorText = null,
  minChars = DEFAULT_MIN_CHARS,
  invoke,
  timeoutMs = 120_000,
  pluginRoot: root,
  model,
  evidencePath = '/evidence',
  outputPath = '/verdict.json',
  item = null,
} = {}) {
  const pre = route === 'commit-history'
    ? prefilterCommitHistory(commits || [])
    : prefilterMentalModel(evidenceText, { minChars, errorText });
  if (!pre.ok) {
    return notYet('prefilter', {
      route,
      prefilter_reason: pre.reason,
      next_smaller_question: PREFILTER_NEXT_QUESTION[pre.reason] || PREFILTER_NEXT_QUESTION.too_short,
    });
  }

  const job = buildGraderJob({
    kind: 'unlock',
    route,
    evidencePath,
    outputPath,
    rubric: route === 'commit-history' ? COMMIT_RUBRIC : MENTAL_RUBRIC,
  });
  assertJobBlind(job);
  const plan = graderSpawnPlan({
    pluginRoot: root || pluginRoot(),
    model: model || defaultGraderModel(),
    jobPath: outputPath.replace(/\.json$/, '.job.json'),
    timeoutMs,
  });

  if (typeof invoke !== 'function') {
    return notYet('grader_failure', { route, next_smaller_question: PREFILTER_NEXT_QUESTION.too_short });
  }

  try {
    const raw = await withTimeout(invoke({ job, plan, item }), timeoutMs);
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const parsed = parseGraderOutput(text, { route, kind: 'unlock' });
    return { ...parsed, source: 'grader', calledLlm: true, prefilter_reason: null };
  } catch (err) {
    const source = err && err.code === 'TIMEOUT' ? 'timeout' : 'grader_failure';
    return notYet(source, {
      route,
      next_smaller_question: PREFILTER_NEXT_QUESTION.too_short,
    });
  }
}

export async function gradeCheckAttempt({
  invoke,
  timeoutMs = 120_000,
  rubric = {},
  answerPath = '/answer.md',
  rubricPath = '/rubric.json',
  outputPath = '/check.json',
  item = null,
  pluginRoot: root,
  model,
} = {}) {
  const job = buildGraderJob({
    kind: 'check',
    route: 'check',
    evidencePath: answerPath,
    answerPath,
    rubricPath,
    outputPath,
    rubric,
  });
  assertJobBlind(job);
  if (typeof invoke !== 'function') {
    return { verdict: 'not_landed', source: 'grader_failure', error_class: 'conceptual', misconceptions: [], criteria: {} };
  }
  try {
    const raw = await withTimeout(invoke({ job, plan: graderSpawnPlan({
      pluginRoot: root || pluginRoot(),
      model: model || defaultGraderModel(),
      jobPath: outputPath.replace(/\.json$/, '.job.json'),
      timeoutMs,
    }), item }), timeoutMs);
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const parsed = parseGraderOutput(text, { kind: 'check', checkIds: Object.keys(rubric || {}) });
    return { ...parsed, source: 'grader', calledLlm: true };
  } catch (err) {
    const source = err && err.code === 'TIMEOUT' ? 'timeout' : 'grader_failure';
    return { verdict: 'not_landed', source, error_class: 'conceptual', misconceptions: [], criteria: {}, calledLlm: true };
  }
}

function writeJson(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

function tutorNoteFor(result) {
  if (result.verdict !== 'not_yet') return null;
  return (
    'The blind grader returned not_yet. Deliver its next_smaller_question in the ' +
    'skill\'s kind tone: acknowledge the effort already spent, then ask the smaller ' +
    'question. Do not unlock. Do not argue the verdict. ' +
    `Question: ${result.next_smaller_question || PREFILTER_NEXT_QUESTION.too_short}`
  );
}

function persistUnlock({ repoRoot, env, task, route, files = [], since = null, result, appealed = false, sessionId = null }) {
  const before = readProjectState(repoRoot, env);
  const lastUnlock = {
    id: randomUUID(),
    task,
    route,
    files,
    since,
    verdict: result.verdict,
    appealed,
    source: result.source,
  };
  const lastDiagnosis = {
    error_class: result.error_class,
    misconceptions: result.misconceptions || [],
    next_smaller_question: result.next_smaller_question,
  };
  const unlocked = result.verdict === 'unlocked' ? true : before.unlocked;
  writeProjectState(repoRoot, {
    ...before,
    unlocked,
    lastUnlock,
    lastDiagnosis,
    pendingTutorNote: tutorNoteFor(result),
  });
  const paths = projectPaths(repoRoot);
  writeJson(join(paths.verdictsDir, `${task}.json`), { ...result, task, route, id: lastUnlock.id });
  appendLedger(env, {
    event: appealed ? 'unlock_appeal' : 'unlock_grade',
    task,
    route,
    verdict: result.verdict,
    source: result.source,
    error_class: result.error_class,
    misconceptions: result.misconceptions,
    next_smaller_question: result.next_smaller_question,
    rubric_gap: result.rubric_gap,
    prefilter_reason: result.prefilter_reason,
    id: lastUnlock.id,
    sessionId: sessionId || null,
  });
  return lastUnlock;
}

export function unlockOverride({ repoRoot, env, reason, sessionId = null }) {
  if (!reason || !String(reason).trim()) {
    throw new Error('unlock override requires a typed reason (this is written to the ledger; honesty, not prohibition)');
  }
  const before = readProjectState(repoRoot, env);
  const lastUnlock = {
    id: randomUUID(),
    task: 'override',
    route: 'override',
    verdict: 'unlocked',
    appealed: true,
    source: 'override',
  };
  writeProjectState(repoRoot, {
    ...before,
    unlocked: true,
    lastUnlock,
    pendingTutorNote: null,
  });
  appendLedger(env, { event: 'unlock_override', tier: before.tier, reason: String(reason).trim(), id: lastUnlock.id, sessionId: sessionId || null });
  return `Tier 2 unlocked by override. Recorded to the ledger: "${String(reason).trim()}".`;
}

function loadMentalEvidence(repoRoot, task) {
  const file = join(projectPaths(repoRoot).attemptsDir, `${task}.md`);
  const errorFile = join(projectPaths(repoRoot).attemptsDir, `${task}.error.txt`);
  let evidenceText = '';
  let errorText = null;
  try { evidenceText = readFileSync(file, 'utf8'); } catch { evidenceText = ''; }
  try { errorText = readFileSync(errorFile, 'utf8'); } catch { errorText = null; }
  return { evidenceText, errorText, evidencePath: file };
}

function loadGitEvidence(repoRoot, { files, since, task }) {
  const commits = collectGitEvidence({ cwd: repoRoot, files, since });
  const text = commitsToEvidenceText(commits);
  const evidencePath = join(projectPaths(repoRoot).attemptsDir, `${task}.git.patch`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, text);
  return { commits, evidenceText: text, evidencePath };
}

async function gradeFromDisk({ repoRoot, env, task, git, files, since, invoke, timeoutMs, model }) {
  const cfg = loadConfig(env);
  const route = git ? 'commit-history' : 'mental-model';
  const loaded = git
    ? loadGitEvidence(repoRoot, { files, since, task })
    : loadMentalEvidence(repoRoot, task);
  const outputPath = join(projectPaths(repoRoot).verdictsDir, `${task}.json`);
  return gradeUnlockAttempt({
    route,
    evidenceText: loaded.evidenceText,
    commits: loaded.commits,
    errorText: loaded.errorText,
    minChars: cfg.attemptMinChars,
    invoke,
    timeoutMs: timeoutMs || cfg.graderTimeoutMs,
    model: model || cfg.graderModel,
    evidencePath: loaded.evidencePath,
    outputPath,
    pluginRoot: pluginRoot(),
  });
}

export async function runUnlock({
  repoRoot,
  env = process.env,
  task = 'default',
  git = false,
  files = [],
  since = null,
  override = null,
  appeal = false,
  invoke,
  timeoutMs,
  model,
  spawnImpl,
  sessionId = null,
} = {}) {
  if (override != null) {
    return unlockOverride({ repoRoot, env, reason: override, sessionId });
  }

  const resolved = invokeFromEnv(env, invoke) || makeLiveInvoke(env, { spawnImpl });

  if (appeal) {
    const before = readProjectState(repoRoot, env);
    if (!before.lastUnlock || !before.lastUnlock.id) {
      throw new Error('no verdict to appeal');
    }
    if (before.lastUnlock.appealed) {
      throw new Error('one appeal per verdict (the honesty valve is still `nd unlock --override "<reason>"`)');
    }
    const storedRoute = before.lastUnlock.route;
    const appealGit = storedRoute ? storedRoute === 'commit-history' : git;
    const appealFiles = before.lastUnlock.files ?? files;
    const appealSince = before.lastUnlock.since ?? since;
    const appealTask = before.lastUnlock.task || task;
    const result = await gradeFromDisk({
      repoRoot, env, task: appealTask, git: appealGit, files: appealFiles, since: appealSince,
      invoke: resolved, timeoutMs, model,
    });
    persistUnlock({ repoRoot, env, task: appealTask, route: result.route || before.lastUnlock.route, files: appealFiles, since: appealSince, result, appealed: true, sessionId });
    if (result.verdict === 'unlocked') {
      return `Appeal accepted. Tier 2 unlocked. Diagnosis: ${result.error_class}.`;
    }
    return (
      `Appeal recorded; still not_yet. Next question: ${result.next_smaller_question}. ` +
      `You can still \`nd unlock --override "<reason>"\` or escalate to Tier 3.`
    );
  }

  const result = await gradeFromDisk({
    repoRoot, env, task, git, files, since, invoke: resolved, timeoutMs, model,
  });
  persistUnlock({ repoRoot, env, task, route: git ? 'commit-history' : 'mental-model', files, since, result, appealed: false, sessionId });
  if (result.verdict === 'unlocked') {
    return `Tier 2 unlocked by the blind grader (${result.source}). error_class=${result.error_class}.`;
  }
  return (
    `not_yet (${result.source}${result.prefilter_reason ? `: ${result.prefilter_reason}` : ''}). ` +
    `Next question: ${result.next_smaller_question} ` +
    `Honesty valve: \`nd unlock --override "<reason>"\` or \`nd unlock --appeal\` (once), or \`nd tier 3\`.`
  );
}

export async function runCheck({
  repoRoot,
  env = process.env,
  task = 'default',
  project = null,
  invoke,
  timeoutMs,
  model,
  spawnImpl,
  sessionId = null,
} = {}) {
  const paths = projectPaths(repoRoot);
  const dir = join(paths.checksDir, task);
  const rubricPath = join(dir, 'rubric.json');
  const answerPath = join(dir, 'answer.md');
  if (!existsSync(rubricPath)) throw new Error(`missing checking-question rubric at ${rubricPath}`);
  if (!existsSync(answerPath)) throw new Error(`missing checking-question answer at ${answerPath}`);
  const rubricStat = statSync(rubricPath);
  const answerStat = statSync(answerPath);
  if (answerStat.mtimeMs < rubricStat.mtimeMs) {
    throw new Error('checking-question rubric must be written before the answer is seen');
  }
  const rubric = JSON.parse(readFileSync(rubricPath, 'utf8'));
  const cfg = loadConfig(env);
  const resolved = invokeFromEnv(env, invoke) || makeLiveInvoke(env, { spawnImpl });
  const outputPath = join(paths.verdictsDir, `check-${task}.json`);
  const result = await gradeCheckAttempt({
    invoke: resolved,
    timeoutMs: timeoutMs || cfg.graderTimeoutMs,
    model: model || cfg.graderModel,
    rubric: rubric.criteria || rubric,
    answerPath,
    rubricPath,
    outputPath,
  });
  writeJson(outputPath, { ...result, task, kind: 'check' });
  appendLedger(env, {
    event: 'check_grade',
    task,
    ...(project ? { project } : {}),
    verdict: result.verdict,
    error_class: result.error_class,
    misconceptions: result.misconceptions,
    source: result.source,
    sessionId: sessionId || null,
  });
  const before = readProjectState(repoRoot, env);
  writeProjectState(repoRoot, {
    ...before,
    lastDiagnosis: {
      error_class: result.error_class,
      misconceptions: result.misconceptions || [],
      check: result.verdict,
    },
  });
  return `Checking question: ${result.verdict} (error_class=${result.error_class}).`;
}

export function makeLiveGoldInvoke(env, timeoutMs) {
  return async ({ job, plan, item }) => {
    const dir = mkdtempSync(join(tmpdir(), 'nd-audit-item-'));
    try {
      const evidencePath = join(dir, 'evidence.md');
      if (item && item.route === 'transfer') {
        const files = writeTransferFixtures(dir, item);
        const outputPath = join(dir, 'out.json');
        const jobPath = join(dir, 'job.json');
        const blind = buildGraderJob({ kind: 'transfer', ...files, outputPath, rubric: job.rubric });
        assertJobBlind(blind);
        writeFileSync(jobPath, JSON.stringify(blind));
        const cfg = loadConfig(env);
        return await liveInvoke({
          env, pluginRoot: pluginRoot(), model: cfg.graderModel,
          timeoutMs: timeoutMs || plan.timeoutMs || cfg.graderTimeoutMs, jobPath,
        });
      }
      const text = item && item.route === 'commit-history'
        ? commitsToEvidenceText(item.commits || [])
        : (item && item.evidence) || '';
      writeFileSync(evidencePath, text);
      const outputPath = join(dir, 'out.json');
      const jobPath = join(dir, 'job.json');
      const blind = buildGraderJob({
        kind: job.kind,
        route: job.route,
        evidencePath,
        outputPath,
        answerPath: job.kind === 'check' ? evidencePath : undefined,
        rubric: job.rubric,
      });
      assertJobBlind(blind);
      writeFileSync(jobPath, JSON.stringify(blind));
      const cfg = loadConfig(env);
      return await liveInvoke({
        env,
        pluginRoot: pluginRoot(),
        model: cfg.graderModel,
        timeoutMs: timeoutMs || plan.timeoutMs || cfg.graderTimeoutMs,
        jobPath,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

export async function runAudit({
  items,
  runs = 3,
  invoke,
  timeoutMs = 120_000,
  env = process.env,
} = {}) {
  const resolved = invokeFromEnv(env, invoke) || makeLiveGoldInvoke(env, timeoutMs);
  const runScores = [];
  for (let i = 0; i < runs; i++) {
    const observed = {};
    for (const item of items) {
      if (item.route === 'check') {
        observed[item.id] = await gradeCheckAttempt({
          invoke: (ctx) => resolved({ ...ctx, item }),
          timeoutMs,
          rubric: item.gold_criteria,
          item,
        });
      } else if (item.route === 'transfer') {
        observed[item.id] = await gradeTransferAttempt({
          evidenceText: item.evidence || '',
          sourceTexts: item.curriculum ? [item.curriculum] : [],
          summary: item.summary || null,
          diagramFile: Boolean(item.diagram_file),
          invoke: (ctx) => resolved({ ...ctx, item }),
          timeoutMs,
          item,
        });
      } else {
        observed[item.id] = await gradeUnlockAttempt({
          route: item.route,
          evidenceText: item.evidence || '',
          commits: item.commits,
          errorText: item.errorText,
          invoke: (ctx) => resolved({ ...ctx, item }),
          timeoutMs,
          item,
        });
      }
    }
    runScores.push(scoreRun(items, observed));
  }
  const agg = aggregateRuns(runScores);
  return { ...agg, runScores, report: formatAuditReport(agg, runScores) };
}

// --- Transfer grader (redesign report §2.2–2.3) --------------------------------

/** Write a gold item's evidence/manifest/curriculum/summary as files; return the job's path keys. */
function writeTransferFixtures(dir, item) {
  const evidencePath = join(dir, 'evidence.md');
  writeFileSync(evidencePath, item.evidence || '');
  const projectsPath = join(dir, 'projects.md');
  writeFileSync(projectsPath, item.projects || '');
  const out = { evidencePath, projectsPath };
  if (item.curriculum) {
    out.curriculumPath = join(dir, 'curriculum.md');
    writeFileSync(out.curriculumPath, item.curriculum);
  }
  if (parsedDiagrams(item.summary).length) {
    out.summaryPath = summaryPathFor(evidencePath);
    writeFileSync(out.summaryPath, JSON.stringify(item.summary));
  }
  return out;
}

function notYetTransfer(source, extra = {}) {
  const { criteria, structure } = finalizeTransferVerdict({ hasSummary: false });
  return {
    verdict: 'not_yet',
    source,
    calledLlm: source !== 'prefilter',
    criteria,
    structure,
    error_class: 'conceptual',
    misconceptions: [],
    next_smaller_question: extra.next_smaller_question || TRANSFER_PREFILTER_NEXT_QUESTION.too_short,
    rubric_gap: [],
    parse_error: false,
    prefilter_reason: extra.prefilter_reason || null,
  };
}

/**
 * Grade one principle-transfer teach-back. `invoke(ctx)` is the mockable LLM
 * seam. `summary` (read from `summaryPath`) is the optional parsed-diagram seam:
 * when it has no parsed diagram the job omits `summaryPath`, the grader reads the
 * raw source, and G1–G5 come back `unknown`.
 */
export async function gradeTransferAttempt({
  evidenceText = '',
  sourceTexts = [],
  summary = null,
  diagramFile = false,
  minChars = DEFAULT_MIN_CHARS,
  invoke,
  timeoutMs = 120_000,
  pluginRoot: root,
  model,
  evidencePath = '/evidence',
  curriculumPath = null,
  projectsPath = '/projects',
  summaryPath = null,
  outputPath = '/verdict.json',
  item = null,
} = {}) {
  const pre = prefilterTransfer(evidenceText, { minChars, sourceTexts, summary, diagramFile });
  if (!pre.ok) {
    return notYetTransfer('prefilter', {
      prefilter_reason: pre.reason,
      next_smaller_question: TRANSFER_PREFILTER_NEXT_QUESTION[pre.reason],
    });
  }
  const hasSummary = parsedDiagrams(summary).length > 0;
  const job = buildGraderJob({
    kind: 'transfer', evidencePath, curriculumPath, projectsPath,
    summaryPath: hasSummary ? (summaryPath || summaryPathFor(evidencePath)) : null,
    outputPath, rubric: TRANSFER_RUBRIC,
  });
  assertJobBlind(job);
  if (typeof invoke !== 'function') return notYetTransfer('grader_failure');
  const plan = graderSpawnPlan({
    pluginRoot: root || pluginRoot(),
    model: model || defaultGraderModel(),
    jobPath: outputPath.replace(/\.json$/, '.job.json'),
    timeoutMs,
  });
  try {
    const raw = await withTimeout(invoke({ job, plan, item }), timeoutMs);
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const parsed = parseGraderOutput(text, { kind: 'transfer', hasSummary });
    return { ...parsed, source: 'grader', calledLlm: true, prefilter_reason: null };
  } catch (err) {
    return notYetTransfer(err && err.code === 'TIMEOUT' ? 'timeout' : 'grader_failure');
  }
}

function readTextIfExists(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

/** curriculum.md plus any refs/<topic>/ text: what a source_paste is measured against. */
function sourceTextsFor(env, topic) {
  const dp = dataPaths(env);
  const texts = [];
  const cur = readTextIfExists(dp.curriculumFile(topic));
  if (cur) texts.push(cur);
  try {
    for (const n of readdirSync(dp.refsDir(topic))) {
      if (/\.(md|txt|markdown)$/i.test(n)) {
        const t = readTextIfExists(join(dp.refsDir(topic), n));
        if (t) texts.push(t);
      }
    }
  } catch { /* no refs dir */ }
  return texts;
}

function transferTutorNote(result, topic) {
  if (result.verdict === 'unlocked') {
    const m = (result.misconceptions || []).filter(Boolean);
    return (
      `The blind grader passed the transfer teach-back for ${topic}. Its wrongness is not the verdict: ` +
      (m.length ? `coach these misconceptions kindly, in the developer's framing: ${m.join('; ')}.` : 'no misconceptions were flagged.')
    );
  }
  return (
    'The blind grader returned not_yet on the transfer teach-back. Deliver its next_smaller_question in the ' +
    'skill\'s kind tone; do not argue the verdict. ' +
    `Question: ${result.next_smaller_question || TRANSFER_PREFILTER_NEXT_QUESTION.too_short}`
  );
}

/** The governed repo a passing grade unlocks: the evidence's project, resolved through the manifest. */
function unlockTarget(projectsPath, project) {
  if (!project) return { why: 'the evidence names no project (capture it with --project <p>)' };
  const path = manifestProjectPath(readFileSync(projectsPath, 'utf8'), projectsPath, project);
  if (!path) return { why: `${projectsPath} gives no path for project "${project}"` };
  const repo = resolve(dirname(projectsPath), path);
  if (!isGoverned(repo)) return { why: `${repo} (project "${project}") is not a governed repo` };
  return { repo };
}

/**
 * `nd grade` / `/no-deceit:grade`: grade the newest evidence for a topic. Reads
 * only files (evidence, projects manifest, curriculum, optional summary), writes
 * `<data>/verdicts/<topic>/<ts>.json`, ledgers `transfer_grade`, and leaves the
 * tutor a note when the current project is governed. A pass unlocks Tier 2 for
 * the project the evidence names, resolved to its repo through the manifest.
 * Enforcement stays project-level: `unlockedTopics` is the per-topic record
 * until topics become session state (redesign phase 3).
 */
export async function runGrade({
  repoRoot,
  env = process.env,
  topic = null,
  invoke,
  timeoutMs,
  model,
  spawnImpl,
  sessionId = null,
  nowMs = Date.now(),
} = {}) {
  const useTopic = topic || lastEvidenceTopic(env);
  if (!useTopic) throw new Error('no topic: pass one (`nd grade <topic>`), or capture evidence first with /no-deceit:teach or `nd evidence add`');
  if (!isSlug(useTopic)) throw new Error(`topic "${useTopic}" must be a slug (lowercase letters, digits, . _ -)`);
  const dp = dataPaths(env);
  const evidencePath = latestEvidence(env, useTopic);
  if (!evidencePath) throw new Error(`no evidence for "${useTopic}" under ${dp.evidenceDir(useTopic)}`);
  const projectsPath = dp.projectsManifests.find((f) => existsSync(f));
  if (!projectsPath) {
    throw new Error(
      `no project manifest: write ${dp.projectsManifests[0]} (or .json/.md) naming your projects, one line each. ` +
      'P2 is graded against that list, so the grader cannot judge transfer without it',
    );
  }
  const curriculumPath = existsSync(dp.curriculumFile(useTopic)) ? dp.curriculumFile(useTopic) : null;
  const summaryPath = existsSync(summaryPathFor(evidencePath)) ? summaryPathFor(evidencePath) : null;
  let summary = null;
  if (summaryPath) { try { summary = JSON.parse(readFileSync(summaryPath, 'utf8')); } catch { summary = null; } }

  const cfg = loadConfig(env);
  const raw = readFileSync(evidencePath, 'utf8');
  const fm = parseFrontmatter(raw);
  const kind = fm.meta.kind
    || (() => { try { return JSON.parse(readFileSync(`${evidencePath}.meta.json`, 'utf8')).kind; } catch { return null; } })()
    || 'pasted-text';
  const claimed = evidenceProject(evidencePath);
  const stamp = evidenceStamp(nowMs);
  const outputPath = join(dp.verdictsDir(useTopic), `${stamp}.json`);
  const resolved = invokeFromEnv(env, invoke) || makeLiveInvoke(env, { spawnImpl });

  const result = await gradeTransferAttempt({
    evidenceText: fm.body,
    sourceTexts: sourceTextsFor(env, useTopic),
    summary,
    diagramFile: kind === 'mermaid' || kind === 'excalidraw',
    minChars: cfg.attemptMinChars,
    invoke: resolved,
    timeoutMs: timeoutMs || cfg.graderTimeoutMs,
    model: model || cfg.graderModel,
    evidencePath, curriculumPath, projectsPath, summaryPath, outputPath,
    pluginRoot: pluginRoot(),
  });

  const id = randomUUID();
  writeJson(outputPath, { ...result, id, topic: useTopic, project: claimed, kind, evidencePath, route: 'transfer' });
  const flags = {};
  for (const [k, c] of Object.entries(result.criteria)) flags[k] = c.met;
  appendLedger(env, {
    event: 'transfer_grade',
    topic: useTopic,
    project: claimed,
    kind,
    verdict: result.verdict,
    source: result.source,
    criteria: flags,
    structure: result.structure,
    error_class: result.error_class,
    misconceptions: result.misconceptions,
    next_smaller_question: result.next_smaller_question,
    prefilter_reason: result.prefilter_reason,
    path: evidencePath,
    id,
    sessionId: sessionId || null,
  });
  if (repoRoot && isGoverned(repoRoot)) {
    writeProjectState(repoRoot, {
      ...readProjectState(repoRoot, env),
      lastDiagnosis: {
        error_class: result.error_class,
        misconceptions: result.misconceptions || [],
        next_smaller_question: result.next_smaller_question,
      },
      pendingTutorNote: transferTutorNote(result, useTopic),
    });
  }
  if (result.verdict === 'unlocked') {
    const passed = `Transfer teach-back for ${useTopic} passed (${result.source}). error_class=${result.error_class}.`;
    const target = unlockTarget(projectsPath, claimed);
    if (!target.repo) return `${passed}\nNot unlocked: ${target.why}.`;
    const before = readProjectState(target.repo, env);
    const topics = before.unlockedTopics;
    writeProjectState(target.repo, { ...before, unlocked: true, unlockedTopics: topics.includes(useTopic) ? topics : [...topics, useTopic] });
    return `${passed} Tier 2 is unlocked for ${claimed} (${target.repo}).`;
  }
  return `not_yet (${result.source}${result.prefilter_reason ? `: ${result.prefilter_reason}` : ''}). ` +
    `Next question: ${result.next_smaller_question}`;
}
