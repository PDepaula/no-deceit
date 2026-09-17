import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseGitLog, collectGitEvidence } from './git-evidence.mjs';

test('parseGitLog splits commits and files from git log -p text', () => {
  const text = [
    '--NDCOMMIT--',
    'aaa',
    'first',
    'diff --git a/src/x.js b/src/x.js',
    '--- a/src/x.js',
    '+++ b/src/x.js',
    '@@ -0,0 +1 @@',
    '+hello',
    '--NDCOMMIT--',
    'bbb',
    'rename',
    'diff --git a/src/x.js b/src/y.js',
    'similarity index 100%',
    'rename from src/x.js',
    'rename to src/y.js',
  ].join('\n');
  const commits = parseGitLog(text);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].hash, 'aaa');
  assert.equal(commits[0].files[0].path, 'src/x.js');
  assert.match(commits[0].files[0].patch, /\+hello/);
  assert.equal(commits[1].files[0].status, 'rename');
  assert.equal(commits[1].files[0].similarity, 100);
});

test('collectGitEvidence reads a real repo and drops nothing yet (parse only)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nd-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'x.js'), 'let a = 1\n');
    execFileSync('git', ['add', 'x.js'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'first'], { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'x.js'), 'function walk(xs) { return xs.reduce((a, b) => a + b, 0) }\n');
    execFileSync('git', ['add', 'x.js'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'list'], { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'x.js'), 'function walk(node) { return node ? node.val + walk(node.left) : 0 }\n');
    execFileSync('git', ['add', 'x.js'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'tree'], { cwd: dir, stdio: 'ignore' });
    const commits = collectGitEvidence({ cwd: dir, files: ['x.js'] });
    assert.ok(commits.length >= 2);
    assert.ok(commits.every((c) => c.hash && c.files.length));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
