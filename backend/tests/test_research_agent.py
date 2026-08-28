import os

os.environ.setdefault("JWT_SECRET", "test-only")

import research_agent


def test_prospective_student_value_question_is_not_a_failed_query(monkeypatch):
    def fail_if_db_touched():
        raise AssertionError("broad value question should not reach failed-query storage")

    monkeypatch.setattr(research_agent, "SessionLocal", fail_if_db_touched)

    logged = research_agent.detect_and_log_failed_query(
        "Can you offer value to prospective students?",
        "I can help prospective students understand Morgan CS, planning, and support options.",
    )

    assert logged is False

