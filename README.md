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

**Tier** (you select it; default in a governed project is Tier 1):

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

This repo is a Claude Code plugin and doubles as its own single-plugin
marketplace.

```bash
# As a skills-dir plugin (drop-in, hooks included, no marketplace):
git clone https://github.com/PDepaula/no-deceipt ~/.claude/skills/no-deceit

# Or via the marketplace:
claude plugin marketplace add PDepaula/no-deceipt
claude plugin install no-deceit
```

Requires Node (for the `.mjs` policy core and hooks; zero external
dependencies). Put `bin/` on `PATH` if the Claude plugin did not already
(needed for `nd` and for Cursor's `nd --cursor` hook). Then, in a project
you want governed:

```bash
nd init        # opt this project in (creates .no-deceit/)
nd status      # show the current tier and mode (and any Coach/Pair suggestion)
nd report      # weekly-style ledger summary (default last 7 days)
nd tier 1      # or 2 / 3
nd mode coach  # or pair / ask
nd unlock      # grade .no-deceit/attempts/default.md
nd audit       # gold-set release gate (graded_up = 0)
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
/no-deceit:unlock
/no-deceit:unlock --override "deadline; I know the approach"
/no-deceit:check parser
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

**OpenCode** — point OpenCode at `adapters/opencode/no-deceit.ts` inside this
clone (symlink into `~/.config/opencode/plugins/`, or list the path in
`opencode.json` `plugin`). `tool.execute.before` imports the core and throws
on deny. See `docs/verification/opencode.md`.

**Pi** — symlink `adapters/pi/no-deceit.ts` to `~/.pi/agent/extensions/` (or
`.pi/extensions/` in a trusted project). `tool_call` imports the core and
returns `{block:true, reason}` on deny. See `docs/verification/pi.md`.

**Cursor** — copy `adapters/cursor/hooks.json` to `~/.cursor/hooks.json` (or
the project `.cursor/hooks.json`) and keep `nd` on `PATH`. `preToolUse` runs
`nd --cursor`, which prints Cursor's decision object on stdout (exit 0).
`failClosed` is on. See `docs/verification/cursor.md`.

Parity gaps, stated plainly: there is no blocking turn-end hook on OpenCode
or Cursor, so the Tier 3 narration / Tier 1 chat-fence check is not a hard
block there (it would only be a follow-up). `MessageDisplay` redaction exists
only in Claude Code. Cursor's `ask` is not enforced on `preToolUse`.

## Status

Phase 5: the earned-time loop. `nd report` reads the ledger the earlier phases
write; Coach/Pair suggestions are evidence-based and still the developer's
choice. firstmate `learn:` backlog-reserve tagging is out of scope (D8:
exemption only). See `NOTES.md` for open threads and `CHANGELOG.md` for what's
changed. The full design rationale lives in the scout report referenced from
`AGENTS.md`.

## License

MIT — see `LICENSE`.
