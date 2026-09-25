# Porting core to Babashka (captain-driven, incremental)

Scaffold only. Nothing here is ported; each namespace is written by hand as
Clojure practice. The JS suite in `core/*.test.mjs` stays the source of truth
until a namespace is explicitly cut over. Hooks still call Node.

## Setup

`mise install` (pins `babashka` in `mise.toml`), then `bb test` and `bb lint`.
With zero namespaces ported both pass; unported modules print `skip`.
There is no CI workflow in this repo, so nothing needs bb network access. If
one is added, keep `bb test` a separate, optional step and never a gate for
the Node suite.

## Order

Written step by step as Clojure practice; each step is pure, takes its
oracle cases from the JS twin, and teaches one new Clojure idea. Namespaces
are `no-deceit.<name>` as in Layout.

1. `scope` — maps, `some`, destructuring.
2. `policy` (`decide`) — `case`/`cond`, keyword vs string data, tables in EDN.
3. `narration`, `fence` — strings, regex, `loop/recur` over lines.
4. `classify` — data-driven rules, the big table, "most-restrictive wins" as `reduce`.
5. `tripwire`, `prefilter` — sequences, set ops.
6. `rubric`, `grader-parse`, `report`, `audit` — reduce/group-by, aggregation, the mechanical verdict.
7. The new evidence parsers (Excalidraw + its LZ-string decode, Mermaid, mind map)
   are new code, written straight in Babashka with no JS twin to port.
8. The imperative shell (`state`, `control`, `gate`, `grader`, `git-evidence`)
   comes last — that is where the hook flips from node to bb.

Steps 1–3 are small enough to give a first green `bb test` in an afternoon;
step 4 is the meatiest table.

The only seeded oracle case files today, `classify.json` and `rubric.json`, are
worked examples of the fixture format, not the places to start. Step 1 starts
by creating `oracle/cases/scope.json`.

## Layout

`src/no_deceit/<name>.clj` holds ns `no-deceit.<name>` (Clojure maps `-` in
the ns to `_` in the path; a `no-deceit/` directory would not load).
Tests go in `test/no_deceit/`.

## Oracle: same cases as the JS twin

`oracle/cases/<module>.json` is the shared fixture:

```json
{"module": "rubric",
 "js": {"file": "core/rubric.mjs", "fn": "mentalPass"},
 "bb": {"ns": "no-deceit.rubric", "fn": "mental-pass"},
 "cases": [{"name": "...", "args": [ ... ], "expect": ... }]}
```

- JS side: `node --test oracle/oracle.test.mjs` proves each `expect` against the
  Node module. Add cases there first; the JS module defines truth.
- bb side: `bb test` requires `no-deceit.<module>` only when
  `src/no_deceit/<module>.clj` exists, applies `fn` to `args` (JSON parsed
  with keyword keys), and compares to `expect`. Both sides are compared after a
  JSON round-trip, so keywords equal strings, vectors equal lists, and a whole
  double (`2.0`) equals an integer (`2`) as it does in JS. A ported `.clj` that
  fails to load or lacks `fn` fails its module; other modules still run.
- One namespace: create its `.clj`, then `bb test` (its cases run; the rest skip).
  To add a module: copy a case file, point `js`/`bb` at it, add cases.
- Cases needing clock/env/fs must pass those as args (the pure core reads none).

## Purity rule

Core namespaces in `src/` may only require `clojure.string`, `clojure.set`,
`clojure.walk`, `clojure.edn` and other `no-deceit.*` namespaces, may not
`:import`, and may not call `slurp`/`spit`/`System/*`/Java classes. `bb lint`
reads the forms (comments, docstrings and top-level `(comment ...)` blocks
don't count) and fails on any of these. Time, env and I/O are passed in as
arguments, exactly like `core/*.mjs`.

## Cutting over

A ported namespace replaces its JS twin only when: oracle cases agree, the
JS module's own `*.test.mjs` cases have been moved into oracle cases (or
ported as `clojure.test`), and the hook can call bb — that last step is a
separate, later change. Until then the `.mjs` stays authoritative and the
`.clj` is a shadow that must keep agreeing. On cutover, delete the JS module
and its test in the same PR that switches its caller.
