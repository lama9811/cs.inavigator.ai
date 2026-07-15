"""Tests for the concept-quiz loader and the authored content itself.

Two jobs:

1. **An unauthored category is EMPTY, not broken.** The manifest is the roadmap of what
   the Practice Library will cover; the JSON files are what exists so far. Those two are
   allowed to disagree while authoring is in progress, and the API must survive it. This
   was a real 500 for 10 of Python's categories, and it became a *front-door* bug the
   moment Quiz became the default landing.

2. **Content validation.** These questions are hand-authored JSON — the single most
   likely place for a typo to ship. Every authored question is checked for a valid kind,
   an in-range answer, four language variants where required, and an explanation. A bad
   `answer_index` marks a correct student answer wrong, and nothing else in the system
   would catch it.
"""

import json
import os

import pytest

import concept_quiz as cq


ALL_LANGUAGES = ("python", "java", "javascript", "cpp")


def all_categories(language):
    return [c["id"] for c in cq.categories_for_language(language)]


# ---------------------------------------------------------------------------
# An unauthored category is empty, not an error
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("language", ALL_LANGUAGES)
def test_every_manifest_category_is_loadable(language):
    """The bug this pins: a category listed in the manifest whose file doesn't exist yet
    raised ConceptQuizDataError → HTTP 500. Every category in the manifest must load,
    authored or not."""
    for category_id in all_categories(language):
        result = cq.questions_for_category(language, category_id)
        assert isinstance(result["questions"], list)


@pytest.mark.parametrize("language", ALL_LANGUAGES)
def test_category_counts_agree_with_questions(language):
    """The category list and the category itself must not disagree. They did: the list
    said "Loops · 0 questions" (handled a missing file) and clicking Loops 500'd (didn't)."""
    for category in cq.categories_for_language(language):
        served = cq.questions_for_category(language, category["id"])["questions"]
        assert category["count"] == len(served), (
            f"{language}/{category['id']}: list says {category['count']}, "
            f"category serves {len(served)}"
        )


@pytest.mark.parametrize("language", ALL_LANGUAGES)
@pytest.mark.parametrize("category", ("syntax", "variables", "data-types"))
def test_expanded_foundation_categories_have_ten_questions(language, category):
    questions = cq.questions_for_category(language, category)["questions"]
    assert len(questions) == 10, (
        f"{language}/{category}: expected the complete 10-question foundation set, "
        f"found {len(questions)}"
    )


@pytest.mark.parametrize("language", ALL_LANGUAGES)
@pytest.mark.parametrize(
    ("category", "expected"),
    (("algorithm-problems", 8), ("algorithm-problems-2", 8), ("debug", 8), ("debug-2", 8)),
)
def test_two_part_algorithm_and_debug_banks_have_expected_counts(language, category, expected):
    questions = cq.questions_for_category(language, category)["questions"]
    assert len(questions) == expected


def test_part_two_questions_are_moderately_harder():
    for category in ("algorithm-problems-2", "debug-2"):
        for question in cq.questions_for_category("python", category)["questions"]:
            assert question["difficulty"] == "medium"

def test_categories_are_split_into_small_beginner_and_intermediate_tracks():
    for language in ALL_LANGUAGES:
        categories = cq.categories_for_language(language)
        by_track = {
            track: [category["id"] for category in categories if category["track"] == track]
            for track in cq.VALID_TRACKS
        }
        expected = {
            "python": {"beginner": 12, "intermediate": 11},
            "java": {"beginner": 12, "intermediate": 11},
            "javascript": {"beginner": 12, "intermediate": 7},
            "cpp": {"beginner": 12, "intermediate": 7},
        }[language]
        assert {track: len(ids) for track, ids in by_track.items()} == expected
        assert set().union(*map(set, by_track.values())) == set(all_categories(language))


def test_language_specific_topic_is_an_intermediate_next_step():
    for language in ALL_LANGUAGES:
        specific = [
            category for category in cq.categories_for_language(language)
            if category["scope"] == "language"
        ]
        assert len(specific) == 1
        assert specific[0]["track"] == "intermediate"

def test_invalid_track_metadata_is_rejected():
    with pytest.raises(cq.ConceptQuizDataError, match="invalid track"):
        cq._track_for_category({"id": "bad-track", "track": "expert"})


def test_every_extension_has_a_practice_bank():
    expected_ids = {
        "python": {"dictionaries", "sets", "file-handling", "exceptions", "classes-objects", "modules-imports", "comprehensions", "testing"},
        "java": {"maps", "file-io", "exceptions", "inheritance-interfaces", "generics", "enums", "packages-access", "lambdas-streams"},
        "javascript": {"error-handling", "modules", "dom-events", "async-promises"},
        "cpp": {"classes-objects", "file-io", "exceptions", "memory-ownership"},
    }
    for language in ALL_LANGUAGES:
        extensions = [
            category for category in cq.categories_for_language(language)
            if category["scope"] == "extension"
        ]
        assert {category["id"] for category in extensions} == expected_ids[language]
        assert all(category["track"] == "intermediate" for category in extensions)
        assert all(category["lesson_only"] is False for category in extensions)
        assert all(category["count"] >= 10 for category in extensions)


def test_every_registered_category_has_expected_practice_coverage():
    eight_question_categories = {
        "algorithm-problems",
        "algorithm-problems-2",
        "debug",
        "debug-2",
    }
    for language in ALL_LANGUAGES:
        underfilled = [
            f"{category['id']} ({category['count']})"
            for category in cq.categories_for_language(language)
            if category["count"] < (
                8 if category["id"] in eight_question_categories else 10
            )
        ]
        assert not underfilled, (
            f"{language} categories below their Practice target: {underfilled}"
        )


def test_unknown_category_still_errors():
    """"Not authored yet" and "no such category" are different answers. Only the first
    is allowed to return empty; a typo'd category must still fail loudly."""
    with pytest.raises(cq.ConceptQuizError):
        cq.questions_for_category("python", "not-a-real-category")


def test_unknown_language_still_errors():
    with pytest.raises(cq.ConceptQuizError):
        cq.questions_for_category("cobol", "syntax")


# ---------------------------------------------------------------------------
# Content validation — every authored question, every language
# ---------------------------------------------------------------------------

def authored_questions():
    """Every (language, category, question) actually served. Empty categories yield
    nothing, so this grows automatically as content is authored."""
    for language in ALL_LANGUAGES:
        for category_id in all_categories(language):
            for question in cq.questions_for_category(language, category_id)["questions"]:
                yield language, category_id, question


def test_there_is_some_content():
    """Guard against the validation below silently passing on an empty set."""
    assert list(authored_questions()), "no authored questions found at all"


def test_every_question_has_a_valid_kind():
    for language, category, q in authored_questions():
        assert q["kind"] in cq.VALID_KINDS, f"{language}/{category}/{q['id']}: bad kind {q['kind']!r}"


def test_mcq_answer_index_is_in_range():
    """The highest-value check here. An out-of-range or wrong answer_index marks a
    CORRECT student answer wrong — and nothing else in the system would notice."""
    for language, category, q in authored_questions():
        if not q["kind"].startswith("mcq"):
            continue
        choices = q.get("choices") or []
        idx = q.get("answer_index")
        assert isinstance(idx, int), f"{language}/{category}/{q['id']}: answer_index not an int"
        assert 0 <= idx < len(choices), (
            f"{language}/{category}/{q['id']}: answer_index {idx} out of range "
            f"for {len(choices)} choices"
        )


def test_mcq_choices_are_distinct():
    """Two identical choices means two correct answers, one of which is graded wrong."""
    for language, category, q in authored_questions():
        if not q["kind"].startswith("mcq"):
            continue
        choices = q.get("choices") or []
        assert len(set(choices)) == len(choices), (
            f"{language}/{category}/{q['id']}: duplicate choices {choices}"
        )


def test_mcq_has_at_least_three_choices():
    for language, category, q in authored_questions():
        if not q["kind"].startswith("mcq"):
            continue
        assert len(q.get("choices") or []) >= 3, (
            f"{language}/{category}/{q['id']}: needs 3+ choices"
        )


def test_typein_has_at_least_one_accepted_answer():
    for language, category, q in authored_questions():
        if q["kind"] != "typein":
            continue
        assert q.get("accepted"), f"{language}/{category}/{q['id']}: no accepted answers"


def test_parsons_has_lines_and_a_solution():
    for language, category, q in authored_questions():
        if q["kind"] != "parsons":
            continue
        assert q.get("lines"), f"{language}/{category}/{q['id']}: no lines"


def test_every_question_explains_itself():
    """A quiz that says "wrong" and nothing else teaches nothing. The explanation is the
    entire pedagogical payload — this is a tutor, not a scoreboard."""
    for language, category, q in authored_questions():
        explanation = (q.get("explanation") or "").strip()
        assert len(explanation) >= 15, (
            f"{language}/{category}/{q['id']}: explanation missing or too short"
        )


def test_grade_result_includes_readable_mcq_answer_review():
    from main import ConceptQuizAnswer, _grade_concept_answer

    question = {
        "id": "review-mcq",
        "kind": "mcq-output",
        "choices": ["one", "two", "three"],
        "answer_index": 1,
        "explanation": "Two is the expected result.",
    }
    result = _grade_concept_answer(
        question, ConceptQuizAnswer(question_id="review-mcq", choice_index=2)
    )
    assert result["correct"] is False
    assert result["student_answer"] == "three"
    assert result["correct_answer"] == "two"


def test_grade_result_includes_both_parsons_orders_for_review():
    from main import ConceptQuizAnswer, _grade_concept_answer

    question = {
        "id": "review-parsons",
        "kind": "parsons",
        "lines": ["first", "second"],
        "explanation": "The first step must happen before the second.",
    }
    result = _grade_concept_answer(
        question,
        ConceptQuizAnswer(question_id="review-parsons", order=["second", "first"]),
    )
    assert result["correct"] is False
    assert result["student_answer"] == ["second", "first"]
    assert result["correct_answer"] == ["first", "second"]


def test_code_answer_placeholder_does_not_reveal_a_solution():
    """A code-entry hint may describe the input shape, but must not contain an answer."""
    runner_path = os.path.join(
        os.path.dirname(cq.BACKEND_DIR),
        "frontend", "src", "components", "coding-tutor", "concept-quiz", "QuizRunner.jsx",
    )
    with open(runner_path, encoding="utf-8") as handle:
        runner = handle.read()
    assert 'e.g. print(\\"Hello\\")' not in runner
    assert 'question.typein_mode === "code" ? "Enter one statement"' in runner


def test_question_ids_are_unique_within_a_category():
    for language in ALL_LANGUAGES:
        for category_id in all_categories(language):
            questions = cq.questions_for_category(language, category_id)["questions"]
            ids = [q["id"] for q in questions]
            assert len(set(ids)) == len(ids), f"{language}/{category_id}: duplicate question ids"


# ---------------------------------------------------------------------------
# Shared questions must actually cover all four languages
# ---------------------------------------------------------------------------

def test_shared_questions_exist_in_every_language():
    """A shared category is authored once with a 4-way `variants` map. If a variant is
    missing, that question silently vanishes for that language — the category would show
    a different count per language and nobody would notice."""
    manifest = cq.load_manifest()
    for category in manifest["shared_categories"]:
        counts = {
            language: len(cq.questions_for_category(language, category["id"])["questions"])
            for language in ALL_LANGUAGES
        }
        assert len(set(counts.values())) == 1, (
            f"shared category '{category['id']}' has uneven coverage across languages: {counts}"
        )


FILLER_PHRASES = (
    "skip checks and assume every value is valid",
    "skip input checks and assume every value is valid",
    "hide errors and continue",
    "hide every error and continue",
    "put every step into one long statement",
    "put all of the work in one long statement",
    "inspect this state",
    "trace this carefully",
)


def test_expanded_banks_do_not_use_filler_templates_or_duplicate_prompts():
    for language in ALL_LANGUAGES:
        for category in cq.categories_for_language(language):
            questions = cq.questions_for_category(language, category["id"])["questions"]
            if not any("-authored-" in question["id"] for question in questions):
                continue

            authored_prompts = [
                question.get("prompt", "").strip().lower()
                for question in questions
                if "-authored-" in question["id"] and question.get("prompt", "").strip()
            ]
            assert len(authored_prompts) == len(set(authored_prompts)), (
                f"{language}/{category['id']} repeats an authored question prompt"
            )

            prompt_code_pairs = [
                (
                    question.get("prompt", "").strip().lower(),
                    question.get("code") or "",
                )
                for question in questions
                if question.get("prompt", "").strip()
            ]
            assert len(prompt_code_pairs) == len(set(prompt_code_pairs)), (
                f"{language}/{category['id']} repeats the same prompt and code"
            )

            for question in questions:
                rendered = str(question).lower()
                matched = [phrase for phrase in FILLER_PHRASES if phrase in rendered]
                assert not matched, (
                    f"{language}/{category['id']}/{question['id']} uses filler: {matched}"
                )


def test_authored_mcq_explanations_add_more_than_the_correct_choice():
    for language in ALL_LANGUAGES:
        for category in cq.categories_for_language(language):
            questions = cq.questions_for_category(language, category["id"])["questions"]
            for question in questions:
                if "-authored-" not in question["id"] or not question.get("choices"):
                    continue
                correct = question["choices"][question["answer_index"]].strip().lower()
                explanation = question.get("explanation", "").strip().lower()
                assert explanation != correct, (
                    f"{language}/{category['id']}/{question['id']} only repeats its answer"
                )
                assert len(explanation) >= len(correct) + 20
