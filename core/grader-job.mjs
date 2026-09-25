// No Deceit — blind grader job + spawn plan (PURE).
//
// The job is the only payload the child process receives. It names file paths
// and the fixed rubric. Tutoring dialogue is structurally absent: extra fields
// are dropped, and forbidden keys make assertJobBlind throw so a smuggled
// transcript cannot ride along.

import { join } from 'node:path';
import { MENTAL_RUBRIC, COMMIT_RUBRIC } from './rubric.mjs';

export const JOB_KEYS = [
  'kind',
  'route',
  'evidencePath',
  'outputPath',
  'rubric',
  'rubricPath',
  'answerPath',
];

const FORBIDDEN = [
  'transcript',
  'transcript_path',
  'transcriptPath',
  'dialogue',
  'conversation',
  'messages',
  'prompt_history',
  'promptHistory',
  'session_prompt',
  'sessionPrompt',
  'chat',
  'tutoring',
];

export function buildGraderJob(input = {}) {
  const kind = input.kind === 'check' ? 'check' : 'unlock';
  const route = input.route === 'commit-history' ? 'commit-history' : kind === 'check' ? 'check' : 'mental-model';
  const rubric = input.rubric
    || (kind === 'check' ? input.rubric : route === 'commit-history' ? COMMIT_RUBRIC : MENTAL_RUBRIC);
  const job = {
    kind,
    route,
    evidencePath: input.evidencePath || null,
    outputPath: input.outputPath || null,
    rubric,
  };
  if (input.rubricPath) job.rubricPath = input.rubricPath;
  if (input.answerPath) job.answerPath = input.answerPath;
  return job;
}

export function assertJobBlind(job) {
  if (!job || typeof job !== 'object') throw new Error('grader job is not blind: missing job');
  for (const key of Object.keys(job)) {
    if (FORBIDDEN.includes(key)) {
      throw new Error(`grader job is not blind: forbidden field "${key}"`);
    }
    if (!JOB_KEYS.includes(key)) {
      throw new Error(`grader job is not blind: unknown field "${key}"`);
    }
  }
  const path = job.evidencePath || job.answerPath;
  if (!path) throw new Error('grader job is not blind: no evidence file path');
  return true;
}

export function defaultGraderModel() {
  return 'haiku';
}

/**
 * Fresh-process spawn plan. The child is a plain `claude -p` — NOT `--bare`,
 * which never reads OAuth credentials and so cannot authenticate on a
 * subscription-only machine. Blindness comes from isolation instead: a
 * read-only tool list, no setting sources (so no user/project settings, hooks,
 * plugins, or CLAUDE.md), no MCP servers, no skills/slash commands, no session
 * persistence, no auto-memory, a scratch cwd (`scratchCwd`: the shell creates
 * an empty temp dir), and `ND_GRADER_CHILD=1`, which the hook scope guard
 * treats as a pass-through marker. argv/stdin/env mention only the job file
 * path and the grader agent file.
 */
export function graderSpawnPlan({
  pluginRoot,
  model = defaultGraderModel(),
  jobPath,
  timeoutMs = 120_000,
  probe = false,
} = {}) {
  const agent = join(pluginRoot, 'agents', 'nd-grader.md');
  const prompt = probe ? 'Reply with the single word: ok' : (
    `Read the JSON job file at ${jobPath}. ` +
    `Read only the file paths named in that job (evidencePath, rubricPath, answerPath). ` +
    `Grade against the rubric in the job. Print one JSON object and nothing else. ` +
    `Do not read any other files.`);
  return {
    command: 'claude',
    args: [
      '-p',
      '--model', model,
      '--no-session-persistence',
      '--output-format', 'text',
      '--max-turns', '4',
      '--tools', 'Read',
      '--allowedTools', 'Read',
      '--setting-sources', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--dangerously-skip-permissions',
      '--system-prompt-file', agent,
      prompt,
    ],
    stdin: null,
    timeoutMs,
    scratchCwd: true,
    envExtra: { ND_GRADER_CHILD: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
    jobPath,
    agentPath: agent,
  };
}

/** True when the child's output is the not-authenticated notice, not a verdict. */
export function isGraderAuthFailure(text) {
  return /^not logged in\b/i.test(String(text || '').trim());
}
