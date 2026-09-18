# Verification — OpenCode (Phase 4)

What was verified for the OpenCode adapter, how, and against which versions.
Convention borrowed from firstmate's adapter notes: record the evidence, don't
re-prove settled primitives.

- **Environment:** OpenCode `1.18.30`, `node v24.5.0`, Linux. Date: 2026-09-17.
  Plugin shape is `tool.execute.before` throwing to deny (OpenCode plugin
  docs; firstmate field note: throwing prevents the command from running and
  surfaces the thrown message as the failed tool result, verified 2026-07-09
  against OpenCode 1.17.15). This build did not re-prove that primitive live
  in a TUI; CI mocks the plugin I/O.

## Verified in this build

The adapter is verified by `node --test` with OpenCode **not** required:

- **`adapters/opencode.test.mjs`** — `createOpenCodePlugin` with a fake
  `{directory, worktree}`:
  - `write` of source at Tier 1 throws the core Tier 1 reason
  - `read` does not throw
  - `bash` source redirect at Tier 1 throws
  - `FM_TASK_ID` is a pass-through (no throw)
- **`adapters/parity.test.mjs`** — the same fixture (`write` / `filePath`)
  yields the same `evaluate()` decision as Claude-shaped `Write` /
  `file_path`. The shared core is not forked.
- **`adapters/map-tool.test.mjs`**, **`adapters/apply.test.mjs`** — OpenCode
  names map onto the classifier, and deny/ask become `throw new Error(reason)`.

## Known parity gaps (stated plainly)

- **No blocking turn-end hook.** Throwing from `session.idle` does not block
  `opencode run`. The Tier 1 chat-fence check and the Tier 3 narration format
  check therefore **degrade to a follow-up message, not a hard block**. This
  adapter does not implement that follow-up in this port (pre-tool deny is
  the shipped enforcement). Worked solutions as fenced chat text can land.
- **`MessageDisplay` redaction exists only in Claude Code.** OpenCode has no
  equivalent; over-threshold code is not obscured on screen.
- **No native `ask`.** Category F (subagent) and unknown Bash, which are
  `ask` on Claude Code, are thrown here so the adapter stays fail-closed.
  That is stricter than Claude Code's permission prompt, not a silent allow.

## Install (attended session; no firstmate required)

Clone stays a full tree so relative imports resolve:

```bash
git clone https://github.com/PDepaula/no-deceit ~/.claude/skills/no-deceit
# Point OpenCode at the plugin file inside that clone, e.g. in opencode.json:
#   { "plugin": ["~/.claude/skills/no-deceit/adapters/opencode/no-deceit.ts"] }
# or symlink that file into ~/.config/opencode/plugins/ (do not copy it).
cd <a project> && nd init
```

OpenCode already reads `~/.claude/skills`, so the teaching `SKILL.md` loads
without a wrapper.
