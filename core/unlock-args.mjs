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

/** `nd evidence add <topic> <path> [--project p]`: flags in any position, the rest positional. */
export function parseEvidenceArgs(input) {
  const tokens = tokenize(input);
  const positional = [];
  let project = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--project') project = tokens[++i] ?? null;
    else if (t.startsWith('--project=')) project = t.slice('--project='.length) || null;
    else positional.push(t);
  }
  const [action = null, topic = null, filePath = null] = positional;
  return { action, topic, filePath, project };
}

/** `nd grade` / `/no-deceit:grade`: [topic]. The project is the one the evidence names. */
export function parseGradeArgs(input) {
  return { topic: tokenize(input).find((t) => !t.startsWith('-')) ?? null };
}

/** `nd curriculum build <topic> --goal .. --mission .. --from x [--from y] [--projects a,b] [--force]`. Pure. */
export function parseCurriculumBuildArgs(input) {
  const tokens = tokenize(input);
  const out = { topic: null, goal: null, mission: null, from: [], projects: [], force: false, error: null };
  const value = (t, name, i) => {
    if (t.startsWith(`--${name}=`)) return [t.slice(name.length + 3), 0];
    if (t !== `--${name}`) return null;
    const next = tokens[i + 1];
    if (next === undefined || next.startsWith('-')) { out.error ??= `--${name} needs a value`; return [null, 0]; }
    return [next, 1];
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let v;
    if (t === '--force') out.force = true;
    else if ((v = value(t, 'goal', i))) { out.goal = v[0]; i += v[1]; }
    else if ((v = value(t, 'mission', i))) { out.mission = v[0]; i += v[1]; }
    else if ((v = value(t, 'from', i))) { if (v[0]) out.from.push(v[0]); i += v[1]; }
    else if ((v = value(t, 'projects', i))) { out.projects = String(v[0] ?? '').split(',').map((x) => x.trim()).filter(Boolean); i += v[1]; }
    else if (t.startsWith('-')) out.error ??= `unknown option ${t}; use --goal, --mission, --from, --projects or --force`;
    else if (out.topic === null) out.topic = t;
    else out.error ??= `unexpected argument ${t} (quote a multi-word --goal or --mission)`;
  }
  return out;
}
