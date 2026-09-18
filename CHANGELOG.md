# Changelog

All notable changes to this plugin are recorded here. Format is loosely
based on [Keep a Changelog](https://keepachangelog.com/).

## [0.4.0] — Phase 3: text channel and Tier 3 polish

Closes G5: code can no longer reach the developer only as chat text, and
Tier 3's narration/divergence *format* is checked. Quality, tone, and
skeleton-vs-logic judgment stay in the skill.

- **Stop-hook fence check:** at Tier 1 (and locked Tier 2) a fenced block
  above `tier1MaxFenceLines` (default 6) is a violation. Small snippets pass.
  Unlocked Tier 2 and Tier 3 are unaffected. Table-tested in the pure core;
  the Stop hook is a thin shell. Violations are ledgered.
- **MessageDisplay redaction (Claude Code):** over-threshold Tier 1 code is
  obscured on screen when `messageDisplayRedaction` is true (D5 default on).
  Display-only; the transcript keeps the original. Ports are Phase 4.
- **Tier 3 narration/divergence format:** after a turn that edited files, the
  Stop hook requires a what/why section and a `Divergence from your first
  instinct:` line (`none` is acceptable). Existence/format only; a miss is a
  redirect, not a crash. Blocks once (`stop_hook_active`).
- **`ask` on Agent/Task:** spawning a subagent is a gate-bypass route, so
  category F is `ask` at T1/T2 and at granted T3 (still `deny` at T3 without
  a preamble). Worker/headless exemption and opt-in scope are unchanged.
- **bashEditDiff tripwire:** PostToolUse on Bash flags category-E paths in
  `tool_response.bashEditDiff.changedFiles` at T1/T2, ledgers, and tells the
  model to revert. REPL/run commands with no changed files do not trip;
  cache/artifact globs are ignored so the feedback loop stays open.
- **Test scaffolding:** still path-based. A skeleton-vs-logic LLM judge was
  considered and deferred so the core enforcement path stays live-model-free.
- **SKILL.md** states the text channel is enforced and what remains advisory.

## [0.3.0] — Phase 2: blind Tier 2 unlock grader

The differentiator: Tier 2 is *earned* (genuineness of engagement, never
correctness), judged by a blind fresh-process grader, not by the tutor.

- **`agents/nd-grader.md`:** grader agent definition. Receives only file-path
  evidence and a rubric fixed before the evidence is read. Runtime model is
  `graderModel` in config (default `haiku`), overridable.
- **Fresh-process spawn** from the hook (`/no-deceit:unlock`) or `nd unlock`,
  never from the tutor. Mental-model evidence is `.no-deceit/attempts/<task>.md`;
  commit-history evidence is `git log -p` over the task's files.
- **Deterministic pre-filter** (no LLM): mental-model must be non-empty, above
  `attemptMinChars`, and not an error paste; commit-history needs ≥ 2
  substantive commits on the same unit after dropping whitespace/rename/format
  diffs. A reject is `not_yet` with no model call.
- **Mechanical rubrics:** mental-model pass = R1 ∧ R3 plus one of R2/R4;
  commit-history pass = C1 ∧ C2. Round down when torn. Expertise flows into
  `misconceptions[]` / `next_smaller_question` / `error_class`, never into
  softening the verdict. JSON verdict written under `.no-deceit/verdicts/`.
- **Honesty valve (D3):** `nd unlock --override "<reason>"` unlocks and is
  ledgered; one `nd unlock --appeal` per verdict; Tier 3 still available.
  Grader timeout (~120 s) or spawn failure defaults to `not_yet`.
- **Checking questions:** tutor writes `.no-deceit/checks/<task>/rubric.json`
  *before* the answer; `nd check` / `/no-deceit:check` returns
  `landed | partial | not_landed` plus `misconceptions[]`. `error_class` trends
  suggest Coach vs Pair.
- **Gold set + `nd audit`:** 37 adversarial items; three runs; release gate
  `graded_up = 0`. Live LLM is mockable (`--oracle` / `--inflate` /
  `ND_GRADER_MOCK_JSON`) so CI never needs a key.

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
  orchestrator). Fully unit-tested (148 tests via `node --test`).
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
