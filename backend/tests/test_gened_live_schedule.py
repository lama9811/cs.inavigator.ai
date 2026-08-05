import asyncio
import os
from datetime import datetime, timezone

os.environ.setdefault("JWT_SECRET", "test-only")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
import services.course_context as course_context
import services.live_schedule as live_schedule
import services.requirement_planner as requirement_planner
from models import Base, LiveSection
from banner_scraper import class_search


def _dw_payload():
    return {
        "classification": "Senior",
        "credits_remaining": 60,
        "courses_completed": "[]",
        "courses_in_progress": "[]",
        "minor": "",
        "banner": {},
    }


def _graph():
    return {
        "nodes": [{
            "id": "COSC 352",
            "name": "Organization of Programming Languages",
            "credits": 3,
            "category": "Required",
            "status": "future",
            "blocked_by": [],
            "unlocks": [],
            "sequence": 5,
        }],
        "edges": [],
    }


def _requirements():
    return {
        "gened": [{
            "code": "AH",
            "name": "Arts and Humanities",
            "primary": {"code": "MUSC 391", "name": "The World of Music", "credits": 3},
            "alternatives": [
                {"code": "PHIL 220", "name": "The Good Life", "credits": 3},
                {"code": "ENGL 211", "name": "World Literature", "credits": 3},
            ],
        }],
        "minor": None,
    }


def _isolated_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _live_row(term, crn, subject, code):
    return LiveSection(
        term=term,
        crn=crn,
        subject=subject,
        course_number=code.split()[1],
        course_code=code,
        title="Existing",
        credits=3,
        section="001",
        instructor="A",
        campus="Main",
        schedule_type="Lecture",
        meeting_time="MWF 9:00AM-9:50AM",
        room="R1",
        seats_available=4,
        max_enrollment=30,
        enrollment=26,
        open_section=True,
        wait_count=0,
        wait_capacity=0,
        wait_available=0,
        fetched_at=datetime.now(timezone.utc),
    )


def _patch_planner_basics(monkeypatch):
    monkeypatch.setattr(main, "_fetch_canvas_sync", lambda _uid: None)
    monkeypatch.setattr(main, "_fetch_dw_sync", lambda _uid: _dw_payload())
    monkeypatch.setattr(main, "build_prerequisite_graph", lambda _dw, _canvas: _graph())
    monkeypatch.setattr(requirement_planner, "build_requirements", lambda _dw, _minor: _requirements())
    monkeypatch.setattr(course_context, "_SCHEDULES", {
        "fall_2026": {
            "COSC 352": [{
                "section": "001",
                "instructor": "Static Instructor",
                "time": "TR 9:00AM-10:20AM",
                "room": "MCMN-516",
            }],
        },
    })


def test_gened_candidate_subjects_include_expected_planner_subjects():
    subjects = set(class_search.gened_candidate_subjects())
    assert {"PHIL", "SOCI", "ENGL", "MATH", "SPAN"} <= subjects
    assert "" not in subjects


def test_refresh_subjects_combines_cs_and_gened_without_duplicates(monkeypatch):
    monkeypatch.setattr(class_search, "gened_candidate_subjects", lambda: ["PHIL", "COSC", "ENGL"])
    assert class_search.refresh_subjects() == ["COSC", "BIOI", "CLCO", "PHIL", "ENGL"]
    assert class_search.refresh_subjects("phil, soci COSC", include_geneds=False) == ["PHIL", "SOCI", "COSC"]


def test_planner_attaches_live_gened_section(monkeypatch):
    _patch_planner_basics(monkeypatch)
    monkeypatch.setattr(live_schedule, "get_live_sections", lambda _sem: ({
        "COSC 352": [{
            "section": "001",
            "instructor": "Jon White",
            "time": "TR 9:00AM-10:20AM",
            "room": "MCMN-516",
            "crn": "70001",
            "seats_available": 9,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "MUSC 391": [{
            "section": "002",
            "instructor": "Morgan Faculty",
            "time": "MWF 11:00AM-11:50AM",
            "room": "BSSC-101",
            "crn": "71002",
            "seats_available": 12,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
    }, None))

    result = asyncio.run(main.planning_next_semester(
        semester="fall_2026",
        time_pref="any",
        max_credits=12,
        interests="",
        variant=0,
        user={"user_id": 1},
    ))

    gened = next(course for course in result["options"][0]["courses"] if course["code"] == "MUSC 391")
    assert gened["untimed"] is False
    assert gened["section"] == "002"
    assert gened["time"] == "MWF 11:00AM-11:50AM"
    assert gened["crn"] == "71002"
    assert gened["availability"] == "open"
    assert gened["data_source"] == "live"


def test_planner_keeps_gened_untimed_without_cached_live_row(monkeypatch):
    _patch_planner_basics(monkeypatch)
    monkeypatch.setattr(live_schedule, "get_live_sections", lambda _sem: ({
        "COSC 352": [{
            "section": "001",
            "instructor": "Jon White",
            "time": "TR 9:00AM-10:20AM",
            "room": "MCMN-516",
            "crn": "70001",
            "seats_available": 9,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
    }, None))

    result = asyncio.run(main.planning_next_semester(
        semester="fall_2026",
        time_pref="any",
        max_credits=12,
        interests="",
        variant=0,
        user={"user_id": 1},
    ))

    gened = next(course for course in result["options"][0]["courses"] if course["code"] == "MUSC 391")
    assert gened["untimed"] is True
    assert gened["time"] == "TBD"
    assert gened["availability"] == "unknown"
    assert gened["data_source"] == "static"


def test_planner_marks_live_zero_seat_gened_as_full(monkeypatch):
    _patch_planner_basics(monkeypatch)
    monkeypatch.setattr(live_schedule, "get_live_sections", lambda _sem: ({
        "COSC 352": [{
            "section": "001",
            "instructor": "Jon White",
            "time": "TR 9:00AM-10:20AM",
            "room": "MCMN-516",
            "crn": "70001",
            "seats_available": 9,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "MUSC 391": [{
            "section": "001",
            "instructor": "Morgan Faculty",
            "time": "MWF 11:00AM-11:50AM",
            "room": "MURP-101",
            "crn": "71002",
            "seats_available": 0,
            "max_enrollment": 30,
            "open_section": False,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
    }, None))

    result = asyncio.run(main.planning_next_semester(
        semester="fall_2026",
        time_pref="any",
        max_credits=12,
        interests="",
        variant=0,
        user={"user_id": 1},
    ))

    gened = next(course for course in result["options"][0]["courses"] if course["code"] == "MUSC 391")
    assert gened["untimed"] is False
    assert gened["availability"] == "full"
    assert gened["seats_available"] == 0
    assert any(flag["type"] == "full" for flag in gened["risk_flags"])


def test_full_live_gened_includes_live_open_same_area_swap(monkeypatch):
    _patch_planner_basics(monkeypatch)
    monkeypatch.setattr(live_schedule, "get_live_sections", lambda _sem: ({
        "COSC 352": [{
            "section": "001",
            "instructor": "Jon White",
            "time": "TR 9:00AM-10:20AM",
            "room": "MCMN-516",
            "crn": "70001",
            "seats_available": 9,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "MUSC 391": [{
            "section": "001",
            "instructor": "Morgan Faculty",
            "time": "MWF 11:00AM-11:50AM",
            "room": "MURP-101",
            "crn": "71002",
            "seats_available": 0,
            "max_enrollment": 30,
            "open_section": False,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "PHIL 220": [{
            "section": "002",
            "instructor": "Philosophy Faculty",
            "time": "TR 2:00PM-3:20PM",
            "room": "COMM-115",
            "crn": "72002",
            "seats_available": 8,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "ENGL 211": [{
            "section": "001",
            "instructor": "English Faculty",
            "time": "MWF 10:00AM-10:50AM",
            "room": "COMM-101",
            "crn": "73001",
            "seats_available": 0,
            "max_enrollment": 30,
            "open_section": False,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
    }, None))

    result = asyncio.run(main.planning_next_semester(
        semester="fall_2026",
        time_pref="any",
        max_credits=12,
        interests="",
        variant=0,
        user={"user_id": 1},
    ))

    gened = next(course for course in result["options"][0]["courses"] if course["code"] == "PHIL 220")
    assert gened["availability"] == "open"
    assert gened["seats_available"] == 8
    assert gened["time"] == "TR 2:00PM-3:20PM"
    assert gened["alternatives"] == []


def test_live_same_requirement_swaps_exclude_full_sections(monkeypatch):
    _patch_planner_basics(monkeypatch)
    monkeypatch.setattr(live_schedule, "get_live_sections", lambda _sem: ({
        "COSC 352": [{
            "section": "001",
            "instructor": "Jon White",
            "time": "TR 9:00AM-10:20AM",
            "room": "MCMN-516",
            "crn": "70001",
            "seats_available": 9,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "MUSC 391": [{
            "section": "001",
            "instructor": "Morgan Faculty",
            "time": "MWF 11:00AM-11:50AM",
            "room": "MURP-101",
            "crn": "71002",
            "seats_available": 12,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "PHIL 220": [{
            "section": "002",
            "instructor": "Philosophy Faculty",
            "time": "TR 2:00PM-3:20PM",
            "room": "COMM-115",
            "crn": "72002",
            "seats_available": 8,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "ENGL 211": [{
            "section": "001",
            "instructor": "English Faculty",
            "time": "MWF 10:00AM-10:50AM",
            "room": "COMM-101",
            "crn": "73001",
            "seats_available": 0,
            "max_enrollment": 30,
            "open_section": False,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
    }, None))

    result = asyncio.run(main.planning_next_semester(
        semester="fall_2026",
        time_pref="any",
        max_credits=12,
        interests="",
        variant=0,
        user={"user_id": 1},
    ))

    gened = next(course for course in result["options"][0]["courses"] if course["code"] == "MUSC 391")
    swap = gened["alternatives"][0]
    assert swap["code"] == "PHIL 220"
    assert swap["availability"] == "open"
    assert swap["seats_available"] == 8
    assert swap["time"] == "TR 2:00PM-3:20PM"
    assert "ENGL 211" not in {alt["code"] for alt in gened["alternatives"]}


def test_planner_prefers_open_live_gened_over_lowest_number_default(monkeypatch):
    _patch_planner_basics(monkeypatch)
    monkeypatch.setattr(requirement_planner, "build_requirements", lambda _dw, _minor: {
        "gened": [{
            "code": "AH",
            "name": "Arts and Humanities",
            "primary": {"code": "PHIL 102", "name": "The Big Questions", "credits": 3},
            "alternatives": [
                {"code": "HUMA 202", "name": "Introduction to Humanities II", "credits": 3},
                {"code": "MUSC 391", "name": "The World of Music", "credits": 3},
            ],
        }],
        "minor": None,
    })
    monkeypatch.setattr(live_schedule, "get_live_sections", lambda _sem: ({
        "COSC 352": [{
            "section": "001",
            "instructor": "Jon White",
            "time": "TR 9:00AM-10:20AM",
            "room": "MCMN-516",
            "crn": "70001",
            "seats_available": 9,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "PHIL 102": [{
            "section": "001",
            "instructor": "Philosophy Faculty",
            "time": "TR 2:00PM-3:20PM",
            "room": "COMM-115",
            "crn": "72001",
            "seats_available": 0,
            "max_enrollment": 30,
            "open_section": False,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "HUMA 202": [{
            "section": "001",
            "instructor": "Humanities Faculty",
            "time": "MWF 10:00AM-10:50AM",
            "room": "COMM-101",
            "crn": "73001",
            "seats_available": 18,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
    }, None))

    result = asyncio.run(main.planning_next_semester(
        semester="fall_2026",
        time_pref="any",
        max_credits=12,
        interests="",
        variant=0,
        user={"user_id": 1},
    ))

    codes = {course["code"] for course in result["options"][0]["courses"]}
    gened = next(course for course in result["options"][0]["courses"] if course["kind"] == "gened")
    assert "HUMA 202" in codes
    assert "PHIL 102" not in codes
    assert gened["availability"] == "open"
    assert gened["seats_available"] == 18


def test_planner_uses_wait_available_for_waitlist_status(monkeypatch):
    _patch_planner_basics(monkeypatch)
    monkeypatch.setattr(live_schedule, "get_live_sections", lambda _sem: ({
        "COSC 352": [{
            "section": "001",
            "instructor": "Jon White",
            "time": "TR 9:00AM-10:20AM",
            "room": "MCMN-516",
            "crn": "70001",
            "seats_available": 9,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "MUSC 391": [{
            "section": "001",
            "instructor": "Morgan Faculty",
            "time": "MWF 11:00AM-11:50AM",
            "room": "MURP-101",
            "crn": "71002",
            "seats_available": 0,
            "max_enrollment": 30,
            "open_section": False,
            "wait_count": 9,
            "wait_capacity": 10,
            "wait_available": 1,
        }],
    }, None))

    result = asyncio.run(main.planning_next_semester(
        semester="fall_2026",
        time_pref="any",
        max_credits=12,
        interests="",
        variant=0,
        user={"user_id": 1},
    ))

    gened = next(course for course in result["options"][0]["courses"] if course["code"] == "MUSC 391")
    assert gened["availability"] == "waitlist"
    assert gened["wait_available"] == 1


def test_planner_applies_time_preference_to_live_gened_sections(monkeypatch):
    _patch_planner_basics(monkeypatch)
    monkeypatch.setattr(live_schedule, "get_live_sections", lambda _sem: ({
        "COSC 352": [{
            "section": "001",
            "instructor": "Jon White",
            "time": "TR 9:00AM-10:20AM",
            "room": "MCMN-516",
            "crn": "70001",
            "seats_available": 9,
            "max_enrollment": 30,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }],
        "MUSC 391": [
            {
                "section": "001",
                "instructor": "Morning Faculty",
                "time": "MWF 9:00AM-9:50AM",
                "room": "MURP-101",
                "crn": "71001",
                "seats_available": 4,
                "max_enrollment": 30,
                "open_section": True,
                "wait_count": 0,
                "wait_capacity": 0,
                "wait_available": 0,
            },
            {
                "section": "002",
                "instructor": "Afternoon Faculty",
                "time": "MWF 2:00PM-2:50PM",
                "room": "MURP-102",
                "crn": "71002",
                "seats_available": 20,
                "max_enrollment": 30,
                "open_section": True,
                "wait_count": 0,
                "wait_capacity": 0,
                "wait_available": 0,
            },
        ],
    }, None))

    result = asyncio.run(main.planning_next_semester(
        semester="fall_2026",
        time_pref="morning",
        max_credits=12,
        interests="",
        variant=0,
        user={"user_id": 1},
    ))

    gened = next(course for course in result["options"][0]["courses"] if course["code"] == "MUSC 391")
    assert gened["section"] == "001"
    assert gened["instructor"] == "Morning Faculty"


def test_live_gened_section_options_exclude_full_and_respect_preference():
    course = {
        "code": "MUSC 391",
        "name": "The World of Music",
        "credits": 3,
        "untimed": True,
        "kind": "gened",
    }
    attached = live_schedule.attach_live_section(course, {
        "MUSC 391": [
            {
                "section": "001",
                "instructor": "Morning Faculty",
                "time": "MWF 9:00AM-9:50AM",
                "room": "MURP-101",
                "crn": "71001",
                "seats_available": 4,
                "max_enrollment": 30,
                "open_section": True,
                "wait_count": 0,
                "wait_capacity": 0,
                "wait_available": 0,
            },
            {
                "section": "002",
                "instructor": "Afternoon Faculty",
                "time": "MWF 2:00PM-2:50PM",
                "room": "MURP-102",
                "crn": "71002",
                "seats_available": 20,
                "max_enrollment": 30,
                "open_section": True,
                "wait_count": 0,
                "wait_capacity": 0,
                "wait_available": 0,
            },
            {
                "section": "003",
                "instructor": "Closed Faculty",
                "time": "TR 11:00AM-12:20PM",
                "room": "MURP-103",
                "crn": "71003",
                "seats_available": 0,
                "max_enrollment": 30,
                "open_section": False,
                "wait_count": 0,
                "wait_capacity": 0,
                "wait_available": 0,
            },
        ],
    }, {"time_pref": "morning"})

    assert attached["section"] == "001"
    assert [section["crn"] for section in attached["section_options"]] == ["71001", "71002"]
    assert all(section["availability"] != "full" for section in attached["section_options"])


def test_refresh_failure_preserves_previous_subject_rows(monkeypatch):
    TestSession = _isolated_session()
    db = TestSession()
    db.add(_live_row("fall_2026", "79999", "MUSC", "MUSC 391"))
    db.commit()
    db.close()

    async def fake_resolve_term(_term):
        return "202670"

    async def fake_fetch(subject, _term_code, sem_key):
        if subject == "PHIL":
            raise RuntimeError("Banner unavailable for PHIL")
        return [{
            "term": sem_key,
            "crn": "71111",
            "subject": subject,
            "course_number": "101",
            "course_code": f"{subject} 101",
            "title": "Fresh Row",
            "credits": 3,
            "section": "001",
            "instructor": "B",
            "campus": "Main",
            "schedule_type": "Lecture",
            "time": "TR 1:00PM-2:20PM",
            "room": "R2",
            "seats_available": 8,
            "max_enrollment": 30,
            "enrollment": 22,
            "open_section": True,
            "wait_count": 0,
            "wait_capacity": 0,
            "wait_available": 0,
        }]

    monkeypatch.setattr(main, "SessionLocal", TestSession)
    monkeypatch.setattr(main, "_require_research_secret", lambda _request: None)
    monkeypatch.setattr(class_search, "resolve_term_code", fake_resolve_term)
    monkeypatch.setattr(class_search, "fetch_sections", fake_fetch)

    result = asyncio.run(main.internal_schedule_refresh(
        request=object(),
        term="fall_2026",
        subjects="ENGL,PHIL",
        include_geneds=False,
    ))

    db = TestSession()
    rows = db.query(LiveSection).all()
    db.close()

    assert result["status"] == "partial"
    assert result["subjects"] == {"ENGL": 1}
    assert result["errors"][0]["subject"] == "PHIL"
    assert result["errors"][0]["stage"] == "fetch"
    assert {row.crn for row in rows} == {"71111", "79999"}
