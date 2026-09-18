# Project agent memory

No Deceit is a **plugin** (not a bare skill) that enforces a chosen
AI coding-assistance tier: a pre-tool hook is the law, the bundled skill is
the teacher. Claude Code is the reference harness; OpenCode, Pi, and Cursor
are thin adapters over the same core.

## Design authority

The full design rationale, phase plan, gating matrix, and the captain's settled
decisions (D1–D8) live in the scout report at
`/home/pdp/firstmate/data/no-deceipt-plugin-scout/report.md` (outside this
repo). §5 (architecture), §6.2 (phases), and §7 (decisions) govern the build.
Read it before changing enforcement semantics.

## Architecture (functional core / imperative shell — it dogfoods its own lens)

- `core/*.mjs` — PURE, zero-dependency policy owner; no fs/clock/env reads.
  `classify.mjs` (tool call → category A–G/U), `policy.mjs` (`resolveEffective`
  tier resolution incl. Tier 3 expiry + `decide` the tier × category table +
  `decideTextChannel` / `decideDisplay` / `decideBashEditDiff`), `scope.mjs`
  (Step 0 opt-in + worker exemption), `fence.mjs` / `narration.mjs` /
  `tripwire.mjs` (Phase 3 text-channel + bashEditDiff), `prefilter.mjs` /
  `rubric.mjs` / `grader-parse.mjs` / `grader-job.mjs` / `audit.mjs` (Phase 2
  engagement grader: pre-filter, mechanical verdict, blindness, gold scoring),
  `report.mjs` (Phase 5 earned-time summary + per-domain Coach/Pair
  suggestions over ledger entries). Keep these pure so per-harness adapters
  import them unchanged.
- `core/state.mjs`, `core/control.mjs`, `core/gate.mjs`, `core/grader.mjs`,
  `core/git-evidence.mjs` — the imperative shell: XDG state I/O, ledger,
  tier/mode/unlock ops, fail-closed orchestrator (`evaluate` /
  `evaluateStop` / `evaluateDisplay` / `evaluatePostToolUse`), and the
  mockable grader spawn.
- `hooks/nd-hook.mjs` + `hooks/hooks.json` — the Claude Code hook shim
  (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`,
  `MessageDisplay`); thin, all policy in core. `MessageDisplay` is Claude-Code-only.
- `adapters/` — Phase 4 shells over the same `evaluate()`: OpenCode
  (`tool.execute.before` throws), Pi (`tool_call` `{block:true}`), Cursor
  (`nd --cursor` stdout object). Mapping lives in `adapters/map-tool.mjs`;
  do not fork policy. Verification records: `docs/verification/<harness>.md`.
- `bin/nd` — the developer's shell CLI (`init|tier|mode|status|unlock|check|
  audit|ledger|report|doctor`) plus Cursor's `nd --cursor` transport;
  auto-added to PATH by the Claude plugin. `nd report` is read-only.
- `agents/nd-grader.md` — the blind grader agent; spawned only by the hook or
  `nd`, never by the tutor. Model is `graderModel` (default `haiku`).
- `gold/unlock-gold.mjs` — adversarial gold set; `nd audit` release gate is
  `graded_up = 0` before accepting a grader-prompt change.
- `skills/no-deceit/SKILL.md` — the teaching layer.

## Non-negotiable invariants (do not regress)

- The agent must NEVER be able to change its own tier: changes come only from
  the in-hook `/no-deceit:` prompt commands or the developer's `nd` shell.
  Category G (tamper) is denied at every tier.
- The gate must NOT wedge worker/headless sessions (`FM_TASK_ID` etc.) — those
  are pass-through no-ops (`core/scope.mjs`). A governed worker session is
  ledgered once as `delegated` for `nd report`; that must never fail-close.
- Fail-closed: any internal hook error is an explicit deny, never a silent
  allow (`core/gate.mjs`).
- The tutor must NEVER spawn or grade a Tier 2 unlock. The grader is a
  fresh process (`agents/nd-grader.md`) that reads evidence only from files;
  it is invoked by `nd unlock` / the in-hook command. Category G denies
  `nd unlock`/`nd check` from the agent shell. Round down when torn.
  `nd audit` release gate is `graded_up = 0`.

## Test

`node --test 'core/*.test.mjs' 'hooks/*.test.mjs' 'bin/*.test.mjs' 'adapters/*.test.mjs'` — pure Node
test runner, no deps. The tier × category matrix, tamper / scope / fail-closed
paths, the grader pre-filter / gold set / `nd audit` gate, the Phase 3
fence / narration-format / Agent-ask / bashEditDiff paths, the Phase 4
adapter deny shapes (throw / `{block:true}` / stdout object), and the Phase 5
`nd report` aggregation / Coach-Pair suggestion table tests are covered;
keep them green. CI must not call a live model (`nd audit --oracle` /
`--inflate`) and must not require OpenCode/Pi/Cursor installed.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
