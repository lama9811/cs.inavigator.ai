from coding_runner import (
    RUN_MAX_OUTPUT_CHARS,
    RunnerSecurityError,
    _cpp_beginner_compat_adapter,
    _cpp_param_prefers_int,
    check_practice_run_rate_limit,
    compiled_runners_enabled,
    run_cpp_practice_tests,
    run_cpp_practice_trace,
    run_java_practice_tests,
    run_java_practice_trace,
    run_javascript_freeform_trace,
    run_javascript_practice_tests,
    run_javascript_practice_trace,
    run_python_freeform_trace,
    run_python_practice_tests,
    run_python_practice_trace,
    validate_cpp_code,
    validate_java_code,
)
from practice_starters import cpp_native_signature, get_arg_spec
from pathlib import Path
import json

import pytest


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


def test_python_runner_accepts_case_insensitive_message_tests():
    code = """
def plant_watering_message(moisture: int, is_sunny: bool) -> str:
    return "Water Today"
"""
    tests = [{"name": "message case", "args": [28, False], "expected": "water today", "case_insensitive": True}]

    result = run_python_practice_tests(code, "plant_watering_message", tests)

    assert result["status"] == "passed"


def test_python_runner_accepts_none_sentinel_case_inside_lists():
    code = """
def help_desk_queue(commands):
    return ["None", "Kim"]
"""
    tests = [{"name": "sentinel case", "args": [["serve", "join Kim", "serve"]], "expected": ["none", "Kim"]}]

    result = run_python_practice_tests(code, "help_desk_queue", tests)

    assert result["status"] == "passed"


def test_python_runner_outputs_final_function_call():
    code = """
def count_vowels(text: str) -> int:
    return sum(1 for char in text.lower() if char in "aeiou")

count_vowels("hello")
"""

    result = run_python_practice_tests(code, "count_vowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "passed"
    assert result["stdout"].strip() == "2"


def test_python_trace_captures_function_lines_and_locals():
    code = """
def count_vowels(text: str) -> int:
    total = 0
    for char in text.lower():
        if char in "aeiou":
            total += 1
    return total
"""

    result = run_python_practice_trace(code, "count_vowels", COUNT_VOWELS_TESTS[0])

    assert result["status"] == "passed"
    assert result["test"]["passed"] is True
    assert result["trace"]
    assert any("total" in step["locals"] for step in result["trace"])
    assert any("for char in text.lower()" in step["line"] for step in result["trace"])
    assert any(step.get("return_value") == "2" for step in result["trace"])
    assert all(step.get("call_depth", 0) >= 1 for step in result["trace"])
    assert any(step.get("call_stack") == ["count_vowels"] for step in result["trace"])


def test_python_trace_uses_same_security_validation():
    result = run_python_practice_trace(
        "import os\ndef count_vowels(text):\n    return 0",
        "count_vowels",
        COUNT_VOWELS_TESTS[0],
    )

    assert result["status"] == "error"
    assert "security check blocked" in result["stderr"].lower()
    assert result["trace_v2"]["schema_version"] == "trace_v2"
    assert result["trace_v2"]["language"] == "python"
    assert result["trace_v2"]["capability"] == "practice_and_freeform"


def test_python_trace_v2_includes_frames_objects_and_parameter_bindings():
    code = """
def maximum_score(scores: list[int]) -> int:
    best = scores[0]
    for score in scores:
        if score > best:
            best = score
    return best
"""

    result = run_python_practice_trace(
        code,
        "maximum_score",
        {"name": "scores", "args": [[72, 88, 91, 84]], "expected": 91},
    )

    trace_v2 = result["trace_v2"]
    assert trace_v2["schema_version"] == "trace_v2"
    assert trace_v2["language"] == "python"
    assert trace_v2["trace_mode"] == "practice"
    assert trace_v2["steps"]
    assert any(step["frames"] for step in trace_v2["steps"])
    assert any("scores" in frame["bindings"] for step in trace_v2["steps"] for frame in step["frames"])
    assert any(obj["type"] == "list" and obj.get("length") == 4 for step in trace_v2["steps"] for obj in step["objects"].values())


def test_python_trace_v2_tracks_list_mutation_without_rebinding():
    code = """
def add_score(scores: list[int]) -> list[int]:
    scores.append(91)
    return scores
"""

    result = run_python_practice_trace(
        code,
        "add_score",
        {"name": "append", "args": [[72, 88]], "expected": [72, 88, 91]},
    )

    steps = result["trace_v2"]["steps"]
    score_refs = [
        frame["bindings"]["scores"]["object_id"]
        for step in steps
        for frame in step["frames"]
        if "scores" in frame["bindings"] and frame["bindings"]["scores"].get("kind") == "reference"
    ]
    mutated_ids = {
        change["object_id"]
        for step in steps
        for change in step.get("object_changes", [])
        if change.get("change") == "mutated"
    }

    assert len(set(score_refs)) == 1
    assert score_refs[0] in mutated_ids
    assert any(
        step.get("operation_kind") == "mutation"
        and step.get("operation_target") == "scores"
        and "append" in step["operation_summary"]
        and "existing" in step["operation_summary"]
        for step in steps
    )


def test_python_trace_v2_marks_reassignment_binding_change():
    code = """
def bump(number: int) -> int:
    number = number + 1
    return number
"""

    result = run_python_practice_trace(code, "bump", {"name": "bump", "args": [2], "expected": 3})

    assert any(
        change["name"] == "number" and change["change"] == "changed"
        for step in result["trace_v2"]["steps"]
        for change in step.get("binding_changes", [])
    )


def test_python_trace_v2_marks_before_and_after_line_timing():
    code = """
def bump(number: int) -> int:
    number = number + 1
    return number
"""

    result = run_python_practice_trace(code, "bump", {"name": "bump", "args": [2], "expected": 3})
    steps = result["trace_v2"]["steps"]

    assert any(step.get("phase") == "before_line" and step.get("line_about_to_run") for step in steps)
    changed_step = next(
        step for step in steps
        if any(change.get("name") == "number" and change.get("change") == "changed" for change in step.get("binding_changes", []))
    )
    assert changed_step["phase"] == "after_previous_line"
    assert changed_step["line_just_ran"]
    assert changed_step["line_about_to_run"]
    assert changed_step["changes"]


def test_python_trace_v2_summarizes_lowercase_loop_iteration():
    code = """
def count_vowels(text: str) -> int:
    total = 0
    for char in text.lower():
        if char in "aeiou":
            total += 1
    return total
"""

    result = run_python_practice_trace(code, "count_vowels", COUNT_VOWELS_TESTS[1])

    summaries = [step["operation_summary"] for step in result["trace_v2"]["steps"]]
    assert any("lower()" in summary for summary in summaries)
    assert any("next lowercase character" in summary or "pick the next item" in summary for summary in summaries)


def test_python_trace_v2_includes_ast_operation_fields():
    code = """
def read_second(items: list[int]) -> int:
    value = items[1]
    return value
"""

    result = run_python_practice_trace(code, "read_second", {"name": "index", "args": [[3, 5]], "expected": 5})
    steps = result["trace_v2"]["steps"]

    assert any(step.get("operation_kind") == "index_access" and step.get("operation_target") == "value" for step in steps)
    assert any(step.get("student_message") for step in steps)


def test_python_trace_v2_identifies_index_write_and_dict_update():
    code = """
def update_values(items: list[int], table: dict[str, int]) -> int:
    items[0] = items[0] + 1
    table["count"] = items[0]
    return table["count"]
"""

    result = run_python_practice_trace(
        code,
        "update_values",
        {"name": "writes", "args": [[2], {}], "expected": 3},
    )
    steps = result["trace_v2"]["steps"]

    assert result["status"] == "passed"
    assert any(step.get("operation_kind") == "index_write" and step.get("operation_target") == "items[0]" for step in steps)
    assert any(step.get("operation_kind") == "index_write" and step.get("operation_target") == "table['count']" for step in steps)
    assert any(change.get("change") == "mutated" for step in steps for change in step.get("object_changes", []))


def test_python_freeform_trace_returns_trace_v2_and_stdout():
    result = run_python_freeform_trace(
        """
values = [1]
values.append(2)
print(values)
"""
    )

    assert result["status"] == "passed"
    assert result["trace"]
    assert result["trace_v2"]["schema_version"] == "trace_v2"
    assert result["trace_v2"]["language"] == "python"
    assert result["trace_v2"]["trace_mode"] == "freeform"
    assert any(obj["type"] == "list" for step in result["trace_v2"]["steps"] for obj in step["objects"].values())
    assert "[1, 2]" in result["stdout"]


def test_javascript_practice_trace_returns_trace_v2_frames_and_return():
    code = """
function addOne(number) {
  const result = number + 1;
  return result;
}
"""

    result = run_javascript_practice_trace(code, "addOne", {"name": "one", "args": [2], "expected": 3})

    assert result["status"] == "passed"
    assert result["trace"]
    assert result["trace_v2"]["schema_version"] == "trace_v2"
    assert result["trace_v2"]["language"] == "javascript"
    assert result["trace_v2"]["trace_mode"] == "practice"
    assert any("number" in frame["bindings"] for step in result["trace_v2"]["steps"] for frame in step["frames"])
    assert any(step.get("event") == "return" and step.get("return_value", {}).get("display") == "3" for step in result["trace_v2"]["steps"])


def test_javascript_practice_trace_tracks_array_mutation():
    code = """
function addScore(scores) {
  scores.push(91);
  return scores;
}
"""

    result = run_javascript_practice_trace(code, "addScore", {"name": "push", "args": [[72, 88]], "expected": [72, 88, 91]})
    steps = result["trace_v2"]["steps"]

    assert result["status"] == "passed"
    assert any(obj["type"] == "list" and obj.get("length") == 3 for step in steps for obj in step["objects"].values())
    assert any(change.get("change") == "mutated" for step in steps for change in step.get("object_changes", []))


def test_javascript_practice_trace_supports_arrow_functions():
    code = """
const addOne = (number) => {
  const result = number + 1;
  return result;
};
"""

    result = run_javascript_practice_trace(code, "addOne", {"name": "arrow", "args": [4], "expected": 5})

    assert result["status"] == "passed"
    assert any("number" in frame["bindings"] for step in result["trace_v2"]["steps"] for frame in step["frames"])
    assert any(step.get("return_value", {}).get("display") == "5" for step in result["trace_v2"]["steps"])


def test_javascript_practice_trace_supports_jsdoc_and_export_starter():
    code = """
/**
 * @param {number} moisture
 * @param {boolean} isSunny
 * @returns {string}
 */
function plantWateringMessage(moisture, isSunny) {
  // Replace this with your approach and return the answer.
  if (moisture < 30 || (isSunny && moisture <= 45)) {
    return "water today";
  } else {
    return "check tomorrow";
  }
}

export { plantWateringMessage };
"""

    result = run_javascript_practice_trace(
        code,
        "plantWateringMessage",
        {"name": "plant", "args": [28, False], "expected": "water today"},
    )

    assert result["status"] == "passed"
    assert any("moisture" in frame["bindings"] for step in result["trace_v2"]["steps"] for frame in step["frames"])
    assert not result["stderr"]


def test_javascript_practice_trace_supports_for_of_loop_and_condition():
    code = """
function countShort(words) {
  let count = 0;
  for (const word of words) {
    if (word.length <= 3) {
      count += 1;
    }
  }
  return count;
}
"""

    result = run_javascript_practice_trace(code, "countShort", {"name": "short", "args": [["cat", "tiger", "owl"]], "expected": 2})
    steps = result["trace_v2"]["steps"]

    assert result["status"] == "passed"
    assert any(step.get("operation_kind") == "loop_iteration" for step in steps)
    assert any(step.get("operation_kind") == "condition" for step in steps)
    assert any("word" in frame["bindings"] for step in steps for frame in step["frames"])


def test_javascript_practice_trace_supports_while_loop():
    code = """
function climb(limit) {
  let step = 0;
  while (step < limit) {
    step += 1;
  }
  return step;
}
"""

    result = run_javascript_practice_trace(code, "climb", {"name": "while", "args": [2], "expected": 2})

    assert result["status"] == "passed"
    assert any(step.get("operation_kind") == "condition" for step in result["trace_v2"]["steps"])
    assert any(
        change.get("name") == "step" and change.get("change") == "changed"
        for step in result["trace_v2"]["steps"]
        for change in step.get("binding_changes", [])
    )


def test_javascript_practice_trace_tracks_object_property_mutation():
    code = """
function markDone(task) {
  task.done = true;
  return task.done;
}
"""

    result = run_javascript_practice_trace(code, "markDone", {"name": "object", "args": [{"done": False}], "expected": True})
    steps = result["trace_v2"]["steps"]

    assert result["status"] == "passed"
    assert any(obj["type"] == "dict" for step in steps for obj in step["objects"].values())
    assert any(change.get("change") == "mutated" for step in steps for change in step.get("object_changes", []))


def test_javascript_practice_trace_identifies_index_access():
    code = """
function second(items) {
  const value = items[1];
  return value;
}
"""

    result = run_javascript_practice_trace(code, "second", {"name": "index", "args": [[3, 5]], "expected": 5})

    assert result["status"] == "passed"
    assert any(step.get("operation_kind") == "index_access" for step in result["trace_v2"]["steps"])


def test_javascript_practice_trace_identifies_index_write_and_string_transform():
    code = """
function cleanFirst(items, text) {
  items[0] = text.toLowerCase();
  return items[0];
}
"""

    result = run_javascript_practice_trace(code, "cleanFirst", {"name": "write", "args": [[""], "Ada"], "expected": "ada"})
    steps = result["trace_v2"]["steps"]

    assert result["status"] == "passed"
    assert any(step.get("operation_kind") == "index_write" and step.get("operation_target") == "items" for step in steps)
    assert any(
        "stored item" in step.get("student_message", "") or "toLowerCase" in step.get("student_message", "")
        for step in steps
    )


def test_javascript_freeform_trace_reports_syntax_error():
    result = run_javascript_freeform_trace(
        """
const broken = ;
"""
    )

    assert result["status"] == "error"
    assert result["trace_v2"]["schema_version"] == "trace_v2"
    assert result["trace_v2"]["language"] == "javascript"
    assert result["trace_v2"]["trace_mode"] == "freeform"
    assert "syntax" in result["stderr"].lower() or "unexpected" in result["stderr"].lower()
    assert any(step.get("exception", {}).get("line") for step in result["trace_v2"]["steps"])


def test_javascript_freeform_trace_returns_trace_v2_and_stdout():
    result = run_javascript_freeform_trace(
        """
const values = [1];
values.push(2);
console.log(values);
"""
    )

    assert result["status"] == "passed"
    assert result["trace_v2"]["schema_version"] == "trace_v2"
    assert result["trace_v2"]["language"] == "javascript"
    assert "[1,2]" in result["stdout"]
    assert any(step.get("stdout_changed") for step in result["trace_v2"]["steps"])


def test_javascript_trace_reports_thrown_error():
    result = run_javascript_freeform_trace(
        """
const count = 1;
throw new Error("boom");
"""
    )

    assert result["status"] == "error"
    assert result["trace_v2"]["schema_version"] == "trace_v2"
    assert result["stderr"]


def test_javascript_trace_reports_runtime_error_line():
    result = run_javascript_practice_trace(
        """
function readMissing(item) {
  return item.missing.value;
}
""",
        "readMissing",
        {"name": "runtime", "args": [{}], "expected": None},
    )

    exception_steps = [step for step in result["trace_v2"]["steps"] if step.get("event") == "exception"]
    assert result["status"] == "error"
    assert exception_steps
    assert exception_steps[-1].get("current_line") == 3
    assert "missing" in exception_steps[-1].get("line", "")


def test_javascript_trace_uses_same_security_validation():
    result = run_javascript_practice_trace(
        "function probeSandbox() { return process.env; }",
        "probeSandbox",
        {"name": "blocked", "args": [], "expected": None},
    )

    assert result["status"] == "error"
    assert "security check blocked" in result["stderr"].lower()


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


def test_javascript_runner_accepts_case_insensitive_message_tests():
    code = """
function plantWateringMessage(moisture, isSunny) {
  return "Water Today";
}
"""
    tests = [{"name": "message case", "args": [28, False], "expected": "water today", "case_insensitive": True}]

    result = run_javascript_practice_tests(code, "plantWateringMessage", tests)

    assert result["status"] == "passed"


def test_javascript_runner_accepts_none_sentinel_case_inside_lists():
    code = """
function helpDeskQueue(commands) {
  return ["None", "Kim"];
}
"""
    tests = [{ "name": "sentinel case", "args": [["serve", "join Kim", "serve"]], "expected": ["none", "Kim"] }]

    result = run_javascript_practice_tests(code, "helpDeskQueue", tests)

    assert result["status"] == "passed"


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


def test_javascript_runner_supports_const_arrow_functions():
    code = """
const countVowels = (text) => {
  return [...text.toLowerCase()].filter((char) => "aeiou".includes(char)).length;
};
"""

    result = run_javascript_practice_tests(code, "countVowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "passed"
    assert result["passed"] == 2


def test_javascript_runner_supports_order_insensitive_tests():
    code = """
function groupAnagrams(words) {
  return [["tan"], ["tea", "ate", "eat"]];
}
"""
    tests = [{
        "name": "groups can be returned in any order",
        "args": [["eat", "tea", "tan", "ate"]],
        "expected": [["eat", "tea", "ate"], ["tan"]],
        "order_insensitive": True,
    }]

    result = run_javascript_practice_tests(code, "groupAnagrams", tests)

    assert result["status"] == "passed"


def test_javascript_runner_reports_missing_function():
    code = "const value = 42;"

    result = run_javascript_practice_tests(code, "countVowels", COUNT_VOWELS_TESTS)

    assert result["status"] == "error"
    assert "countVowels" in result["stderr"]


def test_all_javascript_practice_questions_have_executable_tests():
    answers_path = Path(__file__).resolve().parents[1] / "data_sources" / "quiz" / "answers" / "javascript.json"
    data = json.loads(answers_path.read_text(encoding="utf-8"))

    missing = [
        item.get("question_id")
        for item in data.get("items", [])
        if not item.get("runner_tests")
    ]

    assert missing == []


def test_javascript_practice_runner_tests_have_expected_shape():
    answers_path = Path(__file__).resolve().parents[1] / "data_sources" / "quiz" / "answers" / "javascript.json"
    data = json.loads(answers_path.read_text(encoding="utf-8"))

    malformed = []
    for item in data.get("items", []):
        for index, test in enumerate(item.get("runner_tests") or [], start=1):
            if "args" not in test or "expected" not in test:
                malformed.append(f"{item.get('question_id')} test {index}")

    assert malformed == []


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


# ---------------------------------------------------------------------------
# Compiled-runner hardening (Java / C++): these test the SOURCE validators and
# the prod gate, which are pure Python — no JDK/g++ needed to run them.
# ---------------------------------------------------------------------------

def test_cpp_validator_blocks_low_level_escape_routes():
    blocked = [
        "long f(std::vector<long> a){ return syscall(1); }",
        "long f(std::vector<long> a){ void* h = dlopen(\"x\", 2); return 0; }",
        "long f(std::vector<long> a){ return getenv(\"SECRET\") ? 1 : 0; }",
        "#include <netdb.h>\nlong f(std::vector<long> a){ return 0; }",
        "long f(std::vector<long> a){ getaddrinfo(0,0,0,0); return 0; }",
        "long f(std::vector<long> a){ ptrace(0,0,0,0); return 0; }",
    ]
    for code in blocked:
        with pytest.raises(RunnerSecurityError):
            validate_cpp_code(code)


def test_cpp_validator_still_allows_normal_algorithm_code():
    # A plain algorithm solution must NOT trip the tightened blocklist.
    validate_cpp_code(
        "Value solve(std::vector<Value> a){ int n = a.size(); "
        "std::vector<int> v; for(int i=0;i<n;i++) v.push_back(i); return Value((long long)n); }"
    )


def test_cpp_beginner_compat_detects_const_vector_int_params():
    code = """
#include <vector>

int sumEvenNumbers(const std::vector<int>& nums) {
    return 0;
}
"""

    assert _cpp_param_prefers_int(code, "sumEvenNumbers", "nums", "intlist") is True


def test_cpp_beginner_compat_adds_wider_wrapper_after_student_code():
    spec = get_arg_spec("sumEvenNumbers")
    expected_signature = cpp_native_signature("sumEvenNumbers", spec)
    code = """
#include <vector>

int sumEvenNumbers(const std::vector<int>& nums) {
    return 0;
}
"""

    adapter = _cpp_beginner_compat_adapter(code, "sumEvenNumbers", spec, expected_signature)

    assert "long long sumEvenNumbers(std::vector<long long> nums)" in adapter
    assert "std::vector<int> __nums_int(nums.begin(), nums.end());" in adapter
    assert "auto __student_result = sumEvenNumbers(__nums_int);" in adapter


def test_cpp_beginner_compat_accepts_snake_case_function_name():
    spec = get_arg_spec("sumEvenNumbers")
    expected_signature = cpp_native_signature("sumEvenNumbers", spec)
    code = """
#include <vector>

int sum_even_numbers(const std::vector<int>& nums) {
    int current_sum = 0;
    for (int num : nums) {
        if (num % 2 == 0) {
            current_sum += num;
        }
    }
    return current_sum;
}
"""

    adapter = _cpp_beginner_compat_adapter(code, "sumEvenNumbers", spec, expected_signature)

    assert "long long sumEvenNumbers(std::vector<long long> nums)" in adapter
    assert "std::vector<int> __nums_int(nums.begin(), nums.end());" in adapter
    assert "auto __student_result = sum_even_numbers(__nums_int);" in adapter


def test_java_validator_blocks_env_classloader_and_native():
    blocked = [
        "class Solution { static Object f(Object[] a){ return System.getenv(\"X\"); } }",
        "class Solution { static Object f(Object[] a){ return new URLClassLoader(null); } }",
        "class Solution { static Object f(Object[] a){ return sun.misc.Unsafe.class; } }",
        "class Solution { native int f(); }",
        "class Solution { static Object f(Object[] a){ System.loadLibrary(\"x\"); return null; } }",
    ]
    for code in blocked:
        with pytest.raises(RunnerSecurityError):
            validate_java_code(code)


def test_java_validator_still_allows_normal_algorithm_code():
    validate_java_code(
        "class Solution { static Object f(Object[] a){ "
        "java.util.List<Integer> xs = new java.util.ArrayList<>(); return xs.size(); } }"
    )


def test_compiled_runners_gate_disables_java_and_cpp(monkeypatch):
    monkeypatch.setenv("ALLOW_COMPILED_RUNNERS", "false")
    # Re-evaluate the gate with the env applied.
    assert compiled_runners_enabled() is False

    java_result = run_java_practice_tests(
        "class Solution { static Object f(Object[] a){ return 0L; } }", "f", []
    )
    cpp_result = run_cpp_practice_tests(
        "Value solve(std::vector<Value> a){ return Value((long long)0); }", "solve", []
    )
    assert java_result["status"] == "error"
    assert "disabled" in java_result["stderr"].lower()
    assert cpp_result["status"] == "error"
    assert "disabled" in cpp_result["stderr"].lower()

    java_trace = run_java_practice_trace(
        "class Solution { static int addOne(int value){ return value + 1; } }",
        "addOne",
        {"name": "one", "args": [2], "expected": 3},
        arg_spec=([("value", "int")], "int"),
    )
    cpp_trace = run_cpp_practice_trace(
        "int addOne(int value){ return value + 1; }",
        "addOne",
        {"name": "one", "args": [2], "expected": 3},
        arg_spec=([("value", "int")], "int"),
    )
    assert java_trace["trace_v2"]["language"] == "java"
    assert java_trace["trace_v2"]["capability"] == "practice_only"
    assert java_trace["trace_v2"]["steps"] == []
    assert "python" not in java_trace["stderr"].lower()
    assert cpp_trace["trace_v2"]["language"] == "cpp"
    assert cpp_trace["trace_v2"]["capability"] == "practice_only"
    assert cpp_trace["trace_v2"]["steps"] == []
    assert "java" not in cpp_trace["stderr"].lower()


def test_compiled_runners_gate_on_by_default(monkeypatch):
    monkeypatch.delenv("ALLOW_COMPILED_RUNNERS", raising=False)
    assert compiled_runners_enabled() is True


def test_java_runner_accepts_case_insensitive_message_tests():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
class Solution {
  static String plantWateringMessage(int moisture, boolean isSunny) {
    return "Water Today";
  }
}
"""
    tests = [{"name": "message case", "args": [28, False], "expected": "water today", "case_insensitive": True}]

    result = run_java_practice_tests(code, "plantWateringMessage", tests, arg_spec=get_arg_spec("plantWateringMessage"))

    assert result["status"] == "passed"


def test_java_practice_trace_returns_trace_v2_for_native_method():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
class Solution {
  static int addOne(int value) {
    int next = value + 1;
    return next;
  }
}
"""
    result = run_java_practice_trace(
        code,
        "addOne",
        {"name": "one", "args": [2], "expected": 3},
        arg_spec=([("value", "int")], "int"),
    )

    if result["status"] == "error" and "not installed" in result.get("stderr", "").lower():
        pytest.skip(result["stderr"])

    assert result["status"] == "passed"
    assert result["trace_v2"]["schema_version"] == "trace_v2"
    assert result["trace_v2"]["language"] == "java"
    assert result["trace_v2"]["capability"] == "practice_only"
    assert result["trace_v2"]["trace_mode"] == "practice"
    steps = result["trace_v2"]["steps"]
    assert len(steps) >= 2
    assert any(step["operation_kind"] == "assignment" for step in steps)
    assert steps[-1]["return_value"] == "3"
    assert "value" in steps[0]["frames"][0]["bindings"]
    assert steps[0]["frames"][0]["bindings"]["value"]["display"] == "2"
    assert any("next" in step["frames"][0]["bindings"] for step in steps)
    assert any(
        change["name"] == "next"
        for step in steps
        for change in step.get("binding_changes", [])
    )


def test_java_practice_trace_captures_stdout():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
class Solution {
  static int echoPlusOne(int value) {
    System.out.println(value);
    return value + 1;
  }
}
"""
    result = run_java_practice_trace(
        code,
        "echoPlusOne",
        {"name": "stdout", "args": [4], "expected": 5},
        arg_spec=([("value", "int")], "int"),
    )
    if result["status"] == "error" and "not installed" in result.get("stderr", "").lower():
        pytest.skip(result["stderr"])

    assert result["status"] == "passed"
    assert "4" in result["stdout"]
    assert result["trace_v2"]["steps"][-1]["stdout"]


def test_java_practice_trace_reports_runtime_error_line():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
class Solution {
  static int second(int[] values) {
    return values[4];
  }
}
"""
    result = run_java_practice_trace(
        code,
        "second",
        {"name": "runtime", "args": [[1, 2]], "expected": 2},
        arg_spec=get_arg_spec("firstScoreAtLeast") and ([("values", "intlist")], "int"),
    )
    if result["status"] == "error" and "not installed" in result.get("stderr", "").lower():
        pytest.skip(result["stderr"])

    exception_steps = [step for step in result["trace_v2"]["steps"] if step.get("exception")]
    assert exception_steps
    assert exception_steps[-1]["exception"]["line"] >= 3
    assert "line" in exception_steps[-1]["student_message"]


def test_java_practice_trace_reports_compile_error_line():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
class Solution {
  static int broken(int value) {
    int next = ;
    return next;
  }
}
"""
    result = run_java_practice_trace(
        code,
        "broken",
        {"name": "compile", "args": [2], "expected": 3},
        arg_spec=([("value", "int")], "int"),
    )
    if result["status"] == "error" and "not installed" in result.get("stderr", "").lower():
        pytest.skip(result["stderr"])

    step = result["trace_v2"]["steps"][0]
    assert result["trace_v2"]["language"] == "java"
    assert step["exception"]["type"] == "CompileError"
    assert step["exception"]["line"] >= 3


def test_cpp_runner_accepts_case_insensitive_message_tests():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
#include <string>
using namespace std;

string plantWateringMessage(long long moisture, bool isSunny) {
    return "Water Today";
}
"""
    tests = [{"name": "message case", "args": [28, False], "expected": "water today", "case_insensitive": True}]

    result = run_cpp_practice_tests(code, "plantWateringMessage", tests, arg_spec=get_arg_spec("plantWateringMessage"))
    if result["status"] == "error" and "compiler" in result.get("stderr", "").lower():
        pytest.skip(result["stderr"])

    assert result["status"] == "passed"


def test_cpp_practice_trace_returns_trace_v2_for_native_function():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
#include <string>
#include <vector>

int addOne(int value) {
    int next = value + 1;
    return next;
}
"""
    result = run_cpp_practice_trace(
        code,
        "addOne",
        {"name": "one", "args": [2], "expected": 3},
        arg_spec=([("value", "int")], "int"),
    )
    if result["status"] == "error" and "compiler" in result.get("stderr", "").lower():
        pytest.skip(result["stderr"])

    assert result["status"] == "passed"
    assert result["trace_v2"]["schema_version"] == "trace_v2"
    assert result["trace_v2"]["language"] == "cpp"
    assert result["trace_v2"]["requested_language"] == "cpp"
    assert result["trace_v2"]["capability"] == "practice_only"
    assert result["trace_v2"]["trace_mode"] == "practice"
    steps = result["trace_v2"]["steps"]
    assert len(steps) >= 2
    assert any(step["operation_kind"] == "assignment" for step in steps)
    assert steps[-1]["return_value"] == "3"
    assert "value" in steps[0]["frames"][0]["bindings"]
    assert steps[0]["frames"][0]["bindings"]["value"]["display"] == "2"
    assert any("next" in step["frames"][0]["bindings"] for step in steps)
    assert any(
        change["name"] == "next"
        for step in steps
        for change in step.get("binding_changes", [])
    )


def test_cpp_practice_trace_captures_stdout():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
#include <iostream>

int echoPlusOne(int value) {
    std::cout << value << "\\n";
    return value + 1;
}
"""
    result = run_cpp_practice_trace(
        code,
        "echoPlusOne",
        {"name": "stdout", "args": [4], "expected": 5},
        arg_spec=([("value", "int")], "int"),
    )
    if result["status"] == "error" and "compiler" in result.get("stderr", "").lower():
        pytest.skip(result["stderr"])

    assert result["status"] == "passed"
    assert "4" in result["stdout"]
    assert result["trace_v2"]["steps"][-1]["stdout"]


def test_cpp_practice_trace_reports_exception_step():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
#include <stdexcept>

int failFast(int value) {
    throw std::runtime_error("bad value");
    return value;
}
"""
    result = run_cpp_practice_trace(
        code,
        "failFast",
        {"name": "runtime", "args": [2], "expected": 2},
        arg_spec=([("value", "int")], "int"),
    )
    if result["status"] == "error" and "compiler" in result.get("stderr", "").lower():
        pytest.skip(result["stderr"])

    exception_steps = [step for step in result["trace_v2"]["steps"] if step.get("exception")]
    assert exception_steps
    assert "bad value" in exception_steps[-1]["exception"]["message"]


def test_cpp_practice_trace_reports_compile_error():
    if not compiled_runners_enabled():
        pytest.skip("compiled runners disabled")
    code = """
int broken(int value) {
    int next = ;
    return next;
}
"""
    result = run_cpp_practice_trace(
        code,
        "broken",
        {"name": "compile", "args": [2], "expected": 3},
        arg_spec=([("value", "int")], "int"),
    )
    if result["status"] == "error" and "compiler" in result.get("stderr", "").lower() and not result["trace_v2"].get("steps"):
        pytest.skip(result["stderr"])

    step = result["trace_v2"]["steps"][0]
    assert result["trace_v2"]["language"] == "cpp"
    assert step["exception"]["type"] == "CompileError"
    assert "compile" in step["operation_kind"]


def test_runner_rate_limit_returns_retry_after():
    user_key = f"test-user-{id(object())}"

    assert check_practice_run_rate_limit(user_key, limit=2, window_seconds=60) is None
    assert check_practice_run_rate_limit(user_key, limit=2, window_seconds=60) is None
    retry_after = check_practice_run_rate_limit(user_key, limit=2, window_seconds=60)

    assert isinstance(retry_after, int)
    assert retry_after >= 1
