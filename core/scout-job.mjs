// No Deceit — curriculum scout job, spawn plan and output parsing (PURE).
//
// The scout is a fresh `claude -p` process (agents/nd-scout.md), spawned only by
// `nd curriculum build`, never by the tutor. It may read the files and URLs it is
// given, and it prints both curriculum files on stdout between markers; the shell
// validates them and writes them. It has no Write or Bash tool, so the only file
// a build can create is the one core/scout.mjs writes after the format check.
// It runs without skip-permissions in `dontAsk` mode: WebFetch is allowed, Read
// only for the directories and files the shell names, and anything else is denied.

import { isAbsolute, join } from 'node:path';

export const SCOUT_JOB_KEYS = ['topic', 'goal', 'mission', 'sources', 'projects', 'formatDocPath'];

export function buildScoutJob({ topic, goal, mission, sources = [], projects = [], formatDocPath }) {
  const job = { topic, goal, mission, sources, projects };
  if (formatDocPath) job.formatDocPath = formatDocPath;
  return job;
}

/** `--from` values: an http(s) URL is a url source, anything else a path source. */
export function classifySource(ref) {
  return /^https?:\/\//i.test(ref) ? { kind: 'url', ref } : { kind: 'path', ref };
}

/** Permission rules for the scout: WebFetch, plus Read of each absolute dir (recursively) and file. */
export function scoutAllowedTools({ readDirs = [], readFiles = [] } = {}) {
  for (const p of [...readDirs, ...readFiles]) if (!isAbsolute(p)) throw new Error(`scout read path must be absolute: ${p}`);
  return ['WebFetch', ...readDirs.map((d) => `Read(/${d}/**)`), ...readFiles.map((f) => `Read(/${f})`)];
}

export function scoutSpawnPlan({ pluginRoot, model = 'sonnet', jobPath, timeoutMs = 600_000, readDirs = [], readFiles = [] } = {}) {
  const agent = join(pluginRoot, 'agents', 'nd-scout.md');
  const prompt =
    `Read the JSON job file at ${jobPath}. Read the format document it names (formatDocPath) and every source it lists ` +
    `(Read for a path, WebFetch for a url). Then print the two curriculum files exactly as your instructions say, and nothing else.`;
  return {
    command: 'claude',
    args: [
      '-p',
      '--model', model,
      '--no-session-persistence',
      '--output-format', 'text',
      '--max-turns', '40',
      '--tools', 'Read,WebFetch',
      '--permission-mode', 'dontAsk',
      '--allowedTools', ...scoutAllowedTools({ readDirs, readFiles }),
      '--setting-sources', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--system-prompt-file', agent,
      prompt,
    ],
    stdin: null,
    timeoutMs,
    scratchCwd: true,
    envExtra: { ND_SCOUT_CHILD: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
    jobPath,
    agentPath: agent,
  };
}

const FILE_RE = /^<<<ND-FILE (open|sealed)\.md>>>\n([\s\S]*?)\n<<<ND-END>>>[ \t]*$/gm;

/** Split the scout's stdout into { open, sealed }; missing parts are null. */
export function parseScoutOutput(text) {
  const out = { open: null, sealed: null };
  const src = String(text ?? '').replace(/\r\n/g, '\n');
  for (const m of src.matchAll(FILE_RE)) out[m[1]] = m[2].replace(/\s+$/, '') + '\n';
  return out;
}
