# No Deceit

A Claude Code **plugin** that governs how much AI coding assistance you get,
based on a manually chosen tier — forcing a conscious, honest choice between
optimizing for **learning** and optimizing for **velocity**, instead of
silently defaulting into either one.

The difference from a plain skill: a skill can only *advise*, and the agent can
read the advice and keep going. No Deceit ships as one plugin where a
`PreToolUse` **hook is the enforcement** (it can hard-deny a tool call, even
under `--dangerously-skip-permissions`) and a bundled **skill is the teacher**.
The hook blocks; the skill explains why and what to do instead.

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
  `NotebookEdit` and code-writing shell commands; the agent responds with
  Socratic questions that redirect you back to the problem.
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
  full tooling but must narrate its reasoning and flag divergence from your
  approach.

**Domain mode** (crosses all tiers): **Coach** for domains you don't have solid
footing in (the agent corrects your mental model with reasoning, from named
lenses), **Pair** for domains you're competent in (fast, concise, catching
slips).

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
dependencies). Then, in a project you want governed:

```bash
nd init        # opt this project in (creates .no-deceit/)
nd status      # show the current tier and mode
nd tier 1      # or 2 / 3
nd mode coach  # or pair / ask
nd unlock      # grade .no-deceit/attempts/default.md
nd audit       # gold-set release gate (graded_up = 0)
```

Only projects with a `.no-deceit/` directory are governed — every other repo is
untouched. Worker/headless sessions (e.g. a firstmate crewmate, marked by
`FM_TASK_ID`) are exempt so the gate never wedges an automated fleet.

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

The advisory half is already portable: OpenCode and Cursor both read `SKILL.md`
natively (Cursor also reads from `~/.claude/skills/`), so the teaching layer
works there today. The *enforcing* half — a real pre-tool deny — exists in
OpenCode (`tool.execute.before`), Cursor (`.cursor/hooks.json`), and Pi
(`tool_call`), but each has a different shape and failure direction, so thin
per-harness adapters over the shared policy core are a later phase (not the
earlier README's "you'll want a rules-file wrapper" — a rules file is advisory
and would reproduce the exact gap this plugin closes). The policy core
(`core/*.mjs`) is pure and dependency-free precisely so those adapters can
import it unchanged.

## Status

Phase 2: the enforcing gate for Claude Code plus the blind Tier 2 engagement
grader. Later phases add chat-text policing, the other harness adapters, and
an earned-time reporting loop. See `NOTES.md` for open threads and
`CHANGELOG.md` for what's changed. The full design rationale lives in the
scout report referenced from `AGENTS.md`.

## License

MIT — see `LICENSE`.
