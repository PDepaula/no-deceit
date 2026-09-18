# Verification — Cursor (Phase 4)

What was verified for the Cursor adapter, how, and against which versions.
Convention borrowed from firstmate's adapter notes: record the evidence, don't
re-prove settled primitives.

- **Environment:** `cursor-agent 2026.09.10-fd3934a`, `node v24.5.0`, Linux.
  Date: 2026-09-17. Cursor shells out; it does not import the core.
  `preToolUse` consumes a stdout decision object
  (`{"permission":"deny"|"allow"|"ask", ...}`) with **exit 0**. firstmate's
  wrapper records that Cursor reads the returned object rather than the exit
  status, and only that rendering is verified to block (cursor-agent
  `2026.08.11`). This build did not re-prove the live block in a Cursor TUI;
  CI drives `nd --cursor` as a subprocess with piped JSON.

## Verified in this build

The adapter is verified by `node --test` with Cursor **not** required in CI:

- **`adapters/cursor.test.mjs`** — `handleCursorPayload`:
  - Tier 1 `Write` → `{permission:"deny", user_message, agent_message}` exit 0
  - `Read` → `{permission:"allow"}`
  - `Shell` source redirect → deny
  - `Task` → `{permission:"ask"}` (see gap below)
  - `FM_TASK_ID` → allow
  - thrown evaluator → fail-closed deny, still exit 0
  - `adapters/cursor/hooks.json` parses as `preToolUse` → `nd --cursor` with
    `failClosed: true`
- **`bin/nd.test.mjs`** — `node bin/nd --cursor` with stdin JSON prints the
  same deny/allow objects.
- **`adapters/parity.test.mjs`** — Cursor `Write` / `path` yields the same
  core decision as Claude-shaped `Write` / `file_path`.

## Known parity gaps (stated plainly)

- **No blocking turn-end hook.** Cursor `stop` cannot hard-block (exit 2 is a
  silent no-op; the supported output is `followup_message`). The Tier 1
  chat-fence check and the Tier 3 narration format check therefore **degrade
  to a follow-up message, not a hard block**. This adapter does not register
  a `stop` follow-up in this port. Worked solutions as fenced chat text can
  land.
- **`MessageDisplay` redaction exists only in Claude Code.** Cursor has no
  equivalent; over-threshold code is not obscured on screen.
- **Cursor's `ask` is not enforced on `preToolUse`.** The schema accepts
  `"permission":"ask"` and this adapter emits it for category F / unknown
  Bash, matching the core decision. Cursor currently treats that as allow.
  Subagent spawn (`Task`) is therefore **not** a hard gate on Cursor.

A plugin-only Claude Code install should not be assumed to enforce inside
Cursor (Cursor's Claude-compat map names settings files, not plugin
`hooks/hooks.json`). Use `adapters/cursor/hooks.json`. If both a
Claude-settings hook and this Cursor hook were registered, both would fire;
`--cursor` marks this invocation as the Cursor registration.

## Install (attended session; no firstmate required)

`nd` must be on `PATH` (Claude plugin install puts it there; otherwise
`export PATH="$HOME/.claude/skills/no-deceit/bin:$PATH"`):

```bash
git clone https://github.com/PDepaula/no-deceit ~/.claude/skills/no-deceit
# User-level (or copy into a project's .cursor/hooks.json):
mkdir -p ~/.cursor
cp ~/.claude/skills/no-deceit/adapters/cursor/hooks.json ~/.cursor/hooks.json
cd <a project> && nd init
```

Cursor reads `SKILL.md` natively (including from `~/.claude/skills/`), so the
teaching layer needs no wrapper. `failClosed: true` is set so a crash or
invalid JSON blocks rather than failing open.
