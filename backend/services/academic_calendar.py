"""Morgan academic calendar deadline extraction for Planner reminders."""

from __future__ import annotations

import re
import time
from datetime import date
from typing import Any

import requests

OFFICIAL_ACADEMIC_CALENDAR_URL = "https://www.morgan.edu/academic-calendar"

OFFICIAL_CALENDAR_DOCS: dict[str, dict[str, str]] = {
    "2025-2026": {
        "label": "Fall 2025 - Summer 2026",
        "url": "https://docs.google.com/document/d/12czwe1xFu7n9I2r-NeuvvtdV-EmtiKGNi3O9l2-tcnQ/edit?tab=t.0",
        "export_url": "https://docs.google.com/document/d/12czwe1xFu7n9I2r-NeuvvtdV-EmtiKGNi3O9l2-tcnQ/export?format=txt",
    },
    "2026-2027": {
        "label": "Fall 2026 - Summer 2027",
        "url": "https://docs.google.com/document/d/1KJSXV4I4JsMbGiPxRHTaLk22TpKZfOM4i66QjoEpXKQ/edit?tab=t.0",
        "export_url": "https://docs.google.com/document/d/1KJSXV4I4JsMbGiPxRHTaLk22TpKZfOM4i66QjoEpXKQ/export?format=txt",
    },
}

DEADLINE_PATTERNS: dict[str, re.Pattern[str]] = {
    "add_drop": re.compile(
        r"Last\s+Day\s+to\s+Add/Drop(?:\s+a\s+Course)?(?:\s*/\s*Cancel\s+for\s+the\s+Semester)?\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)",
        re.IGNORECASE,
    ),
    "withdraw": re.compile(
        r"Last\s+Day\s+to\s+Withdraw\s+from\s+an?\s+Individual\s+Course\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)",
        re.IGNORECASE,
    ),
}

_CACHE_TTL_SECONDS = 6 * 60 * 60
_TEXT_CACHE: dict[str, tuple[float, str]] = {}


def academic_year_for_semester(key: str | None) -> str | None:
    match = re.match(r"^(fall|winter|spring|summer)_(20\d{2})$", str(key or ""))
    if not match:
        return None
    season, year_text = match.groups()
    year = int(year_text)
    start_year = year if season == "fall" else year - 1
    return f"{start_year}-{start_year + 1}"


def calendar_source_for_semester(key: str | None) -> dict[str, Any]:
    academic_year = academic_year_for_semester(key)
    source = OFFICIAL_CALENDAR_DOCS.get(academic_year or "")
    if source:
        return {**source, "academic_year": academic_year, "fallback": False}
    return {
        "label": "Morgan academic calendar",
        "url": OFFICIAL_ACADEMIC_CALENDAR_URL,
        "academic_year": academic_year,
        "fallback": True,
    }


def _term_heading(key: str) -> str | None:
    match = re.match(r"^(fall|winter|spring|summer)_(20\d{2})$", str(key or ""))
    if not match:
        return None
    return f"{match.group(1).title()} {match.group(2)}"


def _section_for_term(text: str, semester_key: str) -> str:
    heading = _term_heading(semester_key)
    if not heading:
        return ""
    start = re.search(rf"^\s*{re.escape(heading)}\s*$", text, re.IGNORECASE | re.MULTILINE)
    if not start:
        return ""
    next_heading = re.search(
        r"^\s*(Fall|Winter|Spring|Summer)\s+20\d{2}\s*$",
        text[start.end():],
        re.IGNORECASE | re.MULTILINE,
    )
    end = start.end() + next_heading.start() if next_heading else len(text)
    return text[start.end():end]


def _iso_date(month_day: str, semester_key: str) -> str | None:
    match = re.match(r"^(fall|winter|spring|summer)_(20\d{2})$", semester_key)
    if not match:
        return None
    year = int(match.group(2))
    month_match = re.match(r"^([A-Z][a-z]+)\s+(\d{1,2})", month_day.strip())
    if not month_match:
        return None
    month_name, day_text = month_match.groups()
    month = {
        "January": 1,
        "February": 2,
        "March": 3,
        "April": 4,
        "May": 5,
        "June": 6,
        "July": 7,
        "August": 8,
        "September": 9,
        "October": 10,
        "November": 11,
        "December": 12,
    }.get(month_name)
    if not month:
        return None
    try:
        return date(year, month, int(day_text)).isoformat()
    except ValueError:
        return None


def parse_calendar_deadlines(text: str, semester_key: str) -> dict[str, dict[str, str]]:
    section = _section_for_term(text, semester_key)
    if not section:
        return {}
    deadlines = {}
    for key, pattern in DEADLINE_PATTERNS.items():
        match = pattern.search(section)
        if not match:
            continue
        date_text = match.group(1)
        iso = _iso_date(date_text, semester_key)
        if not iso:
            continue
        deadlines[key] = {
            "date": iso,
            "source_text": re.sub(r"\s+", " ", match.group(0)).strip(),
        }
    return deadlines


def _fetch_calendar_text(source: dict[str, Any]) -> str:
    export_url = source.get("export_url")
    if not export_url:
        return ""
    cached = _TEXT_CACHE.get(export_url)
    now = time.time()
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]
    response = requests.get(
        export_url,
        headers={"User-Agent": "cs-navigator-planner/1.0 (+https://cs.inavigator.ai)"},
        timeout=12,
    )
    response.raise_for_status()
    text = response.text.replace("\ufeff", "")
    _TEXT_CACHE[export_url] = (now, text)
    return text


def get_calendar_deadlines(semester_key: str | None) -> dict[str, Any]:
    source = calendar_source_for_semester(semester_key)
    source_payload = {k: v for k, v in source.items() if k != "export_url"}
    if source.get("fallback"):
        return {
            "semester": semester_key,
            "source": source_payload,
            "deadlines": {},
            "status": "source_unavailable",
            "message": "A direct official calendar document is not available for this semester yet.",
        }
    try:
        text = _fetch_calendar_text(source)
        deadlines = parse_calendar_deadlines(text, str(semester_key or ""))
        return {
            "semester": semester_key,
            "source": source_payload,
            "deadlines": deadlines,
            "status": "ok" if deadlines else "no_matching_deadlines",
            "message": "" if deadlines else "The official calendar was found, but these reminder dates were not listed in the expected format.",
        }
    except requests.RequestException as exc:
        return {
            "semester": semester_key,
            "source": source_payload,
            "deadlines": {},
            "status": "fetch_failed",
            "message": f"Could not read the official calendar document right now: {exc.__class__.__name__}",
        }
