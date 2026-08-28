"""
Degree profile registry for curriculum, Ripple Effect, and Planner routing.

Course facts stay in classes.json. Degree profiles decide which courses count for
which program so Cloud legacy and AI students do not silently use the CS plan.
"""

from __future__ import annotations

import copy
import json
import os
import re
from functools import lru_cache
from typing import Any

from .course_utils import normalize_course_code


DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data_sources")
DEFAULT_PROFILE_KEY = "computer_science_bs"

PROFILE_META = {
    "computer_science_bs": {
        "display_name": "Computer Science, B.S.",
        "status": "active",
        "source": "backend/data_sources/degree.json",
    },
    "cloud_computing_bs_legacy": {
        "display_name": "Cloud Computing, B.S.",
        "status": "legacy",
        "source": "backend/data_sources/degree.json",
        "warning": "Cloud Computing is kept for legacy/teach-out students. Confirm catalog year with an advisor.",
    },
    "artificial_intelligence_bs": {
        "display_name": "Artificial Intelligence, B.S.",
        "status": "draft_review",
        "source": "Program_ Artificial Intelligence, B.S. - Morgan State University.pdf",
        "warning": "AI B.S. data is staged from the catalog PDF and needs department/catalog confirmation before final planner claims.",
    },
}

PROFILE_ALIASES = {
    "computer science": "computer_science_bs",
    "bs computer science": "computer_science_bs",
    "b.s. computer science": "computer_science_bs",
    "bachelor of science in computer science": "computer_science_bs",
    "bachelor of science (b.s.) in computer science": "computer_science_bs",
    "cloud computing": "cloud_computing_bs_legacy",
    "bs cloud computing": "cloud_computing_bs_legacy",
    "b.s. cloud computing": "cloud_computing_bs_legacy",
    "bachelor of science in cloud computing": "cloud_computing_bs_legacy",
    "bachelor of science (b.s.) in cloud computing": "cloud_computing_bs_legacy",
    "artificial intelligence": "artificial_intelligence_bs",
    "ai": "artificial_intelligence_bs",
    "bs artificial intelligence": "artificial_intelligence_bs",
    "b.s. artificial intelligence": "artificial_intelligence_bs",
    "bachelor of science in artificial intelligence": "artificial_intelligence_bs",
    "bachelor of science (b.s.) in artificial intelligence": "artificial_intelligence_bs",
}

SECTION_CATEGORY = {
    "general_education_requirements": ("General Education", "gened"),
    "supporting_courses": ("Supporting", "supporting"),
    "computer_science_major_requirements": ("Required", "required"),
    "cloud_computing_major_requirements": ("Required", "required"),
    "artificial_intelligence_major_requirements": ("Required", "required"),
    "natural_science_complementary_studies": ("Complementary Studies", "complementary"),
}

CATEGORY_PRIORITY = {
    "required": 1,
    "supporting": 2,
    "complementary": 3,
    "group_a": 4,
    "group_b": 5,
    "group_c": 6,
    "group_d": 7,
    "gened": 8,
    "other": 99,
}


AI_PROFILE = {
    "degree_name": "Bachelor of Science (B.S.) in Artificial Intelligence",
    "profile_key": "artificial_intelligence_bs",
    "total_credits": 120,
    "source_notes": [
        "Staged from the 2026-2028 Undergraduate Catalog PDF supplied by the user.",
        "PDF shows inconsistent supporting-course and major-credit totals; keep as draft_review until confirmed.",
        "Suggested semester sequence was not visible in the supplied extracted pages.",
    ],
    "general_education_requirements": {
        "credits": 44,
        "courses": [
            {"course_code": "ENGL 101", "course_name": "Composition I", "credits": 3},
            {"course_code": "ENGL 102", "course_name": "Composition II", "credits": 3},
            {"course_code": "MATH 113", "course_name": "Introduction to Mathematical Analysis I", "credits": 4},
            {"course_code": "COSC 111", "course_name": "Introduction to Computer Science I", "credits": 4},
        ],
    },
    "supporting_courses": {
        "credits": 14,
        "courses": [
            {"course_code": "MATH 113", "course_name": "Introduction to Mathematical Analysis I", "credits": 4},
            {"course_code": "MATH 114", "course_name": "Introduction to Mathematical Analysis II", "credits": 4},
            {"course_code": "MATH 241", "course_name": "Calculus I", "credits": 4},
            {"course_code": "MATH 312", "course_name": "Linear Algebra I", "credits": 3},
            {"course_code": "MGBU 200", "course_name": "Introduction to Business for Non-Business Majors", "credits": 3},
        ],
    },
    "artificial_intelligence_major_requirements": {
        "credits": 56,
        "courses": [
            {"course_code": "COSC 111", "course_name": "Introduction to Computer Science I", "credits": 4},
            {"course_code": "COSC 112", "course_name": "Introduction to Computer Science II", "credits": 4},
            {"course_code": "COSC 220", "course_name": "Data Structures and Algorithms", "credits": 4},
            {"course_code": "COSC 349", "course_name": "Computer Networks", "credits": 3},
            {"course_code": "COSC 351", "course_name": "Cybersecurity", "credits": 3},
            {"course_code": "COSC 354", "course_name": "Operating Systems", "credits": 3},
            {"course_code": "CLCO 261", "course_name": "Introduction to Cloud Computing", "credits": 3},
            {"course_code": "CLCO 341", "course_name": "Machine Learning in the Cloud", "credits": 3},
            {"course_code": "CLCO 401", "course_name": "Cloud Applications", "credits": 3},
            {"course_code": "CLCO 490", "course_name": "Senior Project in Cloud Computing", "credits": 3},
        ],
    },
    "natural_science_complementary_studies": {
        "credits": 6,
        "courses": [
            {"course_code": "XXXX", "course_name": "SCMNS 200-499 complementary study", "credits": 3},
            {"course_code": "XXXX", "course_name": "SCMNS 200-499 complementary study", "credits": 3},
        ],
    },
    "elective_groups": {
        "group_a": {
            "name": "ARTI Group A Electives",
            "required_courses": 2,
            "description": "Choose two courses from Group A.",
            "courses": [
                {"course_code": "COSC 238", "course_name": "AI Group A Elective", "credits": 4},
                {"course_code": "COSC 239", "course_name": "AI Group A Elective", "credits": 3},
                {"course_code": "COSC 243", "course_name": "AI Group A Elective", "credits": 3},
                {"course_code": "COSC 251", "course_name": "Introduction to Data Science", "credits": 3},
                {"course_code": "COSC 281", "course_name": "Discrete Structure", "credits": 3},
                {"course_code": "MATH 242", "course_name": "Calculus II", "credits": 4},
            ],
        },
        "group_b": {
            "name": "ARTI Group B Electives",
            "required_courses": 3,
            "description": "Choose three courses from Group B.",
            "courses": [
                {"course_code": "CLCO 312", "course_name": "Data Science for Social Good", "credits": 3},
                {"course_code": "COSC 320", "course_name": "Algorithm Design and Analysis", "credits": 3},
                {"course_code": "COSC 323", "course_name": "Introduction to Cryptography", "credits": 3},
                {"course_code": "COSC 332", "course_name": "Introduction to Game Design and Development", "credits": 3},
                {"course_code": "COSC 345", "course_name": "Introduction to High Performance Computing", "credits": 3},
                {"course_code": "COSC 358", "course_name": "Network Security Fundamentals", "credits": 3},
                {"course_code": "COSC 383", "course_name": "Numerical Methods and Programming", "credits": 3},
                {"course_code": "COSC 385", "course_name": "Theory of Languages and Automata", "credits": 3},
                {"course_code": "COSC 386", "course_name": "Introduction to Quantum Computing", "credits": 3},
                {"course_code": "MATH 313", "course_name": "Linear Algebra II", "credits": 3},
                {"course_code": "MATH 331", "course_name": "Applied Probability and Statistics", "credits": 3},
            ],
        },
        "group_c": {
            "name": "ARTI Group C Electives",
            "required_courses": 4,
            "description": "Choose four courses from Group C.",
            "courses": [
                {"course_code": "COSC 458", "course_name": "Software Engineering", "credits": 3},
                {"course_code": "COSC 459", "course_name": "Database Design", "credits": 3},
                {"course_code": "COSC 470", "course_name": "Artificial Intelligence", "credits": 3},
                {"course_code": "COSC 472", "course_name": "Introduction to Machine Learning", "credits": 3},
                {"course_code": "COSC 474", "course_name": "Artificial Intelligence in Cybersecurity", "credits": 3},
                {"course_code": "COSC 486", "course_name": "Applied Quantum Computing", "credits": 3},
                {"course_code": "COSC 491", "course_name": "Conference Course", "credits": 3},
                {"course_code": "COSC 498", "course_name": "Senior Internship", "credits": 3},
                {"course_code": "COSC 499", "course_name": "Senior Research or Teaching/Tutorial Assistantship", "credits": 3},
                {"course_code": "CLCO 471", "course_name": "Data Analytics in Cloud", "credits": 3},
            ],
        },
    },
}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def normalize_degree_profile(value: str | None, catalog_year: str | None = None) -> dict[str, Any]:
    raw = value or ""
    text = _slug(raw)
    key = PROFILE_ALIASES.get(text)
    if key is None:
        if "artificial intelligence" in text:
            key = "artificial_intelligence_bs"
        elif "cloud" in text:
            key = "cloud_computing_bs_legacy"
        elif "computer science" in text or not text:
            key = DEFAULT_PROFILE_KEY
        else:
            key = DEFAULT_PROFILE_KEY

    meta = copy.deepcopy(PROFILE_META.get(key, PROFILE_META[DEFAULT_PROFILE_KEY]))
    meta.update({
        "key": key,
        "raw_degree_program": raw or None,
        "catalog_year": catalog_year,
        "inferred": bool(raw),
        "needs_confirmation": key == DEFAULT_PROFILE_KEY and bool(raw) and "computer science" not in text,
    })
    return meta


def degree_profile_from_dw(dw_dict: dict | None) -> dict[str, Any]:
    if not dw_dict:
        return normalize_degree_profile(None)
    return normalize_degree_profile(dw_dict.get("degree_program"), dw_dict.get("catalog_year"))


@lru_cache(maxsize=1)
def _load_degree_records() -> list[dict[str, Any]]:
    with open(os.path.join(DATA_DIR, "degree.json"), encoding="utf-8") as f:
        data = json.load(f)
    return data.get("degrees_offered", [])


@lru_cache(maxsize=1)
def _course_fact_map() -> dict[str, dict[str, Any]]:
    with open(os.path.join(DATA_DIR, "classes.json"), encoding="utf-8") as f:
        data = json.load(f)
    return {
        normalize_course_code(c.get("course_code", "")): c
        for c in data.get("courses", [])
        if normalize_course_code(c.get("course_code", ""))
    }


def _record_for_profile(profile_key: str) -> dict[str, Any] | None:
    if profile_key == "artificial_intelligence_bs":
        return copy.deepcopy(AI_PROFILE)
    wanted = {
        "computer_science_bs": "computer science",
        "cloud_computing_bs_legacy": "cloud computing",
    }.get(profile_key, "computer science")
    for record in _load_degree_records():
        if wanted in (record.get("degree_name") or "").lower():
            return copy.deepcopy(record)
    return None


def _sequence_map(record: dict[str, Any]) -> dict[str, int]:
    sequence = {}
    order = [
        "first_year",
        "second_year",
        "third_year",
        "fourth_year",
    ]
    curriculum_sequence = record.get("suggested_curriculum_sequence") or {}
    semester_number = 1
    for year in order:
        for term in curriculum_sequence.get(year) or []:
            for course in term.get("courses") or []:
                code = normalize_course_code(course.get("course_code", ""))
                if code and code != "XXXX" and code not in sequence:
                    sequence[code] = semester_number
            semester_number += 1
    return sequence


def _merge_course(
    courses_by_code: dict[str, dict[str, Any]],
    source_course: dict[str, Any],
    category: str,
    requirement_type: str,
    sequence: dict[str, int],
    note: str | None = None,
) -> None:
    code = normalize_course_code(source_course.get("course_code", ""))
    if not code or code == "XXXX":
        return
    facts = _course_fact_map().get(code, {})
    merged = {
        "course_code": code,
        "course_name": facts.get("course_name") or source_course.get("course_name") or code,
        "credits": facts.get("credits") or source_course.get("credits") or 0,
        "category": category,
        "requirement_type": requirement_type,
        "prerequisites": facts.get("prerequisites", []),
        "offered": facts.get("offered", ["Fall", "Spring"]),
        "sequence": sequence.get(code),
    }
    if note:
        merged["elective_note"] = note
    existing = courses_by_code.get(code)
    if existing and CATEGORY_PRIORITY.get(existing.get("requirement_type", "other"), 99) <= CATEGORY_PRIORITY.get(requirement_type, 99):
        if not existing.get("sequence") and merged.get("sequence"):
            existing["sequence"] = merged["sequence"]
        return
    courses_by_code[code] = merged


def _elective_requirements(record: dict[str, Any]) -> dict[str, dict[str, Any]]:
    explicit = record.get("elective_groups") or {}
    if explicit:
        return {
            key: {
                "name": value.get("name", key.replace("_", " ").title()),
                "required_courses": value.get("required_courses", 1),
                "description": value.get("description", ""),
            }
            for key, value in explicit.items()
        }

    reqs = {}
    for section in record.values():
        if not isinstance(section, dict):
            continue
        counts = {}
        for course in section.get("courses") or []:
            name = course.get("course_name") or ""
            match = re.search(r"(?:COSC|CLCO|ARTI)\s+Group\s+([A-D])\s+Elective", name, flags=re.I)
            if match:
                key = f"group_{match.group(1).lower()}"
                counts[key] = counts.get(key, 0) + 1
        for key, count in counts.items():
            prefix = "CLCO" if "cloud" in (record.get("degree_name") or "").lower() else "COSC"
            group = key[-1].upper()
            reqs[key] = {
                "name": f"{prefix} Group {group} Electives",
                "required_courses": count,
                "description": f"Choose {count} course{'s' if count != 1 else ''} from Group {group}.",
            }
    return reqs


def curriculum_for_profile(profile_key: str | None = None) -> dict[str, Any]:
    profile = PROFILE_META.get(profile_key or DEFAULT_PROFILE_KEY)
    selected_key = profile_key if profile else DEFAULT_PROFILE_KEY
    record = _record_for_profile(selected_key) or _record_for_profile(DEFAULT_PROFILE_KEY)
    sequence = _sequence_map(record)
    courses_by_code: dict[str, dict[str, Any]] = {}

    for section_key, (category, requirement_type) in SECTION_CATEGORY.items():
        section = record.get(section_key)
        if not isinstance(section, dict):
            continue
        for course in section.get("courses") or []:
            _merge_course(courses_by_code, course, category, requirement_type, sequence)

    elective_requirements = _elective_requirements(record)
    for group_key, group in (record.get("elective_groups") or {}).items():
        category = f"Group {group_key[-1].upper()} Elective"
        for course in group.get("courses") or []:
            _merge_course(courses_by_code, course, category, group_key, sequence, group.get("description"))

    # CS legacy data keeps actual elective options in classes.json instead of degree.json.
    if selected_key == "computer_science_bs":
        for facts in _course_fact_map().values():
            req = facts.get("requirement_type")
            if req in {"group_a", "group_b", "group_c", "group_d"}:
                _merge_course(
                    courses_by_code,
                    facts,
                    facts.get("category", "Elective"),
                    req,
                    sequence,
                    facts.get("elective_note"),
                )

    courses = sorted(
        courses_by_code.values(),
        key=lambda c: (
            CATEGORY_PRIORITY.get(c.get("requirement_type", "other"), 99),
            c.get("sequence") or 99,
            c.get("course_code") or "",
        ),
    )

    meta = normalize_degree_profile(record.get("degree_name"))
    meta.update(PROFILE_META.get(selected_key, {}))
    meta["key"] = selected_key
    supporting_credits = (record.get("supporting_courses") or {}).get("credits")
    major_credits = next(
        (
            section.get("credits")
            for key, section in record.items()
            if key.endswith("_major_requirements") and isinstance(section, dict)
        ),
        None,
    )
    degree_info = {
        "program": meta["display_name"],
        "profile_key": selected_key,
        "profile_status": meta["status"],
        "university": "Morgan State University",
        "total_credits": record.get("total_credits", 120),
        "general_education_credits": (record.get("general_education_requirements") or {}).get("credits"),
        "supporting_credits": supporting_credits,
        "major_credits": major_credits,
        "cs_core_credits": (supporting_credits or 0) + (major_credits or 0) or None,
        "description": f"Requirements for {meta['display_name']} at Morgan State University.",
        "source": meta.get("source"),
        "warning": meta.get("warning"),
        "source_notes": record.get("source_notes", []),
    }

    return {
        "degree_info": degree_info,
        "degree_profile": meta,
        "courses": courses,
        "elective_requirements": elective_requirements,
    }


def curriculum_for_degree_program(degree_program: str | None, catalog_year: str | None = None) -> dict[str, Any]:
    profile = normalize_degree_profile(degree_program, catalog_year)
    result = curriculum_for_profile(profile["key"])
    result["degree_profile"].update({
        "raw_degree_program": profile.get("raw_degree_program"),
        "catalog_year": profile.get("catalog_year"),
        "needs_confirmation": profile.get("needs_confirmation"),
    })
    return result
