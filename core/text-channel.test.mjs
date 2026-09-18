import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideTextChannel, decideDisplay, REASONS } from './policy.mjs';

const T1 = { tier: 1, mode: 'coach', t2Unlocked: false, t3Active: false, t3PreamblePresent: false, notes: [] };
const T2_LOCKED = { ...T1, tier: 2 };
const T2_UNLOCKED = { ...T1, tier: 2, t2Unlocked: true };
const T3 = { tier: 3, mode: 'coach', t2Unlocked: false, t3Active: true, t3PreamblePresent: true, notes: [] };

const SMALL = 'Here is the idea.\n```\nconst x = 1;\n```\nAsk yourself: which bind is easier to see?';
const BIG = 'Here is the solution.\n```js\n' + ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n') + '\n```\n';

const NARRATED = [
  '## What / why',
  'Wiring the Stop hook so the text channel cannot leak a solution.',
  'Divergence from your first instinct: none',
].join('\n');

test('Tier 1: over-threshold fenced code is a text-channel violation', () => {
  const r = decideTextChannel(T1, { text: BIG });
  assert.equal(r.decision, 'block');
  assert.equal(r.reason, REASONS.T1_CHAT_FENCE);
  assert.equal(r.kind, 'chat_fence');
});

test('Tier 1: a small illustrative snippet is allowed', () => {
  const r = decideTextChannel(T1, { text: SMALL });
  assert.equal(r.decision, 'allow');
  assert.equal(r.kind, null);
});

test('Tier 1: prose with no fences is allowed', () => {
  const r = decideTextChannel(T1, { text: 'Which of those two approaches makes the state easier to see?' });
  assert.equal(r.decision, 'allow');
});

test('Tier 2 locked: over-threshold fences are still a violation (text channel is T1)', () => {
  const r = decideTextChannel(T2_LOCKED, { text: BIG });
  assert.equal(r.decision, 'block');
  assert.equal(r.kind, 'chat_fence');
});

test('Tier 2 unlocked: over-threshold fences are allowed (worked solutions in chat are the point)', () => {
  const r = decideTextChannel(T2_UNLOCKED, { text: BIG });
  assert.equal(r.decision, 'allow');
});

test('Tier 3: over-threshold fences are allowed (higher tiers unaffected)', () => {
  const r = decideTextChannel(T3, { text: BIG, turnEdited: true });
  // T3 still needs narration, but fences themselves are not a leak at this tier.
  assert.notEqual(r.kind, 'chat_fence');
});

test('Tier 3 edited turn: missing narration/divergence is a format redirect, not a crash', () => {
  const r = decideTextChannel(T3, { text: 'I silently wrote the code.', turnEdited: true });
  assert.equal(r.decision, 'block');
  assert.equal(r.reason, REASONS.T3_NARRATION);
  assert.equal(r.kind, 'narration_format');
});

test('Tier 3 edited turn: present narration/divergence format passes', () => {
  const r = decideTextChannel(T3, { text: NARRATED, turnEdited: true });
  assert.equal(r.decision, 'allow');
});

test('Tier 3 with no edit this turn: narration format is not required', () => {
  const r = decideTextChannel(T3, { text: 'Just a question.', turnEdited: false });
  assert.equal(r.decision, 'allow');
});

test('Tier 3 narration redirect happens only once (stop_hook_active skips a second block)', () => {
  const r = decideTextChannel(T3, { text: 'still no format', turnEdited: true, stopHookActive: true });
  assert.equal(r.decision, 'allow');
});

test('Tier 1 fence block still fires when stop_hook_active (the leak can still be retracted)', () => {
  const r = decideTextChannel(T1, { text: BIG, stopHookActive: true });
  assert.equal(r.decision, 'block');
  assert.equal(r.kind, 'chat_fence');
});

test('decideDisplay redacts over-threshold Tier 1 code when the flag is on', () => {
  const r = decideDisplay(T1, { text: BIG, redactionEnabled: true });
  assert.equal(r.redact, true);
  assert.match(r.displayContent, /redacted/i);
  assert.doesNotMatch(r.displayContent, /\na\nb\nc\n/);
});

test('decideDisplay is a no-op at Tier 1 when redaction is off', () => {
  const r = decideDisplay(T1, { text: BIG, redactionEnabled: false });
  assert.equal(r.redact, false);
  assert.equal(r.displayContent, null);
});

test('decideDisplay does not redact small snippets', () => {
  const r = decideDisplay(T1, { text: SMALL, redactionEnabled: true });
  assert.equal(r.redact, false);
});

test('decideDisplay does not redact at unlocked Tier 2 or Tier 3', () => {
  assert.equal(decideDisplay(T2_UNLOCKED, { text: BIG, redactionEnabled: true }).redact, false);
  assert.equal(decideDisplay(T3, { text: BIG, redactionEnabled: true }).redact, false);
});
