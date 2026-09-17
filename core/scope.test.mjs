import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeDecision } from './scope.mjs';

test('no .no-deceit directory => not governed (pass-through)', () => {
  const r = scopeDecision({ hasNoDeceitDir: false, env: {} });
  assert.equal(r.inScope, false);
  assert.match(r.reason, /not governed/i);
});

test('opted-in + attended => in scope (enforced)', () => {
  const r = scopeDecision({ hasNoDeceitDir: true, env: {} });
  assert.equal(r.inScope, true);
});

test('firstmate crewmate (FM_TASK_ID) is exempt even when opted in', () => {
  const r = scopeDecision({ hasNoDeceitDir: true, env: { FM_TASK_ID: 'no-deceipt-plugin-phase1' } });
  assert.equal(r.inScope, false);
  assert.match(r.reason, /worker|exempt/i);
});

test('explicit ND_EXEMPT marker is exempt', () => {
  const r = scopeDecision({ hasNoDeceitDir: true, env: { ND_EXEMPT: '1' } });
  assert.equal(r.inScope, false);
});

test('headless marker ND_HEADLESS is exempt', () => {
  const r = scopeDecision({ hasNoDeceitDir: true, env: { ND_HEADLESS: '1' } });
  assert.equal(r.inScope, false);
});

test('a plain CLAUDECODE session (no worker marker) is still in scope', () => {
  // CLAUDECODE alone must NOT exempt: an attended developer session sets it too.
  const r = scopeDecision({ hasNoDeceitDir: true, env: { CLAUDECODE: '1' } });
  assert.equal(r.inScope, true);
});
