"""Coding-attempt telemetry — record HOW a student failed, not just THAT they did.

`CodingPracticeProgress` answers "did they solve it?". This module answers "what went
wrong on the way?" — the difference between a student who can't write valid Java and a
student who can't think of the algorithm. Those need different teaching, and today we
throw that signal away on every run.

Design rules:

* **Append-only.** One row per Run / Submit / free run. Never updated, never deleted by
  the app, so the history stays a faithful record.
* **Never blocks the run.** `record_attempt` swallows every exception. A telemetry bug
  must never turn a working code run into a 500 — the student's run is the product;
  this is instrumentation.
* **Store the shape of a failure, not the code.** Test names and an error class, not the
  student's source. `code_len` is a size.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from sqlalchemy.orm import Session

from models import CodingAttemptEvent

# Outcomes and error classes. Kept as plain strings (matching the rest of the coding
# models) but centralized here so a typo can't quietly invent a new category and
# fragment the data we're collecting this table to analyze.
OUTCOME_PASS = "pass"
OUTCOME_FAIL = "fail"
OUTCOME_ERROR = "error"
OUTCOME_TIMEOUT = "timeout"

ERROR_SYNTAX = "syntax"
ERROR_RUNTIME = "runtime"
ERROR_WRONG_ANSWER = "wrong_answer"
ERROR_TIMEOUT = "timeout"

# Cap what we persist so one pathological run can't write an unbounded row.
MAX_FAILED_TESTS = 25
MAX_SECONDS_SINCE_OPEN = 24 * 60 * 60  # a day; anything beyond is a stale tab, not effort

# A compile/parse failure names itself in every language we run. Matched against the
# runner's stderr/error text, which is the only place the distinction survives — the
# run result itself just says "error" for both a missing semicolon and a null deref.
_SYNTAX_PATTERNS = re.compile(
    r"""
      SyntaxError            # Python
    | IndentationError       # Python
    | TabError               # Python
    | \berror:\s*';'\s*expected   # Java (javac)
    | \bcannot\s+find\s+symbol    # Java (javac) - undeclared name
    | \bclass,\s*interface        # Java (javac) - "class, interface, or enum expected"
    | \billegal\s+start\s+of      # Java (javac)
    | \bcompilation\s+failed      # generic compiler
    | \bcompile\s+error           # generic compiler
    | \berror:\s*expected         # C++ (g++/clang)
    | \bwas\s+not\s+declared      # C++ (g++)
    | \bparse\s+error             # generic
    | Unexpected\s+token          # JavaScript
    | Unexpected\s+identifier     # JavaScript
    | Invalid\s+or\s+unexpected   # JavaScript
    | \bis\s+not\s+defined        # JavaScript - ReferenceError at load
    """,
    re.IGNORECASE | re.VERBOSE,
)

_TIMEOUT_PATTERNS = re.compile(r"timed\s*out|timeout|time\s+limit", re.IGNORECASE)


def _error_text(run_result: dict[str, Any]) -> str:
    """The runner reports failures in different keys depending on where it broke:
    `stderr` for a process-level failure, `error` for one raised inside the sandbox.
    Read both."""
    parts = [
        str(run_result.get("stderr") or ""),
        str(run_result.get("error") or ""),
        str(run_result.get("message") or ""),
    ]
    return "\n".join(p for p in parts if p)


def classify(run_result: dict[str, Any]) -> tuple[str, Optional[str]]:
    """Map a runner result onto (outcome, error_class).

    This is the whole point of the table. A run that says `status: "error"` could be a
    missing semicolon (the student doesn't know the language) or an index out of range
    (the student's logic is wrong). Only the error text can tell them apart, and only
    here do we still have it.

    Returns error_class=None on a pass — there is no failure to classify.
    """
    status = str(run_result.get("status") or "").lower()
    text = _error_text(run_result)

    # A pass is a pass. "ran" is the free-run equivalent (no tests to pass/fail).
    if status in {"passed", "ran"}:
        return OUTCOME_PASS, None

    # Timeout is checked before syntax: an infinite loop is a distinct, teachable
    # failure, and it is never a compile error.
    if _TIMEOUT_PATTERNS.search(text):
        return OUTCOME_TIMEOUT, ERROR_TIMEOUT

    if status == "error":
        if _SYNTAX_PATTERNS.search(text):
            return OUTCOME_ERROR, ERROR_SYNTAX
        return OUTCOME_ERROR, ERROR_RUNTIME

    if status == "failed":
        # Tests ran and some returned the wrong value. But a test that *threw* is a
        # runtime error wearing a failed-test costume — the student's code crashed, it
        # didn't merely compute the wrong answer. Distinguish them, because "your logic
        # is off" and "your code crashed" are different lessons.
        tests = run_result.get("tests") or []
        failing = [t for t in tests if isinstance(t, dict) and not t.get("passed")]
        if failing and all(t.get("error") for t in failing):
            return OUTCOME_FAIL, ERROR_RUNTIME
        return OUTCOME_FAIL, ERROR_WRONG_ANSWER

    # Unknown status — record it as an error rather than guessing a class.
    return OUTCOME_ERROR, None


def failed_test_names(run_result: dict[str, Any]) -> list[str]:
    """Names of the tests that did not pass. Names only — never the student's code, and
    never the test's expected value (which would leak the answer into the log)."""
    tests = run_result.get("tests") or []
    names: list[str] = []
    for test in tests:
        if not isinstance(test, dict) or test.get("passed"):
            continue
        name = str(test.get("name") or "").strip()
        if name:
            names.append(name[:120])
        if len(names) >= MAX_FAILED_TESTS:
            break
    return names


def _clamp_seconds(value: Any) -> Optional[int]:
    """Client-reported and therefore untrusted. A negative value is nonsense; a huge one
    is a tab left open overnight, not time on task. Both become None rather than
    poisoning the averages we'll compute from this column."""
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return None
    if seconds < 0 or seconds > MAX_SECONDS_SINCE_OPEN:
        return None
    return seconds


def _clamp_hints(value: Any) -> int:
    try:
        hints = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(hints, 10))


def record_attempt(
    db: Session,
    *,
    user_id: int,
    source: str,
    run_result: dict[str, Any],
    language: str,
    code: str,
    question: Optional[dict[str, Any]] = None,
    question_id: Optional[str] = None,
    hints_used: Any = 0,
    seconds_since_open: Any = None,
) -> Optional[CodingAttemptEvent]:
    """Append one attempt event. Returns the row, or None if nothing was written.

    **Never raises.** The caller has already run the student's code; a failure to log it
    must not fail the request. On error we print and return None — the run still
    succeeds, we just lose one row of telemetry.
    """
    try:
        outcome, error_class = classify(run_result)
        failed = failed_test_names(run_result)
        tests = run_result.get("tests") or []

        event = CodingAttemptEvent(
            user_id=user_id,
            source=source,
            question_id=(question_id or (question or {}).get("id") or None),
            topic=(str((question or {}).get("topic") or "").strip() or None),
            difficulty=(str((question or {}).get("difficulty") or "").strip() or None),
            language=language,
            outcome=outcome,
            error_class=error_class,
            tests_passed=int(run_result.get("passed") or 0),
            tests_total=int(run_result.get("total") or len(tests) or 0),
            failed_tests=(json.dumps(failed) if failed else None),
            hints_used=_clamp_hints(hints_used),
            seconds_since_open=_clamp_seconds(seconds_since_open),
            code_len=len(code or ""),
            duration_ms=int(run_result.get("duration_ms") or 0) or None,
        )
        db.add(event)
        db.commit()
        return event
    except Exception as exc:  # noqa: BLE001 - telemetry must never break a run
        print(f"[WARN] Could not record coding attempt telemetry: {exc}")
        try:
            db.rollback()
        except Exception:
            pass
        return None
