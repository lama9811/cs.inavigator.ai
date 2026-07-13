"""Tests for the scholarship & internship search service.

The two properties that matter most, and are easiest to regress:
  1. A missing TAVILY_API_KEY must NEVER crash. The original ADK tool raised at
     client construction, which would take the app down on startup. Here it has to
     degrade to a reportable "not configured" state.
  2. Expired opportunities must NEVER reach a student. The prompt asks the model to
     drop them, but we enforce it in code — an LLM cannot be trusted with date math,
     and showing a dead deadline is worse than showing nothing.
"""

import os
from datetime import date, timedelta
from unittest.mock import patch

import pytest

from services import scholarship_search as ss


def _iso(days_from_today: int) -> str:
    return (date.today() + timedelta(days=days_from_today)).strftime("%Y-%m-%d")


# --- check_deadline ----------------------------------------------------------

@pytest.mark.parametrize("offset,expected", [
    (-30, "EXPIRED"),
    (-1, "EXPIRED"),
    (0, "TODAY"),
    (1, "URGENT"),
    (7, "URGENT"),      # boundary: <= 7 days is urgent
    (8, "UPCOMING"),    # boundary: 8 days is not
    (30, "UPCOMING"),   # boundary: <= 30 days is upcoming
    (31, "OPEN"),       # boundary: 31 days is open
    (400, "OPEN"),
])
def test_check_deadline_buckets(offset, expected):
    assert ss.check_deadline(_iso(offset))["status"] == expected


def test_check_deadline_days_remaining_is_signed():
    assert ss.check_deadline(_iso(-5))["days_remaining"] == -5
    assert ss.check_deadline(_iso(12))["days_remaining"] == 12


@pytest.mark.parametrize("bad", ["", "not-a-date", "12/25/2026", "(not listed)", None, 20260101])
def test_check_deadline_rejects_garbage(bad):
    """Bad input returns INVALID rather than raising — the model WILL send junk."""
    assert ss.check_deadline(bad)["status"] == "INVALID"


# --- configuration -----------------------------------------------------------

def test_not_configured_without_key(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    assert ss.is_configured() is False


def test_blank_key_is_not_configured(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "   ")
    assert ss.is_configured() is False


def test_configured_with_key(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    assert ss.is_configured() is True


def test_missing_key_degrades_instead_of_raising(monkeypatch):
    """The whole point: no key must not blow up the request."""
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    result = ss.find_opportunities("scholarships", {"gpa": 3.4})
    assert result["configured"] is False
    assert result["total"] == 0
    assert "TAVILY_API_KEY" in result["note"]


def test_web_search_without_key_returns_error_dict(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    out = ss.web_search("anything")
    assert out["results"] == []
    assert "error" in out


# --- failure paths -----------------------------------------------------------

def test_tavily_exception_is_swallowed(monkeypatch):
    """A Tavily outage returns an error dict, never an exception."""
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    with patch("tavily.TavilyClient") as client:
        client.return_value.search.side_effect = RuntimeError("connection reset")
        out = ss.web_search("scholarships")
    assert out["results"] == []
    assert "connection reset" in out["error"]


def test_search_failure_returns_empty_result_not_500(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    with patch.object(ss, "web_search", return_value={"error": "quota exceeded", "results": []}):
        result = ss.find_opportunities("scholarships", {})
    assert result["configured"] is True
    assert result["total"] == 0
    assert "quota exceeded" in result["note"]


def test_gemini_failure_still_returns_sources(monkeypatch):
    """If the model can't summarize, the student should still get the raw links."""
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    hits = {"results": [{"title": "UNCF", "url": "https://uncf.org", "snippet": "s", "published_date": None}]}
    with patch.object(ss, "web_search", return_value=hits), \
         patch.object(ss, "_ask_gemini", return_value=None):
        result = ss.find_opportunities("scholarships", {})
    assert result["total"] == 0
    assert result["sources"][0]["url"] == "https://uncf.org"


# --- urgency grouping (the safety-critical bit) ------------------------------

def test_expired_opportunities_are_dropped():
    """A student must never be shown an award that already closed."""
    groups = ss._group_by_urgency([
        {"name": "Closed last month", "deadline": _iso(-30)},
        {"name": "Closed yesterday", "deadline": _iso(-1)},
        {"name": "Still open", "deadline": _iso(45)},
    ])
    names = [i["name"] for bucket in groups.values() for i in bucket]
    assert names == ["Still open"]


def test_items_land_in_the_right_bucket():
    groups = ss._group_by_urgency([
        {"name": "Soon", "deadline": _iso(3)},
        {"name": "Later", "deadline": _iso(20)},
        {"name": "Far off", "deadline": _iso(90)},
    ])
    assert [i["name"] for i in groups["URGENT"]] == ["Soon"]
    assert [i["name"] for i in groups["UPCOMING"]] == ["Later"]
    assert [i["name"] for i in groups["OPEN"]] == ["Far off"]


def test_due_today_is_urgent_not_dropped():
    groups = ss._group_by_urgency([{"name": "Due today", "deadline": _iso(0)}])
    assert [i["name"] for i in groups["URGENT"]] == ["Due today"]


def test_undated_items_are_kept_as_open():
    """Rolling deadlines and '(not listed)' are still useful — keep, don't drop."""
    groups = ss._group_by_urgency([
        {"name": "Rolling", "deadline": "(not listed)"},
        {"name": "Missing"},
    ])
    assert {i["name"] for i in groups["OPEN"]} == {"Rolling", "Missing"}
    assert all(i["days_remaining"] is None for i in groups["OPEN"])


def test_soonest_deadline_sorts_first():
    groups = ss._group_by_urgency([
        {"name": "Day 6", "deadline": _iso(6)},
        {"name": "Day 2", "deadline": _iso(2)},
        {"name": "Day 4", "deadline": _iso(4)},
    ])
    assert [i["name"] for i in groups["URGENT"]] == ["Day 2", "Day 4", "Day 6"]


def test_undated_items_sink_below_dated_ones():
    groups = ss._group_by_urgency([
        {"name": "Rolling", "deadline": "(not listed)"},
        {"name": "Dated", "deadline": _iso(60)},
    ])
    assert [i["name"] for i in groups["OPEN"]] == ["Dated", "Rolling"]


def test_malformed_items_are_skipped():
    """The model can emit junk; grouping must not raise on it."""
    groups = ss._group_by_urgency([
        {"name": "Good", "deadline": _iso(10)},
        {"no_name": "bad"},
        "not a dict",
        None,
    ])
    names = [i["name"] for bucket in groups.values() for i in bucket]
    assert names == ["Good"]


# --- student profile ---------------------------------------------------------

def test_profile_reads_the_real_degreeworks_columns():
    """GPA lives in `overall_gpa`, not `gpa`. Getting this wrong silently disables
    the eligibility filter, which is the feature's entire value."""
    student = ss.build_student_profile(
        {"overall_gpa": 3.4, "degree_program": "BS Computer Science",
         "classification": "Junior", "minor": "Math"},
        {"name": "Test Student", "major": "Computer Science"},
    )
    assert student["gpa"] == 3.4
    assert student["major"] == "BS Computer Science"   # DegreeWorks beats the profile
    assert student["classification"] == "Junior"


def test_profile_handles_no_degreeworks():
    student = ss.build_student_profile(None, {"major": "Computer Science"})
    assert "gpa" not in student
    assert student["major"] == "Computer Science"


def test_profile_skips_empty_and_na_values():
    student = ss.build_student_profile(
        {"overall_gpa": None, "degree_program": "", "classification": "N/A"}, None
    )
    assert student == {}


def test_instruction_asks_for_missing_data():
    """With no DegreeWorks, the prompt must ask rather than invent an eligibility."""
    text = ss.build_instruction({}, ss.get_current_date())
    assert "No DegreeWorks data" in text
    assert "Ask for their GPA" in text


def test_instruction_carries_the_eligibility_filter():
    text = ss.build_instruction({"gpa": 3.2}, ss.get_current_date())
    assert "3.2" in text
    assert "SILENTLY" in text          # never explain why an award was skipped
    assert "NEVER show expired" in text


# --- JSON extraction ---------------------------------------------------------

def test_extracts_json_from_a_markdown_fence():
    assert ss._extract_json('```json\n{"items": []}\n```') == {"items": []}


def test_extracts_bare_json():
    assert ss._extract_json('{"items": [{"name": "X"}]}')["items"][0]["name"] == "X"


def test_extracts_json_surrounded_by_prose():
    """Models add "Here you go:" even when told not to."""
    assert ss._extract_json('Here you go:\n{"items": []}\nHope that helps!') == {"items": []}


@pytest.mark.parametrize("junk", ["", "no json here", "{broken", "[1, 2, 3]"])
def test_unparseable_output_returns_none(junk):
    assert ss._extract_json(junk) is None


# --- date helper -------------------------------------------------------------

def test_get_current_date_shape():
    today = ss.get_current_date()
    assert today["date"] == date.today().strftime("%Y-%m-%d")
    assert today["semester"].split()[0] in ("Spring", "Summer", "Fall")
    assert today["year"] == date.today().year
