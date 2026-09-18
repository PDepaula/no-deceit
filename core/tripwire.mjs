// No Deceit — bashEditDiff tripwire (PURE, zero dependencies).
//
// Bash classification is a deny-list, not a parser. When a command slips
// past that list but Claude Code reports files it changed
// (`tool_response.bashEditDiff.changedFiles`), this flags category-E (and
// tamper) paths. REPL/run commands that do not write source have nothing
// to report and do not trip. Cache/artifact globs are ignored so a test
// runner's `__pycache__` does not block the feedback loop.

import { classify } from './classify.mjs';

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchesAny(absPath, globs) {
  if (!absPath) return false;
  const norm = String(absPath).replace(/\\/g, '/');
  const base = norm.split('/').pop();
  return (globs || []).some((g) => {
    const rx = globToRegExp(g);
    return rx.test(norm) || rx.test(base);
  });
}

function asPath(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') return entry.path || entry.file || entry.filePath || null;
  return null;
}

/** Pull changed-file paths out of a Bash tool_response, best-effort. */
export function parseChangedFiles(toolResponse) {
  if (!toolResponse || typeof toolResponse !== 'object') return [];
  const bed = toolResponse.bashEditDiff;
  let raw = [];
  if (Array.isArray(bed)) raw = bed;
  else if (bed && Array.isArray(bed.changedFiles)) raw = bed.changedFiles;
  else if (Array.isArray(toolResponse.changedFiles)) raw = toolResponse.changedFiles;
  return raw.map(asPath).filter(Boolean);
}

/**
 * leakedSourceWrites(paths, cfg) -> [{ file, category }]
 * A path is a leak when classifying it as a Write would be E or G, and it
 * does not match the tripwire ignore globs (caches, bytecode, etc.).
 */
export function leakedSourceWrites(paths, cfg = {}) {
  const ignore = cfg.tripwireIgnoreGlobs || [];
  const leaked = [];
  for (const file of paths || []) {
    if (!file) continue;
    if (matchesAny(file, ignore)) continue;
    const category = classify('Write', { file_path: file }, cfg);
    if (category === 'E' || category === 'G') leaked.push({ file, category });
  }
  return leaked;
}
