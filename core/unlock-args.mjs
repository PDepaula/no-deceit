// No Deceit — parse `nd unlock` / `/no-deceit:unlock` arguments (PURE).

function tokenize(input) {
  if (Array.isArray(input)) return input.filter((t) => t !== '');
  const s = String(input ?? '').trim();
  if (!s) return [];
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

export function parseUnlockArgs(input) {
  const tokens = tokenize(input);
  const out = { task: 'default', override: null, appeal: false, git: false, files: [], since: null };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--override') {
      const parts = [];
      while (i + 1 < tokens.length && !String(tokens[i + 1]).startsWith('--')) {
        parts.push(tokens[++i]);
      }
      out.override = parts.join(' ');
    } else if (t === '--appeal') {
      out.appeal = true;
    } else if (t === '--git') {
      out.git = true;
    } else if (t === '--files') {
      out.files = String(tokens[++i] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    } else if (t === '--since') {
      out.since = tokens[++i] ?? null;
    } else if (!t.startsWith('-')) {
      out.task = t;
    }
  }
  return out;
}

export function parseCheckArgs(input) {
  const tokens = tokenize(input);
  const out = { task: 'default', project: null };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--project') out.project = tokens[++i] ?? null;
    else if (t.startsWith('--project=')) out.project = t.slice('--project='.length) || null;
    else if (!t.startsWith('-')) out.task = t;
  }
  return out;
}

/** `nd grade` / `/no-deceit:grade`: [topic] [--project p] [--evidence <file name>]. */
export function parseGradeArgs(input) {
  const tokens = tokenize(input);
  const out = { topic: null, project: null, evidenceName: null };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--project') out.project = tokens[++i] ?? null;
    else if (t.startsWith('--project=')) out.project = t.slice('--project='.length) || null;
    else if (t === '--evidence') out.evidenceName = tokens[++i] ?? null;
    else if (!t.startsWith('-') && out.topic === null) out.topic = t;
  }
  return out;
}
