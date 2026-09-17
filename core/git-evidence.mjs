// No Deceit — git log -p → structured commits (imperative shell around a pure parser).

import { execFileSync } from 'node:child_process';

export function parseDiffFiles(diffText) {
  const text = String(diffText || '');
  const chunks = text.split(/^diff --git /m).filter((c) => c.trim());
  const files = [];
  for (const chunk of chunks) {
    const full = 'diff --git ' + chunk;
    const pathMatch = /^diff --git a\/(.+?) b\/(.+)$/m.exec(full);
    const renameFrom = /^rename from (.+)$/m.exec(full);
    const renameTo = /^rename to (.+)$/m.exec(full);
    const sim = /^similarity index (\d+)%/m.exec(full);
    const path = (renameTo ? renameTo[1].trim() : pathMatch?.[2]) || null;
    const from = (renameFrom ? renameFrom[1].trim() : pathMatch?.[1]) || null;
    const status = renameFrom ? 'rename' : 'modify';
    const at = full.search(/\n@@/);
    const patch = at >= 0 ? full.slice(at + 1) : '';
    files.push({
      path,
      from,
      status,
      similarity: sim ? Number(sim[1]) : 0,
      patch,
    });
  }
  return files;
}

/** Parse `git log --format='--NDCOMMIT--%n%H%n%s' -p` output. Pure. */
export function parseGitLog(text) {
  const raw = String(text || '').replace(/^\s+/, '');
  const parts = raw.split(/^--NDCOMMIT--\n/m).filter((p) => p.trim());
  const commits = [];
  for (const part of parts) {
    const nl1 = part.indexOf('\n');
    if (nl1 < 0) continue;
    const hash = part.slice(0, nl1).trim();
    const rest = part.slice(nl1 + 1);
    const nl2 = rest.indexOf('\n');
    const subject = (nl2 < 0 ? rest : rest.slice(0, nl2)).trim();
    const body = nl2 < 0 ? '' : rest.slice(nl2 + 1);
    commits.push({ hash, subject, files: parseDiffFiles(body) });
  }
  return commits;
}

/**
 * Collect `git log -p` over the task files since an optional start SHA.
 * Returns structured commits for the pre-filter / grader.
 */
export function collectGitEvidence({ cwd, files = [], since = null, exec = execFileSync } = {}) {
  const args = ['log', '--format=--NDCOMMIT--%n%H%n%s', '-p'];
  if (since) args.push(`${since}..HEAD`);
  args.push('--');
  if (files.length) args.push(...files);
  else args.push('.');
  let text = '';
  try {
    text = exec('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    text = '';
  }
  return parseGitLog(text);
}

export function commitsToEvidenceText(commits) {
  const lines = [];
  for (const c of commits) {
    lines.push(`commit ${c.hash}`);
    lines.push(c.subject);
    for (const f of c.files || []) {
      lines.push(`file ${f.path}${f.status === 'rename' ? ` (rename from ${f.from})` : ''}`);
      if (f.patch) lines.push(f.patch);
    }
    lines.push('');
  }
  return lines.join('\n');
}
