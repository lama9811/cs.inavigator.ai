from coding_runner import run_javascript_practice_tests, run_python_practice_tests


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
