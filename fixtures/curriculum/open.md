---
topic: etl-basics
mission: I own a small reporting pipeline and keep patching it without knowing where a join should live. I want to be able to say where each join belongs and what that choice costs me.
built: 2026-09-25 by nd-scout (sonnet)
reviewed: no
answer_keys_do_not_quote:
  - "S2 (worked pipeline solutions)"
sources:
  - id: S1
    kind: book
    title: "Designing Data-Intensive Applications"
    sections: ["ch. 10 Batch Processing", "ch. 11 Stream Processing"]
    verified: 2026-09-25
    access: paid
  - id: S2
    kind: url
    title: "Example pipeline walkthrough"
    sections: ["Full page"]
    verified: 2026-09-25
    access: open
    url: https://example.invalid/pipeline
---

## Mission

I own a small reporting pipeline and keep patching it without knowing where a join should live. I want to be able to say where each join belongs and what that choice costs me.

## Sources

S1 and S2 in the frontmatter, with the sections to read.

## Reading sessions

### Session 1
- Read: S1 ch. 10.
- Practice: run the nightly report for one customer and note which step reads which table.
- Unlocks: naming where each join in the report happens.

### Session 2
- Read: S1 ch. 11.
- Practice: list what your dashboard does with a row the moment it arrives.
- Unlocks: judging what staleness the dashboard tolerates.

## Keywords

- backpressure
- batch
- join
- materialised view
- replay
- staleness
- stream
