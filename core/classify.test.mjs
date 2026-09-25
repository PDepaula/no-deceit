import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './classify.mjs';
import { decide } from './policy.mjs';

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
// Flagged package-manager installs must not misread the `install -flag` shape as source mutation.
for (const command of [
  'npm install -D lodash',
  'pip install -r requirements.txt',
  'apt-get install -y jq',
  'cargo install --locked ripgrep',
  'gem install -v 1.2 rails',
]) {
  test(`flagged package-manager install is category C: ${command}`, () => {
    assert.equal(classify('Bash', { command }, cfg), 'C');
  });
}

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
test('patch in command position is category E', () => {
  assert.equal(classify('Bash', { command: 'patch src/main.mjs < p.diff' }, cfg), 'E');
});
test('npm run patch-package is a run, category B not E', () => {
  assert.equal(classify('Bash', { command: 'npm run patch-package' }, cfg), 'B');
});
test('patch as a subcommand/argument is not forced to source mutation', () => {
  assert.notEqual(classify('Bash', { command: 'docker cp local remote:/x' }, cfg), 'E');
  assert.notEqual(classify('Bash', { command: 'git mv a b' }, cfg), 'E');
});
test('compound run-then-mutate is category E (most restrictive segment wins)', () => {
  assert.equal(classify('Bash', { command: 'pytest && mv /tmp/sol.py src/main.py' }, cfg), 'E');
  assert.equal(classify('Bash', { command: 'pip install -r req.txt && cp sol src/x.py' }, cfg), 'E');
});
test('compound of read-only segments stays category A', () => {
  assert.equal(classify('Bash', { command: 'git log && cat x' }, cfg), 'A');
});
test('compound tampering with state anywhere is category G', () => {
  assert.equal(classify('Bash', { command: 'echo x > .no-deceit/state.json && pytest' }, cfg), 'G');
});
test('operators inside quotes do not split the command', () => {
  assert.equal(classify('Bash', { command: `python -c "a && b"` }, cfg), 'B');
});
test('a wrapper prefix cannot hide a source-mutating command', () => {
  assert.equal(classify('Bash', { command: 'env cp /tmp/sol.py src/main.py' }, cfg), 'E');
  assert.equal(classify('Bash', { command: 'sudo mv sol src/x.py' }, cfg), 'E');
});
test('in-place editors that write source are category E', () => {
  assert.equal(classify('Bash', { command: `awk -i inplace "{print}" src/main.py` }, cfg), 'E');
  assert.equal(classify('Bash', { command: `ruby -i -pe s/a/b/ src/main.py` }, cfg), 'E');
});
test('benign shell-prep leading a compound does not force an ask', () => {
  assert.equal(classify('Bash', { command: 'cd sub && pytest' }, cfg), 'B');
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
  for (const c of ['nd project add /x', 'nd bootstrap', 'nd update']) assert.equal(classify('Bash', { command: c }, cfg), 'G', c);
});
test('Bash mutating nd check (blind grader) is category G — tutor must not spawn it', () => {
  assert.equal(classify('Bash', { command: 'nd check parser' }, cfg), 'G');
});
test('Bash read-only nd status is NOT tamper (category A)', () => {
  assert.equal(classify('Bash', { command: 'nd status' }, cfg), 'A');
});
test('Bash read-only nd audit is NOT tamper (category A)', () => {
  assert.equal(classify('Bash', { command: 'nd audit' }, cfg), 'A');
});
test('Bash read-only nd report is NOT tamper (category A)', () => {
  assert.equal(classify('Bash', { command: 'nd report --since 7d' }, cfg), 'A');
});
test('Bash relative redirect into state dir is category G', () => {
  assert.equal(classify('Bash', { command: `echo '{"tier":1}' > .no-deceit/state.json` }, cfg), 'G');
});
test('Write to a relative state path is category G', () => {
  assert.equal(classify('Write', { file_path: '.no-deceit/state.json' }, cfg), 'G');
});
test('relative state tamper is denied even at Tier 3 with preamble present', () => {
  const effective = { tier: 3, t2Unlocked: true, t3PreamblePresent: true };
  const redirect = classify('Bash', { command: `echo '{"tier":1}' > .no-deceit/state.json` }, cfg);
  const write = classify('Write', { file_path: 'nested/.no-deceit/state.json' }, cfg);
  assert.equal(decide(effective, { category: redirect }).decision, 'deny');
  assert.equal(decide(effective, { category: write }).decision, 'deny');
});
// Mutation shapes writeTargets() cannot parse, or bare relative args preceded
// by space or '=', must still be caught by the command-level state match.
const T3 = { tier: 3, t2Unlocked: true, t3PreamblePresent: true };
for (const command of [
  'dd if=/tmp/forged.json of=.no-deceit/state.json',
  'patch .no-deceit/state.json < p',
  `perl -i -pe 's/1/3/' .no-deceit/state.json`,
  'install -m 644 forged.json .no-deceit/state.json',
  'cat .no-deceit/state.json',
]) {
  test(`Bash referencing a relative state path is G and denied at Tier 3: ${command}`, () => {
    const cat = classify('Bash', { command }, cfg);
    assert.equal(cat, 'G');
    assert.equal(decide(T3, { category: cat }).decision, 'deny');
  });
}
// Undotted home state/config dirs in tilde/$HOME/relative spellings must be G too.
for (const command of [
  'echo x > ~/.config/no-deceit/config.json',
  'echo x > $HOME/.local/state/no-deceit/ledger.jsonl',
  'tee ~/.config/no-deceit/config.json',
  'dd of=.local/state/no-deceit/ledger.jsonl',
]) {
  test(`Bash referencing a home state path is G and denied at Tier 3: ${command}`, () => {
    const cat = classify('Bash', { command }, cfg);
    assert.equal(cat, 'G');
    assert.equal(decide(T3, { category: cat }).decision, 'deny');
  });
}
// The repo is itself named no-deceit; a bare reference must NOT be tamper.
test('bare repo-name reference is not tamper', () => {
  assert.equal(classify('Bash', { command: 'cat no-deceit/README.md' }, cfg), 'A');
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
