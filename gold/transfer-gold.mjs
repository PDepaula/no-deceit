// Adversarial gold set for the transfer grader (redesign report §2.2).
// `gold/transfer-gold.jsonl` is the source of truth (one JSON item per line);
// this module only loads it so `nd audit` and the tests share one parse.
// Labels are the intended human judgment: correctness of a transfer is never a
// reason to fail (a wrong-but-specific transfer passes); genuineness is.
//
// Item: { id, route: 'transfer', case_type, must, gold_verdict,
//   expect_prefilter: 'pass'|'reject' (+ expect_prefilter_reason),
//   evidence, projects (manifest text), curriculum (concept text),
//   diagram_file?, summary? (the diagram envelope a Babashka parser would write),
//   gold_criteria P1–P5, gold_structure? G1–G5, gold_misconceptions? }

import { readFileSync } from 'node:fs';

export const ITEMS = readFileSync(new URL('./transfer-gold.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
