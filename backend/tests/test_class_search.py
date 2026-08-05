"""Unit tests for the public Banner class-search parser.

`parse_section` and the time/term helpers are pure, so these run against a real
captured fixture (`fixtures/banner_cosc_fall2026.json`, COSC / Fall 2026 pulled
live on 2026-07-02) with no network.
"""
import json
import os

import pytest

from banner_scraper.class_search import (
    parse_section, _fmt_time, _days_str, _meeting_time_string,
    human_term, sem_key_from_description, _valid_section,
)

_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "banner_cosc_fall2026.json")


@pytest.fixture(scope="module")
def raw_rows():
    with open(_FIXTURE) as f:
        return json.load(f)["data"]


def test_fixture_loads(raw_rows):
    assert len(raw_rows) == 10  # first page (pageMaxSize=10) of totalCount=77


def test_parse_section_core_fields(raw_rows):
    # COSC001-001, CRN 70427, senior comp — from the captured data.
    row = next(r for r in raw_rows if r["courseReferenceNumber"] == "70427")
    sec = parse_section(row, "fall_2026")
    assert sec["term"] == "fall_2026"
    assert sec["crn"] == "70427"
    assert sec["course_code"] == "COSC 001"
    assert sec["section"] == "001"
    assert sec["seats_available"] == 59
    assert sec["max_enrollment"] == 100
    assert sec["enrollment"] == 41
    assert sec["open_section"] is True
    assert sec["instructor"] == "Tannouri, Sam"


def test_parse_section_full_is_flagged(raw_rows):
    # COSC110 W-sections are full in the fixture (0/30).
    full = next(r for r in raw_rows if r["courseReferenceNumber"] == "70401")
    sec = parse_section(full, "fall_2026")
    assert sec["seats_available"] == 0
    assert sec["open_section"] is False


def test_open_section_matches_seats(raw_rows):
    for row in raw_rows:
        sec = parse_section(row, "fall_2026")
        # Banner's openSection flag should agree with seats>0 for these rows.
        assert sec["open_section"] == (sec["seats_available"] > 0)


def test_all_rows_parse_without_error(raw_rows):
    for row in raw_rows:
        sec = parse_section(row, "fall_2026")
        assert sec["crn"]
        assert sec["course_code"].startswith("COSC ")
        assert isinstance(sec["credits"], int)
        assert sec["time"]  # 'TBA' or a real string, never empty


# --- time formatting ---

@pytest.mark.parametrize("hhmm,expected", [
    ("1200", "12:00PM"),
    ("1250", "12:50PM"),
    ("0900", "9:00AM"),
    ("900", "9:00AM"),
    ("0000", "12:00AM"),
    ("1330", "1:30PM"),
    ("2359", "11:59PM"),
])
def test_fmt_time(hhmm, expected):
    assert _fmt_time(hhmm) == expected


@pytest.mark.parametrize("bad", [None, "", "TBA", "abcd", "99"])
def test_fmt_time_blank(bad):
    assert _fmt_time(bad) is None


def test_days_str():
    assert _days_str({"monday": True, "wednesday": True, "friday": True}) == "MWF"
    assert _days_str({"tuesday": True, "thursday": True}) == "TR"
    assert _days_str({}) == ""


def test_tr_stays_tuesday_then_thursday_for_schedule_parser():
    from services.schedule_planner import parse_time_slots

    slots = parse_time_slots("TR 9:00AM-10:20AM")

    assert [day for day, _start, _end in slots] == ["T", "R"]


def test_meeting_time_string_online_is_tba(raw_rows):
    # COSC001 in the fixture has an EXM meeting with null begin/end -> TBA.
    row = next(r for r in raw_rows if r["courseReferenceNumber"] == "70427")
    time_str, _room = _meeting_time_string(row.get("meetingsFaculty"))
    assert time_str == "TBA"


def test_meeting_time_string_builds_real_slot():
    meetings = [{"meetingTime": {
        "monday": True, "wednesday": True, "friday": True,
        "beginTime": "1200", "endTime": "1250",
        "building": "MCMN", "room": "514",
    }}]
    time_str, room = _meeting_time_string(meetings)
    assert time_str == "MWF 12:00PM-12:50PM"
    assert room == "MCMN-514"


def test_meeting_time_string_combines_multiple_timed_slots():
    meetings = [
        {"meetingTime": {
            "monday": True, "wednesday": True,
            "beginTime": "1000", "endTime": "1050",
            "building": " MCMN ", "room": " 516 ",
        }},
        {"meetingTime": {
            "friday": True,
            "beginTime": "1100", "endTime": "1150",
            "building": "TBA", "room": "",
        }},
    ]
    time_str, room = _meeting_time_string(meetings)
    assert time_str == "MW 10:00AM-10:50AM, F 11:00AM-11:50AM"
    assert room == "MCMN-516"


def test_parse_section_normalizes_missing_text_fields():
    sec = parse_section({
        "courseReferenceNumber": " 70099 ",
        "subject": " COSC ",
        "courseNumber": " 352 ",
        "courseTitle": "  Organization   of Programming Languages ",
        "sequenceNumber": " 001 ",
        "faculty": [{"primaryIndicator": True, "displayName": "  Jon   White "}],
        "campusDescription": None,
        "scheduleTypeDescription": "  Lecture ",
        "creditHours": "3",
        "seatsAvailable": "4",
        "meetingsFaculty": [],
    }, "fall_2026")
    assert sec["crn"] == "70099"
    assert sec["course_code"] == "COSC 352"
    assert sec["title"] == "Organization of Programming Languages"
    assert sec["instructor"] == "Jon White"
    assert sec["schedule_type"] == "Lecture"
    assert sec["time"] == "TBA"


def test_valid_section_requires_crn_and_course_code():
    assert _valid_section({"crn": "70001", "course_code": "COSC 352"})
    assert not _valid_section({"crn": "", "course_code": "COSC 352"})
    assert not _valid_section({"crn": "70001", "course_code": ""})


# --- term helpers ---

def test_human_term():
    assert human_term("fall_2026") == "Fall 2026"
    assert human_term("spring_2027") == "Spring 2027"


def test_sem_key_from_description():
    assert sem_key_from_description("Fall 2026") == "fall_2026"
    assert sem_key_from_description("Spring 2026 (View Only)") == "spring_2026"
    assert sem_key_from_description("Winter Minimester 2026 (View Only)") == "winter_2026"
    assert sem_key_from_description("garbage") is None
