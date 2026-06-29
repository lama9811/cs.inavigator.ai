"""Unit tests for the Canvas deadline reminder selection logic.

The core `select_due_reminders` is pure (operates on plain dicts), so these
tests need no database or network.
"""
from datetime import datetime, timedelta, timezone

from services.reminder_engine import select_due_reminders, reminder_key, parse_due_utc


NOW = datetime(2026, 6, 29, 12, 0, 0, tzinfo=timezone.utc)


def _due(hours):
    """ISO8601 UTC string `hours` from NOW (negative = past)."""
    return (NOW + timedelta(hours=hours)).isoformat()


def _assignments():
    return [
        {"id": 1, "title": "A in window 12h", "course_id": 101, "due_at": _due(12), "submitted": False},
        {"id": 2, "title": "B in window 23h", "course_id": 101, "due_at": _due(23), "submitted": False},
        {"id": 3, "title": "C too far 30h", "course_id": 101, "due_at": _due(30), "submitted": False},
        {"id": 4, "title": "D submitted", "course_id": 101, "due_at": _due(12), "submitted": True},
        {"id": 5, "title": "E no due date", "course_id": 101, "due_at": None, "submitted": False},
        {"id": 6, "title": "F class not enabled", "course_id": 202, "due_at": _due(12), "submitted": False},
        {"id": 7, "title": "G already sent", "course_id": 101, "due_at": _due(12), "submitted": False},
        {"id": 8, "title": "H already past", "course_id": 101, "due_at": _due(-2), "submitted": False},
    ]


def test_selects_only_in_window_unsent_unsubmitted_enabled():
    asns = _assignments()
    enabled = {"101"}
    sent = {reminder_key(101, asns[6])}  # G already sent

    selected = select_due_reminders(asns, enabled, sent, NOW)
    titles = {s["assignment"]["title"] for s in selected}

    assert titles == {"A in window 12h", "B in window 23h"}


def test_each_selection_carries_its_dedup_key():
    asns = _assignments()
    selected = select_due_reminders(asns, {"101"}, set(), NOW)
    for s in selected:
        assert s["key"] == reminder_key(s["assignment"]["course_id"], s["assignment"])
        assert s["key"]  # non-empty


def test_disabled_course_yields_nothing():
    assert select_due_reminders(_assignments(), set(), set(), NOW) == []


def test_window_boundary_is_inclusive_at_24h_exclusive_at_now():
    asns = [
        {"id": 10, "title": "exactly 24h", "course_id": 101, "due_at": _due(24), "submitted": False},
        {"id": 11, "title": "exactly now", "course_id": 101, "due_at": _due(0), "submitted": False},
    ]
    selected = select_due_reminders(asns, {"101"}, set(), NOW)
    titles = {s["assignment"]["title"] for s in selected}
    assert titles == {"exactly 24h"}  # 24h in, now out (already due)


def test_reminder_key_changes_when_due_date_moves():
    asn = {"id": 1, "title": "X", "course_id": 101, "due_at": _due(12)}
    moved = {"id": 1, "title": "X", "course_id": 101, "due_at": _due(20)}
    assert reminder_key(101, asn) != reminder_key(101, moved)


def test_reminder_key_falls_back_to_title_without_id():
    asn = {"title": "No id assignment", "course_id": 101, "due_at": _due(12)}
    key = reminder_key(101, asn)
    assert "No id assignment" in key


def test_parse_due_utc_handles_z_suffix_and_offsets():
    assert parse_due_utc("2026-06-29T12:00:00Z") == NOW
    assert parse_due_utc("2026-06-29T12:00:00+00:00") == NOW
    assert parse_due_utc(None) is None
    assert parse_due_utc("not a date") is None
