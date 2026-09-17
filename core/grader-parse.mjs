// No Deceit — parse the blind grader's JSON output (PURE).

import { finalizeUnlockVerdict, finalizeCheckVerdict } from './rubric.mjs';

export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (v == null || v === '') return [];
  return [String(v)];
}

function errorClass(v) {
  return v === 'slip' || v === 'conceptual' ? v : 'conceptual';
}

/**
 * Turn raw model text into a mechanical verdict.
 * kind: 'unlock' (default) | 'check'
 */
export function parseGraderOutput(text, { route = 'mental-model', kind = 'unlock' } = {}) {
  const obj = extractJson(text);
  if (!obj) {
    if (kind === 'check') {
      const { verdict, criteria } = finalizeCheckVerdict({});
      return {
        verdict,
        criteria,
        parse_error: true,
        error_class: 'conceptual',
        misconceptions: [],
        next_smaller_question: null,
        rubric_gap: [],
      };
    }
    const { verdict, criteria } = finalizeUnlockVerdict({ route, rawCriteria: {} });
    return {
      verdict,
      criteria,
      parse_error: true,
      error_class: 'conceptual',
      misconceptions: [],
      next_smaller_question: null,
      rubric_gap: [],
    };
  }

  const torn = obj.torn === true;
  if (kind === 'check') {
    const { verdict, criteria } = finalizeCheckVerdict(obj.criteria || {}, torn);
    return {
      verdict,
      criteria,
      parse_error: false,
      error_class: errorClass(obj.error_class),
      misconceptions: asList(obj.misconceptions),
      next_smaller_question: obj.next_smaller_question ? String(obj.next_smaller_question) : null,
      rubric_gap: asList(obj.rubric_gap),
    };
  }

  const { verdict, criteria } = finalizeUnlockVerdict({
    route,
    rawCriteria: obj.criteria || {},
    llmVerdict: obj.verdict,
    torn,
  });
  return {
    verdict,
    criteria,
    parse_error: false,
    error_class: errorClass(obj.error_class),
    misconceptions: asList(obj.misconceptions),
    next_smaller_question: obj.next_smaller_question ? String(obj.next_smaller_question) : null,
    rubric_gap: asList(obj.rubric_gap),
  };
}
