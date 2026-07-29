"""Adaptive practice scaffolding for the Coding Tutor.

This module is deliberately conservative. It does not claim every topic is ready for
adaptive difficulty. It first checks whether a topic has enough authored, deterministic
practice depth across all supported languages, then recommends either a true ladder step
or a normal review/practice step.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Iterable, Optional


DIFFICULTIES = ("easy", "medium", "hard")
LANGUAGES = ("python", "javascript", "java", "cpp")
READINESS_THRESHOLDS = {"easy": 2, "medium": 2, "hard": 1}
LOW_HINT_MAX = 0
LOW_ATTEMPTS_TO_SOLVE_MAX = 2
FAILURE_DROP_COUNT = 2


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _title(value: str) -> str:
    return " ".join(word.capitalize() for word in _norm(value).split())


def _test_map(answer_items_by_language: dict[str, Iterable[dict[str, Any]]]) -> dict[str, set[str]]:
    tested: dict[str, set[str]] = defaultdict(set)
    for language, items in answer_items_by_language.items():
        lang = _norm(language)
        for item in items or []:
            qid = str(item.get("question_id") or "").strip()
            if qid and item.get("runner_tests"):
                tested[qid].add(lang)
    return tested


def build_topic_readiness(
    questions: Iterable[dict[str, Any]],
    answer_items_by_language: dict[str, Iterable[dict[str, Any]]],
    *,
    thresholds: Optional[dict[str, int]] = None,
    languages: tuple[str, ...] = LANGUAGES,
) -> list[dict[str, Any]]:
    """Return readiness metadata per topic.

    A problem counts toward ladder depth only when it has deterministic runner tests in
    every supported language. Thin or partially tested topics can still be recommended
    for practice, but they are not marked ladder-ready.
    """
    thresholds = thresholds or READINESS_THRESHOLDS
    tested = _test_map(answer_items_by_language)
    topics: dict[str, dict[str, Any]] = {}

    for question in questions or []:
        topic = _norm(question.get("topic"))
        difficulty = _norm(question.get("difficulty"))
        qid = str(question.get("id") or "").strip()
        if not topic or difficulty not in DIFFICULTIES or not qid:
            continue

        bucket = topics.setdefault(topic, {
            "topic": topic,
            "title": _title(topic),
            "counts": {difficulty_name: 0 for difficulty_name in DIFFICULTIES},
            "tested_counts": {difficulty_name: 0 for difficulty_name in DIFFICULTIES},
            "total": 0,
            "tested_total": 0,
            "missing_tests": [],
            "ladder_ready": False,
            "blocked_reasons": [],
        })
        bucket["counts"][difficulty] += 1
        bucket["total"] += 1

        missing = [language for language in languages if language not in tested.get(qid, set())]
        if missing:
            bucket["missing_tests"].append({
                "question_id": qid,
                "difficulty": difficulty,
                "missing_languages": missing,
            })
        else:
            bucket["tested_counts"][difficulty] += 1
            bucket["tested_total"] += 1

    for bucket in topics.values():
        reasons = []
        for difficulty, needed in thresholds.items():
            have = bucket["tested_counts"].get(difficulty, 0)
            if have < needed:
                reasons.append(f"Needs {needed - have} more tested {difficulty} problem{'s' if needed - have != 1 else ''}.")
        if bucket["missing_tests"]:
            reasons.append("Some problems do not have deterministic tests in every supported language.")
        bucket["ladder_ready"] = not reasons
        bucket["blocked_reasons"] = reasons

    return sorted(topics.values(), key=lambda item: item["topic"])


def readiness_by_topic(readiness: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {_norm(item.get("topic")): item for item in readiness or []}


def _parse_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    text = str(value or "")
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return datetime.min


def _status(progress: Optional[dict[str, Any]]) -> str:
    if progress and progress.get("status") == "solved":
        return "solved"
    if progress and (progress.get("status") == "in_progress" or (progress.get("attempt_count") or 0) > 0):
        return "in_progress"
    return "not_started"


def _question_sort_key(question: dict[str, Any]) -> tuple[int, str]:
    return (DIFFICULTIES.index(_norm(question.get("difficulty"))), str(question.get("title") or ""))


def _questions_for_topic(questions: Iterable[dict[str, Any]], topic: str) -> list[dict[str, Any]]:
    wanted = _norm(topic)
    return sorted(
        [question for question in questions or [] if _norm(question.get("topic")) == wanted],
        key=_question_sort_key,
    )


def _first_unsolved(
    questions: Iterable[dict[str, Any]],
    progress_by_question: dict[str, dict[str, Any]],
    *,
    topic: Optional[str] = None,
    difficulty: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    candidates = list(questions or [])
    if topic:
        candidates = [q for q in candidates if _norm(q.get("topic")) == _norm(topic)]
    if difficulty:
        candidates = [q for q in candidates if _norm(q.get("difficulty")) == _norm(difficulty)]
    for question in sorted(candidates, key=_question_sort_key):
        if _status(progress_by_question.get(str(question.get("id")))) != "solved":
            return question
    return sorted(candidates, key=_question_sort_key)[0] if candidates else None


def _events_for_topic(events: Iterable[dict[str, Any]], topic: str, language: str) -> list[dict[str, Any]]:
    wanted_topic = _norm(topic)
    wanted_language = _norm(language)
    return sorted(
        [
            event for event in events or []
            if _norm(event.get("topic")) == wanted_topic
            and (not wanted_language or _norm(event.get("language")) == wanted_language)
        ],
        key=lambda event: _parse_dt(event.get("created_at")),
    )


def _low_hint_solves(events: list[dict[str, Any]]) -> dict[str, set[str]]:
    attempts_by_question: dict[str, int] = defaultdict(int)
    solved: dict[str, set[str]] = {difficulty: set() for difficulty in DIFFICULTIES}
    for event in events:
        qid = str(event.get("question_id") or "")
        difficulty = _norm(event.get("difficulty"))
        if not qid or difficulty not in DIFFICULTIES:
            continue
        attempts_by_question[qid] += 1
        if event.get("outcome") == "pass" and qid not in solved[difficulty]:
            if (
                attempts_by_question[qid] <= LOW_ATTEMPTS_TO_SOLVE_MAX
                and int(event.get("hints_used") or 0) <= LOW_HINT_MAX
            ):
                solved[difficulty].add(qid)
    return solved


def _recent_failure_count(events: list[dict[str, Any]], difficulty: str) -> int:
    recent = [event for event in events if _norm(event.get("difficulty")) == difficulty][-FAILURE_DROP_COUNT:]
    if len(recent) < FAILURE_DROP_COUNT:
        return 0
    return sum(1 for event in recent if event.get("outcome") != "pass")


def choose_ladder_difficulty(events: Iterable[dict[str, Any]]) -> tuple[str, str]:
    topic_events = list(events or [])
    low_hint = _low_hint_solves(topic_events)

    if _recent_failure_count(topic_events, "hard") >= FAILURE_DROP_COUNT:
        return "medium", "Recent hard attempts are not passing yet, so the ladder steps back to medium."
    if _recent_failure_count(topic_events, "medium") >= FAILURE_DROP_COUNT:
        return "easy", "Recent medium attempts are not passing yet, so the ladder steps back to easy."
    if len(low_hint["medium"]) >= 1:
        return "hard", "A low-hint medium solve is enough to try the hard step."
    if len(low_hint["easy"]) >= 1:
        return "medium", "A low-hint easy solve is enough to try the medium step."
    return "easy", "Start with the easy step and move up after a low-hint solve."


def build_adaptive_recommendation(
    *,
    questions: Iterable[dict[str, Any]],
    readiness: Iterable[dict[str, Any]],
    progress_items: Iterable[dict[str, Any]],
    attempt_events: Iterable[dict[str, Any]],
    mastery_payload: Optional[dict[str, Any]],
    language: str,
) -> dict[str, Any]:
    progress_by_question = {str(item.get("question_id")): item for item in progress_items or []}
    readiness_map = readiness_by_topic(readiness)
    weakest = (mastery_payload or {}).get("weakest")
    topic = _norm((weakest or {}).get("topic"))

    if not topic:
        starter = _first_unsolved(questions, progress_by_question, difficulty="easy")
        starter_topic = _norm(starter.get("topic")) if starter else ""
        return {
            "action": "on_ramp",
            "topic": starter_topic,
            "difficulty": "easy",
            "question_id": starter.get("id") if starter else None,
            "question_title": starter.get("title") if starter else None,
            "ladder_ready": bool(readiness_map.get(starter_topic, {}).get("ladder_ready")),
            "readiness": readiness_map.get(starter_topic),
            "reason": "No scored mastery pattern yet, so start with a gentle easy problem.",
        }

    topic_readiness = readiness_map.get(topic)
    topic_questions = _questions_for_topic(questions, topic)
    if not topic_readiness or not topic_readiness.get("ladder_ready"):
        pick = _first_unsolved(topic_questions, progress_by_question) or _first_unsolved(questions, progress_by_question, difficulty="easy")
        reason = (weakest or {}).get("reason") or f"{_title(topic)} is the next useful review topic."
        if topic_readiness and topic_readiness.get("blocked_reasons"):
            reason = f"{reason} This topic is review-only for now: {topic_readiness['blocked_reasons'][0]}"
        return {
            "action": "practice_review",
            "topic": topic,
            "difficulty": _norm(pick.get("difficulty")) if pick else "easy",
            "question_id": pick.get("id") if pick else None,
            "question_title": pick.get("title") if pick else None,
            "ladder_ready": False,
            "readiness": topic_readiness,
            "reason": reason,
        }

    topic_events = _events_for_topic(attempt_events, topic, language)
    target_difficulty, ladder_reason = choose_ladder_difficulty(topic_events)
    pick = (
        _first_unsolved(topic_questions, progress_by_question, difficulty=target_difficulty)
        or _first_unsolved(topic_questions, progress_by_question)
    )
    return {
        "action": "ladder",
        "topic": topic,
        "difficulty": target_difficulty,
        "question_id": pick.get("id") if pick else None,
        "question_title": pick.get("title") if pick else None,
        "ladder_ready": True,
        "readiness": topic_readiness,
        "reason": f"{(weakest or {}).get('reason') or _title(topic)} {ladder_reason}",
    }
