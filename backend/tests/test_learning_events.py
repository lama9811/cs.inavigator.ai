import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from models import Base, CodingLearningEvent, User
from services import learning_events


def _session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_learning_events_are_append_only_and_user_scoped():
    db = _session()
    user = User(email="timeline@example.com", password_hash="x")
    other = User(email="other-timeline@example.com", password_hash="x")
    db.add_all([user, other])
    db.commit()

    learning_events.record_event(
        db,
        user_id=user.id,
        event_type="lesson_opened",
        language="python",
        surface="learn",
        category="syntax",
        metadata={"notes": "short"},
        commit=True,
    )
    learning_events.record_event(
        db,
        user_id=user.id,
        event_type="lesson_opened",
        language="python",
        surface="learn",
        category="syntax",
        metadata={"notes": "second"},
        commit=True,
    )
    learning_events.record_event(
        db,
        user_id=other.id,
        event_type="lesson_opened",
        language="python",
        surface="learn",
        category="syntax",
        commit=True,
    )

    assert db.query(CodingLearningEvent).count() == 3
    rows = learning_events.recent_events(db, user.id, language="python")
    assert len(rows) == 2
    assert all(row.user_id == user.id for row in rows)


def test_learning_event_metadata_is_sanitized_and_serialized():
    db = _session()
    user = User(email="timeline-meta@example.com", password_hash="x")
    db.add(user)
    db.commit()

    row = learning_events.record_event(
        db,
        user_id=user.id,
        event_type="recommendation_dismissed",
        language="python",
        topic="arrays",
        metadata={
            "kind": "error_checkpoint",
            "long": "x" * 1000,
            "items": list(range(20)),
        },
        commit=True,
    )

    raw = json.loads(row.metadata_json)
    assert raw["kind"] == "error_checkpoint"
    assert len(raw["long"]) == 240
    assert len(raw["items"]) == 10
    payload = learning_events.serialize_event(row)
    assert payload["metadata"]["kind"] == "error_checkpoint"


def test_mini_plan_learning_events_are_allowed():
    db = _session()
    user = User(email="timeline-plan@example.com", password_hash="x")
    db.add(user)
    db.commit()

    for event_type in sorted(learning_events.MINI_PLAN_EVENT_TYPES):
        row = learning_events.record_event(
            db,
            user_id=user.id,
            event_type=event_type,
            language="python",
            surface="home",
            topic="loops",
            metadata={"plan_id": "plan-python-loops", "step_id": "quiz-loops"},
            commit=True,
        )
        assert row.event_type == event_type

    rows = learning_events.recent_events(db, user.id, language="python")
    assert {row.event_type for row in rows} == learning_events.MINI_PLAN_EVENT_TYPES
