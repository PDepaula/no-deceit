import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './classify.mjs';

// A representative config, mirroring the real defaults the hook builds.
const cfg = {
  statePathPrefixes: ['/repo/.no-deceit', '/home/u/.local/state/no-deceit', '/home/u/.config/no-deceit'],
  testGlobs: ['test/**', 'tests/**', '**/*_test.*', '**/*.test.*', '**/*.spec.*', '**/conftest.py', '**/test_*.py'],
  toolingGlobs: ['**/deps.edn', '**/shadow-cljs.edn', '**/package.json', '**/pyproject.toml', '**/Dockerfile', '**/Makefile', '**/*.lock', '**/.github/**', '**/tsconfig.json', '**/Cargo.toml'],
  ndBin: 'nd',
};

// --- Category A: inspect / read-only ---
test('Read is category A', () => {
  assert.equal(classify('Read', { file_path: '/repo/src/main.mjs' }, cfg), 'A');
});
test('Grep is category A', () => {
  assert.equal(classify('Grep', { pattern: 'foo' }, cfg), 'A');
});
test('Glob is category A', () => {
  assert.equal(classify('Glob', { pattern: '**/*.mjs' }, cfg), 'A');
});
test('read-only Bash (git log) is category A', () => {
  assert.equal(classify('Bash', { command: 'git log --oneline -20' }, cfg), 'A');
});
test('read-only Bash (cat) is category A', () => {
  assert.equal(classify('Bash', { command: 'cat src/main.mjs' }, cfg), 'A');
});

// --- Category B: run / feedback (execute, do not author) ---
test('test runner Bash is category B', () => {
  assert.equal(classify('Bash', { command: 'pytest -q' }, cfg), 'B');
});
test('REPL eval (python -c) is category B', () => {
  assert.equal(classify('Bash', { command: `python -c "print(sum(range(10)))"` }, cfg), 'B');
});
test('REPL eval (clojure -M -e) is category B', () => {
  assert.equal(classify('Bash', { command: `clj -M -e "(+ 1 2)"` }, cfg), 'B');
});
test('running the program (node script) is category B', () => {
  assert.equal(classify('Bash', { command: 'node src/main.mjs' }, cfg), 'B');
});
test('build tool (make) is category B', () => {
  assert.equal(classify('Bash', { command: 'make build' }, cfg), 'B');
});

// --- Category C: tooling / env ---
test('Write to package.json is category C', () => {
  assert.equal(classify('Write', { file_path: '/repo/package.json' }, cfg), 'C');
});
test('Edit to deps.edn is category C', () => {
  assert.equal(classify('Edit', { file_path: '/repo/deps.edn' }, cfg), 'C');
});
test('package manager install is category C', () => {
  assert.equal(classify('Bash', { command: 'npm install lodash' }, cfg), 'C');
});

// --- Category D: test scaffold ---
test('Write to test/ path is category D', () => {
  assert.equal(classify('Write', { file_path: '/repo/test/foo_test.mjs' }, cfg), 'D');
});
test('Edit to *.spec.* is category D', () => {
  assert.equal(classify('Edit', { file_path: '/repo/src/foo.spec.js' }, cfg), 'D');
});
test('Write to conftest.py is category D', () => {
  assert.equal(classify('Write', { file_path: '/repo/conftest.py' }, cfg), 'D');
});

// --- Category E: source mutation ---
test('Write to source file is category E', () => {
  assert.equal(classify('Write', { file_path: '/repo/src/main.mjs' }, cfg), 'E');
});
test('Edit to source file is category E', () => {
  assert.equal(classify('Edit', { file_path: '/repo/src/core.py' }, cfg), 'E');
});
test('NotebookEdit is category E by default', () => {
  assert.equal(classify('NotebookEdit', { notebook_path: '/repo/analysis.ipynb' }, cfg), 'E');
});
test('Bash shell redirect into source is category E', () => {
  assert.equal(classify('Bash', { command: 'echo "code" > src/main.mjs' }, cfg), 'E');
});
test('Bash sed -i on source is category E', () => {
  assert.equal(classify('Bash', { command: `sed -i 's/a/b/' src/main.mjs` }, cfg), 'E');
});
test('Bash heredoc to source file is category E', () => {
  assert.equal(classify('Bash', { command: 'cat <<EOF > src/main.mjs\ncode\nEOF' }, cfg), 'E');
});
test('Bash git apply is category E', () => {
  assert.equal(classify('Bash', { command: 'git apply patch.diff' }, cfg), 'E');
});
test('eval that writes a file (python open w) is category E', () => {
  assert.equal(classify('Bash', { command: `python -c "open('src/main.py','w').write('x')"` }, cfg), 'E');
});
test('redirect into a test path is category D not E', () => {
  assert.equal(classify('Bash', { command: 'echo x > test/foo_test.mjs' }, cfg), 'D');
});
test('redirect into a tooling path is category C not E', () => {
  assert.equal(classify('Bash', { command: 'echo x > package.json' }, cfg), 'C');
});

// --- Category F: delegation ---
test('Agent is category F', () => {
  assert.equal(classify('Agent', { subagent_type: 'general-purpose' }, cfg), 'F');
});
test('Task is category F', () => {
  assert.equal(classify('Task', {}, cfg), 'F');
});

// --- Category G: tamper ---
test('Write into project state dir is category G', () => {
  assert.equal(classify('Write', { file_path: '/repo/.no-deceit/state.json' }, cfg), 'G');
});
test('Write into home state dir is category G', () => {
  assert.equal(classify('Write', { file_path: '/home/u/.local/state/no-deceit/ledger.jsonl' }, cfg), 'G');
});
test('Bash touching state dir is category G', () => {
  assert.equal(classify('Bash', { command: 'echo x > /repo/.no-deceit/state.json' }, cfg), 'G');
});
test('Bash mutating nd subcommand (tier) is category G', () => {
  assert.equal(classify('Bash', { command: 'nd tier 3' }, cfg), 'G');
});
test('Bash mutating nd subcommand (unlock) is category G', () => {
  assert.equal(classify('Bash', { command: 'nd unlock --override "because"' }, cfg), 'G');
});
test('Bash read-only nd status is NOT tamper (category A)', () => {
  assert.equal(classify('Bash', { command: 'nd status' }, cfg), 'A');
});

// --- Category U: unknown Bash ---
test('unrecognized Bash command is category U', () => {
  assert.equal(classify('Bash', { command: 'frobnicate --wibble' }, cfg), 'U');
});

// A REPL probe that writes to stdout must NOT be misread as a file write.
test('python -c writing to stdout is category B, not E', () => {
  assert.equal(classify('Bash', { command: `python -c "import sys; sys.stdout.write('hi')"` }, cfg), 'B');
});
test('test runner with 2>&1 redirect is category B, not E', () => {
  assert.equal(classify('Bash', { command: 'pytest -q 2>&1' }, cfg), 'B');
});
