"""
Schedule Planner Engine
========================
Conversational course schedule planner. Backend pre-computes everything:
time conflict detection, level-appropriate filtering, preference scoring,
and generates 2-3 ready-made schedule options.

Zero extra LLM calls. Agent just presents the pre-computed options.
"""

import re
import json
import time as time_module
from typing import Optional
from collections import defaultdict


# =============================================================================
# TIME PARSING & CONFLICT DETECTION
# =============================================================================

def _time_to_minutes(t: str) -> int:
    """Convert '1:00PM' to minutes since midnight (780)."""
    m = re.match(r'(\d{1,2}):(\d{2})(AM|PM)', t.strip())
    if not m:
        return 0
    h, mins, period = int(m.group(1)), int(m.group(2)), m.group(3)
    if period == "PM" and h != 12:
        h += 12
    if period == "AM" and h == 12:
        h = 0
    return h * 60 + mins


def parse_time_slots(time_str: str) -> list[tuple[str, int, int]]:
    """Parse schedule time string into list of (day, start_min, end_min) tuples.

    Handles:
      'MWF 12:00PM-12:50PM'
      'TR 1:00PM-2:40PM'
      'MWF 11:00AM-11:50AM, T 11:00AM-11:50AM'
      'TBA' -> empty list (no conflict possible)
    """
    if not time_str or time_str.strip().upper() in ("TBA", ""):
        return []
    slots = []
    for part in time_str.split(","):
        part = part.strip()
        m = re.match(r'([MTWRF]+)\s+(\d{1,2}:\d{2}(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}(?:AM|PM))', part)
        if not m:
            continue
        days_str, start_str, end_str = m.groups()
        start = _time_to_minutes(start_str)
        end = _time_to_minutes(end_str)
        for day in days_str:
            slots.append((day, start, end))
    return slots


def has_conflict(slots_a: list, slots_b: list) -> bool:
    """Check if two sets of time slots overlap on any day."""
    for day_a, s_a, e_a in slots_a:
        for day_b, s_b, e_b in slots_b:
            if day_a == day_b and s_a < e_b and s_b < e_a:
                return True
    return False


# =============================================================================
# LEVEL-APPROPRIATE COURSE FILTERING
# =============================================================================

LEVEL_RULES = {
    "Freshman":  {"max_level": 200, "max_300": 0, "max_400": 0},
    "Sophomore": {"max_level": 300, "max_300": 1, "max_400": 0},
    "Junior":    {"max_level": 400, "max_300": 99, "max_400": 1},
    "Senior":    {"max_level": 400, "max_300": 99, "max_400": 99},
}


def _get_course_level(code: str) -> int:
    """COSC 351 -> 300, MATH 241 -> 200, ENGL 101 -> 100."""
    m = re.search(r'\d{3}', code)
    return (int(m.group()) // 100) * 100 if m else 0


def _filter_by_level(courses: list[dict], classification: str) -> list[dict]:
    """Remove courses too advanced for the student's classification."""
    rules = LEVEL_RULES.get(classification, LEVEL_RULES["Senior"])
    count_300 = 0
    count_400 = 0
    filtered = []
    for c in courses:
        level = _get_course_level(c["id"])
        if level >= 300 and level < 400:
            if count_300 >= rules["max_300"]:
                continue
            count_300 += 1
        elif level >= 400:
            if count_400 >= rules["max_400"]:
                continue
            count_400 += 1
        if level <= rules["max_level"]:
            filtered.append(c)
    return filtered


# =============================================================================
# PLANNING INTENT DETECTION
# =============================================================================

_PLANNING_KEYWORDS = {
    "plan my", "build my schedule", "help me pick classes",
    "create a schedule", "schedule builder", "plan my semester",
    "help me plan", "make me a schedule", "build a schedule",
    "plan next semester", "plan fall", "plan spring", "plan summer",
    "what should i take", "what courses should i take",
    "what should i take next", "what to take next",
    "recommend courses", "recommend me courses",
    "what can i take", "pick my classes",
    "course recommendations", "suggest courses",
    "tell me what i should take", "tell me what to take",
    "what do i take", "which courses should",
}


def detect_planning_intent(query: str) -> bool:
    """Check if the query is asking to plan a schedule (not just a quick question)."""
    q = query.lower()
    return any(kw in q for kw in _PLANNING_KEYWORDS)


# =============================================================================
# RESPONSE PARSING (extract semester, preferences from user text)
# =============================================================================

def parse_semester_response(text: str) -> Optional[str]:
    """Extract semester key from user text. Returns 'fall_2026' etc. or None."""
    t = text.lower()
    import datetime
    year = datetime.date.today().year
    # Check for explicit year
    year_match = re.search(r'(20\d{2})', t)
    if year_match:
        year = int(year_match.group(1))

    if "fall" in t:
        return f"fall_{year}"
    elif "spring" in t:
        return f"spring_{year + 1}" if "next" in t or datetime.date.today().month > 5 else f"spring_{year}"
    elif "summer" in t:
        return f"summer_{year}"
    return None


def parse_preferences(text: str) -> dict:
    """Extract scheduling preferences from free text.

    Returns: {time_pref, max_credits, interests}
    """
    t = text.lower()

    # Time preference
    time_pref = "any"
    if any(w in t for w in ["morning", "early", " am ", "before noon", "before 12"]):
        time_pref = "morning"
    elif any(w in t for w in ["afternoon", "midday", "after noon", "after 12"]):
        time_pref = "afternoon"
    elif any(w in t for w in ["evening", "night", "late", "after 5", "after 4"]):
        time_pref = "evening"

    # Max credits
    max_credits = 15  # default
    credit_match = re.search(r'(\d{1,2})\s*(?:credits?|cr|hours?)', t)
    if credit_match:
        max_credits = min(int(credit_match.group(1)), 18)
    elif "light" in t or "easy" in t:
        max_credits = 12
    elif "heavy" in t or "full" in t or "max" in t:
        max_credits = 18

    # Interests
    interest_keywords = {
        "ai": ["artificial intelligence", "machine learning", "ai", "ml", "deep learning"],
        "security": ["security", "cyber", "cryptography", "network security"],
        "data": ["data science", "data analytics", "big data", "data"],
        "web": ["web", "mobile", "app development", "frontend"],
        "game": ["game", "graphics", "game design", "game dev"],
        "quantum": ["quantum", "quantum computing"],
        "cloud": ["cloud", "cloud computing"],
        "systems": ["operating systems", "networks", "systems", "architecture"],
    }
    interests = []
    for topic, keywords in interest_keywords.items():
        if any(kw in t for kw in keywords):
            interests.append(topic)

    return {"time_pref": time_pref, "max_credits": max_credits, "interests": interests}


# =============================================================================
# SCHEDULE GENERATION
# =============================================================================

def _score_section(section: dict, course: dict, preferences: dict) -> int:
    """Score a course section based on preferences."""
    score = 0
    time_str = section.get("time", "")
    slots = parse_time_slots(time_str)

    # Time preference scoring
    if slots and preferences.get("time_pref") != "any":
        avg_start = sum(s for _, s, _ in slots) / len(slots)
        if preferences["time_pref"] == "morning" and avg_start < 720:  # before noon
            score += 5
        elif preferences["time_pref"] == "afternoon" and 720 <= avg_start < 1020:  # noon-5pm
            score += 5
        elif preferences["time_pref"] == "evening" and avg_start >= 1020:  # after 5pm
            score += 5

    # Interest matching
    course_name = (course.get("name", "") + " " + course.get("id", "")).lower()
    interest_map = {
        "ai": ["artificial", "intelligence", "machine learning", "ml"],
        "security": ["security", "cyber", "crypto"],
        "data": ["data science", "data analytics", "data"],
        "web": ["web", "mobile"],
        "game": ["game"],
        "quantum": ["quantum"],
        "cloud": ["cloud"],
        "systems": ["operating", "network", "architecture"],
    }
    for interest in preferences.get("interests", []):
        keywords = interest_map.get(interest, [])
        if any(kw in course_name for kw in keywords):
            score += 8

    # Category priority: Required > Supporting > Electives
    cat = course.get("category", "")
    if cat == "Required":
        score += 5
    elif cat == "Supporting":
        score += 3
    else:
        score += 1

    # Curriculum-sequence order: prefer the courses that come NEXT in the official
    # 8-semester sequence over ones further out, so recommendations follow the natural
    # progression instead of skipping ahead. Earlier semester -> larger bonus. Courses
    # with no fixed sequence slot (electives) get no bonus, so required in-sequence
    # courses surface first. Soft hint (max +8), not a hard gate.
    seq = course.get("sequence")
    if seq:
        score += max(0, 9 - seq)  # sem 1 -> +8, sem 8 -> +1

    # Live availability (only present when the schedule came from Banner):
    # strongly prefer sections with open seats. Full sections stay eligible so a
    # required course with no open section can still be shown (flagged full), but
    # an open section always outranks a full one.
    open_flag = section.get("open_section")
    if open_flag is True:
        score += 20
    elif open_flag is False:
        score -= 20

    return score


def _untimed_picks(requirements: dict, variant: int = 0) -> list[dict]:
    """Flatten the GenEd + minor requirements into a prioritized list of untimed
    course picks to fill a schedule with. These have no class-time data, so the
    student picks the section in WEBSIS. Order: GenEd areas first (one course each),
    then minor courses. Each pick carries which requirement it fills.

    `variant` rotates WHICH course is chosen from each area (GenEd areas have several
    approved courses; the minor has many options). variant 0 = the recommended pick;
    higher variants rotate to the next approved course in that area. This is what the
    'Regenerate' button drives — it only reshuffles the GenEd/minor picks (the CS
    courses are chosen by the interests selector, not here)."""
    picks = []
    seen = set()

    def _add(course, satisfies, kind):
        if not course or not course.get("code"):
            return
        code = course["code"].upper()
        if code in seen:
            return
        seen.add(code)
        picks.append({
            "code": course["code"],
            "name": course.get("name", ""),
            "credits": course.get("credits", 3),
            "satisfies": satisfies,       # e.g. "GenEd: Arts and Humanities"
            "kind": kind,                 # "gened" | "minor"
            "untimed": True,              # no class-time data — pick section in WEBSIS
        })

    def _area_course(area):
        # All approved courses for this GenEd area, rotated by variant so Regenerate
        # offers a different-but-valid pick from the same area.
        opts = ([area["primary"]] if area.get("primary") else []) + (area.get("alternatives") or [])
        if not opts:
            return None
        return opts[variant % len(opts)]

    gened_areas = (requirements or {}).get("gened") or []
    minor = (requirements or {}).get("minor")
    minor_courses = (minor.get("remaining") or []) if minor else []
    # Rotate the minor's starting course by variant too.
    if minor_courses:
        offset = variant % len(minor_courses)
        minor_courses = minor_courses[offset:] + minor_courses[:offset]

    # Interleave so a typical fill gets a mix — first GenEd, then first minor course,
    # then more GenEds — rather than all GenEds crowding out the minor. Gives the
    # "~2 GenEd + 1 minor" shape when there's room for a few untimed courses.
    if gened_areas:
        _add(_area_course(gened_areas[0]), f"GenEd: {gened_areas[0].get('name', '')}", "gened")
    if minor_courses:
        _add(minor_courses[0], f"Minor: {minor.get('name', '')}", "minor")
    for area in gened_areas[1:]:
        _add(_area_course(area), f"GenEd: {area.get('name', area.get('code', ''))}", "gened")
    for c in minor_courses[1:]:
        _add(c, f"Minor: {minor.get('name', '')}", "minor")
    return picks


def _fill_with_untimed(selected: list[dict], picks: list[dict], max_credits: int) -> list[dict]:
    """Append untimed GenEd/minor picks to a timed CS schedule, up to the credit
    target. Untimed courses count toward credits but need no conflict check (no time).

    Picks are interleaved during SELECTION (so a minor course still fits the budget
    even when GenEds could fill it), but the returned list is ORDERED for display:
    Required CS first, then GenEd, then Minor."""
    total = sum(c["credits"] for c in selected)
    used = {c["code"] for c in selected}
    added = []
    for p in picks:
        if p["code"] in used:
            continue
        if total + p["credits"] > max_credits:
            continue
        added.append({
            "code": p["code"], "name": p["name"], "credits": p["credits"],
            "category": p["satisfies"], "kind": p["kind"], "untimed": True,
            "section": "", "instructor": "", "time": "TBD", "room": "",
            "slots": [], "score": 0,
            "crn": None, "seats_available": None, "open_section": None, "wait_count": None,
        })
        used.add(p["code"])
        total += p["credits"]

    # Display order: Required (CS, kind=None) -> GenEd -> Minor. Stable within each
    # group so CS keeps its score/sequence order and GenEd/minor keep pick order.
    order = {None: 0, "gened": 1, "minor": 2}
    return sorted(selected + added, key=lambda c: order.get(c.get("kind"), 0))


def generate_schedule_options(
    eligible_courses: list[dict],
    semester_key: str,
    preferences: dict,
    schedules: dict,
    classification: str = "Senior",
    requirements: dict = None,
    variant: int = 0,
) -> list[dict]:
    """Generate 2-3 conflict-free schedule options.

    Each option is a COMPLETE plan: timed CS courses first (conflict-checked), then
    filled toward the credit target with untimed GenEd/minor courses (which the
    student schedules themselves in WEBSIS).

    Args:
        eligible_courses: nodes from prereq graph with status='future' and prereqs met
        semester_key: e.g. 'fall_2026'
        preferences: {time_pref, max_credits, interests}
        schedules: _SCHEDULES dict from course_context
        classification: student classification for level filtering
        requirements: {gened, minor} from requirement_planner (untimed fill courses)
    """
    sem_schedule = schedules.get(semester_key, {})
    if not sem_schedule:
        return []

    # Filter by level
    level_filtered = _filter_by_level(eligible_courses, classification)

    # Match eligible courses with schedule sections
    available = []
    for course in level_filtered:
        code = course["id"]
        sections = sem_schedule.get(code, [])
        if sections:
            for sec in sections:
                slots = parse_time_slots(sec.get("time", ""))
                score = _score_section(sec, course, preferences)
                available.append({
                    "code": code,
                    "name": course["name"],
                    "credits": course["credits"],
                    "category": course["category"],
                    "sequence": course.get("sequence"),
                    "section": sec.get("section", ""),
                    "instructor": sec.get("instructor", ""),
                    "time": sec.get("time", "TBA"),
                    "room": sec.get("room", "TBA"),
                    "slots": slots,
                    "score": score,
                    # Live availability (None when schedule is the static snapshot):
                    "crn": sec.get("crn"),
                    "seats_available": sec.get("seats_available"),
                    "open_section": sec.get("open_section"),
                    "wait_count": sec.get("wait_count"),
                })

    if not available:
        return []

    picks = _untimed_picks(requirements, variant=variant)
    target = preferences.get("max_credits", 15)

    # Reserve some of the credit target for untimed GenEd/minor courses so each option
    # is a real mix, not all-CS. `reserve` is how many credits to leave for untimed
    # courses (~3 cr each). With no picks available, the CS portion uses the full
    # target as before.
    def _cs_cap(total_target: int, reserve: int) -> int:
        if not picks:
            return total_target
        # Always allow at least 6 cr of CS so an option isn't mostly GenEd/minor.
        return max(6, total_target - reserve)

    def _build(avail, total_target, label, reserve=6):
        cs = _greedy_schedule(avail, _cs_cap(total_target, reserve))
        full = _fill_with_untimed(cs, picks, total_target)
        # Dedup on the FULL course set (CS + untimed), so two options with the same CS
        # courses but a different mix (e.g. 4 CS+2 vs 3 CS+3) both survive.
        return {"label": label, "courses": full, "_cs_key": _option_key(full)}

    # Three fixed credit-load tiers: Lighter (12), Balanced (15), Heavier (18). The
    # credit slider is the CAP — tiers up to its value are shown (slider 18 -> all
    # three; slider 15 -> Lighter + Balanced; slider 12 -> Lighter only). Each tier
    # reserves ~half its credits for untimed GenEd/minor courses so it's a real mix
    # (12 -> 2 CS + 2 untimed, 15 -> 3 CS + 2 untimed, 18 -> 3 CS + 3 untimed).
    TIERS = [
        ("Lighter Load", 12, 6),
        ("Balanced", 15, 6),
        ("Heavier Load", 18, 9),
    ]

    # Interest preferences boost matching CS courses within every tier (so an
    # interested-in course surfaces first) rather than being a separate option.
    interest_map = {
        "ai": ["artificial", "intelligence", "machine learning"],
        "security": ["security", "cyber", "crypto"],
        "data": ["data science", "data analytics"],
        "web": ["web", "mobile"], "game": ["game"],
        "quantum": ["quantum"], "cloud": ["cloud"],
        "systems": ["operating", "network", "architecture"],
    }
    interests = preferences.get("interests", [])
    if interests:
        for item in available:
            name = (item["name"] + " " + item["code"]).lower()
            for interest in interests:
                if any(kw in name for kw in interest_map.get(interest, [])):
                    item["score"] += 15

    options = []
    seen_keys = set()
    for label, tier_credits, reserve in TIERS:
        if tier_credits > target:
            continue  # slider cap: don't show tiers heavier than the student wants
        opt = _build(available, tier_credits, label, reserve=reserve)
        if opt["courses"] and opt["_cs_key"] not in seen_keys:
            seen_keys.add(opt["_cs_key"])
            options.append({"label": opt["label"], "courses": opt["courses"]})

    return options


def _greedy_schedule(available: list[dict], max_credits: int) -> list[dict]:
    """Greedy: pick highest-scored section for each course, no conflicts, within credit limit."""
    # Sort by score descending
    sorted_avail = sorted(available, key=lambda x: -x["score"])
    selected = []
    selected_slots = []
    total_credits = 0
    used_codes = set()

    for item in sorted_avail:
        if item["code"] in used_codes:
            continue
        if total_credits + item["credits"] > max_credits:
            continue
        # Check conflict with all selected
        if any(has_conflict(item["slots"], s) for s in selected_slots):
            continue
        selected.append(item)
        selected_slots.append(item["slots"])
        total_credits += item["credits"]
        used_codes.add(item["code"])

    return selected


def _option_key(courses: list[dict]) -> str:
    """Unique key for a schedule option (for dedup)."""
    return "|".join(sorted(c["code"] for c in courses))


# =============================================================================
# ELIGIBILITY + SEMESTER HELPERS (shared by chat flow and /api/planning)
# =============================================================================

def eligible_courses(graph: dict) -> list[dict]:
    """Future courses whose prerequisites are all already completed/in-progress.

    Single source of truth for "what can this student take next", used by both
    the conversational planner and the stateless /api/planning/next-semester
    endpoint so the two never drift."""
    done_ids = {n["id"] for n in graph.get("nodes", [])
                if n.get("status") in ("completed", "in_progress")}
    result = []
    for n in graph.get("nodes", []):
        if n.get("status") != "future":
            continue
        blocked = n.get("blocked_by") or []
        if not blocked or all(bn in done_ids for bn in blocked):
            result.append(n)
    return result


_SEASON_ORDER = {"spring": 0, "summer": 1, "fall": 2}


def _parse_semester_key(key: str):
    """'fall_2026' -> (2026, 2) for chronological sorting; None if unparseable."""
    m = re.match(r'(spring|summer|fall)_(\d{4})$', (key or "").lower())
    return (int(m.group(2)), _SEASON_ORDER[m.group(1)]) if m else None


def next_semester_key(available, today=None) -> Optional[str]:
    """Pick the soonest upcoming semester among the `available` schedule keys.

    Falls back to the latest available term if none are in the future."""
    import datetime
    keys = [k for k in available if _parse_semester_key(k)]
    if not keys:
        return None
    today = today or datetime.date.today()
    cur_season = "spring" if today.month <= 4 else "summer" if today.month <= 7 else "fall"
    cur = (today.year, _SEASON_ORDER[cur_season])
    ordered = sorted(keys, key=_parse_semester_key)
    for k in ordered:
        if _parse_semester_key(k) >= cur:
            return k
    return ordered[-1]


# =============================================================================
# CONVERSATIONAL STATE MACHINE
# =============================================================================

# In-memory planner sessions: {user_session_key: {phase, semester, preferences, options, ...}}
_planner_sessions: dict[str, dict] = {}
_planner_timestamps: dict[str, float] = {}
_PLANNER_TTL = 600  # 10 minutes


def get_planner_state(user_id: int, session_id: str) -> Optional[dict]:
    """Get active planner state, or None if not planning / expired."""
    key = f"{user_id}_{session_id}"
    ts = _planner_timestamps.get(key, 0)
    if time_module.time() - ts > _PLANNER_TTL:
        _planner_sessions.pop(key, None)
        _planner_timestamps.pop(key, None)
        return None
    return _planner_sessions.get(key)


def set_planner_state(user_id: int, session_id: str, state: dict):
    """Store planner state."""
    key = f"{user_id}_{session_id}"
    _planner_sessions[key] = state
    _planner_timestamps[key] = time_module.time()


def clear_planner_state(user_id: int, session_id: str):
    """Clear planner state (user cancelled or flow completed)."""
    key = f"{user_id}_{session_id}"
    _planner_sessions.pop(key, None)
    _planner_timestamps.pop(key, None)


def process_planner_turn(state: dict, user_msg: str, dw_dict: dict, schedules: dict) -> Optional[dict]:
    """Advance the planner state machine. Returns new state or None if flow ends."""
    phase = state.get("phase", "")
    msg_lower = user_msg.lower()

    # Cancel detection
    if any(w in msg_lower for w in ["cancel", "never mind", "stop planning", "forget it", "nvm"]):
        return None

    if phase == "ask_semester":
        semester = parse_semester_response(user_msg)
        if semester:
            state["phase"] = "ask_preferences"
            state["semester"] = semester
        # If can't parse, stay in same phase (agent will re-ask)
        return state

    elif phase == "ask_preferences":
        prefs = parse_preferences(user_msg)
        state["preferences"] = prefs

        # Now generate schedule options
        try:
            from services.prereq_engine import build_prerequisite_graph
            from services.requirement_planner import build_requirements
            graph = build_prerequisite_graph(dw_dict, None)
            eligible = eligible_courses(graph)
            classification = dw_dict.get("classification", "Senior") or "Senior"
            requirements = build_requirements(dw_dict, dw_dict.get("minor") or "")
            options = generate_schedule_options(
                eligible, state["semester"], prefs, schedules, classification,
                requirements=requirements,
            )
            state["phase"] = "present_options"
            state["options"] = options
        except Exception as e:
            state["phase"] = "error"
            state["error"] = str(e)

        return state

    elif phase == "present_options":
        # User responded to options. Flow complete.
        return None

    return state


def build_planner_context(state: dict) -> str:
    """Format planner state into text for agent context injection."""
    phase = state.get("phase", "")

    if phase == "ask_semester":
        return (
            "\n" + "=" * 40 + "\n"
            "SCHEDULE PLANNER MODE (follow exactly):\n"
            "Ask the student: 'Which semester are you planning for? (e.g., Summer 2026, Fall 2026)'\n"
            "Do NOT generate any schedule yet. Just ask this one question.\n"
            + "=" * 40 + "\n"
        )

    elif phase == "ask_preferences":
        sem = state.get("semester", "").replace("_", " ").title()
        return (
            "\n" + "=" * 40 + "\n"
            f"SCHEDULE PLANNER MODE - {sem}:\n"
            "Ask the student these questions in a natural way:\n"
            "1. Do you prefer morning, afternoon, or evening classes?\n"
            "2. How many credits do you want to take? (12-18, 15 is typical)\n"
            "3. Any subjects you're particularly interested in? (e.g., AI, cybersecurity, game design)\n"
            "Ask all 3 in one message. Keep it casual.\n"
            + "=" * 40 + "\n"
        )

    elif phase == "present_options":
        options = state.get("options", [])
        if not options:
            return (
                "\n" + "=" * 40 + "\n"
                "SCHEDULE PLANNER - No Options Found:\n"
                "Tell the student: 'I couldn't find courses that match your preferences for this semester. "
                "The schedule data may not be available yet. Check WEBSIS or contact the CS department.'\n"
                + "=" * 40 + "\n"
            )

        sem = state.get("semester", "").replace("_", " ").title()
        prefs = state.get("preferences", {})
        ctx = f"\n{'=' * 40}\n"
        ctx += f"SCHEDULE PLANNER - Present these options for {sem}:\n"
        ctx += f"Preferences: {prefs.get('time_pref', 'any')} classes, {prefs.get('max_credits', 15)} credits"
        if prefs.get("interests"):
            ctx += f", interests: {', '.join(prefs['interests'])}"
        ctx += "\n\n"

        for i, opt in enumerate(options):
            total_cr = sum(c["credits"] for c in opt["courses"])
            ctx += f"**Option {chr(65 + i)} - {opt['label']} ({total_cr} credits):**\n"
            for c in opt["courses"]:
                if c.get("untimed"):
                    # GenEd/minor course blended into the plan — no class time yet.
                    ctx += f"  {c['code']} - {c['name']} | pick a section in WEBSIS | {c.get('category', '')}\n"
                else:
                    ctx += f"  {c['code']} - {c['name']} | {c['time']} | {c['instructor']} | {c['room']}\n"
            ctx += "  CS courses are conflict-free with prerequisites met. GenEd/minor courses need a section chosen in WEBSIS.\n\n"

        ctx += ("Present these options exactly as shown — each is a full plan mixing CS "
                "courses with GenEd/minor courses. Note the GenEd/minor ones don't have "
                "times yet, so the student picks those sections in WEBSIS. Ask which "
                "option they prefer or if they want to swap any courses.\n")
        ctx += "=" * 40 + "\n"
        return ctx

    elif phase == "error":
        return (
            "\nSCHEDULE PLANNER ERROR: Could not generate schedule options. "
            "Tell the student to check WEBSIS or contact the CS department.\n"
        )

    return ""
