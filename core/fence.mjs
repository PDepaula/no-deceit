// No Deceit — fenced-code parser (PURE, zero dependencies).
//
// Used by the Stop-hook text-channel check and MessageDisplay redaction.
// "Small illustrative snippets" at Tier 1 are allowed up to
// DEFAULT_MAX_FENCE_LINES body lines (report D5 default: 6). A block *above*
// that threshold is the chat-text leak.

export const DEFAULT_MAX_FENCE_LINES = 6;

const OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;

function isClose(line, fenceChar, fenceLen) {
  const m = line.match(/^(\s*)(`{3,}|~{3,})\s*$/);
  if (!m) return false;
  return m[2][0] === fenceChar && m[2].length >= fenceLen;
}

/**
 * extractFences(text) -> [{ lang, body, lineCount, closed, start, end }]
 * `start`/`end` are 0-based line indices covering the fence (opener through
 * closer, or through EOF if unclosed).
 */
export function extractFences(text) {
  const lines = String(text ?? '').split('\n');
  const fences = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(OPEN);
    if (!open) { i++; continue; }
    const fence = open[2];
    const fenceChar = fence[0];
    const fenceLen = fence.length;
    const lang = open[3].trim();
    const start = i;
    i++;
    const body = [];
    let closed = false;
    while (i < lines.length) {
      if (isClose(lines[i], fenceChar, fenceLen)) {
        closed = true;
        break;
      }
      body.push(lines[i]);
      i++;
    }
    const end = closed ? i : i - 1;
    fences.push({
      lang,
      body: body.join('\n'),
      lineCount: body.length,
      closed,
      start,
      end,
    });
    i = closed ? i + 1 : i;
  }
  return fences;
}

export function overThresholdFences(text, maxLines = DEFAULT_MAX_FENCE_LINES) {
  return extractFences(text).filter((f) => f.lineCount > maxLines);
}

const DEFAULT_PLACEHOLDER =
  '[No Deceit: over-threshold code redacted at Tier 1. Small illustrative snippets only.]';

/**
 * Replace bodies of over-threshold fences. Small fences are left intact.
 * Returns { text, redacted, count }.
 */
export function redactOverThresholdFences(text, maxLines = DEFAULT_MAX_FENCE_LINES, placeholder = DEFAULT_PLACEHOLDER) {
  const src = String(text ?? '');
  const lines = src.split('\n');
  const over = overThresholdFences(src, maxLines);
  if (over.length === 0) return { text: src, redacted: false, count: 0 };

  // Apply from the end so earlier indices stay valid.
  const sorted = [...over].sort((a, b) => b.start - a.start);
  for (const f of sorted) {
    const opener = lines[f.start];
    const closer = f.closed ? lines[f.end] : null;
    const replacement = closer
      ? [opener, placeholder, closer]
      : [opener, placeholder];
    lines.splice(f.start, f.end - f.start + 1, ...replacement);
  }
  return { text: lines.join('\n'), redacted: true, count: over.length };
}
