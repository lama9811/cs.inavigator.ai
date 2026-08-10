import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from models import Base, CodingLearnProgress, CodingLearningEvent, CodingStartingCheckProgress, User
from services import adaptive_next_step, mastery


def _questions():
    return [
        {"id": "cond-easy", "title": "Can Vote", "topic": "conditionals", "difficulty": "easy"},
        {"id": "arr-easy", "title": "Find Index", "topic": "arrays", "difficulty": "easy"},
        {"id": "dp-hard", "title": "Decode Ways", "topic": "dynamic programming", "difficulty": "hard"},
    ]


def _recommend(**overrides):
    defaults = {
        "language": "python",
        "questions": _questions(),
        "progress_rows": [],
        "attempt_rows": [],
        "concept_rows": [],
        "learn_rows": [],
        "starting_row": None,
        "workspace_state": None,
        "mastery_payload": {"weakest": None},
        "adaptive_payload": {"recommendation": {}, "review_signal": None},
        "explicit_advanced": False,
        "learning_style": "try_then_hint",
        "surface": "home",
    }
    defaults.update(overrides)
    return adaptive_next_step.build_next_step(**defaults)


def _row(**values):
    return SimpleNamespace(**values)


def test_progress_models_are_unique_per_user_language_and_category():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    user = User(email="adaptive@example.com", password_hash="x")
    db.add(user)
    db.commit()

    db.add(CodingLearnProgress(user_id=user.id, language="python", category="loops", status="completed"))
    db.commit()
    db.add(CodingLearnProgress(user_id=user.id, language="python", category="loops", status="opened"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    db.add(CodingStartingCheckProgress(user_id=user.id, language="python", status="completed"))
    db.commit()
    db.add(CodingStartingCheckProgress(user_id=user.id, language="python", status="skipped"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    db.add(CodingLearningEvent(user_id=user.id, event_type="lesson_opened", language="python", category="syntax"))
    db.add(CodingLearningEvent(user_id=user.id, event_type="lesson_opened", language="python", category="syntax"))
    db.commit()
    assert db.query(CodingLearningEvent).count() == 2


def test_brand_new_user_gets_beginner_safe_first_run_recommendation():
    rec = _recommend()

    assert rec["kind"] == "first_run"
    assert rec["beginner_mode"] is True
    assert rec["target"]["mode"] == "learn"
    assert rec["topic"] == "conditionals"
    assert rec["explanation"]["evidence_used"]
    assert len(rec["mini_plan"]) >= 3


def test_starting_check_result_guides_when_no_practice_signal_exists():
    row = _row(
        status="completed",
        result_level="control-flow",
        recommendation_json=json.dumps({
            "title": "Start with conditionals",
            "blurb": "Use your check result to start with branching.",
            "action": "control-flow-quiz",
            "actionLabel": "Open conditionals",
        }),
        completed_at=datetime.utcnow(),
    )
    rec = _recommend(starting_row=row)

    assert rec["kind"] == "placement"
    assert rec["source"] == "starting_check"
    assert rec["target"] == {"mode": "quiz", "language": "python", "category": "conditionals"}


def test_repeated_error_signal_wins_after_threshold():
    rec = _recommend(
        attempt_rows=[_row()],
        adaptive_payload={
            "recommendation": {},
            "review_signal": {
                "title": "Review Syntax",
                "topic": "arrays",
                "lesson_category": "syntax",
                "error_class": "syntax",
                "count": 2,
            },
        },
    )

    assert rec["kind"] == "review"
    assert rec["source"] == "attempt_errors"
    assert rec["evidence"]["count"] == 2


def test_one_failed_hard_attempt_does_not_create_advanced_recommendation():
    rec = _recommend(
        attempt_rows=[_row()],
        adaptive_payload={
            "recommendation": {
                "topic": "dynamic programming",
                "difficulty": "hard",
                "action": "practice_review",
                "ladder_ready": False,
            },
            "review_signal": None,
        },
        mastery_payload={"weakest": {"topic": "dynamic programming", "attempts": 1, "scored": False}},
    )

    assert rec["topic"] != "dynamic programming"
    assert rec["source"] == "beginner_fallback"
    assert "Dynamic Programming" in rec["explanation"]["why_not_advanced"]


def test_low_signal_advanced_in_progress_does_not_override_latest_syntax_error_on_home():
    now = datetime.utcnow()
    rec = _recommend(
        progress_rows=[
            _row(
                question_id="dp-hard",
                status="in_progress",
                attempt_count=1,
                updated_at=now,
            )
        ],
        attempt_rows=[
            _row(
                question_id="dp-hard",
                topic="dynamic programming",
                difficulty="hard",
                language="python",
                outcome="error",
                error_class="syntax",
                created_at=now,
            )
        ],
        adaptive_payload={"recommendation": {}, "review_signal": None},
    )

    assert rec["kind"] == "error_checkpoint"
    assert rec["source"] == "latest_error"
    assert rec["target"]["category"] == "syntax"


def test_workspace_surface_can_resume_low_signal_advanced_problem():
    now = datetime.utcnow()
    rec = _recommend(
        surface="workspace",
        progress_rows=[
            _row(
                question_id="dp-hard",
                status="in_progress",
                attempt_count=1,
                updated_at=now,
            )
        ],
        attempt_rows=[
            _row(
                question_id="dp-hard",
                topic="dynamic programming",
                difficulty="hard",
                language="python",
                outcome="error",
                error_class="syntax",
                created_at=now,
            )
        ],
    )

    assert rec["kind"] == "resume"
    assert rec["topic"] == "dynamic programming"


def test_scored_advanced_mastery_can_recommend_advanced_topic():
    rec = _recommend(
        attempt_rows=[_row()],
        mastery_payload={
            "weakest": {
                "topic": "dynamic programming",
                "attempts": mastery.MIN_ATTEMPTS_FOR_SCORE,
                "score": 0.35,
                "scored": True,
                "reason": "Practice Dynamic Programming next.",
            }
        },
    )

    assert rec["kind"] == "mastery_review"
    assert rec["topic"] == "dynamic programming"


def test_repeated_unresolved_quiz_misses_recommend_same_category_review():
    now = datetime.utcnow()
    rows = [
        _row(
            category="loops",
            language="python",
            results_json=json.dumps([{"question_id": "q1", "correct": False}]),
            created_at=now - timedelta(minutes=2),
        ),
        _row(
            category="loops",
            language="python",
            results_json=json.dumps([{"question_id": "q2", "correct": False}]),
            created_at=now,
        ),
    ]
    rec = _recommend(concept_rows=rows)

    assert rec["kind"] == "quiz_review"
    assert rec["target"] == {"mode": "quiz", "language": "python", "category": "loops"}
    assert rec["evidence"]["misses"] == 2


def test_completed_lesson_points_to_matching_concept_check():
    rec = _recommend(
        learn_rows=[
            _row(
                language="python",
                category="functions",
                status="completed",
                completed_at=datetime.utcnow(),
            )
        ]
    )

    assert rec["kind"] == "lesson_to_quiz"
    assert rec["target"] == {"mode": "quiz", "language": "python", "category": "functions"}


def test_dismissed_review_uses_cooldown_and_falls_back():
    now = datetime.utcnow()
    dismissed = _row(
        event_type="recommendation_dismissed",
        topic="arrays",
        category="syntax",
        metadata_json=json.dumps({
            "kind": "error_checkpoint",
            "topic": "arrays",
            "category": "syntax",
            "target_mode": "lesson_review",
        }),
        created_at=now,
    )
    rec = _recommend(
        attempt_rows=[
            _row(
                question_id="arr-easy",
                topic="arrays",
                difficulty="easy",
                language="python",
                outcome="error",
                error_class="syntax",
                created_at=now,
            )
        ],
        adaptive_payload={"recommendation": {}, "review_signal": None},
        learning_event_rows=[dismissed],
    )

    assert rec["kind"] != "error_checkpoint"
    assert rec["cooldowns"][0]["type"] == "recommendation_dismissed"
    assert "cooldown" in rec["explanation"]["what_would_change"]


def test_starting_check_skip_event_is_reported_as_cooldown_when_signal_exists():
    now = datetime.utcnow()
    rec = _recommend(
        learn_rows=[
            _row(
                language="python",
                category="syntax",
                status="completed",
                completed_at=now,
            )
        ],
        starting_row=_row(status="skipped"),
        learning_event_rows=[
            _row(
                event_type="starting_check_skipped",
                metadata_json="{}",
                created_at=now,
            )
        ],
    )

    assert rec["kind"] == "lesson_to_quiz"
    assert any(item["type"] == "starting_check_skipped" for item in rec["cooldowns"])
