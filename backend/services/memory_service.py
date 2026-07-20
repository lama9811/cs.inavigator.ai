"""
Long-term User Memory Service
===============================
Tier 2 memory: consolidates daily conversations into persistent user memories
stored in RDS. Runs via cron job at 3am (after the 2am research job).

Memories give the chatbot long-term context about each student:
- What topics they care about
- Their academic interests and goals
- Interaction patterns and preferences

FERPA-safe: stored on our own RDS, not Vertex AI. No grades or PII in memory
content, only behavioral/interest summaries.
"""

import os
import json
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from db import SessionLocal


EMBEDDING_MODEL_VERSION = "text-embedding-004@256"

# The filter: what counts as "key information" worth remembering. Factored to a
# module constant so it's testable without invoking Gemini.
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


def fetch_user_memories(user_id: int, db: Session, limit: int = 10) -> list[dict]:
    """Fetch a user's long-term memories from RDS.

    Returns list of {memory_type, content, updated_at} dicts.
    """
    from models import UserMemory

    memories = (
        db.query(UserMemory)
        .filter(UserMemory.user_id == user_id)
        .order_by(UserMemory.updated_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "memory_type": m.memory_type,
            "content": m.content,
            "updated_at": m.updated_at.isoformat() if m.updated_at else "",
        }
        for m in memories
    ]


def fetch_user_memories_sync(user_id: int, limit: int = 10) -> list[dict]:
    """Fetch memories in a separate DB session (for parallel async execution)."""
    db = SessionLocal()
    try:
        return fetch_user_memories(user_id, db, limit)
    finally:
        db.close()


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


def consolidate_user_memories(hours_back: int = 24) -> dict:
    """Consolidate recent conversations into long-term memories for all active users.

    Called by cron job. For each user with conversations in the time window:
    1. Fetch their recent conversations
    2. Use Gemini to extract key facts (interests, goals, preferences)
    3. Merge with existing memories (update, don't duplicate)

    Returns summary of what was processed.
    """
    from models import UserMemory, ChatHistory

    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(hours=hours_back)

        # Find users with recent conversations
        active_users = (
            db.query(ChatHistory.user_id, func.count(ChatHistory.id).label("msg_count"))
            .filter(ChatHistory.timestamp >= cutoff)
            .group_by(ChatHistory.user_id)
            .all()
        )

        if not active_users:
            return {"status": "no_active_users", "processed": 0}

        processed = 0
        errors = 0

        for user_id, msg_count in active_users:
            try:
                # Fetch recent conversations
                chats = (
                    db.query(ChatHistory)
                    .filter(
                        ChatHistory.user_id == user_id,
                        ChatHistory.timestamp >= cutoff,
                    )
                    .order_by(ChatHistory.timestamp.asc())
                    .limit(50)  # Cap to avoid huge prompts
                    .all()
                )

                if not chats or len(chats) < 3:
                    continue  # Skip users with very few messages

                # Build conversation transcript
                transcript = "\n".join(
                    f"Student: {c.user_query}\nBot: {c.bot_response[:200]}"
                    for c in chats
                )

                # Fetch existing memories for context
                existing = (
                    db.query(UserMemory)
                    .filter(UserMemory.user_id == user_id)
                    .all()
                )
                existing_text = "\n".join(
                    f"[{m.memory_type}] {m.content}" for m in existing
                ) if existing else "None"

                # Use Gemini to extract key facts
                new_memories = _extract_memories(transcript, existing_text)

                if new_memories:
                    _merge_memories(db, user_id, new_memories, existing)
                    processed += 1

            except Exception as e:
                print(f"[MEMORY] Error consolidating user {user_id}: {e}")
                errors += 1

        db.commit()
        return {
            "status": "completed",
            "active_users": len(active_users),
            "processed": processed,
            "errors": errors,
        }

    finally:
        db.close()


def _extract_memories(transcript: str, existing_memories: str, client=None) -> list[dict]:
    """Use Gemini to extract key facts from a conversation transcript.

    Returns list of {memory_type, content} dicts. `client` may be injected
    (tests); otherwise a Vertex/Gemini client is built lazily.
    """
    try:
        from google import genai

        if client is None:
            project = os.getenv("GOOGLE_CLOUD_PROJECT", "csnavigator-vertex-ai")
            try:
                client = genai.Client(vertexai=True, project=project, location="us-central1")
            except Exception:
                api_key = os.getenv("GEMINI_API_KEY", "")
                if not api_key:
                    print("   [MEMORY] No Gemini client available")
                    return []
                client = genai.Client(api_key=api_key)

        prompt = f"""Analyze this student's conversation with CS Navigator (Morgan State University CS academic advisor) and extract key facts worth remembering for future sessions.

The user is a Morgan State Computer Science student.

{EXTRACTION_RULES_TEXT}

Existing memories:
{existing_memories}

Today's conversations:
{transcript[:4000]}

Return a JSON array like: [{{"type": "interest", "content": "Interested in machine learning"}}, ...]
If nothing new worth remembering, return: []"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"temperature": 0.1, "max_output_tokens": 1000},
        )

        text = response.text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        memories = json.loads(text)
        if not isinstance(memories, list):
            return []

        return [
            {"memory_type": m.get("type", "context"), "content": m.get("content", "")}
            for m in memories
            if m.get("content")
        ]

    except Exception as e:
        print(f"   [MEMORY] Extraction failed: {e}")
        return []


def _merge_memories(db: Session, user_id: int, new_memories: list[dict], existing: list):
    """Merge new memories with existing ones. Update if same type exists, else create."""
    from models import UserMemory

    existing_by_type = {}
    for m in existing:
        existing_by_type.setdefault(m.memory_type, []).append(m)

    for mem in new_memories:
        mtype = mem["memory_type"]
        content = mem["content"].strip()
        if not content:
            continue

        type_memories = existing_by_type.get(mtype, [])

        # Dedup: skip if an existing memory already contains this info (or vice versa)
        content_lower = content.lower()
        is_duplicate = any(
            content_lower in m.content.lower() or m.content.lower() in content_lower
            for m in type_memories
        )
        if is_duplicate:
            continue

        # Compute embedding now so retrieve_relevant_memories can rank it.
        from services.embedding_util import embed_text
        emb_vec = embed_text(content)
        emb_serialized = _serialize_embedding(emb_vec) if emb_vec else None
        emb_model = EMBEDDING_MODEL_VERSION if emb_vec else None

        if len(type_memories) < 5:
            # Room for more memories of this type
            new_mem = UserMemory(
                user_id=user_id,
                memory_type=mtype,
                content=content,
                embedding=emb_serialized,
                embedding_model=emb_model,
            )
            db.add(new_mem)
        else:
            # Update the oldest memory of this type — also refresh its embedding.
            oldest = min(type_memories, key=lambda m: m.updated_at or m.created_at)
            oldest.content = content
            oldest.embedding = emb_serialized
            oldest.embedding_model = emb_model
            oldest.updated_at = datetime.utcnow()


# ============================================================================
# Semantic + verbatim retrieval (Layer 4)
# ============================================================================

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


# ============================================================================
# Session summary (Layer 2)
# ============================================================================

def summarize_older_turns(transcript, client=None):
    """LLM-summarize the older portion of a session. None on empty/failure.
    `client` may be injected (tests)."""
    if not transcript or not transcript.strip():
        return None
    try:
        from google import genai

        if client is None:
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


# ============================================================================
# Realtime + idle extraction (Layer 3)
# ============================================================================

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
