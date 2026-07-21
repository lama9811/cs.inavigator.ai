"""Lesson loader for the Coding Tutor's Learn mode.

Learn is the first of the Practice Library's three modes — **Learn → Practice → Code**:
read the idea, check you got it, then apply it. Today a beginner who doesn't know what a
function is has nowhere to start; the quiz can only tell them they're wrong. Learn is
where they find out why.

## One source, two surfaces

Each lesson carries a `refresher` — 2–4 sentences and one example. That is what a student
sees in the **Learn tab inside a quiz question**: a reminder, not the whole lesson. It
lives in the same file as the lesson so the two cannot drift apart, which is exactly what
would happen if the refresher were authored separately.

## Content, and where it comes from

Lessons follow the topic sequence of the standard free intro texts (Runestone's
*Foundations of Python Programming*, Downey's *Think Python*, OpenStax's *Introduction to
Python Programming*). **All three are copyleft** — GFDL, CC BY-NC-SA, CC BY-NC-SA
respectively — so **no text is copied from any of them**. A topic sequence is not
copyrightable; prose is. Every word here is original, which keeps CS Navigator's content
unencumbered (the NonCommercial clauses in two of those licenses would otherwise follow
us forever).

Content lives in ``backend/data_sources/lessons/<language>/<category>.json`` and is keyed
to the SAME category ids as the concept quizzes (see data_sources/concept_quiz/
_manifest.json), so "Learn Loops" and "Practice Loops" are the same topic by construction.

Mirrors concept_quiz.py deliberately: an mtime cache, a normalizer with safe defaults,
pure functions, no FastAPI imports. A category with no lesson yet returns None rather than
raising — the manifest is the roadmap, the files are what exists so far, and the two are
allowed to disagree while authoring is in progress. (That mismatch, unhandled, was a live
500 in the quiz loader.)
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
LESSONS_DIR = os.path.join(BACKEND_DIR, "data_sources", "lessons")

LANGUAGE_KEYS = ("python", "java", "javascript", "cpp")

# Block kinds a lesson body may contain. The UI renders each differently; anything else
# is a content error rather than something to silently drop.
VALID_BLOCKS = {
    "text",      # a paragraph
    "code",      # a worked example: code + what it does
    "callout",   # a highlighted aside (tone: tip | warning | mistake)
    "compare",   # two snippets side by side (right vs wrong)
    "list",      # a bulleted list
    "check",     # an inline "did that land?" question, answered right in the lesson
}

VALID_TONES = {"tip", "warning", "mistake"}

# A lesson must let the student DO something before it hands them off to Practice.
# Reading for six minutes with nothing to answer is where attention goes, and arriving at
# the quiz having already got two right is a very different feeling from arriving cold.
#
# These are check-yourself questions, not an assessment: answered inline, revealed
# immediately, nothing recorded. Grading them would make Learn feel like a test, which is
# the one thing it exists not to be.
MIN_CHECKS_PER_LESSON = 2
MIN_SECTIONS_PER_LESSON = 2


class LessonError(ValueError):
    """Client-fixable: unknown language or category."""


class LessonDataError(RuntimeError):
    """Authoring bug: a malformed lesson file. Surfaces as a 500 because it means we
    shipped broken content, not that the student asked for something odd."""


_file_cache: dict[str, dict[str, Any]] = {}


def normalize_language(language: str) -> str:
    key = (language or "").lower().strip()
    if key in {"cpp", "c++"}:
        return "cpp"
    if key not in LANGUAGE_KEYS:
        raise LessonError(f"Language must be one of: {', '.join(LANGUAGE_KEYS)}.")
    return key


def _lesson_path(language: str, category_id: str) -> str:
    safe = os.path.basename((category_id or "").strip())
    return os.path.join(LESSONS_DIR, language, f"{safe}.json")


def _read_json(path: str) -> Any:
    mtime = os.path.getmtime(path)
    cached = _file_cache.get(path)
    if cached is not None and cached.get("mtime") == mtime:
        return cached["data"]
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise LessonDataError(f"Lesson file is invalid JSON: {os.path.basename(path)}") from exc
    _file_cache[path] = {"mtime": mtime, "data": data}
    return data


def _normalize_block(raw: Any, *, where: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise LessonDataError(f"{where}: a lesson block must be an object.")
    kind = str(raw.get("kind", "") or "").strip()
    if kind not in VALID_BLOCKS:
        raise LessonDataError(f"{where}: unknown block kind '{kind}'.")

    block: dict[str, Any] = {"kind": kind}

    if kind == "text":
        body = str(raw.get("body", "") or "").strip()
        if not body:
            raise LessonDataError(f"{where}: a text block needs a body.")
        block["body"] = body

    elif kind == "code":
        code = str(raw.get("code", "") or "")
        if not code.strip():
            raise LessonDataError(f"{where}: a code block needs code.")
        block["code"] = code
        # `caption` explains what the example DOES. A code block with no explanation is
        # a snippet, not a lesson.
        block["caption"] = str(raw.get("caption", "") or "").strip()
        block["output"] = str(raw.get("output", "") or "").strip()

    elif kind == "callout":
        tone = str(raw.get("tone", "tip") or "tip").strip().lower()
        if tone not in VALID_TONES:
            raise LessonDataError(f"{where}: callout tone must be one of {sorted(VALID_TONES)}.")
        body = str(raw.get("body", "") or "").strip()
        if not body:
            raise LessonDataError(f"{where}: a callout needs a body.")
        block["tone"] = tone
        block["title"] = str(raw.get("title", "") or "").strip()
        block["body"] = body

    elif kind == "compare":
        # Right vs wrong, side by side. The single most effective teaching block for the
        # mistakes our telemetry actually records.
        wrong = str(raw.get("wrong", "") or "")
        right = str(raw.get("right", "") or "")
        if not wrong.strip() or not right.strip():
            raise LessonDataError(f"{where}: a compare block needs both 'wrong' and 'right'.")
        block["wrong"] = wrong
        block["right"] = right
        block["wrong_label"] = str(raw.get("wrong_label", "") or "Doesn't work").strip()
        block["right_label"] = str(raw.get("right_label", "") or "Works").strip()
        block["caption"] = str(raw.get("caption", "") or "").strip()

    elif kind == "list":
        items = raw.get("items")
        if not isinstance(items, list) or not items:
            raise LessonDataError(f"{where}: a list block needs a non-empty items array.")
        block["items"] = [str(i).strip() for i in items if str(i).strip()]
        block["title"] = str(raw.get("title", "") or "").strip()

    elif kind == "check":
        # Multiple choice, answered and revealed inline. Deliberately NOT graded and NOT
        # recorded: this is "did that land?", not a test. The `why` is the whole point —
        # a check that says "wrong" and stops teaches nothing.
        prompt = str(raw.get("prompt", "") or "").strip()
        if not prompt:
            raise LessonDataError(f"{where}: a check block needs a prompt.")
        choices = raw.get("choices")
        if not isinstance(choices, list) or len(choices) < 2:
            raise LessonDataError(f"{where}: a check block needs at least 2 choices.")
        choices = [str(c) for c in choices]
        answer = raw.get("answer_index")
        if not isinstance(answer, int) or not 0 <= answer < len(choices):
            raise LessonDataError(
                f"{where}: check answer_index {answer!r} is out of range for "
                f"{len(choices)} choices."
            )
        why = str(raw.get("why", "") or "").strip()
        if not why:
            raise LessonDataError(f"{where}: a check block needs a 'why' explanation.")
        block["prompt"] = prompt
        block["code"] = str(raw.get("code", "") or "")
        block["choices"] = choices
        block["answer_index"] = answer
        block["why"] = why

    return block


def _normalize_section(raw: Any, *, where: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise LessonDataError(f"{where}: a lesson section must be an object.")

    section_id = str(raw.get("id", "") or "").strip()
    title = str(raw.get("title", "") or "").strip()
    if not section_id:
        raise LessonDataError(f"{where}: section needs an id.")
    if not title:
        raise LessonDataError(f"{where}: section needs a title.")

    blocks_raw = raw.get("blocks")
    if not isinstance(blocks_raw, list) or not blocks_raw:
        raise LessonDataError(f"{where}: section needs a non-empty blocks array.")

    return {
        "id": section_id,
        "title": title,
        "summary": str(raw.get("summary", "") or "").strip(),
        "question_ids": [
            str(q).strip() for q in (raw.get("question_ids") or []) if str(q).strip()
        ],
        "blocks": [
            _normalize_block(block, where=f"{where}.blocks[{i}]")
            for i, block in enumerate(blocks_raw)
        ],
    }


def _section_from_blocks(
    *,
    section_id: str,
    title: str,
    summary: str,
    blocks: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": section_id,
        "title": title,
        "summary": summary,
        "question_ids": [],
        "blocks": blocks,
    }


def _auto_sections_from_blocks(
    blocks: list[dict[str, Any]],
    *,
    lesson_title: str,
    lesson_summary: str,
) -> list[dict[str, Any]]:
    """Give legacy flat lessons smaller reading stops without changing their files."""
    checks = [block for block in blocks if block["kind"] == "check"]
    non_checks = [block for block in blocks if block["kind"] != "check"]
    first_example = next(
        (i for i, block in enumerate(non_checks) if block["kind"] in {"code", "compare"}),
        max(1, len(non_checks) // 2),
    )
    first_example = max(1, first_example)

    intro = non_checks[:first_example]
    practice = non_checks[first_example:]
    sections: list[dict[str, Any]] = []

    if intro:
        sections.append(
            _section_from_blocks(
                section_id="idea",
                title=f"What {lesson_title} means",
                summary=lesson_summary or "Start with the main idea before looking at code.",
                blocks=intro,
            )
        )

    if practice:
        sections.append(
            _section_from_blocks(
                section_id="examples",
                title="See it in code",
                summary="Read the example slowly, then compare it with the common mistake.",
                blocks=practice,
            )
        )

    if checks:
        sections.append(
            _section_from_blocks(
                section_id="check",
                title="Check your understanding",
                summary="Try these quick checks before moving into Practice.",
                blocks=checks,
            )
        )

    return sections or [
        _section_from_blocks(
            section_id="lesson",
            title=lesson_title,
            summary=lesson_summary,
            blocks=blocks,
        )
    ]


def _normalize_lesson(raw: dict[str, Any], language: str, category_id: str) -> dict[str, Any]:
    where = f"{language}/{category_id}"
    if not isinstance(raw, dict):
        raise LessonDataError(f"{where}: lesson file must be a JSON object.")

    title = str(raw.get("title", "") or "").strip()
    if not title:
        raise LessonDataError(f"{where}: lesson needs a title.")

    sections_raw = raw.get("sections")
    if isinstance(sections_raw, list) and sections_raw:
        sections = [
            _normalize_section(section, where=f"{where}.sections[{i}]")
            for i, section in enumerate(sections_raw)
        ]
        section_ids = [section["id"] for section in sections]
        if len(section_ids) != len(set(section_ids)):
            raise LessonDataError(f"{where}: section ids must be unique.")
        if len(sections) < MIN_SECTIONS_PER_LESSON:
            raise LessonDataError(
                f"{where}: has {len(sections)} section(s); sectioned lessons need at least "
                f"{MIN_SECTIONS_PER_LESSON} so the topic is split into smaller chunks."
            )
        blocks = [block for section in sections for block in section["blocks"]]
    else:
        blocks_raw = raw.get("blocks")
        if not isinstance(blocks_raw, list) or not blocks_raw:
            raise LessonDataError(f"{where}: lesson needs a non-empty blocks array.")
        blocks = [_normalize_block(b, where=f"{where}[{i}]") for i, b in enumerate(blocks_raw)]
        sections = _auto_sections_from_blocks(
            blocks,
            lesson_title=title,
            lesson_summary=str(raw.get("summary", "") or "").strip(),
        )
        blocks = [block for section in sections for block in section["blocks"]]

    # Enforced here rather than left to authoring discipline, because it is the thing
    # most easily skipped and the thing that most decides whether a lesson works.
    checks = sum(1 for b in blocks if b["kind"] == "check")
    if checks < MIN_CHECKS_PER_LESSON:
        raise LessonDataError(
            f"{where}: has {checks} check block(s); every lesson needs at least "
            f"{MIN_CHECKS_PER_LESSON} so the student answers something before being sent "
            f"to Practice."
        )

    # The refresher is what shows inside a quiz question. Required: a lesson that can't
    # summarize itself in a few sentences can't help a student who's mid-question.
    refresher = str(raw.get("refresher", "") or "").strip()
    if not refresher:
        raise LessonDataError(f"{where}: lesson needs a 'refresher' for the in-quiz Learn tab.")

    return {
        "language": language,
        "category": category_id,
        "title": title,
        "summary": str(raw.get("summary", "") or "").strip(),
        "minutes": int(raw.get("minutes", 0) or 0) or None,
        "sections": sections,
        "blocks": blocks,
        "refresher": refresher,
        "refresher_code": str(raw.get("refresher_code", "") or ""),
        # Failure modes this lesson addresses, in the SAME vocabulary the attempt
        # telemetry records (syntax / runtime / wrong_answer / timeout). This is the seam
        # that lets mastery route a student who keeps hitting syntax errors to the lesson
        # that teaches them, instead of only telling them they failed.
        "error_classes": [
            str(e).strip() for e in (raw.get("error_classes") or []) if str(e).strip()
        ],
    }


def get_lesson(language: str, category_id: str) -> Optional[dict[str, Any]]:
    """One lesson, or None if it hasn't been authored yet.

    None is NOT an error. The category manifest is the roadmap of what the Practice
    Library will cover; the lesson files are what exists so far. Callers render a
    "coming soon" state rather than a 500 — the same rule the quiz loader now follows.
    """
    lang = normalize_language(language)
    path = _lesson_path(lang, category_id)
    if not os.path.exists(path):
        return None
    return _normalize_lesson(_read_json(path), lang, category_id)


def get_refresher(language: str, category_id: str) -> Optional[dict[str, Any]]:
    """The compact recap for the Learn tab inside a quiz question.

    Derived from the SAME file as the full lesson, never authored separately — otherwise
    the refresher and the lesson would drift, and a student would be told two different
    things about the same concept.
    """
    lesson = get_lesson(language, category_id)
    if not lesson:
        return None
    return {
        "language": lesson["language"],
        "category": lesson["category"],
        "title": lesson["title"],
        "refresher": lesson["refresher"],
        "refresher_code": lesson["refresher_code"],
    }


def has_lesson(language: str, category_id: str) -> bool:
    """Cheap existence check (no parse) so a category list can flag which topics have a
    lesson without loading every file."""
    try:
        lang = normalize_language(language)
    except LessonError:
        return False
    return os.path.exists(_lesson_path(lang, category_id))
