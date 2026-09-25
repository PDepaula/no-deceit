# Verification — Cursor (Phase 4)

What was verified for the Cursor adapter, how, and against which versions.
Convention borrowed from firstmate's adapter notes: record the evidence, don't
re-prove settled primitives.

- **Environment:** `cursor-agent 2026.09.10-fd3934a`, `node v26.2.0`, Linux.
  Date: 2026-09-18. Cursor shells out; it does not import the core.
  `preToolUse` consumes a stdout decision object
  (`{"permission":"deny"|"allow"|"ask", ...}`) with **exit 0**. firstmate's
  wrapper records that Cursor reads the returned object rather than the exit
  status, and only that rendering is verified to block (cursor-agent
  `2026.08.11`). CI drives `nd --cursor` as a subprocess with piped JSON;
  this build additionally re-proved the live block end to end (below).

## Home-repo install (v0.8.0)

`.cursor-plugin/plugin.json` `hooks` now points at `./harness/cursor/hooks.json`
(guarded by `harness/packaging.test.mjs`). `nd bootstrap --cursor` merges a
`preToolUse` entry into `~/.cursor/hooks.json` with the **absolute** command
`<home>/bin/nd --cursor` (Cursor does not follow a plugin symlink), replacing
any earlier `nd --cursor` entry and keeping other hooks. `nd --cursor` remains
the transport for one more release; it is a shim over `harness/cursor/run.mjs`.
The merged file and the relocated manifest were not re-run against a live
`cursor-agent`. An npm install is no longer offered.

Coming from the plugin-marketplace route? Remove it **before**
`nd bootstrap --cursor`, or the plugin's `nd --cursor` hook and the merged
`<home>/bin/nd --cursor` entry both fire on every `preToolUse` (bootstrap does
not inspect Cursor's plugin store): uninstall the No Deceit plugin in Cursor
(Settings → Plugins → No Deceit → Uninstall), then drop the marketplace with
`cursor-agent plugin marketplace remove github.com/PDepaula/no-deceit`.

## Live-verified (2026-09-18) and marketplace manifest (Phase 6)

Reverse-engineered `cursor-agent`'s plugin-marketplace schema from its
bundled CLI (it is not documented publicly at this date): the manifest
search order is `.cursor-plugin/plugin.json` → `.claude-plugin/plugin.json`
→ `plugin.json`, and marketplaces are `.cursor-plugin/marketplace.json` →
`.claude-plugin/marketplace.json`. Cursor's plugin schema is a superset
compatible with Claude Code's (same `agent-plugins.org` shape: `commands`,
`agents`, `skills`, `rules`, `hooks`, `mcpServers`), and `hooks` accepts
either an inline object or, as used here, a path string.

- `cursor-agent plugin marketplace add github.com/PDepaula/no-deceit` (no
  repo changes needed) indexed the plugin from the existing
  `.claude-plugin/marketplace.json` + `plugin.json` and
  `cursor-agent plugin marketplace list` showed it — the "already Cursor-
  discoverable via the Claude-shaped manifest" half of this task's premise
  held before any change here.
- But **the plugin's actual hook wiring did not** hold as-is: pointed at
  the unmodified repo (`--plugin-dir`, a local dev-load path; see caveat
  below), a live Tier 1 write went through uncaught. Convention-based hook
  discovery falls back to `hooks/hooks.json` when `plugin.json` has no
  explicit `hooks` field, and this repo's `hooks/hooks.json` is the
  Claude-Code-shaped file (PascalCase `PreToolUse`/`Stop`/`MessageDisplay`
  event names, `{matcher, hooks:[{type,command}]}` items) — not the flat
  lowerCamelCase `{version, hooks:{preToolUse:[{command,failClosed,timeout}]}}`
  shape Cursor's own hook runner expects (`harness/cursor/hooks.json`).
  Reusing the Claude manifest wholesale would silently ship a marketplace
  entry that indexes but does not enforce.
- Fix: `.cursor-plugin/plugin.json` (new) sets `"hooks":
  "./harness/cursor/hooks.json"` explicitly, so Cursor's manifest-priority
  resolution picks the Cursor-shaped file over the Claude one, without
  touching `.claude-plugin/plugin.json` (Claude Code keeps its own
  `hooks/hooks.json` via the same convention, unaffected — `.cursor-plugin/`
  is not a directory Claude Code looks at).
- With that override in place, the same forced-write test via `--plugin-dir`
  (real `nd --cursor`, project turned into the actual workspace via the
  *non*-`--plugin-dir` path below) denied the write: `nd --cursor` returned
  `{"permission":"deny","user_message":"No Deceit Tier 1 (Tutor). ..."}` and
  no file was created. Confirmed independently with a fake `nd` shim under
  `--plugin-dir` (to isolate manifest-parsing from the cwd caveat below):
  the fake binary's forced deny was honored end to end.
- **`--plugin-dir` caveat, not a product bug:** `cursor-agent --plugin-dir
  <path>` (a local dev-load flag, not the installed-plugin path) runs the
  `preToolUse` hook subprocess with the *plugin's own directory* as `cwd`,
  not the project workspace being edited — even though `workspace_roots` is
  present in the hook's stdin payload. `bin/nd --cursor` resolves its
  project root from `process.cwd()` (`bin/nd:23`), so under `--plugin-dir`
  it looks for `.no-deceit` next to the plugin instead of in the real
  project and allows. The **documented production install**
  (`.cursor/hooks.json`, no `--plugin-dir`) does not have this problem —
  verified separately: same forced write, `cwd` correctly resolved to the
  real project, denied as expected. This is purely a quirk of the
  `--plugin-dir` dev-loader, not a gap in the shipped adapter; not changed,
  not filed as a bug.

## Verified in this build

The adapter is verified by `node --test` with Cursor **not** required in CI:

- **`harness/cursor.test.mjs`** — `handleCursorPayload`:
  - Tier 1 `Write` → `{permission:"deny", user_message, agent_message}` exit 0
  - `Read` → `{permission:"allow"}`
  - `Shell` source redirect → deny
  - `Task` → `{permission:"ask"}` (see gap below)
  - `FM_TASK_ID` → allow
  - thrown evaluator → fail-closed deny, still exit 0
  - `harness/cursor/hooks.json` parses as `preToolUse` → `nd --cursor` with
    `failClosed: true`
- **`bin/nd.test.mjs`** — `node bin/nd --cursor` with stdin JSON prints the
  same deny/allow objects.
- **`harness/parity.test.mjs`** — Cursor `Write` / `path` yields the same
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
`hooks/hooks.json`). Use `harness/cursor/hooks.json`. If both a
Claude-settings hook and this Cursor hook were registered, both would fire;
`--cursor` marks this invocation as the Cursor registration.

## Install (attended session; no firstmate required)

The README's "Install: a home repo, not a package" section owns the install
steps (`nd bootstrap --cursor`, or the Cursor plugin marketplace route). For
the marketplace route `nd` must still be on `PATH` for the hook command to
resolve (a marketplace install does not put a `bin/` on `PATH` by itself): put
a checkout's `bin/` on `PATH`.

Cursor reads `SKILL.md` natively (including from `~/.claude/skills/`), so the
teaching layer needs no wrapper. `failClosed: true` is set so a crash or
invalid JSON blocks rather than failing open.
