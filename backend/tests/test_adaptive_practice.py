from services import adaptive_practice


def _questions():
    return [
        {"id": "easy-a", "title": "Easy A", "topic": "arrays", "difficulty": "easy"},
        {"id": "easy-b", "title": "Easy B", "topic": "arrays", "difficulty": "easy"},
        {"id": "medium-a", "title": "Medium A", "topic": "arrays", "difficulty": "medium"},
        {"id": "medium-b", "title": "Medium B", "topic": "arrays", "difficulty": "medium"},
        {"id": "hard-a", "title": "Hard A", "topic": "arrays", "difficulty": "hard"},
        {"id": "thin-easy", "title": "Thin Easy", "topic": "heaps", "difficulty": "easy"},
    ]


def _answers(question_ids):
    return {
        language: [
            {"question_id": question_id, "function_name": "solve", "runner_tests": [{"name": "case", "args": [], "expected": 1}]}
            for question_id in question_ids
        ]
        for language in adaptive_practice.LANGUAGES
    }


def test_readiness_requires_depth_and_all_language_tests():
    readiness = adaptive_practice.build_topic_readiness(_questions(), _answers(["easy-a", "easy-b", "medium-a", "medium-b", "hard-a"]))
    by_topic = adaptive_practice.readiness_by_topic(readiness)

    assert by_topic["arrays"]["ladder_ready"] is True
    assert by_topic["arrays"]["tested_counts"] == {"easy": 2, "medium": 2, "hard": 1}
    assert by_topic["heaps"]["ladder_ready"] is False
    assert by_topic["heaps"]["blocked_reasons"]


def test_recommendation_blocks_thin_topic_from_ladder():
    readiness = adaptive_practice.build_topic_readiness(_questions(), _answers(["easy-a", "easy-b", "medium-a", "medium-b", "hard-a"]))
    recommendation = adaptive_practice.build_adaptive_recommendation(
        questions=_questions(),
        readiness=readiness,
        progress_items=[],
        attempt_events=[],
        mastery_payload={"weakest": {"topic": "heaps", "reason": "Heaps need another pass."}},
        language="python",
    )

    assert recommendation["action"] == "practice_review"
    assert recommendation["ladder_ready"] is False
    assert "review-only" in recommendation["reason"]


def test_recommendation_without_scored_signal_prefers_beginner_starter_topic():
    questions = [
        {"id": "window-a", "title": "Window A", "topic": "sliding window", "difficulty": "easy"},
        {"id": "cond-a", "title": "Condition A", "topic": "conditionals", "difficulty": "easy"},
        {"id": "array-a", "title": "Array A", "topic": "arrays", "difficulty": "easy"},
    ]
    readiness = adaptive_practice.build_topic_readiness(questions, _answers(["window-a", "cond-a", "array-a"]))
    recommendation = adaptive_practice.build_adaptive_recommendation(
        questions=questions,
        readiness=readiness,
        progress_items=[{"question_id": "cond-a", "status": "in_progress", "attempt_count": 0}],
        attempt_events=[],
        mastery_payload={"weakest": None},
        language="python",
    )

    assert recommendation["action"] == "on_ramp"
    assert recommendation["topic"] == "conditionals"
    assert recommendation["question_id"] == "cond-a"


def test_ladder_moves_up_after_low_hint_easy_solve():
    questions = _questions()
    readiness = adaptive_practice.build_topic_readiness(questions, _answers(["easy-a", "easy-b", "medium-a", "medium-b", "hard-a"]))
    recommendation = adaptive_practice.build_adaptive_recommendation(
        questions=questions,
        readiness=readiness,
        progress_items=[{"question_id": "easy-a", "status": "solved", "attempt_count": 1}],
        attempt_events=[
            {
                "question_id": "easy-a",
                "topic": "arrays",
                "difficulty": "easy",
                "language": "python",
                "outcome": "pass",
                "hints_used": 0,
                "created_at": "2026-07-01T00:00:00",
            }
        ],
        mastery_payload={"weakest": {"topic": "arrays", "reason": "Arrays are the focus."}},
        language="python",
    )

    assert recommendation["action"] == "ladder"
    assert recommendation["difficulty"] == "medium"
    assert recommendation["question_id"] == "medium-a"


def test_ladder_drops_after_repeated_medium_failures():
    questions = _questions()
    readiness = adaptive_practice.build_topic_readiness(questions, _answers(["easy-a", "easy-b", "medium-a", "medium-b", "hard-a"]))
    recommendation = adaptive_practice.build_adaptive_recommendation(
        questions=questions,
        readiness=readiness,
        progress_items=[],
        attempt_events=[
            {
                "question_id": "medium-a",
                "topic": "arrays",
                "difficulty": "medium",
                "language": "python",
                "outcome": "fail",
                "hints_used": 0,
                "created_at": "2026-07-01T00:00:00",
            },
            {
                "question_id": "medium-b",
                "topic": "arrays",
                "difficulty": "medium",
                "language": "python",
                "outcome": "error",
                "hints_used": 1,
                "created_at": "2026-07-02T00:00:00",
            },
        ],
        mastery_payload={"weakest": {"topic": "arrays", "reason": "Arrays are the focus."}},
        language="python",
    )

    assert recommendation["action"] == "ladder"
    assert recommendation["difficulty"] == "easy"
    assert "steps back to easy" in recommendation["reason"]


def test_error_review_signal_routes_repeated_syntax_errors_to_syntax_lesson():
    signal = adaptive_practice.build_error_review_signal(
        attempt_events=[
            {
                "question_id": "easy-a",
                "topic": "arrays",
                "difficulty": "easy",
                "language": "python",
                "outcome": "error",
                "error_class": "syntax",
                "created_at": "2026-07-01T00:00:00",
            },
            {
                "question_id": "easy-b",
                "topic": "arrays",
                "difficulty": "easy",
                "language": "python",
                "outcome": "error",
                "error_class": "syntax",
                "created_at": "2026-07-02T00:00:00",
            },
        ],
        language="python",
    )

    assert signal["action"] == "lesson_review"
    assert signal["error_class"] == "syntax"
    assert signal["lesson_category"] == "syntax"
    assert signal["topic"] == "arrays"


def test_error_review_signal_uses_recent_dominant_failure_class():
    signal = adaptive_practice.build_error_review_signal(
        attempt_events=[
            {
                "question_id": "medium-a",
                "topic": "arrays",
                "difficulty": "medium",
                "language": "python",
                "outcome": "fail",
                "error_class": "wrong_answer",
                "created_at": "2026-07-01T00:00:00",
            },
            {
                "question_id": "medium-b",
                "topic": "strings",
                "difficulty": "medium",
                "language": "python",
                "outcome": "fail",
                "error_class": "runtime",
                "created_at": "2026-07-02T00:00:00",
            },
            {
                "question_id": "medium-b",
                "topic": "strings",
                "difficulty": "medium",
                "language": "python",
                "outcome": "fail",
                "error_class": "runtime",
                "created_at": "2026-07-03T00:00:00",
            },
        ],
        language="python",
    )

    assert signal["error_class"] == "runtime"
    assert signal["lesson_category"] == "debug"
    assert signal["topic"] == "strings"


def test_error_review_signal_stays_quiet_without_repeated_pattern():
    signal = adaptive_practice.build_error_review_signal(
        attempt_events=[
            {
                "question_id": "easy-a",
                "topic": "arrays",
                "difficulty": "easy",
                "language": "python",
                "outcome": "error",
                "error_class": "syntax",
                "created_at": "2026-07-01T00:00:00",
            },
            {
                "question_id": "easy-b",
                "topic": "arrays",
                "difficulty": "easy",
                "language": "javascript",
                "outcome": "error",
                "error_class": "syntax",
                "created_at": "2026-07-02T00:00:00",
            },
        ],
        language="python",
    )

    assert signal is None
