"""Canonical next-step recommendations for Coding Tutor.

This service is intentionally deterministic. It combines the durable progress
logs we already keep and returns one action the frontend can render anywhere.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from services import adaptive_practice, mastery


BEGINNER_TOPICS = ("conditionals", "arrays", "strings", "math", "tuples", "sets", "hash maps")
ADVANCED_TOPICS = {
    "binary search",
    "bit manipulation",
    "disjoint sets",
    "dynamic programming",
    "graphs",
    "heaps",
    "intervals",
    "linked lists",
    "prefix sums",
    "recursion",
    "sliding window",
    "trees",
    "tries",
    "two pointers",
}
PASS_SCORE = 0.7
QUIZ_MISS_THRESHOLD = 2
DISMISS_COOLDOWN_HOURS = 24
STARTING_CHECK_SKIP_COOLDOWN_DAYS = 14
QUIZ_STEP_CHECK_COUNT = 3


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _title(value: Any) -> str:
    return " ".join(word.capitalize() for word in _norm(value).split())


def _display_topic(value: Any) -> str:
    topic = _norm(value)
    labels = {
        "debug": "Debugging",
        "debug-2": "Debugging",
        "algorithm-problems": "Algorithm Problems",
        "algorithm-problems-2": "Algorithm Problems",
    }
    return labels.get(topic, _title(topic))


def _parse_json(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback
    return parsed if parsed is not None else fallback


def _dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    return None


def _iso(value: Any) -> Optional[str]:
    stamp = _dt(value)
    return stamp.isoformat() if stamp else None


def _target(mode: str, **kwargs: Any) -> dict[str, Any]:
    return {"mode": mode, **{key: value for key, value in kwargs.items() if value not in (None, "")}}


def _slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _norm(value)).strip("-") or "step"


def _recommendation(
    *,
    kind: str,
    title: str,
    reason: str,
    action_label: str,
    target: dict[str, Any],
    confidence: str,
    source: str,
    beginner_mode: bool,
    evidence: Optional[dict[str, Any]] = None,
    topic: Optional[str] = None,
    question: Optional[dict[str, Any]] = None,
    review_signal: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    payload = {
        "kind": kind,
        "title": title,
        "reason": reason,
        "action_label": action_label,
        "target": target,
        "confidence": confidence,
        "source": source,
        "beginner_mode": beginner_mode,
        "evidence": evidence or {},
    }
    if topic:
        payload["topic"] = topic
    if question:
        payload["question"] = question
    if review_signal:
        payload["review_signal"] = review_signal
    return payload


def _event_metadata(row: Any) -> dict[str, Any]:
    raw = getattr(row, "metadata_json", None)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def _event_time(row: Any) -> Optional[datetime]:
    created = getattr(row, "created_at", None)
    if not isinstance(created, datetime):
        return None
    return created.replace(tzinfo=None) if created.tzinfo else created


def _aware_now(rows: Iterable[Any]) -> datetime:
    stamps = [getattr(row, "created_at", None) for row in rows or [] if getattr(row, "created_at", None)]
    if not stamps:
        return datetime.utcnow()
    latest = max(stamps)
    return latest.replace(tzinfo=None) if latest.tzinfo else latest


def _same_recommendation(row: Any, recommendation: dict[str, Any]) -> bool:
    meta = _event_metadata(row)
    target = recommendation.get("target") or {}
    if meta.get("kind") and meta.get("kind") != recommendation.get("kind"):
        return False
    for key in ("topic", "category"):
        expected = _norm(recommendation.get(key) or target.get(key))
        actual = _norm(meta.get(key) or getattr(row, key, None))
        if expected and actual and expected != actual:
            return False
    target_mode = _norm(target.get("mode"))
    meta_mode = _norm(meta.get("target_mode"))
    if target_mode and meta_mode and target_mode != meta_mode:
        return False
    target_question = _norm(target.get("question_id") or target.get("questionId") or (recommendation.get("question") or {}).get("id"))
    meta_question = _norm(meta.get("question_id") or getattr(row, "question_id", None))
    if target_question and meta_question and target_question != meta_question:
        return False
    return True


def _dismissal_cooldown(
    learning_event_rows: Iterable[Any],
    recommendation: dict[str, Any],
) -> Optional[dict[str, Any]]:
    now = _aware_now(learning_event_rows)
    for row in learning_event_rows or []:
        if getattr(row, "event_type", None) != "recommendation_dismissed":
            continue
        created = getattr(row, "created_at", None)
        if not created:
            continue
        created = created.replace(tzinfo=None) if created.tzinfo else created
        if now - created > timedelta(hours=DISMISS_COOLDOWN_HOURS):
            continue
        if _same_recommendation(row, recommendation):
            expires = created + timedelta(hours=DISMISS_COOLDOWN_HOURS)
            return {
                "type": "recommendation_dismissed",
                "reason": "This recommendation was dismissed recently.",
                "expires_at": expires.isoformat(),
                "topic": recommendation.get("topic"),
                "kind": recommendation.get("kind"),
            }
    return None


def _starting_skip_cooldown(learning_event_rows: Iterable[Any], *, has_signal: bool) -> Optional[dict[str, Any]]:
    if not has_signal:
        return None
    now = _aware_now(learning_event_rows)
    for row in learning_event_rows or []:
        if getattr(row, "event_type", None) != "starting_check_skipped":
            continue
        created = getattr(row, "created_at", None)
        if not created:
            continue
        created = created.replace(tzinfo=None) if created.tzinfo else created
        if now - created <= timedelta(days=STARTING_CHECK_SKIP_COOLDOWN_DAYS):
            return {
                "type": "starting_check_skipped",
                "reason": "Starting check was skipped recently.",
                "expires_at": (created + timedelta(days=STARTING_CHECK_SKIP_COOLDOWN_DAYS)).isoformat(),
            }
    return None


def _topic_from_recommendation(recommendation: dict[str, Any]) -> str:
    target = recommendation.get("target") or {}
    return _norm(recommendation.get("topic") or target.get("topic") or target.get("category"))


def _learning_topic_from_recommendation(recommendation: dict[str, Any]) -> str:
    target = recommendation.get("target") or {}
    kind = _norm(recommendation.get("kind"))
    mode = _norm(target.get("mode"))
    if kind in {"review", "error_checkpoint"} or mode == "lesson_review":
        return _norm(target.get("category") or target.get("topic") or recommendation.get("topic"))
    return _topic_from_recommendation(recommendation)


def _build_explanation(
    recommendation: dict[str, Any],
    *,
    advanced_blocked_topic: Optional[str] = None,
    cooldowns: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    evidence = recommendation.get("evidence") or {}
    topic = _topic_from_recommendation(recommendation)
    title = _title(topic) if topic else recommendation.get("title", "this step")
    source = recommendation.get("source") or "adaptive"
    evidence_used: list[str] = []
    if recommendation.get("kind") == "first_run":
        evidence_used.append("No completed lessons, quiz checks, or practice runs yet.")
    if evidence.get("count"):
        evidence_used.append(f"{evidence.get('count')} recent matching error signals.")
    if evidence.get("misses"):
        evidence_used.append(f"{evidence.get('misses')} missed quiz checks.")
    if evidence.get("attempts") is not None:
        evidence_used.append(f"{evidence.get('attempts')} practice attempts.")
    if evidence.get("completed_at"):
        evidence_used.append("A recently completed lesson.")
    if not evidence_used:
        evidence_used.append(f"Recommendation source: {source.replace('_', ' ')}.")

    if recommendation.get("beginner_mode"):
        why_topic = "This keeps the first step in beginner material."
        why_difficulty = "Beginner mode starts with short lessons and Easy practice."
    elif topic:
        why_topic = f"{title} is the topic connected to the strongest current signal."
        why_difficulty = "The difficulty stays low until there is enough scored practice evidence."
    else:
        why_topic = "This is the clearest action from the current progress."
        why_difficulty = "The app is using the safest available difficulty."

    if advanced_blocked_topic:
        why_not_advanced = (
            f"{_title(advanced_blocked_topic)} is not being recommended yet because one attempt is not enough evidence."
        )
    elif topic in ADVANCED_TOPICS and recommendation.get("confidence") == "high":
        why_not_advanced = ""
    else:
        why_not_advanced = "Advanced topics need repeated or scored evidence first."

    what_would_change = "Solving problems, completing a lesson, or repeating the same miss can change this recommendation."
    if cooldowns:
        what_would_change = "A dismissed recommendation can return after its cooldown, or sooner if new work creates stronger evidence."

    return {
        "summary": recommendation.get("reason") or "This is the next useful Coding Tutor step.",
        "evidence_used": evidence_used[:4],
        "why_topic": why_topic,
        "why_difficulty": why_difficulty,
        "why_not_advanced": why_not_advanced,
        "what_would_change": what_would_change,
    }


def _build_mini_plan(recommendation: dict[str, Any], *, language: str) -> list[dict[str, Any]]:
    topic = _learning_topic_from_recommendation(recommendation) or "conditionals"
    display = _display_topic(topic)
    lesson_target = _target("learn_topic", language=language, topic=topic)
    quiz_target = _target("quiz", language=language, category=topic)
    practice_target = _target("practice", topic=topic, difficulty="easy")
    return [
        {"id": f"learn-{_slug(topic)}", "label": f"Review {display}", "target": lesson_target},
        {"id": f"quiz-{_slug(topic)}", "label": f"Answer 3 {display} checks", "target": quiz_target},
        {"id": f"practice-{_slug(topic)}", "label": f"Try one Easy {display} problem", "target": practice_target},
        {"id": f"trace-debug-{_slug(topic)}", "label": "If a run fails, use Trace or Debug", "target": _target("workspace", tool="trace")},
    ]


def _plan_topic(recommendation: dict[str, Any]) -> str:
    return _learning_topic_from_recommendation(recommendation) or _topic_from_recommendation(recommendation) or "conditionals"


def _plan_id(recommendation: dict[str, Any], *, language: str) -> str:
    target = recommendation.get("target") or {}
    parts = [
        language,
        recommendation.get("kind"),
        recommendation.get("source"),
        _plan_topic(recommendation),
        target.get("mode"),
        target.get("question_id") or target.get("questionId") or (recommendation.get("question") or {}).get("id"),
    ]
    return "plan-" + "-".join(_slug(part) for part in parts if part not in (None, ""))


def _latest_learn_completion(learn_rows: Iterable[Any], topic: str) -> Optional[str]:
    matches = [
        row for row in learn_rows or []
        if _norm(getattr(row, "category", None)) == _norm(topic)
        and _norm(getattr(row, "status", None)) in {"opened", "completed"}
    ]
    matches.sort(key=lambda row: getattr(row, "completed_at", None) or getattr(row, "last_opened_at", None) or getattr(row, "updated_at", None) or datetime.min, reverse=True)
    row = matches[0] if matches else None
    if not row:
        return None
    return _iso(getattr(row, "completed_at", None)) or _iso(getattr(row, "last_opened_at", None)) or _iso(getattr(row, "updated_at", None))


def _latest_quiz_progress_time(concept_rows: Iterable[Any], topic: str, *, min_checked: int = QUIZ_STEP_CHECK_COUNT) -> Optional[str]:
    rows = [
        row for row in concept_rows or []
        if _norm(getattr(row, "category", None)) == _norm(topic)
    ]
    rows.sort(key=lambda row: getattr(row, "created_at", None) or datetime.min, reverse=True)
    checked = 0
    latest: Optional[datetime] = None
    seen: set[str] = set()
    for row in rows:
        created = getattr(row, "created_at", None)
        for result in _parse_json(getattr(row, "results_json", None), []):
            qid = str(result.get("question_id") or "")
            if qid and qid in seen:
                continue
            if qid:
                seen.add(qid)
            checked += 1
        if created and (latest is None or created > latest):
            latest = created
        if checked >= min_checked:
            return _iso(latest)
    return None


def _latest_practice_progress_time(
    questions_by_id: dict[str, dict[str, Any]],
    progress_rows: Iterable[Any],
    attempt_rows: Iterable[Any],
    topic: str,
) -> Optional[str]:
    stamps: list[datetime] = []
    for row in progress_rows or []:
        question = questions_by_id.get(str(getattr(row, "question_id", "")))
        if question and _norm(question.get("topic")) == _norm(topic) and _progress_status(row) != "not_started":
            stamp = getattr(row, "last_attempt_at", None) or getattr(row, "solved_at", None) or getattr(row, "updated_at", None)
            if isinstance(stamp, datetime):
                stamps.append(stamp)
    for row in attempt_rows or []:
        if _norm(getattr(row, "topic", None)) == _norm(topic):
            stamp = getattr(row, "created_at", None)
            if isinstance(stamp, datetime):
                stamps.append(stamp)
    if not stamps:
        return None
    return max(stamps).isoformat()


def _latest_trace_or_debug_time(learning_event_rows: Iterable[Any], topic: str) -> Optional[str]:
    stamps = []
    for row in learning_event_rows or []:
        if getattr(row, "event_type", None) not in {"trace_used", "tutor_debug_used"}:
            continue
        if _norm(getattr(row, "topic", None) or getattr(row, "category", None)) not in {_norm(topic), ""}:
            continue
        stamp = _event_time(row)
        if stamp:
            stamps.append(stamp)
    return max(stamps).isoformat() if stamps else None


def _latest_active_plan_topic(learning_event_rows: Iterable[Any]) -> Optional[dict[str, Any]]:
    rows = [
        row for row in learning_event_rows or []
        if getattr(row, "event_type", None) in {"mini_plan_started", "mini_plan_step_opened", "recommendation_opened"}
    ]
    rows.sort(key=lambda row: _event_time(row) or datetime.min, reverse=True)
    for row in rows:
        meta = _event_metadata(row)
        topic = _norm(meta.get("plan_topic") or meta.get("topic") or getattr(row, "topic", None) or getattr(row, "category", None))
        if topic and topic not in ADVANCED_TOPICS:
            return {
                "topic": topic,
                "event_type": getattr(row, "event_type", None),
                "at": _iso(getattr(row, "created_at", None)),
            }
    return None


def _dismissed_plan_steps(learning_event_rows: Iterable[Any], plan_id: str) -> set[str]:
    dismissed: set[str] = set()
    for row in learning_event_rows or []:
        if getattr(row, "event_type", None) != "recommendation_dismissed":
            continue
        meta = _event_metadata(row)
        if meta.get("plan_id") == plan_id and meta.get("step_id"):
            dismissed.add(str(meta["step_id"]))
    return dismissed


def _decorate_mini_plan_steps(
    plan: list[dict[str, Any]],
    *,
    plan_id: str,
    topic: str,
    questions_by_id: dict[str, dict[str, Any]],
    progress_rows: Iterable[Any],
    attempt_rows: Iterable[Any],
    concept_rows: Iterable[Any],
    learn_rows: Iterable[Any],
    learning_event_rows: Iterable[Any],
) -> list[dict[str, Any]]:
    completions = {
        "learn": _latest_learn_completion(learn_rows, topic),
        "quiz": _latest_quiz_progress_time(concept_rows, topic),
        "practice": _latest_practice_progress_time(questions_by_id, progress_rows, attempt_rows, topic),
        "trace-debug": _latest_trace_or_debug_time(learning_event_rows, topic),
    }
    if completions["quiz"] and not completions["learn"]:
        completions["learn"] = completions["quiz"]
    if completions["practice"]:
        completions["quiz"] = completions["quiz"] or completions["practice"]
        completions["learn"] = completions["learn"] or completions["practice"]
    if completions["trace-debug"]:
        completions["practice"] = completions["practice"] or completions["trace-debug"]
        completions["quiz"] = completions["quiz"] or completions["trace-debug"]
        completions["learn"] = completions["learn"] or completions["trace-debug"]
    dismissed = _dismissed_plan_steps(learning_event_rows, plan_id)
    decorated: list[dict[str, Any]] = []
    current_set = False
    for step in plan:
        prefix = str(step.get("id") or "").split("-", 1)[0]
        if str(step.get("id") or "").startswith("trace-debug"):
            prefix = "trace-debug"
        completed_at = completions.get(prefix)
        status = "completed" if completed_at else "upcoming"
        if step.get("id") in dismissed and status != "completed":
            status = "dismissed"
        is_current = False
        if status == "upcoming" and not current_set:
            is_current = True
            status = "current"
            current_set = True
        decorated.append({**step, "status": status, "completed_at": completed_at, "is_current": is_current})
    if decorated and not any(step.get("is_current") for step in decorated):
        decorated[-1] = {**decorated[-1], "is_current": True}
    return decorated


def _decorate_recommendation(
    recommendation: dict[str, Any],
    *,
    language: str,
    questions_by_id: dict[str, dict[str, Any]],
    progress_rows: Iterable[Any],
    attempt_rows: Iterable[Any],
    concept_rows: Iterable[Any],
    learn_rows: Iterable[Any],
    learning_event_rows: Iterable[Any],
    has_signal: bool,
    advanced_blocked_topic: Optional[str] = None,
    extra_cooldowns: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    cooldowns = list(extra_cooldowns or [])
    skip_cooldown = _starting_skip_cooldown(learning_event_rows, has_signal=has_signal)
    if skip_cooldown:
        cooldowns.append(skip_cooldown)
    plan_id = _plan_id(recommendation, language=language)
    plan_topic = _plan_topic(recommendation)
    mini_plan = _decorate_mini_plan_steps(
        _build_mini_plan(recommendation, language=language),
        plan_id=plan_id,
        topic=plan_topic,
        questions_by_id=questions_by_id,
        progress_rows=progress_rows,
        attempt_rows=attempt_rows,
        concept_rows=concept_rows,
        learn_rows=learn_rows,
        learning_event_rows=learning_event_rows,
    )
    decorated = {
        **recommendation,
        "plan_id": plan_id,
        "plan_context": {
            "language": language,
            "kind": recommendation.get("kind"),
            "source": recommendation.get("source"),
            "topic": plan_topic,
            "target": recommendation.get("target") or {},
            "reason": recommendation.get("reason"),
            "generated_at": _aware_now(learning_event_rows).isoformat(),
        },
        "explanation": _build_explanation(
            recommendation,
            advanced_blocked_topic=advanced_blocked_topic,
            cooldowns=cooldowns,
        ),
        "mini_plan": mini_plan,
        "cooldowns": cooldowns,
    }
    return decorated


def _progress_status(row: Any) -> str:
    if row and getattr(row, "status", None) == "solved":
        return "solved"
    if row and (getattr(row, "status", None) == "in_progress" or (getattr(row, "attempt_count", 0) or 0) > 0):
        return "in_progress"
    return "not_started"


def _question_sort_key(question: dict[str, Any]) -> tuple[int, str]:
    rank = {"easy": 0, "medium": 1, "hard": 2}
    return (rank.get(_norm(question.get("difficulty")), 1), str(question.get("title") or ""))


def _first_unsolved(
    questions: Iterable[dict[str, Any]],
    progress_by_question: dict[str, Any],
    *,
    topic: Optional[str] = None,
    difficulty: Optional[str] = None,
    beginner_only: bool = False,
) -> Optional[dict[str, Any]]:
    candidates = list(questions or [])
    if topic:
        candidates = [q for q in candidates if _norm(q.get("topic")) == _norm(topic)]
    if difficulty:
        candidates = [q for q in candidates if _norm(q.get("difficulty")) == _norm(difficulty)]
    if beginner_only:
        candidates = [q for q in candidates if _norm(q.get("topic")) in BEGINNER_TOPICS]
    for question in sorted(candidates, key=_question_sort_key):
        if _progress_status(progress_by_question.get(str(question.get("id")))) != "solved":
            return question
    return None


def _serialize_question(question: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not question:
        return None
    return {
        "id": question.get("id"),
        "title": question.get("title"),
        "topic": question.get("topic"),
        "difficulty": question.get("difficulty"),
    }


def _has_practice_signal(progress_rows: Iterable[Any], attempt_rows: Iterable[Any]) -> bool:
    return any(_progress_status(row) != "not_started" for row in progress_rows or []) or bool(list(attempt_rows or []))


def _has_quiz_signal(concept_rows: Iterable[Any]) -> bool:
    return any(getattr(row, "category", "") not in {"placement"} for row in concept_rows or [])


def _has_learn_signal(learn_rows: Iterable[Any]) -> bool:
    return any(getattr(row, "status", "") in {"opened", "completed"} for row in learn_rows or [])


def _starter_topic(questions: Iterable[dict[str, Any]]) -> str:
    authored = {_norm(question.get("topic")) for question in questions or []}
    return next((topic for topic in BEGINNER_TOPICS if topic in authored), BEGINNER_TOPICS[0])


def _latest_in_progress(progress_rows: Iterable[Any], questions_by_id: dict[str, dict[str, Any]]) -> Optional[tuple[Any, dict[str, Any]]]:
    matches = []
    for row in progress_rows or []:
        question = questions_by_id.get(str(getattr(row, "question_id", "")))
        if question and _progress_status(row) == "in_progress":
            matches.append((row, question))
    matches.sort(key=lambda item: getattr(item[0], "updated_at", None) or datetime.min, reverse=True)
    return matches[0] if matches else None


def _placement_target(starting_row: Any, language: str) -> dict[str, Any]:
    data = _parse_json(getattr(starting_row, "recommendation_json", None), {})
    action = _norm(data.get("action"))
    if action == "syntax-quiz":
        return _target("quiz", language=language, category="syntax")
    if action == "control-flow-quiz":
        return _target("quiz", language=language, category="conditionals")
    if action == "functions-quiz":
        return _target("quiz", language=language, category="functions")
    if action == "data-structures-quiz":
        return _target("quiz", language=language, category="lists")
    if action == "debugging-quiz":
        return _target("quiz", language=language, category="debug")
    if action == "code-ready":
        return _target("practice", topic="arrays", difficulty="easy")
    if action == "advanced-ready":
        return _target("practice", topic="arrays", difficulty="medium")
    return _target("learn", language=language, track="beginner")


def _starting_check_recommendation(starting_row: Any, language: str) -> Optional[dict[str, Any]]:
    if not starting_row or getattr(starting_row, "status", None) != "completed":
        return None
    data = _parse_json(getattr(starting_row, "recommendation_json", None), {})
    return _recommendation(
        kind="placement",
        title=data.get("title") or "Start from your check result",
        reason=data.get("blurb") or data.get("reason") or "Use your starting check to pick the next lesson or practice set.",
        action_label=data.get("actionLabel") or data.get("action_label") or "Open recommendation",
        target=_placement_target(starting_row, language),
        confidence="medium",
        source="starting_check",
        beginner_mode=False,
        evidence={"result_level": getattr(starting_row, "result_level", None), "completed_at": _iso(getattr(starting_row, "completed_at", None))},
    )


def _quiz_miss_signal(concept_rows: Iterable[Any]) -> Optional[dict[str, Any]]:
    latest_status: dict[tuple[str, str], tuple[bool, str]] = {}
    miss_counts: dict[str, int] = {}
    latest_by_category: dict[str, Any] = {}
    for row in sorted(concept_rows or [], key=lambda r: getattr(r, "created_at", None) or datetime.min):
        category = str(getattr(row, "category", "") or "")
        if category in {"placement", "mistake-bank"}:
            continue
        latest_by_category[category] = row
        for result in _parse_json(getattr(row, "results_json", None), []):
            qid = str(result.get("question_id") or "")
            if not qid:
                continue
            correct = bool(result.get("correct"))
            latest_status[(category, qid)] = (correct, getattr(row, "created_at", None).isoformat() if getattr(row, "created_at", None) else "")
            if not correct:
                miss_counts[category] = miss_counts.get(category, 0) + 1

    unresolved = [category for (category, _qid), (correct, _at) in latest_status.items() if not correct]
    candidates = [
        (category, miss_counts.get(category, 0), latest_by_category.get(category))
        for category in set(unresolved)
        if miss_counts.get(category, 0) >= QUIZ_MISS_THRESHOLD
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[1], getattr(item[2], "created_at", None) or datetime.min), reverse=True)
    category, count, row = candidates[0]
    return {
        "category": category,
        "count": count,
        "language": getattr(row, "language", None) or "python",
        "at": _iso(getattr(row, "created_at", None)),
    }


def _latest_completed_lesson(learn_rows: Iterable[Any]) -> Optional[Any]:
    rows = [row for row in learn_rows or [] if getattr(row, "status", None) == "completed"]
    rows.sort(key=lambda row: getattr(row, "completed_at", None) or datetime.min, reverse=True)
    return rows[0] if rows else None


def _latest_quiz_attempt(concept_rows: Iterable[Any]) -> Optional[dict[str, Any]]:
    rows = [
        row for row in concept_rows or []
        if getattr(row, "category", None) not in {"placement", "mistake-bank"}
    ]
    rows.sort(key=lambda row: getattr(row, "created_at", None) or datetime.min, reverse=True)
    for row in rows:
        results = _parse_json(getattr(row, "results_json", None), [])
        if not results:
            continue
        misses = sum(1 for result in results if not bool(result.get("correct")))
        return {
            "category": str(getattr(row, "category", "") or ""),
            "language": getattr(row, "language", None) or "python",
            "checked": len(results),
            "misses": misses,
            "at": _iso(getattr(row, "created_at", None)),
        }
    return None


def _latest_error_signal(attempt_rows: Iterable[Any]) -> Optional[dict[str, Any]]:
    rows = [
        row for row in attempt_rows or []
        if _norm(getattr(row, "error_class", None)) in adaptive_practice.ERROR_REVIEW_ROUTES
        and _norm(getattr(row, "outcome", None)) != "pass"
    ]
    rows.sort(key=lambda row: getattr(row, "created_at", None) or datetime.min)
    if not rows:
        return None
    latest = rows[-1]
    error_class = _norm(getattr(latest, "error_class", None))
    route = adaptive_practice.ERROR_REVIEW_ROUTES[error_class]
    return {
        "error_class": error_class,
        "topic": _norm(getattr(latest, "topic", None)),
        "difficulty": _norm(getattr(latest, "difficulty", None)),
        "question_id": getattr(latest, "question_id", None),
        "lesson_category": route["lesson_category"],
        "title": route["title"],
        "reason": route["reason"],
        "created_at": _iso(getattr(latest, "created_at", None)),
    }


def _advanced_allowed(topic: str, *, explicit_advanced: bool, evidence: Optional[dict[str, Any]] = None) -> bool:
    if _norm(topic) not in ADVANCED_TOPICS:
        return True
    if explicit_advanced:
        return True
    evidence = evidence or {}
    if evidence.get("scored") is not True:
        return False
    try:
        return int(evidence.get("attempts") or 0) >= mastery.MIN_ATTEMPTS_FOR_SCORE
    except (TypeError, ValueError):
        return False


def _can_resume_question(
    question: dict[str, Any],
    *,
    explicit_advanced: bool,
    surface: str,
    evidence: Optional[dict[str, Any]] = None,
) -> bool:
    topic = _norm(question.get("topic"))
    if topic not in ADVANCED_TOPICS:
        return True
    if surface == "workspace":
        return True
    return _advanced_allowed(topic, explicit_advanced=explicit_advanced, evidence=evidence)


def build_next_step(
    *,
    language: str,
    questions: list[dict[str, Any]],
    progress_rows: list[Any],
    attempt_rows: list[Any],
    concept_rows: list[Any],
    learn_rows: list[Any],
    starting_row: Any,
    workspace_state: Any,
    mastery_payload: dict[str, Any],
    adaptive_payload: dict[str, Any],
    explicit_advanced: bool = False,
    learning_style: str = "try_then_hint",
    surface: str = "home",
    learning_event_rows: Optional[list[Any]] = None,
) -> dict[str, Any]:
    learning_event_rows = learning_event_rows or []
    progress_by_question = {str(getattr(row, "question_id", "")): row for row in progress_rows or []}
    questions_by_id = {str(question.get("id")): question for question in questions or []}
    has_practice = _has_practice_signal(progress_rows, attempt_rows)
    has_quiz = _has_quiz_signal(concept_rows)
    has_learn = _has_learn_signal(learn_rows)
    has_starting = bool(starting_row and getattr(starting_row, "status", None) in {"completed", "skipped"})
    has_signal = has_practice or has_quiz or has_learn or has_starting
    active_cooldowns: list[dict[str, Any]] = []
    advanced_blocked_topic: Optional[str] = None

    def done(recommendation: dict[str, Any]) -> dict[str, Any]:
        return _decorate_recommendation(
            recommendation,
            language=language,
            questions_by_id=questions_by_id,
            progress_rows=progress_rows,
            attempt_rows=attempt_rows,
            concept_rows=concept_rows,
            learn_rows=learn_rows,
            learning_event_rows=learning_event_rows,
            has_signal=has_signal,
            advanced_blocked_topic=advanced_blocked_topic,
            extra_cooldowns=active_cooldowns,
        )

    def suppressed(recommendation: dict[str, Any]) -> bool:
        cooldown = _dismissal_cooldown(learning_event_rows, recommendation)
        if cooldown:
            duplicate = any(
                existing.get("type") == cooldown.get("type")
                and existing.get("kind") == cooldown.get("kind")
                and _norm(existing.get("topic")) == _norm(cooldown.get("topic"))
                for existing in active_cooldowns
            )
            if not duplicate:
                active_cooldowns.append(cooldown)
            return True
        return False

    if workspace_state and getattr(workspace_state, "source", None) == "practice":
        question = questions_by_id.get(str(getattr(workspace_state, "problem_id", "")))
        progress = progress_by_question.get(str(getattr(workspace_state, "problem_id", "")))
        resume_evidence = {
            "attempts": getattr(progress, "attempt_count", 0) if progress else 0,
            "updated_at": _iso(getattr(workspace_state, "updated_at", None)),
        }
        if question and _progress_status(progress) != "solved" and _can_resume_question(question, explicit_advanced=explicit_advanced, surface=surface, evidence=resume_evidence):
            rec = _recommendation(
                kind="resume",
                title=question.get("title") or "Continue your problem",
                reason="You already started this problem. Continue from your saved code and run the tests.",
                action_label=f"Resume {question.get('title') or 'problem'}",
                target=_target("workspace", question_id=question.get("id")),
                confidence="high",
                source="workspace_state",
                beginner_mode=False,
                evidence={"question_id": question.get("id"), **resume_evidence},
                topic=_norm(question.get("topic")),
                question=_serialize_question(question),
            )
            if not suppressed(rec) or surface == "workspace":
                return done(rec)

    in_progress = _latest_in_progress(progress_rows, questions_by_id)
    if in_progress:
        row, question = in_progress
        evidence = {"attempts": getattr(row, "attempt_count", 0), "updated_at": _iso(getattr(row, "updated_at", None))}
        if _can_resume_question(question, explicit_advanced=explicit_advanced, surface=surface, evidence=evidence):
            rec = _recommendation(
                kind="resume",
                title=question.get("title") or "Continue your problem",
                reason="You already started this problem. Continue from your saved code and run the tests.",
                action_label=f"Resume {question.get('title') or 'problem'}",
                target=_target("workspace", question_id=question.get("id")),
                confidence="high",
                source="practice_progress",
                beginner_mode=False,
                evidence=evidence,
                topic=_norm(question.get("topic")),
                question=_serialize_question(question),
            )
            if not suppressed(rec) or surface == "workspace":
                return done(rec)

    if not has_signal:
        starter = _first_unsolved(questions, progress_by_question, beginner_only=True, difficulty="easy")
        topic = _norm((starter or {}).get("topic")) or _starter_topic(questions)
        rec = _recommendation(
            kind="first_run",
            title="Start with Python Beginner",
            reason="Start with a short lesson, then try a few simple questions before coding.",
            action_label="Start Python Beginner",
            target=_target("learn", language="python", track="beginner", topic=topic, question_id=(starter or {}).get("id")),
            confidence="high",
            source="first_run",
            beginner_mode=True,
            evidence={"durable_signal": False},
            topic=topic,
            question=_serialize_question(starter),
        )
        return done(rec)

    placement = None if has_practice else _starting_check_recommendation(starting_row, language)
    if placement:
        return done(placement)

    review_signal = (adaptive_payload or {}).get("review_signal")
    if review_signal:
        topic = _norm(review_signal.get("topic"))
        rec = _recommendation(
            kind="review",
            title=review_signal.get("title") or f"Review {_title(topic)}",
            reason=review_signal.get("reason") or "Recent runs show a repeated error pattern.",
            action_label="Open review lesson",
            target=_target("lesson_review", topic=topic, category=review_signal.get("lesson_category")),
            confidence="high",
            source="attempt_errors",
            beginner_mode=False,
            evidence={
                "error_class": review_signal.get("error_class"),
                "count": review_signal.get("count"),
                "threshold": adaptive_practice.ERROR_REVIEW_MIN_COUNT,
            },
            topic=topic,
            review_signal=review_signal,
        )
        if not suppressed(rec):
            return done(rec)

    latest_error = _latest_error_signal(attempt_rows)
    if latest_error:
        category = latest_error["lesson_category"]
        rec = _recommendation(
            kind="error_checkpoint",
            title=latest_error["title"],
            reason=latest_error["reason"],
            action_label="Review the error pattern",
            target=_target("lesson_review", topic=latest_error.get("topic"), category=category),
            confidence="low",
            source="latest_error",
            beginner_mode=False,
            evidence={
                "error_class": latest_error["error_class"],
                "count": 1,
                "threshold": adaptive_practice.ERROR_REVIEW_MIN_COUNT,
                "question_id": latest_error.get("question_id"),
                "at": latest_error.get("created_at"),
            },
            topic=latest_error.get("topic") or category,
            review_signal=latest_error,
        )
        if not suppressed(rec):
            return done(rec)

    quiz_signal = _quiz_miss_signal(concept_rows)
    if quiz_signal:
        category = quiz_signal["category"]
        rec = _recommendation(
            kind="quiz_review",
            title=f"Review {_title(category)}",
            reason=f"You missed {quiz_signal['count']} recent {category.replace('-', ' ')} question checks.",
            action_label="Review missed questions",
            target=_target("quiz", language=quiz_signal["language"], category=category),
            confidence="medium",
            source="concept_quiz",
            beginner_mode=False,
            evidence={"misses": quiz_signal["count"], "threshold": QUIZ_MISS_THRESHOLD, "at": quiz_signal.get("at")},
            topic=category,
        )
        if not suppressed(rec):
            return done(rec)

    latest_quiz = _latest_quiz_attempt(concept_rows)
    if latest_quiz:
        category = _norm(latest_quiz["category"])
        practice = _first_unsolved(questions, progress_by_question, topic=category, difficulty="easy")
        if _advanced_allowed(category, explicit_advanced=explicit_advanced, evidence={}):
            missed = int(latest_quiz.get("misses") or 0)
            reason = (
                f"You checked {_title(category)} and missed {missed}. Try one Easy practice problem on the same topic."
                if missed
                else f"You finished a {_title(category)} check. Try one Easy practice problem on the same topic."
            )
            rec = _recommendation(
                kind="quiz_to_practice",
                title=(practice or {}).get("title") or f"Practice {_title(category)}",
                reason=reason,
                action_label=f"Start {(practice or {}).get('title') or _title(category)}",
                target=_target("practice", topic=category, difficulty="easy", question_id=(practice or {}).get("id")),
                confidence="medium",
                source="concept_quiz_completion",
                beginner_mode=False,
                evidence={
                    "checked": latest_quiz.get("checked"),
                    "misses": missed,
                    "completed_at": latest_quiz.get("at"),
                },
                topic=category,
                question=_serialize_question(practice),
            )
            if not suppressed(rec):
                return done(rec)

    adaptive = (adaptive_payload or {}).get("recommendation") or {}
    adaptive_topic = _norm(adaptive.get("topic"))
    weakest = (mastery_payload or {}).get("weakest") or {}
    weakest_topic = _norm(weakest.get("topic"))
    adaptive_evidence = weakest if weakest_topic == adaptive_topic else {}
    if adaptive_topic and _advanced_allowed(adaptive_topic, explicit_advanced=explicit_advanced, evidence=adaptive_evidence):
        difficulty = _norm(adaptive.get("difficulty") or "easy")
        rec = _recommendation(
            kind="practice_ladder" if adaptive.get("action") == "ladder" else "practice_review",
            title=_title(adaptive_topic),
            reason=adaptive.get("reason") or f"Practice {_title(adaptive_topic)} next.",
            action_label=f"Open {_title(difficulty)} problem" if adaptive.get("action") == "ladder" else f"Practice {_title(adaptive_topic)}",
            target=_target("practice", topic=adaptive_topic, difficulty=(difficulty if adaptive.get("action") == "ladder" else None), question_id=adaptive.get("question_id")),
            confidence="high" if adaptive.get("ladder_ready") else "medium",
            source="adaptive_practice",
            beginner_mode=False,
            evidence={
                "ladder_ready": bool(adaptive.get("ladder_ready")),
                "question_id": adaptive.get("question_id"),
                "difficulty": difficulty,
            },
            topic=adaptive_topic,
        )
        if not suppressed(rec):
            return done(rec)
    elif adaptive_topic in ADVANCED_TOPICS:
        advanced_blocked_topic = adaptive_topic

    if weakest_topic and _advanced_allowed(weakest_topic, explicit_advanced=explicit_advanced, evidence=weakest):
        rec = _recommendation(
            kind="mastery_review",
            title=_title(weakest_topic),
            reason=weakest.get("reason") or f"Practice {_title(weakest_topic)} next.",
            action_label=f"Practice {_title(weakest_topic)}",
            target=_target("practice", topic=weakest_topic),
            confidence="medium",
            source="mastery",
            beginner_mode=False,
            evidence={"attempts": weakest.get("attempts"), "score": weakest.get("score"), "min_attempts": mastery.MIN_ATTEMPTS_FOR_SCORE},
            topic=weakest_topic,
        )
        if not suppressed(rec):
            return done(rec)
    elif weakest_topic in ADVANCED_TOPICS:
        advanced_blocked_topic = advanced_blocked_topic or weakest_topic

    latest_lesson = _latest_completed_lesson(learn_rows)
    if latest_lesson:
        category = getattr(latest_lesson, "category", "")
        rec = _recommendation(
            kind="lesson_to_quiz",
            title=f"Check {_title(category)}",
            reason="You finished this lesson. Answer a few questions on the same topic while it is fresh.",
            action_label="Open concept check",
            target=_target("quiz", language=getattr(latest_lesson, "language", language), category=category),
            confidence="medium",
            source="learn_progress",
            beginner_mode=False,
            evidence={"completed_at": _iso(getattr(latest_lesson, "completed_at", None))},
            topic=category,
        )
        return done(rec)

    active_plan = _latest_active_plan_topic(learning_event_rows)
    if active_plan:
        topic = active_plan["topic"]
        starter_question = _first_unsolved(questions, progress_by_question, topic=topic, difficulty="easy")
        rec = _recommendation(
            kind="active_plan",
            title=(starter_question or {}).get("title") or f"Continue {_display_topic(topic)}",
            reason=f"Continue the {_display_topic(topic)} plan you started.",
            action_label=(f"Start {(starter_question or {}).get('title')}" if starter_question else f"Continue {_display_topic(topic)}"),
            target=_target("practice", topic=topic, difficulty="easy", question_id=(starter_question or {}).get("id")),
            confidence="medium",
            source="mini_plan",
            beginner_mode=False,
            evidence={"event_type": active_plan.get("event_type"), "at": active_plan.get("at")},
            topic=topic,
            question=_serialize_question(starter_question),
        )
        if not suppressed(rec):
            return done(rec)

    starter = _first_unsolved(questions, progress_by_question, beginner_only=True, difficulty="easy")
    topic = _norm((starter or {}).get("topic")) or _starter_topic(questions)
    lesson_first = learning_style != "try_then_hint"
    rec = _recommendation(
        kind="starter",
        title=f"Review {_title(topic)}" if lesson_first else ((starter or {}).get("title") or f"Practice {_title(topic)}"),
        reason=f"Read a short {_title(topic)} lesson, then answer the matching questions." if lesson_first else f"Try one Easy {_title(topic)} problem.",
        action_label="Open lesson" if lesson_first else "Open practice",
        target=_target("learn_topic", language=language, topic=topic) if lesson_first else _target("practice", topic=topic, difficulty="easy", question_id=(starter or {}).get("id")),
        confidence="low",
        source="beginner_fallback",
        beginner_mode=False,
        evidence={"fallback": True},
        topic=topic,
        question=_serialize_question(starter),
    )
    return done(rec)
