# Popular Questions — Frequency-Ranked Landing Suggestions

**Date:** 2026-06-30
**Status:** Approved

## Goal

The post-login landing view (the chat WelcomePanel) should show the **10 questions
most frequently asked by users**, instead of 8 randomly chosen questions from a static
pool. A question asked many times bubbles to the top.

## Current state

- The landing view is `frontend/src/components/chatbox/WelcomePanel.jsx`, rendered by
  `Chatbox.jsx` whenever a fresh chat has no messages (i.e. right after login). It needs
  no structural change — it already maps over a `suggestions` array into a 2-column grid.
- `Chatbox.jsx` (~line 514) fetches `GET /api/popular-questions` and currently keeps the
  first **8** (`slice(0, 8)`).
- `GET /api/popular-questions` (`backend/main.py:4852`) currently returns
  `random.sample(QUESTION_POOL, 8)` — a static curated pool, **not** real usage.
- Every chat question is already persisted to `ChatHistory.user_query`
  (`backend/models.py:8`). No new tracking code is required.

## Approach

**Compute on-the-fly in the existing endpoint, with a short in-memory cache.** Chosen
over a dedicated counter table or a materialized snapshot because `chat_history` is small,
it needs no schema change/migration, and it adds nothing to the hot chat write path.

## Design

### Backend — rewrite `GET /api/popular-questions` (`backend/main.py`)

- Add `from sqlalchemy import func` (not currently imported) and give the endpoint a
  `db: Session = Depends(get_db)` parameter.
- Query: group `chat_history` by `LOWER(TRIM(user_query))`, select `COUNT(*)` as
  frequency and `func.max(user_query)` as a representative display string (so the wording
  shown is a real user phrasing), `ORDER BY frequency DESC`, `LIMIT 10`.
- **Filler guard (the only filter):** exclude rows whose trimmed length is `< 15` chars,
  and whose normalized text is in a small stop-list of greetings/filler
  (`hi, hello, hey, thanks, thank you, ok, okay, yes, no, yep, nope, sup, yo`, etc.).
- **No quality threshold and no curated fill** to force a count of 10 — pure frequency.
  If only 6 real questions qualify, the endpoint returns 6.
- **Fallback only when the result is empty** (fresh DB, or DB/query error): return a
  sample from the existing curated `QUESTION_POOL` so the panel is never blank. The
  curated pool remains in the file solely as this safety net.
- **Cache:** a module-level `(timestamp, questions)` tuple with a 5-minute TTL so repeated
  landings don't re-run the aggregation.
- Response shape is unchanged: `{"questions": [...]}`.

### Frontend — show 10 (`Chatbox.jsx`)

- Change `data.questions.slice(0, 8)` → `slice(0, 10)`. `WelcomePanel` renders all of
  `suggestions`, so the grid simply grows to up to 5 rows. No CSS change.

### Data flow

Unchanged. Questions already flow into `ChatHistory.user_query` on every chat, so the
ranking self-populates over time.

## Decisions & tradeoffs (accepted)

- **Exact-match grouping** (case-insensitive, whitespace-trimmed). Near-duplicate
  phrasings count separately — accepted; no semantic clustering.
- **All chat questions count regardless of mode** — `ChatHistory` has no mode column.
- **Pure frequency, minimal filler guard only** — no broader quality/spam filtering.

## Out of scope

- Semantic clustering of similar questions.
- Admin curation/ordering of the live list.
- Per-mode (coding tutor vs chat) separation.
