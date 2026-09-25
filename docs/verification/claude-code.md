# Verification — Claude Code (Phase 0–3)

What was verified for the Claude Code gate, how, and against which versions.
Convention borrowed from firstmate's adapter notes: record the evidence, don't
re-prove settled primitives.

- **Environment:** `claude 2.1.270`, `node v26.2.0`, Linux. Date: 2026-09-17.
  Phase 3 hook I/O (`Stop` `last_assistant_message`, `MessageDisplay` `delta` /
  `displayContent`, `PostToolUse` `bashEditDiff.changedFiles`) is taken from
  the Claude Code hooks reference of that vintage. Live MessageDisplay/Stop
  rendering is Claude-Code-only and is not exercised in CI; the core functions
  and the hook shim's JSON I/O are.

## Already confirmed by the design scout (report §2.6), not re-proven here

- A `PreToolUse` hook returning `permissionDecision: "deny"` blocks the tool
  call, and the deny holds under `--dangerously-skip-permissions`.
- A `Write|Edit`-only gate leaks through `Bash` (shell redirect), so Bash must
  be classified too. (This build classifies Bash mutation shapes as category E.)

## Verified in this build

The gate's plumbing is verified by the automated test suite (`node --test`),
which drives the real hook shim and CLI as subprocesses with piped payloads:

- **`hooks/nd-hook.test.mjs`** — pipes real Claude Code hook JSON to
  `hooks/nd-hook.mjs`:
  - `PreToolUse` on a Tier 1 source `Write` emits
    `{hookSpecificOutput:{permissionDecision:"deny", permissionDecisionReason:…}}`
    with the Tier 1 reason. (deny + reason delivery)
  - `PreToolUse` on `Read` emits no output (allow).
  - `PreToolUse` in a session with `FM_TASK_ID` set emits no output — a
    firstmate-style worker is a pass-through. (worker guard)
  - `UserPromptSubmit` `/no-deceit:tier 2` is handled in-hook, blocks the
    prompt, and changes the on-disk tier. (forge-proof control channel + state
    read/write)
  - `SessionStart` injects tier/mode context and reports the gate armed.
- **`bin/nd.test.mjs`** — the CLI refuses a mutating subcommand when `CLAUDECODE`
  is set (agent shell) but allows read-only `status`. (defense-in-depth guard)
- **`core/gate.test.mjs`** — the fail-closed path: an internal error yields an
  explicit `deny`, never a silent allow.
- **`core/grader.test.mjs`**, **`core/gold.test.mjs`**, **`core/audit.test.mjs`**,
  **`bin/nd.test.mjs`** — Phase 2 grader:
  - pre-filter rejects empty / error-paste / short attempts and cosmetic commits
    with no LLM call
  - torn evidence rounds down to `not_yet`
  - spawn payload has no tutoring dialogue
  - timeout and spawn failure default to `not_yet`; override remains available
  - one appeal per verdict
  - `nd audit --oracle` → `graded_up: 0` / gate pass; `--inflate` → gate block
  - live LLM is not required (oracle/inflate/ND_GRADER_MOCK_JSON)
- **Evidence capture and the transfer grader (redesign phase 2)**
  (`core/evidence*.test.mjs`, `core/grade.test.mjs`, `core/transfer*.test.mjs`,
  `hooks/nd-hook.test.mjs`, `bin/nd.test.mjs`):
  - a multi-line `/no-deceit:teach <topic> --project <p>` piped to the hook
    writes the evidence file under the data home, ledgers `evidence_captured`
    (hash and path, never the text), and returns `decision: "block"` with no
    injected context; an empty body captures nothing
  - `/no-deceit:grade` runs the transfer grader (mocked via
    `ND_GRADER_MOCK_JSON`), writes a verdict file, ledgers `transfer_grade`, and
    unlocks Tier 2 for the project the evidence names (resolved through the
    manifest's `path`); a missing project manifest is an error, not a silent pass
  - writes and Bash references to the data dir, `nd evidence` and `nd grade`
    classify as category G (reads of the data dir are not hook-enforced);
    `nd evidence` / `nd grade` refuse inside an agent shell
  - `finalizeTransferVerdict` is mechanical (no upgrade, torn and missing-span
    round down); a missing diagram summary yields G1–G5 `unknown`, never a fail
  - `gold/transfer-gold.jsonl` (27 items): prefilter outcomes, gold verdicts and
    spans are checked; `nd audit --oracle` → `graded_up: 0`, `--inflate` → block
  - **Not verified live:** a real Claude Code session's multi-line
    `UserPromptSubmit` payload shape for `/no-deceit:teach`, and a live-model
    transfer grade or gold audit (CI never calls a model). The hook shim is
    driven with the documented payload; treat the first real use as the check.
- **Phase 3 text channel** (`core/fence.test.mjs`, `core/narration.test.mjs`,
  `core/text-channel.test.mjs`, `core/tripwire.test.mjs`, `core/gate.test.mjs`,
  `hooks/nd-hook.test.mjs`):
  - over-threshold fence at Tier 1 → Stop `decision: "block"`; small snippet →
    allow; unlocked T2 / T3 fences are not a leak
  - missing Tier 3 what/why + divergence after an edit → redirect; present →
    pass; `stop_hook_active` does not block a second time
  - `Agent` at Tier 1 → PreToolUse `permissionDecision: "ask"`; `FM_TASK_ID`
    still pass-through
  - bashEditDiff with a source path → PostToolUse block; REPL/run with no
    changed files → allow
  - MessageDisplay returns `displayContent` with the over-threshold body
    replaced when the redaction flag is on; flag-off and ungoverned are no-ops
  - worker/headless exemption and opt-in scope still hold on the new events
- **Design-artifact gate** (`core/diagram.test.mjs`, `oracle/cases/classify.json`):
  - diagram file writes and renderer commands (`mmdc`, `plantuml`,
    `excalidraw-cli`, `d2`, `@mermaid-js/mermaid-cli`, `dot -T…`) in command
    position are category H, denied at every Tier 1/2 state, including through
    launchers (`npx`, `sudo`, `xargs`, `env`, shell keywords, …) and quoted
    command words; a renderer named only as an argument (`grep -rn mmdc`,
    `command -v mmdc`) is not
  - the scan is linear on adversarial input

### Known gaps of the renderer rule (accepted)

The rule catches renderer commands written the ordinary way. Commands disguised
with shell syntax are best effort, not a guarantee: No Deceit flags handovers,
it does not try to stop a determined adversary. Accepted gaps:

- `$'..'` / `$".."` quoting of the command word and backslash-escaped names
  (`\mmdc`, `mm\dc`): normalised today, but other escape and expansion forms
  of the same kind are not tracked.
- Comment continuations (`# note \<newline> mmdc -i a.mmd`): `#` comments are
  not tracked and a backslash-newline is always joined, so the next line is
  read as part of the comment and not caught.

## To do a live end-to-end check by hand

```bash
git clone <this repo> ~/.claude/skills/no-deceit   # loads as no-deceit@skills-dir
cd <a project> && nd init                           # opt in (Tier 2, locked)
# In a Claude Code session there, ask it to write a source file:
#   it should be denied with the locked-Tier-2 reason, and no file should appear.
nd ledger 10                                         # the denial is recorded
```
