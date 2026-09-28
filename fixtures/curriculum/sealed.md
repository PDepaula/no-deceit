---
topic: etl-basics
part: sealed
---

SEALED: for the No Deceit tutor and grader only. Not for the learner.

## Concept map

C1 batch and stream, then C2 where the join happens.

## Concepts

### C1. Batch and stream
**Claim.** A batch job sees a bounded input and finishes; a stream job sees an unbounded input and does not.
**Kind.** concept
**Threshold.** yes
**Mechanism.** Batch processing reads a fixed set of records, computes, and writes a result once (S1 ch. 10). A stream processor keeps reading and updating a result as records arrive (S1 ch. 11), so it must decide what to do with late records.
**Depends on.** none
**Keywords.** batch; stream; replay
**Misconception traps.**
- Stream always means real time. (from: common-usage)
**Boundary.** A micro-batch job blurs the line; the claim is about the input, not the latency.
**Transfer prompts.**
- Prompt: In one of your pipelines, which job could have been a stream, and what would change for the report?
  Criteria: Names a real job, states what input becomes unbounded, names one cost (late records, replay) and a condition under which the batch is still better.

### C2. Where the join happens
**Claim.** A join can run at ETL time, at query time, or on the client, and each moves staleness and cost to a different place.
**Kind.** concept
**Threshold.** no
**Mechanism.** Joining at ETL time pays once and serves stale data until the next run; joining at query time is fresh and pays on every read (S1 ch. 10).
**Depends on.** C1
**Keywords.** join; materialised view; staleness
**Hint keywords.** query time (no neutral term names the read-side option)
**Misconception traps.**
- ETL means nightly. (from: common-usage)
- A materialised view is a cache that cannot be wrong. (from: databases)
**Boundary.** Applies where the same join is read many times.
**Transfer prompts.**
- Prompt: Name a screen in your project where the client does the join. Should it?
  Criteria: Names the screen, states the staleness the move would buy or cost, and gives a falsifiable flip condition.
