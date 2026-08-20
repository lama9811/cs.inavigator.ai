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
import re

import pytest

import concept_quiz as cq


ALL_LANGUAGES = ("python", "java", "javascript", "cpp")
QUESTION_PROMPT_IN_CODE_RE = re.compile(
    r"(^|\n)\s*(question\s*:|what\b|which\b|why\b|how\b|when\b|where\b|can\b)",
    re.IGNORECASE,
)
ADVANCED_ON_RAMP_CATEGORIES = {
    "bit-manipulation",
    "disjoint-sets",
    "dynamic-programming",
    "heaps",
    "intervals",
    "matrices",
    "prefix-sums",
    "tries",
}


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
            "python": {"beginner": 12, "intermediate": 11, "advanced": 18},
            "java": {"beginner": 12, "intermediate": 11, "advanced": 18},
            "javascript": {"beginner": 12, "intermediate": 7, "advanced": 18},
            "cpp": {"beginner": 12, "intermediate": 7, "advanced": 18},
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
        "binary-search",
        "debug",
        "debug-2",
        "disjoint-sets",
        "dynamic-programming",
        "heaps",
        "intervals",
        "matrices",
        "prefix-sums",
        "graphs",
        "hash-maps-sets",
        "linked-lists",
        "queues",
        "recursion-patterns",
        "sliding-window",
        "stacks",
        "trees",
        "tries",
        "two-pointers",
        "bit-manipulation",
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


def track_for(language, category_id):
    by_id = {category["id"]: category["track"] for category in cq.categories_for_language(language)}
    return by_id[category_id]


def test_there_is_some_content():
    """Guard against the validation below silently passing on an empty set."""
    assert list(authored_questions()), "no authored questions found at all"


def test_intermediate_and_advanced_code_blocks_show_context_not_a_second_question():
    for language, category, question in authored_questions():
        if track_for(language, category) not in {"intermediate", "advanced"}:
            continue
        code = question.get("code")
        if not isinstance(code, str) or not code.strip():
            continue
        assert not QUESTION_PROMPT_IN_CODE_RE.search(code), (
            f"{language}/{category}/{question['id']} puts a question prompt inside "
            "the code/context panel"
        )


def test_advanced_on_ramp_categories_have_applied_question_context():
    for language in ALL_LANGUAGES:
        for category in ADVANCED_ON_RAMP_CATEGORIES:
            questions = cq.questions_for_category(language, category)["questions"]
            applied = [
                question
                for question in questions
                if question.get("code") or question["kind"] in {"typein", "parsons"}
            ]
            assert len(applied) >= 2, (
                f"{language}/{category} needs at least two applied/code-context "
                "questions for advanced on-ramping"
            )


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


def test_mcq_choice_sets_are_not_reused_within_a_category():
    """Different questions should not show students the same answer card set."""
    for language in ALL_LANGUAGES:
        for category in cq.categories_for_language(language):
            seen_choice_sets = {}
            for question in cq.questions_for_category(language, category["id"])["questions"]:
                if not question["kind"].startswith("mcq"):
                    continue
                choices = question.get("choices") or []
                normalized = tuple(sorted(" ".join(str(choice).lower().split()) for choice in choices))
                if normalized in seen_choice_sets:
                    previous_id = seen_choice_sets[normalized]
                    raise AssertionError(
                        f"{language}/{category['id']}: {question['id']} reuses the "
                        f"same answer choices as {previous_id}"
                    )
                seen_choice_sets[normalized] = question["id"]


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


def test_question_prompts_do_not_reference_lessons():
    """Quiz questions should stand on their own.

    The Learn tab and explanations may remediate from the lesson, but the question prompt
    itself should not ask students to decode lesson wording. That made old questions feel
    stale and confusing, especially when the answer choices were lifted from examples.
    """
    blocked = (
        "what does the lesson mean",
        "according to the lesson",
        "as explained in the lesson",
        "read the line out loud",
        "this is the one fact to carry out of this lesson",
    )
    for language, category, q in authored_questions():
        prompt = (q.get("prompt") or "").lower()
        choices = [str(choice).lower() for choice in q.get("choices") or []]
        for phrase in blocked:
            assert phrase not in prompt, (
                f"{language}/{category}/{q['id']}: prompt references lesson wording"
            )
            assert all(phrase not in choice for choice in choices), (
                f"{language}/{category}/{q['id']}: choice references lesson wording"
            )


def test_authored_concept_checks_have_coherent_answer_choices():
    """No-code concept checks need four answers of the same kind.

    A reasoning prompt with one paragraph answer and three random numbers is a giveaway,
    not an assessment. Output-only distractors belong with output-tracing questions, not
    with conceptual review prompts.
    """
    conceptual_prompt_starters = (
        "which choice describes",
        "which recommendation belongs",
        "which guideline helps",
        "which choice shows sound reasoning",
        "a classmate is checking",
        "what is the main idea",
    )
    for language, category, q in authored_questions():
        if "-authored-" not in q["id"]:
            continue
        if q["kind"] != "mcq-behavior" or q.get("code") is not None:
            continue
        prompt = (q.get("prompt") or "").lower()
        if not (
            prompt.startswith(conceptual_prompt_starters)
            or "which statement" in prompt
            or "why" in prompt
            or "what happens" in prompt
        ):
            continue
        for choice in q.get("choices") or []:
            normalized = str(choice).strip()
            assert not re.fullmatch(r"[0-9.\s]+", normalized), (
                f"{language}/{category}/{q['id']}: numeric-only choice in concept check"
            )
            assert normalized.count("\n") < 2, (
                f"{language}/{category}/{q['id']}: code/output block used as concept distractor"
            )
            assert len(normalized) >= 8, (
                f"{language}/{category}/{q['id']}: concept choice is too thin"
            )
        lengths = [len(str(choice).strip()) for choice in q.get("choices") or []]
        if lengths:
            assert max(lengths) <= min(lengths) * 5, (
                f"{language}/{category}/{q['id']}: one concept choice dwarfs the others"
            )


def test_authored_concept_checks_do_not_reuse_the_same_wrong_answer_set():
    """A quiz bank should not feel like the same question wearing a new prompt.

    Reusing the same three distractors with different correct answers makes two
    neighboring questions look identical while grading differently. That is
    especially confusing for beginners because they cannot tell whether the
    target concept changed or the quiz is inconsistent.
    """
    for language in ALL_LANGUAGES:
        for category in cq.categories_for_language(language):
            seen_wrong_sets = {}
            questions = cq.questions_for_category(language, category["id"])["questions"]
            for question in questions:
                if "-authored-" not in question["id"]:
                    continue
                if question["kind"] != "mcq-behavior" or question.get("code") is not None:
                    continue

                choices = question.get("choices") or []
                wrong_choices = [
                    " ".join(str(choice).lower().split())
                    for index, choice in enumerate(choices)
                    if index != question["answer_index"]
                ]
                wrong_set = tuple(sorted(wrong_choices))
                if wrong_set in seen_wrong_sets:
                    previous_id = seen_wrong_sets[wrong_set]
                    raise AssertionError(
                        f"{language}/{category['id']}: {question['id']} reuses the "
                        f"same wrong-answer set as {previous_id}"
                    )
                seen_wrong_sets[wrong_set] = question["id"]


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

MOJIBAKE_SEQUENCES = (
    "\u00e2\u20ac\u201d",  # broken em dash
    "\u00e2\u20ac\u201c",  # broken en dash
    "\u00e2\u20ac\u00a6",  # broken ellipsis
    "\u00e2\u20ac\u02dc",  # broken left quote
    "\u00e2\u20ac\u2122",  # broken right quote
    "\u00e2\u20ac\u0153",  # broken left double quote
    "\u00e2\u20ac\ufffd",  # broken right double quote
    "\u00c2\u00b7",        # broken middle dot
    "\u00c2\u00a0",        # broken non-breaking space
    "\ufffd",
)

AUDITED_LEGACY_BAD_PHRASES = (
    "that reasoning supports the answer",
    "which recommendation belongs",
    "which guideline helps",
    "which choice shows sound reasoning",
    "a classmate is checking",
    "what does the lesson mean",
    "which statement best describes",
    "what is the main idea behind",
    "read the line out loud",
)

AUDITED_INTERMEDIATE_CATEGORIES_BY_LANGUAGE = {
    "python": {
        "tuples",
        "dictionaries",
        "sets",
        "file-handling",
        "exceptions",
        "classes-objects",
        "modules-imports",
        "comprehensions",
        "testing",
    },
    "java": {
        "classes-objects",
        "maps",
        "file-io",
        "exceptions",
        "inheritance-interfaces",
        "generics",
        "enums",
        "packages-access",
        "lambdas-streams",
    },
    "javascript": {
        "objects",
        "error-handling",
        "modules",
        "dom-events",
        "async-promises",
    },
    "cpp": {
        "pointers",
        "classes-objects",
        "file-io",
        "exceptions",
        "memory-ownership",
    },
}

AUDITED_SHARED_LEGACY_CATEGORIES = (
    "syntax",
    "operators",
    "variables",
    "data-types",
    "strings",
    "user-input",
    "conditionals",
    "loops",
    "lists",
    "functions",
    "algorithm-problems",
    "algorithm-problems-2",
    "debug",
    "debug-2",
)

INTERMEDIATE_AUDIT_BAD_PHRASES = (
    "this matters because",
    "which choice describes a reliable",
    "code review note is accurate",
    "habit prevents a common mistake",
    "advice is accurate",
    "reasoning is accurate",
    "concept check",
)

SHARED_LEGACY_AUDIT_BAD_PHRASES = (
    "this matters because",
    "that reasoning supports the answer",
    "which recommendation belongs",
    "which guideline helps",
    "which choice shows sound reasoning",
    "a classmate is checking",
    "what does the lesson mean",
    "according to the lesson",
    "as explained in the lesson",
    "read the line out loud",
    "assume the user always types",
    "ignore cancellation or empty input",
    "use one input method for every situation",
    "continue after failed extraction as if",
    "validate only the first test input",
    "read values in a different order than the prompt asks",
    "accept invalid input silently",
    "mix validation, conversion, and output",
)


def _visible_question_text(question):
    return " ".join([
        str(question.get("prompt") or ""),
        str(question.get("explanation") or ""),
        " ".join(str(choice) for choice in question.get("choices") or []),
    ]).lower()


def test_all_banks_reject_filler_templates_and_exact_duplicate_questions():
    """Quality rules apply to every bank, not only files produced by one authoring pass.

    Requiring an ``-authored-`` id accidentally gave older/template questions a free pass,
    which is how filler can return while the test suite remains green.
    """
    for language in ALL_LANGUAGES:
        for category in cq.categories_for_language(language):
            questions = cq.questions_for_category(language, category["id"])["questions"]
            prompt_code_pairs = [
                (
                    " ".join(question.get("prompt", "").lower().split()),
                    " ".join(str(question.get("code") or "").lower().split()),
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


def test_all_banks_do_not_use_generic_prompt_templates():
    for language, category, question in authored_questions():
        rendered = json.dumps(question, ensure_ascii=False).lower()
        matched = [
            phrase
            for phrase in AUDITED_LEGACY_BAD_PHRASES
            if phrase in rendered
        ]
        assert not matched, (
            f"{language}/{category}/{question['id']} still uses generic audit "
            f"phrases: {matched}"
        )


def test_audited_intermediate_banks_do_not_use_boilerplate():
    for language, categories in AUDITED_INTERMEDIATE_CATEGORIES_BY_LANGUAGE.items():
        for category in categories:
            for question in cq.questions_for_category(language, category)["questions"]:
                rendered = json.dumps(question, ensure_ascii=False).lower()
                matched = [
                    phrase
                    for phrase in INTERMEDIATE_AUDIT_BAD_PHRASES
                    if phrase in rendered
                ]
                assert not matched, (
                    f"{language}/{category}/{question['id']} still uses "
                    f"Intermediate audit boilerplate: {matched}"
                )


def test_audited_shared_legacy_banks_do_not_use_visible_boilerplate():
    for category in AUDITED_SHARED_LEGACY_CATEGORIES:
        for language in ALL_LANGUAGES:
            for question in cq.questions_for_category(language, category)["questions"]:
                visible = _visible_question_text(question)
                matched = [
                    phrase
                    for phrase in SHARED_LEGACY_AUDIT_BAD_PHRASES
                    if phrase in visible
                ]
                assert not matched, (
                    f"{language}/{category}/{question['id']} still uses shared "
                    f"legacy audit boilerplate: {matched}"
                )


def test_audited_shared_legacy_concept_choices_are_same_kind():
    for category in AUDITED_SHARED_LEGACY_CATEGORIES:
        for language in ALL_LANGUAGES:
            for question in cq.questions_for_category(language, category)["questions"]:
                if question["kind"] != "mcq-behavior":
                    continue
                if question.get("code") is not None:
                    continue
                choices = [str(choice).strip() for choice in question.get("choices") or []]
                if not choices:
                    continue
                for choice in choices:
                    assert not re.fullmatch(r"[0-9.\s]+", choice), (
                        f"{language}/{category}/{question['id']}: numeric-only "
                        f"choice in no-code concept check"
                    )
                    assert len(choice) >= 8, (
                        f"{language}/{category}/{question['id']}: concept choice "
                        f"is too thin: {choice!r}"
                    )
                    assert choice.count("\n") < 2, (
                        f"{language}/{category}/{question['id']}: code/output "
                        f"block used as concept distractor"
                    )
                lengths = [len(choice) for choice in choices]
                assert max(lengths) <= min(lengths) * 5, (
                    f"{language}/{category}/{question['id']}: one concept choice "
                    f"dwarfs the others"
                )


def test_audited_intermediate_banks_are_all_intermediate_track():
    for language, categories in AUDITED_INTERMEDIATE_CATEGORIES_BY_LANGUAGE.items():
        manifest_by_id = {
            category["id"]: category
            for category in cq.categories_for_language(language)
        }
        for category in categories:
            assert manifest_by_id[category]["track"] == "intermediate"
            assert cq.questions_for_category(language, category)["questions"]


def test_authored_quiz_text_has_no_mojibake_sequences():
    for language, category, question in authored_questions():
        rendered = json.dumps(question, ensure_ascii=False)
        matched = [seq for seq in MOJIBAKE_SEQUENCES if seq in rendered]
        assert not matched, (
            f"{language}/{category}/{question['id']} has mojibake sequences: "
            f"{[seq.encode('unicode_escape').decode('ascii') for seq in matched]}"
        )


def test_every_mcq_explanation_adds_more_than_the_correct_choice():
    for language in ALL_LANGUAGES:
        for category in cq.categories_for_language(language):
            questions = cq.questions_for_category(language, category["id"])["questions"]
            for question in questions:
                if not question.get("choices"):
                    continue
                correct = question["choices"][question["answer_index"]].strip().lower()
                explanation = question.get("explanation", "").strip().lower()
                assert explanation != correct, (
                    f"{language}/{category['id']}/{question['id']} only repeats its answer"
                )
                assert len(explanation) >= len(correct) + 20

# ---------------------------------------------------------------------------
# Cross-device progress, placement, and privacy
# ---------------------------------------------------------------------------

def test_stored_quiz_results_never_include_student_answers_or_code():
    from main import _stored_concept_results

    stored = _stored_concept_results([
        {
            "question_id": "privacy-check",
            "kind": "typein",
            "correct": False,
            "student_answer": "print('private attempt')",
            "correct_answer": "print('hello')",
            "explanation": "Not needed in the progress row.",
        }
    ])
    rendered = json.dumps(stored)
    assert "private attempt" not in rendered
    assert "correct_answer" not in rendered
    assert stored == [
        {"question_id": "privacy-check", "kind": "typein", "correct": False}
    ]


def test_progress_serializer_keeps_best_latest_status_and_unresolved_mistakes():
    from datetime import datetime, timedelta, timezone
    from main import _serialize_concept_progress
    from models import CodingConceptQuizAttempt

    questions = cq.questions_for_category("python", "syntax")["questions"][:2]
    first, second = questions
    now = datetime.now(timezone.utc)
    rows = [
        CodingConceptQuizAttempt(
            id=1,
            user_id=7,
            language="python",
            category="syntax",
            correct=0,
            total=2,
            score=0.0,
            results_json=json.dumps([
                {"question_id": first["id"], "kind": first["kind"], "correct": False},
                {"question_id": second["id"], "kind": second["kind"], "correct": False},
            ]),
            created_at=now,
        ),
        CodingConceptQuizAttempt(
            id=2,
            user_id=7,
            language="python",
            category="syntax",
            correct=1,
            total=2,
            score=0.5,
            results_json=json.dumps([
                {"question_id": first["id"], "kind": first["kind"], "correct": True},
                {"question_id": second["id"], "kind": second["kind"], "correct": False},
            ]),
            created_at=now + timedelta(minutes=1),
        ),
    ]

    payload = _serialize_concept_progress(rows)
    category = payload["categories"][0]
    assert category["attempts"] == 2
    assert category["best"]["score"] == 0.5
    assert category["last"]["score"] == 0.5
    assert category["questions"][first["id"]] == "correct"
    assert category["questions"][second["id"]] == "incorrect"
    assert [item["question_id"] for item in payload["mistakes"]] == [second["id"]]
    assert payload["mistakes"][0]["explanation"]


def test_mistake_bank_retry_resolves_original_question_without_fake_category():
    from datetime import datetime, timedelta, timezone
    from main import _serialize_concept_progress
    from models import CodingConceptQuizAttempt

    question = cq.questions_for_category("python", "syntax")["questions"][0]
    now = datetime.now(timezone.utc)
    rows = [
        CodingConceptQuizAttempt(
            id=1,
            user_id=7,
            language="python",
            category="syntax",
            correct=0,
            total=1,
            score=0.0,
            results_json=json.dumps([
                {"question_id": question["id"], "kind": question["kind"], "correct": False},
            ]),
            created_at=now,
        ),
        CodingConceptQuizAttempt(
            id=2,
            user_id=7,
            language="python",
            category="mistake-bank",
            correct=1,
            total=1,
            score=1.0,
            results_json=json.dumps([
                {
                    "category": "syntax",
                    "question_id": question["id"],
                    "kind": question["kind"],
                    "correct": True,
                },
            ]),
            created_at=now + timedelta(minutes=1),
        ),
    ]

    payload = _serialize_concept_progress(rows)
    categories = {item["category"]: item for item in payload["categories"]}
    assert "mistake-bank" not in categories
    assert payload["mistakes"] == []
    assert categories["syntax"]["questions"][question["id"]] == "correct"


def test_placement_uses_five_foundation_topics_without_leaking_answers():
    from main import PLACEMENT_CATEGORIES, _placement_questions, _public_placement_question

    questions = _placement_questions("python")
    assert [question["placement_category"] for question in questions] == list(PLACEMENT_CATEGORIES)
    assert len(questions) == 5
    for question in questions:
        public = _public_placement_question(question)
        assert question["kind"] in {"mcq-output", "mcq-behavior"}
        assert "answer_index" not in public
        assert "explanation" not in public
        assert len(public["choices"]) >= 3
