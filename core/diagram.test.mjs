import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './classify.mjs';
import { decide, decideTextChannel, decideDisplay, REASONS } from './policy.mjs';
import { diagramFences, isDiagramFence, extractFences, redactGatedFences } from './fence.mjs';

const cfg = {
  statePathPrefixes: ['/repo/.no-deceit'],
  testGlobs: ['test/**', '**/*.test.*'],
  toolingGlobs: ['**/package.json'],
};
const eff = (over) => ({ tier: 1, mode: 'coach', t2Unlocked: false, t3Active: false, t3PreamblePresent: false, notes: [], ...over });

test('H: Write/Edit to a diagram source path', () => {
  for (const f of ['a.excalidraw', 'a.excalidraw.json', 'a.mmd', 'a.mermaid', 'a.drawio', 'a.puml', 'a.d2', 'a.dot']) {
    assert.equal(classify('Write', { file_path: `/repo/docs/${f}`, content: '{}' }, cfg), 'H', f);
    assert.equal(classify('Edit', { file_path: `/repo/docs/${f}`, new_string: 'x' }, cfg), 'H', f);
  }
});

test('H: markdown with a mermaid fence or mindmap block; plain markdown stays E', () => {
  const md = '/repo/docs/design.md';
  assert.equal(classify('Write', { file_path: md, content: '# D\n```mermaid\ngraph TD\n```\n' }, cfg), 'H');
  assert.equal(classify('Edit', { file_path: md, new_string: 'mindmap\n  root((x))' }, cfg), 'H');
  assert.equal(classify('MultiEdit', { file_path: md, edits: [{ new_string: '~~~mermaid\nx\n~~~' }] }, cfg), 'H');
  assert.equal(classify('Write', { file_path: md, content: '# just prose about mermaid the person' }, cfg), 'E');
});

test('H: Bash writing a diagram path or diagram content into markdown', () => {
  assert.equal(classify('Bash', { command: 'cat > docs/flow.mmd <<EOF\ngraph TD\nEOF' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo x > flow.excalidraw' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'cat > n.md <<EOF\n```mermaid\ngraph TD\n```\nEOF' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'cat > n.md <<EOF\nhello\nEOF' }, cfg), 'E');
});

test('H: a renderer fed inline source is H, bare or behind a package runner', () => {
  assert.equal(classify('Bash', { command: 'echo "a -> b" | dot -Tpng' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'd2 <<EOF\na -> b\nEOF' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo "graph TD; A---B" | npx -p @mermaid-js/mermaid-cli mmdc -i - -o docs/arch.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo "a -- b" | bunx d2 - docs/arch.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo "a -- b" | pnpm dlx d2 - docs/arch.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo "a -- b" | yarn dlx --quiet d2 - docs/arch.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'npx -y mmdc <<EOF\ngraph TD\nEOF' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo "graph TD" | npx @mermaid-js/mermaid-cli -i - -o docs/a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo "graph TD" | npx -y @mermaid-js/mermaid-cli -i - -o docs/a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo "graph TD" | npm exec -- mmdc -i - -o docs/a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo "graph TD" | pnpm exec mmdc -i - -o docs/a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: "d2 <<'EOF'\na -> b\nEOF" }, cfg), 'H');
});

test('a pipe or renderer word inside a quoted argument is not an inline-fed renderer', () => {
  assert.equal(classify('Bash', { command: 'grep -nE "slash|dot" src/app.js' }, cfg), 'A');
  assert.equal(classify('Bash', { command: "rg 'd1|d2' src" }, cfg), 'A');
  assert.notEqual(classify('Bash', { command: 'git commit -m "fix: use d2 | dot renderer"' }, cfg), 'H');
});

test('renderers on a file keep their ordinary handling; a redirected diagram source is H', () => {
  assert.equal(classify('Bash', { command: 'mmdc -i flow.mmd -o flow.png' }, cfg), 'U');
  assert.equal(classify('Bash', { command: 'dot -Tpng in.dot > out.png' }, cfg), 'E');
  assert.equal(classify('Bash', { command: 'dot -Tcanon theirs.dot > docs/arch.dot' }, cfg), 'H');
});

test('G still wins over H (a diagram in the state dir is tamper)', () => {
  assert.equal(classify('Write', { file_path: '/repo/.no-deceit/t3/preamble.excalidraw', content: '{}' }, cfg), 'G');
});

test('decide H: denied at T1, T2 locked, T2 unlocked (R4); T3 needs a preamble', () => {
  assert.deepEqual(decide(eff({ tier: 1 }), { category: 'H' }), { decision: 'deny', reason: REASONS.DIAGRAM_FILE });
  assert.deepEqual(decide(eff({ tier: 2 }), { category: 'H' }), { decision: 'deny', reason: REASONS.DIAGRAM_FILE });
  const u = decide(eff({ tier: 2, t2Unlocked: true }), { category: 'H' });
  assert.equal(u.decision, 'deny');
  assert.equal(u.reason, REASONS.DIAGRAM_FILE_T2_UNLOCKED);
  assert.match(u.reason, /redraws/);
  assert.equal(decide(eff({ tier: 3 }), { category: 'H' }).reason, REASONS.T3_NO_PREAMBLE);
  assert.equal(decide(eff({ tier: 3, t3PreamblePresent: true }), { category: 'H' }).decision, 'allow');
});

test('fence: diagram languages, excalidraw JSON, and mind-map bodies are diagrams at any size', () => {
  const mm = '```mermaid\ngraph TD\n```';
  assert.equal(diagramFences(mm).length, 1);
  assert.equal(diagramFences('```plantuml\n@startuml\n```').length, 1);
  assert.equal(diagramFences('```d2\na -> b\n```').length, 1);
  assert.equal(diagramFences('```dot\ndigraph{}\n```').length, 1);
  assert.equal(diagramFences('```json\n{ "type": "excalidraw", "elements": [] }\n```').length, 1);
  assert.equal(diagramFences('```\nmindmap\n  root\n```').length, 1);
  assert.equal(diagramFences('```js\nconst x = 1;\n```').length, 0);
  assert.equal(isDiagramFence(extractFences('```Mermaid title=x\ngraph\n```')[0]), true);
});

test('text channel: a 2-line diagram fence blocks at T1 and locked T2, opens at unlocked T2 and T3', () => {
  const text = 'Try this.\n```mermaid\ngraph TD\n  a-->b\n```\nWhat is the arrow labelled?';
  for (const t of [1, 2]) {
    const r = decideTextChannel(eff({ tier: t }), { text });
    assert.equal(r.decision, 'block');
    assert.equal(r.kind, 'chat_diagram');
    assert.equal(r.reason, REASONS.T_CHAT_DIAGRAM);
  }
  assert.equal(decideTextChannel(eff({ tier: 2, t2Unlocked: true }), { text }).decision, 'allow');
  assert.equal(decideTextChannel(eff({ tier: 3, t3PreamblePresent: true }), { text }).decision, 'allow');
});

test('display: diagrams are redacted on gated tiers (any size), small code is not', () => {
  const text = 'Look.\n```mermaid\ngraph TD\n  a-->b\n```\n```\nconst x = 1;\n```';
  const r = decideDisplay(eff({ tier: 2 }), { text, redactionEnabled: true });
  assert.equal(r.redact, true);
  assert.equal(r.kind, 'chat_diagram');
  assert.doesNotMatch(r.displayContent, /a-->b/);
  assert.match(r.displayContent, /const x = 1;/);
  assert.equal(decideDisplay(eff({ tier: 2, t2Unlocked: true }), { text, redactionEnabled: true }).redact, false);
  assert.equal(decideDisplay(eff({ tier: 2 }), { text, redactionEnabled: true, handoverActive: true }).redact, false);
  const both = redactGatedFences('```mermaid\na\n```\n```js\n' + 'x\n'.repeat(8) + '```');
  assert.equal(both.diagramCount, 1);
  assert.equal(both.codeCount, 1);
});
