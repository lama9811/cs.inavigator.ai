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
    """An unauthored category is EMPTY, not an error.

    Deliberately does not name a real category. The original version pinned
    `python/user-input` as "the unauthored one", and broke the day that lesson was
    written — the test was tracking the content, not the behavior. The behavior is
    what matters: the manifest is the roadmap, the files are what exists so far, and a
    category with no file yet must return None rather than 500 the student's page.
    """
    assert lessons.get_lesson("python", "not-a-real-category") is None
    assert lessons.has_lesson("python", "not-a-real-category") is False


def test_python_track_is_complete():
    """Python is the recommended starting language, so its Learn track is the one a
    beginner is most likely to land in. Every category in the manifest has a lesson.

    This will fail if a new Python category is added to the manifest without a lesson to
    go with it, which is the point: the front door should not have an empty room in it.
    Other languages are deliberately not asserted here; they are still being authored.
    """
    missing = [
        category["id"]
        for category in concept_quiz.categories_for_language("python")
        if not lessons.has_lesson("python", category["id"])
    ]
    assert not missing, f"Python categories with no lesson: {missing}"


def test_lesson_prose_is_not_robotic():
    """The voice rules, enforced rather than trusted.

    The first Loops draft read as machine-written, and the cause was measurable: em-dashes
    used as all-purpose punctuation, bold as emphasis-by-force, and shouted caps. Those are
    exactly the tells a student registers as "a computer wrote this", and this is the one
    surface meant to feel like a person explaining something.

    Only PROSE is checked. Inline code spans are stripped first: `**` is Python's exponent
    operator and belongs in the Operators lesson, so matching it there would be a false
    positive, not a finding.
    """
    import re

    inline_code = re.compile(r"`[^`]*`")
    em_dash = re.compile(r"[—–]")          # em dash, en dash
    bold = re.compile(r"\*\*")
    shouted = re.compile(r"\b(NEVER|ALWAYS|MUST|BEFORE|ONLY|EVERY|ALL)\b")

    offenses = []
    for language, category, lesson in authored_lessons():
        prose = [lesson["refresher"], lesson["summary"]]
        for block in lesson["blocks"]:
            prose += [str(block.get(f, "")) for f in ("body", "caption", "title", "why", "prompt")]
            prose += [str(i) for i in block.get("items", [])]

        text = inline_code.sub("", "\n".join(prose))
        where = f"{language}/{category}"
        if em_dash.search(text):
            offenses.append(f"{where}: em-dash in prose")
        if bold.search(text):
            offenses.append(f"{where}: bold in prose (a callout block is the emphasis)")
        for word in set(shouted.findall(text)):
            offenses.append(f"{where}: shouted caps '{word}'")

    assert not offenses, "Lesson prose must not read as machine-written:\n  " + "\n  ".join(offenses)


def test_lessons_talk_about_python_not_about_the_student():
    """No pep talks. Teach the mistake; do not reassure the student about themselves.

    A real review finding. One lesson shipped a warning callout titled "An error message is
    information, not a verdict", whose body told the student a traceback "says nothing about
    whether you are cut out for this". A first-year scanning for how to fix their code hits an
    amber alert box about their self-esteem and thinks: why is this here.

    Two things went wrong, and both are worth naming. The tone was `warning`, so the UI shouted
    for attention in order to deliver encouragement. And only its last sentences ("run early,
    run often") could be acted on; the rest was preamble justifying the advice.

    The rule this enforces: normalize the MISTAKE, not the person. "This catches almost everyone
    at least once" is good, and deliberately still allowed, because it is a fact about the error
    that tells you not to go hunting for a deeper misunderstanding. "It does not mean you did
    anything careless" is about the reader's character, and is not.
    """
    import re

    # Prose about the student's feelings, ability, or self-worth. Not about Python.
    pep_talk = re.compile(
        r"cut out for|whether you are|not a verdict|not a judg[e]?ment"
        r"|does not mean you|doesn't mean you|you are not (bad|stupid|dumb|failing)"
        r"|ashamed|smart enough|impostor|your ability|reflection of you"
        r"|says nothing about (whether|you)",
        re.I,
    )

    offenses = []
    for language, category, lesson in authored_lessons():
        for index, block in enumerate(lesson["blocks"]):
            for field in ("body", "caption", "title", "why", "prompt"):
                text = str(block.get(field, ""))
                match = pep_talk.search(text)
                if match:
                    offenses.append(
                        f"{language}/{category} block[{index}].{field}: {match.group(0)!r}"
                    )

    assert not offenses, (
        "Lessons must teach Python, not reassure the student about themselves:\n  "
        + "\n  ".join(offenses)
    )


def test_no_stock_phrase_is_reused_across_lessons():
    """A phrase repeated in every lesson stops being writing and becomes a template.

    A real review finding, and the more interesting one. The reassurance "This catches almost
    everyone at least once" is genuinely good: it tells a student the mistake is common, so
    they stop hunting for a deeper misunderstanding they do not have. But it was used TWELVE
    times, in eleven of the thirteen lessons, always as the opening line of the mistake
    callout. A student who reads two lessons sees the seam. The sentence stops reading as a
    person being kind and starts reading as a slot in a form, which is exactly the thing the
    voice rules exist to prevent.

    So the rule is not "never reassure". It is "do not say it the same way every time". Any
    distinctive phrase appearing in more than two lessons is a template leaking through, and
    this test fails on it.

    Generic wording is deliberately not checked here. This looks only for long, distinctive
    phrasings, because those are the ones a reader recognizes as copy-paste.
    """
    import re
    from collections import defaultdict

    STOPWORDS_OK = 2  # a phrase may legitimately recur in at most this many lessons

    seen = defaultdict(set)
    for language, category, lesson in authored_lessons():
        prose = [lesson["refresher"], lesson["summary"]]
        for block in lesson["blocks"]:
            prose += [str(block.get(f, "")) for f in ("body", "caption", "title", "why", "prompt")]
            prose += [str(i) for i in block.get("items", [])]

        text = " ".join(prose).lower()
        text = re.sub(r"`[^`]*`", " ", text)      # code is allowed to repeat
        words = re.findall(r"[a-z']+", text)

        # 7-word shingles: long enough that a collision is a copied sentence, not a
        # coincidence of common English.
        for i in range(len(words) - 6):
            shingle = " ".join(words[i:i + 7])
            seen[shingle].add(f"{language}/{category}")

    overused = {
        phrase: sorted(where)
        for phrase, where in seen.items()
        if len(where) > STOPWORDS_OK
    }

    assert not overused, "Stock phrasing reused across lessons (a template showing through):\n  " + "\n  ".join(
        f'"{phrase}" in {where}' for phrase, where in sorted(overused.items())
    )


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
