# No Deceit

A **plugin** that governs how much AI coding assistance you get, based on a
manually chosen tier — forcing a conscious, honest choice between optimizing
for **learning** and optimizing for **velocity**, instead of silently
defaulting into either one. Claude Code is the reference harness; OpenCode,
Pi, and Cursor get the same policy through thin adapters under `harness/`.

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
The unlock is project-wide for now; topics become session state in a later
phase. The data home is `ND_DATA_DIR`, else `$ND_HOME/data`, else
`~/.local/share/no-deceit`; you create `projects.{edn,json,md}` there (one entry
per project; `projects.md` is free text for the grader and carries no paths). Diagram parsing into a scene summary is a later step; until a
summary exists the grader reads the raw source and reports diagram-structure
signals as `unknown`.

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

## Install: a home repo, not a package

No Deceit is a **git checkout you keep and `git pull`** — the same shape as
firstmate. The checkout is your *home*: shared code and docs are tracked;
your personal material lives beside them in four gitignored directories.

```
no-deceit/                  the home. `git clone` once, `nd update` forever
├── core/ hooks/ bin/ harness/ skills/ agents/ gold/ docs/    tracked, shareable
├── projects/               GITIGNORED  governed projects (flat clones, each with its own .no-deceit/)
├── data/                   GITIGNORED  its own nested private git repo: curricula, refs, evidence,
│                                       verdicts, projects.edn (the manifest the grader checks P2 against)
├── state/                  GITIGNORED  ledger.jsonl, sessions, migrated-from-xdg (the one-shot XDG copy record)
└── config/                 GITIGNORED  config.json (overrides of the defaults)
```

**Why the split.** Curricula and evidence are the most valuable files here and
the only ones you write by hand, so `data/` is versioned (its own git repo;
add a *private* remote with `git -C data remote add origin …` if you want a
backup) but can never leak into the shareable tree. The ledger is the honesty
record, so it stays out of anything shareable too.

```bash
git clone https://github.com/PDepaula/no-deceit
cd no-deceit
bin/nd bootstrap --dry-run     # show what it would do
bin/nd bootstrap               # create the layout, link the harnesses
```

`nd bootstrap` creates `projects/ data/ state/ config/` (and `git init`s
`data/`), then links this checkout into each harness whose config dir exists
(or only those you name: `--claude --opencode --pi --cursor`). It never
overwrites a link or file it did not make, never edits your shell profile
(it prints the `PATH` line for `bin/`), and copies an older XDG ledger,
`config.json` and data tree (curricula, evidence, verdicts, project manifest)
into the home once, leaving the originals and never overwriting a file the
home already has. The migration is recorded in `state/`, so a later
`nd bootstrap` never brings back a file you deleted from the home.

| Harness | What bootstrap does | Enforcement |
| --- | --- | --- |
| **Claude Code** | `~/.claude/skills/no-deceit` → `harness/claude-code` (a skills-dir plugin: hooks, skill and grader agent load with no marketplace and no install step; `git pull` updates it in place) | Full: hooks + `MessageDisplay` redaction |
| **OpenCode** | `~/.config/opencode/plugins/no-deceit.ts` → `harness/opencode/no-deceit.ts` | `tool.execute.before` throws |
| **Pi** | `~/.pi/agent/extensions/no-deceit.ts` → `harness/pi/no-deceit.ts` | `tool_call` returns `{block:true}` |
| **Cursor** | merges a `preToolUse` entry into `~/.cursor/hooks.json` → `<home>/bin/nd --cursor` (absolute path; Cursor does not follow a plugin symlink) | `preToolUse` deny object |

Restart any running harness session after bootstrapping: hooks and skills are
read at launch.

**Already installed the old way?** If No Deceit came from the Claude Code
marketplace, or `~/.claude/skills/no-deceit` is already a link or directory
pointing somewhere else (an older clone), bootstrap stops with nothing changed,
whichever harness flags you pass: both copies would fire the hooks on every
call and keep separate state. Run the step it prints (`claude plugin uninstall
no-deceit`, or `mv ~/.claude/skills/no-deceit ~/no-deceit.old`, out of the
directory Claude Code scans), then `nd bootstrap` again. The same holds for
any harness link bootstrap would create: if `~/.config/opencode/plugins/no-deceit.ts`
or `~/.pi/agent/extensions/no-deceit.ts` already points elsewhere, or
`~/.cursor/hooks.json` is not valid JSON, bootstrap stops and prints the step.

Bootstrap does not look inside Pi's, OpenCode's or Cursor's own package
stores, so remove a package install yourself **before** running `nd bootstrap`,
or both copies load:

- Pi (`pi install git:github.com/PDepaula/no-deceit@<tag>`): `pi list` shows the
  exact source; remove it with `pi remove git:github.com/PDepaula/no-deceit@<tag>`
  (add `-l` if you installed it project-local).
- OpenCode (`opencode plugin no-deceit`, deprecated npm route): delete
  `"no-deceit"` from the `plugin` array in `~/.config/opencode/opencode.json`
  (or the project's `.opencode/opencode.json`), then use `nd bootstrap --opencode`.
- Cursor (plugin marketplace): uninstall the No Deceit plugin in Cursor (Settings → Plugins → No Deceit →
  Uninstall), then drop the marketplace with
  `cursor-agent plugin marketplace remove github.com/PDepaula/no-deceit`,
  then use `nd bootstrap --cursor`.

**Marketplace, Pi and Cursor package routes still work** for people who just
want the gate without a home: `claude plugin marketplace add PDepaula/no-deceit`,
`pi install git:github.com/PDepaula/no-deceit@<tag>`, and Cursor's plugin
marketplace (the root `.claude-plugin/`, `package.json` `pi` key and
`.cursor-plugin/` manifests point into `harness/`). Those installs live in a
harness cache, not a home: no `nd update`, no `data/` layout beyond the XDG
fallback.

### Governed projects and updating

```bash
nd project add https://github.com/you/app --summary "one-line domain summary"
nd project add ~/code/existing-app --name app   # adopt a local dir in place (never moved)
cd projects/app                                   # start your harness here, book open beside it
```

`nd project add` clones a remote into `projects/<name>` (a local directory is
governed where it is; a subdirectory of a git repo is refused, run it on the repo's top level), adds it to the project manifest the grader checks P2
against (the existing `projects.edn` or `projects.json` in the data home, which
honors `ND_DATA_DIR`; else a new `data/projects.edn`), and opts it in (`nd init`, Tier 2). Projects keep
their own remotes; No Deceit does not touch delivery.

**Known issue:** Claude Code reads `CLAUDE.md` from every parent directory, so a
session in `<home>/projects/<app>` also loads this home's own `CLAUDE.md` /
`AGENTS.md` (No Deceit's developer memory, not instructions for your project).
A fix is pending a design decision.

```bash
nd update    # fetch, fast-forward only, print the release notes since your last update
```

`nd update` never merges, stashes, resets or forces, and never touches
`projects/ data/ state/ config/`. It refuses if your checkout has diverged.
After a successful update it prints the new `docs/releases/` entries in order,
then `reread: yes|no` (`AGENTS.md`/`skills/`/`agents/`, a `hooks.json`, or
`core/`/`harness/` changed: a running session read them at launch, restart the
harness) and `rebootstrap: yes|no` (a harness
entry file was added, removed or renamed: run `nd bootstrap` again). Each
release note says what changed, why, and what you should notice.

### Everyday commands

Put `bin/` on `PATH` (bootstrap prints the line). Then, in a governed project:

```bash
nd init        # opt a project in by hand (creates .no-deceit/)
nd status      # show the current tier and mode (and any Coach/Pair suggestion)
nd report      # weekly-style ledger summary (default last 7 days)
nd tier 1      # or 2 / 3
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

The teaching `SKILL.md` is portable (OpenCode, Cursor and Pi all read Agent
Skills). The *enforcing* half is the same core (`core/*.mjs`) behind a thin
adapter per harness under `harness/` — not a rules-file wrapper, which would be
advisory and reproduce the gap this plugin closes. Each has a verification
record in `docs/verification/<harness>.md`, and `harness/README.md` has the
parity table.

Parity gaps, stated plainly: there is no blocking turn-end hook on OpenCode
or Cursor, so the Tier 3 narration / Tier 1 chat-fence check is not a hard
block there. `MessageDisplay` redaction exists only in Claude Code. Cursor's
`ask` is not enforced on `preToolUse`. The OpenCode adapter has a known
cwd-resolution gap for a governed project that is not itself a git repository
(issue #7). Diagram-file denial is a `PreToolUse` decision, so it is a hard
block everywhere.

## Project docs

- `docs/releases/` — one file per tag: what changed, why, what you should notice.
- `docs/decisions/` — the settled product calls (D1–D8, R1–R8) and where later
  decisions reversed earlier ones.
- `docs/verification/<harness>.md` — what was actually verified per harness.
- `PORTING.md` — the incremental Babashka port (done by hand, as Clojure practice).
- *Later:* a tracked `curricula-public/<topic>/` for curricula built only from
  public material you want to share; not built yet. Everything under `data/`
  stays private.

## Status

Home-repo layout, bootstrap and update have landed (still Node; the language
port is incremental and invisible to users). The npm package is deprecated in
favour of this git install. See `NOTES.md` for open threads, `CHANGELOG.md` for
the index of changes, and `AGENTS.md` for the design authority.

## License

MIT — see `LICENSE`.
