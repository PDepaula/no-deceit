import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEffective, decide, REASONS } from './policy.mjs';

const NOW = 1_000_000_000_000;

// --- resolveEffective: tier resolution incl. Tier 3 grant expiry ---

test('project tier 1 with no session overlay resolves to Tier 1', () => {
  const e = resolveEffective({ project: { tier: 1, mode: 'coach' }, session: {}, preamblePresent: false, nowMs: NOW });
  assert.equal(e.tier, 1);
  assert.equal(e.mode, 'coach');
  assert.equal(e.t2Unlocked, false);
  assert.equal(e.t3Active, false);
});

test('active Tier 3 grant resolves to Tier 3', () => {
  const e = resolveEffective({ project: { tier: 1 }, session: { t3ExpiresAtMs: NOW + 60_000 }, preamblePresent: true, nowMs: NOW });
  assert.equal(e.tier, 3);
  assert.equal(e.t3Active, true);
  assert.equal(e.t3PreamblePresent, true);
});

test('expired Tier 3 grant falls back to project tier', () => {
  const e = resolveEffective({ project: { tier: 2 }, session: { t3ExpiresAtMs: NOW - 1 }, preamblePresent: true, nowMs: NOW });
  assert.equal(e.tier, 2);
  assert.equal(e.t3Active, false);
  assert.ok(e.notes.some((n) => /expired/i.test(n)));
});

test('a project-level Tier 3 grant (from the nd CLI, no session id) is honored', () => {
  const e = resolveEffective({ project: { tier: 1, t3ExpiresAtMs: NOW + 60_000 }, session: {}, preamblePresent: true, nowMs: NOW });
  assert.equal(e.tier, 3);
  assert.equal(e.t3Active, true);
});

test('an expired project-level Tier 3 grant falls back with a note', () => {
  const e = resolveEffective({ project: { tier: 1, t3ExpiresAtMs: NOW - 1 }, session: {}, preamblePresent: true, nowMs: NOW });
  assert.equal(e.tier, 1);
  assert.equal(e.t3Active, false);
  assert.ok(e.notes.some((n) => /expired/i.test(n)));
});

test('project-scoped override unlock sets t2Unlocked', () => {
  const e = resolveEffective({ project: { tier: 2, unlocked: true }, session: {}, preamblePresent: false, nowMs: NOW });
  assert.equal(e.tier, 2);
  assert.equal(e.t2Unlocked, true);
});

test('session-scoped unlock sets t2Unlocked', () => {
  const e = resolveEffective({ project: { tier: 2 }, session: { unlocked: true }, preamblePresent: false, nowMs: NOW });
  assert.equal(e.t2Unlocked, true);
});

// --- decide: the tier x category table ---

function eff(over = {}) {
  return { tier: 1, mode: 'coach', t2Unlocked: false, t3Active: false, t3PreamblePresent: false, notes: [], ...over };
}

// Categories A/B/C/D are allowed at EVERY tier.
for (const cat of ['A', 'B', 'C', 'D']) {
  for (const tier of [1, 2, 3]) {
    test(`category ${cat} is allowed at Tier ${tier}`, () => {
      const e = eff({ tier, t2Unlocked: tier === 2, t3Active: tier === 3, t3PreamblePresent: tier === 3 });
      assert.equal(decide(e, { category: cat }).decision, 'allow');
    });
  }
}

// Category E: source mutation.
test('E denied at Tier 1 with Socratic redirect', () => {
  const r = decide(eff({ tier: 1 }), { category: 'E' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.reason, REASONS.T1);
});
test('E denied at Tier 2 locked with unlock instructions', () => {
  const r = decide(eff({ tier: 2, t2Unlocked: false }), { category: 'E' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.reason, REASONS.T2_LOCKED);
});
test('E denied at Tier 2 unlocked with show-they-type reason', () => {
  const r = decide(eff({ tier: 2, t2Unlocked: true }), { category: 'E' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.reason, REASONS.T2_UNLOCKED);
});
test('E denied at Tier 3 without preamble', () => {
  const r = decide(eff({ tier: 3, t3Active: true, t3PreamblePresent: false }), { category: 'E' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.reason, REASONS.T3_NO_PREAMBLE);
});
test('E allowed at Tier 3 with preamble present', () => {
  const r = decide(eff({ tier: 3, t3Active: true, t3PreamblePresent: true }), { category: 'E' });
  assert.equal(r.decision, 'allow');
});

// Category F: delegation.
test('F allowed at Tier 1', () => {
  assert.equal(decide(eff({ tier: 1 }), { category: 'F' }).decision, 'allow');
});
test('F allowed at Tier 2', () => {
  assert.equal(decide(eff({ tier: 2 }), { category: 'F' }).decision, 'allow');
});
test('F denied at Tier 3 without preamble', () => {
  assert.equal(decide(eff({ tier: 3, t3Active: true, t3PreamblePresent: false }), { category: 'F' }).decision, 'deny');
});
test('F asks at Tier 3 with preamble', () => {
  const r = decide(eff({ tier: 3, t3Active: true, t3PreamblePresent: true }), { category: 'F' });
  assert.equal(r.decision, 'ask');
  assert.equal(r.reason, REASONS.T3_SUBAGENT);
});

// Category G: tamper is denied at every tier.
for (const tier of [1, 2, 3]) {
  test(`G (tamper) denied at Tier ${tier}`, () => {
    const e = eff({ tier, t3Active: tier === 3, t3PreamblePresent: true });
    const r = decide(e, { category: 'G' });
    assert.equal(r.decision, 'deny');
    assert.equal(r.reason, REASONS.TAMPER);
  });
}

// Category U: unknown Bash -> ask at gated tiers, allow at granted Tier 3.
test('U asks at Tier 1', () => {
  assert.equal(decide(eff({ tier: 1 }), { category: 'U' }).decision, 'ask');
});
test('U asks at Tier 2', () => {
  assert.equal(decide(eff({ tier: 2 }), { category: 'U' }).decision, 'ask');
});
test('U allowed at Tier 3 with preamble', () => {
  assert.equal(decide(eff({ tier: 3, t3Active: true, t3PreamblePresent: true }), { category: 'U' }).decision, 'allow');
});
