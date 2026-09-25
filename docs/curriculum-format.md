# Curriculum format

A curriculum is what Tier 1 tutors *from*. It is two files under
`<data home>/curricula/<topic>/` (`nd doctor` prints the data home). The split
follows the audience: what the learner may read and what only the tutor and the
grader may read.

| File | Read by | Holds |
|---|---|---|
| `open.md` | the learner | mission, sources, reading sessions, one flat keyword list |
| `sealed.md` | the tutor and the grader | concept map, per-concept claim and mechanism, traps, transfer prompts with their criteria |

The learner is meant to build the grouping, ordering and evaluation of the
ideas themselves. Anything in `open.md` that shows the shape of the topic
(groups, order, emphasis, definitions) primes a mental model they should form
on their own, so `open.md` carries the topic's *extent* and never its *shape*.

## `open.md`

```markdown
---
topic: <slug>
mission: <why the learner is learning this, two to four sentences, on one line>
built: <date> by nd-scout (<model>)
reviewed: no
answer_keys_do_not_quote:
  - "<source id or path of a source that holds worked answers>"
sources:
  - id: S1
    kind: book | url | path
    title: "<title>"
    sections: ["<chapter, heading, page range>", "..."]
    verified: <date the sections were checked against the source>
    access: open | browser-only | paid
    url: <for kind url>        # or path: <for kind path>
---

## Mission
## Sources
## Reading sessions
### Session 1
- Read: <source id and sections>
- Practice: <forms to run or things to try, never their results>
- Unlocks: <what the learner can do after it>
## Keywords
- <one flat list>
```

- **Mission.** Why the learner is learning this, in their words. It decides
  what to leave out: each entry has to justify itself against it. The tutor
  quotes it when the learner drifts.
- **Sources.** Structured, so they can be checked: `sections` lists exactly
  what to read, `verified` says when someone last confirmed those sections
  exist, `access` says whether they are open, browser-only or paid. A source
  that holds worked answers is named in `answer_keys_do_not_quote`: the tutor
  and the grader may use it for facts about the format, never quote its answers.
- **Reading sessions.** Plain `Read`, `Practice` and `Unlocks` lines. This is
  the one prose place the learner could be primed, so: no bold or emphasis, no
  results of the practice forms, no explanation of how the ideas relate.
- **`reviewed:`** is advisory. Tier 1 needs the files to exist and be
  non-trivial; it does not need `reviewed: yes`. `nd status` nudges while it is
  `no`. Review only the mission, sources and session outline
  (`nd curriculum review <topic>`), so review does not spoil the topic.

### Keyword list rules

The `## Keywords` section is one flat list of the topic's terms.

1. One flat list. No headings, no sub-lists, no blank lines splitting it, and no
   intro or other prose in the section.
2. Alphabetical, case-insensitive (lowercase, code-unit order).
3. Plain text: no bold, italic or code formatting, nothing else that draws the eye.
   A literal `*` or `_` is written escaped (`\*in\*`).
4. Terms, not definitions: no dash-explanations, no `term: meaning`, and nothing
   longer than a short phrase.
5. Not grouped by session and not ordered by dependency; mixed granularity is fine.
6. **Rule-naming keywords are hints.** A keyword that names a rule ("trailing
   empty string", "insertion order") gives part of the answer away. Prefer a
   neutral term (the function or thing involved). A rule-naming keyword is allowed
   only when no neutral term exists, and it must be declared in the sealed part
   as a hint keyword with the reason (below), so the reviewer can see and veto it.
7. The list is generated from the sealed concepts (`nd curriculum build`
   regenerates it) and is never edited by hand independently of them.

`nd curriculum check <topic>` audits rules 1–5 on a hand-written list.

## `sealed.md`

```markdown
---
topic: <slug>
part: sealed
steps:                       # optional, for procedural topics
  - id: 1
    title: "<step>"
    files: [<files or artefacts the step produces>]
---

SEALED: for the No Deceit tutor and grader only. ...

## Concept map
<the scout's dependency-ordered map: the tutor's, not the learner's>

## Concepts
### C1. <title>
**Claim.** <one testable claim>
**Kind.** concept | procedure | fact
**Threshold.** yes | no
**Unlocks.** <a declared step id; only if the file has `steps:`>
**Mechanism.** <3-6 sentences, the what and why, with source locators>
**Depends on.** <concept ids>
**Keywords.** term; term; term
**Hint keywords.** <rule-naming term> (<why no neutral term exists>)
**Misconception traps.**
- <trap> (from: <origin, e.g. javascript, common-usage, catalog id>)
**Contrast set.** <optional: 3-5 concrete cases, adjacent pairs differing in one deep feature, results withheld>
**Boundary.** <where the concept stops applying>
**Project constraint.** <optional: a limit of the project's tooling, kept apart from the conceptual boundary>
**Transfer prompts.**
- Prompt: <a question asked of the learner about one of their own systems>
  Criteria: <what a competent answer contains, written together with the prompt>
```

- One testable **claim** per concept. **Kind** follows the content: `procedure`
  is something executed on fresh instances, `fact` is arbitrary and not
  derivable, `concept` is the rest. Flag only the one to three **threshold**
  concepts that reorganise everything after them.
- Work **backward** from the learner's stated goal: what must they be able to do,
  and what does each capability need first. The source's chapter order is not the
  concept order.
- Seed **misconception traps** from a documented catalog where one exists;
  every trap carries its `(from: ...)` origin so the tutor can ask "what would
  that habit do here?".
- Write every **transfer prompt together with its criteria**. The grader's fixed
  P1–P5 rubric stays the grader; the criteria are for the tutor and never require
  a learner's answer to match the sealed map.
- `answer_keys_do_not_quote` applies here too.

The tutor may read `sealed.md`. It never quotes, recites or paraphrases it to the
learner, and at Tier 1 never reveals a concept the learner has not attempted.
This is enforced by instruction and by the offline audit, not by a read block.

## Not in this format yet

Follow-ups noted from the first field test, deliberately deferred: a per-topic
`rubric_emphasis`, a per-concept `Illustration` slot, the split of `Boundary`
into conceptual and project constraint as required fields, command-output
evidence, per-concept `Unlocks` reporting in `nd status`, and Bash for the scout
on procedural topics.
