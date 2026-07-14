"""Tests for the Learn-mode lesson loader.

Two jobs, mirroring test_concept_quiz.py:

1. **An unauthored lesson returns None, not an error.** The category manifest is the
   roadmap of what the library will cover; the lesson files are what exists so far. That
   exact mismatch, unhandled, was a live 500 in the quiz loader for 10 of Python's 13
   categories. This loader must not repeat it.

2. **Content validation.** Lessons are hand-authored JSON, so every authored lesson is
   checked structurally: valid block kinds, code blocks that actually explain themselves,
   and — critically — a `refresher`, because that is what a student sees mid-question.
"""

import json
import os

import pytest

import concept_quiz
import lessons


ALL_LANGUAGES = ("python", "java", "javascript", "cpp")


def authored_lessons():
    """Every lesson that actually exists. Grows automatically as content is authored."""
    for language in ALL_LANGUAGES:
        for category in concept_quiz.categories_for_language(language):
            lesson = lessons.get_lesson(language, category["id"])
            if lesson:
                yield language, category["id"], lesson


# ---------------------------------------------------------------------------
# Unauthored is empty, not broken
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("language", ALL_LANGUAGES)
def test_every_category_is_loadable(language):
    """No category may raise, authored or not. This is the bug the quiz loader shipped."""
    for category in concept_quiz.categories_for_language(language):
        result = lessons.get_lesson(language, category["id"])
        assert result is None or isinstance(result, dict)


def test_unauthored_lesson_returns_none():
    # A category that exists in the manifest but has no lesson file yet.
    assert lessons.get_lesson("python", "user-input") is None
    assert lessons.has_lesson("python", "user-input") is False


def test_unknown_language_errors():
    with pytest.raises(lessons.LessonError):
        lessons.get_lesson("cobol", "loops")


def test_has_lesson_is_false_for_unknown_language():
    """`has_lesson` is called in a loop over a category list, so it must never raise —
    it degrades to False instead."""
    assert lessons.has_lesson("cobol", "loops") is False


def test_category_id_cannot_escape_the_lessons_directory():
    """A category id reaches this from the URL path. It must not be able to read
    arbitrary files off disk."""
    assert lessons.get_lesson("python", "../../../etc/passwd") is None
    assert lessons.get_lesson("python", "../../main") is None


# ---------------------------------------------------------------------------
# Content validation
# ---------------------------------------------------------------------------

def test_there_is_some_content():
    """Guard against the validation below silently passing on an empty set."""
    assert list(authored_lessons()), "no lessons authored at all"


def test_every_lesson_has_a_refresher():
    """The refresher is what shows in the Learn tab INSIDE a quiz question. A lesson that
    can't summarize itself in a few sentences can't help a student who is mid-question —
    and the refresher must come from the same file, or the two will drift and tell the
    student different things."""
    for language, category, lesson in authored_lessons():
        assert len(lesson["refresher"]) >= 40, f"{language}/{category}: refresher too short"


def test_refresher_derives_from_the_lesson():
    for language, category, lesson in authored_lessons():
        refresher = lessons.get_refresher(language, category)
        assert refresher is not None
        assert refresher["refresher"] == lesson["refresher"]
        assert refresher["title"] == lesson["title"]


def test_every_block_kind_is_valid():
    for language, category, lesson in authored_lessons():
        for block in lesson["blocks"]:
            assert block["kind"] in lessons.VALID_BLOCKS, (
                f"{language}/{category}: bad block kind {block['kind']!r}"
            )


def test_code_blocks_explain_themselves():
    """A code block with no caption is a snippet, not a lesson. The whole reason Learn
    exists is to say WHY, not just show."""
    for language, category, lesson in authored_lessons():
        for block in lesson["blocks"]:
            if block["kind"] == "code":
                assert block["caption"], (
                    f"{language}/{category}: a code block has no caption"
                )


def test_compare_blocks_have_both_sides():
    for language, category, lesson in authored_lessons():
        for block in lesson["blocks"]:
            if block["kind"] == "compare":
                assert block["wrong"].strip() and block["right"].strip()


def test_callout_tones_are_valid():
    for language, category, lesson in authored_lessons():
        for block in lesson["blocks"]:
            if block["kind"] == "callout":
                assert block["tone"] in lessons.VALID_TONES


def test_error_classes_match_the_telemetry_vocabulary():
    """A lesson's `error_classes` must use the SAME words the attempt telemetry records,
    or the loop can't close: "your last 4 runs didn't compile" can only route to a lesson
    if both sides agree on what "syntax" means."""
    from services import attempt_telemetry as t

    valid = {t.ERROR_SYNTAX, t.ERROR_RUNTIME, t.ERROR_WRONG_ANSWER, t.ERROR_TIMEOUT}
    for language, category, lesson in authored_lessons():
        for error_class in lesson["error_classes"]:
            assert error_class in valid, (
                f"{language}/{category}: '{error_class}' is not a telemetry error class "
                f"(expected one of {sorted(valid)})"
            )


def test_every_lesson_has_enough_checks():
    """A lesson must let the student DO something before it hands them to Practice.
    Six minutes of reading with nothing to answer is where attention goes, and arriving at
    the quiz having already got two right is a very different feeling from arriving cold.
    Enforced in the loader, not left to authoring discipline, because it's the easiest
    thing to skip and one of the most important not to."""
    for language, category, lesson in authored_lessons():
        checks = [b for b in lesson["blocks"] if b["kind"] == "check"]
        assert len(checks) >= lessons.MIN_CHECKS_PER_LESSON, (
            f"{language}/{category}: only {len(checks)} check block(s)"
        )


def test_a_lesson_without_checks_is_rejected():
    with pytest.raises(lessons.LessonDataError, match="check block"):
        lessons._normalize_lesson(
            {
                "title": "No checks",
                "refresher": "x" * 60,
                "blocks": [{"kind": "text", "body": "prose only, nothing to answer"}],
            },
            "python",
            "test",
        )


def test_check_answer_index_is_in_range():
    """An out-of-range answer would mark a correct student answer wrong, and nothing else
    in the system would notice."""
    for language, category, lesson in authored_lessons():
        for block in lesson["blocks"]:
            if block["kind"] != "check":
                continue
            assert 0 <= block["answer_index"] < len(block["choices"]), (
                f"{language}/{category}: check answer_index out of range"
            )


def test_check_blocks_explain_why():
    """A check that says "wrong" and stops teaches nothing. The `why` is the whole point
    of putting the question in the lesson rather than in the quiz."""
    for language, category, lesson in authored_lessons():
        for block in lesson["blocks"]:
            if block["kind"] == "check":
                assert len(block["why"]) >= 30, (
                    f"{language}/{category}: a check block's 'why' is too short"
                )


@pytest.mark.parametrize("bad_answer", [-1, 4, "1", None])
def test_check_with_a_bad_answer_index_is_rejected(bad_answer):
    with pytest.raises(lessons.LessonDataError):
        lessons._normalize_block(
            {
                "kind": "check",
                "prompt": "What does this print?",
                "choices": ["a", "b", "c"],
                "answer_index": bad_answer,
                "why": "because that is how it works, in detail",
            },
            where="test",
        )


def test_lessons_are_keyed_to_real_quiz_categories():
    """Learn and Practice must cover the SAME topics. A lesson file whose name doesn't
    match a category id would be unreachable — no page would ever link to it."""
    for language in ALL_LANGUAGES:
        directory = os.path.join(lessons.LESSONS_DIR, language)
        if not os.path.isdir(directory):
            continue
        valid_ids = {c["id"] for c in concept_quiz.categories_for_language(language)}
        for filename in os.listdir(directory):
            if not filename.endswith(".json"):
                continue
            category_id = filename[:-5]
            assert category_id in valid_ids, (
                f"{language}/{filename}: '{category_id}' is not a quiz category, so this "
                f"lesson is unreachable. Valid: {sorted(valid_ids)}"
            )
