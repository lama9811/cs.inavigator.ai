"""
Prerequisite graph engine.
Ripple Effect (Phase 3) and Semester Architect (Phase 4) live here.
"""

import json
import os
from typing import Optional
from .course_utils import normalize_course_code, extract_course_codes


# Courses whose prereq lists are OR (alternatives), not AND (all required).
# Determined by manual catalog verification.
# Key: normalized course code. Value: True means prereqs are alternatives.
OR_PREREQ_COURSES = {
    "MATH 241",  # Placement alternatives: ENGR 101, MATH 114, MATH 141, or dept permission
}

# Curriculum-sequence position: which semester (1-8) each course sits in on the
# official Computer Science Curriculum Sequence sheet. Used as a soft ordering hint
# so the planner recommends the courses that come NEXT in the sequence rather than
# skipping ahead. It's a guide, not a hard rule — students who are off-sequence
# still get eligible courses; earlier-sequence ones are just preferred. Electives
# have no fixed slot, so they're left out (default: late).
CURRICULUM_SEQUENCE = {
    # Semester 1
    "COSC 111": 1, "MATH 241": 1,
    # Semester 2
    "COSC 112": 2, "MATH 242": 2,
    # Semester 3
    "COSC 220": 3, "COSC 241": 3, "COSC 201": 3,
    # Semester 4
    "COSC 281": 4, "MATH 312": 4,
    # Semester 5
    "COSC 349": 5, "COSC 351": 5, "COSC 352": 5,
    # Semester 6
    "COSC 354": 6, "MATH 331": 6,
    # Semester 7
    "COSC 458": 7, "COSC 459": 7, "COSC 490": 7,
    # Cloud Computing sequence anchors (shared program)
    "CLCO 261": 4, "CLCO 490": 7, "CLCO 401": 8,
}


def parse_prerequisites(prereq_list: list[str], course_code: str = "") -> dict:
    """Parse a prerequisites list into structured data with AND/OR logic.

    Returns:
        {
            "logic": "all" | "any",
            "course_prereqs": ["COSC 112", "MATH 241"],  # normalized codes
            "non_course_prereqs": ["Senior standing", "3.0 GPA"],
            "raw": ["COSC 112 (Grade C or higher)", ...]
        }
    """
    normalized_code = normalize_course_code(course_code) if course_code else ""
    logic = "any" if normalized_code in OR_PREREQ_COURSES else "all"

    course_prereqs = []
    non_course_prereqs = []

    for prereq_str in prereq_list:
        codes = extract_course_codes(prereq_str)
        if codes:
            course_prereqs.extend(codes)
        else:
            # Non-course prereq like "Senior standing", "3.0 GPA", "Departmental permission"
            non_course_prereqs.append(prereq_str.strip())

    return {
        "logic": logic,
        "course_prereqs": course_prereqs,
        "non_course_prereqs": non_course_prereqs,
        "raw": prereq_list,
    }


def load_curriculum(data_dir: str = None) -> list[dict]:
    """Load and parse classes.json curriculum data.

    Returns list of course dicts with parsed prerequisites.
    """
    if data_dir is None:
        data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data_sources")

    classes_path = os.path.join(data_dir, "classes.json")
    with open(classes_path) as f:
        data = json.load(f)

    courses = []
    for c in data.get("courses", []):
        parsed = {
            "code": normalize_course_code(c.get("course_code", "")),
            "name": c.get("course_name", ""),
            "credits": c.get("credits", 0),
            "category": c.get("category", ""),
            "requirement_type": c.get("requirement_type", ""),
            "offered": c.get("offered", []),
            "prerequisites": parse_prerequisites(
                c.get("prerequisites", []),
                c.get("course_code", "")
            ),
        }
        courses.append(parsed)

    return courses


# Cache the static curriculum (doesn't change at runtime)
_curriculum_cache = None

def _get_curriculum() -> list[dict]:
    global _curriculum_cache
    if _curriculum_cache is None:
        _curriculum_cache = load_curriculum()
    return _curriculum_cache


def build_prerequisite_graph(dw_dict: Optional[dict], canvas_dict: Optional[dict]) -> dict:
    """Build the full prerequisite dependency graph with student status overlay.

    Args:
        dw_dict: DegreeWorks data (courses_completed, courses_in_progress, courses_remaining)
        canvas_dict: Canvas data (courses with current_score)

    Returns:
        {nodes, edges, danger_paths, stats}
    """
    curriculum = _get_curriculum()

    # Build completed/in-progress maps from DegreeWorks
    completed_map = {}  # code -> grade
    in_progress_set = set()

    if dw_dict:
        if dw_dict.get("courses_completed"):
            completed = json.loads(dw_dict["courses_completed"]) if isinstance(dw_dict["courses_completed"], str) else dw_dict["courses_completed"]
            for c in completed:
                code = normalize_course_code(c.get("code", ""))
                if code:
                    completed_map[code] = c.get("grade", "")

        if dw_dict.get("courses_in_progress"):
            in_progress = json.loads(dw_dict["courses_in_progress"]) if isinstance(dw_dict["courses_in_progress"], str) else dw_dict["courses_in_progress"]
            for c in in_progress:
                code = normalize_course_code(c.get("code", ""))
                if code:
                    in_progress_set.add(code)

    # Build Canvas score map
    canvas_scores = {}
    if canvas_dict and canvas_dict.get("courses"):
        courses_list = json.loads(canvas_dict["courses"]) if isinstance(canvas_dict["courses"], str) else canvas_dict["courses"]
        for c in courses_list:
            code = normalize_course_code(c.get("code", "") or c.get("course_code", ""))
            score = c.get("current_score")
            if code and score is not None:
                canvas_scores[code] = score

    # Build nodes and edges
    nodes = []
    edges = []
    code_to_node = {}

    for course in curriculum:
        code = course["code"]
        prereqs = course["prerequisites"]

        # Determine status
        if code in completed_map:
            status = "completed"
            current_score = None
            grade = completed_map[code]
        elif code in in_progress_set:
            score = canvas_scores.get(code)
            current_score = score
            if score is not None and score < 70:
                status = "at_risk"
            else:
                status = "in_progress"
            grade = None
        else:
            status = "future"
            current_score = None
            grade = None

        node = {
            "id": code,
            "name": course["name"],
            "credits": course["credits"],
            "category": course["category"],
            "offered": course["offered"],
            "sequence": CURRICULUM_SEQUENCE.get(code),  # curriculum-sequence semester (1-8), or None
            "status": status,
            "current_score": current_score,
            "grade": grade,
            "at_risk": status == "at_risk",
            "unlocks": [],
            "blocked_by": [],
            "prereq_logic": prereqs["logic"],
        }
        nodes.append(node)
        code_to_node[code] = node

        # Build edges from prerequisites
        for prereq_code in prereqs["course_prereqs"]:
            if prereq_code in {c["code"] for c in curriculum}:
                edges.append({
                    "from": prereq_code,
                    "to": code,
                    "type": prereqs["logic"],
                })

    # Build unlocks/blocked_by from edges
    for edge in edges:
        src = code_to_node.get(edge["from"])
        tgt = code_to_node.get(edge["to"])
        if src and tgt:
            if edge["to"] not in src["unlocks"]:
                src["unlocks"].append(edge["to"])
            if edge["from"] not in tgt["blocked_by"]:
                tgt["blocked_by"].append(edge["from"])

    # Compute danger paths: BFS from each at_risk node
    danger_paths = []
    at_risk_nodes = [n for n in nodes if n["at_risk"]]

    for risk_node in at_risk_nodes:
        cascade = []
        visited = set()
        queue = list(risk_node["unlocks"])

        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            node = code_to_node.get(current)
            if node and node["status"] != "completed":
                cascade.append(current)
                queue.extend(node["unlocks"])

        if cascade:
            delay = _estimate_graduation_delay(risk_node, cascade, code_to_node)
            danger_paths.append({
                "root_course": risk_node["id"],
                "root_name": risk_node["name"],
                "current_score": risk_node["current_score"],
                "cascade": cascade,
                "cascade_count": len(cascade),
                "graduation_delay_semesters": delay,
            })

    # Stats
    stats = {
        "total": len(nodes),
        "completed": sum(1 for n in nodes if n["status"] == "completed"),
        "in_progress": sum(1 for n in nodes if n["status"] == "in_progress"),
        "at_risk": sum(1 for n in nodes if n["status"] == "at_risk"),
        "future": sum(1 for n in nodes if n["status"] == "future"),
    }

    return {
        "nodes": nodes,
        "edges": edges,
        "danger_paths": danger_paths,
        "stats": stats,
    }


def _estimate_graduation_delay(risk_node: dict, cascade: list, code_to_node: dict) -> int:
    """Estimate how many semesters failing this course delays graduation.

    Uses the offered semesters to determine how long the chain would take to recover.
    """
    # Find the longest chain depth from risk_node through cascade
    # Each course in the chain = at least 1 semester
    # If a course is only offered once per year, that doubles the delay

    def _chain_depth(code, visited=None):
        if visited is None:
            visited = set()
        if code in visited:
            return 0
        visited.add(code)
        node = code_to_node.get(code)
        if not node:
            return 0
        max_child = 0
        for child in node["unlocks"]:
            if child in cascade:
                max_child = max(max_child, _chain_depth(child, visited))
        return 1 + max_child

    depth = _chain_depth(risk_node["id"])

    # If the risk course is only offered once a year, add 1 extra semester
    offered = risk_node.get("offered", [])
    if len(offered) == 1:
        depth += 1

    return max(1, depth)
