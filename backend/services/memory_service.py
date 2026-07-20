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


def build_memory_context(memories: list[dict]) -> str:
    """Build a context string from user memories for agent injection."""
    if not memories:
        return ""

    ctx = "\nUSER MEMORY (long-term context from past sessions):\n"
    for m in memories:
        ctx += f"[{m['memory_type']}] {m['content']}\n"
    ctx += "(Use this context to personalize responses. Do not repeat these facts verbatim.)\n"
    return ctx


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
