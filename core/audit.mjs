// No Deceit — gold-set audit (PURE comparison; I/O lives in the CLI).
//
// graded_up = a case scored more leniently than the gold label.
// Unlock: gold not_yet, observed unlocked.
// Check:  gold not_landed → partial/landed, or gold partial → landed.
// The release gate is graded_up = 0 across runs.

const UNLOCK_RANK = { not_yet: 0, unlocked: 1 };
const CHECK_RANK = { not_landed: 0, partial: 1, landed: 2 };

export function isCheckVerdict(v) {
  return v === 'landed' || v === 'partial' || v === 'not_landed';
}

export function isUpgrade(goldVerdict, observedVerdict) {
  if (isCheckVerdict(goldVerdict) || isCheckVerdict(observedVerdict)) {
    return (CHECK_RANK[observedVerdict] ?? 0) > (CHECK_RANK[goldVerdict] ?? 0);
  }
  return (UNLOCK_RANK[observedVerdict] ?? 0) > (UNLOCK_RANK[goldVerdict] ?? 0);
}

export function scoreRun(items, observedById) {
  const graded_up = [];
  const graded_down = [];
  const agree = [];
  const missing = [];
  const errors = [];
  for (const item of items) {
    const obs = observedById[item.id];
    if (!obs) {
      missing.push(item.id);
      continue;
    }
    if (obs.source === 'timeout' || obs.source === 'grader_failure' || obs.parse_error) {
      errors.push(item.id);
    }
    const observed = obs.verdict;
    if (isUpgrade(item.gold_verdict, observed)) graded_up.push(item.id);
    else if (item.gold_verdict !== observed) graded_down.push(item.id);
    else agree.push(item.id);
  }
  return {
    graded_up: graded_up.length,
    graded_down: graded_down.length,
    agree: agree.length,
    missing: missing.length,
    errors: errors.length,
    graded_up_ids: graded_up,
    graded_down_ids: graded_down,
    missing_ids: missing,
    error_ids: errors,
  };
}

export function aggregateRuns(runScores) {
  const graded_up = runScores.reduce((n, s) => n + s.graded_up, 0);
  const errors = runScores.reduce((n, s) => n + (s.errors || 0), 0);
  const ids = new Set();
  for (const s of runScores) for (const id of s.graded_up_ids) ids.add(id);
  return {
    runs: runScores.length,
    graded_up,
    errors,
    graded_up_ids: [...ids],
    pass: graded_up === 0 && errors === 0,
  };
}

export function formatAuditReport(agg, runScores) {
  const lines = [
    `No Deceit grader audit — ${agg.runs} run(s)`,
    `  graded_up: ${agg.graded_up}${agg.pass ? '' : '  FAIL (release gate is graded_up = 0)'}`,
  ];
  if (agg.errors) lines.push(`  errors: ${agg.errors} (timeout/parse/spawn; gate blocks)`);
  runScores.forEach((s, i) => {
    lines.push(`  run ${i + 1}: up=${s.graded_up} down=${s.graded_down} agree=${s.agree} missing=${s.missing} errors=${s.errors || 0}`);
  });
  if (agg.graded_up_ids.length) lines.push(`  upgraded ids: ${agg.graded_up_ids.join(', ')}`);
  lines.push(agg.pass ? '  gate: pass' : '  gate: block');
  return lines.join('\n');
}
