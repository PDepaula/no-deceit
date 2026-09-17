# Verification — Claude Code (Phase 0 + Phase 1)

What was verified for the Claude Code gate, how, and against which versions.
Convention borrowed from firstmate's adapter notes: record the evidence, don't
re-prove settled primitives.

- **Environment:** `claude 2.1.270`, `node v26.2.0`, Linux. Date: 2026-09-17.

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

## To do a live end-to-end check by hand

```bash
git clone <this repo> ~/.claude/skills/no-deceit   # loads as no-deceit@skills-dir
cd <a project> && nd init                           # opt in
# In a Claude Code session there, ask it to write a source file at Tier 1:
#   it should be denied with the Socratic reason, and no file should appear.
nd ledger 10                                         # the denial is recorded
```
