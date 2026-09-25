# Changelog

All notable changes to this plugin are recorded here. Format is loosely
based on [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

- **Fixed:** the blind unlock grader is no longer spawned with
  `claude -p --bare`. `--bare` never reads OAuth credentials, so on a machine
  whose only login is a Claude subscription the child printed "Not logged
  in" and no verdict was produced. The grader now works with subscription
  login or `ANTHROPIC_API_KEY`, and stays isolated by other means: read-only
  tools, no inherited settings, an empty scratch cwd, and `ND_GRADER_CHILD`
  (see `core/grader-job.mjs`).
- **Added:** opt-in `nd doctor --grader-probe` runs a minimal grader child
  and reports whether it can log in. Plain `nd doctor` makes no model call.
- **Changed:** `ND_GRADER_CHILD` is honoured as a worker marker, so the
  gate treats the grader child as a pass-through session.

## [Unreleased] — Redesign phase 3: curriculum and the Tier 1 gate

- **Added:** curricula are two files under `<data>/curricula/<topic>/`:
  `open.md` for the learner (frontmatter `mission:`, structured `sources:` with
  `sections`, `verified`, `access`, `answer_keys_do_not_quote`; Mission, Sources,
  reading sessions with plain Read / Practice / Unlocks lines, one flat keyword
  list) and `sealed.md` for the tutor and grader (concept map; per concept a
  claim, kind concept/procedure/fact, threshold flag, optional `Unlocks` against a
  `steps:` list, mechanism, keywords, contrast set, misconception traps with a
  `(from: ...)` origin tag, boundary, and transfer prompts written with their
  criteria). Format and keyword rules: `docs/curriculum-format.md`. Keyword list:
  alphabetical, one flat list, no headings, emphasis or definitions, not grouped;
  a keyword that names a rule is a hint, allowed only when no neutral term exists
  and declared with its reason. The list is regenerated from the sealed map.
  The single-file `curriculum.md` is still read by the grader when no `sealed.md`
  exists.
- **Added:** `nd curriculum build <topic> --goal --mission --from <path|url>`,
  `check`, `review` (mission, sources and outline only, so review does not spoil
  the topic) and `reviewed`. The builder is `agents/nd-scout.md`, a fresh
  `claude -p` with `Read` and `WebFetch` only, in `dontAsk` mode without
  skip-permissions: `Read` is allowed only for its job directory, the topic's
  curriculum directory and the files passed with `--from` (a directory source is
  refused) (`curriculumModel`, default `sonnet`; `scoutTimeoutMs`); it prints both files, the shell validates them
  against the format, regenerates the keyword list, stamps `built:` and
  `reviewed: no`, and writes them, or rejects the whole build. `ND_SCOUT_MOCK_FILE`
  is the test seam. `nd curriculum build` / `reviewed` are category G and refuse in
  an agent shell; `ND_SCOUT_CHILD` is a worker marker.
- **Added (Tier 1):** `nd tier 1 --topic <t>` and `/no-deceit:tier 1 <t>` (and
  `nd tier 1` with a topic already stored) succeed only when both files exist and
  are non-trivial (`curriculumMinChars`, a mission, at least one concept);
  otherwise they refuse and name the two ways to get one. Tier 1 with no topic
  stays the plain code tutor and needs no curriculum.
  `nd status` notes an unreviewed curriculum (`reviewed:` stays advisory).
  SessionStart and prompt context inject the curriculum paths for the active topic
  with the rule that the tutor may read `sealed.md` but never quote it. `SKILL.md`
  gains a curriculum-bound tutoring section (never reveal a concept before it is
  attempted; ask why a differing grouping was chosen). Enforcement is instruction
  plus the offline audit, not a read block.
- **Changed:** the Tier 2 unlock is per topic when a topic is active (`--topic`,
  recorded in project state; `--no-topic` clears it): a pass or override for one
  topic does not unlock another. With no active topic the project-level unlock
  behaves as before.
- **Port:** oracle cases for `parseTierArgs`, `curriculumReady`,
  `checkKeywordList`, `keywordsFromSealed` and the topic-scoped `resolveEffective`
  (`oracle/cases/curriculum-*.json`, `policy-resolve-topic.json`); none are
  ported yet, so `bb test` skips them.
- **Follow-ups (not in this change):** per-topic `rubric_emphasis`, a per-concept
  `Illustration` slot, `Boundary` split into conceptual and project constraint as
  required fields, command-output evidence, Bash for the scout on procedural
  topics, and step-unlock reporting in `nd status`.

## [Unreleased] — Redesign phase 2: evidence capture and the transfer grader

- **Added:** multi-line `/no-deceit:teach <topic> --project <p>`. `parseCommand`
  now returns `body` (everything after line 1); the hook writes
  `<data>/evidence/<topic>/<ts>-<nn>-teach.md` (frontmatter: topic, project, kind,
  sha256, captured), ledgers `evidence_captured`, and blocks the prompt so the
  tutor never receives the teach-back in conversation (reads of the data home
  are not hook-enforced; the skill tells the tutor not to read evidence). Also `nd evidence add <topic> <path>
  [--project p]`: copies, hashes and sidecars a note, `.mmd`/`.mermaid`,
  `.excalidraw` / Excalidraw `.json` (`type` must be `excalidraw` or
  `excalidraw/clipboard`), or Obsidian `.excalidraw.md`. Diagrams are stored raw.
- **Added:** the data home (`core/state.mjs` `dataPaths`): `ND_DATA_DIR`, else
  `$ND_HOME/data`, else `$XDG_DATA_HOME/no-deceit` (`~/.local/share/no-deceit`).
  Compatible with `data/` being its own private git repo; No Deceit never creates
  one. Writes and shell commands in the data dir are tamper territory
  (category G), as are `nd evidence` and `nd grade`.
- **Added:** `TRANSFER_RUBRIC` (P1–P5, pass = P1 ∧ P2 ∧ P4 ∧ (P3 ∨ P5)),
  the diagnostic `structure` field (G1–G5 `met|unmet|unknown`, never in the
  verdict), mechanical `finalizeTransferVerdict`, the `curriculumPath` /
  `projectsPath` / `summaryPath` job keys (`assertJobBlind` kept), a
  `source_paste` / `too_few_nodes` pre-filter, the transfer section of
  `agents/nd-grader.md`, `nd grade` / `/no-deceit:grade`, and
  `nd check --project`. Ledger events `evidence_captured` and `transfer_grade`;
  `nd report` counts them. `nd grade` grades the evidence captured last, read
  from the data home alone (`<nn>` orders same-second captures). A passed
  transfer unlocks Tier 2 for the project the evidence names,
  resolved to its governed repo through the `path` in `projects.edn` /
  `projects.json`; if it does not resolve, the pass is recorded and nothing
  unlocks. The unlock stays project-wide (`unlockedTopics` records the topics)
  until topics become session state in phase 3.
- **Added:** `gold/transfer-gold.jsonl` (27 items, every case type in the
  redesign report §2.2); `nd audit` runs it with the unlock set, and the
  release gate is `graded_up = 0` over both sets.
- **Added (port):** oracle cases for the new pure functions
  (`transfer-pass`, `transfer-verdict`, `prefilter-transfer`,
  `evidence-parse-teach-args`, `evidence-detect-diagrams`), and the parser
  contract for the Babashka Excalidraw / Mermaid / mind-map parsers (PORTING.md
  step 7) with fixture pairs under `fixtures/evidence/`, skipped by `bb test`
  until `no-deceit.evidence.*` exists. No parser is implemented in Node.
- **Changed:** `parseCommand` returns `{ name, arg, body }`; a multi-line prompt
  whose first line is a `/no-deceit:` command is now a command (before, only
  single-line prompts were).

## [Unreleased] — Redesign phase 1: Tier 2 default, handover, design-artifact gate

- **Changed:** Tier 2 (locked) is the default for every governed project
  (`DEFAULTS.tier`, `nd init`, absent state). An explicit `tier: 1` in
  `state.json` is honoured: projects initialised before this change keep
  their stored tier (old `nd init` wrote Tier 1); `nd tier 2` moves them.
- **Added:** classifier category **H** (design artifact): writes to diagram
  sources, diagram content written into markdown, and any Bash command that
  runs a diagram renderer (`mmdc`, `d2`, `dot`, `plantuml`, `excalidraw-cli`,
  bare or via a package runner or launcher such as `npx`, `xargs`, `env`,
  `sudo`), the learner's own file included: they render it in their own
  terminal. Only an invocation in command position counts; a renderer name
  passed as an argument (`grep -rn mmdc`, `command -v mmdc`) does not.
  Denied at Tier 1 and Tier 2 locked *and* unlocked; a diagram
  fence of any size in chat is a `chat_diagram` violation on the gated tiers,
  and `MessageDisplay` redacts it.
- **Added:** the `Handing over: <what>` label and the question-ending rule at
  Tier 1 / locked Tier 2 (short turns under ~40 words with no fence and no
  project noun pass). Config `projectNouns`.
- **Added:** `/no-deceit:handover [--domain d] [why]` on the UserPromptSubmit
  channel; relaxes the text channel for exactly one turn.
  New ledger events `handover` and `handing_over`; new violation kinds
  `chat_diagram`, `question_ending`, `handover_unlabelled`. `nd report`
  prints handovers per domain with a streak note.

## [0.7.1] — Fix strict-YAML frontmatter parse failure on Pi

Frontmatter-quoting fix only — no skill prose, enforcement logic, or adapter
changes.

- **Fixed:** `skills/no-deceit/SKILL.md`'s `description:` was an unquoted
  YAML scalar containing a colon-space (`...tier system that hooks enforce:
  it explains...`). Strict YAML parsers (Pi's, and standard PyYAML) read
  `enforce:` as a nested mapping and rejected the whole frontmatter block —
  `pi install npm:no-deceit` failed with `[Skill conflicts] ... Nested
  mappings are not allowed in compact mappings`. Claude Code's lenient
  frontmatter parser accepted it, which is why it shipped in 0.7.0. The
  scalar is now double-quoted; text is unchanged.
- **Added:** `adapters/skill-frontmatter.test.mjs` strict-YAML-parses the
  frontmatter of every shipped skill/agent `*.md` (using the `yaml` package,
  a new devDependency) so this class of failure fails CI instead of shipping.
  Re-scanned the whole repo for the same issue; no other files were affected.

## [0.7.0] — Phase 6: native distribution

Packaging and manifests only — no enforcement or adapter decision-logic
changes. Each harness now installs No Deceit through its own native channel
instead of the manual clone-and-symlink routes.

- **Claude Code:** fixed stale `no-deceipt` references in `README.md` (the
  repo was renamed to `PDepaula/no-deceit` on 2026-09-17); confirmed
  `claude plugin marketplace add PDepaula/no-deceit` /
  `claude plugin install no-deceit` against the current `.claude-plugin/`
  manifests.
- **Pi:** `package.json` gains a `pi` manifest (`extensions`, `skills`) and
  the `pi-package` keyword for gallery discoverability
  ([pi.dev/packages](https://pi.dev/packages)). Live-verified: a real Pi
  session with the extension loaded actually denies a Tier 1 `write` —
  recorded in `docs/verification/pi.md` (previously mock-only).
- **OpenCode:** `package.json` gains `main` (OpenCode's `opencode plugin
  <module>` needs a detectable server-target entrypoint) and drops
  `private: true` so `npm publish` is possible. `npm pack` / extract /
  `opencode plugin <dir>` verified end to end without publishing. Found and
  documented (not fixed — out of scope) a `worktree`-vs-`directory` cwd
  fallback bug in `adapters/opencode/plugin.mjs` that misresolves for a
  governed, non-git project. See `docs/verification/opencode.md`.
- **Cursor:** new `.cursor-plugin/plugin.json` gives Cursor its own
  correctly-shaped `hooks` pointer (`adapters/cursor/hooks.json`), since
  Cursor's convention-based hook discovery would otherwise silently pick up
  Claude Code's differently-shaped `hooks/hooks.json` and index but not
  enforce. `cursor-agent plugin marketplace add` / `marketplace list`
  verified live; the resulting hook wiring live-verified to deny a Tier 1
  write. See `docs/verification/cursor.md`.
- **npm:** package is now publishable (`no-deceit` was unclaimed as of
  2026-09-18); `npm publish` itself is a captain-run step, not part of CI —
  see the README's "Publish step".
- **Tests:** `adapters/packaging.test.mjs` guards the manifests (package.json
  fields, `.claude-plugin/` and `.cursor-plugin/` paths) against drift.
- **Docs:** README gets one per-harness install matrix; each verification
  doc records what was actually run and its result, including the two
  known gaps above.

## [0.6.0] — Phase 5: earned-time loop

The paradox made measurable: the hours an agentic framework buys should be
spent on intentional upskilling, and the ledger can now say so at the scale
of a week. No new enforcement. No firstmate `learn:` integration (D8 stays
exemption-only).

- **`nd report`:** weekly-style summary over the ledger (default last 7 days;
  `--since` / `--until` as ISO dates or relative `7d`/`24h`/`30m`/`1w`).
  Prints attended time in Tier 1/2 vs Tier 3, unlock counts (`unlocked` /
  `not_yet`) plus checking-question `landed` / `not_landed` / `partial`,
  Coach-domain misconceptions rolled up by task, and evidence-based Coach/Pair
  suggestions. Empty or short ledgers are a graceful "nothing to summarise".
  Computation is pure (`core/report.mjs`); `bin/nd` only reads and renders.
- **Delegated lane:** worker/headless sessions in an opted-in project still
  pass through (no enforcement change). The gate now writes **one**
  `event: "delegated"` marker per session (`lane`, `taskId` when `FM_TASK_ID`
  is set) so the report can name unattended/agentic work honestly, with no
  learning claimed. Ungoverned repos stay silent. A logging error never
  fail-closes an exempt session.
- **Coach/Pair suggestion:** per-domain `error_class` trend (task is the
  domain key already on unlock/check rows). Repeated `conceptual` ⇒ Coach;
  mostly `slip` ⇒ Pair; insufficient data ⇒ no suggestion. Surfaced in
  `nd report` and `nd status`. Suggestion only — the mode is not auto-switched.
- **Time-in-tier:** inter-event gaps overlapping the window, capped at 30
  minutes so overnight holes are not counted as practice. Delegated gaps are
  isolated from attended tier hours.
- **Docs:** `SKILL.md` and `README.md` document `nd report` and the
  suggestion. `nd report` is a read-only `nd` subcommand (category A).

## [0.5.0] — Phase 4: OpenCode, Pi, and Cursor adapters

Ports the existing gate to the other harnesses. Policy stays in the Phase 1
`.mjs` core; each adapter is a thin shell. Claude Code behavior is unchanged.

- **OpenCode** (`adapters/opencode/no-deceit.ts`): `tool.execute.before`
  imports the core in-process and throws the deny reason. OpenCode already
  reads `~/.claude/skills`.
- **Pi** (`adapters/pi/no-deceit.ts`): `tool_call` imports the core
  in-process and returns `{block:true, reason}` on deny.
- **Cursor** (`adapters/cursor/hooks.json` + `nd --cursor`): `preToolUse`
  shells out; `nd --cursor` prints Cursor's decision object on stdout and
  exits 0 (`failClosed: true`). Cursor does not import the core.
- **One state, one ledger:** opt-in `.no-deceit/`, XDG state, and
  worker/headless exemption (`FM_TASK_ID`) are identical across harnesses.
- **Parity gaps documented** in `docs/verification/{opencode,pi,cursor}.md`
  rather than hidden: no blocking turn-end on OpenCode/Cursor (Tier 3
  narration / T1 fence is not a hard block); `MessageDisplay` is
  Claude-Code-only; Cursor `ask` is not enforced on `preToolUse`.
- **Tests** mock harness I/O (`node --test`); CI does not need OpenCode, Pi,
  or Cursor installed. The same fixture yields the same core decision through
  every adapter.

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
