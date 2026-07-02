"""Tests for live-seat integration in the planner.

Two levels:
- `generate_schedule_options` prefers open sections and flags full ones (pure).
- `get_live_sections` returns fresh snapshots and falls back (None) when stale,
  exercised against an isolated in-memory SQLite so it touches no real DB.
"""
import os
from datetime import datetime, timezone, timedelta

os.environ.setdefault("DATABASE_URL", "sqlite://")  # lets db.py import cleanly
os.environ.setdefault("JWT_SECRET", "test-only")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from models import Base, LiveSection
from services.schedule_planner import generate_schedule_options
import services.live_schedule as live_schedule


# --------------------------------------------------------------------------
# Engine: open sections preferred, full sections still flagged
# --------------------------------------------------------------------------

def _course(code, name="Course", credits=3, category="Required"):
    return {"id": code, "name": name, "credits": credits, "category": category}


def test_open_section_preferred_over_full():
    eligible = [_course("COSC 350", "Systems")]
    schedule = {"COSC 350": [
        {"section": "001", "instructor": "A", "time": "MWF 9:00AM-9:50AM", "room": "R1",
         "crn": "70001", "open_section": False, "seats_available": 0, "wait_count": 0, "wait_capacity": 0},
        {"section": "002", "instructor": "B", "time": "MWF 9:00AM-9:50AM", "room": "R2",
         "crn": "70002", "open_section": True, "seats_available": 5, "wait_count": 0, "wait_capacity": 0},
    ]}
    opts = generate_schedule_options(eligible, "fall_2026", {"max_credits": 15, "time_pref": "any", "interests": []}, {"fall_2026": schedule}, "Senior")
    assert opts, "expected at least one option"
    picked = opts[0]["courses"][0]
    assert picked["section"] == "002"          # the OPEN section
    assert picked["open_section"] is True
    assert picked["seats_available"] == 5


def test_full_section_used_when_only_option():
    # A required course with only a full section must still appear (flagged full).
    eligible = [_course("COSC 350", "Systems")]
    schedule = {"COSC 350": [
        {"section": "001", "instructor": "A", "time": "MWF 9:00AM-9:50AM", "room": "R1",
         "crn": "70001", "open_section": False, "seats_available": 0, "wait_count": 0, "wait_capacity": 0},
    ]}
    opts = generate_schedule_options(eligible, "fall_2026", {"max_credits": 15, "time_pref": "any", "interests": []}, {"fall_2026": schedule}, "Senior")
    assert opts
    picked = opts[0]["courses"][0]
    assert picked["section"] == "001"
    assert picked["open_section"] is False


def test_static_schedule_has_no_seat_fields():
    # A static-style section (no seat keys) carries open_section=None through.
    eligible = [_course("COSC 350", "Systems")]
    schedule = {"COSC 350": [
        {"section": "001", "instructor": "A", "time": "MWF 9:00AM-9:50AM", "room": "R1"},
    ]}
    opts = generate_schedule_options(eligible, "fall_2026", {"max_credits": 15, "time_pref": "any", "interests": []}, {"fall_2026": schedule}, "Senior")
    assert opts[0]["courses"][0]["open_section"] is None


# --------------------------------------------------------------------------
# get_live_sections: freshness + shape (isolated in-memory DB)
# --------------------------------------------------------------------------

def _isolated_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _row(term, crn, code, when, seats, open_):
    return LiveSection(
        term=term, crn=crn, subject="COSC", course_number=code.split()[1],
        course_code=code, title="X", credits=3, section="001", instructor="A",
        campus="Main", schedule_type="Traditional", meeting_time="MWF 9:00AM-9:50AM",
        room="R1", seats_available=seats, max_enrollment=30, enrollment=30 - seats,
        open_section=open_, wait_count=0, wait_capacity=0, wait_available=0, fetched_at=when,
    )


def test_get_live_sections_fresh(monkeypatch):
    TestSession = _isolated_session()
    now = datetime.now(timezone.utc)
    db = TestSession()
    db.add(_row("fall_2026", "70001", "COSC 350", now, seats=5, open_=True))
    db.commit(); db.close()
    monkeypatch.setattr(live_schedule, "SessionLocal", TestSession)

    sched, as_of = live_schedule.get_live_sections("fall_2026")
    assert sched is not None
    assert "COSC 350" in sched
    sec = sched["COSC 350"][0]
    assert sec["open_section"] is True and sec["seats_available"] == 5
    assert sec["crn"] == "70001"
    assert as_of is not None


def test_get_live_sections_stale_returns_none(monkeypatch):
    TestSession = _isolated_session()
    old = datetime.now(timezone.utc) - timedelta(hours=live_schedule.FRESH_HOURS + 1)
    db = TestSession()
    db.add(_row("fall_2026", "70001", "COSC 350", old, seats=5, open_=True))
    db.commit(); db.close()
    monkeypatch.setattr(live_schedule, "SessionLocal", TestSession)

    sched, as_of = live_schedule.get_live_sections("fall_2026")
    assert sched is None and as_of is None   # stale -> caller falls back to static


def test_get_live_sections_empty_returns_none(monkeypatch):
    TestSession = _isolated_session()
    monkeypatch.setattr(live_schedule, "SessionLocal", TestSession)
    sched, as_of = live_schedule.get_live_sections("spring_2099")
    assert sched is None and as_of is None
