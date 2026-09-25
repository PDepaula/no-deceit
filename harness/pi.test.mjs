import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectPaths } from '../core/state.mjs';
import { createPiExtension } from './pi/extension.mjs';

function scratch({ governed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nd-pi-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  delete env.FM_TASK_ID; delete env.ND_EXEMPT; delete env.ND_WORKER; delete env.ND_HEADLESS;
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  if (governed) mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function install(env) {
  const handlers = {};
  const pi = { on(event, fn) { handlers[event] = fn; } };
  createPiExtension({ env })(pi);
  return handlers;
}

test('Pi tool_call returns {block:true, reason} on a Tier 1 source write', () => {
  const s = scratch();
  try {
    const handlers = install(s.env);
    const out = handlers.tool_call(
      { type: 'tool_call', toolName: 'write', input: { path: join(s.repo, 'src/x.mjs') } },
      { cwd: s.repo },
    );
    assert.equal(out.block, true);
    assert.match(out.reason, /Tier 1/);
  } finally { s.cleanup(); }
});

test('Pi tool_call returns {} on a read', () => {
  const s = scratch();
  try {
    const handlers = install(s.env);
    const out = handlers.tool_call(
      { type: 'tool_call', toolName: 'read', input: { path: join(s.repo, 'src/x.mjs') } },
      { cwd: s.repo },
    );
    assert.deepEqual(out, {});
  } finally { s.cleanup(); }
});

test('Pi tool_call blocks bash source mutation at Tier 1', () => {
  const s = scratch();
  try {
    const handlers = install(s.env);
    const out = handlers.tool_call(
      { type: 'tool_call', toolName: 'bash', input: { command: `echo x > ${join(s.repo, 'src/x.mjs')}` } },
      { cwd: s.repo },
    );
    assert.equal(out.block, true);
    assert.match(out.reason, /Tier 1|violation/i);
  } finally { s.cleanup(); }
});

test('Pi tool_call is a pass-through for a worker session', () => {
  const s = scratch();
  try {
    const handlers = install({ ...s.env, FM_TASK_ID: 'crew-1' });
    const out = handlers.tool_call(
      { type: 'tool_call', toolName: 'write', input: { path: join(s.repo, 'src/x.mjs') } },
      { cwd: s.repo },
    );
    assert.deepEqual(out, {});
  } finally { s.cleanup(); }
});
