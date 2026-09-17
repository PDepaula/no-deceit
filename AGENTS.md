# Project agent memory

No Deceit is a Claude Code **plugin** (not a bare skill) that enforces a chosen
AI coding-assistance tier: a `PreToolUse` hook is the law, the bundled skill is
the teacher.

## Design authority

The full design rationale, phase plan, gating matrix, and the captain's settled
decisions (D1–D8) live in the scout report at
`/home/pdp/firstmate/data/no-deceipt-plugin-scout/report.md` (outside this
repo). §5 (architecture), §6.2 (phases), and §7 (decisions) govern the build.
Read it before changing enforcement semantics.

## Architecture (functional core / imperative shell — it dogfoods its own lens)

- `core/*.mjs` — PURE, zero-dependency policy owner; no fs/clock/env reads.
  `classify.mjs` (tool call → category A–G/U), `policy.mjs` (`resolveEffective`
  tier resolution incl. Tier 3 expiry + `decide` the tier × category table),
  `scope.mjs` (Step 0 opt-in + worker exemption). Keep these pure so Phase 4
  per-harness adapters import them unchanged.
- `core/state.mjs`, `core/control.mjs`, `core/gate.mjs` — the imperative shell:
  XDG state I/O, ledger, tier/mode/unlock ops, and the fail-closed orchestrator.
- `hooks/nd-hook.mjs` + `hooks/hooks.json` — the Claude Code hook shim
  (`SessionStart`, `UserPromptSubmit`, `PreToolUse`); thin, all policy in core.
- `bin/nd` — the developer's shell CLI (`init|tier|mode|status|unlock|ledger|
  doctor`), auto-added to PATH by the plugin.
- `skills/no-deceit/SKILL.md` — the teaching layer.

## Non-negotiable invariants (do not regress)

- The agent must NEVER be able to change its own tier: changes come only from
  the in-hook `/no-deceit:` prompt commands or the developer's `nd` shell.
  Category G (tamper) is denied at every tier.
- The gate must NOT wedge worker/headless sessions (`FM_TASK_ID` etc.) — those
  are pass-through no-ops (`core/scope.mjs`).
- Fail-closed: any internal hook error is an explicit deny, never a silent
  allow (`core/gate.mjs`).

## Test

`node --test 'core/*.test.mjs' 'hooks/*.test.mjs' 'bin/*.test.mjs'` — pure Node
test runner, no deps. The tier × category matrix and the tamper / scope /
fail-closed paths are all covered; keep them green.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
