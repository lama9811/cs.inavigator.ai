"""
Canvas Deadline Reminder Engine
================================
Pure selection logic for per-class assignment deadline reminders.

The student opts a class IN (see ReminderSubscription); an hourly dispatch job
then emails them ~24 hours before each assignment in that class is due. We never
re-fetch from Canvas (the MSU password is never stored) — reminders are computed
entirely from the `upcoming_assignments` snapshot saved at the student's last sync.

`select_due_reminders` is deliberately pure (plain dicts in, plain dicts out) so it
is trivially unit-testable without a DB. The DB-aware wrapper lives in main.py.
"""

from datetime import datetime, timedelta, timezone

DEFAULT_WINDOW_HOURS = 24

# Canvas submission workflow states that mean "the student already turned it in".
_SUBMITTED_STATES = {"submitted", "graded", "pending_review", "complete"}


def parse_due_utc(due_at) -> datetime | None:
    """Parse a Canvas ISO8601 due date into a timezone-aware UTC datetime.

    Accepts a trailing 'Z' or an explicit offset. Returns None for missing or
    unparseable values (those assignments are simply skipped)."""
    if not due_at or not isinstance(due_at, str):
        return None
    raw = due_at.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def reminder_key(course_id, asn: dict) -> str:
    """Stable per-assignment dedup key.

    Uses the Canvas assignment id when present, else the title. The due date is
    part of the key on purpose: if a professor moves a deadline and the student
    re-syncs, the key changes and one fresh reminder is sent for the new time."""
    aid = asn.get("id") or asn.get("assignment_id") or asn.get("title") or "?"
    return f"{course_id}:{aid}:{asn.get('due_at')}"


def _is_submitted(asn: dict) -> bool:
    """True if the assignment is already turned in (don't remind)."""
    if asn.get("submitted") is True:
        return True
    sub = asn.get("submission")
    if isinstance(sub, dict):
        if sub.get("submitted_at"):
            return True
        if sub.get("workflow_state") in _SUBMITTED_STATES:
            return True
    return False


def select_due_reminders(
    assignments,
    enabled_course_ids,
    sent_keys,
    now: datetime,
    window_hours: int = DEFAULT_WINDOW_HOURS,
):
    """Pick assignments that should trigger a reminder email right now.

    An assignment qualifies when ALL hold:
      - its course is opted-in (str(course_id) in `enabled_course_ids`),
      - it has a parseable due date with now < due_at <= now + window_hours,
      - it is not already submitted,
      - no reminder has been sent for it yet (key not in `sent_keys`).

    Args:
        assignments: list of dicts from CanvasStudentData.upcoming_assignments.
        enabled_course_ids: set/iterable of opted-in course ids (compared as str).
        sent_keys: set of already-sent reminder keys.
        now: timezone-aware UTC "current time".
        window_hours: lead time before the deadline (default 24h).

    Returns:
        list of {"assignment": <dict>, "key": <str>} for qualifying assignments.
    """
    enabled = {str(c) for c in enabled_course_ids}
    sent = set(sent_keys)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    cutoff = now + timedelta(hours=window_hours)

    selected = []
    for asn in assignments:
        course_id = asn.get("course_id")
        if course_id is None or str(course_id) not in enabled:
            continue
        due = parse_due_utc(asn.get("due_at"))
        if due is None or not (now < due <= cutoff):
            continue
        if _is_submitted(asn):
            continue
        key = reminder_key(course_id, asn)
        if key in sent:
            continue
        selected.append({"assignment": asn, "key": key})

    return selected
