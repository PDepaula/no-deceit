# Verification — Pi (Phase 4)

What was verified for the Pi adapter, how, and against which versions.
Convention borrowed from firstmate's adapter notes: record the evidence, don't
re-prove settled primitives.

- **Environment:** Pi `0.85.1`, `node v24.5.0`, Linux. Date: 2026-09-17.
  Extension shape is `tool_call` returning `{ block: true, reason }` (Pi
  `docs/extensions.md`; firstmate field note: returning `{block: true}`
  prevents the bash command from running, verified 2026-07-09 against Pi
  0.80.5). Tool-call errors also block (fail-safe). This build did not
  re-prove that primitive live in a TUI; CI mocks the extension I/O.

## Verified in this build

The adapter is verified by `node --test` with Pi **not** required:

- **`adapters/pi.test.mjs`** — `createPiExtension` against a fake `pi.on`:
  - `write` of source at Tier 1 returns `{block:true, reason}` matching Tier 1
  - `read` returns `{}`
  - `bash` source mutation at Tier 1 is blocked
  - `FM_TASK_ID` is a pass-through (`{}`)
- **`adapters/parity.test.mjs`** — Pi `write` / `path` yields the same core
  decision as Claude-shaped `Write` / `file_path`.
- **`adapters/map-tool.test.mjs`**, **`adapters/apply.test.mjs`** — Pi names
  map onto the classifier, and deny/ask become `{block:true, reason}`.

## Known parity gaps (stated plainly)

- **`MessageDisplay` redaction exists only in Claude Code.** Pi has Markdown
  transformers, but this port does not wire them; over-threshold code is not
  redacted on screen.
- **Turn-end text-channel enforcement is not this adapter.** The shipped Pi
  extension is `tool_call` only (the Phase 4 contract). A `Stop`-equivalent
  hard block of fenced chat / Tier 3 narration is not registered here.
- **No native `ask`.** Category F and unknown Bash, which are `ask` on Claude
  Code, are returned as `{block:true, reason}` so the adapter stays
  fail-closed (Pi's `tool_call` errors already fail-safe).

## Install (attended session; no firstmate required)

Keep the file inside a full clone so relative imports resolve:

```bash
git clone https://github.com/PDepaula/no-deceit ~/.claude/skills/no-deceit
ln -s ~/.claude/skills/no-deceit/adapters/pi/no-deceit.ts ~/.pi/agent/extensions/no-deceit.ts
# or project-local: .pi/extensions/no-deceit.ts → same target (after project trust)
cd <a project> && nd init
```

Do not copy the `.ts` file out of the clone; `../run.mjs` must resolve next
to it. Pi reads Agent Skills natively, so the teaching layer needs no wrapper.
