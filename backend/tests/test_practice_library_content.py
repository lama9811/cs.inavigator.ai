"""Guards for the code-writing Practice Library content.

These tests cover the authored coding problems in data_sources/quiz, not the
concept quizzes. The goal is to catch the two easiest ways the bank can drift:
adding a problem without runnable language metadata, or padding a topic with weak
prompt shape instead of a real practice task.
"""

import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QUESTION_DIR = ROOT / "data_sources" / "quiz" / "questions"
ANSWER_DIR = ROOT / "data_sources" / "quiz" / "answers"
LANGUAGES = ("python", "javascript", "java", "cpp")
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


def test_practice_questions_have_real_student_facing_shape():
    weak = []
    for q in load_questions():
        if not q.get("id") or not q.get("title") or not q.get("topic"):
            weak.append(f"{q.get('id')}: missing id/title/topic")
        if len(str(q.get("prompt") or "").split()) < 7:
            weak.append(f"{q.get('id')}: prompt too short")
        if not q.get("examples"):
            weak.append(f"{q.get('id')}: no example")
        if len(q.get("hints") or []) < 3:
            weak.append(f"{q.get('id')}: fewer than 3 hints")
        if "placeholder" in str(q.get("prompt") or "").lower():
            weak.append(f"{q.get('id')}: placeholder text")

    assert weak == []


def test_every_practice_topic_has_at_least_two_code_problems():
    counts = Counter(q.get("topic") for q in load_questions())
    thin = {topic: count for topic, count in counts.items() if count < 2}

    assert thin == {}


def test_answer_banks_match_questions_for_every_language():
    question_ids = {q["id"] for q in load_questions()}

    for language in LANGUAGES:
        answer_ids = [item.get("question_id") for item in load_answer_items(language)]
        assert len(answer_ids) == len(set(answer_ids)), f"{language}: duplicate answer ids"
        assert set(answer_ids) == question_ids, f"{language}: answer bank does not match questions"


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
            for index, test in enumerate(tests, start=1):
                if "name" not in test or "args" not in test or "expected" not in test:
                    problems.append(f"{language}/{qid}: malformed test {index}")
                if not isinstance(test.get("args"), list):
                    problems.append(f"{language}/{qid}: args must be a list in test {index}")

        assert problems == []
