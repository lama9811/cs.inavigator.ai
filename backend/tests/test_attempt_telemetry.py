"""Tests for coding-attempt telemetry.

Two things matter here and the tests are organized around them:

1. **`classify` must tell failure KINDS apart.** The whole reason this table exists is
   that "student can't write valid Java" and "student's algorithm is wrong" are
   different problems. If classification is sloppy, the data is worthless.
2. **`record_attempt` must never break a run.** It is instrumentation bolted onto the
   path that runs the student's code. A telemetry bug turning a working run into a 500
   would be strictly worse than having no telemetry at all.
"""

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base
from models import CodingAttemptEvent, User
from services import attempt_telemetry as t


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(User(id=1, email="s@morgan.edu", password_hash="x"))
    db.commit()
    yield db
    db.close()


# ---------------------------------------------------------------------------
# classify — outcome + error_class
# ---------------------------------------------------------------------------

def test_passed_run_has_no_error_class():
    outcome, err = t.classify({"status": "passed", "tests": [{"name": "T1", "passed": True}]})
    assert outcome == t.OUTCOME_PASS
    assert err is None


def test_freerun_ran_counts_as_pass():
    # A free run has no tests, so "ran" is its success status.
    outcome, err = t.classify({"status": "ran", "stdout": "hi"})
    assert outcome == t.OUTCOME_PASS
    assert err is None


def test_wrong_answer_when_tests_return_bad_values():
    result = {
        "status": "failed",
        "tests": [
            {"name": "T1", "passed": True},
            {"name": "T2", "passed": False, "expected": 5, "actual": 4},
        ],
    }
    outcome, err = t.classify(result)
    assert outcome == t.OUTCOME_FAIL
    assert err == t.ERROR_WRONG_ANSWER


def test_crashing_tests_are_runtime_not_wrong_answer():
    # The student's code THREW. That is a crash, not a miscalculation — and it needs a
    # different lesson. This is the distinction the naive "status == failed -> wrong
    # answer" reading would miss.
    result = {
        "status": "failed",
        "tests": [
            {"name": "T1", "passed": False, "error": "list index out of range"},
            {"name": "T2", "passed": False, "error": "list index out of range"},
        ],
    }
    outcome, err = t.classify(result)
    assert outcome == t.OUTCOME_FAIL
    assert err == t.ERROR_RUNTIME


def test_mixed_crash_and_wrong_answer_is_wrong_answer():
    # Not EVERY failing test threw, so the code does run — it just computes the wrong
    # thing sometimes. Classify by the dominant, teachable signal.
    result = {
        "status": "failed",
        "tests": [
            {"name": "T1", "passed": False, "error": "boom"},
            {"name": "T2", "passed": False, "expected": 5, "actual": 4},
        ],
    }
    assert t.classify(result)[1] == t.ERROR_WRONG_ANSWER


@pytest.mark.parametrize("text", [
    "SyntaxError: invalid syntax",
    "IndentationError: unexpected indent",
    "Main.java:4: error: ';' expected",
    "Main.java:7: error: cannot find symbol",
    "solution.cpp:3:5: error: expected ';' before '}' token",
    "solution.cpp:2:3: error: 'cout' was not declared in this scope",
    "SyntaxError: Unexpected token '}'",
])
def test_compile_and_parse_failures_are_syntax(text):
    outcome, err = t.classify({"status": "error", "stderr": text})
    assert outcome == t.OUTCOME_ERROR
    assert err == t.ERROR_SYNTAX


def test_runtime_error_is_not_misread_as_syntax():
    outcome, err = t.classify({"status": "error", "error": "ZeroDivisionError: division by zero"})
    assert outcome == t.OUTCOME_ERROR
    assert err == t.ERROR_RUNTIME


def test_timeout_wins_over_everything():
    result = {"status": "error", "stderr": "The run timed out after 8 seconds."}
    outcome, err = t.classify(result)
    assert outcome == t.OUTCOME_TIMEOUT
    assert err == t.ERROR_TIMEOUT


def test_unknown_status_records_no_guessed_class():
    outcome, err = t.classify({"status": "banana"})
    assert outcome == t.OUTCOME_ERROR
    assert err is None


# ---------------------------------------------------------------------------
# failed_test_names — shape of the failure, never the answer
# ---------------------------------------------------------------------------

def test_failed_test_names_lists_only_failures():
    result = {"tests": [
        {"name": "T1", "passed": True},
        {"name": "T2", "passed": False},
        {"name": "T3", "passed": False},
    ]}
    assert t.failed_test_names(result) == ["T2", "T3"]


def test_failed_test_names_are_capped():
    result = {"tests": [{"name": f"T{i}", "passed": False} for i in range(100)]}
    assert len(t.failed_test_names(result)) == t.MAX_FAILED_TESTS


# ---------------------------------------------------------------------------
# record_attempt — writes, clamps, and never raises
# ---------------------------------------------------------------------------

def test_record_attempt_writes_a_row(session):
    question = {"id": "two-sum", "topic": "Arrays", "difficulty": "easy"}
    result = {
        "status": "failed",
        "passed": 1,
        "total": 3,
        "duration_ms": 42,
        "tests": [
            {"name": "T1", "passed": True},
            {"name": "T2", "passed": False, "expected": 1, "actual": 0},
            {"name": "T3", "passed": False, "expected": 2, "actual": 0},
        ],
    }
    t.record_attempt(
        session, user_id=1, source="practice", run_result=result,
        language="python", code="def solve(): pass", question=question,
        hints_used=2, seconds_since_open=90,
    )

    row = session.query(CodingAttemptEvent).one()
    assert row.question_id == "two-sum"
    assert row.topic == "Arrays"
    assert row.difficulty == "easy"
    assert row.outcome == t.OUTCOME_FAIL
    assert row.error_class == t.ERROR_WRONG_ANSWER
    assert row.tests_passed == 1
    assert row.tests_total == 3
    assert json.loads(row.failed_tests) == ["T2", "T3"]
    assert row.hints_used == 2
    assert row.seconds_since_open == 90
    assert row.code_len == len("def solve(): pass")
    assert row.duration_ms == 42


def test_record_attempt_never_stores_the_students_code(session):
    secret = "def solve(nums): return 'my actual solution'"
    t.record_attempt(
        session, user_id=1, source="practice",
        run_result={"status": "passed", "passed": 1, "total": 1, "tests": []},
        language="python", code=secret, question={"id": "q1", "topic": "Arrays"},
    )
    row = session.query(CodingAttemptEvent).one()
    # Only the SIZE is kept. Nothing on the row should contain the source.
    assert row.code_len == len(secret)
    for value in vars(row).values():
        assert secret not in str(value)


def test_freerun_records_without_a_question(session):
    t.record_attempt(
        session, user_id=1, source="freerun",
        run_result={"status": "ran", "stdout": "hi"},
        language="python", code="print('hi')",
    )
    row = session.query(CodingAttemptEvent).one()
    assert row.source == "freerun"
    assert row.question_id is None
    assert row.topic is None
    assert row.outcome == t.OUTCOME_PASS


@pytest.mark.parametrize("bad,expected", [
    (-5, None),               # negative time is nonsense
    (999999, None),           # a tab left open for days is not time on task
    ("abc", None),            # client sent garbage
    (None, None),
])
def test_seconds_since_open_is_clamped(session, bad, expected):
    t.record_attempt(
        session, user_id=1, source="practice",
        run_result={"status": "passed", "tests": []},
        language="python", code="x", question={"id": "q1"},
        seconds_since_open=bad,
    )
    assert session.query(CodingAttemptEvent).one().seconds_since_open is expected


def test_hints_used_is_clamped(session):
    t.record_attempt(
        session, user_id=1, source="practice",
        run_result={"status": "passed", "tests": []},
        language="python", code="x", question={"id": "q1"},
        hints_used=9999,
    )
    assert session.query(CodingAttemptEvent).one().hints_used == 10


def test_record_attempt_swallows_db_errors(session):
    """The contract that matters most: telemetry must not break the student's run.

    A broken DB must return None, not raise — the caller has already executed the code
    and owes the student their result."""
    class Boom:
        def add(self, _):
            raise RuntimeError("db is down")
        def commit(self):
            raise RuntimeError("db is down")
        def rollback(self):
            raise RuntimeError("still down")

    assert t.record_attempt(
        Boom(), user_id=1, source="practice",
        run_result={"status": "passed", "tests": []},
        language="python", code="x",
    ) is None


def test_record_attempt_survives_a_malformed_run_result(session):
    # The runner should never hand us this, but a crash here would 500 a working run.
    assert t.record_attempt(
        session, user_id=1, source="practice",
        run_result={"status": "failed", "tests": "not-a-list", "passed": "seven"},
        language="python", code="x",
    ) is None


def test_events_are_append_only(session):
    """Two attempts on the same question produce two rows, not an overwrite. That is the
    entire difference between this table and CodingPracticeProgress."""
    question = {"id": "two-sum", "topic": "Arrays", "difficulty": "easy"}
    t.record_attempt(
        session, user_id=1, source="practice",
        run_result={"status": "error", "stderr": "SyntaxError: invalid syntax", "tests": []},
        language="python", code="def solve(", question=question,
    )
    t.record_attempt(
        session, user_id=1, source="practice",
        run_result={"status": "passed", "passed": 3, "total": 3, "tests": []},
        language="python", code="def solve(): return 1", question=question,
    )

    rows = session.query(CodingAttemptEvent).order_by(CodingAttemptEvent.id).all()
    assert len(rows) == 2
    # The history survives: we can still see they hit a syntax error before solving it.
    assert [(r.outcome, r.error_class) for r in rows] == [
        (t.OUTCOME_ERROR, t.ERROR_SYNTAX),
        (t.OUTCOME_PASS, None),
    ]
