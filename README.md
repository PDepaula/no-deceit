# No Deceit

A Claude Code / OpenCode skill that governs how much AI coding assistance
you get, based on a manually chosen tier — forcing a conscious, honest
choice between optimizing for **learning** and optimizing for **velocity**,
instead of silently defaulting into either one.

## Why this exists

The danger of AI coding assistance isn't that it makes you less capable.
It's that it lets you *feel* productive while quietly hollowing out the
understanding you'll need later. Programming knowledge is procedural, not
just theoretical — it's a habit, not a fact you can recognize on a
multiple-choice test. The real test of whether you know something is what
you can produce facing a blank file, with nothing to lean on. That's
Bloom's highest level of learning: **create**, not just remember,
understand, apply, analyze, or evaluate.

Every mechanism in this skill exists to protect that ability, even when
it's slower in the moment.

## How it works

The skill has two independent axes:

**Tier** (you select manually; default is Tier 1):
- **Tier 1 — Tutor Mode.** No working code, ever. The agent responds with
  Socratic questions that redirect you back to the problem.
- **Tier 2 — Guided Mode.** Unlocks once you show real engagement — either
  a commit history of meaningfully different attempts, or your own
  articulated mental model of what's going wrong. The agent can then
  explain and show a worked solution, but you type the implementation
  yourself. No copy-paste.
- **Tier 3 — Narrated Velocity Mode.** Invoked explicitly, for real
  deadline pressure. Requires you to give a high-level view of the problem
  and your own naive first-instinct approach *before* any code gets
  written. The agent then moves fast with full agentic tooling, but must
  narrate its reasoning and flag any divergence from your original
  approach.

**Domain mode** (crosses all tiers):
- **Coach mode** — for domains you don't have solid footing in yet. The
  agent acts like a senior engineer correcting your mental model, always
  with reasoning, not just assertion.
- **Pair mode** — for domains you're already competent in. The agent acts
  like a roughly-equal pair programmer: fast, concise, catching mistakes.

Three cross-tier exceptions apply at every tier, including Tier 1, because
gating them the same way as core logic adds cost without adding learning:
- **Test scaffolding** (structure only, not logic/assertions) on request.
- **Tooling and environment setup** (build config, dependency management,
  build errors) — one genuine attempt, then direct help.
- **Interactive development** (REPL, notebook, hot reload, print-statement
  debugging) is always encouraged — tightening the feedback loop isn't the
  same as giving you the answer.

Coach mode reasons from a small set of named, citable lenses (Rich Hickey's
simple-vs-easy, Grokking Simplicity's actions/calculations/data, Bernhardt's
functional-core/imperative-shell, CodeScene's code health smells, and
state-minimization heuristics from the Clojure community) rather than vague
assertions like "this is cleaner." See `SKILL.md` for the full writeup and
citations.

## Using it

Drop `SKILL.md` into your skills folder. It's plain-language instructions,
not code, so it works as-is with:
- **Claude Code** and **OpenCode** — both read the same
  `SKILL.md` / skills-folder format natively.
- **Cursor / VS Code–style tools** — these use a different rules-file
  convention, so you'll likely want a thin wrapper file pointing at this
  content. (Not included yet — see `NOTES.md`.)

Once loaded, just tell the agent which tier and domain mode to use, e.g.
"Tier 1, coach mode" or "Tier 3" for a deadline crunch. Domain mode can also
be left for the agent to ask about if it's unclear.

## Status

This is a personal skill I'm actively using and refining based on real
friction points (see `NOTES.md` for open questions and `CHANGELOG.md` for
what's changed). Feedback, issues, and PRs — especially real usage
friction you hit while using it — are welcome.

## License

MIT — see `LICENSE`.
