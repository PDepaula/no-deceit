import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyOpenCode, applyPi, renderCursor } from './apply.mjs';

const deny = { decision: 'deny', reason: 'No Deceit Tier 1 (Tutor). blocked' };
const ask = { decision: 'ask', reason: 'confirm before delegating' };
const allow = { decision: 'allow', reason: null };

test('OpenCode throws the core reason on deny', () => {
  assert.throws(() => applyOpenCode(deny), (err) => {
    assert.equal(err.message, deny.reason);
    return true;
  });
});

test('OpenCode throws the core reason on ask (no native ask shape)', () => {
  assert.throws(() => applyOpenCode(ask), /confirm before delegating/);
});

test('OpenCode is a no-op on allow', () => {
  assert.equal(applyOpenCode(allow), undefined);
});

test('Pi returns {block:true, reason} on deny', () => {
  assert.deepEqual(applyPi(deny), { block: true, reason: deny.reason });
});

test('Pi returns {block:true, reason} on ask (no native ask shape)', () => {
  assert.deepEqual(applyPi(ask), { block: true, reason: ask.reason });
});

test('Pi returns {} on allow', () => {
  assert.deepEqual(applyPi(allow), {});
});

test('Cursor stdout object is permission deny plus the reason', () => {
  assert.deepEqual(renderCursor(deny), {
    permission: 'deny',
    user_message: deny.reason,
    agent_message: deny.reason,
  });
});

test('Cursor stdout object is permission ask (schema-accepted, not enforced)', () => {
  assert.deepEqual(renderCursor(ask), {
    permission: 'ask',
    user_message: ask.reason,
    agent_message: ask.reason,
  });
});

test('Cursor stdout object is permission allow', () => {
  assert.deepEqual(renderCursor(allow), { permission: 'allow' });
});
