import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mapTool } from './map-tool.mjs';

test('OpenCode write (filePath) maps to Write with file_path', () => {
  const m = mapTool('write', { filePath: '/repo/src/x.mjs', content: 'x' });
  assert.equal(m.toolName, 'Write');
  assert.equal(m.toolInput.file_path, '/repo/src/x.mjs');
});

test('OpenCode bash maps to Bash with command', () => {
  const m = mapTool('bash', { command: 'echo hi' });
  assert.equal(m.toolName, 'Bash');
  assert.equal(m.toolInput.command, 'echo hi');
});

test('Pi write (path) maps to Write with file_path', () => {
  const m = mapTool('write', { path: '/repo/src/x.mjs' });
  assert.equal(m.toolName, 'Write');
  assert.equal(m.toolInput.file_path, '/repo/src/x.mjs');
});

test('Pi edit maps to Edit', () => {
  const m = mapTool('edit', { path: '/repo/src/x.mjs' });
  assert.equal(m.toolName, 'Edit');
  assert.equal(m.toolInput.file_path, '/repo/src/x.mjs');
});

test('Cursor Shell maps to Bash', () => {
  const m = mapTool('Shell', { command: 'pytest -q' });
  assert.equal(m.toolName, 'Bash');
  assert.equal(m.toolInput.command, 'pytest -q');
});

test('Cursor Write (path) maps to Write with file_path', () => {
  const m = mapTool('Write', { path: '/repo/src/x.mjs', contents: 'x' });
  assert.equal(m.toolName, 'Write');
  assert.equal(m.toolInput.file_path, '/repo/src/x.mjs');
});

test('Cursor StrReplace maps to Edit', () => {
  const m = mapTool('StrReplace', { path: '/repo/src/x.mjs', old_string: 'a', new_string: 'b' });
  assert.equal(m.toolName, 'Edit');
  assert.equal(m.toolInput.file_path, '/repo/src/x.mjs');
});

test('Cursor Delete maps to a source-mutation Write', () => {
  const m = mapTool('Delete', { path: '/repo/src/x.mjs' });
  assert.equal(m.toolName, 'Write');
  assert.equal(m.toolInput.file_path, '/repo/src/x.mjs');
});

test('Cursor Task and OpenCode task map to Task', () => {
  assert.equal(mapTool('Task', { prompt: 'go' }).toolName, 'Task');
  assert.equal(mapTool('task', { prompt: 'go' }).toolName, 'Task');
});

test('Claude-shaped names pass through', () => {
  const m = mapTool('Write', { file_path: '/repo/src/x.mjs' });
  assert.equal(m.toolName, 'Write');
  assert.equal(m.toolInput.file_path, '/repo/src/x.mjs');
});
