# Changelog

All notable changes to this plugin are recorded here. Format is loosely
based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] — Phase 1: skill → hook-enforced plugin

The turning point: No Deceit is no longer advice a skill can only *state*. It
is now a Claude Code **plugin** whose `PreToolUse` hook actually **enforces**
the chosen tier (it can hard-deny a tool call, even under skip-permissions),
with the skill kept as the teaching layer.

- **Plugin package:** `.claude-plugin/plugin.json` manifest plus
  `.claude-plugin/marketplace.json` (the repo doubles as its own single-plugin
  marketplace). The skill moved to `skills/no-deceit/SKILL.md`.
- **Pure policy core (`core/*.mjs`, Node, zero dependencies):** `classify.mjs`
  (tool call → category A–G/U), `policy.mjs` (tier resolution incl. Tier 3
  grant expiry, and the tier × category decision table), `scope.mjs` (Step 0
  opt-in + worker/headless exemption), `state.mjs` (XDG state I/O + ledger),
  `control.mjs` (tier/mode/unlock/status), `gate.mjs` (fail-closed
  orchestrator). Fully unit-tested (118 tests via `node --test`).
- **Hooks (`hooks/hooks.json` + `hooks/nd-hook.mjs`):** `SessionStart` injects
  tier/mode context and runs an armed self-check; `UserPromptSubmit` injects
  context and handles `/no-deceit:tier|:mode|:unlock|:status` in-hook (the
  forge-proof channel); `PreToolUse` is the gate.
- **Tier semantics:** Tier 1 denies source writes and code-writing Bash (with a
  Socratic deny reason that names routing-around as a violation); Tier 2 unlock
  is override-only and ledgered (grader deferred); Tier 3 gates on a
  deterministic preamble-existence check and expires, falling back to the prior
  tier. Test scaffolding, tooling/env setup, and the REPL/run loop are allowed
  at every tier.
- **Tamper-proofing:** the agent cannot change its own tier or write the state/
  ledger through any gated tool (category G is denied at every tier); the `nd`
  CLI also refuses mutating subcommands from inside an agent shell.
- **Scope guard:** governs only opted-in projects (`.no-deceit/` present) in
  attended sessions; worker/headless sessions (`FM_TASK_ID` and friends) are a
  pass-through no-op so the gate never wedges an automated fleet.
- **`nd` CLI, ledger, status badge:** `nd init|tier|mode|status|unlock|ledger|
  doctor`; append-only `~/.local/state/no-deceit/ledger.jsonl`; `nd status
  --short` → `[ND T1·coach]` badge surface.
- **Fail-closed:** every internal hook error becomes an explicit deny, never a
  silent allow.
- **Docs:** `SKILL.md` rewritten as the teaching layer that names the hook as
  the enforcement; `README.md` updated for the plugin install story and its
  stale Cursor claim corrected.

## [0.1.0] — Initial version

- Established core philosophy: protect blank-file "create" ability against
  self-deceptive AI-assisted productivity.
- Defined two independent axes: Tier (1 Tutor / 2 Guided / 3 Narrated
  Velocity) and Domain mode (Coach / Pair).
- Added cross-tier exceptions: test scaffolding on request, tooling and
  environment setup (single-attempt bar), interactive development / fast
  feedback loops.
- Added Coach Mode named lenses: Simple vs Easy (Hickey), Actions/
  Calculations/Data (Normand), Functional Core/Imperative Shell
  (Bernhardt), Code Health smells (CodeScene/Tornhill), Minimize/
  Concentrate/Defer state (Dittwald), Values over variables.
- Explicitly excluded Ousterhout's "deep modules" as a primary lens
  (assumes an OO/interface-programming worldview that doesn't transfer
  cleanly to functional languages like Clojure); left as an optional
  secondary/architecture-level mention.
- Considered and deliberately left out Khononov's "connascence" concept
  as a lens — judged to likely overlap with the existing Simple vs Easy
  frame, but not excluded permanently. See `NOTES.md`.
