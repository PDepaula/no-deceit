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
   The contract you implement is in "Step 7: evidence parser contract" below.
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

## Step 7: evidence parser contract

Node captures diagrams **raw** and never parses them (`core/evidence.mjs`,
`core/evidence-io.mjs`). You write three pure namespaces in Babashka, each with
one function `(parse text)`: raw file text in, summary map out (no I/O; the
purity rule applies).

| Namespace | Input | Output `:kind` |
| --- | --- | --- |
| `no-deceit.evidence.excalidraw` | `.excalidraw` / clipboard `.json` / Obsidian `.excalidraw.md` text | `"excalidraw"` |
| `no-deceit.evidence.mermaid` | `.mmd` / `.mermaid` text | `"mermaid"` |
| `no-deceit.evidence.mindmap` | markdown outline text | `"mindmap-text"` |

**Fixtures.** `fixtures/evidence/cases.json` lists input/expected pairs
(`fixtures/evidence/<parser>/<case>.<ext>` and `<case>.summary.json`). `bb test`
runs each case whose namespace file exists and prints `fixtures: skip` for the
rest, like the oracle. `core/evidence-fixtures.test.mjs` (Node) only checks the
fixtures are well-formed. Cases: unbound arrow, deleted elements, clipboard
paste, Obsidian `.excalidraw.md`, a mind map with cross-links, a Mermaid
flowchart with subgraphs. Not yet covered (add real samples when you have them):
Obsidian `compressed-json` (LZ-string `decompressFromBase64` of the block, then
the same as plain), frames, `freedraw`/`image` counts, `erDiagram` / `classDiagram`
/ `C4Context`.

**Summary JSON.** Keys are exactly as below (snake_case). Both sides are
compared after a JSON round-trip, so keywords equal strings and `0.0` equals `0`.
Report §2.1/§2.4 sketches this in EDN; the JSON here is what is on disk.

Excalidraw (`§2.4`):

```json
{"kind": "excalidraw",
 "nodes":  [{"id": "r1", "label": "orders table", "shape": "rectangle",
             "group": null, "frame": null, "emphasis": 1}],
 "edges":  [{"from": "r1", "to": "r2", "label": "nightly ETL",
             "directed": true, "via": "binding"}],
 "groups": {"g1": ["e1", "e2"]},
 "frames": {"f1": {"label": "current", "members": ["r1"]}},
 "loose_text": ["free-standing text"],
 "clusters": 3, "freedraw": 0, "images": 0, "emphasis_variance": 0.22}
```

Rules:

- Drop every element with `isDeleted: true` (a deleted shape's bound text and
  arrows are dropped too). A clipboard paste has `type: "excalidraw/clipboard"`
  and no `appState`; the elements are the same. Obsidian `.excalidraw.md`: take
  the block under `## Drawing` (a `json` fence is plain; `compressed-json` needs
  LZ-string decoding) and continue as above.
- **Node**: a non-deleted `rectangle`, `ellipse` or `diamond`. `label` = the
  `text` of the text element whose `containerId` is the node (joined by
  `"\n"` if several), else `null`. `shape` is the element `type`.
  `group` = the last (outermost) entry of `groupIds`, else `null`; `frame` = the
  element's `frameId`. `emphasis` = `1` + `1` if `strokeWidth >= 4` + `1` if
  `backgroundColor` is neither `"transparent"` nor `""` + `1` if the label's
  `fontSize >= 28`.
- **Edge**: a non-deleted `arrow`; `directed` = `startArrowhead` or
  `endArrowhead` is non-null; `from`/`to` are the arrow's start/end (never
  swapped). `label` = the text whose `containerId` is the arrow, else `null`.
  An end with a `startBinding`/`endBinding.elementId` naming a live node uses it
  (`via: "binding"` when both ends were bound). An **unbound** end is resolved by
  proximity (`via: "proximity"`): the end point is `(x + px, y + py)` of the
  first / last entry of `points`; the nearest node whose bounding box is within
  30 px (0 when inside; ties go to the earlier element) wins. No node in range
  gives `null` for that end.
- `groups`: group id → ids of its member **nodes**. `frames`: `frame` element id
  → `{label: <its name>, members: [node ids with that frameId]}`.
- `loose_text`: non-deleted `text` elements with no `containerId`, in element
  order. `freedraw` / `images`: counts of non-deleted `freedraw` / `image`.
- `clusters`: the number of groups plus frames when any exist; otherwise the
  number of connected components of nodes, joining two nodes whose bounding boxes
  are within 30 px of each other.
- `emphasis_variance`: population variance of the nodes' `emphasis`, rounded to
  2 decimals (`0` with fewer than two nodes).

Mermaid flowchart (`flowchart` / `graph`):

```json
{"kind": "mermaid", "diagram_type": "flowchart",
 "nodes": [{"id": "D", "label": "finance dashboard", "subgraph": "gd"}],
 "edges": [{"from": "P1", "to": "D", "label": "apply: read all day", "directed": true}],
 "subgraphs": {"gd": {"label": "gd-integrations", "members": ["D", "E"], "parent": null}}}
```

- Nodes in order of first appearance (definition or edge). `label` from the
  first occurrence that has one (`id[Label]`, `id(Label)`, `id{Label}`,
  `id[(Label)]`, `id((Label))`, optional quotes stripped), else the id.
  `subgraph` = the innermost enclosing subgraph id, else `null`.
- Edges in source order; a chain `A --> B --> C` is two edges. `-->`, `-.->`
  and `==>` are directed, `---` is not. `-->|text|` and `-- text -->` give
  `label`, else `null`. `%%` comment lines are ignored.
- `subgraphs`: id → `{label, members, parent}`; `members` are the nodes declared
  directly inside (not nested ones); `parent` is the enclosing subgraph id.
  `subgraph id["Label"]`, `subgraph id [Label]`, or `subgraph Label` (id = label).
- `mindmap` diagrams (no fixture yet): `{"kind":"mermaid","diagram_type":"mindmap",
  "nodes":[{"id":"n1","label":...,"depth":0,"parent":null}],"edges":[]}`; tree only,
  ids `n1..` in source order, labels from inside `root((..))` / plain lines.
- Any other diagram type: `{"kind":"mermaid","diagram_type":"<first word>","parsed":false}`.

Mind map text:

```json
{"kind": "mindmap-text",
 "nodes": [{"id": "n2", "label": "ETL time", "depth": 1, "parent": "n1"}],
 "cross_links": [{"from": "n2", "to": "n10", "label": "because ...", "directed": true}],
 "unresolved_links": 1}
```

- Ignore blank and `#` heading lines. A list item is `-`, `*` or `+`; a tab
  counts as two spaces; `parent` is the nearest earlier item with strictly
  smaller indentation (`depth` counts levels, top level is 0).
- A list item containing an arrow (`<->`, `↔`, `->`, `→`; the arrow that starts
  earliest wins, `<->` before `->`) with text on both sides is a **link line**,
  not a node: `left ARROW right [: label]`. Both sides are matched, trimmed and
  case-insensitively, to node labels (a `[[..]]` wrapper is stripped). Resolved:
  `cross_links` in source order (`directed` false only for `<->`/`↔`);
  either side unmatched: counted in `unresolved_links`, not emitted. A node line
  that is exactly `[[Label]]` is a node labelled `Label`.
- Fewer than 3 nodes: `{"kind":"mindmap-text","parsed":false}` (treated as text).

**Envelope and the seam.** A parser's output is one diagram. The file the grader
reads is an envelope written next to the evidence file:
`<evidence file>.summary.json` (`summaryPathFor` in `core/evidence.mjs`),

```json
{"version": 1, "diagrams": [ <summary>, <summary> ]}
```

one entry per diagram in the evidence file (a teach-back can hold a Mermaid fence
and Excalidraw JSON; find fences in markdown, take the whole file for `.mmd` /
`.excalidraw`). Nothing calls your parsers yet. When `bin/nd` or the hook can
call `bb`, writing this envelope right after `evidence_captured` is the only
change: `runGrade` (`core/grader.mjs`) already passes the file to the grader as
the job's `summaryPath` when it exists, and the transfer pre-filter and the
grader's G1–G5 field use it. Until then `summaryPath` is absent, the grader
reads the raw source, and every G is `unknown`; nothing fails for a missing
summary.
