# Conversation Memory Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring CS Navigator's dead memory skeleton to parity with ORA Navigator's live five-layer memory system (recent turns + session summary + cross-session fact extraction + semantic/verbatim recall), so the chat reliably remembers within a conversation and across sessions.

**Architecture:** All conversational context is reconstructed backend-side from Cloud SQL on every turn and delivered to the ADK agent as one `state_delta["memory"]` string (already wired at `vertex_agent.py:844`; memory is already excluded from the session `context_hash`, so it doesn't thrash session reuse). Facts are LLM-extracted into typed buckets, embedded, and semantically retrieved. Write-side extraction/embedding/summarization run in background tasks after the HTTP response, so they add zero latency.

**Tech Stack:** FastAPI, SQLAlchemy (MySQL 8.0 prod / SQLite local), `google-genai` (Gemini 2.5 Flash + `text-embedding-004` @256 dims via Vertex ADC), numpy, pytest 8.4.

## Global Constraints

- **Embeddings stored as JSON in TEXT/MEDIUMTEXT columns**, never native vector/JSON. `json.dumps` on write, `json.loads` on read. Cosine in Python (numpy).
- **Embedding model:** `text-embedding-004`, `output_dimensionality=256`. Version string stored as `"text-embedding-004@256"`.
- **Extraction/summary model:** `gemini-2.5-flash`, `temperature=0.1`. (CS Nav's current extractor uses `gemini-2.0-flash` — upgrade to `2.5-flash` to match the rest of the app.)
- **Never store grades, GPA, specific course scores, student ID, or PII** beyond what the student volunteered. Enforced in the extraction prompt.
- **Student memory categories (exactly these 5):** `major_track`, `interest`, `career_goal`, `preference`, `context`.
- **Cap 5 facts per category**; substring dedup; 6th overwrites oldest of that type.
- **Retrieval thresholds:** facts k=5 / cosine ≥0.55; turns k=3 / cosine ≥0.62; turn scan bound 1000 rows.
- **Triggers:** session summary at ≥8 turns; realtime extraction every 6 turns; idle sweep 5–10 min; nightly cron 24h.
- **Feature flags (all default `"true"`), read as `os.getenv(FLAG, "true").lower() in ("1","true","yes")`:** `ENABLE_SESSION_SUMMARY`, `ENABLE_VERBATIM_RECALL`, `ENABLE_REALTIME_MEMORY`, `USE_SEMANTIC_MEMORY_RECALL`. Plus `EMBEDDING_MAX_RPM` (int, default `50`).
- **Memory applies to `regular` + `general` modes only.** `coding_tutor` and guests get no memory (already the case — do not change).
- **All internal cron endpoints guarded** by `X-Research-Secret` header == `os.getenv("RESEARCH_SECRET")`, else `HTTPException(403)`.
- **Migrations follow CS Nav's `init_db` convention** (`main.py` introspects `information_schema` once, then guarded `ALTER TABLE … ADD COLUMN`). No separate `migrate_db.py`.
- **Profile mirroring is OUT of scope** (no editable interests field in CS Nav). Do not port `mirror_profile_to_memories` / `backfill_profile_memories` / the `backfill-profiles` endpoint / `users.memory_paused`.
- **All test commands run from `backend/`** with `cd backend`. Local test env: `GOOGLE_GENAI_USE_VERTEXAI=FALSE`; embeddings monkeypatched (no live Vertex in CI).
- Commit after every task. Branch: `feat/ui-updates` (current) or a dedicated `feat/conversation-memory` branch — do not push to `main`.

---

### Task 1: Schema columns + migrations

Add the memory columns to the three models and register them in `init_db`'s guarded-ALTER block so the prod MySQL DB auto-migrates on next boot. On fresh SQLite, `create_all` builds them from the models.

**Files:**
- Modify: `backend/models.py` (ChatHistory ~`8-16`, User model, UserMemory ~`206-220`)
- Modify: `backend/main.py` (`init_db`, the guarded-ALTER section ~`230-291`)
- Test: `backend/tests/test_memory_schema.py` (create)

**Interfaces:**
- Produces: `ChatHistory.session_summary`, `.summary_through_id`, `.embedding`, `.embedding_model`, `.topic_label`; `UserMemory.embedding`, `.embedding_model`, `.paused`; `User.last_chat_at`.

- [ ] **Step 1: Add columns to `ChatHistory`** in `backend/models.py`. After the existing `timestamp` line in `ChatHistory`:

```python
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    # Memory port — Layer 2 rolling session summary (latest non-null wins on read).
    session_summary = Column(Text, nullable=True)
    summary_through_id = Column(Integer, nullable=True)
    # Memory port — Layer 4 verbatim turn embedding (JSON 256-float in TEXT).
    embedding = Column(Text, nullable=True)
    embedding_model = Column(String(64), nullable=True)
    topic_label = Column(String(128), nullable=True)
```

- [ ] **Step 2: Add `last_chat_at` to `User`.** In `backend/models.py`, inside the `User` model after `created_at`:

```python
    # Memory port — idle-sweep marker: when the user last chatted.
    last_chat_at = Column(DateTime, nullable=True)
```

- [ ] **Step 3: Add columns to `UserMemory`** in `backend/models.py`. After its `updated_at` line, before `user = relationship(...)`:

```python
    # Memory port — Layer 4 semantic recall: JSON 256-float embedding in TEXT.
    embedding = Column(Text, nullable=True)
    embedding_model = Column(String(64), nullable=True)
    # Per-row pause: skipped during semantic retrieval when True.
    paused = Column(Boolean, nullable=False, default=False)
```

- [ ] **Step 4: Register the ALTERs in `init_db`.** In `backend/main.py`, find the guarded-migration block (each `if ("table","col") not in existing_cols:` … `ALTER TABLE`). Add these, mirroring the existing style (MySQL syntax; wrapped so SQLite/errors are swallowed as the surrounding code already does):

```python
            # --- Memory port columns ---
            for tbl, col, ddl in [
                ("chat_history", "session_summary", "ALTER TABLE chat_history ADD COLUMN session_summary MEDIUMTEXT NULL"),
                ("chat_history", "summary_through_id", "ALTER TABLE chat_history ADD COLUMN summary_through_id INT NULL"),
                ("chat_history", "embedding", "ALTER TABLE chat_history ADD COLUMN embedding MEDIUMTEXT NULL"),
                ("chat_history", "embedding_model", "ALTER TABLE chat_history ADD COLUMN embedding_model VARCHAR(64) NULL"),
                ("chat_history", "topic_label", "ALTER TABLE chat_history ADD COLUMN topic_label VARCHAR(128) NULL"),
                ("user_memories", "embedding", "ALTER TABLE user_memories ADD COLUMN embedding MEDIUMTEXT NULL"),
                ("user_memories", "embedding_model", "ALTER TABLE user_memories ADD COLUMN embedding_model VARCHAR(64) NULL"),
                ("user_memories", "paused", "ALTER TABLE user_memories ADD COLUMN paused BOOLEAN NOT NULL DEFAULT FALSE"),
                ("users", "last_chat_at", "ALTER TABLE users ADD COLUMN last_chat_at DATETIME NULL"),
            ]:
                if (tbl, col) not in existing_cols:
                    try:
                        conn.execute(text(ddl))
                        print(f"[init_db] added {tbl}.{col}")
                    except Exception as e:
                        print(f"[init_db] skip {tbl}.{col}: {e}")
```

> NOTE for the implementer: match the ACTUAL variable names in CS Nav's `init_db` — read `backend/main.py:199-291` first. The introspection stores existing columns; the set is checked as `(TABLE_NAME, COLUMN_NAME)` tuples. If the existing code uses a differently-named set (e.g. `existing_columns`), use that name. The loop above is the shape to add; adapt the guard variable to what's there.

- [ ] **Step 5: Write the schema test.** Create `backend/tests/test_memory_schema.py`:

```python
"""The memory-port columns exist on the ORM models (build on a fresh SQLite DB)."""
from models import ChatHistory, UserMemory, User


def test_chat_history_has_memory_columns():
    cols = ChatHistory.__table__.columns.keys()
    for c in ("session_summary", "summary_through_id", "embedding", "embedding_model", "topic_label"):
        assert c in cols, f"ChatHistory missing {c}"


def test_user_memory_has_embedding_columns():
    cols = UserMemory.__table__.columns.keys()
    for c in ("embedding", "embedding_model", "paused"):
        assert c in cols, f"UserMemory missing {c}"


def test_user_has_last_chat_at():
    assert "last_chat_at" in User.__table__.columns.keys()
```

- [ ] **Step 6: Run the test — expect PASS** (columns are declared on the models):

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_schema.py -v`
Expected: 3 passed.

- [ ] **Step 7: Commit.**

```bash
git add backend/models.py backend/main.py backend/tests/test_memory_schema.py
git commit -m "feat(memory): add embedding/summary columns + init_db migrations"
```

---

### Task 2: Embedding utility module

Port ORA's `embedding_util.py` verbatim — it already documents the exact `genai.Client(vertexai=True)` pattern CS Nav proves in `cache.py`.

**Files:**
- Create: `backend/services/embedding_util.py`
- Test: `backend/tests/test_embedding_util.py` (create)

**Interfaces:**
- Produces: `embed_text(text, *, model=DEFAULT_MODEL, dims=DEFAULT_DIMS) -> Optional[list[float]]`; `cosine_sim(a, b) -> float`; `embed_text_throttled(...)`; constants `DEFAULT_MODEL="text-embedding-004"`, `DEFAULT_DIMS=256`.

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_embedding_util.py`:

```python
"""Pure-function tests for the embedding utility (no live Vertex)."""
import numpy as np
from services.embedding_util import embed_text, cosine_sim, DEFAULT_MODEL, DEFAULT_DIMS


def test_constants():
    assert DEFAULT_MODEL == "text-embedding-004"
    assert DEFAULT_DIMS == 256


def test_embed_text_empty_returns_none():
    assert embed_text("") is None
    assert embed_text("   ") is None


def test_cosine_sim_identical_is_one():
    v = [1.0, 2.0, 3.0]
    assert abs(cosine_sim(v, v) - 1.0) < 1e-6


def test_cosine_sim_orthogonal_is_zero():
    assert abs(cosine_sim([1.0, 0.0], [0.0, 1.0])) < 1e-6


def test_cosine_sim_handles_none_and_empty():
    assert cosine_sim(None, [1.0]) == 0.0
    assert cosine_sim([], [1.0]) == 0.0


def test_cosine_sim_accepts_ndarray():
    assert abs(cosine_sim(np.array([1.0, 1.0]), [1.0, 1.0]) - 1.0) < 1e-6
```

- [ ] **Step 2: Run — expect FAIL** (module missing):

Run: `cd backend && python3 -m pytest tests/test_embedding_util.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.embedding_util'`.

- [ ] **Step 3: Create the module.** Copy ORA's file verbatim into `backend/services/embedding_util.py`. Full content:

```python
"""
Shared embedding utility for CS Navigator's persistent-memory features.

Single source of truth for:
  - Lazy Vertex AI genai client init
  - text-embedding-004 @ 256-dim Matryoshka calls
  - 3-attempt exponential retry on transient failures
  - Cosine similarity for stored embeddings (list[float] or ndarray)

Failures are logged and return None — never raise. Callers store NULL
embeddings, and retrieval paths skip NULL rows. No correctness loss, just
degraded recall until the next successful embed.
"""

from __future__ import annotations

import logging
import os
import time
from threading import Lock
from typing import Optional, Sequence, Union

import numpy as np

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "text-embedding-004"
DEFAULT_DIMS = 256

_RETRY_DELAYS_SEC = (0.2, 1.0, 5.0)

_genai_client = None
_client_lock = Lock()
_client_unavailable_logged = False


def _get_client():
    """Lazily initialize the Vertex genai client. Returns None if unavailable."""
    global _genai_client, _client_unavailable_logged

    if _genai_client is not None:
        return _genai_client

    with _client_lock:
        if _genai_client is not None:
            return _genai_client
        try:
            from google import genai

            _genai_client = genai.Client(vertexai=True)
            logger.info(
                "[EMBED] Vertex embedding client ready (model=%s, dims=%d)",
                DEFAULT_MODEL,
                DEFAULT_DIMS,
            )
            return _genai_client
        except Exception as exc:
            if not _client_unavailable_logged:
                logger.warning(
                    "[EMBED] Vertex embedding client unavailable: %s. "
                    "Memory embedding will be disabled.",
                    exc,
                )
                _client_unavailable_logged = True
            return None


def embed_text(
    text: str,
    *,
    model: str = DEFAULT_MODEL,
    dims: int = DEFAULT_DIMS,
) -> Optional[list[float]]:
    """Embed a string into a float vector via Vertex AI.

    Returns a Python list[float] (JSON-serializable). None on persistent
    failure or empty input.
    """
    if not text or not text.strip():
        return None

    client = _get_client()
    if client is None:
        return None

    from google import genai

    last_err: Optional[Exception] = None
    for attempt, delay in enumerate((0.0, *_RETRY_DELAYS_SEC)):
        if delay:
            time.sleep(delay)
        try:
            result = client.models.embed_content(
                model=model,
                contents=text,
                config=genai.types.EmbedContentConfig(output_dimensionality=dims),
            )
            values = result.embeddings[0].values
            return list(values)
        except Exception as exc:
            last_err = exc
            if attempt == 0:
                logger.warning("[EMBED] Embed attempt 1 failed: %s. Retrying.", exc)

    logger.error(
        "[EMBED] All %d attempts exhausted: %s. Returning None.",
        len(_RETRY_DELAYS_SEC) + 1,
        last_err,
    )
    return None


_VectorLike = Union[Sequence[float], np.ndarray]


def cosine_sim(a: _VectorLike, b: _VectorLike) -> float:
    """Cosine similarity. Accepts list[float] or np.ndarray. 0.0 on empty/None/zero-norm."""
    if a is None or b is None:
        return 0.0

    arr_a = a if isinstance(a, np.ndarray) else np.asarray(a, dtype=np.float32)
    arr_b = b if isinstance(b, np.ndarray) else np.asarray(b, dtype=np.float32)

    if arr_a.size == 0 or arr_b.size == 0:
        return 0.0

    dot = float(np.dot(arr_a, arr_b))
    norm = float(np.linalg.norm(arr_a) * np.linalg.norm(arr_b))
    return dot / norm if norm > 0 else 0.0


try:
    _EMBED_MAX_RPM = int(os.getenv("EMBEDDING_MAX_RPM", "50"))
except ValueError:
    _EMBED_MAX_RPM = 50

_rate_lock = Lock()
_rate_window_start = 0.0
_rate_count = 0


def embed_text_throttled(
    text: str,
    *,
    model: str = DEFAULT_MODEL,
    dims: int = DEFAULT_DIMS,
) -> Optional[list[float]]:
    """Same as embed_text() but enforces EMBEDDING_MAX_RPM (backfill use)."""
    if _EMBED_MAX_RPM <= 0:
        return None

    global _rate_window_start, _rate_count

    while True:
        with _rate_lock:
            now = time.time()
            if now - _rate_window_start >= 60.0:
                _rate_window_start = now
                _rate_count = 0

            if _rate_count < _EMBED_MAX_RPM:
                _rate_count += 1
                break

            wait_for = 60.0 - (now - _rate_window_start)
        time.sleep(max(0.05, wait_for))

    return embed_text(text, model=model, dims=dims)
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_embedding_util.py -v`
Expected: 6 passed. (`embed_text("")` returns None before any client init, so no Vertex call.)

- [ ] **Step 5: Commit.**

```bash
git add backend/services/embedding_util.py backend/tests/test_embedding_util.py
git commit -m "feat(memory): add embedding_util (text-embedding-004 @256 + cosine)"
```

---

### Task 3: memory_service — serialize helpers, student extraction prompt, embedding on merge

Extend CS Nav's existing `memory_service.py`. Add embedding serialization, the version constant, feature-flag helpers, the student-adapted extraction prompt (upgraded to `gemini-2.5-flash` and the 5 approved categories), and make `_merge_memories` compute+store the embedding.

**Files:**
- Modify: `backend/services/memory_service.py`
- Test: `backend/tests/test_memory_extraction.py` (create)

**Interfaces:**
- Consumes: `embed_text` (Task 2).
- Produces: `EMBEDDING_MODEL_VERSION`; `_serialize_embedding(vec)->Optional[str]`; `_deserialize_embedding(text)->Optional[list[float]]`; `_semantic_recall_enabled()`, `_verbatim_recall_enabled()`, `_realtime_enabled()`; adapted `_extract_memories`; `_merge_memories` now embeds.

- [ ] **Step 1: Write failing tests.** Create `backend/tests/test_memory_extraction.py`:

```python
"""Serialize round-trip + extraction JSON parsing + merge dedup/cap/embed."""
import json
import services.memory_service as ms


def test_serialize_roundtrip():
    vec = [0.1, 0.2, 0.3]
    s = ms._serialize_embedding(vec)
    assert isinstance(s, str)
    assert ms._deserialize_embedding(s) == vec


def test_serialize_none():
    assert ms._serialize_embedding(None) is None
    assert ms._serialize_embedding([]) is None
    assert ms._deserialize_embedding(None) is None
    assert ms._deserialize_embedding("not json") is None


def test_extract_parses_fenced_json(monkeypatch):
    class _Resp:
        text = '```json\n[{"type":"interest","content":"Likes ML"}]\n```'

    class _Models:
        def generate_content(self, **kw):
            return _Resp()

    class _Client:
        models = _Models()

    monkeypatch.setattr(ms, "_extract_client", lambda: _Client(), raising=False)
    # If the module builds the client inline, monkeypatch genai instead:
    import services.memory_service as m
    out = m._extract_memories("Student: hi\nBot: hello", "None")
    assert isinstance(out, list)


def test_extract_prompt_excludes_grades():
    # The prompt string must forbid grades/GPA (guards the FERPA rule).
    src = ms._extract_memories.__doc__ or ""
    # Prompt is inline; assert via a helper constant instead:
    assert "GPA" in ms.EXTRACTION_RULES_TEXT
    assert "grades" in ms.EXTRACTION_RULES_TEXT.lower()
```

> NOTE: to make `test_extract_prompt_excludes_grades` testable without invoking Gemini, factor the RULES/CATEGORIES block into a module constant `EXTRACTION_RULES_TEXT` and interpolate it into the prompt. `test_extract_parses_fenced_json` is best-effort; if the client is built inline and hard to patch, mark it `@pytest.mark.skip("needs genai client injection")` and rely on the constant test. Prefer refactoring `_extract_memories` to accept an optional injected client for testability.

- [ ] **Step 2: Run — expect FAIL** (`_serialize_embedding`, `EXTRACTION_RULES_TEXT` missing):

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_extraction.py -v`
Expected: FAIL — AttributeError on `_serialize_embedding`.

- [ ] **Step 3: Add serialize helpers + version + flags** near the top of `backend/services/memory_service.py` (after the imports):

```python
EMBEDDING_MODEL_VERSION = "text-embedding-004@256"


def _serialize_embedding(vec):
    """Serialize a float vector to JSON for TEXT-column storage."""
    if not vec:
        return None
    return json.dumps(vec)


def _deserialize_embedding(text):
    """Best-effort decode of a stored JSON embedding. None on bad data."""
    if not text:
        return None
    try:
        vec = json.loads(text)
        if isinstance(vec, list) and vec and isinstance(vec[0], (int, float)):
            return vec
    except (ValueError, TypeError):
        pass
    return None


def _semantic_recall_enabled():
    return os.getenv("USE_SEMANTIC_MEMORY_RECALL", "true").lower() in ("1", "true", "yes")


def _verbatim_recall_enabled():
    return os.getenv("ENABLE_VERBATIM_RECALL", "true").lower() in ("1", "true", "yes")


def _realtime_enabled():
    return os.getenv("ENABLE_REALTIME_MEMORY", "true").lower() in ("1", "true", "yes")
```

- [ ] **Step 4: Replace the extraction prompt** in `_extract_memories`. First add the module-level constant (near `EMBEDDING_MODEL_VERSION`):

```python
EXTRACTION_RULES_TEXT = """RULES:
- Extract ONLY non-obvious, durable facts about the student's academic context, interests, or preferences.
- Do NOT include grades, GPA, specific course scores, student ID, SSN, or any PII beyond what the student explicitly volunteered.
- Do NOT repeat facts already in existing memories.
- Keep each fact to one concise sentence — past tense or factual present.
- Return valid JSON array only.

CATEGORIES (use the most specific that applies):
- "major_track": Their degree track or concentration (e.g. cybersecurity track, data science focus).
- "interest": Recurring topics they ask about (AI/ML, web dev, competitive programming, etc.).
- "career_goal": A stated career or academic goal (grad school, SWE internship, research, etc.).
- "preference": How they prefer the assistant to respond (concise, detailed, with examples, etc.).
- "context": Other situational context (transfer student, working part-time, planning to graduate early, etc.)."""
```

Then in `_extract_memories`, replace the `prompt = f"""..."""` assignment with:

```python
        prompt = f"""Analyze this student's conversation with CS Navigator (Morgan State University CS academic advisor) and extract key facts worth remembering for future sessions.

The user is a Morgan State Computer Science student.

{EXTRACTION_RULES_TEXT}

Existing memories:
{existing_memories}

Today's conversations:
{transcript[:4000]}

Return a JSON array like: [{{"type": "interest", "content": "Interested in machine learning"}}, ...]
If nothing new worth remembering, return: []"""
```

And change the model line from `model="gemini-2.0-flash"` to `model="gemini-2.5-flash"`.

- [ ] **Step 5: Make `_merge_memories` embed.** In `_merge_memories`, inside the `for mem in new_memories:` loop, after the `is_duplicate` check and before `if len(type_memories) < 5:`, insert:

```python
        # Compute embedding now so retrieve_relevant_memories can rank it.
        from services.embedding_util import embed_text
        emb_vec = embed_text(content)
        emb_serialized = _serialize_embedding(emb_vec) if emb_vec else None
        emb_model = EMBEDDING_MODEL_VERSION if emb_vec else None
```

Then change the two write branches to persist those:

```python
        if len(type_memories) < 5:
            new_mem = UserMemory(
                user_id=user_id,
                memory_type=mtype,
                content=content,
                embedding=emb_serialized,
                embedding_model=emb_model,
            )
            db.add(new_mem)
        else:
            oldest = min(type_memories, key=lambda m: m.updated_at or m.created_at)
            oldest.content = content
            oldest.embedding = emb_serialized
            oldest.embedding_model = emb_model
            oldest.updated_at = datetime.utcnow()
```

- [ ] **Step 6: Run — expect PASS** (serialize + rules tests; skip/adapt the client test per the note):

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_extraction.py -v`
Expected: serialize + `EXTRACTION_RULES_TEXT` tests pass.

- [ ] **Step 7: Commit.**

```bash
git add backend/services/memory_service.py backend/tests/test_memory_extraction.py
git commit -m "feat(memory): student extraction prompt + embed on merge + serialize helpers"
```

---

### Task 4: memory_service — retrieval, 3-section context, turn embedding

Add semantic fact retrieval, verbatim turn retrieval, the 3-section `build_memory_context`, and `embed_and_store_turn`.

**Files:**
- Modify: `backend/services/memory_service.py`
- Test: `backend/tests/test_memory_retrieval.py` (create)

**Interfaces:**
- Consumes: `_serialize_embedding`, `_deserialize_embedding`, `_semantic_recall_enabled`, `_verbatim_recall_enabled`, `embed_text`, `cosine_sim`.
- Produces: `retrieve_relevant_memories(user_id, query, k=5, threshold=0.55)->list[dict]`; `retrieve_relevant_turns(user_id, query, k=3, threshold=0.62, exclude_session_id=None, scan_limit=1000)->list[dict]`; `build_memory_context(memories, relevant_memories=None, relevant_turns=None)->str`; `embed_and_store_turn(chat_history_id)->bool`.

- [ ] **Step 1: Write failing tests.** Create `backend/tests/test_memory_retrieval.py`:

```python
"""Retrieval ranking + 3-section context. DB via in-memory SQLite; embeddings faked."""
import json
import pytest
import services.memory_service as ms


def test_build_memory_context_three_sections():
    ctx = ms.build_memory_context(
        memories=[{"memory_type": "interest", "content": "Likes ML"}],
        relevant_memories=[{"memory_type": "career_goal", "content": "Wants grad school"}],
        relevant_turns=[{"timestamp": "2026-07-01T00:00:00", "user_query": "q", "bot_response": "a"}],
    )
    assert "USER MEMORY" in ctx
    assert "RELEVANT FROM PAST MEMORIES" in ctx
    assert "FROM PAST CONVERSATIONS" in ctx


def test_build_memory_context_empty():
    assert ms.build_memory_context([], None, None) == ""


def test_retrieve_relevant_memories_disabled(monkeypatch):
    monkeypatch.setenv("USE_SEMANTIC_MEMORY_RECALL", "false")
    assert ms.retrieve_relevant_memories(1, "anything") == []


def test_retrieve_relevant_turns_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_VERBATIM_RECALL", "false")
    assert ms.retrieve_relevant_turns(1, "anything") == []
```

- [ ] **Step 2: Run — expect FAIL** (`retrieve_relevant_memories` missing / `build_memory_context` signature):

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_retrieval.py -v`
Expected: FAIL — `AttributeError` / `TypeError`.

- [ ] **Step 3: Replace `build_memory_context`** in `memory_service.py` with the 3-section version:

```python
def build_memory_context(memories, relevant_memories=None, relevant_turns=None):
    """Up to three concatenated sections: long-term facts, semantic fact recall,
    verbatim past-turn recall."""
    parts = []

    if memories:
        ctx = "\nUSER MEMORY (long-term context from past sessions):\n"
        for m in memories:
            ctx += f"[{m['memory_type']}] {m['content']}\n"
        ctx += "(Use this context to personalize responses. Do not repeat these facts verbatim.)\n"
        parts.append(ctx)

    if relevant_memories:
        ctx = "\nRELEVANT FROM PAST MEMORIES (semantically matched to current query):\n"
        for m in relevant_memories:
            ctx += f"[{m['memory_type']}] {m['content']}\n"
        parts.append(ctx)

    if relevant_turns:
        ctx = "\nFROM PAST CONVERSATIONS (you may reference these earlier exchanges):\n"
        for t in relevant_turns:
            ts = (t.get("timestamp") or "")[:10]
            uq = (t.get("user_query") or "").strip()[:200]
            br = (t.get("bot_response") or "").strip()[:400]
            ctx += f"  [{ts}] Student asked: \"{uq}\"\n"
            ctx += f"     You answered: \"{br}\"\n"
        parts.append(ctx)

    return "".join(parts)
```

- [ ] **Step 4: Add retrieval + turn embedding** functions (append to `memory_service.py`). Copy from ORA verbatim (they reference only symbols defined above):

```python
def retrieve_relevant_memories(user_id, query, k=5, threshold=0.55):
    """Rank a user's UserMemory rows by cosine similarity to the query. Skips
    paused / unembedded rows. Always returns a list."""
    from models import UserMemory
    from services.embedding_util import embed_text, cosine_sim

    if not _semantic_recall_enabled() or not query or not query.strip():
        return []

    q_vec = embed_text(query)
    if not q_vec:
        return []

    db = SessionLocal()
    try:
        rows = (
            db.query(UserMemory)
            .filter(
                UserMemory.user_id == user_id,
                UserMemory.paused == False,  # noqa: E712
                UserMemory.embedding.isnot(None),
            )
            .all()
        )
        scored = []
        for r in rows:
            vec = _deserialize_embedding(r.embedding)
            if not vec:
                continue
            sim = cosine_sim(q_vec, vec)
            if sim >= threshold:
                scored.append((sim, r))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            {
                "memory_type": r.memory_type,
                "content": r.content,
                "updated_at": r.updated_at.isoformat() if r.updated_at else "",
                "similarity": round(sim, 3),
            }
            for sim, r in scored[:k]
        ]
    except Exception as e:
        print(f"[MEMORY] retrieve_relevant_memories failed: {e}")
        return []
    finally:
        db.close()


def retrieve_relevant_turns(user_id, query, k=3, threshold=0.62, exclude_session_id=None, scan_limit=1000):
    """Return the user's top-k most-similar past turns (excluding current session).
    Scan bounded to the most recent scan_limit embedded turns."""
    from models import ChatHistory
    from services.embedding_util import embed_text, cosine_sim

    if not _verbatim_recall_enabled() or not query or not query.strip():
        return []

    q_vec = embed_text(query)
    if not q_vec:
        return []

    db = SessionLocal()
    try:
        q = db.query(ChatHistory).filter(
            ChatHistory.user_id == user_id,
            ChatHistory.embedding.isnot(None),
        )
        if exclude_session_id:
            q = q.filter(ChatHistory.session_id != exclude_session_id)
        rows = q.order_by(ChatHistory.id.desc()).limit(scan_limit).all()

        scored = []
        for r in rows:
            vec = _deserialize_embedding(r.embedding)
            if not vec:
                continue
            sim = cosine_sim(q_vec, vec)
            if sim >= threshold:
                scored.append((sim, r))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            {
                "id": r.id,
                "session_id": r.session_id,
                "timestamp": r.timestamp.isoformat() if r.timestamp else "",
                "user_query": r.user_query,
                "bot_response": r.bot_response,
                "topic_label": r.topic_label,
                "similarity": round(sim, 3),
            }
            for sim, r in scored[:k]
        ]
    except Exception as e:
        print(f"[MEMORY] retrieve_relevant_turns failed: {e}")
        return []
    finally:
        db.close()


def embed_and_store_turn(chat_history_id):
    """Background task: embed a freshly-committed chat turn and persist.
    Idempotent; no-ops if verbatim recall is off."""
    if not _verbatim_recall_enabled():
        return False

    from models import ChatHistory
    from services.embedding_util import embed_text

    db = SessionLocal()
    try:
        row = db.query(ChatHistory).filter(ChatHistory.id == chat_history_id).first()
        if not row:
            return False
        if row.embedding:
            return True

        uq = (row.user_query or "").strip()
        br = (row.bot_response or "").strip()
        if not uq and not br:
            return False
        combined = f"User: {uq}\nAssistant: {br[:1500]}"
        vec = embed_text(combined)
        if not vec:
            return False

        row.embedding = _serialize_embedding(vec)
        row.embedding_model = EMBEDDING_MODEL_VERSION
        db.commit()
        return True
    except Exception as e:
        print(f"[MEMORY] embed_and_store_turn failed id={chat_history_id}: {e}")
        return False
    finally:
        db.close()
```

- [ ] **Step 5: Run — expect PASS.**

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_retrieval.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit.**

```bash
git add backend/services/memory_service.py backend/tests/test_memory_retrieval.py
git commit -m "feat(memory): semantic + verbatim retrieval, 3-section context, turn embedding"
```

---

### Task 5: memory_service — session summary + realtime/idle extraction

Add the rolling session summary, single-user realtime extraction, idle-user sweep, and `touch_user_last_chat_at`.

**Files:**
- Modify: `backend/services/memory_service.py`
- Test: `backend/tests/test_memory_summary.py` (create)

**Interfaces:**
- Consumes: `_extract_memories`, `_merge_memories`, `_realtime_enabled`.
- Produces: `summarize_older_turns(transcript)->Optional[str]`; `run_session_summary(user_id, session_id)->Optional[str]`; `consolidate_user_memories_single(user_id, hours_back=2)->dict`; `consolidate_idle_users(idle_min=5, idle_max=10)->dict`; `touch_user_last_chat_at(user_id)->None`.

- [ ] **Step 1: Write failing test.** Create `backend/tests/test_memory_summary.py`:

```python
"""Session-summary gate + idle helpers (summarizer monkeypatched)."""
import services.memory_service as ms


def test_summarize_older_turns_empty_returns_none():
    assert ms.summarize_older_turns("") is None
    assert ms.summarize_older_turns("   ") is None


def test_consolidate_single_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_MEMORY", "false")
    assert ms.consolidate_user_memories_single(1)["status"] == "disabled"


def test_consolidate_idle_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_MEMORY", "false")
    assert ms.consolidate_idle_users()["status"] == "disabled"
```

- [ ] **Step 2: Run — expect FAIL** (functions missing):

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_summary.py -v`
Expected: FAIL — AttributeError.

- [ ] **Step 3: Add `summarize_older_turns` + `run_session_summary`.** Append to `memory_service.py`:

```python
def summarize_older_turns(transcript):
    """LLM-summarize the older portion of a session. None on empty/failure."""
    if not transcript or not transcript.strip():
        return None
    try:
        from google import genai

        project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
        try:
            if project:
                client = genai.Client(vertexai=True, project=project, location="us-central1")
            else:
                client = genai.Client(vertexai=True)
        except Exception:
            api_key = os.getenv("GEMINI_API_KEY", "")
            if not api_key:
                print("   [MEMORY] No Gemini client for session summary")
                return None
            client = genai.Client(api_key=api_key)

        prompt = (
            "Summarize the earlier part of this conversation between a student and "
            "CS Navigator (Morgan State University CS academic advisor).\n\n"
            "Goal: a concise 1-2 paragraph summary that captures:\n"
            "- What the student asked about\n"
            "- Any specifics they mentioned (courses, track, career goals, deadlines, commitments)\n"
            "- What the assistant told them — especially specific course info, contacts, dates, or links\n\n"
            "Be specific. Avoid filler. Aim for under 400 tokens.\n\n"
            f"Conversation:\n{transcript[:3000]}\n\nSummary:"
        )
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"temperature": 0.1, "max_output_tokens": 500},
        )
        text = (response.text or "").strip()
        return text or None
    except Exception as e:
        print(f"[MEMORY] Session summary failed: {e}")
        return None


def run_session_summary(user_id, session_id):
    """Build + persist a rolling session summary. Gate: >=8 turns and new older
    turns beyond the last summary. Returns the summary or None."""
    from models import ChatHistory

    db = SessionLocal()
    try:
        all_turns = (
            db.query(ChatHistory)
            .filter(ChatHistory.user_id == user_id, ChatHistory.session_id == session_id)
            .order_by(ChatHistory.id.asc())
            .all()
        )
        if len(all_turns) < 8:
            return None

        prior_summary = None
        prior_through_id = 0
        for t in reversed(all_turns):
            if t.session_summary:
                prior_summary = t.session_summary
                prior_through_id = t.summary_through_id or 0
                break

        older_turns = all_turns[:-5]
        new_older_turns = [t for t in older_turns if t.id > prior_through_id]
        if not new_older_turns:
            return None

        transcript_parts = []
        if prior_summary:
            transcript_parts.append(f"EARLIER SUMMARY: {prior_summary}")
        for t in new_older_turns:
            transcript_parts.append(
                f"User: {t.user_query}\nAssistant: {(t.bot_response or '')[:500]}"
            )
        transcript = "\n\n".join(transcript_parts)

        summary = summarize_older_turns(transcript)
        if not summary:
            return None

        latest_row = all_turns[-1]
        latest_row.session_summary = summary
        latest_row.summary_through_id = older_turns[-1].id
        db.commit()
        print(f"[MEMORY] session summary user={user_id} session={session_id} through={latest_row.summary_through_id}")
        return summary
    except Exception as e:
        print(f"[MEMORY] run_session_summary failed: {e}")
        return None
    finally:
        db.close()
```

- [ ] **Step 4: Add realtime single + idle sweep + touch.** Append to `memory_service.py`:

```python
def consolidate_user_memories_single(user_id, hours_back=2):
    """Run the extraction pipeline for ONE user (post-commit / idle / manual)."""
    if not _realtime_enabled():
        return {"status": "disabled"}

    from models import UserMemory, ChatHistory

    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(hours=hours_back)
        chats = (
            db.query(ChatHistory)
            .filter(ChatHistory.user_id == user_id, ChatHistory.timestamp >= cutoff)
            .order_by(ChatHistory.timestamp.asc())
            .limit(50)
            .all()
        )
        if not chats or len(chats) < 3:
            return {"status": "skipped_too_few_messages", "user_id": user_id, "count": len(chats)}

        transcript = "\n".join(
            f"Student: {c.user_query}\nBot: {(c.bot_response or '')[:200]}" for c in chats
        )
        existing = db.query(UserMemory).filter(UserMemory.user_id == user_id).all()
        existing_text = "\n".join(f"[{m.memory_type}] {m.content}" for m in existing) if existing else "None"

        new_memories = _extract_memories(transcript, existing_text)
        if not new_memories:
            return {"status": "no_new_facts", "user_id": user_id}

        _merge_memories(db, user_id, new_memories, existing)
        db.commit()
        print(f"[MEMORY] realtime extract user={user_id} new={len(new_memories)} hours={hours_back}")
        return {"status": "ok", "user_id": user_id, "new_facts": len(new_memories)}
    except Exception as e:
        print(f"[MEMORY] consolidate_user_memories_single failed user={user_id}: {e}")
        return {"status": "error", "user_id": user_id, "error": str(e)}
    finally:
        db.close()


def touch_user_last_chat_at(user_id):
    """Cheap single-column UPDATE of users.last_chat_at = now()."""
    from models import User

    db = SessionLocal()
    try:
        db.query(User).filter(User.id == user_id).update(
            {User.last_chat_at: datetime.utcnow()}, synchronize_session=False
        )
        db.commit()
    except Exception as e:
        print(f"[MEMORY] touch_user_last_chat_at failed user={user_id}: {e}")
    finally:
        db.close()


def consolidate_idle_users(idle_min=5, idle_max=10):
    """Find users whose last chat was idle_min..idle_max minutes ago and extract."""
    if not _realtime_enabled():
        return {"status": "disabled"}

    from models import User

    db = SessionLocal()
    try:
        max_cutoff = datetime.utcnow() - timedelta(minutes=idle_min)
        min_cutoff = datetime.utcnow() - timedelta(minutes=idle_max)
        users = (
            db.query(User.id)
            .filter(User.last_chat_at.isnot(None))
            .filter(User.last_chat_at <= max_cutoff)
            .filter(User.last_chat_at >= min_cutoff)
            .all()
        )
    except Exception as e:
        print(f"[MEMORY] consolidate_idle_users query failed: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        db.close()

    if not users:
        return {"status": "no_idle_users", "processed": 0}

    processed = 0
    errors = 0
    for (uid,) in users:
        try:
            consolidate_user_memories_single(uid, hours_back=2)
            processed += 1
        except Exception as e:
            print(f"[MEMORY] idle-sweep user={uid} failed: {e}")
            errors += 1
    return {"status": "completed", "processed": processed, "errors": errors}
```

- [ ] **Step 5: Run — expect PASS.**

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_summary.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit.**

```bash
git add backend/services/memory_service.py backend/tests/test_memory_summary.py
git commit -m "feat(memory): session summary + realtime/idle extraction"
```

---

### Task 6: main.py read wiring — inject history + summary + recall into the prompt

Thread the session summary through `_fetch_history_sync`, extend `build_conversation_context` to accept it, add semantic+verbatim recall to the parallel fetch, and prepend conversation context to `memory_context` in BOTH `/chat` and `/chat/stream`. **This is the core within-conversation fix** — `/chat/stream` currently sends no history.

**Files:**
- Modify: `backend/main.py` (`_fetch_history_sync` ~`2913`; `/chat` block ~`2959-3106`; `/chat/stream` block ~`3184-3448`)
- Modify: `backend/services/context_builders.py` (`build_conversation_context` ~`344`)

**Interfaces:**
- Consumes: `retrieve_relevant_memories`, `retrieve_relevant_turns`, `build_memory_context` (Tasks 3–4).
- Produces: `_fetch_history_sync(...) -> (turns:list, summary:Optional[str])`; `build_conversation_context(history_dicts, session_summary=None) -> str`.

- [ ] **Step 1: Extend `build_conversation_context`** in `backend/services/context_builders.py`:

```python
def build_conversation_context(history_dicts: list, session_summary: str | None = None) -> str:
    """Prior turns + optional rolling summary for the agent's context."""
    parts = []
    if session_summary:
        parts.append(f"EARLIER IN THIS SESSION:\n{session_summary.strip()}\n")
    if history_dicts:
        lines = ["PRIOR CONVERSATION:"]
        for h in history_dicts[-5:]:
            u = (h.get("user_query") or "").strip()
            b = (h.get("bot_response") or "").strip()
            if u:
                lines.append(f"User: {u}")
            if b:
                lines.append(f"Assistant: {b[:500]}")
        parts.append("\n".join(lines))
    return ("\n".join(parts) + "\n") if parts else ""
```

- [ ] **Step 2: Make `_fetch_history_sync` return `(turns, summary)`** in `backend/main.py` (~2913):

```python
def _fetch_history_sync(user_id: int, session_id: str, limit: int = 10):
    """Fetch chat history + latest rolling summary in one DB session.
    Returns (turns_list, session_summary)."""
    db = SessionLocal()
    try:
        history = db.query(ChatHistory)\
            .filter(ChatHistory.user_id == user_id, ChatHistory.session_id == session_id)\
            .order_by(ChatHistory.timestamp.desc())\
            .limit(limit)\
            .all()
        turns = [{"user_query": h.user_query, "bot_response": h.bot_response} for h in reversed(history)]
        summary_row = (
            db.query(ChatHistory.session_summary)
            .filter(
                ChatHistory.user_id == user_id,
                ChatHistory.session_id == session_id,
                ChatHistory.session_summary.isnot(None),
            )
            .order_by(ChatHistory.id.desc())
            .first()
        )
        summary = summary_row[0] if summary_row else None
        return turns, summary
    finally:
        db.close()
```

- [ ] **Step 3: Update the `/chat` fetch + assembly** (~2959-2994). Import the new retrieval fns at the top memory import (~2894):

```python
from services.memory_service import (
    fetch_user_memories_sync, build_memory_context,
    retrieve_relevant_memories, retrieve_relevant_turns,
)
```

Then in `/chat`, replace the parallel-fetch + unpack + assembly. The current shape is `results = await asyncio.gather(_fetch_history_sync(...), fetch_user_memories_sync(...))` with `history_dicts = results[0]`. Change to:

```python
    # Memory applies to regular + general; skip coding_tutor (guests never reach here).
    want_memory = (not is_coding_tutor)
    fetch_tasks = [
        asyncio.to_thread(_fetch_history_sync, user["user_id"], session_id, 5),
    ]
    if want_memory:
        fetch_tasks += [
            asyncio.to_thread(fetch_user_memories_sync, user["user_id"], 10),
            asyncio.to_thread(retrieve_relevant_memories, user["user_id"], user_q, 5, 0.55),
            asyncio.to_thread(retrieve_relevant_turns, user["user_id"], user_q, 3, 0.62, session_id),
        ]
    results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

    hist_res = results[0]
    if isinstance(hist_res, Exception):
        history_dicts, session_summary = [], None
    else:
        history_dicts, session_summary = hist_res

    memory_dicts = results[1] if want_memory and not isinstance(results[1], Exception) else []
    relevant_memories = results[2] if want_memory and not isinstance(results[2], Exception) else []
    relevant_turns = results[3] if want_memory and not isinstance(results[3], Exception) else []

    if USE_VERTEX_AGENT and history_dicts and not is_coding_tutor and is_likely_followup(user_q):
        user_q = await asyncio.to_thread(rewrite_query, user_q, history_dicts)

    conversation_context = _build_conversation_context(history_dicts, session_summary)
    memory_context = ""
    if want_memory:
        memory_context = build_memory_context(memory_dicts, relevant_memories, relevant_turns)
    memory_context = conversation_context + (memory_context or "")
```

> NOTE: read the ACTUAL current lines 2955-2995 first and adapt variable names. Preserve the existing file-upload branch at ~3077 that uses `conversation_context` — it still works since `conversation_context` is defined above. The key change: `memory_context` now always begins with `conversation_context`.

- [ ] **Step 4: Update the `/chat/stream` fetch + assembly** (~3184-3220) identically:

```python
    # Memory applies to regular + general; skip coding_tutor (guests never reach here).
    want_memory = (not is_coding_tutor)
    fetch_tasks = [
        asyncio.to_thread(_fetch_history_sync, user_id, session_id, 5),
    ]
    if want_memory:
        fetch_tasks += [
            asyncio.to_thread(fetch_user_memories_sync, user_id, 10),
            asyncio.to_thread(retrieve_relevant_memories, user_id, user_q, 5, 0.55),
            asyncio.to_thread(retrieve_relevant_turns, user_id, user_q, 3, 0.62, session_id),
        ]
    results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

    hist_res = results[0]
    if isinstance(hist_res, Exception):
        history_dicts, session_summary = [], None
    else:
        history_dicts, session_summary = hist_res

    memory_dicts = results[1] if want_memory and not isinstance(results[1], Exception) else []
    relevant_memories = results[2] if want_memory and not isinstance(results[2], Exception) else []
    relevant_turns = results[3] if want_memory and not isinstance(results[3], Exception) else []

    if not is_coding_tutor and history_dicts and is_likely_followup(user_q):
        user_q = await asyncio.to_thread(rewrite_query, user_q, history_dicts)

    conversation_context = _build_conversation_context(history_dicts, session_summary)
    memory_context = build_memory_context(memory_dicts, relevant_memories, relevant_turns) if want_memory else ""
    memory_context = conversation_context + (memory_context or "")
```

- [ ] **Step 5: Verify memory stays out of the session hash.** Confirm `vertex_agent.py:_compute_context_hash` is only called on `context` (student context) and `canvas_context`, never `memory_context` (already true at `458`/`470`/`495-496`). No change needed — this step is a read-only confirmation.

Run: `cd backend && grep -n "_compute_context_hash" vertex_agent.py`
Expected: only `context` and `canvas_context` are hashed; `memory_context` never appears.

- [ ] **Step 6: Smoke-test import + existing stream test still passes.**

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -c "import main" && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_stream_integration.py -v`
Expected: import OK; stream integration test passes (memory paths degrade to empty when embeddings unavailable).

- [ ] **Step 7: Commit.**

```bash
git add backend/main.py backend/services/context_builders.py
git commit -m "feat(memory): inject recent turns + summary + recall into chat prompt"
```

---

### Task 7: main.py write wiring — post-commit background tasks

Add the post-commit scheduler and call it after each `ChatHistory` commit, capturing the new row id. This drives turn embedding, session summary, realtime extraction (every 6 turns), and the idle marker.

**Files:**
- Modify: `backend/main.py` (add helpers near the other `_schedule_*`/memory code ~`2900`; call after 5 commit sites: `3054`, `3119`, `3305`, `3399`, `3509`)
- Test: `backend/tests/test_memory_postcommit.py` (create)

**Interfaces:**
- Consumes: `run_session_summary`, `embed_and_store_turn`, `consolidate_user_memories_single`, `touch_user_last_chat_at` (Task 5), `ChatHistory`, `SessionLocal`.
- Produces: `_schedule_post_commit_memory_tasks(user_id, session_id, chat_id)`.

- [ ] **Step 1: Write failing test.** Create `backend/tests/test_memory_postcommit.py`:

```python
"""The post-commit scheduler is safe to call without a running event loop
(RuntimeError swallowed) and gates realtime extraction to every 6th turn."""
import main


def test_schedule_no_event_loop_is_safe():
    # No asyncio loop running here → must not raise.
    main._schedule_post_commit_memory_tasks(user_id=1, session_id="s1", chat_id=123)


def test_turn_count_gate_helper():
    # 6-turn cadence helper: fires only on multiples of 6.
    assert main._is_extraction_turn(6) is True
    assert main._is_extraction_turn(12) is True
    assert main._is_extraction_turn(5) is False
    assert main._is_extraction_turn(0) is False
```

- [ ] **Step 2: Run — expect FAIL** (`_schedule_post_commit_memory_tasks` missing):

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_postcommit.py -v`
Expected: FAIL — AttributeError.

- [ ] **Step 3: Add the scheduler helpers** to `backend/main.py` (near `_fetch_history_sync`, ~2932, after the memory imports):

```python
# asyncio is already imported at the top of main.py — do not re-import.
_realtime_extraction_locks: dict = {}


def _is_extraction_turn(turn_count: int) -> bool:
    """Realtime extraction fires every 6th turn."""
    return turn_count > 0 and turn_count % 6 == 0


def _get_user_realtime_lock(user_id: int):
    lock = _realtime_extraction_locks.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _realtime_extraction_locks[user_id] = lock
    return lock


async def _run_extraction_locked(user_id: int):
    from services.memory_service import consolidate_user_memories_single
    lock = _get_user_realtime_lock(user_id)
    if lock.locked():
        return
    async with lock:
        await asyncio.to_thread(consolidate_user_memories_single, user_id, 2)


def _schedule_session_summary(user_id: int, session_id: str):
    if os.getenv("ENABLE_SESSION_SUMMARY", "true").lower() not in ("1", "true", "yes"):
        return
    from services.memory_service import run_session_summary
    try:
        asyncio.create_task(asyncio.to_thread(run_session_summary, user_id, session_id))
    except RuntimeError:
        pass


def _schedule_embed_turn(chat_history_id: int):
    if os.getenv("ENABLE_VERBATIM_RECALL", "true").lower() not in ("1", "true", "yes"):
        return
    from services.memory_service import embed_and_store_turn
    try:
        asyncio.create_task(asyncio.to_thread(embed_and_store_turn, chat_history_id))
    except RuntimeError:
        pass


def _schedule_touch_last_chat(user_id: int):
    from services.memory_service import touch_user_last_chat_at
    try:
        asyncio.create_task(asyncio.to_thread(touch_user_last_chat_at, user_id))
    except RuntimeError:
        pass


def _schedule_realtime_extraction(user_id: int, session_id: str):
    if os.getenv("ENABLE_REALTIME_MEMORY", "true").lower() not in ("1", "true", "yes"):
        return
    try:
        with SessionLocal() as _db:
            turn_count = (
                _db.query(ChatHistory)
                .filter(ChatHistory.user_id == user_id, ChatHistory.session_id == session_id)
                .count()
            )
    except Exception as e:
        print(f"[MEMORY] turn-count query failed user={user_id}: {e}")
        return
    if not _is_extraction_turn(turn_count):
        return
    try:
        asyncio.create_task(_run_extraction_locked(user_id))
    except RuntimeError:
        pass


def _schedule_post_commit_memory_tasks(user_id: int, session_id: str, chat_id: int):
    """Fire all memory background tasks after a chat turn commits. Never raises."""
    try:
        _schedule_session_summary(user_id, session_id)
        _schedule_touch_last_chat(user_id)
        _schedule_embed_turn(chat_id)
        _schedule_realtime_extraction(user_id, session_id)
    except Exception as e:
        print(f"[MEMORY] post-commit scheduling failed: {e}")
```

- [ ] **Step 4: Call it after each ChatHistory commit.** At EACH of the 5 commit sites, capture the new row id inside the open session (PK is populated after `commit()` while the session is still open) and schedule. Example for the `/chat/stream` site (~3509, inside the `with SessionLocal() as save_db:` block):

```python
                    save_db.add(new_chat)
                    save_db.commit()
                    new_chat_id = new_chat.id
                # OUTSIDE the with-block is fine; id is a plain int now.
                if new_chat_id:
                    _schedule_post_commit_memory_tasks(user_id, session_id, new_chat_id)
```

For the `/chat` site (~3119, which uses the request-scoped `db`):

```python
            db.add(new_chat)
            db.commit()
            new_chat_id = new_chat.id
            if new_chat_id:
                _schedule_post_commit_memory_tasks(user["user_id"], session_id, new_chat_id)
```

Apply the same pattern at all 5 sites (`3054`, `3119`, `3305`, `3399`, `3509`). Use the correct user-id variable in scope at each site (`user["user_id"]` in `/chat`, `user_id` in `/chat/stream`). Only schedule inside `if is_persistable_session(session_id):` (already the guard at those sites) so internal/system sessions are skipped.

> NOTE: read each of the 5 sites first. Some may be coding-tutor or guest paths — do NOT schedule memory tasks on guest sessions (no user row) or coding-tutor commits. Add `and not is_coding_tutor` where a mode is in scope. When unsure, gate on `is_persistable_session` AND a real integer `user_id`.

- [ ] **Step 5: Run — expect PASS.**

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_postcommit.py -v`
Expected: 2 passed.

- [ ] **Step 6: Commit.**

```bash
git add backend/main.py backend/tests/test_memory_postcommit.py
git commit -m "feat(memory): post-commit background tasks (embed/summary/extract/idle)"
```

---

### Task 8: Cron + user-facing memory endpoints

Add the idle-sweep cron endpoint and the backend memory-management endpoints (no UI yet). The nightly consolidate endpoint already exists.

**Files:**
- Modify: `backend/main.py` (near the existing `/api/internal/memory/consolidate` ~`6542`; user endpoints near other `/api/me/*` or profile routes)
- Test: `backend/tests/test_memory_endpoints.py` (create)

**Interfaces:**
- Consumes: `consolidate_idle_users` (Task 5), `get_current_user` (`main.py:552`), `RESEARCH_SECRET` guard pattern.
- Produces: `POST /api/internal/memory/idle-sweep`; `GET /api/me/memories`; `PATCH /api/me/memories/{id}`; `DELETE /api/me/memories/{id}`; `DELETE /api/me/memories`; `DELETE /api/me/conversations/{chat_id}`.

- [ ] **Step 1: Write failing test.** Create `backend/tests/test_memory_endpoints.py`:

```python
"""Idle-sweep auth guard (403 without the secret)."""
import os
from fastapi.testclient import TestClient
import main

client = TestClient(main.app)


def test_idle_sweep_requires_secret():
    r = client.post("/api/internal/memory/idle-sweep")
    assert r.status_code == 403


def test_idle_sweep_wrong_secret(monkeypatch):
    monkeypatch.setenv("RESEARCH_SECRET", "right")
    r = client.post("/api/internal/memory/idle-sweep", headers={"X-Research-Secret": "wrong"})
    assert r.status_code == 403
```

- [ ] **Step 2: Run — expect FAIL** (route 404 → assertion fails):

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_endpoints.py -v`
Expected: FAIL — 404 not 403.

- [ ] **Step 3: Add the idle-sweep endpoint** next to the existing consolidate endpoint in `main.py`:

```python
@app.post("/api/internal/memory/idle-sweep")
async def internal_memory_idle_sweep(request: Request):
    """Idle-sweep cron (every 5 min): extract facts for users idle 5-10 min."""
    secret = request.headers.get("X-Research-Secret", "")
    expected = os.getenv("RESEARCH_SECRET", "")
    if not expected or secret != expected:
        raise HTTPException(status_code=403, detail="Invalid research secret")
    from services.memory_service import consolidate_idle_users
    result = await asyncio.to_thread(consolidate_idle_users, 5, 10)
    return result
```

- [ ] **Step 4: Add the user memory endpoints.** Place near other `get_current_user` routes:

```python
@app.get("/api/me/memories")
async def get_my_memories(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from models import UserMemory, ChatHistory
    facts = (
        db.query(UserMemory)
        .filter(UserMemory.user_id == user["user_id"])
        .order_by(UserMemory.updated_at.desc())
        .all()
    )
    embedded = (
        db.query(func.count(ChatHistory.id))
        .filter(ChatHistory.user_id == user["user_id"], ChatHistory.embedding.isnot(None))
        .scalar()
    )
    return {
        "facts": [
            {
                "id": m.id, "type": m.memory_type, "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else "",
                "updated_at": m.updated_at.isoformat() if m.updated_at else "",
                "paused": bool(m.paused),
            }
            for m in facts
        ],
        "stats": {"fact_count": len(facts), "embedded_turns": int(embedded or 0)},
    }


@app.patch("/api/me/memories/{memory_id}")
async def patch_my_memory(memory_id: int, req: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from models import UserMemory
    from services.memory_service import _serialize_embedding, EMBEDDING_MODEL_VERSION
    from services.embedding_util import embed_text
    m = db.query(UserMemory).filter(UserMemory.id == memory_id, UserMemory.user_id == user["user_id"]).first()
    if not m:
        raise HTTPException(404, "Memory not found")
    if "paused" in req:
        m.paused = bool(req["paused"])
    if "content" in req and req["content"]:
        m.content = str(req["content"]).strip()
        vec = embed_text(m.content)
        m.embedding = _serialize_embedding(vec) if vec else None
        m.embedding_model = EMBEDDING_MODEL_VERSION if vec else None
    db.commit()
    return {"message": "updated", "id": m.id, "paused": bool(m.paused)}


@app.delete("/api/me/memories/{memory_id}")
async def delete_my_memory(memory_id: int, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from models import UserMemory
    m = db.query(UserMemory).filter(UserMemory.id == memory_id, UserMemory.user_id == user["user_id"]).first()
    if not m:
        raise HTTPException(404, "Memory not found")
    db.delete(m)
    db.commit()
    return {"message": "deleted", "id": memory_id}


@app.delete("/api/me/memories")
async def delete_all_my_memories(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from models import UserMemory, ChatHistory
    n = db.query(UserMemory).filter(UserMemory.user_id == user["user_id"]).delete(synchronize_session=False)
    db.query(ChatHistory).filter(ChatHistory.user_id == user["user_id"]).update(
        {ChatHistory.embedding: None, ChatHistory.embedding_model: None}, synchronize_session=False
    )
    db.commit()
    return {"message": "erased", "facts_deleted": int(n)}


@app.delete("/api/me/conversations/{chat_id}")
async def delete_my_conversation_turn(chat_id: int, hard: bool = False, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from models import ChatHistory
    row = db.query(ChatHistory).filter(ChatHistory.id == chat_id, ChatHistory.user_id == user["user_id"]).first()
    if not row:
        raise HTTPException(404, "Not found")
    if hard:
        db.delete(row)
    else:
        row.embedding = None
        row.embedding_model = None
    db.commit()
    return {"message": "deleted" if hard else "unindexed", "id": chat_id}
```

- [ ] **Step 5: Run — expect PASS.**

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/test_memory_endpoints.py -v`
Expected: 2 passed.

- [ ] **Step 6: Commit.**

```bash
git add backend/main.py backend/tests/test_memory_endpoints.py
git commit -m "feat(memory): idle-sweep cron + user memory-management endpoints"
```

---

### Task 9: Deploy config, docs, and ops runbook

Wire the feature flags into the backend deploy, document the now-live system, and record the ops steps (enable Scheduler API + create crons). No automated test — verification is the deploy/ops checklist.

**Files:**
- Modify: `cloudbuild.yaml` (backend `--set-env-vars` in the `deploy-backend` step)
- Modify: `CLAUDE.md` (memory/cron section)
- Create: `docs/superpowers/plans/ops-memory-crons.md` (runbook)

- [ ] **Step 1: Add feature flags to the backend deploy env.** In `cloudbuild.yaml`, find the backend `--set-env-vars` (the one using the `^##^` delimiter). Append the memory flags to the SAME arg (remember: `--set-env-vars` replaces the entire set — do not create a second flag). Add:
`ENABLE_SESSION_SUMMARY=true`, `ENABLE_VERBATIM_RECALL=true`, `ENABLE_REALTIME_MEMORY=true`, `USE_SEMANTIC_MEMORY_RECALL=true`, `EMBEDDING_MAX_RPM=50`.

> NOTE: these all default to true in code, so omitting them is functionally identical — but listing them makes the toggles discoverable and lets you flip one to `false` via a redeploy without a code change. `RESEARCH_SECRET` is already wired (used by existing crons).

- [ ] **Step 2: Write the ops runbook.** Create `docs/superpowers/plans/ops-memory-crons.md`:

```markdown
# Memory crons — ops runbook

Prereq: Cloud Scheduler API is DISABLED on cs-navigator-498115 (verified 2026-07-20).
gcloud lives at ~/google-cloud-sdk/bin/gcloud (not on PATH).

## 1. Enable the API
~/google-cloud-sdk/bin/gcloud services enable cloudscheduler.googleapis.com --project=cs-navigator-498115

## 2. Create the nightly consolidate job (3am ET)
~/google-cloud-sdk/bin/gcloud scheduler jobs create http memory-consolidate \
  --location=us-central1 --schedule="0 3 * * *" --time-zone="America/New_York" \
  --uri="https://csnavigator-backend-900141432581.us-central1.run.app/api/internal/memory/consolidate" \
  --http-method=POST --headers="X-Research-Secret=<RESEARCH_SECRET value>" \
  --project=cs-navigator-498115

## 3. Create the idle-sweep job (every 5 min)
~/google-cloud-sdk/bin/gcloud scheduler jobs create http memory-idle-sweep \
  --location=us-central1 --schedule="*/5 * * * *" \
  --uri="https://csnavigator-backend-900141432581.us-central1.run.app/api/internal/memory/idle-sweep" \
  --http-method=POST --headers="X-Research-Secret=<RESEARCH_SECRET value>" \
  --project=cs-navigator-498115

## 4. Force-run to verify (should return HTTP 200 + a JSON status)
~/google-cloud-sdk/bin/gcloud scheduler jobs run memory-consolidate --location=us-central1 --project=cs-navigator-498115

## 5. Confirm facts populate
Check logs: gcloud logging read 'resource.labels.service_name="csnavigator-backend" AND textPayload:"[MEMORY]"' --project=cs-navigator-498115

## SEPARATE ISSUE (do not fold into this work)
The reminders + live-seats crons documented in CLAUDE.md ALSO depend on this
disabled API and are likely not firing. Verify/recreate them separately.
```

- [ ] **Step 3: Update CLAUDE.md.** Replace the orphaned-memory note with a description of the now-live five-layer system: read path (recent turns + summary + fact/turn recall via `state_delta["memory"]`), write path (post-commit tasks: embed every turn, summary at ≥8, extract every 6 turns, idle-sweep 5–10 min, nightly 3am), feature flags, the fact categories, GPA/grades exclusion, and a pointer to `docs/superpowers/plans/ops-memory-crons.md`.

- [ ] **Step 4: Run the full backend test suite** to confirm nothing regressed:

Run: `cd backend && GOOGLE_GENAI_USE_VERTEXAI=FALSE python3 -m pytest tests/ -q`
Expected: all pass (new memory tests + pre-existing suite).

- [ ] **Step 5: Commit.**

```bash
git add cloudbuild.yaml CLAUDE.md docs/superpowers/plans/ops-memory-crons.md
git commit -m "chore(memory): deploy flags, CLAUDE.md docs, cron runbook"
```

---

## Verification (whole feature)

After Task 9, exercise end-to-end locally per CLAUDE.md's local-run recipe, then confirm on prod after deploy:

1. **Within-conversation:** send 3 turns to `/chat/stream` on one `session_id`; turn 3's model input must contain turn-1/2 context (add a temporary log of `memory_context` length, or assert via the `/verify` skill driving the real app). This is the flakiness fix.
2. **Session summary:** post 8+ turns; a `chat_history.session_summary` row appears.
3. **Facts:** post 6+ substantive turns; a `user_memories` row appears with the right category and a non-null `embedding`.
4. **Cross-session:** new `session_id`, ask "what was I looking at?"; the prior fact/turn is injected.
5. **Privacy:** a turn stating a GPA must NOT produce a `user_memories` row containing it.
6. **Crons:** force-run both jobs; HTTP 200 + `[MEMORY]` logs.

## Notes on ordering & phasing

Tasks 1–5 are pure backend library work (no user-visible change) and can land together. Task 6 is the moment within-conversation memory goes live. Task 7 turns on the write path. Tasks 8–9 add management + ops. If you want the fastest correctness win first, Tasks 1→6 alone fix the within-conversation flakiness even before extraction/crons exist (facts just stay empty).
