# backend/banner_scraper/class_search.py
"""
Public Banner "Browse Classes" client for Morgan State University.

Unlike `client.py` (which logs in *as a student* via CAS to read private
DegreeWorks/grades), class search is a **public** feature — no login required.
This module fetches the live section list, including real-time seat and waitlist
counts, for a subject + term.

Confirmed against the live portal (lbssb1nprod.morgan.edu) on 2026-07-02:
- Handshake:  GET  /StudentRegistrationSsb/ssb/classSearch/classSearch  (session cookie)
              POST /StudentRegistrationSsb/ssb/term/search?mode=search   (arm the term)
              GET  /StudentRegistrationSsb/ssb/searchResults/searchResults?...
- Term codes must be resolved via getTerms, NOT guessed (Fall 2026 = 202670).

Everything here is read-only. `parse_section` is a pure function so it can be
unit-tested against a captured fixture with no network.
"""

import os
import re
import time as _time
import random
import string
import json
from pathlib import Path
import httpx

BANNER_SSB_BASE = os.getenv("BANNER_SSB_BASE", "https://lbssb1nprod.morgan.edu")
_REG = f"{BANNER_SSB_BASE}/StudentRegistrationSsb/ssb"
_DATA_DIR = Path(__file__).resolve().parent.parent / "data_sources"

# Subjects the CS planner cares about.
CS_SUBJECTS = ["COSC", "BIOI", "CLCO"]
MIN_PLANNER_SEMESTER = "fall_2026"

_HTTP_TIMEOUT = httpx.Timeout(30.0)
_USER_AGENT = "cs-navigator-planner/1.0 (+https://cs.inavigator.ai)"
_TERM_ORDER = {"spring": 0, "summer": 1, "fall": 2}

# Banner boolean day flag -> single-letter code the schedule engine understands
# (parse_time_slots reads [MTWRF]; Sat/Sun are rare but carried through).
_DAY_FLAGS = [
    ("monday", "M"), ("tuesday", "T"), ("wednesday", "W"),
    ("thursday", "R"), ("friday", "F"), ("saturday", "S"), ("sunday", "U"),
]


# ---------------------------------------------------------------------------
# Pure parsing helpers (no network — unit-tested against a fixture)
# ---------------------------------------------------------------------------

def _fmt_time(hhmm) -> str | None:
    """Banner 24h 'HHMM' string -> '1:00PM' (the format parse_time_slots reads).

    Returns None for missing/blank times (online/TBA sections)."""
    if not hhmm:
        return None
    s = str(hhmm).strip()
    if not re.fullmatch(r"\d{3,4}", s):
        return None
    s = s.zfill(4)
    h, m = int(s[:2]), int(s[2:])
    period = "AM" if h < 12 else "PM"
    h12 = h % 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{m:02d}{period}"


def _days_str(mt: dict) -> str:
    """Boolean day flags in a meetingTime -> 'MWF'."""
    return "".join(code for key, code in _DAY_FLAGS if mt.get(key))


def _clean_text(value, default: str = "") -> str:
    """Collapse Banner whitespace and keep missing values predictable."""
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text or default


def _valid_section(section: dict) -> bool:
    """A parsed row needs a CRN and course code before it can be stored."""
    return bool(_clean_text(section.get("crn")) and _clean_text(section.get("course_code")))


def _subject_from_code(code: str) -> str:
    match = re.match(r"^([A-Z]{2,4})\s+\d{3}$", _clean_text(code).upper())
    return match.group(1) if match else ""


def gened_candidate_subjects(gened_path: Path | None = None) -> list[str]:
    """Subjects represented by GenEd courses CS Navigator may recommend."""
    path = gened_path or (_DATA_DIR / "gened.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    subjects = set()
    for area in data.get("areas") or []:
        for key in ("courses", "also_satisfied_by", "language_courses"):
            for course in area.get(key) or []:
                subject = _subject_from_code(course.get("code", ""))
                if subject:
                    subjects.add(subject)
    return sorted(subjects)


def refresh_subjects(subjects: str | list[str] | None = None, include_geneds: bool = True) -> list[str]:
    """Subjects the scheduled refresh should pull, with optional admin override."""
    if isinstance(subjects, str) and subjects.strip():
        raw = re.split(r"[\s,]+", subjects)
        base = [item.strip().upper() for item in raw if item.strip()]
    elif isinstance(subjects, list) and subjects:
        base = [str(item).strip().upper() for item in subjects if str(item).strip()]
    else:
        base = list(CS_SUBJECTS)
        if include_geneds:
            base.extend(gened_candidate_subjects())

    seen = set()
    clean = []
    for subject in base:
        if re.fullmatch(r"[A-Z]{2,4}", subject) and subject not in seen:
            seen.add(subject)
            clean.append(subject)
    return clean


def _meeting_time_string(meetings: list) -> tuple[str, str]:
    """Combine a section's meetingsFaculty into a schedule-engine time string
    ('MWF 12:00PM-12:50PM' or 'MWF 12:00PM-12:50PM, T 1:00PM-1:50PM') and pick a
    representative room. Returns ('TBA', 'TBA') when no timed meeting exists."""
    parts = []
    room = None
    for mf in meetings or []:
        mt = mf.get("meetingTime") or {}
        begin = _fmt_time(mt.get("beginTime"))
        end = _fmt_time(mt.get("endTime"))
        days = _days_str(mt)
        if begin and end and days:
            parts.append(f"{days} {begin}-{end}")
        if room is None:
            bldg = _clean_text(mt.get("building"))
            rm = _clean_text(mt.get("room"))
            if rm and bldg and bldg.upper() not in ("TBD", "TBA", "ONLINE"):
                room = f"{bldg}-{rm}"
            elif rm:
                room = rm
    return (", ".join(parts) if parts else "TBA", room or "TBA")


def _instructor(faculty: list) -> str:
    """Primary instructor display name, else first, else 'TBA'."""
    fac = faculty or []
    if not fac:
        return "TBA"
    primary = next((f for f in fac if f.get("primaryIndicator")), fac[0])
    return _clean_text(primary.get("displayName"), "TBA")


def _course_code(subject: str, course_number: str) -> str:
    """'COSC' + '110' -> 'COSC 110' (matches the planner's normalized keys)."""
    return f"{_clean_text(subject)} {_clean_text(course_number)}".strip()


def _to_int(v, default=0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def parse_section(raw: dict, sem_key: str) -> dict:
    """Normalize one raw Banner searchResults row into the canonical shape the
    planner consumes (same keys as a static schedule section, PLUS seat fields).

    Pure function: no network, no DB. `sem_key` is our term key, e.g. 'fall_2026'."""
    subject = _clean_text(raw.get("subject"))
    course_number = _clean_text(raw.get("courseNumber"))
    time_str, room = _meeting_time_string(raw.get("meetingsFaculty"))
    seats = _to_int(raw.get("seatsAvailable"))
    credits = raw.get("creditHours")
    if credits is None:
        credits = raw.get("creditHourLow")
    return {
        "term": sem_key,
        "crn": _clean_text(raw.get("courseReferenceNumber")),
        "subject": subject,
        "course_number": course_number,
        "course_code": _course_code(subject, course_number),
        "title": _clean_text(raw.get("courseTitle")),
        "credits": _to_int(credits),
        "section": _clean_text(raw.get("sequenceNumber")),
        "instructor": _instructor(raw.get("faculty")),
        "campus": _clean_text(raw.get("campusDescription")),
        "schedule_type": _clean_text(raw.get("scheduleTypeDescription")),
        # Fields the schedule engine already reads:
        "time": time_str,
        "room": room,
        # Live availability (the whole point):
        "seats_available": seats,
        "max_enrollment": _to_int(raw.get("maximumEnrollment")),
        "enrollment": _to_int(raw.get("enrollment")),
        "open_section": bool(raw.get("openSection")) if raw.get("openSection") is not None else seats > 0,
        "wait_count": _to_int(raw.get("waitCount")),
        "wait_capacity": _to_int(raw.get("waitCapacity")),
        "wait_available": _to_int(raw.get("waitAvailable")),
    }


def human_term(sem_key: str) -> str:
    """'fall_2026' -> 'Fall 2026'."""
    m = re.match(r"(spring|summer|fall|winter)_(\d{4})", (sem_key or "").lower())
    if not m:
        return sem_key
    return f"{m.group(1).capitalize()} {m.group(2)}"


def sem_key_from_description(desc: str) -> str | None:
    """'Fall 2026 (View Only)' -> 'fall_2026'."""
    m = re.search(r"(Spring|Summer|Fall|Winter)\s+(?:\w+\s+)*(\d{4})", desc or "")
    if not m:
        return None
    return f"{m.group(1).lower()}_{m.group(2)}"


def _parse_planner_term_key(sem_key: str):
    """Chronological sort key for planner-supported Banner terms."""
    m = re.match(r"^(spring|summer|fall)_(20\d{2})$", (sem_key or "").lower())
    if not m:
        return None
    return (int(m.group(2)), _TERM_ORDER[m.group(1)])


def normalize_banner_terms(
    terms: list[dict],
    min_sem_key: str = MIN_PLANNER_SEMESTER,
) -> list[dict]:
    """Normalize Banner getTerms rows into planner-visible term metadata."""
    floor = _parse_planner_term_key(min_sem_key)
    seen: set[str] = set()
    normalized = []
    for item in terms or []:
        code = str(item.get("code") or "").strip()
        description = _clean_text(item.get("description"))
        sem_key = sem_key_from_description(description)
        sort_key = _parse_planner_term_key(sem_key or "")
        if not code or not sem_key or not sort_key:
            continue
        if floor and sort_key < floor:
            continue
        if sem_key in seen:
            continue
        seen.add(sem_key)
        normalized.append({
            "term": sem_key,
            "sem_key": sem_key,
            "term_code": code,
            "description": description,
            "view_only": "view only" in description.lower(),
            "source": "banner",
        })
    return sorted(normalized, key=lambda row: _parse_planner_term_key(row["sem_key"]))


def _unique_session_id() -> str:
    """Mimic Banner's client-side uniqueSessionId (5 alnum + epoch ms)."""
    prefix = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
    return f"{prefix}{int(_time.time() * 1000)}"


# ---------------------------------------------------------------------------
# Network calls (async, public — no auth)
# ---------------------------------------------------------------------------

def _new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=_HTTP_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": _USER_AGENT},
    )


async def fetch_terms(max_terms: int = 20) -> list[dict]:
    """Return Banner's term list: [{'code': '202670', 'description': 'Fall 2026'}, ...],
    soonest first. Public GET, no session needed."""
    async with _new_client() as client:
        resp = await client.get(
            f"{_REG}/classSearch/getTerms",
            params={"searchTerm": "", "offset": 1, "max": max_terms},
        )
        resp.raise_for_status()
        data = resp.json()
    return [{"code": str(t.get("code")), "description": t.get("description", "")}
            for t in (data or []) if t.get("code")]


async def discover_planner_terms(
    max_terms: int = 30,
    min_sem_key: str = MIN_PLANNER_SEMESTER,
) -> list[dict]:
    """Return future Banner terms that Planner may surface."""
    return normalize_banner_terms(await fetch_terms(max_terms=max_terms), min_sem_key=min_sem_key)


async def resolve_active_term() -> tuple[str, str] | None:
    """Pick the soonest registerable (not 'View Only') term.

    Returns (banner_code, sem_key) e.g. ('202670', 'fall_2026'), or None."""
    terms = await fetch_terms()
    for t in terms:
        if "view only" in (t["description"] or "").lower():
            continue
        sk = sem_key_from_description(t["description"])
        if sk:
            return (t["code"], sk)
    return None


async def resolve_term_code(sem_key: str) -> str | None:
    """Map our 'fall_2026' to Banner's numeric code by matching getTerms.

    Never hardcodes — the spike proved Fall 2026 is 202670, not the guessable 202608."""
    want = human_term(sem_key).lower()
    for t in await fetch_terms():
        if (t["description"] or "").lower().startswith(want):
            return t["code"]
    return None


async def fetch_sections(subject: str, term_code: str, sem_key: str) -> list[dict]:
    """Fetch + parse every section for one subject in one term.

    Does the confirmed 3-step handshake in a single session, pages through all
    results, and returns canonical section dicts. Raises on transport/HTTP errors
    or a non-success payload so the caller can isolate a failed subject."""
    parsed_by_crn: dict[str, dict] = {}
    usid = _unique_session_id()
    async with _new_client() as client:
        # 1. Establish the session cookie.
        await client.get(f"{_REG}/classSearch/classSearch")
        # 2. Arm the term for this session (required before searchResults works).
        await client.post(
            f"{_REG}/term/search",
            params={"mode": "search"},
            data={"term": term_code, "uniqueSessionId": usid},
        )
        # 3. Page through the results.
        page_size = 500
        offset = 0
        total = None
        while True:
            resp = await client.get(
                f"{_REG}/searchResults/searchResults",
                params={
                    "txt_subject": subject,
                    "txt_term": term_code,
                    "startDatepicker": "",
                    "endDatepicker": "",
                    "uniqueSessionId": usid,
                    "pageOffset": offset,
                    "pageMaxSize": page_size,
                    "sortColumn": "subjectDescription",
                    "sortDirection": "asc",
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            if not payload or payload.get("success") is False:
                raise RuntimeError(f"Banner searchResults returned no success for {subject} {term_code}")
            rows = payload.get("data") or []
            for row in rows:
                section = parse_section(row, sem_key)
                if _valid_section(section):
                    parsed_by_crn.setdefault(section["crn"], section)
            total = payload.get("totalCount", len(rows)) if total is None else total
            offset += len(rows)
            if not rows or offset >= (total or 0):
                break
    return list(parsed_by_crn.values())
