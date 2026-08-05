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
from services.schedule_planner import parse_time_slots

FRESH_HOURS = 24


def _aware(dt: datetime) -> datetime:
    """Treat naive timestamps (SQLite) as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _section_sort_key(section: dict):
    return (
        0 if section.get("open_section") else 1,
        -(section.get("seats_available") or 0),
        section.get("section") or "",
    )


def _time_pref_score(section: dict, time_pref: str = "any") -> int:
    slots = parse_time_slots(section.get("time", ""))
    if not slots or time_pref == "any":
        return 0
    avg_start = sum(start for _, start, _ in slots) / len(slots)
    if time_pref == "morning" and avg_start < 720:
        return 5
    if time_pref == "afternoon" and 720 <= avg_start < 1020:
        return 5
    if time_pref == "evening" and avg_start >= 1020:
        return 5
    return 0


def _best_section(sections: list[dict], preferences: dict | None = None) -> dict:
    time_pref = (preferences or {}).get("time_pref", "any")
    return max(
        sections,
        key=lambda section: (
            1 if section.get("open_section") else 0,
            _time_pref_score(section, time_pref),
            section.get("seats_available") or 0,
            -(section.get("wait_available") or 0),
            section.get("section") or "",
        ),
    )


def _section_availability(section: dict) -> str:
    open_flag = section.get("open_section")
    if open_flag is True:
        return "open"
    if open_flag is False:
        wait_available = section.get("wait_available")
        wait_capacity = section.get("wait_capacity") or 0
        wait_count = section.get("wait_count") or 0
        if (
            (wait_available is not None and wait_available > 0)
            or (wait_capacity > 0 and wait_count < wait_capacity)
        ):
            return "waitlist"
        return "full"
    return "unknown"


def _public_section(section: dict) -> dict:
    return {
        "section": section.get("section", ""),
        "instructor": section.get("instructor", ""),
        "time": section.get("time", "TBA"),
        "room": section.get("room", "TBA"),
        "crn": section.get("crn"),
        "seats_available": section.get("seats_available"),
        "max_enrollment": section.get("max_enrollment"),
        "open_section": section.get("open_section"),
        "wait_count": section.get("wait_count"),
        "wait_capacity": section.get("wait_capacity"),
        "wait_available": section.get("wait_available"),
        "availability": _section_availability(section),
        "data_source": "live",
    }


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
            "wait_available": r.wait_available,
        })
    for sections in schedule.values():
        sections.sort(key=_section_sort_key)
    return schedule, newest


def get_live_sections_status(term: str) -> dict:
    """Return freshness metadata for a term without building the schedule payload."""
    db = SessionLocal()
    try:
        rows = (
            db.query(LiveSection.subject, LiveSection.fetched_at)
            .filter(LiveSection.term == term)
            .all()
        )
    finally:
        db.close()

    if not rows:
        return {
            "status": "static",
            "as_of": None,
            "fresh": False,
            "fresh_hours": FRESH_HOURS,
            "subject_count": 0,
        }

    fetched_times = [row.fetched_at for row in rows if row.fetched_at]
    if not fetched_times:
        return {
            "status": "static",
            "as_of": None,
            "fresh": False,
            "fresh_hours": FRESH_HOURS,
            "subject_count": len({row.subject for row in rows if row.subject}),
        }
    newest = _aware(max(fetched_times))
    fresh = datetime.now(timezone.utc) - newest <= timedelta(hours=FRESH_HOURS)
    return {
        "status": "live" if fresh else "stale",
        "as_of": newest.isoformat(),
        "fresh": fresh,
        "fresh_hours": FRESH_HOURS,
        "subject_count": len({row.subject for row in rows if row.subject}),
    }


def attach_live_section(course: dict, live_schedule: dict | None, preferences: dict | None = None) -> dict:
    """Return a copy of an untimed planner fill course with the best live section."""
    if not live_schedule or not course.get("untimed"):
        return course
    sections = live_schedule.get(course.get("code")) or []
    if not sections:
        return course

    section = _best_section(sections, preferences)
    section_options = [
        _public_section(item)
        for item in sorted(
            sections,
            key=lambda item: (
                0 if _section_availability(item) == "open" else 1 if _section_availability(item) == "waitlist" else 2,
                -_time_pref_score(item, (preferences or {}).get("time_pref", "any")),
                -(item.get("seats_available") or 0),
                item.get("section") or "",
            ),
        )
        if _section_availability(item) != "full"
    ][:8]
    return {
        **course,
        "untimed": False,
        "section": section.get("section", ""),
        "instructor": section.get("instructor", ""),
        "time": section.get("time", "TBA"),
        "room": section.get("room", "TBA"),
        "slots": [],
        "crn": section.get("crn"),
        "seats_available": section.get("seats_available"),
        "open_section": section.get("open_section"),
        "wait_count": section.get("wait_count"),
        "wait_capacity": section.get("wait_capacity"),
        "wait_available": section.get("wait_available"),
        "section_options": section_options,
    }


def live_alternative_status(alternative: dict, live_schedule: dict | None, preferences: dict | None = None) -> dict:
    """Annotate an advisory alternative with its best cached live section, if any."""
    if not live_schedule:
        return alternative
    sections = live_schedule.get(alternative.get("code")) or []
    if not sections:
        return alternative
    section = _best_section(sections, preferences)
    availability = _section_availability(section)
    section_options = [
        _public_section(item)
        for item in sorted(
            sections,
            key=lambda item: (
                0 if _section_availability(item) == "open" else 1 if _section_availability(item) == "waitlist" else 2,
                -_time_pref_score(item, (preferences or {}).get("time_pref", "any")),
                -(item.get("seats_available") or 0),
                item.get("section") or "",
            ),
        )
        if _section_availability(item) != "full"
    ][:8]
    return {
        **alternative,
        "section": section.get("section", ""),
        "instructor": section.get("instructor", ""),
        "time": section.get("time", "TBA"),
        "room": section.get("room", "TBA"),
        "crn": section.get("crn"),
        "seats_available": section.get("seats_available"),
        "wait_available": section.get("wait_available"),
        "availability": availability,
        "data_source": "live",
        "section_options": section_options,
    }


def best_live_requirement_course(courses: list[dict], live_schedule: dict | None, preferences: dict | None = None) -> dict | None:
    """Pick the best course from a same-requirement candidate list using live sections.

    This keeps GenEd defaults from always falling back to the lowest course number
    when Banner already tells us another approved option has a better open section.
    """
    if not courses:
        return None
    if not live_schedule:
        return courses[0]

    ranked = []
    time_pref = (preferences or {}).get("time_pref", "any")
    for index, course in enumerate(courses):
        code = course.get("code")
        sections = live_schedule.get(code) or []
        if not sections:
            ranked.append((3, 0, 0, index, course))
            continue
        best = _best_section(sections, preferences)
        availability = _section_availability(best)
        ranked.append((
            0 if availability == "open" else 1 if availability == "waitlist" else 2,
            -_time_pref_score(best, time_pref),
            -(best.get("seats_available") or 0),
            index,
            course,
        ))
    ranked.sort()
    return ranked[0][-1]
