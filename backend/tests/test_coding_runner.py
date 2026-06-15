from coding_runner import (
    RUN_MAX_OUTPUT_CHARS,
    check_practice_run_rate_limit,
    run_javascript_practice_tests,
    run_python_practice_tests,
)


COUNT_VOWELS_TESTS = [
    {"name": "lowercase word", "args": ["hello"], "expected": 2},
    {"name": "mixed case sentence", "args": ["Morgan State"], "expected": 4},
]


def test_python_runner_passes_correct_solution():
    code = """
def count_vowels(text: str) -> int:
    return sum(1 for char in text.lower() if char in "aeiou")
"""

    result = run_python_practice_tests(code, "count_vowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "passed"
    assert result["passed"] == 2
    assert result["total"] == 2


def test_python_runner_fails_incorrect_solution():
    code = """
def count_vowels(text: str) -> int:
    return 0
"""

    result = run_python_practice_tests(code, "count_vowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "failed"
    assert result["passed"] < result["total"]
    assert any(not item["passed"] for item in result["tests"])


def test_python_runner_outputs_final_function_call():
    code = """
def count_vowels(text: str) -> int:
    return sum(1 for char in text.lower() if char in "aeiou")

count_vowels("hello")
"""

    result = run_python_practice_tests(code, "count_vowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "passed"
    assert result["stdout"].strip() == "2"


def test_javascript_runner_passes_correct_solution():
    code = """
function countVowels(text) {
  return [...text.toLowerCase()].filter((char) => "aeiou".includes(char)).length;
}
"""

    result = run_javascript_practice_tests(code, "countVowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "passed"
    assert result["passed"] == 2
    assert result["total"] == 2


def test_javascript_runner_outputs_final_function_call():
    code = """
function countVowels(text) {
  return [...text.toLowerCase()].filter((char) => "aeiou".includes(char)).length;
}

countVowels("hello");
"""

    result = run_javascript_practice_tests(code, "countVowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "passed"
    assert result["stdout"].strip() == "2"


def test_javascript_runner_reports_missing_function():
    code = "const value = 42;"

    result = run_javascript_practice_tests(code, "countVowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "error"
    assert "countVowels" in result["stderr"]


def test_python_runner_allows_safe_standard_library_imports():
    code = """
from typing import Iterable
import math

def count_vowels(text: str) -> int:
    values: Iterable[str] = text.lower()
    return math.floor(sum(1 for char in values if char in "aeiou"))
"""

    result = run_python_practice_tests(code, "count_vowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "passed"


def test_python_runner_blocks_filesystem_and_process_access():
    for code in (
        "import os\ndef count_vowels(text):\n    return 0",
        "def count_vowels(text):\n    return open('/etc/passwd').read()",
        "def count_vowels(text):\n    return ().__class__.__mro__",
    ):
        result = run_python_practice_tests(code, "count_vowels", COUNT_VOWELS_TESTS)

        assert result["status"] == "error"
        assert "security check blocked" in result["stderr"].lower()


def test_python_runner_does_not_expose_imported_module_internals():
    code = """
import typing

leaked_runtime = typing.sys

def count_vowels(text: str) -> int:
    return 0
"""

    result = run_python_practice_tests(code, "count_vowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "error"
    assert "has no attribute 'sys'" in result["stderr"]


def test_javascript_runner_blocks_runtime_and_constructor_access():
    for code in (
        "const fs = require('fs'); function countVowels() { return 0; }",
        "function countVowels() { return process.env; }",
        "function countVowels() { return this.constructor.constructor('return process')(); }",
    ):
        result = run_javascript_practice_tests(code, "countVowels", COUNT_VOWELS_TESTS)

        assert result["status"] == "error"
        assert "security check blocked" in result["stderr"].lower()


def test_javascript_vm_disables_computed_constructor_escape():
    code = """
function probeSandbox() {
  try {
    return this["con" + "structor"]["con" + "structor"]("return pro" + "cess")()
      ? "escaped"
      : "blocked";
  } catch (_error) {
    return "blocked";
  }
}
"""
    tests = [{"name": "constructor escape", "args": [], "expected": "blocked"}]

    result = run_javascript_practice_tests(code, "probeSandbox", tests)

    assert result["status"] == "passed"


def test_python_runner_caps_student_output():
    code = """
def count_vowels(text: str) -> int:
    print("x" * 20000)
    return sum(1 for char in text.lower() if char in "aeiou")
"""

    result = run_python_practice_tests(code, "count_vowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "passed"
    assert len(result["stdout"]) <= RUN_MAX_OUTPUT_CHARS + 100
    assert "output truncated" in result["stdout"]


def test_python_runner_terminates_infinite_loop():
    code = """
def count_vowels(text: str) -> int:
    while True:
        pass
"""

    result = run_python_practice_tests(code, "count_vowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "error"
    assert "timed out" in result["stderr"].lower()


def test_runner_rate_limit_returns_retry_after():
    user_key = f"test-user-{id(object())}"

    assert check_practice_run_rate_limit(user_key, limit=2, window_seconds=60) is None
    assert check_practice_run_rate_limit(user_key, limit=2, window_seconds=60) is None
    retry_after = check_practice_run_rate_limit(user_key, limit=2, window_seconds=60)

    assert isinstance(retry_after, int)
    assert retry_after >= 1
