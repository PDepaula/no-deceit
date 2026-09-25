# harness/

One folder per harness, all thin shells over the same `evaluate()` in
`core/gate.mjs`. No policy lives here. Verification records:
`docs/verification/<harness>.md`.

| Harness | Entry | Installed by `nd bootstrap` as | Deny shape | Hard blocks |
|---|---|---|---|---|
| Claude Code | `claude-code/` (skills-dir plugin; hooks → `hooks/run.mjs` → `hooks/nd-hook.mjs`) | symlink `~/.claude/skills/no-deceit` | `permissionDecision: deny` | PreToolUse, Stop, UserPromptSubmit, MessageDisplay |
| OpenCode | `opencode/no-deceit.ts` | symlink into `~/.config/opencode/plugins/` | throw | `tool.execute.before` only |
| Pi | `pi/no-deceit.ts` | symlink into `~/.pi/agent/extensions/` | `{block:true}` | `tool_call` only |
| Cursor | `cursor/hooks.json` → `nd --cursor` (`cursor/run.mjs`) | `preToolUse` entry merged into `~/.cursor/hooks.json` | `{permission: deny}` | `preToolUse` only |

Shared, harness-neutral pieces stay at this level: `map-tool.mjs` (harness tool
names → categories), `apply.mjs` (decision → each harness's deny shape),
`run.mjs` (the imperative shell), and their tests (`node --test 'harness/*.test.mjs'`).

Only Claude Code hard-blocks the text channel and the handover label. On the
other three, the `/no-deceit:` prompt commands still work where the harness
delivers prompts, the ledger still records, and the diagram-file deny is a hard
block everywhere because it is a PreToolUse decision.

`nd --cursor` stays as the Cursor transport for one more release (a shim while
the transport moves under `harness/cursor/`). The repo-root manifests
(`.claude-plugin/`, `.cursor-plugin/`, `package.json`'s `pi` key) exist so the
marketplace, Cursor and Pi package routes keep working; they point into here.
