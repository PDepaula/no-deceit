import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from './control.mjs';
import { parseGradeArgs, parseCheckArgs } from './unlock-args.mjs';
import {
  parseTeachArgs, isSlug, validateExcalidraw, detectDiagrams, evidenceKindForFile, evidenceStamp,
  evidenceFileName, renderTeachFile, parseFrontmatter, summaryPathFor, looksLikeMindmapText, countWords,
} from './evidence.mjs';

test('parseCommand returns the body after line 1', () => {
  const c = parseCommand('/no-deceit:teach etl --project gd-integrations\nline one\n\nline three\n');
  assert.deepEqual(c, { name: 'teach', arg: 'etl --project gd-integrations', body: 'line one\n\nline three' });
  assert.equal(parseCommand('/no-deceit:teach etl\r\nbody\r\n').body, 'body');
  assert.equal(parseCommand('explain this\n/no-deceit:teach etl\nx'), null);
});

test('parseTeachArgs: topic, --project, slug rules', () => {
  assert.deepEqual(parseTeachArgs('etl-vs-client-server --project gd-integrations'), { topic: 'etl-vs-client-server', project: 'gd-integrations', error: null });
  assert.equal(parseTeachArgs('etl --project=bondly').project, 'bondly');
  assert.equal(parseTeachArgs('etl').project, null);
  assert.match(parseTeachArgs('').error, /missing topic/);
  assert.match(parseTeachArgs('../etc').error, /slug/);
  assert.match(parseTeachArgs('etl --project a/b').error, /slug/);
  assert.equal(isSlug('a..b'), false);
});

test('validateExcalidraw accepts excalidraw and excalidraw/clipboard only', () => {
  assert.equal(validateExcalidraw('{"type":"excalidraw","elements":[{}]}').ok, true);
  const clip = validateExcalidraw('{"type":"excalidraw/clipboard","elements":[{},{}]}');
  assert.deepEqual([clip.ok, clip.elements], [true, 2]);
  assert.match(validateExcalidraw('{"type":"figma"}').error, /expected/);
  assert.match(validateExcalidraw('{oops').error, /not valid JSON/);
  assert.equal(validateExcalidraw('[]').ok, false);
});

test('detectDiagrams: mermaid fence, excalidraw fence and raw paste, mind map, invalid JSON', () => {
  assert.deepEqual(detectDiagrams('prose\n```mermaid\nflowchart TD\n A-->B\n```').kinds, ['mermaid']);
  assert.deepEqual(detectDiagrams('x\n```json\n{"type":"excalidraw/clipboard","elements":[]}\n```').kinds, ['excalidraw']);
  assert.deepEqual(detectDiagrams('my map: {"type":"excalidraw/clipboard","elements":[]}').kinds, ['excalidraw']);
  const bad = detectDiagrams('```json\n{"type":"figma","elements":[]}\n```');
  assert.deepEqual(bad.kinds, []);
  assert.match(bad.invalid[0], /expected/);
  assert.deepEqual(detectDiagrams('- a\n  - b\n  - c').kinds, ['mindmap-text']);
  assert.deepEqual(detectDiagrams('just words, no diagram').kinds, []);
  assert.equal(looksLikeMindmapText('- a\n- b'), false);
});

test('evidenceKindForFile: by extension, with validation', () => {
  assert.equal(evidenceKindForFile('a.mmd', 'flowchart TD').kind, 'mermaid');
  assert.equal(evidenceKindForFile('a.mermaid', 'x').ext, 'mermaid');
  assert.match(evidenceKindForFile('a.mmd', ' ').error, /empty/);
  assert.equal(evidenceKindForFile('a.excalidraw', '{"type":"excalidraw","elements":[]}').kind, 'excalidraw');
  assert.match(evidenceKindForFile('a.excalidraw', '{"type":"x"}').error, /not Excalidraw/);
  assert.equal(evidenceKindForFile('a.excalidraw.md', '---\nexcalidraw-plugin: parsed\n---\n').ext, 'excalidraw.md');
  assert.match(evidenceKindForFile('a.excalidraw.md', 'plain').error, /Obsidian/);
  assert.equal(evidenceKindForFile('n.md', '- a\n  - b\n  - c').kind, 'mindmap-text');
  assert.equal(evidenceKindForFile('n.md', 'some words').kind, 'pasted-text');
  assert.match(evidenceKindForFile('n.pdf', 'x').error, /unsupported/);
});

test('teach file round-trips through its frontmatter; stamps and names sort', () => {
  const file = renderTeachFile({ topic: 't', project: 'p', body: '\n\nhello world\n\n', sha256: 'abc', capturedAt: '2026-09-24T10:11:12.000Z', diagrams: ['mermaid'] });
  const { meta, body } = parseFrontmatter(file);
  assert.deepEqual([meta.topic, meta.project, meta.kind, meta.sha256, meta.diagrams], ['t', 'p', 'teach-back', 'abc', '[mermaid]']);
  assert.equal(body, 'hello world\n');
  assert.equal(evidenceStamp(Date.UTC(2026, 8, 24, 10, 11, 12, 999)), '2026-09-24T10-11-12Z');
  assert.equal(evidenceFileName('S', 'teach-back', 'md'), 'S-teach.md');
  assert.equal(evidenceFileName('S', 'mermaid', 'mmd'), 'S-mermaid.mmd');
  assert.equal(summaryPathFor('/d/x.mmd'), '/d/x.mmd.summary.json');
  assert.equal(countWords(' a  b\nc '), 3);
});

test('parseGradeArgs and parseCheckArgs --project', () => {
  assert.deepEqual(parseGradeArgs('etl --project p --evidence e.md'), { topic: 'etl', project: 'p', evidenceName: 'e.md' });
  assert.deepEqual(parseGradeArgs(''), { topic: null, project: null, evidenceName: null });
  assert.deepEqual(parseCheckArgs('t1 --project bondly'), { task: 't1', project: 'bondly' });
  assert.deepEqual(parseCheckArgs(''), { task: 'default', project: null });
});
