# Conversation Memory for CS Navigator — Design Spec

**Date:** 2026-07-20
**Status:** Approved design, pending implementation plan
**Author:** lama9811 (with Claude)

## Summary

Port the proven, production-live memory system from the sibling **ORA Navigator**
project into **CS Navigator**, adapted from research-admin faculty to CS students.

CS Navigator already contains a *dead skeleton* of this system (same author copied the
code): the `UserMemory` model, a partial `services/memory_service.py`, and a read path
that runs on every chat request. But the write path was never wired — its only trigger is
`POST /api/internal/memory/consolidate`, which needs a Cloud Scheduler job, and the
**Cloud Scheduler API is disabled in project `cs-navigator-498115`** (verified
2026-07-20). So `user_memories` is empty and the injected memory string is always `""`.

This spec brings CS Navigator to parity with ORA's five-layer design, which is the
correct architecture: it treats the ADK session as a latency cache only and reconstructs
all conversational context from Cloud SQL on every turn, delivering it via
`state_delta["memory"]`.

### Problem this solves

Diagnosed in the same session:

- **Within-conversation flakiness (Layer 1/2).** Nothing carries prior turns. The request
  sends only `{query, session_id, mode}`; the `/chat/stream` prompt contains no history
  (a comment at `main.py:3152` says *"ADK manages its own memory"*). The only real
  turn-to-turn memory rides on ADK session reuse, which is invalidated by a query-dependent
  `context_hash`, stored in-memory across a 0–3 instance service with no affinity, and
  bypassed entirely by cache/video/greeting fast paths. Result: the model appears to
  remember only when consecutive turns luck into the same instance + same context string.

- **No cross-session memory (Layer 3/4).** A returning student is a stranger every session.

### Non-goals

- Frontend Memory-tab UI. Backend endpoints are ported (list/edit/pause/delete/erase),
  but no React component consumes them yet — matches ORA's current state. UI is a clean
  follow-on.
- Fixing the reminders / live-seats crons. They share the disabled-Scheduler-API blocker
  and are almost certainly not firing, but that is tracked separately.
- Migrating to a real vector index (pgvector). Embeddings stay JSON-in-TEXT with a
  Python cosine scan, as in ORA — adequate at current scale.

## Architecture

Five layers, all reconstructed backend-side per request and delivered to the ADK agent as
one `state_delta["memory"]` string. The ADK session is never trusted to hold memory.

```
browser → frontend → backend (/chat/stream)
   │
   ├─ [read, per request, in parallel via asyncio.gather]
   │    Layer 1  last-5 ChatHistory turns for (user, session)   → "PRIOR CONVERSATION:"
   │    Layer 2  latest session_summary for (user, session)     → "EARLIER IN THIS SESSION:"
   │    Layer 3  fetch_user_memories (recent 10 facts)          → "USER MEMORY (long-term):"
   │    Layer 4a retrieve_relevant_memories (cosine top-5)      → "RELEVANT FROM PAST MEMORIES:"
   │    Layer 4b retrieve_relevant_turns   (cosine top-3)       → "FROM PAST CONVERSATIONS:"
   │         → build_memory_context() concatenates all sections
   │         → query_agent_stream(..., memory_context=…)
   │         → vertex_agent state_delta["memory"] = memory_context   (already wired)
   │         → agent.py ctx.state.get("memory")  (already wired, sanitized)
   │
   └─ [write, after HTTP response sent — zero added latency]
        _schedule_post_commit_memory_tasks(user_id, session_id, chat_id):
          • _schedule_session_summary       (Layer 2, self-gates at ≥8 turns)
          • _schedule_embed_turn            (Layer 4, embeds this turn)
          • _schedule_realtime_extraction   (Layer 3, every 6 turns, per-user lock)
          • _schedule_touch_last_chat       (marks users.last_chat_at for idle sweep)
```

### Crons (require enabling Cloud Scheduler API first)

- `POST /api/internal/memory/consolidate` — daily 3am ET safety-net, all users, 24h window.
- `POST /api/internal/memory/idle-sweep` — every 5 min, users idle 5–10 min, 2h window.

Both guarded by the existing `X-Research-Secret` header pattern.

## Components

Ported from ORA (`ora-navigator/backend/…`) into CS Navigator, adapted. Reference line
numbers are ORA's source unless noted.

### 1. Schema (`backend/models.py`)

Extend existing models. Column types match CS Navigator's MySQL 8.0 (MEDIUMTEXT for
embeddings/summaries).

`UserMemory` (already exists at `models.py:206`) — add:
- `embedding` MEDIUMTEXT NULL — JSON-encoded 256-float list.
- `embedding_model` VARCHAR(64) NULL — e.g. `"text-embedding-004@256"`.
- `paused` BOOLEAN NOT NULL DEFAULT FALSE — per-row skip in semantic retrieval.

`ChatHistory` (already exists at `models.py:8`) — add:
- `session_summary` MEDIUMTEXT NULL — Layer 2 rolling summary (latest non-null wins).
- `summary_through_id` INT NULL — highest turn id the summary covers (incremental).
- `embedding` MEDIUMTEXT NULL — per-turn embedding (Layer 4).
- `embedding_model` VARCHAR(64) NULL.
- `topic_label` VARCHAR(128) NULL.

`User` — add:
- `last_chat_at` DATETIME NULL — idle-sweep marker.

**Deliberately dropped from the ORA port:** `users.memory_paused` (dead schema in ORA —
declared, migrated, never read). CS Navigator will not carry it.

### 2. Migrations — follow CS Navigator's convention, NOT ORA's

ORA uses a standalone `migrate_db.py`. CS Navigator's idiom is different and simpler:
`init_db()` in `main.py` introspects `information_schema` once, then `ALTER TABLE … ADD
COLUMN` for anything missing (see `main.py:199–291`). Each new column above is added to its
model **and** listed in `init_db` with a guarded `ADD COLUMN`. On a fresh DB,
`Base.metadata.create_all` builds the full schema from the models; on the existing prod DB,
`init_db` adds the columns on next boot. No separate script.

### 3. `backend/services/embedding_util.py` (new)

Port ORA's module. CS Navigator already proves the exact genai client pattern in
`cache.py` (`genai.Client`, `models.embed_content`, `EmbedContentConfig(output_dimensionality=…)`),
so this mirrors known-good code. A standalone module (not cache.py's bound method) because
memory uses 256 dims and needs the helpers independently.

- `DEFAULT_MODEL = "text-embedding-004"`, `DEFAULT_DIMS = 256`.
- `embed_text(text, *, model, dims) -> Optional[list[float]]` — 4 attempts with backoff
  `(0, 0.2, 1.0, 5.0)`; never raises; empty input → None.
- `cosine_sim(a, b) -> float` — numpy; 0.0 on empty/zero-norm.
- `embed_text_throttled(...)` — `EMBEDDING_MAX_RPM` (default 50) sliding-window throttle;
  used by backfill only. Hot chat path uses `embed_text`.

### 4. `backend/services/memory_service.py` (extend existing)

CS Navigator's file has the batch skeleton (`consolidate_user_memories`,
`_extract_memories`, `_merge_memories`, `fetch_user_memories`, `build_memory_context`).
Port the rest from ORA and adapt:

- **Adapted extraction prompt** (see "Filtering" below) — student categories, GPA/grades excluded.
- `_serialize_embedding` / `_deserialize_embedding` (JSON), `EMBEDDING_MODEL_VERSION = "text-embedding-004@256"`.
- `retrieve_relevant_memories(user_id, query, k=5, threshold=0.55)` — cosine over non-paused,
  embedded `UserMemory` rows.
- `retrieve_relevant_turns(user_id, query, k=3, threshold=0.62, exclude_session_id, scan_limit=1000)`
  — cosine over the 1000 most-recent embedded `ChatHistory` rows, excluding current session.
- `embed_and_store_turn(chat_history_id)` — idempotent; embeds `f"User: {q}\nAssistant: {a[:1500]}"`.
- `summarize_older_turns(...)` + `run_session_summary(user_id, session_id)` — Layer 2, gate
  ≥8 turns, summarize all but the last 5, incremental via `summary_through_id`, persist to
  `chat_history.session_summary`. Adapted prompt (Morgan CS advising, not ORA).
- `consolidate_user_memories_single(user_id, hours_back=2)` — realtime per-user extraction.
- `consolidate_idle_users(idle_min=5, idle_max=10)` — idle-sweep selector.
- `touch_user_last_chat_at(user_id)`.
- `_merge_memories` — extend to compute+store the embedding on insert/update (currently
  CS Navigator's version does not embed).
- Feature-flag helpers: `_semantic_recall_enabled`, `_verbatim_recall_enabled`, `_realtime_enabled`.
- `mirror_profile_to_memories(...)` / `backfill_profile_memories(db)` — **out of scope.**
  CS Navigator's editable profile (`PUT /api/profile`, `main.py:1341`) exposes only
  `name` / `studentId` / `major`; there is no editable interests or role field to mirror,
  and `major` defaults to "Computer Science" for everyone (low signal). The
  `backfill-profiles` endpoint and this layer are dropped from the port. Facts come only
  from conversation extraction (Layer 3).

### 5. `backend/main.py` wiring

- **Read side:** in `/chat` and `/chat/stream`, add `retrieve_relevant_memories` and
  `retrieve_relevant_turns` to the existing parallel fetch (alongside the current
  `fetch_user_memories` / history fetch); pass all three into `build_memory_context`.
- **Layer 1/2 into the prompt:** add `_build_conversation_context(history_dicts, session_summary)`
  (last-5 turns + summary) and prepend it to `memory_context`. **This is the core fix for the
  within-conversation flakiness** — CS Navigator currently omits history from `/chat/stream`.
- **Write side:** port `_schedule_post_commit_memory_tasks` and its `_schedule_*` helpers
  (asyncio.create_task + asyncio.to_thread, per-task env-flag gate, per-user asyncio lock for
  realtime extraction). Call it after each chat commit in `/chat` and `/chat/stream`.
- **Crons:** add `/api/internal/memory/idle-sweep` and `/api/internal/memory/backfill-profiles`
  (consolidate already exists), all behind `X-Research-Secret`.
- **User endpoints (backend-only, no UI yet):** `GET /api/me/memories`,
  `PATCH /api/me/memories/{id}` (edit content / set paused, recompute embedding),
  `DELETE /api/me/memories/{id}`, `DELETE /api/me/memories` (erase-all),
  `DELETE /api/me/conversations/{chat_id}`. Auth via `get_current_user`.
- **Crons ported:** consolidate (exists) + idle-sweep. `backfill-profiles` is NOT ported
  (profile mirroring is out of scope — see below).

### 6. Delivery — already wired, keep as-is

`vertex_agent.py:844` already sets `state_delta["memory"] = memory_context`;
`agent.py:365` already reads and sanitizes it. **Requirement:** `memory_context` must be
delivered via `state_delta` and **excluded from the ADK session `context_hash`**, so the
per-turn-varying memory string does not thrash session reuse. This is how ORA keeps session
reuse (a latency win) decoupled from memory (correctness). Verify CS Navigator's
`_compute_context_hash` inputs do not include `memory_context`.

## Filtering — what counts as "key information"

The filter is the LLM extraction prompt. Adapted from ORA's for CS students. Categories
approved: `major_track`, `interest`, `career_goal`, `preference`, `context`.

```
Analyze this student's conversation with CS Navigator (Morgan State University CS academic
advisor) and extract key facts worth remembering for future sessions.

The user is a Morgan State Computer Science student.

RULES:
- Extract ONLY non-obvious, durable facts about the student's academic context, interests,
  or preferences.
- Do NOT include grades, GPA, specific course scores, SSN, or any PII beyond what the
  student explicitly volunteered.
- Do NOT repeat facts already in existing memories.
- Keep each fact to one concise sentence — past tense or factual present.
- Return valid JSON array only.

CATEGORIES (use the most specific that applies):
- "major_track": Their degree track or concentration (e.g. cybersecurity track, data science focus).
- "interest": Recurring topics they ask about (AI/ML, web dev, competitive programming, etc.).
- "career_goal": A stated career or academic goal (grad school, SWE internship, research, etc.).
- "preference": How they prefer the assistant to respond (concise, detailed, with examples, etc.).
- "context": Other situational context (transfer student, working part-time, planning to graduate early, etc.).

Existing memories:
{existing_memories}

Today's conversations:
{transcript[:4000]}

Return a JSON array like: [{"type": "interest", "content": "..."}, ...]
If nothing new worth remembering, return: [].
```

Downstream filters (unchanged from ORA):
- **Cap 5 facts per category**; a 6th overwrites the oldest of that type.
- **Substring dedup** in `_merge_memories`.
- **Retrieval ranking:** recency (recent-10 flat list) + cosine relevance (top-5 facts ≥0.55,
  top-3 turns ≥0.62). Only relevant facts reach the prompt, bounding token cost.
- **`skip_cache`-style privacy:** GPA/grades excluded at extraction; consistent with CS
  Navigator's existing `NO_CACHE_KEYWORDS` personal-recall stance.

## Data flow (worked example)

1. Student asks "what electives fit a cybersecurity focus?" (turn 7 of a session).
2. Backend reads: last-5 turns, no summary yet (<8), 0 facts (new student), 0 semantic hits.
   `memory_context` = just `PRIOR CONVERSATION:` (last 5 turns). Model answers with continuity.
3. After response: post-commit tasks fire. Turn 7 → not %6, no extraction. Turn embedded.
4. Turn 8: session-summary task fires (≥8), summarizes turns 1–3, writes `session_summary`.
5. Turn 12: extraction fires (%6). LLM reads last-2h transcript, extracts
   `{"type":"major_track","content":"Interested in a cybersecurity track."}` → `user_memories`,
   embedded on write.
6. Next week, new session: student asks "remind me what I was looking at." Layer 3 injects the
   cybersecurity fact; Layer 4b surfaces the relevant past turn. Model continues where they left off.

## Error handling

- Every read helper degrades silently to empty on failure (embedding unavailable, DB error) —
  the chat never breaks; worst case is a memory-less but correct answer.
- Every write task is `asyncio.create_task(asyncio.to_thread(...))` after the response is sent;
  a failure is logged, never surfaced to the user, never adds latency.
- Embedding calls never raise (4-attempt backoff, then None).
- Feature flags (`ENABLE_SESSION_SUMMARY`, `ENABLE_VERBATIM_RECALL`, `ENABLE_REALTIME_MEMORY`,
  `USE_SEMANTIC_MEMORY_RECALL`, all default true; `EMBEDDING_MAX_RPM` default 50) let any layer
  be disabled without code changes. Added to the backend deploy step in `cloudbuild.yaml`
  (respecting the `--set-env-vars` "replace the entire set" gotcha).
- `coding_tutor` mode and guests get no memory (unchanged). `regular` and `general` do.

## Testing

- **Unit:** `_extract_memories` returns valid JSON and honors GPA/grades exclusion (feed a
  transcript mentioning a GPA, assert it is not extracted); `_merge_memories` dedup + 5/type
  cap; `cosine_sim` edge cases; `_serialize/_deserialize_embedding` round-trip;
  `run_session_summary` gate (<8 turns → None).
- **Integration (local, SQLite per CLAUDE.md local setup):** post a sequence of turns to
  `/chat/stream`, assert (a) turn 2 prompt contains turn-1 context, (b) at turn 8 a
  `session_summary` row appears, (c) at turn 12 a `user_memories` row appears, (d) a new
  session injects the prior fact.
- **Manual on prod:** after deploy, force-run the consolidate cron, confirm `user_memories`
  populates, and verify a two-session continuity flow end-to-end.

## Rollout / ops

1. Add columns to models + `init_db`; deploy (auto-migrates on boot).
2. Deploy `embedding_util.py` + extended `memory_service.py` + `main.py` wiring with all
   feature flags present in `cloudbuild.yaml`.
3. **Enable the Cloud Scheduler API** (`cloudscheduler.googleapis.com`) — currently disabled.
4. Create the two recurring jobs (consolidate daily 3am ET, idle-sweep every 5 min) with the
   `X-Research-Secret` header, per the `gcloud scheduler jobs create http` pattern already
   documented for `refresh-live-sections` in CLAUDE.md.
5. Update CLAUDE.md's memory/cron section to document the now-live system.

## Open risks

- **Scheduler API + billing.** Enabling the API and running two crons adds cost to the
  professor's billing account. Small, but note it.
- **Token budget.** The assembled `memory_context` (summary + 5 turns + 10 facts + 5 semantic
  + 3 verbatim) has no global size cap in ORA. CS Navigator caps `max_output_tokens` at 1536
  for latency; a large memory prompt is input tokens, not output, but still worth a soft cap.
- **Embedding scan is O(rows) in Python.** Fine now; revisit at scale.
