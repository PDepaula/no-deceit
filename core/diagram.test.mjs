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

test('H: any renderer invocation is H, bare or behind a package runner', () => {
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

test('quoting never hides a renderer (escapes, ANSI-C quotes, a comment apostrophe)', () => {
  assert.equal(classify('Bash', { command: "echo graph\\'TD | mmdc -i - -o docs/a.svg" }, cfg), 'H');
  assert.equal(classify('Bash', { command: "echo 'graph TD; A[User'\\''s app]---B' | mmdc -i - -o docs/a.svg" }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo "graph \\"TD\\"" | mmdc -i - -o docs/a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: "echo $'graph TD\\nA[User\\'s app]---B' | mmdc -i - -o docs/a.svg" }, cfg), 'H');
  assert.equal(classify('Bash', { command: "echo $'a -- b\\nc: it\\'s' | d2 - docs/a.svg" }, cfg), 'H');
  assert.equal(classify('Bash', { command: "# render the team's diagram\necho 'graph TD; A---B' | mmdc -i - -o docs/a.svg" }, cfg), 'H');
});

test('rendering a file the learner drew is H too; a redirected diagram source is H', () => {
  assert.equal(classify('Bash', { command: 'mmdc -i flow.mmd -o flow.png' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'dot -Tpng in.dot > out.png' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'd2 docs/arch.d2 docs/arch.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'dot -Tcanon theirs.dot > docs/arch.dot' }, cfg), 'H');
});

test('a renderer behind a launcher, a path, or an assignment is still an invocation', () => {
  assert.equal(classify('Bash', { command: 'sh -c "mmdc -i flow.mmd -o flow.svg"' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'bash -c plantuml docs/a.puml' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'ls *.mmd | xargs -n1 mmdc -i' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'sudo env PATH=/x time nice excalidraw-cli a.json' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'env FOO=1 mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'ls *.mmd | xargs -n 1 mmdc -i' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'xargs -I {} mmdc -i {} -o {}.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'sudo -u me mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'nice -n 10 mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'npx -p @mermaid-js/mermaid-cli mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'npx -y -p pkg mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'npx --package pkg mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'npx -y mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'sudo -E -u me env -i FOO=1 mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'time -f %e plantuml a.puml' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'find . -name "*.mmd" -exec mmdc -i {} \\;' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'find . -name "*.mmd" -execdir mmdc -i {} \\;' }, cfg), 'H');
  assert.equal(classify('Bash', { command: '/usr/bin/env FOO=1 mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'for f in *.mmd; do mmdc -i "$f"; done' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'out=$(plantuml -tsvg a.puml)' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'echo `d2 a.d2 a.svg`' }, cfg), 'H');
  assert.equal(classify('Bash', { command: './node_modules/.bin/mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'PUPPETEER_X=1 mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'npx @mermaid-js/mermaid-cli@10 -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'make && /usr/bin/dot -Tsvg a.dot -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'dot a.dot -Tsvg -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'dot -Kneato -Tsvg a.dot -o a.svg' }, cfg), 'H');
});

test('a renderer name mentioned as an argument is not an invocation', () => {
  assert.equal(classify('Bash', { command: 'grep -rn mmdc core/' }, cfg), 'A');
  assert.equal(classify('Bash', { command: 'rg plantuml docs' }, cfg), 'A');
  assert.equal(classify('Bash', { command: 'cat docs/plantuml-notes.md' }, cfg), 'A');
  assert.equal(classify('Bash', { command: 'which mmdc' }, cfg), 'A');
  assert.equal(classify('Bash', { command: 'ls dotfiles' }, cfg), 'A');
  assert.equal(classify('Bash', { command: 'grep dot notes.txt' }, cfg), 'A');
  assert.equal(classify('Bash', { command: 'grep dot notes.txt | cat -T' }, cfg), 'A');
  assert.equal(classify('Bash', { command: 'dot -V; ls -T' }, cfg), 'U');
  assert.equal(classify('Bash', { command: 'npm install @mermaid-js/mermaid-cli' }, cfg), 'C');
});

test('a boolean launcher flag never turns a renderer-named argument into an invocation', () => {
  for (const command of [
    "find . -name '*.md' | xargs -r grep -l plantuml",
    'find . -name mmdc',
    'xargs -r grep mmdc',
    'sudo -E grep -rn mmdc core/',
    'sudo -n cat plantuml.txt',
    'sudo -n grep -rn mmdc core/',
    'time -p grep -rn mmdc core/',
    'env -i grep -rn mmdc core/',
    'nice -19 grep mmdc notes.txt',
    'npx -y grep-cli mmdc',
  ]) {
    assert.notEqual(classify('Bash', { command }, cfg), 'H', command);
  }
  assert.notEqual(classify('Bash', { command: "bash -c 'grep -rn mmdc core/'" }, cfg), 'H');
  assert.notEqual(classify('Bash', { command: 'sh -c "grep -rn mmdc core/"' }, cfg), 'H');
});

test('a launcher word used as an ordinary argument never puts a renderer in command position', () => {
  for (const command of [
    'grep -r env docs mmdc',
    'echo time mmdc',
    'cat sh mmdc.txt',
    'rg -t sh mmdc core/',
    'rg --type sh plantuml',
    'fd -e sh plantuml',
    'fd -e sh mmdc',
    'git grep -n exec mmdc',
    'grep -rn -e sudo mmdc',
    'which env mmdc',
  ]) {
    assert.notEqual(classify('Bash', { command }, cfg), 'H', command);
  }
});

test('bun x and npm x run the renderer; command runs it unless it is a -v/-V lookup', () => {
  assert.equal(classify('Bash', { command: 'bun x mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'npm x mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'yarn exec mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'command mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.equal(classify('Bash', { command: 'command -p mmdc -i a.mmd -o a.svg' }, cfg), 'H');
  assert.notEqual(classify('Bash', { command: 'command -v mmdc' }, cfg), 'H');
  assert.notEqual(classify('Bash', { command: 'command -V plantuml' }, cfg), 'H');
  assert.notEqual(classify('Bash', { command: 'command -v mmdc >/dev/null && echo ok' }, cfg), 'H');
});

test('renderer detection is linear on long adversarial launcher chains', () => {
  for (const command of [
    'xargs -n '.repeat(5000) + 'x',
    'echo "' + 'xargs -n '.repeat(5000) + '"; cat > src/app.js <<EOF\nx\nEOF',
    'sudo -u '.repeat(5000) + 'grep mmdc',
    'npx -p npx '.repeat(5000) + 'x',
  ]) {
    const t0 = performance.now();
    classify('Bash', { command }, cfg);
    assert.ok(performance.now() - t0 < 50, command.slice(0, 20));
  }
  assert.equal(classify('Bash', { command: 'xargs -n '.repeat(5000) + ' 1 mmdc' }, cfg), 'H');
});

test('shell keywords put the next word in command position', () => {
  for (const command of [
    'if mmdc -i a.mmd -o a.svg; then echo ok; fi',
    '! mmdc -i a.mmd',
    'elif mmdc -i a',
    'until mmdc -i a; do :; done',
    'while mmdc -i a; do :; done',
  ]) {
    assert.equal(classify('Bash', { command }, cfg), 'H', command);
  }
  assert.notEqual(classify('Bash', { command: 'if grep -q mmdc notes.txt; then echo ok; fi' }, cfg), 'H');
  assert.notEqual(classify('Bash', { command: '! grep -q plantuml notes.txt' }, cfg), 'H');
});

test('a quoted renderer command word still runs the renderer; a quoted argument does not', () => {
  for (const command of [
    '"mmdc" -i a.mmd -o a.svg',
    "'mmdc' -i a.mmd -o a.svg",
    '"./node_modules/.bin/mmdc" -i a.mmd -o a.svg',
    "'dot' -Tpng a.dot -o a.png",
    'echo x | "d2" - a.svg',
    '"$(npm bin)/mmdc" -i a.mmd -o a.svg',
    "rg 'd1|d2' src",
    "$'mmdc' -i a.mmd -o a.svg",
    '$"mmdc" -i a.mmd -o a.svg',
    '\\mmdc -i a.mmd -o a.svg',
    'mm\\dc -i a',
  ]) {
    assert.equal(classify('Bash', { command }, cfg), 'H', command);
  }
  for (const command of [
    'grep "mmdc" file', "grep -rn 'plantuml' docs", 'command -v "mmdc"', 'git commit -m "deny mmdc"',
    "grep -rn $'mmdc' core/", 'echo \\mmdc', 'echo mmdc',
  ]) {
    assert.notEqual(classify('Bash', { command }, cfg), 'H', command);
  }
});

test('a backslash-newline continuation keeps one command in one segment', () => {
  for (const command of [
    'npx \\\n mmdc -i a.mmd',
    'dot \\\n -Tpng a.dot',
    'dot \\\r\n -Tpng a.dot',
    'dot -Tsvg a.dot \\\n -o a.svg',
    'sudo \\\n -u me mmdc -i a',
    'npx \\\n -p @mermaid-js/mermaid-cli mmdc -i a',
    'echo \\\\\nmmdc -i a',
  ]) {
    assert.equal(classify('Bash', { command }, cfg), 'H', JSON.stringify(command));
  }
  for (const command of ['grep -r \\\n mmdc core/', 'rg -n \\\n plantuml docs/', 'echo x \\\n mmdc']) {
    assert.notEqual(classify('Bash', { command }, cfg), 'H', JSON.stringify(command));
  }
});

test('a # inside quotes or a length expansion does not stop a continuation', () => {
  for (const command of [
    'echo "# build" && dot a.dot \\\n -Tpng -o a.png',
    'echo "# build" && npx \\\n -p @mermaid-js/mermaid-cli mmdc -i a',
    'n=${#files[@]}; dot a.dot \\\n -Tpng -o a.png',
  ]) {
    assert.equal(classify('Bash', { command }, cfg), 'H', JSON.stringify(command));
  }
  for (const command of ['echo "# build" && grep -rn \\\n mmdc core/', 'n=${#files[@]}; grep -rn \\\n mmdc core/']) {
    assert.notEqual(classify('Bash', { command }, cfg), 'H', JSON.stringify(command));
  }
});

test('dot and d2 as plain words are not renderer invocations', () => {
  assert.equal(classify('Bash', { command: 'ls ~/dotfiles' }, cfg), 'A');
  assert.equal(classify('Bash', { command: 'grep dot src/app.js' }, cfg), 'A');
  assert.equal(classify('Bash', { command: 'grep -nE "slash|dot" src/app.js' }, cfg), 'A');
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
