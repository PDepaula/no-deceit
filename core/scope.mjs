// No Deceit — Step 0 scope guard (PURE, zero dependencies).
//
// The gate applies only to attended sessions in opted-in projects. This
// decides whether the hook should enforce or pass through. It must not wedge
// the firstmate fleet: crewmates are Claude Code sessions too, and the deny
// holds under skip-permissions, so worker/headless sessions are exempt.
//
// The hook process inherits its environment from the harness process, not
// from the model's Bash calls, so the agent cannot forge an exemption.

// Environment markers that mark a non-attended (worker/headless) session.
// ND_GRADER_CHILD marks the blind grader child (core/grader-job.mjs).
// CLAUDECODE is deliberately NOT here: an attended developer session sets it
// too, so exempting on it would disable the gate for everyone.
export const WORKER_MARKERS = ['FM_TASK_ID', 'ND_EXEMPT', 'ND_WORKER', 'ND_HEADLESS', 'ND_GRADER_CHILD'];

/**
 * scopeDecision({ hasNoDeceitDir, env, workerMarkers? }) -> { inScope, reason }
 */
export function scopeDecision({ hasNoDeceitDir, env = {}, workerMarkers = WORKER_MARKERS }) {
  if (!hasNoDeceitDir) {
    return { inScope: false, reason: 'not governed (no .no-deceit directory)' };
  }
  const marker = workerMarkers.find((k) => env[k] != null && env[k] !== '');
  if (marker) {
    return { inScope: false, reason: `exempt (worker/headless marker ${marker})` };
  }
  return { inScope: true, reason: 'governed (opted-in, attended)' };
}
