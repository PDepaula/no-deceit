# Open Threads / Design Notes

Running list of unresolved questions and ideas for the skill. Move items
into `CHANGELOG.md` once actually decided and implemented in `SKILL.md`.
Consider migrating this to GitHub Issues once other people start using
the skill and contributing friction points.

## Not yet decided

- **Khononov's connascence** ("Balancing Coupling in Software Design") was
  considered as an additional Coach Mode lens but left out. It may
  substantially overlap with the existing Simple vs Easy (Hickey) frame —
  neither confirmed nor ruled out, since neither the book nor the overlap
  has been examined closely enough yet. Revisit if a concrete case shows
  the existing lenses are insufficient.
- Whether Ousterhout's "deep modules" (*A Philosophy of Software Design*)
  deserves a secondary/optional-lens appendix for larger-system
  architecture questions, rather than staying fully excluded. Currently
  excluded because it assumes an OO/interface-programming worldview that
  doesn't transfer cleanly to Clojure. Revisit with a concrete case.

## Not yet done

- Actual sustained use of the skill in practice (Tier 1 / Coach mode on
  full-stack product work, Clojure/ClojureScript with tools.deps and
  shadow-cljs). The tooling-exception addition was itself the direct
  result of early friction here — expect more refinements from real use.
- A thin Cursor / VS Code wrapper file, for people who want to use this
  outside Claude Code / OpenCode (which read `SKILL.md` natively).

## Natural next steps

1. Keep collecting real-usage friction points — this has been the most
   productive way to refine the skill so far (see the tooling exception).
2. Decide on Ousterhout / Khononov once a concrete case for either comes
   up.
3. Consider whether Tier 3 ("Narrated Velocity Mode") needs a worked
   example once it's actually been invoked under real deadline pressure.
4. Draft the Cursor/VS Code wrapper file if/when needed.
