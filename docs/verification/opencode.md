# Verification — OpenCode (Phase 4)

What was verified for the OpenCode adapter, how, and against which versions.
Convention borrowed from firstmate's adapter notes: record the evidence, don't
re-prove settled primitives.

- **Environment:** OpenCode `1.18.30`, `node v26.2.0`, Linux. Date: 2026-09-18.
  Plugin shape is `tool.execute.before` throwing to deny (OpenCode plugin
  docs; firstmate field note: throwing prevents the command from running and
  surfaces the thrown message as the failed tool result, verified 2026-07-09
  against OpenCode 1.17.15). CI mocks the plugin I/O; this build additionally
  ran a real `opencode run` session (below) to validate the npm-packaging
  entry point, with a mixed result recorded as a known gap.

## npm packaging (Phase 6)

`opencode plugin <module>` ("install plugin and update config") requires the
target to "expose plugin entrypoints in package.json": `exports["./tui"]`,
`exports["./server"]`, or a bare `main` (detected as the server target).
Confirmed live: `opencode plugin <path-with-no-main>` fails with *"does not
expose plugin entrypoints in package.json"*; adding
`"main": "adapters/opencode/no-deceit.ts"` to `package.json` makes the same
command report *"Detected server target"* and write the module path into
`plugin` in `.opencode/opencode.json` (or the global config with `-g`).
Re-verified against the actual npm tarball (`npm pack`, extract, `opencode
plugin <extracted-dir>`) — same result, so this also works post-publish, not
just against the working tree.

A real `opencode run` session with the plugin installed this way (Tier 1
project, live model) correctly evaluated a `skill` tool call through the
gate (`governed:true`, category A, allow) — the plugin loads and receives
real `tool.execute.before` events. It did **not** reliably block a forced
`write` call in this session, and instrumentation traced the cause to the
plugin's own `({directory, worktree}) => cwd = worktree || directory`
fallback (`adapters/opencode/plugin.mjs`): in a project directory that is
not itself a git repository, this OpenCode build reports `worktree: "/"`
(not empty/undefined), so the adapter resolves `cwd` to `/` instead of the
real project directory and `core/state.mjs`'s `isGoverned()` then looks for
`.no-deceit` at `/` and reports the project ungoverned. With the test
project turned into a real git repo, `worktree` correctly equals the project
path and the gate evaluates correctly (governed, Tier 1, category A) — the
gap only reproduces for a governed project that is not a git repository.
This is an adapter wiring issue, not a packaging one; recorded here rather
than fixed, per this task's scope (packaging/docs only, no adapter decision-
logic changes).

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
- **`worktree`-vs-`directory` cwd fallback misresolves for a governed,
  non-git project.** See "npm packaging" above — a real fix belongs in
  `adapters/opencode/plugin.mjs`'s cwd resolution, out of scope for this
  packaging pass.

## Install (attended session; no firstmate required)

Once published to npm (a captain step — see the README's install matrix and
the main `README.md` "Publish" note):

```bash
opencode plugin no-deceit
cd <a project> && nd init
```

Fallback (manual, no npm publish involved) — clone stays a full tree so
relative imports resolve:

```bash
git clone https://github.com/PDepaula/no-deceit ~/.claude/skills/no-deceit
# Point OpenCode at the plugin file inside that clone, e.g. in opencode.json:
#   { "plugin": ["~/.claude/skills/no-deceit/adapters/opencode/no-deceit.ts"] }
# or symlink that file into ~/.config/opencode/plugins/ (do not copy it).
cd <a project> && nd init
```

OpenCode already reads `~/.claude/skills`, so the teaching `SKILL.md` loads
without a wrapper either way.
