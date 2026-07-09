"""
Requirement Planner
===================
GenEd + minor requirement recommendations for the schedule planner.

The schedule planner can only build a *timed* schedule for courses it has
class-time data for (COSC/CLCO/BIOI). GenEd and minor courses have no time-slot
data, so we can't place them in a conflict-free schedule. Instead we tell the
student which GenEd areas / minor requirements are still OPEN and which specific
courses satisfy each — a "also register for these" companion to the timed CS
schedule. Times must be confirmed in WEBSIS.

Reads backend/data_sources/gened.json and minors.json (the same verified data the
frontend renders). No LLM calls.
"""

import json
import os
import re

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data_sources")


def _normalize(code: str) -> str:
    """'cosc111' / 'COSC  111' -> 'COSC 111'."""
    s = str(code or "").strip().upper()
    s = re.sub(r"\s+", " ", s)
    return re.sub(r"^([A-Z]{2,5})\s*(\d.*)$", r"\1 \2", s)


def _course_number(code: str) -> int:
    """Numeric part of a course code (COSC 349 -> 349), for intro-first ordering."""
    m = re.search(r"\d{3}", str(code or ""))
    return int(m.group()) if m else 999


# --- Load GenEd + minor data once (static, doesn't change at runtime) ---
def _load(name: str) -> dict:
    path = os.path.join(_DATA_DIR, name)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[REQ_PLANNER] Failed to load {name}: {e}")
        return {}


_GENED = _load("gened.json")
_MINORS = _load("minors.json")


def _completed_codes(dw_dict: dict) -> set:
    """Normalized set of the student's completed + in-progress course codes."""
    codes = set()
    for key in ("courses_completed", "courses_in_progress"):
        raw = dw_dict.get(key) if dw_dict else None
        if not raw:
            continue
        try:
            courses = json.loads(raw) if isinstance(raw, str) else raw
            for c in courses:
                code = _normalize(c.get("code", "") or c.get("course_code", ""))
                if code:
                    codes.add(code)
        except Exception:
            pass
    return codes


def _degreeworks_gened_pct(dw_dict: dict) -> dict:
    """The DegreeWorks-computed {area_code: percent} map, if the sync captured it.
    This is the authoritative signal — it already accounts for transfer credits,
    cross-counts, and proficiency credit. Empty dict when unavailable."""
    raw = dw_dict.get("gened_areas") if dw_dict else None
    if not raw:
        return {}
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        return {k: int(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except Exception:
        return {}


def gened_status(dw_dict: dict, sample: int = 4) -> list[dict]:
    """Which GenEd areas are still open, and a few courses that would satisfy each.

    Source of truth is DegreeWorks' own per-area completion % (which already accounts
    for transfer credits, cross-counts like MATH 241 -> MQ, and proficiency credit).
    An area is open when its DegreeWorks % is below 100. Only when DegreeWorks didn't
    give us that signal do we FALL BACK to matching the student's course codes against
    the area's course list.

    Returns a list of the OPEN area dicts."""
    if not _GENED.get("areas"):
        return []
    done = _completed_codes(dw_dict)
    dw_pct = _degreeworks_gened_pct(dw_dict)

    open_areas = []
    for area in _GENED["areas"]:
        code = area["code"]
        area_courses = area.get("courses", [])

        if code in dw_pct:
            # Authoritative: trust DegreeWorks' completion %.
            if dw_pct[code] >= 100:
                continue  # area satisfied
            needed = None  # DegreeWorks doesn't hand us a clean remaining-credit number
        else:
            # Fallback: derive from course codes (own options + major cross-counts).
            crosscount = area.get("also_satisfied_by", [])
            earned = sum(
                c.get("credits", 3)
                for c in (area_courses + crosscount)
                if _normalize(c["code"]) in done
            )
            needed = max(0, area.get("credits", 0) - earned)
            if needed <= 0:
                continue  # area satisfied

        # ALL of the area's own options the student hasn't taken yet, so the UI can
        # show one recommended pick plus "more like this" alternatives. Ordered by
        # course number (lower = more intro-level = sequence-appropriate first), so
        # the first one is the natural recommendation.
        untaken = [
            {"code": c["code"], "name": c["name"], "credits": c.get("credits", 3)}
            for c in area_courses
            if _normalize(c["code"]) not in done
        ]
        untaken.sort(key=lambda c: _course_number(c["code"]))
        open_areas.append({
            "code": code,
            "name": area["name"],
            "credits_needed": needed,   # None when we only know it's incomplete (DW %)
            "rule": area.get("rule", ""),
            "primary": untaken[0] if untaken else None,   # recommended pick
            "alternatives": untaken[1:],                  # "more like this"
        })
    return open_areas


def minor_status(dw_dict: dict, minor_name: str, sample: int = 6) -> dict | None:
    """Remaining courses toward the student's declared minor. Returns None when we
    don't have a verified roadmap for that minor (so the caller shows nothing rather
    than guessing)."""
    if not minor_name or not _MINORS.get("minors"):
        return None
    key = minor_name.strip().lower()
    minors = _MINORS["minors"]
    aliases = _MINORS.get("aliases", {})
    if key not in minors:
        key = aliases.get(key)
    plan = minors.get(key) if key else None
    if not plan:
        return None

    done = _completed_codes(dw_dict)
    remaining = [
        {"code": c["code"], "name": c["name"], "credits": c.get("credits", 3),
         "note": c.get("note")}
        for c in plan.get("courses", [])
        if c.get("code") and _normalize(c["code"]) not in done
    ]
    taken_count = sum(
        1 for c in plan.get("courses", []) if c.get("code") and _normalize(c["code"]) in done
    )

    # How many MORE courses the student needs to take. For a "choose N" minor (e.g.
    # Criminal Justice = choose 6), it's N minus what they've already taken — NOT the
    # count of every uncompleted option. For a fixed-list minor (choose is null),
    # it's simply the courses they haven't finished.
    choose = plan.get("choose")
    if choose:
        courses_left = max(0, choose - taken_count)
    else:
        courses_left = len(remaining)

    return {
        "name": plan["name"],
        "department": plan.get("department", ""),
        "rule": plan.get("rule", ""),
        "credits": plan.get("credits"),
        "choose": choose,
        "taken_count": taken_count,
        "remaining": remaining[:sample],       # example courses they COULD take
        "remaining_total": courses_left,       # how many more they must take
    }


def build_requirements(dw_dict: dict, minor_name: str = "") -> dict:
    """Combined GenEd + minor recommendation payload for the planner API/context."""
    if not dw_dict:
        return {"gened": [], "minor": None}
    return {
        "gened": gened_status(dw_dict),
        "minor": minor_status(dw_dict, minor_name) if minor_name else None,
    }


def build_requirements_text(dw_dict: dict, minor_name: str = "") -> str:
    """Text form of the requirements, for injecting into the conversational planner
    context (after the timed CS options). Empty string when nothing is open."""
    reqs = build_requirements(dw_dict, minor_name)
    gened = reqs.get("gened") or []
    minor = reqs.get("minor")
    if not gened and not (minor and minor.get("remaining")):
        return ""

    lines = ["ALSO REGISTER FOR (no class-time data — confirm times in WEBSIS):"]
    if gened:
        lines.append("General Education still needed:")
        for a in gened:
            picks = [a["primary"]] if a.get("primary") else []
            picks += a.get("alternatives", [])[:3]
            sug = ", ".join(c["code"] for c in picks if c)
            cr = f" ({a['credits_needed']} cr)" if a.get("credits_needed") else ""
            lines.append(f"  {a['name']}{cr} — e.g. {sug}")
    if minor and minor.get("remaining"):
        lines.append(f"Minor ({minor['name']}) — {minor['remaining_total']} course(s) left:")
        sug = ", ".join(c["code"] for c in minor["remaining"])
        lines.append(f"  {minor['rule']} e.g. {sug}")
    return "\n".join(lines)
