import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ITEMS } from '../gold/unlock-gold.mjs';
import { prefilterMentalModel, prefilterCommitHistory } from './prefilter.mjs';
import { finalizeUnlockVerdict, finalizeCheckVerdict } from './rubric.mjs';

const REQUIRED_TYPES = [
  'fluent-but-empty',
  'restates-the-error',
  'idk-it-just-doesnt-work',
  'terse-but-genuine',
  'confident-wrong-but-falsifiable',
  'rename-format-commit-spam',
  'same-approach-retyped',
  'one-real-change-split',
];

test('gold set is 30–40 items and covers the required adversarial types', () => {
  assert.ok(ITEMS.length >= 30, `got ${ITEMS.length}`);
  assert.ok(ITEMS.length <= 40, `got ${ITEMS.length}`);
  const types = new Set(ITEMS.map((i) => i.case_type));
  for (const t of REQUIRED_TYPES) assert.ok(types.has(t), `missing ${t}`);
  assert.ok(ITEMS.some((i) => i.must === 'pass' && i.case_type === 'terse-but-genuine'));
  assert.ok(ITEMS.some((i) => i.must === 'pass' && i.case_type === 'confident-wrong-but-falsifiable'));
  const jsonl = readFileSync(new URL('../gold/unlock-gold.jsonl', import.meta.url), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(jsonl.length, ITEMS.length);
});

for (const item of ITEMS) {
  test(`gold ${item.id}: ${item.must} → ${item.gold_verdict}`, () => {
    if (item.route === 'check') {
      const r = finalizeCheckVerdict(item.gold_criteria);
      assert.equal(r.verdict, item.gold_verdict);
      return;
    }

    if (item.route === 'mental-model') {
      const p = prefilterMentalModel(item.evidence, { errorText: item.errorText });
      if (item.expect_prefilter === 'reject') {
        assert.equal(p.ok, false, `${item.id} should prefilter-reject`);
        assert.equal(item.gold_verdict, 'not_yet');
        return;
      }
      assert.equal(p.ok, true, `${item.id} should pass prefilter`);
    } else {
      const p = prefilterCommitHistory(item.commits);
      if (item.expect_prefilter === 'reject') {
        assert.equal(p.ok, false, `${item.id} should prefilter-reject`);
        assert.equal(item.gold_verdict, 'not_yet');
        return;
      }
      assert.equal(p.ok, true, `${item.id} should pass prefilter`);
    }

    assert.ok(item.gold_criteria, `${item.id} needs gold_criteria`);
    const r = finalizeUnlockVerdict({ route: item.route, rawCriteria: item.gold_criteria });
    assert.equal(r.verdict, item.gold_verdict);
    if (item.must === 'pass') assert.equal(r.verdict, 'unlocked');
    if (item.must === 'fail') assert.equal(r.verdict, 'not_yet');
  });
}
