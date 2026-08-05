import asyncio
import os

os.environ.setdefault("JWT_SECRET", "test-only")

import main
import services.live_schedule as live_schedule
from services.planner_explanations import (
    cs_alternatives,
    future_planner_semesters,
    plan_explanation,
    prereqs_met_for_planner,
    requirement_alternative_map,
    risk_flags,
)


def test_future_planner_semesters_start_at_fall_2026():
    terms = ["spring_2025", "summer_2025", "fall_2025", "spring_2026", "fall_2026"]
    assert future_planner_semesters(terms) == ["fall_2026"]


def test_static_tba_and_prereq_risks_are_flagged():
    flags = risk_flags(
        {"code": "COSC 354", "time": "TBA", "availability": "unknown"},
        data_source="static",
        completed_codes=set(),
        in_progress_codes={"COSC 352"},
        registered_codes=set(),
        node={"blocked_by": ["COSC 352"]},
    )
    types = {flag["type"] for flag in flags}
    assert {"verify_seats", "tba_time", "in_progress_prereq"} <= types


def test_prereqs_met_for_planner_blocks_missing_degreeworks_prereq():
    node = {"blocked_by": ["COSC 220"], "prereq_logic": "all"}

    assert prereqs_met_for_planner(node, completed_codes=set(), in_progress_codes=set()) is False
    assert prereqs_met_for_planner(node, completed_codes={"COSC 220"}, in_progress_codes=set()) is True
    assert prereqs_met_for_planner(node, completed_codes=set(), in_progress_codes={"COSC 220"}) is True


def test_prereqs_met_for_planner_respects_any_prereq_logic():
    node = {"blocked_by": ["MATH 114", "MATH 141"], "prereq_logic": "any"}

    assert prereqs_met_for_planner(node, completed_codes={"MATH 141"}, in_progress_codes=set()) is True
    assert prereqs_met_for_planner(node, completed_codes={"MATH 110"}, in_progress_codes=set()) is False


def test_overlap_and_live_seat_risks_are_flagged():
    flags = risk_flags(
        {"code": "COSC 352", "time": "TR 9:00AM-10:20AM", "availability": "full"},
        data_source="live",
        completed_codes={"COSC 111"},
        in_progress_codes={"COSC 220"},
        registered_codes={"COSC 352"},
        node={"blocked_by": []},
    )
    types = {flag["type"] for flag in flags}
    assert {"full", "registered_overlap"} <= types


def test_requirement_alternative_map_for_gened():
    reqs = {
        "gened": [{
            "name": "Arts and Humanities",
            "primary": {"code": "MUSC 391", "name": "The World of Music"},
            "alternatives": [{"code": "PHIL 220", "name": "The Good Life"}],
        }],
        "minor": None,
    }
    mapping = requirement_alternative_map(reqs)
    assert mapping["MUSC 391"][0]["code"] == "PHIL 220"


def test_cs_alternatives_skip_selected_and_conflicts():
    eligible = [
        {"id": "COSC 354", "name": "Operating Systems", "credits": 3},
        {"id": "COSC 458", "name": "Software Engineering", "credits": 3},
    ]
    schedules = {"fall_2026": {
        "COSC 354": [{"time": "TR 1:00PM-2:20PM"}],
        "COSC 458": [{"time": "TR 1:00PM-2:20PM"}],
    }}
    selected = [
        {"code": "COSC 352", "credits": 3, "time": "TR 9:00AM-10:20AM"},
        {"code": "COSC 354", "credits": 3, "time": "TR 1:00PM-2:20PM"},
    ]
    swaps = cs_alternatives(
        selected[0],
        selected_courses=selected,
        eligible=eligible,
        schedules=schedules,
        semester_key="fall_2026",
        option_total=6,
        option_limit=12,
    )
    assert swaps == []


def test_plan_explanation_marks_warnings_needs_verification():
    option = {
        "label": "Balanced",
        "total_credits": 15,
        "courses": [{
            "code": "COSC 352",
            "name": "Organization of Programming Languages",
            "risk_flags": [{"type": "verify_seats", "message": "Verify open seats in Banner."}],
        }],
    }
    explanation = plan_explanation(option, interests=["systems"], data_source="static")
    assert explanation["advisor_status"] == "needs_verification"
    assert explanation["advisor_warnings"]


def test_plan_explanation_uses_only_course_review_items():
    option = {
        "label": "Balanced",
        "total_credits": 15,
        "courses": [{
            "code": "COSC 352",
            "name": "Organization of Programming Languages",
            "risk_flags": [],
        }],
    }
    explanation = plan_explanation(option, interests=[], data_source="static")
    assert explanation["advisor_status"] == "ready"
    assert explanation["advisor_warnings"] == []


def test_planner_endpoint_returns_explanations_and_future_terms(monkeypatch):
    monkeypatch.setattr(live_schedule, "get_live_sections", lambda _sem: (None, None))
    monkeypatch.setattr(live_schedule, "get_live_sections_status", lambda _sem: {
        "status": "stale",
        "as_of": "2026-07-01T12:00:00+00:00",
        "fresh": False,
        "fresh_hours": 24,
        "subject_count": 3,
    })
    monkeypatch.setattr(main, "_fetch_canvas_sync", lambda _uid: None)
    monkeypatch.setattr(main, "_fetch_dw_sync", lambda _uid: {
        "classification": "Senior",
        "degree_program": "Bachelor of Science in Computer Science",
        "minor": "",
        "catalog_year": "2022-2023",
        "overall_gpa": 3.2,
        "total_credits_earned": 60,
        "total_credits_applied": 72,
        "total_credits_in_progress": 12,
        "credits_remaining": 60,
        "courses_completed": '[{"code":"COSC 111","name":"Intro to CS","grade":"A"}]',
        "courses_in_progress": '[{"code":"COSC 220","name":"Data Structures"}]',
        "courses_remaining": '[{"code":"COSC 352","name":"Organization of Programming Languages"}]',
        "requirements_status": '[{"category":"Major","status":"In progress"}]',
        "gened_areas": '{"AH":50}',
        "banner": {},
        "data_source": "banner_scrape",
        "synced_at": "2026-07-01T12:00:00+00:00",
    })
    monkeypatch.setattr(main, "build_prerequisite_graph", lambda _dw, _canvas: {
        "nodes": [
            {"id": "COSC 352", "name": "Organization of Programming Languages", "credits": 3,
             "category": "Required", "status": "future", "blocked_by": [], "unlocks": ["COSC 458"],
             "sequence": 5},
            {"id": "COSC 354", "name": "Operating Systems", "credits": 3,
             "category": "Required", "status": "future", "blocked_by": [], "unlocks": [],
             "sequence": 6},
            {"id": "COSC 458", "name": "Software Engineering", "credits": 3,
             "category": "Required", "status": "future", "blocked_by": [], "unlocks": [],
             "sequence": 7},
        ],
        "edges": [],
    })

    result = asyncio.run(main.planning_next_semester(
        semester=None,
        time_pref="any",
        max_credits=15,
        interests="",
        variant=0,
        user={"user_id": 1},
    ))

    assert result["available_semesters"] == ["fall_2026"]
    assert result["live_schedule"]["status"] == "stale"
    assert result["live_schedule"]["fresh"] is False
    assert result["live_schedule"]["fresh_hours"] == 24
    assert result["degreeworks_context"]["connected"] is True
    assert result["degreeworks_context"]["source"] == "banner_scrape"
    assert result["degreeworks_context"]["student"]["degree_program"] == "Bachelor of Science in Computer Science"
    assert result["degreeworks_context"]["progress"]["credits_in_progress"] == 12
    assert result["degreeworks_context"]["courses"]["completed_sample"][0]["code"] == "COSC 111"
    assert result["degreeworks_context"]["courses"]["in_progress"][0]["code"] == "COSC 220"
    assert result["degreeworks_context"]["requirements_status"][0]["category"] == "Major"
    assert result["degreeworks_context"]["gened_areas"] == {"AH": 50}
    assert result["options"]
    option = result["options"][0]
    assert option["summary_reason"]
    assert option["tradeoffs"]
    assert option["interest_fit"]
    assert option["advisor_status"] in {"ready", "needs_verification"}
    assert isinstance(option["advisor_warnings"], list)
    course = option["courses"][0]
    assert course["reason"]
    assert course["requirement_match"]
    assert isinstance(course["risk_flags"], list)
    assert isinstance(course["alternatives"], list)
