import os

os.environ.setdefault("JWT_SECRET", "test-only")

from services.degree_profiles import (
    curriculum_for_degree_program,
    curriculum_for_profile,
    degree_profile_from_dw,
    normalize_degree_profile,
)
from services.prereq_engine import build_prerequisite_graph


def _codes(curriculum):
    return {course["course_code"] for course in curriculum["courses"]}


def test_degree_profile_normalizes_cloud_and_ai_programs():
    cloud = normalize_degree_profile("Bachelor of Science in Cloud Computing", "2024-2025")
    ai = normalize_degree_profile("B.S. in Artificial Intelligence", "2026-2028")

    assert cloud["key"] == "cloud_computing_bs_legacy"
    assert cloud["status"] == "legacy"
    assert cloud["catalog_year"] == "2024-2025"
    assert ai["key"] == "artificial_intelligence_bs"
    assert ai["status"] == "draft_review"


def test_cloud_profile_keeps_clco_requirements_without_cs_only_core():
    curriculum = curriculum_for_profile("cloud_computing_bs_legacy")
    codes = _codes(curriculum)

    assert curriculum["degree_info"]["profile_status"] == "legacy"
    assert "CLCO 261" in codes
    assert "CLCO 401" in codes
    assert "CLCO 490" in codes
    assert "COSC 352" not in codes


def test_ai_profile_is_draft_and_keeps_ai_elective_groups():
    curriculum = curriculum_for_degree_program("Bachelor of Science in Artificial Intelligence")
    codes = _codes(curriculum)

    assert curriculum["degree_info"]["profile_key"] == "artificial_intelligence_bs"
    assert curriculum["degree_info"]["profile_status"] == "draft_review"
    assert curriculum["degree_info"]["warning"]
    assert curriculum["elective_requirements"]["group_a"]["required_courses"] == 2
    assert curriculum["elective_requirements"]["group_b"]["required_courses"] == 3
    assert curriculum["elective_requirements"]["group_c"]["required_courses"] == 4
    assert "CLCO 341" in codes
    assert "COSC 470" in codes
    assert "COSC 472" in codes


def test_ripple_graph_uses_degreeworks_profile():
    graph = build_prerequisite_graph({
        "degree_program": "Bachelor of Science in Cloud Computing",
        "catalog_year": "2024-2025",
        "courses_completed": "[]",
        "courses_in_progress": "[]",
    }, None)
    node_ids = {node["id"] for node in graph["nodes"]}

    assert graph["degree_profile"]["key"] == "cloud_computing_bs_legacy"
    assert "CLCO 261" in node_ids
    assert "COSC 352" not in node_ids


def test_ripple_profile_override_keeps_student_course_status():
    graph = build_prerequisite_graph({
        "degree_program": "Bachelor of Science in Computer Science",
        "catalog_year": "2024-2025",
        "courses_completed": '[{"code":"COSC 111","name":"Intro","grade":"A"}]',
        "courses_in_progress": '[{"code":"COSC 251","name":"Data Science"}]',
    }, None, profile_key="artificial_intelligence_bs")
    nodes = {node["id"]: node for node in graph["nodes"]}

    assert graph["degree_profile"]["key"] == "artificial_intelligence_bs"
    assert nodes["COSC 111"]["status"] == "completed"
    assert nodes["COSC 251"]["status"] == "in_progress"
    assert "CLCO 341" in nodes


def test_unknown_degree_falls_back_to_cs_with_confirmation_flag():
    profile = degree_profile_from_dw({"degree_program": "Bachelor of Science in Something Else"})

    assert profile["key"] == "computer_science_bs"
    assert profile["needs_confirmation"] is True
