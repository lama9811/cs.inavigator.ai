"""Read side of the live class-availability pipeline.

`get_live_sections(term)` returns the newest Banner snapshot for a term in the
exact `{course_code: [section...]}` shape the planner already consumes — plus
seat fields on each section — so `generate_schedule_options` works unchanged.

Returns (None, None) when there are no rows or the newest snapshot is stale
(> FRESH_HOURS old), which is the planner's cue to fall back to the static
`schedule_<term>.json` snapshots and label the response accordingly.
"""
from datetime import datetime, timezone, timedelta

from db import SessionLocal
from models import LiveSection

FRESH_HOURS = 24


def _aware(dt: datetime) -> datetime:
    """Treat naive timestamps (SQLite) as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def get_live_sections(term: str):
    """Return (schedule_dict, fetched_at) for `term`, or (None, None).

    schedule_dict: { "COSC 320": [ {section, instructor, time, room, crn,
    seats_available, max_enrollment, open_section, wait_count, wait_capacity}, ... ] }
    """
    db = SessionLocal()
    try:
        rows = db.query(LiveSection).filter(LiveSection.term == term).all()
    finally:
        db.close()

    if not rows:
        return None, None

    newest = _aware(max(r.fetched_at for r in rows))
    if datetime.now(timezone.utc) - newest > timedelta(hours=FRESH_HOURS):
        return None, None  # stale -> caller falls back to static

    schedule: dict[str, list] = {}
    for r in rows:
        schedule.setdefault(r.course_code, []).append({
            "section": r.section or "",
            "instructor": r.instructor or "TBA",
            "time": r.meeting_time or "TBA",
            "room": r.room or "TBA",
            "crn": r.crn,
            "seats_available": r.seats_available,
            "max_enrollment": r.max_enrollment,
            "open_section": r.open_section,
            "wait_count": r.wait_count,
            "wait_capacity": r.wait_capacity,
        })
    return schedule, newest
