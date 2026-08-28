import asyncio
import os

os.environ.setdefault("JWT_SECRET", "test-only")

import main


def test_admin_courses_reads_full_classes_catalog():
    result = asyncio.run(main.admin_courses(user={"role": "admin"}))
    codes = {course["course_code"] for course in result["courses"]}

    assert "CLCO 341" in codes
    assert "COSC 474" in codes
    assert "MGBU 200" in codes


def test_local_kb_file_list_includes_structured_ai_docs():
    result = asyncio.run(main.list_kb_files(user={"role": "admin"}))
    filenames = {item["filename"] for item in result["files"]}

    assert "kb_structured/academic_ai_degree_requirements.json" in filenames
    assert "kb_structured/academic_ai_course_prerequisites.json" in filenames
