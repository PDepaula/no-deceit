# Changelog

All notable changes to this skill are recorded here. Format is loosely
based on [Keep a Changelog](https://keepachangelog.com/).

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

<!--
## [Unreleased]
- (next changes go here)
-->
