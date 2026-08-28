import json
import os

os.environ.setdefault("JWT_SECRET", "test-only")

import main


def test_parse_degreeworks_whatif_artificial_intelligence_audit():
    text = """
    Worksheets
    Level Undergraduate Classification 3-Junior Major Computer Science
    Program Computer Science College Sch of Comp, Math/Natural Sci
    Degree progress
    Overall GPA 4.000
    Bachelor of Science
    Credits required: 120 Catalog year: FALL 2026
    Credits applied: 95 GPA: 4.000
    Major in Artificial Intelligence
    INCOMPLETE
    ARTIFICIAL INTELLIGENCE SUPPORTING COURSES
    ARTIFICIAL INTELLIGENCE REQUIRED COURSES
    Course COSC 239
    Title JAVA PROGRAMMING
    Grade A
    Credits 3
    Term SPRING 2026
    Repeated
    Course COSC 251
    Title INTRODUCTION TO DATA SCIENCE
    Grade IP
    Credits (3)
    Term FALL 2026
    Repeated
    Disclaimer
    Course WGST 201
    Title INTRO TO WOMEN GENDER STUDIES
    Grade IP
    Credits (3)
    Term FALL 2026
    """

    data = main.parse_degreeworks_pdf(text)
    completed = json.loads(data["courses_completed"])
    in_progress = json.loads(data["courses_in_progress"])

    assert data["degree_program"] == "Bachelor of Science in Artificial Intelligence"
    assert data["_audit_type"] == "what_if"
    assert data["classification"] == "Junior"
    assert data["catalog_year"] == "FALL 2026"
    assert data["overall_gpa"] == 4.0
    assert data["total_credits_earned"] == 95.0
    assert data["credits_required"] == 120.0
    assert data["credits_remaining"] == 25.0
    assert completed[0]["code"] == "COSC 239"
    assert completed[0]["grade"] == "A"
    assert in_progress[0]["code"] == "COSC 251"
    assert in_progress[0]["status"] == "in_progress"
    assert in_progress[1]["code"] == "WGST 201"
