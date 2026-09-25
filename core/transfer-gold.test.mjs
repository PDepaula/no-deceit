import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS } from '../gold/transfer-gold.mjs';
import { prefilterTransfer } from './prefilter.mjs';
import { finalizeTransferVerdict } from './rubric.mjs';
import { runAudit } from './grader.mjs';

const REQUIRED_TYPES = [
  'recall-perfect-no-project', 'generic-project', 'wrong-project-name', 'benefit-only',
  'terse-but-transferring', 'confident-wrong-transfer', 'diagram-tree-no-links',
  'diagram-links-no-judgment', 'diagram-with-judgment-labels', 'error-paste-equivalent',
];

test('transfer gold set: ≥ 25 items, unique ids, every section 2.2 case type', () => {
  assert.ok(ITEMS.length >= 25, `got ${ITEMS.length}`);
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  const types = new Set(ITEMS.map((i) => i.case_type));
  for (const t of REQUIRED_TYPES) assert.ok(types.has(t), `missing ${t}`);
  for (const t of ['terse-but-transferring', 'confident-wrong-transfer', 'diagram-with-judgment-labels']) {
    assert.ok(ITEMS.some((i) => i.case_type === t && i.must === 'pass'), `${t} must have a pass item`);
  }
});

for (const item of ITEMS) {
  test(`transfer gold ${item.id}: ${item.must} → ${item.gold_verdict}`, () => {
    const pre = prefilterTransfer(item.evidence, {
      sourceTexts: [item.curriculum], summary: item.summary, diagramFile: Boolean(item.diagram_file),
    });
    if (item.expect_prefilter === 'reject') {
      assert.equal(pre.ok, false, `${item.id} should prefilter-reject`);
      assert.equal(pre.reason, item.expect_prefilter_reason);
      assert.equal(item.gold_verdict, 'not_yet');
      return;
    }
    assert.equal(pre.ok, true, `${item.id} should pass the prefilter, got ${pre.reason}`);
    for (const [id, c] of Object.entries(item.gold_criteria)) {
      if (c.met) assert.ok(item.evidence.includes(c.span), `${item.id} ${id} span is not in the evidence`);
    }
    const r = finalizeTransferVerdict({
      rawCriteria: item.gold_criteria, rawStructure: item.gold_structure, hasSummary: Boolean(item.summary),
    });
    assert.equal(r.verdict, item.gold_verdict);
    if (item.case_type === 'confident-wrong-transfer') {
      assert.ok((item.gold_misconceptions || []).length > 0, 'a wrong-but-specific transfer passes with misconceptions');
    }
    if (item.case_type.startsWith('diagram-')) assert.ok(item.summary, 'diagram items carry the parser summary seam');
  });
}

test('nd audit over the transfer set: oracle passes, an inflating grader is blocked', async () => {
  const oracle = await runAudit({
    items: ITEMS, runs: 1,
    invoke: async ({ item }) => ({ verdict: item.gold_verdict, criteria: item.gold_criteria, structure: item.gold_structure || {} }),
  });
  assert.equal(oracle.graded_up, 0);
  assert.equal(oracle.pass, true);
  const inflate = await runAudit({
    items: ITEMS, runs: 1,
    invoke: async () => ({ verdict: 'unlocked', criteria: Object.fromEntries(['P1', 'P2', 'P3', 'P4', 'P5'].map((k) => [k, { met: true, span: 'x' }])) }),
  });
  assert.ok(inflate.graded_up > 0);
  assert.equal(inflate.pass, false);
});
