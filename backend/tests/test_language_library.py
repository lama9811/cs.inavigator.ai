import os
import re
import sys
from pathlib import Path

from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite://")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import main  # noqa: E402


client = TestClient(main.app, base_url="http://localhost")

REQUIRED_ENTRY_FIELDS = {
    "id",
    "category",
    "method_name",
    "syntax",
    "description",
    "example",
    "complexity",
    "lesson_link",
    "common_mistake",
}

REQUIRED_CATEGORY_FIELDS = {
    "id",
    "label",
    "description",
}


def test_language_library_returns_content_for_supported_languages():
    complexity_levels = {"Beginner", "Intermediate", "Advanced"}

    for language in ("python", "java", "javascript", "cpp"):
        response = client.get(f"/api/coding/language-library/{language}")
        assert response.status_code == 200
        data = response.json()
        assert data["language"] == language
        assert data["label"]
        assert len(data["categories"]) == 5
        assert len(data["entries"]) >= 60

        category_ids = {category["id"] for category in data["categories"]}
        assert {
            "built-ins",
            "strings",
            "lists-arrays",
            "maps-dictionaries",
            "sets",
        }.issubset(category_ids)

        for category in data["categories"]:
            assert REQUIRED_CATEGORY_FIELDS.issubset(category)
            assert category["description"]
            assert isinstance(category.get("preview_methods", []), list)

        for entry in data["entries"]:
            assert REQUIRED_ENTRY_FIELDS.issubset(entry)
            assert entry["category"] in category_ids
            assert entry["id"]
            assert entry["method_name"]
            assert entry["syntax"]
            assert entry["description"]
            assert entry["example"]
            assert entry["complexity"] in complexity_levels
            assert entry["common_mistake"]
            assert entry["lesson_link"]["label"]
            assert entry["lesson_link"]["track"] in {"beginner", "intermediate", "advanced"}
            assert entry["lesson_link"]["category"]


def test_language_library_entries_match_declared_categories():
    for language in ("python", "java", "javascript", "cpp"):
        response = client.get(f"/api/coding/language-library/{language}")
        assert response.status_code == 200
        data = response.json()
        category_ids = {category["id"] for category in data["categories"]}
        categories_with_entries = {entry["category"] for entry in data["entries"]}

        assert categories_with_entries == category_ids


def test_language_library_returns_alphabetized_categories_and_entries():
    for language in ("python", "java", "javascript", "cpp"):
        response = client.get(f"/api/coding/language-library/{language}")
        assert response.status_code == 200
        data = response.json()

        category_labels = [category["label"].lower() for category in data["categories"]]
        assert category_labels == sorted(category_labels)

        grouped = {}
        for entry in data["entries"]:
            grouped.setdefault(entry["category"], []).append(entry["method_name"].lower())

        for method_names in grouped.values():
            assert method_names == sorted(method_names)


def test_language_library_keeps_built_ins_separate_from_collection_methods():
    response = client.get("/api/coding/language-library/python")
    assert response.status_code == 200
    entries = response.json()["entries"]
    python_builtins = {"all", "any", "enumerate", "len", "sum"}

    for entry in entries:
        if entry["method_name"] in python_builtins:
            assert entry["category"] == "built-ins"


def test_language_library_examples_include_setup_for_java_js_cpp():
    variable_markers = {
        "javascript": {
            "scores": ("const scores =",),
            "nums": ("const nums =",),
            "items": ("const items =",),
            "names": ("const names =",),
            "seen": ("const seen =",),
        },
        "java": {
            "scores": ("ArrayList<Integer> scores =", "HashMap<String, Integer> scores ="),
            "nums": ("int[] nums =", "List<Integer> nums =",),
            "names": ("ArrayList<String> names =",),
            "seen": ("HashSet<String> seen =", "Set<String> seen ="),
            "list": ("ArrayList<Integer> list =",),
        },
        "cpp": {
            "scores": ("vector<int> scores =", "unordered_map<string, int> scores ="),
            "nums": ("vector<int> nums =",),
            "items": ("vector<int> items =",),
            "seen": ("unordered_set<int> seen =",),
            "table": ("unordered_map<string, int> table =",),
        },
    }

    for language, markers in variable_markers.items():
        response = client.get(f"/api/coding/language-library/{language}")
        assert response.status_code == 200
        for entry in response.json()["entries"]:
            example = entry["example"]
            for variable, setup_options in markers.items():
                if re.search(rf"\b{re.escape(variable)}\b", example) and not any(setup in example for setup in setup_options):
                    assert False, f"{language} {entry['method_name']} uses {variable} without setup: {example}"


def test_language_library_examples_include_useful_result_comments_for_static_helpers():
    cases = [
        ("java", "Collections.max", "ArrayList<Integer> scores =", "// best == 91"),
        ("java", "Math.max", "int a = 3;", "// best == 5"),
        ("javascript", "Math.max", "const scores =", "// best === 91"),
        ("cpp", "binary_search", "vector<int> nums =", "// ok == true"),
        ("cpp", "max", "int a = 3;", "// best == 5"),
    ]

    for language, method_name, setup_marker, result_marker in cases:
        response = client.get(f"/api/coding/language-library/{language}")
        assert response.status_code == 200
        entry = next(
            item for item in response.json()["entries"]
            if item["method_name"] == method_name
        )
        assert setup_marker in entry["example"]
        assert result_marker in entry["example"]


def test_language_library_collection_mutations_show_after_state():
    cases = [
        ("java", "add", "names.add(\"Ada\");", "// names == [Ada, Grace, Ada]"),
        ("java", "set", "scores.set(0, 100);", "// scores.get(0) == 100"),
        ("javascript", "push", "items.push(95);", "// items === [3, 1, 2, 95]"),
        ("javascript", "clear", "seen.clear();", "// seen.size === 0"),
        ("cpp", "push_back", "nums.push_back(5);", "// nums == {3, 1, 2, 5}"),
        ("cpp", "operator[]", "nums[0] = 10;", "// nums == {10, 1, 2}"),
    ]

    for language, method_name, example_line, result_marker in cases:
        response = client.get(f"/api/coding/language-library/{language}")
        assert response.status_code == 200
        matches = [
            item for item in response.json()["entries"]
            if item["method_name"] == method_name and example_line in item["example"]
        ]
        assert matches, f"{language} {method_name} example missing: {example_line}"
        entry = matches[0]
        assert result_marker in entry["example"]


def test_language_library_cpp_has_reference_examples():
    response = client.get("/api/coding/language-library/cpp")
    assert response.status_code == 200
    methods = {entry["method_name"] for entry in response.json()["entries"]}
    assert {"push_back", "operator[]", "find", "insert"}.issubset(methods)


def test_language_library_accepts_cpp_alias():
    response = client.get("/api/coding/language-library/c++")
    assert response.status_code == 200
    assert response.json()["language"] == "cpp"


def test_language_library_rejects_unknown_language():
    response = client.get("/api/coding/language-library/ruby")
    assert response.status_code == 404
