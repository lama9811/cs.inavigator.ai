"""Best-effort normalized Coding Tutor learning timeline events."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from models import CodingLearningEvent


MAX_METADATA_CHARS = 2000
MINI_PLAN_EVENT_TYPES = {
    "mini_plan_started",
    "mini_plan_step_opened",
    "mini_plan_step_completed",
    "mini_plan_completed",
}
FRONTEND_EVENT_TYPES = {"recommendation_dismissed", "recommendation_opened", *MINI_PLAN_EVENT_TYPES}
KNOWN_EVENT_TYPES = {
    "lesson_opened",
    "lesson_completed",
    "starting_check_completed",
    "starting_check_skipped",
    "quiz_checked",
    "quiz_missed",
    "quiz_retried",
    "practice_run",
    "practice_solved",
    "practice_failed",
    "hint_used",
    "trace_used",
    "tutor_debug_used",
    "tutor_rewrite_used",
    "tutor_action_used",
    *FRONTEND_EVENT_TYPES,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _short(value: Any, limit: int) -> Optional[str]:
    if value in (None, ""):
        return None
    return str(value).strip()[:limit] or None


def _safe_metadata(metadata: Any) -> Optional[str]:
    if not isinstance(metadata, dict) or not metadata:
        return None
    safe: dict[str, Any] = {}
    for raw_key, raw_value in metadata.items():
        key = str(raw_key)[:50]
        if raw_value is None:
            safe[key] = None
        elif isinstance(raw_value, (bool, int, float)):
            safe[key] = raw_value
        elif isinstance(raw_value, (list, tuple)):
            safe[key] = [str(item)[:120] for item in raw_value[:10]]
        elif isinstance(raw_value, dict):
            safe[key] = {
                str(child_key)[:40]: str(child_value)[:120]
                for child_key, child_value in list(raw_value.items())[:12]
            }
        else:
            safe[key] = str(raw_value)[:240]
    raw = json.dumps(safe, separators=(",", ":"), sort_keys=True)
    if len(raw) > MAX_METADATA_CHARS:
        raw = raw[:MAX_METADATA_CHARS]
    return raw


def metadata_dict(row: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(getattr(row, "metadata_json", None) or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def serialize_event(row: CodingLearningEvent) -> dict[str, Any]:
    return {
        "id": row.id,
        "event_type": row.event_type,
        "language": row.language,
        "surface": row.surface,
        "category": row.category,
        "topic": row.topic,
        "question_id": row.question_id,
        "source": row.source,
        "difficulty": row.difficulty,
        "outcome": row.outcome,
        "error_class": row.error_class,
        "metadata": metadata_dict(row),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def record_event(
    db: Session,
    *,
    user_id: int,
    event_type: str,
    language: Any = None,
    surface: Any = None,
    category: Any = None,
    topic: Any = None,
    question_id: Any = None,
    source: Any = None,
    difficulty: Any = None,
    outcome: Any = None,
    error_class: Any = None,
    metadata: Any = None,
    commit: bool = False,
) -> CodingLearningEvent:
    event = CodingLearningEvent(
        user_id=user_id,
        event_type=_short(event_type, 60) or "unknown",
        language=_short(language, 30),
        surface=_short(surface, 40),
        category=_short(category, 80),
        topic=_short(topic, 80),
        question_id=_short(question_id, 80),
        source=_short(source, 40),
        difficulty=_short(difficulty, 20),
        outcome=_short(outcome, 30),
        error_class=_short(error_class, 40),
        metadata_json=_safe_metadata(metadata),
    )
    db.add(event)
    if commit:
        db.commit()
        db.refresh(event)
    return event


def record_event_safely(db: Session, **kwargs: Any) -> Optional[CodingLearningEvent]:
    try:
        return record_event(db, commit=True, **kwargs)
    except Exception as exc:  # pragma: no cover - defensive instrumentation
        try:
            db.rollback()
        except Exception:
            pass
        print(f"[WARN] Coding learning event was not saved: {exc}")
        return None


def recent_events(
    db: Session,
    user_id: int,
    *,
    language: Optional[str] = None,
    days: int = 30,
    limit: int = 200,
) -> list[CodingLearningEvent]:
    since = _utcnow() - timedelta(days=max(1, days))
    query = db.query(CodingLearningEvent).filter(
        CodingLearningEvent.user_id == user_id,
        CodingLearningEvent.created_at >= since,
    )
    if language:
        query = query.filter(
            (CodingLearningEvent.language == language)
            | (CodingLearningEvent.language.is_(None))
        )
    return (
        query.order_by(CodingLearningEvent.created_at.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
