// Guards the parser contract fixtures (fixtures/evidence/, PORTING.md step 7):
// the inputs are valid evidence as capture sees it, and every expected summary
// is internally consistent. No parser is implemented here: that is the
// Babashka namespaces' job, checked by `bb test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidenceKindForFile, validateExcalidraw } from './evidence.mjs';
import { ITEMS } from '../gold/transfer-gold.mjs';

const root = new URL('../fixtures/evidence/', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const index = JSON.parse(read('cases.json'));

const REQUIRED = [
  /unbound arrow/, /deleted/, /clipboard/, /Obsidian/, /mind map with cross-links/, /mermaid flowchart with nested subgraphs/,
];

test('fixtures cover the cases the parser contract names', () => {
  for (const re of REQUIRED) assert.ok(index.cases.some((c) => re.test(c.name)), `missing fixture: ${re}`);
  for (const p of Object.values(index.parsers)) assert.match(p.ns, /^no-deceit\.evidence\./);
});

for (const c of index.cases) {
  test(`fixture ${c.name}: input is capturable evidence`, () => {
    const input = read(c.input);
    const file = c.input.split('/').pop();
    const { kind, error } = evidenceKindForFile(file, input);
    assert.equal(error, null);
    const want = { excalidraw: 'excalidraw', mermaid: 'mermaid', mindmap: 'mindmap-text' }[c.parser];
    assert.equal(kind, want);
    if (c.parser === 'excalidraw' && !file.endsWith('.md')) assert.equal(validateExcalidraw(input).ok, true);
  });

  test(`fixture ${c.name}: expected summary is consistent`, () => {
    const s = JSON.parse(read(c.expect));
    const ids = new Set(s.nodes.map((n) => n.id));
    assert.equal(ids.size, s.nodes.length, 'node ids are unique');
    for (const e of s.edges || s.cross_links || []) {
      for (const end of [e.from, e.to]) assert.ok(end === null || ids.has(end), `edge end ${end} is a node`);
    }
    for (const members of Object.values(s.groups || {})) for (const m of members) assert.ok(ids.has(m));
    for (const g of Object.values(s.subgraphs || {})) for (const m of g.members) assert.ok(ids.has(m));
    for (const n of s.nodes) if (n.parent) assert.ok(ids.has(n.parent));
    if (c.parser === 'excalidraw') {
      assert.equal(s.kind, 'excalidraw');
      assert.ok(Number.isFinite(s.emphasis_variance));
      for (const n of s.nodes) assert.ok(n.emphasis >= 1 && n.emphasis <= 4);
    }
  });
}

test('deleted elements never leak into the expected summary', () => {
  const input = JSON.parse(read('excalidraw/deleted-element.excalidraw'));
  const deleted = new Set(input.elements.filter((e) => e.isDeleted).map((e) => e.id));
  assert.ok(deleted.size >= 3);
  const s = JSON.parse(read('excalidraw/deleted-element.summary.json'));
  for (const n of s.nodes) assert.equal(deleted.has(n.id), false);
  assert.equal(s.freedraw, 0);
});

test('the unbound-arrow fixture really has an arrow without bindings', () => {
  const input = JSON.parse(read('excalidraw/unbound-arrow.excalidraw'));
  const a2 = input.elements.find((e) => e.id === 'a2');
  assert.equal(a2.startBinding, null);
  assert.equal(a2.endBinding, null);
  const s = JSON.parse(read('excalidraw/unbound-arrow.summary.json'));
  assert.deepEqual(s.edges.map((e) => e.via), ['binding', 'proximity']);
});

test('gold-set diagram summaries follow the same envelope and node/edge shapes', () => {
  for (const item of ITEMS.filter((i) => i.summary)) {
    assert.equal(item.summary.version, 1);
    for (const d of item.summary.diagrams) {
      const ids = new Set(d.nodes.map((n) => n.id));
      for (const e of d.edges) { assert.ok(ids.has(e.from) && ids.has(e.to), `${item.id}: edge ends are nodes`); }
    }
  }
});
