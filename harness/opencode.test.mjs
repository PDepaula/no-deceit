import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectPaths } from '../core/state.mjs';
import { createOpenCodePlugin } from './opencode/plugin.mjs';

function scratch({ governed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nd-oc-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  delete env.FM_TASK_ID; delete env.ND_EXEMPT; delete env.ND_WORKER; delete env.ND_HEADLESS;
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  if (governed) mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function before(pluginDeps, repo, input, output) {
  const factory = createOpenCodePlugin(pluginDeps);
  const hooks = await factory({ directory: repo, worktree: repo });
  return hooks['tool.execute.before'](input, output);
}

test('OpenCode tool.execute.before throws on a Tier 1 source write', async () => {
  const s = scratch();
  try {
    await assert.rejects(
      () => before(
        { env: s.env },
        s.repo,
        { tool: 'write' },
        { args: { filePath: join(s.repo, 'src/x.mjs'), content: 'x' } },
      ),
      /Tier 1/,
    );
  } finally { s.cleanup(); }
});

test('OpenCode tool.execute.before allows a read', async () => {
  const s = scratch();
  try {
    await before(
      { env: s.env },
      s.repo,
      { tool: 'read' },
      { args: { filePath: join(s.repo, 'src/x.mjs') } },
    );
  } finally { s.cleanup(); }
});

test('OpenCode tool.execute.before throws on bash source redirect at Tier 1', async () => {
  const s = scratch();
  try {
    await assert.rejects(
      () => before(
        { env: s.env },
        s.repo,
        { tool: 'bash' },
        { args: { command: `cat > ${join(s.repo, 'src/x.mjs')} <<'EOF'\nhi\nEOF` } },
      ),
      /Tier 1|violation/i,
    );
  } finally { s.cleanup(); }
});

test('OpenCode tool.execute.before is a no-op for a worker session', async () => {
  const s = scratch();
  try {
    await before(
      { env: { ...s.env, FM_TASK_ID: 'crew-1' } },
      s.repo,
      { tool: 'write' },
      { args: { filePath: join(s.repo, 'src/x.mjs') } },
    );
  } finally { s.cleanup(); }
});
