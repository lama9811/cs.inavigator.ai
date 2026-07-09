"""
Advising Form Engine
====================
Conversational advising-form helper. Guides a CS student through the department
advising sequence in two steps:

  Step 1 - Internship Form: ask whether the student has completed it. If not,
           give them the Morgan Internship Form URL and pause. If done, advance.
  Step 2 - Advising Form: walk the student through the advising form, pre-filling
           anything already known from DegreeWorks / profile, asking only for the
           missing student-owned fields (batched, a few at a time), then summarize
           the draft for confirmation.

Architecture mirrors services/schedule_planner.py exactly: intent detection, an
in-memory per-session state machine (10-min TTL), and a context block the unified
agent is told to "follow exactly". No extra LLM calls beyond the normal chat turn.

The internship form schema + draft normalizer are ported from the teammate fork
(cwminard/cs-navigator, adk_agent/faculty/internship_form.py) unchanged, since the
form definition itself is source-independent.

NOTE (v1): advisor auto-assignment by last name is intentionally NOT included yet;
the faculty last-name -> advisor mapping will be added later.
"""

import time as time_module
from copy import deepcopy
from typing import Any, Optional


# =============================================================================
# FORM URLS (Morgan State SCMNS advising)
# =============================================================================
INTERNSHIP_FORM_URL = (
    "https://www.morgan.edu/school-of-computer-mathematical-and-natural-sciences/"
    "students/scmns-advising/internship-form"
)
ADVISING_FORM_URL = (
    "https://www.morgan.edu/school-of-computer-mathematical-and-natural-sciences/"
    "students/scmns-advising/advising-form"
)


# =============================================================================
# ADVISING FORM SCHEMA (Step 2)
# Student-owned fields the student answers directly. Anything derivable from
# DegreeWorks / profile is pre-filled and never asked (see build_advising_context).
# =============================================================================
ADVISING_FORM_SCHEMA: dict[str, Any] = {
    "form_id": "cs_department_advising_form",
    "name": "CS Department Advising Form",
    "url": ADVISING_FORM_URL,
    "fields": [
        {"field_id": "first_name", "label": "First Name", "type": "text", "required": True},
        {"field_id": "last_name", "label": "Last Name", "type": "text", "required": True},
        {
            "field_id": "student_id",
            "label": "Student ID",
            "type": "text",
            "required": True,
            "help_text": "8 digits, begins with 00",
        },
        {"field_id": "major", "label": "Major", "type": "text", "required": True},
        {"field_id": "minor", "label": "Minor (if applicable)", "type": "text", "required": False},
        {
            "field_id": "msu_email",
            "label": "MSU Email",
            "type": "text",
            "required": True,
            "help_text": "ends in @morgan.edu",
        },
        {
            "field_id": "classification",
            "label": "Classification (year)",
            "type": "choice",
            "required": True,
            "options": ["Freshman", "Sophomore", "Junior", "Senior"],
        },
        {"field_id": "credits_applied", "label": "Credits applied", "type": "number", "required": True},
        {"field_id": "advisor", "label": "Advisor", "type": "text", "required": True},
        {"field_id": "gpa", "label": "GPA", "type": "number", "required": True},
        {"field_id": "graduation_date", "label": "Graduation Date", "type": "text", "required": True},
        {
            "field_id": "plan_to_work_next_semester",
            "label": "Do you plan to work next semester?",
            "type": "yes_no",
            "required": True,
        },
        {"field_id": "career_goals", "label": "Career goals", "type": "text", "required": True},
    ],
}

# Which advising-form fields can be pre-filled from DegreeWorks / saved profile.
# Maps advising field_id -> the key we look for in the dw/profile dict.
_PREFILL_SOURCES = {
    "first_name": ("first_name", "firstName", "given_name"),
    "last_name": ("last_name", "lastName", "family_name"),
    "student_id": ("student_id", "studentId", "id"),
    "major": ("major", "program"),
    "minor": ("minor",),
    "msu_email": ("msu_email", "email"),
    "classification": ("classification", "class_level", "year"),
    "credits_applied": ("credits", "credits_applied", "credits_earned"),
    "advisor": ("advisor", "advisor_name"),
    "gpa": ("gpa",),
    "graduation_date": ("graduation_date", "grad_date", "expected_graduation"),
}


# =============================================================================
# INTERNSHIP FORM SCHEMA (Step 1 fill flow) + draft normalizer
# Ported verbatim from teammate fork adk_agent/faculty/internship_form.py.
# In v1 the internship form is a link-out+pause; the schema/draft helpers are kept
# so an in-chat fill flow can be enabled later without re-porting.
# =============================================================================
INTERNSHIP_FORM_SCHEMA: dict[str, Any] = {
    "form_id": "academic_year_2025_2026_internship_research_job_experience",
    "name": "Academic Year 2025/2026 Internship, Research, Job Experience Form",
    "url": INTERNSHIP_FORM_URL,
    "purpose": (
        "Collect internship, research, and job experience details for the "
        "Morgan State SCMNS advising period."
    ),
    "sections": [
        {
            "section_id": "student_profile",
            "title": "Student profile",
            "fields": [
                {"field_id": "first_name", "label": "First Name", "type": "text", "required": True},
                {"field_id": "last_name", "label": "Last Name", "type": "text", "required": True},
                {
                    "field_id": "major",
                    "label": "Major",
                    "type": "text",
                    "required": True,
                },
                {
                    "field_id": "transfer_student",
                    "label": "Are you a transfer student?",
                    "type": "yes_no",
                    "required": True,
                },
                {
                    "field_id": "career_interest",
                    "label": "Career Interest",
                    "type": "text",
                    "required": True,
                },
            ],
        },
        {
            "section_id": "experience_summary",
            "title": "Internship, research, and job experience",
            "fields": [
                {
                    "field_id": "participated_in_experience",
                    "label": "Participated in Internship/Rsch/Job in 2025/2026?",
                    "type": "choice",
                    "required": True,
                    "options": ["Yes", "I did not apply", "I applied but was not selected"],
                },
                {
                    "field_id": "experience_type",
                    "label": "Type of Experience",
                    "type": "choice",
                    "required": False,
                    "options": [
                        "STEM Internship",
                        "STEM Related Job",
                        "STEM Research",
                        "Non STEM Internship",
                        "Non STEM Job",
                        "Non STEM Research",
                    ],
                    "required_when": {"field_id": "participated_in_experience", "value": "Yes"},
                },
                {
                    "field_id": "organization_name",
                    "label": "Name of company, government agency, or institution",
                    "type": "text",
                    "required": False,
                    "required_when": {"field_id": "participated_in_experience", "value": "Yes"},
                },
                {
                    "field_id": "job_title",
                    "label": "Your Intern/Job Title",
                    "type": "text",
                    "required": False,
                    "required_when": {"field_id": "participated_in_experience", "value": "Yes"},
                },
                {
                    "field_id": "relevance_to_education",
                    "label": "Relevance of Experience to Your Education",
                    "type": "text",
                    "required": False,
                    "required_when": {"field_id": "participated_in_experience", "value": "Yes"},
                },
            ],
        },
    ],
}


def get_internship_form_schema() -> dict[str, Any]:
    """Return a copy of the internship form schema."""
    return deepcopy(INTERNSHIP_FORM_SCHEMA)


def build_internship_form_draft(responses: dict[str, Any]) -> dict[str, Any]:
    """Normalize student responses and identify the missing follow-up fields.

    Ported from teammate fork (adk_agent/faculty/internship_form.py)."""
    normalized = {_normalize_key(key): value for key, value in responses.items()}
    field_map = _field_map(INTERNSHIP_FORM_SCHEMA)

    draft: dict[str, Any] = {}
    for field_id, field in field_map.items():
        value = _lookup_value(field, normalized)
        if value is not None:
            draft[field_id] = value

    missing_fields = []
    for field in field_map.values():
        if _is_required(field, draft):
            value = draft.get(field["field_id"])
            if _is_empty(value):
                missing_fields.append(
                    {
                        "field_id": field["field_id"],
                        "label": field["label"],
                        "type": field["type"],
                    }
                )

    completed_fields = [fid for fid, value in draft.items() if not _is_empty(value)]

    return {
        "form_id": INTERNSHIP_FORM_SCHEMA["form_id"],
        "form_name": INTERNSHIP_FORM_SCHEMA["name"],
        "completed": len(missing_fields) == 0,
        "completed_fields": completed_fields,
        "missing_fields": missing_fields,
        "draft": draft,
    }


# --- draft helper primitives (ported verbatim) -------------------------------

def _field_map(schema: dict[str, Any]) -> dict[str, dict[str, Any]]:
    fields: dict[str, dict[str, Any]] = {}
    for section in schema.get("sections", []):
        for field in section["fields"]:
            fields[field["field_id"]] = field
    return fields


def _normalize_key(value: Any) -> str:
    return str(value).strip().lower().replace(" ", "_")


def _normalize_value(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return [item.strip() if isinstance(item, str) else item for item in value]
    return value


def _lookup_value(field: dict[str, Any], normalized: dict[str, Any]) -> Any:
    field_id = field["field_id"]
    label_key = _normalize_key(field["label"])
    for key in (field_id, label_key):
        if key in normalized:
            return _normalize_value(normalized[key])
    return None


def _is_required(field: dict[str, Any], draft: dict[str, Any]) -> bool:
    if field.get("required"):
        return True
    required_when = field.get("required_when")
    if not required_when:
        return False
    source_value = draft.get(required_when["field_id"])
    if source_value is None or _is_empty(source_value):
        return False
    if "value" in required_when:
        return str(source_value).strip().lower() == str(required_when["value"]).strip().lower()
    values = {str(item).strip().lower() for item in required_when.get("values", [])}
    return str(source_value).strip().lower() in values


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0 or all(_is_empty(item) for item in value)
    return False


# =============================================================================
# INTENT DETECTION
# =============================================================================
_ADVISING_KEYWORDS = {
    "advising form", "advising help", "help me with advising",
    "help with advising", "start advising", "advising process",
    "advising steps", "advising step", "complete my advising",
    "fill out advising", "fill out the advising", "do my advising",
    "walk me through advising", "advising session",
}


def detect_advising_intent(query: str) -> bool:
    """True when the student is asking to go through the advising form flow.

    Deliberately narrow: bare 'advisor' / 'who is my advisor' questions are NOT
    the advising-form flow and should stay a normal KB answer."""
    q = (query or "").lower()
    return any(kw in q for kw in _ADVISING_KEYWORDS)


# =============================================================================
# RESPONSE PARSING
# =============================================================================
_AFFIRMATIVE = {"yes", "y", "yeah", "yep", "yup", "done", "completed", "i have", "i did"}
_NEGATIVE = {"no", "n", "nope", "not yet", "haven't", "havent", "not done", "i haven't"}
_CANCEL = {"cancel", "never mind", "nevermind", "stop", "forget it", "nvm", "quit", "exit"}


def _yes_no(text: str) -> Optional[bool]:
    """Interpret a yes/no answer. None if ambiguous."""
    t = (text or "").strip().lower()
    if t in _AFFIRMATIVE or any(t.startswith(w) for w in _AFFIRMATIVE):
        return True
    if t in _NEGATIVE or any(t.startswith(w) for w in _NEGATIVE):
        return False
    return None


# =============================================================================
# IN-MEMORY STATE MACHINE (mirrors schedule_planner)
# =============================================================================
_advising_sessions: dict[str, dict] = {}
_advising_timestamps: dict[str, float] = {}
_ADVISING_TTL = 600  # 10 minutes


def get_advising_state(user_id: int, session_id: str) -> Optional[dict]:
    """Return active advising state, or None if not in the flow / expired."""
    key = f"{user_id}_{session_id}"
    ts = _advising_timestamps.get(key, 0)
    if time_module.time() - ts > _ADVISING_TTL:
        _advising_sessions.pop(key, None)
        _advising_timestamps.pop(key, None)
        return None
    return _advising_sessions.get(key)


def set_advising_state(user_id: int, session_id: str, state: dict):
    key = f"{user_id}_{session_id}"
    _advising_sessions[key] = state
    _advising_timestamps[key] = time_module.time()


def clear_advising_state(user_id: int, session_id: str):
    key = f"{user_id}_{session_id}"
    _advising_sessions.pop(key, None)
    _advising_timestamps.pop(key, None)


def process_advising_turn(state: dict, user_msg: str) -> Optional[dict]:
    """Advance the advising state machine. Returns new state, or None to end the flow."""
    phase = state.get("phase", "")
    msg_lower = (user_msg or "").lower().strip()

    # Cancel at any point
    if msg_lower in _CANCEL or any(w in msg_lower for w in _CANCEL):
        return None

    if phase == "step1_internship":
        answer = _yes_no(user_msg)
        if answer is True:
            state["phase"] = "step2_advising"
            state["internship_done"] = True
        elif answer is False:
            state["phase"] = "step1_paused"
            state["internship_done"] = False
        # Ambiguous -> stay in step1_internship; agent re-asks the yes/no question.
        return state

    if phase == "step1_paused":
        # Student came back. If they now say it's done, move on; else keep paused.
        answer = _yes_no(user_msg)
        if answer is True:
            state["phase"] = "step2_advising"
            state["internship_done"] = True
        return state

    if phase == "step2_advising":
        # The agent drives the section-by-section fill using the injected context;
        # the flow ends when the student confirms the draft.
        if any(w in msg_lower for w in ("confirm", "looks good", "that's correct", "thats correct", "submit", "done")):
            return None
        return state

    return state


# =============================================================================
# CONTEXT INJECTION (the "follow exactly" block the agent obeys)
# =============================================================================
def _prefill_from_student_data(student_data: Optional[dict]) -> dict[str, Any]:
    """Pull advising-form values we already know from DegreeWorks / profile."""
    known: dict[str, Any] = {}
    if not student_data:
        return known
    for field_id, source_keys in _PREFILL_SOURCES.items():
        for key in source_keys:
            val = student_data.get(key)
            if val not in (None, "", []):
                known[field_id] = val
                break
    return known


def build_advising_context(state: dict, student_data: Optional[dict] = None) -> str:
    """Format advising state into a context block for agent instruction injection."""
    phase = state.get("phase", "")
    bar = "=" * 40

    if phase == "step1_internship":
        return (
            f"\n{bar}\n"
            "ADVISING FORM MODE - STEP 1 (follow exactly):\n"
            "The student is starting the CS department advising flow. Step 1 is the "
            "Internship Form. Ask ONLY this, using the yes/no button marker so the UI "
            "renders buttons:\n"
            "[YES/NO_QUESTION]: Have you already completed Step 1, the Internship Form?\n"
            "Do NOT start the advising form yet. Just ask this one question.\n"
            f"{bar}\n"
        )

    if phase == "step1_paused":
        return (
            f"\n{bar}\n"
            "ADVISING FORM MODE - STEP 1 NOT DONE (follow exactly):\n"
            "The student has not completed the Internship Form. Direct them to it and "
            "PAUSE the advising flow until they return. Say, in a friendly tone:\n"
            f"'No problem - please complete the Internship Form first: {INTERNSHIP_FORM_URL} "
            "Come back and tell me once it's done, and we'll continue with the Advising Form.'\n"
            "Do NOT ask any advising-form questions yet.\n"
            f"{bar}\n"
        )

    if phase == "step2_advising":
        known = _prefill_from_student_data(student_data)
        # Student-owned fields still needed (skip anything pre-filled).
        missing = [
            f for f in ADVISING_FORM_SCHEMA["fields"]
            if f["field_id"] not in known
        ]
        known_lines = ""
        if known:
            known_lines = "Known advising values from saved profile/DegreeWorks (treat as ALREADY answered, do not re-ask):\n"
            for fid, val in known.items():
                label = next((f["label"] for f in ADVISING_FORM_SCHEMA["fields"] if f["field_id"] == fid), fid)
                known_lines += f"  - {label}: {val}\n"

        missing_lines = ""
        for f in missing:
            hint = f" ({f['help_text']})" if f.get("help_text") else ""
            missing_lines += f"  - {f['label']}{hint}\n"

        return (
            f"\n{bar}\n"
            "ADVISING FORM MODE - STEP 2 (follow exactly):\n"
            "The student completed Step 1. Now walk them through the Advising Form in "
            "small, manageable sections. Optimize for speed and avoid redundancy.\n\n"
            f"{known_lines}\n"
            "Only ask the student for these MISSING student-owned fields:\n"
            f"{missing_lines}\n"
            "Ask for at most THREE missing fields at a time, grouped naturally, in one "
            "concise message. For yes/no fields, use the marker:\n"
            "[YES/NO_QUESTION]: <question text>\n"
            "When all fields are known or answered, summarize the draft values and ask "
            "the student to confirm instead of asking more questions. Steps 3 (meeting an "
            "advisor) and 4 (registration) are bypassed for now - tell the student they "
            "can handle registration themselves for the time being.\n"
            f"{bar}\n"
        )

    return ""
