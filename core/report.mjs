// No Deceit — earned-time report (PURE).
//
// Summarises an already-read ledger over a time window: attended time-in-tier,
// the Delegated lane (unattended/agentic; no learning claimed), unlock and
// checking-question counts, Coach-domain misconceptions, and per-domain
// Coach/Pair suggestions from error_class. No fs/clock/env reads; the
// imperative shell stamps `nowMs` and reads the JSONL.

import { suggestDomainMode } from './rubric.mjs';

export const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_IDLE_CAP_MS = 30 * 60 * 1000;

export function domainOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const d = entry.domain || entry.task;
  if (d == null || d === '') return null;
  return String(d);
}

export function suggestModesByDomain(entries, window) {
  const byDomain = new Map();
  for (const e of entries || []) {
    const cls = e && e.error_class;
    if (cls !== 'conceptual' && cls !== 'slip') continue;
    const domain = domainOf(e) || 'unscoped';
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(cls);
  }
  const out = [];
  for (const [domain, classes] of byDomain) {
    const cap = window == null ? classes.length : window;
    const mode = suggestDomainMode(classes, cap);
    if (!mode) continue;
    const conceptual = classes.filter((c) => c === 'conceptual').length;
    const slip = classes.filter((c) => c === 'slip').length;
    out.push({ domain, mode, conceptual, slip });
  }
  return out;
}

function parseTs(entry) {
  if (!entry || entry.ts == null) return NaN;
  return Date.parse(entry.ts);
}

function inWindow(entry, sinceMs, untilMs) {
  const t = parseTs(entry);
  return !Number.isNaN(t) && t >= sinceMs && t <= untilMs;
}

function nextState(state, entry) {
  if (entry.event === 'delegated' || entry.lane === 'delegated') {
    return { lane: 'delegated', tier: state.tier };
  }
  let tier = state.tier;
  if (entry.event === 'tier_change' && entry.to != null) {
    const n = Number(entry.to);
    if (n === 1 || n === 2 || n === 3) tier = n;
  } else if (entry.tier != null && entry.tier !== '') {
    const n = Number(entry.tier);
    if (n === 1 || n === 2 || n === 3) tier = n;
  }
  return { lane: 'learning', tier };
}

function credit(acc, fromMs, toMs, state, idleCapMs) {
  const delta = Math.min(Math.max(0, toMs - fromMs), idleCapMs);
  if (delta === 0) return;
  if (state.lane === 'delegated') acc.delegatedMs += delta;
  else if (state.tier === 3) acc.learningMs[3] += delta;
  else if (state.tier === 2) acc.learningMs[2] += delta;
  else acc.learningMs[1] += delta;
}

function uniquePush(list, value) {
  if (value == null || value === '') return;
  const s = String(value);
  if (!list.includes(s)) list.push(s);
}

function accumulateTime(entries, { sinceMs, untilMs, idleCapMs }) {
  const sorted = [...entries].filter((e) => !Number.isNaN(parseTs(e)))
    .sort((a, b) => parseTs(a) - parseTs(b));
  const acc = { learningMs: { 1: 0, 2: 0, 3: 0 }, delegatedMs: 0 };
  let state = { lane: 'learning', tier: 1 };
  let prevT = null;
  for (const entry of sorted) {
    const t = parseTs(entry);
    if (t > untilMs) break;
    if (t >= sinceMs && t <= untilMs) {
      if (prevT != null) credit(acc, prevT, t, state, idleCapMs);
      prevT = t;
    }
    state = nextState(state, entry);
  }
  return acc;
}

/**
 * summarise a ledger (array of parsed JSONL objects) over [sinceMs, untilMs].
 * `nowMs` is accepted for callers that stamp the window; it is not read from
 * the clock here.
 */
export function summarizeLedger(entries, {
  sinceMs,
  untilMs,
  nowMs: _nowMs,
  idleCapMs = DEFAULT_IDLE_CAP_MS,
} = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  const windowed = rows.filter((e) => inWindow(e, sinceMs, untilMs));
  const time = accumulateTime(rows, { sinceMs, untilMs, idleCapMs });

  const unlocks = { count: 0, unlocked: 0, not_yet: 0, overrides: 0, appeals: 0 };
  const checks = { landed: 0, not_landed: 0, partial: 0 };
  const misconceptionsByDomain = {};
  const delegatedIds = new Set();
  const delegatedTaskIds = [];

  for (const e of windowed) {
    if (e.event === 'delegated' || e.lane === 'delegated') {
      delegatedIds.add(e.sessionId || e.taskId || e.ts);
      uniquePush(delegatedTaskIds, e.taskId);
    }
    if (e.event === 'unlock_grade') {
      unlocks.count += 1;
      if (e.verdict === 'unlocked') unlocks.unlocked += 1;
      else unlocks.not_yet += 1;
    } else if (e.event === 'unlock_override') {
      unlocks.overrides += 1;
    } else if (e.event === 'unlock_appeal') {
      unlocks.appeals += 1;
    } else if (e.event === 'check_grade') {
      if (e.verdict === 'landed') checks.landed += 1;
      else if (e.verdict === 'partial') checks.partial += 1;
      else checks.not_landed += 1;
    }
    if (Array.isArray(e.misconceptions) && e.misconceptions.length) {
      const domain = domainOf(e) || 'unscoped';
      if (!misconceptionsByDomain[domain]) misconceptionsByDomain[domain] = [];
      for (const m of e.misconceptions) uniquePush(misconceptionsByDomain[domain], m);
    }
  }

  const suggestions = suggestModesByDomain(windowed);
  return {
    empty: windowed.length === 0,
    sinceMs,
    untilMs,
    learningMs: time.learningMs,
    learning12Ms: time.learningMs[1] + time.learningMs[2],
    delegatedMs: time.delegatedMs,
    delegatedSessions: delegatedIds.size,
    delegatedTaskIds,
    unlocks,
    checks,
    misconceptionsByDomain,
    suggestions,
  };
}

const REL = /^(\d+)(w|d|h|m)$/i;

export function parseInstant(raw, nowMs, label = 'timestamp') {
  if (raw == null || String(raw).trim() === '') {
    throw new Error(`nd report: ${label} needs a value`);
  }
  const s = String(raw).trim();
  const rel = REL.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = unit === 'w' ? n * DEFAULT_WINDOW_MS
      : unit === 'd' ? n * 24 * 60 * 60 * 1000
      : unit === 'h' ? n * 60 * 60 * 1000
      : n * 60 * 1000;
    return nowMs - ms;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00.000Z`);
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`nd report: cannot parse ${label} "${raw}"`);
  return t;
}

export function parseReportArgs(argv = [], nowMs = 0) {
  let sinceMs = nowMs - DEFAULT_WINDOW_MS;
  let untilMs = nowMs;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--since') {
      sinceMs = parseInstant(argv[++i], nowMs, '--since');
    } else if (flag === '--until') {
      untilMs = parseInstant(argv[++i], nowMs, '--until');
    } else {
      throw new Error(`nd report: unknown flag "${flag}" (try --since / --until)`);
    }
  }
  if (sinceMs > untilMs) throw new Error('nd report: --since is after --until');
  return { sinceMs, untilMs };
}

function formatDuration(ms) {
  const totalMin = Math.round((ms || 0) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function modeLabel(mode) {
  if (mode === 'coach') return 'Coach';
  if (mode === 'pair') return 'Pair';
  return mode;
}

/** Render a weekly-style summary. Pure string assembly. */
export function formatReport(summary, { nowMs: _nowMs } = {}) {
  const lines = ['No Deceit report'];
  if (summary.sinceMs != null && summary.untilMs != null) {
    lines.push(`  Window: ${isoDay(summary.sinceMs)} → ${isoDay(summary.untilMs)}`);
  }
  if (summary.empty) {
    lines.push('  Ledger is empty in this window. Nothing to summarise.');
    lines.push('  Delegated lane (unattended/agentic; no learning claimed): 0 sessions');
    return lines.join('\n');
  }

  lines.push('  Learning lane (attended):');
  lines.push(`    Tier 1/2: ${formatDuration(summary.learning12Ms)}`);
  lines.push(`    Tier 3:   ${formatDuration(summary.learningMs[3])}`);
  lines.push(`    (Gaps longer than ${formatDuration(DEFAULT_IDLE_CAP_MS)} are uncounted.)`);
  lines.push('  Delegated lane (unattended/agentic; no learning claimed):');
  lines.push(`    ${summary.delegatedSessions} session${summary.delegatedSessions === 1 ? '' : 's'}`);
  if (summary.delegatedMs > 0) {
    lines.push(`    Marked span (capped): ${formatDuration(summary.delegatedMs)}`);
  }
  if (summary.delegatedTaskIds && summary.delegatedTaskIds.length) {
    lines.push(`    Task ids: ${summary.delegatedTaskIds.join(', ')}`);
  }

  const u = summary.unlocks;
  lines.push(
    `  Unlocks: ${u.count} (${u.unlocked} unlocked, ${u.not_yet} not_yet)` +
    (u.overrides ? `; ${u.overrides} override${u.overrides === 1 ? '' : 's'}` : '') +
    (u.appeals ? `; ${u.appeals} appeal${u.appeals === 1 ? '' : 's'}` : ''),
  );
  const c = summary.checks;
  lines.push(`  Checking questions: ${c.landed} landed, ${c.not_landed} not_landed, ${c.partial} partial`);

  const domains = Object.keys(summary.misconceptionsByDomain || {});
  if (domains.length) {
    lines.push('  Coach-domain misconceptions:');
    for (const d of domains) {
      lines.push(`    ${d}: ${summary.misconceptionsByDomain[d].join('; ')}`);
    }
  } else {
    lines.push('  Coach-domain misconceptions: (none in this window)');
  }

  if (summary.suggestions && summary.suggestions.length) {
    lines.push('  Suggested mode (evidence; you choose — this does not switch mode):');
    for (const s of summary.suggestions) {
      const why = s.mode === 'coach' ? 'repeated conceptual' : 'mostly slip';
      lines.push(`    ${s.domain} → ${modeLabel(s.mode)} (${why})`);
    }
  } else {
    lines.push('  Suggested mode: (insufficient error_class data in this window)');
  }
  return lines.join('\n');
}
