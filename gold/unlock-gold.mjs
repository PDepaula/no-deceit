// Adversarial gold set for the Tier 2 unlock grader.
// Labels are the intended human judgment. Correctness of a hypothesis is
// never a reason to fail; genuineness of engagement is.

export const ITEMS = [
  {
    id: 'fluent-empty-01',
    route: 'mental-model',
    case_type: 'fluent-but-empty',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    evidence:
      'I have been working through this carefully and I really think I understand the overall shape of the problem. ' +
      'There is clearly something going on with the data and the way the function is structured, and I have looked at it ' +
      'from a few angles. It feels like a classic case of needing to be more systematic. I am fairly confident that once ' +
      'the pieces click this will be straightforward. I would appreciate a hint so I can keep moving.',
    gold_criteria: {
      R1: { met: false, span: null },
      R2: { met: false, span: null },
      R3: { met: false, span: null },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'fluent-empty-02',
    route: 'mental-model',
    case_type: 'fluent-but-empty',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    evidence:
      'The bug is probably somewhere in the pipeline. I have read the file a few times and the names all make sense. ' +
      'This is the kind of issue that usually turns out to be an off-by-one or a missing edge case, you know? ' +
      'I am pretty fluent with this language so I suspect it is just a small thing I am not seeing. Happy to try whatever you suggest next.',
    gold_criteria: {
      R1: { met: false, span: null },
      R2: { met: false, span: null },
      R3: { met: false, span: null },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'fluent-empty-03',
    route: 'mental-model',
    case_type: 'fluent-but-empty',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    evidence:
      'Okay so stepping back, software is about transforming inputs into outputs and this function is no exception. ' +
      'I have applied a growth mindset and stayed with the discomfort. The code is telling me something and I am listening. ' +
      'I just need a nudge on where to look because I have already invested a lot of sincere effort here.',
    gold_criteria: {
      R1: { met: false, span: null },
      R2: { met: false, span: null },
      R3: { met: false, span: null },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'error-paste-01',
    route: 'mental-model',
    case_type: 'restates-the-error',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    evidence: [
      'TypeError: Cannot read properties of undefined (reading \'map\')',
      '    at parse (src/parser.js:41:18)',
      '    at Object.<anonymous> (src/cli.js:12:1)',
      '    at Module._compile (node:internal/modules/cjs/loader:1521:14)',
      '    at Object.Module._extensions..js (node:internal/modules/cjs/loader:1623:10)',
      '    at Module.load (node:internal/modules/cjs/loader:1266:32)',
    ].join('\n'),
  },
  {
    id: 'error-paste-02',
    route: 'mental-model',
    case_type: 'restates-the-error',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    errorText: 'FAIL test/add.test.js\nAssertionError: expected 3 to equal 4\n    at Context.<anonymous> (test/add.test.js:10:12)',
    evidence:
      'FAIL test/add.test.js\nAssertionError: expected 3 to equal 4\n    at Context.<anonymous> (test/add.test.js:10:12)\n' +
      'FAIL test/add.test.js\nAssertionError: expected 3 to equal 4\n    at Context.<anonymous> (test/add.test.js:10:12)',
  },
  {
    id: 'adjacent-fact-01',
    route: 'mental-model',
    case_type: 'restates-the-error',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    evidence:
      'The error says Cannot read properties of undefined reading map, which means something is undefined and then map is called on it. ' +
      'The stack trace points at parser.js line 41. That is the error. I need this unlocked so I can fix the undefined.',
    gold_criteria: {
      R1: { met: false, span: null },
      R2: { met: true, span: 'Cannot read properties of undefined reading map' },
      R3: { met: false, span: null },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'adjacent-fact-02',
    route: 'mental-model',
    case_type: 'restates-the-error',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    evidence:
      'Python told me Traceback most recently in foo.py line 12 KeyError: id. So there is a KeyError for id at line 12. ' +
      'That is what is going wrong. The task is to make the KeyError go away. I have seen the message several times now.',
    gold_criteria: {
      R1: { met: false, span: null },
      R2: { met: true, span: 'KeyError: id' },
      R3: { met: false, span: null },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'idk-01',
    route: 'mental-model',
    case_type: 'idk-it-just-doesnt-work',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    evidence: 'idk it just doesn\'t work',
  },
  {
    id: 'idk-02',
    route: 'mental-model',
    case_type: 'idk-it-just-doesnt-work',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    evidence: 'please just tell me the answer',
  },
  {
    id: 'idk-03',
    route: 'mental-model',
    case_type: 'idk-it-just-doesnt-work',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    evidence: 'idk',
  },
  {
    id: 'title-only-01',
    route: 'mental-model',
    case_type: 'fluent-but-empty',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    evidence:
      'This task is "implement parseQuery". I am implementing parseQuery. parseQuery should parse the query. ' +
      'It currently does not parse the query. I think parseQuery is wrong because the tests for parseQuery fail. ' +
      'That is my model of parseQuery.',
    gold_criteria: {
      R1: { met: false, span: null },
      R2: { met: false, span: null },
      R3: { met: false, span: null },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'no-locus-01',
    route: 'mental-model',
    case_type: 'fluent-but-empty',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    evidence:
      'The tokenizer is supposed to emit number and symbol tokens as it walks the character stream. ' +
      'It actually throws on a trailing comma — I saw the exception in the REPL when I evaluated tokenize("a,") . ' +
      'I have tried a few things but I am not sure where. Maybe somewhere in the file.',
    gold_criteria: {
      R1: { met: true, span: 'emit number and symbol tokens as it walks the character stream' },
      R2: { met: true, span: 'throws on a trailing comma' },
      R3: { met: false, span: null },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'torn-r3-01',
    route: 'mental-model',
    case_type: 'fluent-but-empty',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    evidence:
      'The reducer is supposed to fold events into a balance. It prints 0 after a deposit I ran in the REPL. ' +
      'I think it might be the parser or the lexer or the database or the runtime, one of those, because something is off.',
    gold_criteria: {
      R1: { met: true, span: 'fold events into a balance' },
      R2: { met: true, span: 'prints 0 after a deposit' },
      R3: { met: false, span: null },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'terse-genuine-01',
    route: 'mental-model',
    case_type: 'terse-but-genuine',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    evidence:
      'The walker is supposed to cons-recurse on list cells. It returns nil on `(a . b)` because I think dotted pairs skip the cdr walk — the failing REPL result was nil, not a pair. Tried quoting; same result.',
    gold_criteria: {
      R1: { met: true, span: 'cons-recurse on list cells' },
      R2: { met: true, span: 'returns nil on `(a . b)`' },
      R3: { met: true, span: 'I think dotted pairs skip the cdr walk' },
      R4: { met: true, span: 'Tried quoting; same result' },
    },
  },
  {
    id: 'terse-genuine-02',
    route: 'mental-model',
    case_type: 'terse-but-genuine',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    evidence:
      'Should binary-search the sorted id list. It misses id=7 (prints -1) because I think the mid update uses lo=mid instead of mid+1, so the window never moves on a too-small mid. Have not tried swapping to linear yet.',
    gold_criteria: {
      R1: { met: true, span: 'binary-search the sorted id list' },
      R2: { met: true, span: 'misses id=7 (prints -1)' },
      R3: { met: true, span: 'I think the mid update uses lo=mid instead of mid+1' },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'terse-genuine-03',
    route: 'mental-model',
    case_type: 'terse-but-genuine',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    evidence:
      'Intended: a queue, FIFO. Actual: the second pop returns the newest value; I printed the array after each push. I think unshift on pop is reversing it because each removal takes from index 0 while push appends. Ruled out the producer — logs show the push order is 1,2,3.',
    gold_criteria: {
      R1: { met: true, span: 'a queue, FIFO' },
      R2: { met: true, span: 'the second pop returns the newest value' },
      R3: { met: true, span: 'I think unshift on pop is reversing it' },
      R4: { met: true, span: 'Ruled out the producer' },
    },
  },
  {
    id: 'confident-wrong-01',
    route: 'mental-model',
    case_type: 'confident-wrong-but-falsifiable',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    evidence:
      'JSON.parse is supposed to turn a string of UTF-16 code units into a tree of objects and arrays by recursive descent. ' +
      'What it actually does on my input is throw SyntaxError at position 14; I reproduced it with node -e. ' +
      'I think it fails because JSON forbids trailing commas and my generator always emits one after the last property — if I delete that comma it should parse. ' +
      'I already tried wrapping the string in extra braces; same error.',
    gold_criteria: {
      R1: { met: true, span: 'turn a string of UTF-16 code units into a tree of objects and arrays by recursive descent' },
      R2: { met: true, span: 'throw SyntaxError at position 14' },
      R3: { met: true, span: 'I think it fails because JSON forbids trailing commas' },
      R4: { met: true, span: 'tried wrapping the string in extra braces' },
    },
  },
  {
    id: 'confident-wrong-02',
    route: 'mental-model',
    case_type: 'confident-wrong-but-falsifiable',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    evidence:
      'The scheduler is supposed to run ready tasks in priority order from a binary heap. ' +
      'It actually runs them in insertion order; I logged task ids as they started. ' +
      'I think compare() returns the opposite sign because I subtracted low-minus-high, so the heap is a max-heap of the wrong field. ' +
      'If that is right, swapping the subtract operands will invert the observed order.',
    gold_criteria: {
      R1: { met: true, span: 'run ready tasks in priority order from a binary heap' },
      R2: { met: true, span: 'runs them in insertion order' },
      R3: { met: true, span: 'I think compare() returns the opposite sign' },
      R4: { met: false, span: null },
    },
  },
  {
    id: 'wrong-model-right-vocab-01',
    route: 'mental-model',
    case_type: 'confident-wrong-but-falsifiable',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    evidence:
      'Promise.then is supposed to register a continuation on a monad of async values. ' +
      'On my snippet it prints 1 then undefined; I ran it in node. ' +
      'I think it loses the return value because thenables unwrap one extra time — a number becoming a Promise of undefined. ' +
      'Ruled out a missing await; there is no async function here.',
    gold_criteria: {
      R1: { met: true, span: 'register a continuation on a monad of async values' },
      R2: { met: true, span: 'prints 1 then undefined' },
      R3: { met: true, span: 'I think it loses the return value because thenables unwrap one extra time' },
      R4: { met: true, span: 'Ruled out a missing await' },
    },
  },
  {
    id: 'r1-r3-r4-only-01',
    route: 'mental-model',
    case_type: 'terse-but-genuine',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    evidence:
      'Supposed to debounce keystrokes by resetting a timer. I think the timer is captured in a stale closure because handleChange is recreated every render without deps, so clearTimeout hits a dead id. I tried putting the timer on the element dataset; still fires twice. I have not captured the exact log line yet.',
    gold_criteria: {
      R1: { met: true, span: 'debounce keystrokes by resetting a timer' },
      R2: { met: false, span: null },
      R3: { met: true, span: 'I think the timer is captured in a stale closure' },
      R4: { met: true, span: 'tried putting the timer on the element dataset' },
    },
  },
  {
    id: 'rename-spam-01',
    route: 'commit-history',
    case_type: 'rename-format-commit-spam',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    commits: [
      { hash: 'a1', subject: 'rename 1', files: [{ path: 'src/b.js', status: 'rename', from: 'src/a.js', similarity: 100, patch: '' }] },
      { hash: 'a2', subject: 'rename 2', files: [{ path: 'src/c.js', status: 'rename', from: 'src/b.js', similarity: 100, patch: '' }] },
      { hash: 'a3', subject: 'rename 3', files: [{ path: 'src/d.js', status: 'rename', from: 'src/c.js', similarity: 100, patch: '' }] },
    ],
  },
  {
    id: 'format-spam-01',
    route: 'commit-history',
    case_type: 'rename-format-commit-spam',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    commits: [
      { hash: 'b1', subject: 'prettier', files: [{ path: 'src/x.js', patch: '-const x = 1\n+const x = 1;\n' }] },
      { hash: 'b2', subject: 'trailing comma', files: [{ path: 'src/x.js', patch: '-  foo(1, 2)\n+  foo(1, 2,)\n' }] },
      { hash: 'b3', subject: 'quotes', files: [{ path: 'src/x.js', patch: '-foo("a")\n+foo(\'a\')\n' }] },
    ],
  },
  {
    id: 'format-spam-02',
    route: 'commit-history',
    case_type: 'rename-format-commit-spam',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    commits: [
      { hash: 'c1', subject: 'indent', files: [{ path: 'src/x.js', patch: '-function f() {\n+function f() {\n' }] },
      { hash: 'c2', subject: 'spaces', files: [{ path: 'src/x.js', patch: '-const x=1\n+const x = 1\n' }] },
    ],
  },
  {
    id: 'whitespace-spam-01',
    route: 'commit-history',
    case_type: 'rename-format-commit-spam',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    commits: [
      { hash: 'd1', subject: 'spaces', files: [{ path: 'src/x.js', patch: '-const x=1\n+const x = 1\n' }] },
      { hash: 'd2', subject: 'more spaces', files: [{ path: 'src/x.js', patch: '-  return x\n+    return x\n' }] },
    ],
  },
  {
    id: 'same-approach-retyped-01',
    route: 'commit-history',
    case_type: 'same-approach-retyped',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    commits: [
      { hash: 'e1', subject: 'reduce v1', files: [{ path: 'src/sum.js', patch: '+export function sum(xs) { return xs.reduce((a, b) => a + b, 0) }\n' }] },
      { hash: 'e2', subject: 'reduce again', files: [{ path: 'src/sum.js', patch: '-export function sum(xs) { return xs.reduce((a, b) => a + b, 0) }\n+export function sum(list) { return list.reduce((acc, n) => acc + n, 0) }\n' }] },
    ],
    gold_criteria: {
      C1: { met: true, span: 'e1 e2' },
      C2: { met: false, span: null },
      C3: { met: false, span: null },
    },
  },
  {
    id: 'same-approach-retyped-02',
    route: 'commit-history',
    case_type: 'same-approach-retyped',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    commits: [
      { hash: 'f1', subject: 'regex v1', files: [{ path: 'src/tok.js', patch: '+const WORD = /[a-z]+/g\n' }] },
      { hash: 'f2', subject: 'regex v2', files: [{ path: 'src/tok.js', patch: '-const WORD = /[a-z]+/g\n+const WORD = /[A-Za-z]+/g\n' }] },
    ],
    gold_criteria: {
      C1: { met: true, span: 'f1 f2' },
      C2: { met: false, span: null },
      C3: { met: false, span: null },
    },
  },
  {
    id: 'one-change-five-commits-01',
    route: 'commit-history',
    case_type: 'one-real-change-split',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    commits: [
      { hash: 'g1', subject: 'add fn', files: [{ path: 'src/add.js', patch: '+export function add(a, b) {\n' }] },
      { hash: 'g2', subject: 'body', files: [{ path: 'src/add.js', patch: '+  return a + b\n' }] },
      { hash: 'g3', subject: 'close', files: [{ path: 'src/add.js', patch: '+}\n' }] },
      { hash: 'g4', subject: 'name', files: [{ path: 'src/add.js', patch: '-export function add(a, b) {\n+export function add(x, y) {\n' }] },
      { hash: 'g5', subject: 'return names', files: [{ path: 'src/add.js', patch: '-  return a + b\n+  return x + y\n' }] },
    ],
    gold_criteria: {
      C1: { met: true, span: 'five commits' },
      C2: { met: false, span: null },
      C3: { met: false, span: null },
    },
  },
  {
    id: 'one-change-split-02',
    route: 'commit-history',
    case_type: 'one-real-change-split',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'pass',
    commits: [
      { hash: 'h1', subject: 'import', files: [{ path: 'src/p.js', patch: '+import { q } from \'./q.js\'\n' }] },
      { hash: 'h2', subject: 'call 1', files: [{ path: 'src/p.js', patch: '+q(1)\n' }] },
      { hash: 'h3', subject: 'call 2', files: [{ path: 'src/p.js', patch: '+q(2)\n' }] },
      { hash: 'h4', subject: 'call 3', files: [{ path: 'src/p.js', patch: '+q(3)\n' }] },
      { hash: 'h5', subject: 'call 4', files: [{ path: 'src/p.js', patch: '+q(4)\n' }] },
    ],
    gold_criteria: {
      C1: { met: true, span: 'h1-h5' },
      C2: { met: false, span: null },
      C3: { met: false, span: null },
    },
  },
  {
    id: 'single-commit-01',
    route: 'commit-history',
    case_type: 'same-approach-retyped',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    commits: [
      { hash: 'i1', subject: 'the whole thing', files: [{ path: 'src/x.js', patch: '+export const x = 1\n' }] },
    ],
  },
  {
    id: 'two-files-no-unit-01',
    route: 'commit-history',
    case_type: 'same-approach-retyped',
    must: 'fail',
    gold_verdict: 'not_yet',
    expect_prefilter: 'reject',
    commits: [
      { hash: 'j1', subject: 'a', files: [{ path: 'src/a.js', patch: '+export const a = 1\n' }] },
      { hash: 'j2', subject: 'b', files: [{ path: 'src/b.js', patch: '+export const b = 2\n' }] },
    ],
  },
  {
    id: 'two-strategies-01',
    route: 'commit-history',
    case_type: 'two-real-strategies',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    commits: [
      { hash: 'k1', subject: 'list reduce', files: [{ path: 'src/walk.js', patch: '+function walk(xs) { return xs.reduce((a, b) => a + b, 0) }\n' }] },
      { hash: 'k2', subject: 'tree recurse', files: [{ path: 'src/walk.js', patch: '-function walk(xs) { return xs.reduce((a, b) => a + b, 0) }\n+function walk(node) { return node ? node.val + walk(node.left) + walk(node.right) : 0 }\n' }] },
    ],
    gold_criteria: {
      C1: { met: true, span: 'k1 k2' },
      C2: { met: true, span: 'reduce vs recursive tree' },
      C3: { met: true, span: 'both versions were executed in tests' },
    },
  },
  {
    id: 'two-strategies-02',
    route: 'commit-history',
    case_type: 'two-real-strategies',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    commits: [
      { hash: 'm1', subject: 'regex split', files: [{ path: 'src/parse.js', patch: '+export function parse(s) { return s.split(/,/) }\n' }] },
      { hash: 'm2', subject: 'recursive descent', files: [{ path: 'src/parse.js', patch: '-export function parse(s) { return s.split(/,/) }\n+export function parse(s) { let i=0; const val = () => s[i++]; return val() }\n' }] },
    ],
    gold_criteria: {
      C1: { met: true, span: 'm1 m2' },
      C2: { met: true, span: 'split vs recursive descent' },
      C3: { met: false, span: null },
    },
  },
  {
    id: 'three-attempts-run-01',
    route: 'commit-history',
    case_type: 'two-real-strategies',
    must: 'pass',
    gold_verdict: 'unlocked',
    expect_prefilter: 'pass',
    commits: [
      { hash: 'n1', subject: 'map lookup', files: [{ path: 'src/idx.js', patch: '+const idx = new Map()\n' }] },
      { hash: 'n2', subject: 'array scan', files: [{ path: 'src/idx.js', patch: '-const idx = new Map()\n+const idx = []\n' }] },
      { hash: 'n3', subject: 'bst', files: [{ path: 'src/idx.js', patch: '-const idx = []\n+function Node(k,v){ this.k=k; this.v=v; this.l=null; this.r=null }\n' }] },
    ],
    gold_criteria: {
      C1: { met: true, span: 'n1 n2 n3' },
      C2: { met: true, span: 'Map vs array vs tree' },
      C3: { met: true, span: 'node --test after each' },
    },
  },
  {
    id: 'check-landed-01',
    route: 'check',
    case_type: 'checking-question',
    must: 'pass',
    gold_verdict: 'landed',
    gold_criteria: {
      Q1: { met: true, span: 'the heap compare sign was inverted' },
      Q2: { met: true, span: 'swap the subtract operands' },
    },
  },
  {
    id: 'check-partial-01',
    route: 'check',
    case_type: 'checking-question',
    must: 'fail',
    gold_verdict: 'partial',
    gold_criteria: {
      Q1: { met: true, span: 'FIFO means pop oldest' },
      Q2: { met: false, span: null },
    },
  },
  {
    id: 'check-not-landed-01',
    route: 'check',
    case_type: 'checking-question',
    must: 'fail',
    gold_verdict: 'not_landed',
    gold_criteria: {
      Q1: { met: false, span: null },
      Q2: { met: false, span: null },
    },
  },
  {
    id: 'check-conceptual-01',
    route: 'check',
    case_type: 'checking-question',
    must: 'fail',
    gold_verdict: 'not_landed',
    gold_criteria: {
      Q1: { met: false, span: null },
      Q2: { met: false, span: null },
    },
    gold_error_class: 'conceptual',
  },
];

export function requiredCoverage() {
  const types = new Set(ITEMS.map((i) => i.case_type));
  return {
    types,
    count: ITEMS.length,
  };
}
