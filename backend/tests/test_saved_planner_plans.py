import asyncio
import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "test-only")

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from models import Base, SavedPlannerPlan


def _session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _request(client_id="plan-1", option_label="Balanced", courses=None):
    if courses is None:
        courses = [
            {"code": "COSC 352", "name": "Organization of Programming Languages", "credits": 3},
        ]
    return main.SavedPlannerPlanRequest(
        client_id=client_id,
        semester="fall_2026",
        option_label=option_label,
        total_credits=15,
        plan={
            "label": option_label,
            "total_credits": 15,
            "courses": courses,
            "advisor_warnings": [],
        },
        swaps={"PHIL 102": {"swap": {"code": "HUMA 202"}}},
        preferences={"time_pref": "morning", "max_credits": 15},
        advisor_warnings=[],
    )


def test_saved_planner_plan_create_update_and_list():
    TestSession = _session()
    db = TestSession()

    created = asyncio.run(main.upsert_saved_planner_plan(
        _request(),
        user={"user_id": 1},
        db=db,
    ))
    updated = asyncio.run(main.upsert_saved_planner_plan(
        _request(option_label="Updated Balanced"),
        user={"user_id": 1},
        db=db,
    ))
    listed = asyncio.run(main.list_saved_planner_plans(user={"user_id": 1}, db=db))

    assert created["client_id"] == "plan-1"
    assert updated["option_label"] == "Updated Balanced"
    assert len(listed["items"]) == 1
    assert listed["items"][0]["plan"]["courses"][0]["code"] == "COSC 352"
    assert listed["items"][0]["swaps"]["PHIL 102"]["swap"]["code"] == "HUMA 202"
    assert db.query(SavedPlannerPlan).count() == 1
    db.close()


def test_saved_planner_plan_is_user_scoped_for_list_and_delete():
    TestSession = _session()
    db = TestSession()

    asyncio.run(main.upsert_saved_planner_plan(_request(), user={"user_id": 1}, db=db))
    assert asyncio.run(main.list_saved_planner_plans(user={"user_id": 2}, db=db)) == {"items": []}

    asyncio.run(main.delete_saved_planner_plan("plan-1", user={"user_id": 2}, db=db))
    assert db.query(SavedPlannerPlan).count() == 1

    deleted = asyncio.run(main.delete_saved_planner_plan("plan-1", user={"user_id": 1}, db=db))
    assert deleted == {"deleted": True, "client_id": "plan-1"}
    assert db.query(SavedPlannerPlan).count() == 0
    db.close()


def test_saved_planner_plan_rejects_missing_courses():
    TestSession = _session()
    db = TestSession()

    try:
        asyncio.run(main.upsert_saved_planner_plan(
            _request(courses=[]),
            user={"user_id": 1},
            db=db,
        ))
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("Expected missing courses to be rejected")
    finally:
        db.close()


def test_saved_planner_plan_rejects_oversized_snapshot(monkeypatch):
    TestSession = _session()
    db = TestSession()
    monkeypatch.setattr(main, "SAVED_PLANNER_MAX_JSON_BYTES", 100)

    try:
        asyncio.run(main.upsert_saved_planner_plan(
            _request(courses=[
                {"code": "COSC 352", "name": "X" * 500, "credits": 3},
            ]),
            user={"user_id": 1},
            db=db,
        ))
    except HTTPException as exc:
        assert exc.status_code == 413
    else:
        raise AssertionError("Expected oversized saved plan to be rejected")
    finally:
        db.close()
