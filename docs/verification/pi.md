# Verification — Pi (Phase 4)

What was verified for the Pi adapter, how, and against which versions.
Convention borrowed from firstmate's adapter notes: record the evidence, don't
re-prove settled primitives.

- **Environment:** Pi `0.85.1`, `node v26.2.0`, Linux. Date: 2026-09-18.
  Extension shape is `tool_call` returning `{ block: true, reason }` (Pi
  `docs/extensions.md`; firstmate field note: returning `{block: true}`
  prevents the bash command from running, verified 2026-07-09 against Pi
  0.80.5). Tool-call errors also block (fail-safe). CI mocks the extension
  I/O; this build additionally re-proved the live primitive once (below).

## Live-verified (2026-09-18)

Ran a real, non-interactive Pi session (`pi -e adapters/pi/no-deceit.ts -p
"..."`, model `ollama/qwen3.8:27b`) against an `nd init`-governed Tier 1
project, with a temporary logging shim around `createPiExtension` to record
the exact `tool_call` event and the gate's decision. Told the model to call
`write` immediately with no skill lookup:

- Pi's model called `write({path:"hello.py", content:'print("hi")\n'})`.
- The extension's `tool_call` handler received it and the core returned
  `{decision:"deny", category:"E", reason:"No Deceit Tier 1 (Tutor). Writing
  source is blocked, ..."}` with a `ledgerEntry` for the denial.
- Pi surfaced that as a blocked tool result; the model's final reply was
  "The write was blocked by the tutor policy — so let's turn it into a check
  on your own understanding instead" and no `hello.py` was created.

This confirms the primitive this doc previously only asserted from a
firstmate field note: Pi's `tool_call` → `{block:true}` really does stop the
write, end to end, through this adapter's own `evaluateHarnessCall` wiring —
not just in the mocked unit tests below.

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

## Pi package manifest (Phase 6)

`package.json` declares a `pi` manifest (`packages.md`: "Add a `pi` manifest
to `package.json` ... Include the `pi-package` keyword for discoverability"):

```json
"keywords": ["...", "pi-package"],
"pi": { "extensions": ["./adapters/pi/no-deceit.ts"], "skills": ["./skills"] }
```

The extension is listed explicitly (it lives at `adapters/pi/no-deceit.ts`,
not the `extensions/` convention dir Pi would auto-discover). Verified with
`pi -e git:github.com/PDepaula/no-deceit` (or `pi -e .` from a local clone)
loading both the extension and the `no-deceit` skill without error — see the
live-verified run above, which used exactly that `-e` path. `adapters/packaging.test.mjs`
asserts the manifest paths actually resolve, so a future rename fails CI
instead of silently breaking `pi install`.

## Install (attended session; no firstmate required)

```bash
pi install git:github.com/PDepaula/no-deceit@<tag>
cd <a project> && nd init
```

This registers the package (extension + skill) in Pi's settings — see
[Pi Packages](https://pi.dev/docs) for `-l` (project-local) vs. user-level
install and how to pin a ref. It also makes the plugin discoverable in the
[package gallery](https://pi.dev/packages) via the `pi-package` keyword,
once published there (a captain step — this task does not submit it).

Fallback (manual symlink, no package manifest involved): keep a full clone
so relative imports resolve, then symlink the extension in — do not copy the
`.ts` file out of the clone, `../run.mjs` must resolve next to it:

```bash
git clone https://github.com/PDepaula/no-deceit ~/.claude/skills/no-deceit
ln -s ~/.claude/skills/no-deceit/adapters/pi/no-deceit.ts ~/.pi/agent/extensions/no-deceit.ts
# or project-local: .pi/extensions/no-deceit.ts → same target (after project trust)
cd <a project> && nd init
```

Pi reads Agent Skills natively, so the teaching layer needs no wrapper
either way.
