"""Canonical next-step recommendations for Coding Tutor.

This service is intentionally deterministic. It combines the durable progress
logs we already keep and returns one action the frontend can render anywhere.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
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


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _title(value: Any) -> str:
    return " ".join(word.capitalize() for word in _norm(value).split())


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
    return sorted(candidates, key=_question_sort_key)[0] if candidates else None


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


def _advanced_allowed(topic: str, *, explicit_advanced: bool, evidence: Optional[dict[str, Any]] = None) -> bool:
    if _norm(topic) not in ADVANCED_TOPICS:
        return True
    if explicit_advanced:
        return True
    evidence = evidence or {}
    if evidence.get("scored") is True:
        return True
    try:
        return int(evidence.get("attempts") or 0) >= mastery.MIN_ATTEMPTS_FOR_SCORE
    except (TypeError, ValueError):
        return False


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
) -> dict[str, Any]:
    progress_by_question = {str(getattr(row, "question_id", "")): row for row in progress_rows or []}
    questions_by_id = {str(question.get("id")): question for question in questions or []}
    has_practice = _has_practice_signal(progress_rows, attempt_rows)
    has_quiz = _has_quiz_signal(concept_rows)
    has_learn = _has_learn_signal(learn_rows)
    has_starting = bool(starting_row and getattr(starting_row, "status", None) in {"completed", "skipped"})
    has_signal = has_practice or has_quiz or has_learn or has_starting

    if workspace_state and getattr(workspace_state, "source", None) == "practice":
        question = questions_by_id.get(str(getattr(workspace_state, "problem_id", "")))
        progress = progress_by_question.get(str(getattr(workspace_state, "problem_id", "")))
        if question and _progress_status(progress) != "solved":
            return _recommendation(
                kind="resume",
                title=question.get("title") or "Continue your problem",
                reason="You already started this problem. Continue from your saved code and run the tests.",
                action_label=f"Resume {question.get('title') or 'problem'}",
                target=_target("workspace", question_id=question.get("id")),
                confidence="high",
                source="workspace_state",
                beginner_mode=False,
                evidence={"question_id": question.get("id"), "updated_at": _iso(getattr(workspace_state, "updated_at", None))},
                topic=_norm(question.get("topic")),
                question=_serialize_question(question),
            )

    in_progress = _latest_in_progress(progress_rows, questions_by_id)
    if in_progress:
        row, question = in_progress
        return _recommendation(
            kind="resume",
            title=question.get("title") or "Continue your problem",
            reason="You already started this problem. Continue from your saved code and run the tests.",
            action_label=f"Resume {question.get('title') or 'problem'}",
            target=_target("workspace", question_id=question.get("id")),
            confidence="high",
            source="practice_progress",
            beginner_mode=False,
            evidence={"attempt_count": getattr(row, "attempt_count", 0), "updated_at": _iso(getattr(row, "updated_at", None))},
            topic=_norm(question.get("topic")),
            question=_serialize_question(question),
        )

    if not has_signal:
        topic = _starter_topic(questions)
        starter = _first_unsolved(questions, progress_by_question, topic=topic, difficulty="easy")
        return _recommendation(
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

    placement = None if has_practice else _starting_check_recommendation(starting_row, language)
    if placement:
        return placement

    review_signal = (adaptive_payload or {}).get("review_signal")
    if review_signal:
        topic = _norm(review_signal.get("topic"))
        return _recommendation(
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

    quiz_signal = _quiz_miss_signal(concept_rows)
    if quiz_signal:
        category = quiz_signal["category"]
        return _recommendation(
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

    adaptive = (adaptive_payload or {}).get("recommendation") or {}
    adaptive_topic = _norm(adaptive.get("topic"))
    weakest = (mastery_payload or {}).get("weakest") or {}
    weakest_topic = _norm(weakest.get("topic"))
    adaptive_evidence = weakest if weakest_topic == adaptive_topic else {}
    if adaptive_topic and _advanced_allowed(adaptive_topic, explicit_advanced=explicit_advanced, evidence=adaptive_evidence):
        difficulty = _norm(adaptive.get("difficulty") or "easy")
        return _recommendation(
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

    if weakest_topic and _advanced_allowed(weakest_topic, explicit_advanced=explicit_advanced, evidence=weakest):
        return _recommendation(
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

    latest_lesson = _latest_completed_lesson(learn_rows)
    if latest_lesson:
        category = getattr(latest_lesson, "category", "")
        return _recommendation(
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

    topic = _starter_topic(questions)
    starter = _first_unsolved(questions, progress_by_question, beginner_only=True, difficulty="easy")
    lesson_first = learning_style != "try_then_hint"
    return _recommendation(
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
