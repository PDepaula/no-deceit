import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate } from '../core/gate.mjs';
import { projectPaths } from '../core/state.mjs';
import { evaluateHarnessCall } from './run.mjs';
import { applyOpenCode, applyPi, renderCursor } from './apply.mjs';

function scratch({ governed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nd-parity-'));
  const env = { XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'), HOME: dir };
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  if (governed) mkdirSync(projectPaths(repo).dir, { recursive: true });
  return { dir, env, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const NOW = 1_700_000_000_000;

test('the same fixture yields the same core decision regardless of adapter', () => {
  const s = scratch();
  try {
    const file_path = join(s.repo, 'src/x.mjs');
    const viaCore = evaluate({
      toolName: 'Write',
      toolInput: { file_path },
      cwd: s.repo,
      env: s.env,
      sessionId: 's',
      nowMs: NOW,
    });
    const viaOpenCode = evaluateHarnessCall({
      toolName: 'write',
      toolInput: { filePath: file_path },
      cwd: s.repo,
      env: s.env,
      sessionId: 's',
      nowMs: NOW,
    });
    const viaPi = evaluateHarnessCall({
      toolName: 'write',
      toolInput: { path: file_path },
      cwd: s.repo,
      env: s.env,
      sessionId: 's',
      nowMs: NOW,
    });
    const viaCursor = evaluateHarnessCall({
      toolName: 'Write',
      toolInput: { path: file_path },
      cwd: s.repo,
      env: s.env,
      sessionId: 's',
      nowMs: NOW,
    });
    for (const r of [viaOpenCode, viaPi, viaCursor]) {
      assert.equal(r.decision, viaCore.decision);
      assert.equal(r.category, viaCore.category);
      assert.equal(r.reason, viaCore.reason);
    }
    assert.equal(viaCore.decision, 'deny');
    assert.throws(() => applyOpenCode(viaOpenCode), (err) => err.message === viaCore.reason);
    assert.deepEqual(applyPi(viaPi), { block: true, reason: viaCore.reason });
    assert.equal(renderCursor(viaCursor).permission, 'deny');
    assert.equal(renderCursor(viaCursor).agent_message, viaCore.reason);
  } finally { s.cleanup(); }
});

test('Read/inspect is allow across adapters and does not throw or block', () => {
  const s = scratch();
  try {
    const path = join(s.repo, 'src/x.mjs');
    const viaCore = evaluate({
      toolName: 'Read', toolInput: { file_path: path },
      cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW,
    });
    const viaOpenCode = evaluateHarnessCall({
      toolName: 'read', toolInput: { filePath: path },
      cwd: s.repo, env: s.env, sessionId: 's', nowMs: NOW,
    });
    assert.equal(viaCore.decision, 'allow');
    assert.equal(viaOpenCode.decision, viaCore.decision);
    applyOpenCode(viaOpenCode);
    assert.deepEqual(applyPi(viaOpenCode), {});
    assert.deepEqual(renderCursor(viaOpenCode), { permission: 'allow' });
  } finally { s.cleanup(); }
});

test('worker exemption is identical across adapters (pass-through allow)', () => {
  const s = scratch();
  try {
    const env = { ...s.env, FM_TASK_ID: 'crew-1' };
    const file_path = join(s.repo, 'src/x.mjs');
    const viaCore = evaluate({
      toolName: 'Write', toolInput: { file_path },
      cwd: s.repo, env, sessionId: 's', nowMs: NOW,
    });
    const viaAdapter = evaluateHarnessCall({
      toolName: 'write', toolInput: { filePath: file_path },
      cwd: s.repo, env, sessionId: 's', nowMs: NOW,
    });
    assert.equal(viaCore.decision, 'allow');
    assert.equal(viaAdapter.decision, 'allow');
    assert.equal(viaAdapter.governed, false);
  } finally { s.cleanup(); }
});
