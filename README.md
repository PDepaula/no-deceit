# No Deceit

A **plugin** that governs how much AI coding assistance you get, based on a
manually chosen tier — forcing a conscious, honest choice between optimizing
for **learning** and optimizing for **velocity**, instead of silently
defaulting into either one. Claude Code is the reference harness; OpenCode,
Pi, and Cursor get the same policy through thin adapters.

The difference from a plain skill: a skill can only *advise*, and the agent can
read the advice and keep going. No Deceit ships as one plugin where **hooks
are the enforcement** (`PreToolUse` can hard-deny a tool call, even under
`--dangerously-skip-permissions`; `Stop` blocks a turn that leaks a solution
as chat text; `MessageDisplay` redacts it on screen in Claude Code) and a
bundled **skill is the teacher**. The hook blocks; the skill explains why and
what to do instead. Other harnesses call the same core: OpenCode throws from
`tool.execute.before`, Pi returns `{block:true}` from `tool_call`, Cursor
runs `nd --cursor` and reads the stdout decision object.

## Why this exists

The danger of AI coding assistance isn't that it makes you less capable. It's
that it lets you *feel* productive while quietly hollowing out the understanding
you'll need later. Programming knowledge is procedural, not just theoretical —
it's a habit, not a fact you can recognize on a multiple-choice test. The real
test of whether you know something is what you can produce facing a blank file.
That's Bloom's highest level: **create**. Every mechanism here exists to protect
that ability, even when it's slower in the moment.

## How it works

Two independent axes.

**Tier** (you select it; default in a governed project is Tier 2, locked;
projects initialised before that default keep their stored tier, and
`nd tier 2` moves them):

- **Tier 1 — Tutor.** No working code, ever. The hook denies `Write`/`Edit`/
  `NotebookEdit` and code-writing shell commands, and a `Stop` hook blocks a
  turn that dumps a worked solution as fenced chat text above a small snippet
  threshold. On Claude Code, `MessageDisplay` redacts that code on screen. The
  agent responds with Socratic questions that redirect you back to the problem.
  For a *topic*, `nd tier 1 --topic <t>` (or `/no-deceit:tier 1 <t>`) makes it
  curriculum-bound: it succeeds only when the topic has a curriculum (below), and
  the tutor then never reveals a concept before you have attempted it.
- **Tier 2 — Guided.** Unlocks once you show real engagement. Write your mental
  model to `.no-deceit/attempts/<task>.md` (or keep a commit history of
  meaningfully different attempts) and run `nd unlock`. A **blind grader** in a
  fresh process — never the tutor — judges genuineness of engagement, not
  correctness. You can still `nd unlock --override "<reason>"` (ledgered) or
  escalate to Tier 3; one appeal per verdict. Even unlocked, the agent has no
  write path: it may explain and show a worked solution in chat, and **you
  type the implementation** — no copy-paste.
- **Tier 3 — Narrated Velocity.** Invoked explicitly, for real deadline
  pressure, and it **expires** (a time box) then falls back. Requires a
  non-trivial `.no-deceit/t3/preamble.md` — a high-level view and your own naive
  first instinct — before any source is written. Then the agent moves fast with
  full tooling but must narrate (a what/why section plus
  `Divergence from your first instinct:`, format-checked) and flag divergence
  from your approach. Subagents require confirmation.

**Diagrams and handovers** (Tier 1 and locked Tier 2): drawing the diagram is
the learning, so writing Mermaid / Excalidraw / mind-map / other diagram
sources, or running a diagram renderer (`mmdc`, `d2`, `dot`, `plantuml`,
`excalidraw-cli`) even on your own file, is denied (category H) — at Tier 2
even when unlocked, where a diagram may be shown in chat and you redraw it —
and a diagram fence in chat
is blocked at any size on the gated tiers. Every turn there must end with a
question or carry a `Handing over: <what>` line (a short turn under ~40 words
passes). Type `/no-deceit:handover [--domain d] [why]` to ask for the answer:
the hook ledgers it and relaxes those rules for one turn, and `nd report`
counts handovers per domain.

**Teach-backs and the transfer grade.** To show you have a *principle*, type
`/no-deceit:teach <topic> --project <p>` and explain it on the following lines
of the same prompt: the mechanism in your words, where it lands in one of your
projects, and what you would do and why. The hook writes it (with a hash) under
the data home (`evidence/<topic>/`), ledgers `evidence_captured`, and blocks the
prompt, so the tutor never receives it in conversation (the tutor is told not
to read evidence files; the hook denies writes and shell commands in the data
home but does not block reads). Diagrams (a Mermaid
fence, Excalidraw JSON, a markdown mind map) are captured raw; `nd evidence add
<topic> <file>` does the same for `.mmd`, `.mermaid`, `.excalidraw`,
`.excalidraw.md` and note files. `/no-deceit:grade` (or `nd grade`) runs the
blind grader against a fixed rubric (P1–P5: mechanism, a real project *from
your project manifest* and a concrete locus, change and cost, a falsifiable
judgment, a boundary; pass = P1 ∧ P2 ∧ P4 ∧ (P3 ∨ P5)). Correctness is not a
criterion: a wrong-but-specific transfer passes and its wrongness is coached.
A pass unlocks Tier 2 for the project the evidence names (its `--project`), not
the repo you run the command in: that project must be listed with a `path` to
its governed repo in `projects.edn` (`[{:name "gd-integrations" :path
"/abs/or/relative/to/data" :summary "…"}]`) or `projects.json` (the same fields
as an array of objects). Otherwise the pass is recorded and nothing unlocks.
With an active topic (`nd tier <1|2> --topic <t>`) the Tier 2 unlock is per
topic: a pass for one topic does not open another. With no active topic the
unlock stays project-wide, as before. The data home is `ND_DATA_DIR`, else `$ND_HOME/data`, else
`~/.local/share/no-deceit`; you create `projects.{edn,json,md}` there (one entry
per project; `projects.md` is free text for the grader and carries no paths). Diagram parsing into a scene summary is a later step; until a
summary exists the grader reads the raw source and reports diagram-structure
signals as `unknown`.

**Curricula and Tier 1.** A curriculum is two files under the data home,
`curricula/<topic>/open.md` (yours: mission, sources with sections and access,
reading sessions, one flat alphabetical keyword list with no grouping,
emphasis or definitions, so *you* do the grouping) and `sealed.md` (the tutor's
and grader's: concept map, one testable claim per concept, traps, transfer
prompts with their criteria). `nd curriculum build <topic> --goal "<what you
must be able to do>" --mission "<why>" --from <path|url> …` has a scout agent
(a fresh `claude -p`, never the tutor) draft both from sources you supply,
working backward from your goal; write them by hand instead if you prefer. Review
only the mission, sources and outline (`nd curriculum review <topic>`) so the
topic is not spoiled, then `nd curriculum reviewed <topic>`; `reviewed:` is
advisory and Tier 1 never requires it. The tutor may read `sealed.md` but is told
never to quote or recite it (instruction plus the offline audit, not a read
block). Format and keyword rules: `docs/curriculum-format.md`.

**Domain mode** (crosses all tiers): **Coach** for domains you don't have solid
footing in (the agent corrects your mental model with reasoning, from named
lenses), **Pair** for domains you're competent in (fast, concise, catching
slips). The mode is still yours to set (`nd mode`); `nd report` and `nd status`
may *suggest* Coach or Pair from the ledger's per-domain `error_class` trend
(repeated conceptual ⇒ Coach; mostly slip ⇒ Pair) without switching it.

**Always allowed at every tier**, because gating them adds cost without adding
learning:

- **Interactive development** — REPL, notebook, hot reload, print debugging, and
  **running your code, tests, and linters**. The feedback loop is never blocked.
- **Test scaffolding** (structure, not logic/assertions) on request.
- **Tooling and environment setup** (build config, dependency management, build
  errors).

**You can never be tricked, and neither can the agent.** The tier lives on disk,
outside the conversation. The agent cannot change its own tier: changes come
only from your own `/no-deceit:` prompt commands (handled inside the hook, from
your literal text) or your own `nd` shell CLI. Every tier change, override, and
denial is written to an append-only ledger.

## Install

Each harness gets No Deceit through its own native install channel — one
plugin, four adapters, same policy core. All of them require Node (for the
`.mjs` policy core; zero external dependencies).

| Harness | Native install | Notes |
| --- | --- | --- |
| **Claude Code** | `claude plugin marketplace add PDepaula/no-deceit`<br>`claude plugin install no-deceit` | This repo is its own single-plugin marketplace (`.claude-plugin/`). Reference harness — full enforcement (hooks + `MessageDisplay` redaction). |
| **Pi** | `pi install git:github.com/PDepaula/no-deceit@<tag>` | Package manifest (`package.json`'s `pi` key) registers the extension + skill; discoverable at [pi.dev/packages](https://pi.dev/packages) via the `pi-package` keyword once submitted (a captain step). See `docs/verification/pi.md`. |
| **OpenCode** | `opencode plugin no-deceit` | Requires the package to be published to npm first (below) — a captain step. See `docs/verification/opencode.md`. |
| **Cursor** | `cursor-agent plugin marketplace add github.com/PDepaula/no-deceit`, then `/plugins` → install `no-deceit` | Same repo-as-marketplace as Claude Code, via a Cursor-specific `.cursor-plugin/` manifest so the hook wiring (not just the metadata) actually enforces. See `docs/verification/cursor.md`. |

Fallback for any harness (no marketplace/registry involved, works today):

```bash
git clone https://github.com/PDepaula/no-deceit ~/.claude/skills/no-deceit
```

then point the harness at the files inside that clone — see the per-harness
section under "Other harnesses" below.

### Publish step (captain-run; not part of this repo's CI)

OpenCode's native install needs an npm-published package first. The name
`no-deceit` was free on npm as of 2026-09-18 (`npm view no-deceit` → 404).
From a clean checkout, logged in as the account that will own the package:

```bash
npm login                 # once, interactively
npm publish               # from the repo root; publishes what `npm pack` would produce
```

If the name is taken by the time you publish, use the scoped name
`@pdepaula/no-deceit` instead (`npm publish --access public`) and update the
OpenCode row above accordingly. Verify what will ship first with
`npm pack --dry-run` (should list `core/`, `adapters/`, `bin/`, `skills/`,
`agents/`, `gold/`, `hooks/`, `docs/config.example.json`, no `*.test.mjs`).

Put `bin/` on `PATH` if your install path did not already (needed for `nd`
and for Cursor's `nd --cursor` hook). Then, in a project you want governed:

```bash
nd init        # opt this project in (creates .no-deceit/)
nd status      # show the current tier and mode (and any Coach/Pair suggestion)
nd report      # weekly-style ledger summary (default last 7 days)
nd tier 1      # or 2 / 3; `nd tier 1 --topic <t>` needs a curriculum
nd mode coach  # or pair / ask
nd unlock      # grade .no-deceit/attempts/default.md
nd evidence add <topic> <file>   # capture a note or diagram as evidence
nd grade [topic]                 # blind transfer grade of the newest evidence
nd audit       # both gold sets' release gate (graded_up = 0)
nd doctor --grader-probe  # check the grader can log in (subscription or ANTHROPIC_API_KEY)
```

Only projects with a `.no-deceit/` directory are governed — every other repo is
untouched. Worker/headless sessions (e.g. a firstmate crewmate, marked by
`FM_TASK_ID`) are exempt so the gate never wedges an automated fleet. Those
exempt sessions are ledgered once as **Delegated** (a lane, not a tier; no
learning claimed) so `nd report` can name them honestly.

`nd report` is the earned-time loop: a weekly-style summary from the ledger
(time in Tier 1/2 vs Tier 3, unlocks and checking questions landed vs not,
Coach-domain misconceptions, Delegated sessions). Default window is 7 days;
pass `--since` / `--until` as an ISO date or a relative duration (`7d`, `24h`,
`30m`, `1w`). Empty ledgers print a short "nothing to summarise" note.

Control it from the chat prompt, too — these are handled inside the hook, so the
agent never sees them as something it can forge:

```
/no-deceit:status
/no-deceit:tier 2
/no-deceit:mode coach
/no-deceit:handover --domain data-modeling stuck on where the join goes
/no-deceit:unlock
/no-deceit:unlock --override "deadline; I know the approach"
/no-deceit:check parser
/no-deceit:teach etl-vs-client-server --project gd-integrations
<your explanation on the following lines>
/no-deceit:grade
```

Coach mode reasons from a small set of named, citable lenses (Rich Hickey's
simple-vs-easy, Grokking Simplicity's actions/calculations/data, Bernhardt's
functional-core/imperative-shell, CodeScene's code-health smells, and
state-minimization heuristics from the Clojure community). See
`skills/no-deceit/SKILL.md` for the full writeup and citations.

## Other harnesses

The teaching `SKILL.md` is already portable (OpenCode, Cursor, and Pi all
read Agent Skills; several of them from `~/.claude/skills/`). The *enforcing*
half is the same pure core (`core/*.mjs`) behind a thin adapter per harness —
not a rules-file wrapper, which would be advisory and reproduce the gap this
plugin closes. No firstmate install is required.

**OpenCode** — native: `opencode plugin no-deceit` once published to npm (see
"Publish step" above). Manual fallback: point OpenCode at
`adapters/opencode/no-deceit.ts` inside a clone (symlink into
`~/.config/opencode/plugins/`, or list the path in `opencode.json`
`plugin`). `tool.execute.before` imports the core and throws on deny. See
`docs/verification/opencode.md`.

**Pi** — native: `pi install git:github.com/PDepaula/no-deceit@<tag>` (the
`pi` manifest in `package.json` registers the extension and skill). Manual
fallback: symlink `adapters/pi/no-deceit.ts` to `~/.pi/agent/extensions/`
(or `.pi/extensions/` in a trusted project). `tool_call` imports the core
and returns `{block:true, reason}` on deny. See `docs/verification/pi.md`.

**Cursor** — native: `cursor-agent plugin marketplace add
github.com/PDepaula/no-deceit`, then install `no-deceit` from `/plugins`
(this repo's `.cursor-plugin/plugin.json` points Cursor at the
Cursor-shaped `adapters/cursor/hooks.json`, since Cursor's convention-based
hook discovery would otherwise pick up Claude Code's differently-shaped
`hooks/hooks.json`). Manual fallback: copy `adapters/cursor/hooks.json` to
`~/.cursor/hooks.json` (or the project `.cursor/hooks.json`) and keep `nd`
on `PATH`. `preToolUse` runs `nd --cursor`, which prints Cursor's decision
object on stdout (exit 0). `failClosed` is on. See
`docs/verification/cursor.md`.

Parity gaps, stated plainly: there is no blocking turn-end hook on OpenCode
or Cursor, so the Tier 3 narration / Tier 1 chat-fence check is not a hard
block there (it would only be a follow-up). `MessageDisplay` redaction exists
only in Claude Code. Cursor's `ask` is not enforced on `preToolUse`. The
OpenCode adapter also has a known cwd-resolution gap for a governed project
that is not itself a git repository — see `docs/verification/opencode.md`.

## Status

Phase 6: native distribution on all four harnesses (this README's install
matrix, the `pi`/`.cursor-plugin` manifests, and the npm packaging — publish
itself is a captain step, see above). Phase 5 (the earned-time loop) is done:
`nd report` reads the ledger the earlier phases write; Coach/Pair suggestions
are evidence-based and still the developer's choice. firstmate `learn:`
backlog-reserve tagging is out of scope (D8: exemption only). See `NOTES.md`
for open threads and `CHANGELOG.md` for what's changed. The full design
rationale lives in the scout report referenced from `AGENTS.md`.

## License

MIT — see `LICENSE`.
