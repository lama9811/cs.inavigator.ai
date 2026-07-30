"""Guards for the code-writing Practice Library content.

These tests cover the authored coding problems in data_sources/quiz, not the
concept quizzes. The goal is to catch the two easiest ways the bank can drift:
adding a problem without runnable language metadata, or padding a topic with weak
prompt shape instead of a real practice task.
"""

import json
from collections import Counter
from pathlib import Path

from practice_starters import build_starter_from_spec, get_arg_spec


ROOT = Path(__file__).resolve().parents[1]
QUESTION_DIR = ROOT / "data_sources" / "quiz" / "questions"
ANSWER_DIR = ROOT / "data_sources" / "quiz" / "answers"
LANGUAGES = ("python", "javascript", "java", "cpp")
ADVANCED_V1_TOPICS = {
    "binary search",
    "graphs",
    "hash maps",
    "queues",
    "recursion",
    "sliding window",
    "stacks",
    "trees",
    "two pointers",
}
THIN_PRIORITY_TOPICS = {
    "disjoint sets",
    "heaps",
    "math",
    "matrices",
    "prefix sums",
    "queues",
    "recursion",
    "trees",
    "tries",
    "two pointers",
}
VISUALIZER_CONCEPTS = {
    "array-scan",
    "arithmetic",
    "binary-search",
    "bit-manipulation",
    "decision-flow",
    "dynamic-programming",
    "graph",
    "hash-map-set",
    "heap",
    "intervals",
    "linked-list",
    "matrix",
    "prefix-sum",
    "queue",
    "recursion",
    "sliding-window",
    "stack",
    "string-scan",
    "tree",
    "trie",
    "two-pointers",
    "union-find",
}
VISUALIZER_QUALITY_TOPICS = {
    "binary search",
    "graphs",
    "hash maps",
    "linked lists",
    "queues",
    "recursion",
    "sets",
    "sliding window",
    "stacks",
    "trees",
    "two pointers",
}
GENERIC_VISUALIZER_PHRASES = {
    "make the key move",
    "apply the prompt rule",
    "set up the needed state",
    "repeat until the prompt stopping rule",
    "one pointer, cell, memory slot, or frontier item changes",
}
COSC_101_EXPANSION_IDS = {
    "easy-25",
    "easy-26",
    "easy-27",
    "easy-28",
    "easy-29",
    "easy-30",
    "easy-31",
    "easy-32",
    "easy-33",
    "easy-34",
    "easy-35",
    "easy-36",
}
ALLOWED_NO_TESTS = {
    # Existing Java/C++ bridge gaps documented in ROADMAP. Python/JS do test these.
    "java": {"medium-04", "hard-14", "hard-16"},
    "cpp": {"medium-04", "hard-14", "hard-16"},
}


def load_questions():
    questions = []
    for path in sorted(QUESTION_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        questions.extend(data.get("questions", []))
    return questions


def load_answer_items(language):
    data = json.loads((ANSWER_DIR / f"{language}.json").read_text(encoding="utf-8"))
    return data.get("items", [])


def test_practice_question_ids_titles_and_prompts_are_unique():
    questions = load_questions()
    ids = [q.get("id") for q in questions]
    titles = [str(q.get("title") or "").strip().lower() for q in questions]
    prompts = [str(q.get("prompt") or "").strip().lower() for q in questions]

    assert len(ids) == len(set(ids))
    assert [title for title, count in Counter(titles).items() if count > 1] == []
    assert [prompt for prompt, count in Counter(prompts).items() if count > 1] == []


def test_cosc_101_expansion_questions_are_present():
    question_ids = {q.get("id") for q in load_questions()}

    assert COSC_101_EXPANSION_IDS <= question_ids


def test_practice_questions_have_real_student_facing_shape():
    weak = []
    for q in load_questions():
        if not q.get("id") or not q.get("title") or not q.get("topic"):
            weak.append(f"{q.get('id')}: missing id/title/topic")
        if q.get("difficulty") not in {"easy", "medium", "hard"}:
            weak.append(f"{q.get('id')}: invalid difficulty")
        if len(str(q.get("prompt") or "").split()) < 7:
            weak.append(f"{q.get('id')}: prompt too short")
        examples = q.get("examples") or []
        if not examples:
            weak.append(f"{q.get('id')}: no example")
        for index, example in enumerate(examples, start=1):
            if "input" not in example or "output" not in example:
                weak.append(f"{q.get('id')}: malformed example {index}")
        if len(q.get("hints") or []) < 3:
            weak.append(f"{q.get('id')}: fewer than 3 hints")
        if "placeholder" in str(q.get("prompt") or "").lower():
            weak.append(f"{q.get('id')}: placeholder text")

    assert weak == []


def test_every_practice_topic_has_at_least_two_code_problems():
    counts = Counter(q.get("topic") for q in load_questions())
    thin = {topic: count for topic, count in counts.items() if count < 2}

    assert thin == {}


def test_priority_practice_topics_have_code_problem_coverage():
    counts = Counter(q.get("topic") for q in load_questions())
    missing_advanced = sorted(topic for topic in ADVANCED_V1_TOPICS if counts[topic] < 2)
    missing_thin = sorted(topic for topic in THIN_PRIORITY_TOPICS if counts[topic] < 2)

    assert missing_advanced == []
    assert missing_thin == []


def test_answer_banks_match_questions_for_every_language():
    question_ids = {q["id"] for q in load_questions()}

    for language in LANGUAGES:
        answer_ids = [item.get("question_id") for item in load_answer_items(language)]
        assert len(answer_ids) == len(set(answer_ids)), f"{language}: duplicate answer ids"
        assert set(answer_ids) == question_ids, f"{language}: answer bank does not match questions"


def test_every_practice_question_has_problem_specific_visualizer():
    problems = []
    seen_presets = set()
    for q in load_questions():
        qid = q.get("id")
        title = str(q.get("title") or "").strip()
        visualizer = q.get("visualizer") or {}
        concept = visualizer.get("concept")
        preset = str(visualizer.get("preset") or "").strip()
        steps = visualizer.get("steps") or []

        if concept not in VISUALIZER_CONCEPTS:
            problems.append(f"{qid}: unsupported visualizer concept {concept!r}")
        if title.lower() not in str(visualizer.get("title") or "").lower():
            problems.append(f"{qid}: visualizer title does not name the problem")
        if len(str(visualizer.get("caption") or "").split()) < 7:
            problems.append(f"{qid}: visualizer caption too thin")
        if not isinstance(visualizer.get("input"), dict) or not visualizer.get("input"):
            problems.append(f"{qid}: visualizer missing sample input")
        if not preset:
            problems.append(f"{qid}: visualizer missing per-question preset")
        elif preset in seen_presets:
            problems.append(f"{qid}: duplicate visualizer preset {preset}")
        seen_presets.add(preset)
        if not isinstance(steps, list) or len(steps) < 3:
            problems.append(f"{qid}: visualizer needs at least 3 guided steps")
        for index, step in enumerate(steps, start=1):
            if not step.get("title") or not step.get("body") or not isinstance(step.get("state"), dict):
                problems.append(f"{qid}: malformed visualizer step {index}")

    assert problems == []


def test_priority_visualizers_have_richer_step_metadata():
    problems = []
    for q in load_questions():
        if q.get("topic") not in VISUALIZER_QUALITY_TOPICS:
            continue
        qid = q.get("id")
        visualizer = q.get("visualizer") or {}
        combined_text = " ".join(
            [
                str(visualizer.get("title") or ""),
                str(visualizer.get("caption") or ""),
                str(visualizer.get("focus") or ""),
                *(str(step.get(key) or "") for step in visualizer.get("steps") or [] for key in ("title", "body", "changed", "why", "code")),
            ]
        ).lower()
        if not str(visualizer.get("patternSketch") or visualizer.get("pattern_sketch") or "").strip():
            problems.append(f"{qid}: missing answer-safe pattern sketch")
        example = (q.get("examples") or [{}])[0]
        example_input = str(example.get("input") or "").strip()
        example_output = str(example.get("output") or "").strip()
        sample_state = visualizer.get("input") or {}
        visual_sample = str(sample_state.get("sample") or "").strip().rstrip(".")
        visual_sample_prefix = visual_sample[:-3] if visual_sample.endswith("...") else visual_sample
        if example_input and visual_sample_prefix and not example_input.startswith(visual_sample_prefix):
            problems.append(f"{qid}: visualizer sample does not use the authored example input")
        if example_output and example_output not in str(sample_state.get("goal") or ""):
            problems.append(f"{qid}: visualizer goal does not show the authored example output")
        for phrase in GENERIC_VISUALIZER_PHRASES:
            if phrase in combined_text:
                problems.append(f"{qid}: generic visualizer phrase {phrase!r}")
        for index, step in enumerate(visualizer.get("steps") or [], start=1):
            if not str(step.get("cue") or "").strip():
                problems.append(f"{qid}: visualizer step {index} missing prediction cue")
            state = step.get("state") or {}
            visible_state_keys = set(state) - {"items", "values", "active", "nodes", "edges", "grid", "activeCells"}
            if not visible_state_keys:
                problems.append(f"{qid}: visualizer step {index} missing visible state fields")

    assert problems == []


def test_answer_defaults_include_student_support_metadata():
    missing = []
    for language in LANGUAGES:
        data = json.loads((ANSWER_DIR / f"{language}.json").read_text(encoding="utf-8"))
        defaults = data.get("defaults") or {}
        for key in ("starter_code", "guided_steps", "reference_solution", "complexity"):
            if not defaults.get(key):
                missing.append(f"{language}: defaults missing {key}")
        if not isinstance(defaults.get("guided_steps"), list) or len(defaults.get("guided_steps") or []) < 3:
            missing.append(f"{language}: defaults guided_steps must have at least 3 steps")

    assert missing == []


def test_runner_tests_are_present_and_well_shaped():
    for language in LANGUAGES:
        allowed_missing = ALLOWED_NO_TESTS.get(language, set())
        problems = []
        for item in load_answer_items(language):
            qid = item.get("question_id")
            tests = item.get("runner_tests") or []
            if not tests:
                if qid not in allowed_missing:
                    problems.append(f"{language}/{qid}: no runner tests")
                continue
            if len(tests) < 3:
                problems.append(f"{language}/{qid}: fewer than 3 tests")
            # A blank function_name lets runtime grading silently fall back to a
            # default entrypoint (solve), so tests would run against the wrong
            # function; require it whenever runner_tests are present.
            if not str(item.get("function_name") or "").strip():
                problems.append(f"{language}/{qid}: missing function_name")
            for index, test in enumerate(tests, start=1):
                if "name" not in test or "args" not in test or "expected" not in test:
                    problems.append(f"{language}/{qid}: malformed test {index}")
                if not isinstance(test.get("args"), list):
                    problems.append(f"{language}/{qid}: args must be a list in test {index}")

        assert problems == []


def test_spec_backed_generated_starters_match_function_names():
    problems = []
    for language in LANGUAGES:
        for item in load_answer_items(language):
            function_name = str(item.get("function_name") or "").strip()
            if not function_name or not get_arg_spec(function_name):
                continue

            starter = build_starter_from_spec(language, function_name) or ""
            if function_name not in starter:
                problems.append(f"{language}/{item.get('question_id')}: starter omits {function_name}")
            if language in {"java", "cpp"} and ("Object[] args" in starter or "vector<Value>" in starter):
                problems.append(f"{language}/{item.get('question_id')}: starter fell back to legacy union shape")
            if language == "cpp" and "#include <bits/stdc++.h>" in starter:
                problems.append(f"{language}/{item.get('question_id')}: starter uses bits/stdc++.h")

    assert problems == []
