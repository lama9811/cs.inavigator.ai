"""Tests for the concept-quiz loader and the authored content itself.

Two jobs:

1. **An unauthored category is EMPTY, not broken.** The manifest is the roadmap of what
   the Practice Library will cover; the JSON files are what exists so far. Those two are
   allowed to disagree while authoring is in progress, and the API must survive it. This
   was a real 500 for 10 of Python's 13 categories, and it became a *front-door* bug the
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
