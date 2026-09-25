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

Pure modules first, smallest dependency surface first:
`rubric` → `classify` → `policy` → `scope` → `fence` / `narration` /
`tripwire` → `prefilter` / `grader-parse` / `audit` / `report`.
The imperative shell (`state`, `control`, `gate`, `grader`, `git-evidence`)
comes last, and only after the pure core is ported.

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
  JSON round-trip, so keywords equal strings and vectors equal lists.
- One namespace: create its `.clj`, then `bb test` (its cases run; the rest skip).
  To add a module: copy a case file, point `js`/`bb` at it, add cases.
- Cases needing clock/env/fs must pass those as args (the pure core reads none).

## Purity rule

Core namespaces in `src/` may not require `babashka.fs`, `babashka.process`,
`clojure.java.io`, or read `System/getenv`. `bb lint` greps for this. Time,
env and I/O are passed in as arguments, exactly like `core/*.mjs`.

## Cutting over

A ported namespace replaces its JS twin only when: oracle cases agree, the
JS module's own `*.test.mjs` cases have been moved into oracle cases (or
ported as `clojure.test`), and the hook can call bb — that last step is a
separate, later change. Until then the `.mjs` stays authoritative and the
`.clj` is a shadow that must keep agreeing. On cutover, delete the JS module
and its test in the same PR that switches its caller.
