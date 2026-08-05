"""Explanation metadata for Planner V2 schedule options."""

from __future__ import annotations

import json
from typing import Any

from .course_utils import normalize_course_code
from .schedule_planner import _parse_semester_key, has_conflict, parse_time_slots

MIN_PLANNER_SEMESTER = "fall_2026"

INTEREST_LABELS = {
    "ai": "AI / ML",
    "security": "Security",
    "data": "Data",
    "web": "Web / Mobile",
    "game": "Games",
    "systems": "Systems",
    "quantum": "Quantum",
    "cloud": "Cloud",
}

INTEREST_KEYWORDS = {
    "ai": ["artificial", "intelligence", "machine learning", "ml"],
    "security": ["security", "cyber", "crypto"],
    "data": ["data science", "data analytics", "data"],
    "web": ["web", "mobile"],
    "game": ["game"],
    "systems": ["operating", "network", "architecture", "systems"],
    "quantum": ["quantum"],
    "cloud": ["cloud"],
}


def future_planner_semesters(keys: list[str]) -> list[str]:
    """Return Planner V2 semesters from Fall 2026 forward."""
    floor = _parse_semester_key(MIN_PLANNER_SEMESTER)
    return sorted(
        [key for key in keys if _parse_semester_key(key) and _parse_semester_key(key) >= floor],
        key=_parse_semester_key,
    )


def normalize_course_set(raw: Any) -> set[str]:
    if not raw:
        return set()
    try:
        rows = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return set()
    if not isinstance(rows, list):
        return set()
    codes = set()
    for row in rows:
        if isinstance(row, str):
            code = normalize_course_code(row)
        elif isinstance(row, dict):
            code = normalize_course_code(
                row.get("code")
                or row.get("course_code")
                or f"{row.get('subject', '')} {row.get('number', '')}"
            )
        else:
            code = ""
        if code:
            codes.add(code)
    return codes


def prereqs_met_for_planner(node: dict | None, completed_codes: set[str], in_progress_codes: set[str]) -> bool:
    """Planner hard gate: every recommended course must have its course prereqs represented in DegreeWorks.

    In-progress prereqs are allowed for a future-term plan, but they still get a
    warning elsewhere. Missing prereqs are not allowed onto the schedule cards.
    """
    if not node:
        return True
    blocked_by = set(node.get("blocked_by") or [])
    if not blocked_by:
        return True
    satisfied = completed_codes | in_progress_codes
    if node.get("prereq_logic") == "any":
        return bool(blocked_by & satisfied)
    return blocked_by <= satisfied


def course_interest_matches(course: dict, interests: list[str]) -> list[str]:
    text = f"{course.get('code', '')} {course.get('name', '')}".lower()
    matches = []
    for interest in interests:
        if any(keyword in text for keyword in INTEREST_KEYWORDS.get(interest, [])):
            matches.append(INTEREST_LABELS.get(interest, interest.title()))
    return matches


def requirement_match(course: dict, interest_matches: list[str]) -> str:
    kind = course.get("kind")
    if kind == "gened":
        return "GenEd"
    if kind == "minor":
        return "Minor"
    category = course.get("category") or course.get("satisfies") or ""
    if category in {"Required", "Supporting", "Elective"}:
        return category
    if interest_matches:
        return "Interest fit"
    return category or "Elective"


def unlocks_text(unlocks: list[str]) -> str:
    if not unlocks:
        return ""
    first = ", ".join(unlocks[:3])
    suffix = f" and {len(unlocks) - 3} more" if len(unlocks) > 3 else ""
    return f"Helps unlock {first}{suffix}."


def course_reason(course: dict, match: str, interest_matches: list[str], unlock_text: str) -> str:
    if match == "GenEd":
        return f"Included because it can satisfy {course.get('category') or course.get('satisfies', 'an open GenEd requirement')}."
    if match == "Minor":
        return f"Included because it can count toward the {course.get('category') or course.get('satisfies', 'declared minor')}."
    if interest_matches:
        return f"Included because it matches your {', '.join(interest_matches)} interest and fits this schedule."
    if match == "Required":
        return "Included because it is an eligible required course in the CS sequence."
    if match == "Supporting":
        return "Included because it supports the CS degree requirements and fits the selected load."
    if unlock_text:
        return "Included because it keeps later prerequisite paths moving."
    return "Included because it fits your remaining requirements and this schedule option."


def risk_flags(
    course: dict,
    *,
    data_source: str,
    completed_codes: set[str],
    in_progress_codes: set[str],
    registered_codes: set[str],
    node: dict | None,
) -> list[dict]:
    flags = []
    code = normalize_course_code(course.get("code", ""))
    availability = course.get("availability")
    if course.get("untimed"):
        flags.append({
            "type": "pick_section",
            "severity": "warning",
            "message": "No live section is selected; pick the section, time, instructor, and seats in WEBSIS.",
        })
    elif str(course.get("time", "")).upper().startswith("TBA"):
        flags.append({
            "type": "tba_time",
            "severity": "warning",
            "message": "This section has a TBA time, so confirm it will not conflict.",
        })
    if data_source != "live" and not course.get("untimed"):
        flags.append({
            "type": "verify_seats",
            "severity": "warning",
            "message": "No live seat count is available for this section; verify open seats in Banner.",
        })
    if availability == "full":
        flags.append({
            "type": "full",
            "severity": "high",
            "message": "This section appears full; check Schedule Planner or Banner for an open section before relying on it.",
        })
    elif availability == "waitlist":
        flags.append({
            "type": "waitlist",
            "severity": "warning",
            "message": "This section may require a waitlist spot.",
        })
    blocked_by = set((node or {}).get("blocked_by") or [])
    if blocked_by & in_progress_codes:
        flags.append({
            "type": "in_progress_prereq",
            "severity": "warning",
            "message": "Eligibility depends on finishing an in-progress prerequisite successfully.",
        })
    if code in completed_codes:
        flags.append({
            "type": "completed_overlap",
            "severity": "high",
            "message": "DegreeWorks shows this course as completed; confirm before repeating it.",
        })
    if code in in_progress_codes:
        flags.append({
            "type": "in_progress_overlap",
            "severity": "high",
            "message": "DegreeWorks shows this course as in progress; confirm before adding it again.",
        })
    if code in registered_codes:
        flags.append({
            "type": "registered_overlap",
            "severity": "high",
            "message": "Banner already shows this course in your registration for this term.",
        })
    return flags


def requirement_alternative_map(requirements: dict) -> dict[str, list[dict]]:
    mapping = {}
    for area in (requirements or {}).get("gened") or []:
        primary = area.get("primary") or {}
        alternatives = [
            {
                "code": alt.get("code"),
                "name": alt.get("name"),
                "reason": f"Also satisfies GenEd: {area.get('name', '')}.",
                "tradeoff": "Same GenEd area; compare section time and seats before choosing it.",
            }
            for alt in area.get("alternatives") or []
            if alt.get("code")
        ]
        if primary.get("code"):
            mapping[normalize_course_code(primary["code"])] = alternatives[:3]
    minor = (requirements or {}).get("minor") or {}
    minor_options = [
        {
            "code": row.get("code"),
            "name": row.get("name"),
            "reason": f"Also counts toward the {minor.get('name', 'minor')} requirement.",
            "tradeoff": "Same remaining minor list; compare availability and topic fit before choosing it.",
        }
        for row in minor.get("remaining") or []
        if row.get("code")
    ]
    for row in minor.get("remaining") or []:
        code = normalize_course_code(row.get("code", ""))
        if code:
            mapping[code] = [alt for alt in minor_options if normalize_course_code(alt["code"]) != code][:3]
    return mapping


def cs_alternatives(
    course: dict,
    *,
    selected_courses: list[dict],
    eligible: list[dict],
    schedules: dict,
    semester_key: str,
    option_total: int,
    option_limit: int,
) -> list[dict]:
    selected_codes = {normalize_course_code(c.get("code", "")) for c in selected_courses}
    selected_other_slots = [
        c.get("slots") or parse_time_slots(c.get("time", ""))
        for c in selected_courses
        if normalize_course_code(c.get("code", "")) != normalize_course_code(course.get("code", ""))
    ]
    course_credits = int(course.get("credits") or 0)
    sem_schedule = schedules.get(semester_key, {})
    alternatives = []
    for candidate in eligible:
        code = normalize_course_code(candidate.get("id", ""))
        if not code or code in selected_codes:
            continue
        credits = int(candidate.get("credits") or 0)
        if option_total - course_credits + credits > option_limit:
            continue
        sections = sem_schedule.get(code, [])
        if not sections:
            continue
        conflict_free = False
        for section in sections:
            slots = parse_time_slots(section.get("time", ""))
            if not any(has_conflict(slots, other_slots) for other_slots in selected_other_slots):
                conflict_free = True
                break
        if not conflict_free:
            continue
        alternatives.append({
            "code": code,
            "name": candidate.get("name", ""),
            "reason": "Eligible same-semester course that appears to fit this plan.",
            "tradeoff": "Confirm prerequisites, seats, and whether this swap still supports your degree sequence.",
        })
        if len(alternatives) >= 2:
            break
    return alternatives


def plan_explanation(option: dict, *, interests: list[str], data_source: str) -> dict:
    label = option.get("label", "Plan")
    credits = option.get("total_credits", 0)
    if "Lighter" in label:
        summary = "Keeps the semester lighter while still moving requirements forward."
        tradeoffs = "Lower credit load may be easier to manage, but it can leave more credits for a later semester."
    elif "Heavier" in label:
        summary = "Uses a heavier credit load to make faster progress."
        tradeoffs = "More credits can accelerate progress, but workload and schedule pressure are higher."
    else:
        summary = "Balances progress with a standard full-time course load."
        tradeoffs = "This is the middle path: enough credits to progress without maxing out the load."
    matched = sorted({
        label
        for course in option.get("courses", [])
        for label in course_interest_matches(course, interests)
    })
    interest_fit = (
        f"Supports selected interests: {', '.join(matched)}."
        if matched else
        "No selected interest strongly matched these course titles; this option prioritizes requirements."
    )
    warnings = []
    for course in option.get("courses", []):
        for flag in course.get("risk_flags", []):
            warnings.append(f"{course.get('code')}: {flag.get('message')}")
    warnings = list(dict.fromkeys(warnings))
    return {
        "summary_reason": f"{summary} Total load: {credits} credits.",
        "tradeoffs": tradeoffs,
        "interest_fit": interest_fit,
        "advisor_status": "needs_verification" if warnings else "ready",
        "advisor_warnings": warnings,
    }
