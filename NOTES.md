# Open Threads / Design Notes

Running list of unresolved questions and ideas. Move items into `CHANGELOG.md`
once actually decided and implemented. The full design authority is the scout
report referenced from `AGENTS.md` (phases, decisions D1–D8, gating matrix).

## Phase roadmap (from the design report)

- **Phase 1 (this build):** the enforcing gate for Claude Code — plugin
  manifest, pure `.mjs` policy core, `SessionStart`/`UserPromptSubmit`/
  `PreToolUse` hooks, `nd` CLI, ledger, tamper-proofing, scope guard, and the
  rewritten teaching skill. Tier 2 unlock is override-only; Tier 3 gates on a
  deterministic preamble check and expires.
- **Phase 2:** the blind fresh-process LLM engagement grader for the Tier 2
  unlock (grades genuineness of engagement, not correctness). Out of scope here.
- **Phase 3:** policing code in chat — a `Stop`-hook fenced-code check at Tier 1
  plus optional on-screen redaction. Phase 3 will add its own
  `tier1MaxFenceLines` config default; it is not carried in Phase 1.
- **Phase 4:** OpenCode / Pi / Cursor adapters over the shared policy core.
- **Phase 5:** the earned-time `nd report` loop and firstmate `learn:` tagging.

## Not yet decided

- **Bash classifier coverage.** The category-E deny-list (redirects, `sed -i`,
  `patch`, heredocs, file-writing eval) is best-effort by design; unknown Bash
  becomes an `ask` at gated tiers. The exception globs (categories C/D) and the
  deny-list will be wrong in ways only real use reveals — the ledger records
  every denial to tune from.
- **Khononov's connascence** as an additional Coach lens — may overlap with
  Hickey's simple-vs-easy. Revisit with a concrete case.
- **Ousterhout's deep modules** as a secondary architecture lens — currently
  excluded (assumes an OO/interface worldview). Revisit with a concrete case.

## Resolved since the last version

- **The Cursor / VS Code "rules-file wrapper" plan is dropped.** Cursor now
  reads `SKILL.md` natively and has a real `preToolUse` hook; a rules file is
  advisory and would reproduce the exact enforcement gap this plugin closes.
  The right path is a thin Cursor hook adapter over the shared core (Phase 4).

## Not yet done

- Actual sustained use of the gate in practice. The exception globs and Bash
  deny-list will need refinement from real friction — the most productive way
  the skill has improved so far. Log every denial and review the ledger weekly.
