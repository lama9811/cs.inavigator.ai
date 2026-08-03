# Prerequisite reconciliation — worklist for department confirmation

**Date:** 2026-08-03
**Status:** applied in the repo; **NOT yet pushed to the live Vertex AI Search datastore**

## Why this happened

The same course table was hand-copied into four KB documents plus
`backend/data_sources/classes.json` (which drives the planner). Nothing checked the copies
agreed, and they drifted. A 50-question CS Nav evaluation found **ten courses** whose
prerequisites differed between documents.

This is worse than a missing fact. A gap makes the agent refuse and send the student to the
department — nobody is misinformed. A contradiction retrieves cleanly from both sides,
passes the grounding gate (the claim genuinely *is* sourced), and the model silently picks
one. Measured behaviour on COSC 241:

| Question asked | Answer given |
|---|---|
| "Does COSC 241 require MATH 141 or MATH 241?" | "**MATH 241**" |
| "I completed MATH 141 but not MATH 241 — am I eligible?" | "**Yes**, the prerequisite is MATH 141" |

Both confident, both grounded, opposite advice on a registration-blocking question. Re-running
the *same* question three times gave "MATH 241", "either", "MATH 241" — unstable.

## How the canonical value was chosen

`academic_11_course_prerequisites.json` and `academic_degree_requirements_core.json` list a
uniform `COSC 220` for six different 300/400-level courses — the signature of a generated
default rather than real catalog data. `academic_courses.json` and `classes.json` carry
specific, differing values and **agree with each other on 9 of 10 rows**. So the
specific-value pair was taken as canonical.

**`classes.json` is now the operational source of truth for prerequisites.** It is what the
planner enforces and what the admin Curriculum editor edits.

## The 10 rows — please confirm each against the official catalog

| Course | Was (conflicting) | Now | Confidence |
|---|---|---|---|
| COSC 241 | `MATH 141` vs `MATH 241` | COSC 112 + **MATH 241** | **High** — see note below |
| COSC 320 | `COSC 220` vs `COSC 220 + COSC 281` | COSC 220 + COSC 281 | High |
| COSC 323 | `COSC 220` vs `COSC 238 + MATH 312` | COSC 238 + MATH 312 | High |
| COSC 332 | `COSC 220` vs `COSC 112` | COSC 112 | High |
| COSC 338 | `COSC 220` vs `COSC 238` | COSC 238 | High |
| COSC 383 | `COSC 220` vs `MATH 242` | MATH 242 | High |
| COSC 385 | `COSC 281` vs `COSC 220 + COSC 281` | COSC 220 + COSC 281 | High |
| COSC 386 | `COSC 281` vs `COSC 220 + MATH 312` | COSC 220 + MATH 312 | High |
| COSC 460 | `COSC 220` vs `COSC 220 + MATH 241` | COSC 220 + MATH 241 | High |
| **COSC 201** | `none` vs `COSC 112` | **COSC 112** | **LOW — please confirm** |

### COSC 241 (high confidence)
**MATH 141 is never defined as a course anywhere in the KB.** It appears in exactly three
lines: two of the disputed prerequisites, and once as an alternative *entry path into*
MATH 241. MATH 241 (Calculus I, 4 credits) is defined and is one of the four required
supporting courses. That reads as a stale value corrected in two documents and missed in two.

### COSC 201 (low confidence — the one real judgement call)
Genuinely 2–2: `academic_11` and `degree_requirements_core` say COSC 112;
`academic_courses` and `classes.json` said no prerequisite. **COSC 112 was chosen as the
more conservative value** (it blocks rather than permits), and because COSC 201 sits after
COSC 112 in the required core sequence. **This also changes planner behaviour** — students
without COSC 112 will no longer see COSC 201 as eligible. Revert this row if the department
says Computer Ethics has no prerequisite.

## Files changed

- `backend/kb_structured/academic_11_course_prerequisites.json` (8 rows)
- `backend/kb_structured/academic_degree_requirements_core.json` (8 rows)
- `backend/kb_structured/academic_courses.json` (2 rows)
- `backend/kb_structured/academic_degree_requirements_electives.json` (1 row)
- `backend/kb_structured/academic_10_cloud_computing_degree.json` (1 row)
- `backend/data_sources/classes.json` (COSC 201)

## Remaining step: push to the live datastore

**The live KB still serves the old contradictory values.** Editing these files does not
update the Vertex AI Search datastore (`csnavigator-kb-v7`). Push them via the admin
dashboard (instant, no re-index — `datastore_manager.update_document`, wired at
`main.py:7548`), or with `backend/scripts/upload_kb_files.py`.

Deliberately left for a human: this changes the academic advice students receive.

## Guard against recurrence

`backend/tests/test_kb_prereq_consistency.py` diffs every prerequisite row across all five
sources and fails on any disagreement, naming the offending file. Verified to catch the
regression by reintroducing MATH 141.

It does **not** validate correctness against the official catalog — only that the sources
agree with each other. Ten documents can agree and still all be wrong.
