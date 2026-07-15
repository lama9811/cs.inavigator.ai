"""Concept-quiz loader for the Coding Tutor Practice Library.

These are the CodeChef-style multiple-choice / type-in / drag-and-drop quizzes,
distinct from the code-writing Practice Library (see main.py `_read_quiz_json`).

Content lives in ``backend/data_sources/concept_quiz/``:
  - ``_manifest.json``          category registry (one source of truth)
  - ``shared/<file>.json``      shared categories; each item carries a 4-way
                                ``variants`` map keyed python/java/javascript/cpp
  - ``by_language/<lang>/<file>.json``  language-specific categories; each item
                                is single-language (content at the item level,
                                no ``variants`` map)

The loader PROJECTS every item down to ONE requested language before serving,
so the frontend always receives a flat, single-language question object. This
keeps authoring simple (edit a shared concept once, all four languages update)
while the API stays language-scoped.

Design mirrors main.py's practice loader: a small in-memory mtime cache, a
normalizer that fills safe defaults, and pure functions the API layer calls.
No FastAPI imports here so this module stays testable on its own; the API layer
turns the ValueErrors raised here into HTTP errors.
"""

from __future__ import annotations

import json
import os
from typing import Any

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
CONCEPT_QUIZ_DIR = os.path.join(BACKEND_DIR, "data_sources", "concept_quiz")
MANIFEST_PATH = os.path.join(CONCEPT_QUIZ_DIR, "_manifest.json")
SHARED_DIR = os.path.join(CONCEPT_QUIZ_DIR, "shared")
BY_LANGUAGE_DIR = os.path.join(CONCEPT_QUIZ_DIR, "by_language")

# Canonical language keys. "c++" is accepted as an alias on the way in.
LANGUAGE_KEYS = ("python", "java", "javascript", "cpp")

# Question kinds the UI knows how to render. Anything else is a content error.
VALID_KINDS = {"mcq-output", "mcq-behavior", "typein", "parsons"}

# ---------------------------------------------------------------------------
# Raised for bad input (unknown language/category) — the API layer maps these
# to 400/404. Bad CONTENT (malformed files) raises ConceptQuizDataError → 500.
# ---------------------------------------------------------------------------
class ConceptQuizError(ValueError):
    """Client-fixable problem: unknown language or category."""


class ConceptQuizDataError(RuntimeError):
    """Server-side problem: a data file is missing or malformed."""


# Simple mtime cache so hot paths don't re-read/parse JSON every request.
_file_cache: dict[str, dict[str, Any]] = {}


def _read_json(path: str) -> Any:
    if not os.path.exists(path):
        raise ConceptQuizDataError(f"Concept-quiz file missing: {os.path.basename(path)}")
    mtime = os.path.getmtime(path)
    cached = _file_cache.get(path)
    if cached is not None and cached.get("mtime") == mtime:
        return cached["data"]
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ConceptQuizDataError(
            f"Concept-quiz file is invalid JSON: {os.path.basename(path)}"
        ) from exc
    _file_cache[path] = {"mtime": mtime, "data": data}
    return data


def normalize_language(language: str) -> str:
    """Return a canonical language key, accepting 'c++' as an alias for 'cpp'."""
    key = (language or "").lower().strip()
    if key in {"cpp", "c++"}:
        return "cpp"
    if key not in LANGUAGE_KEYS:
        valid = ", ".join(LANGUAGE_KEYS)
        raise ConceptQuizError(f"Language must be one of: {valid}.")
    return key


def load_manifest() -> dict[str, Any]:
    return _read_json(MANIFEST_PATH)


def categories_for_language(language: str) -> list[dict[str, Any]]:
    """The shared categories plus one language-specific category for a language.

    Each entry carries id/label/blurb/file plus ``scope`` ("shared" or
    "language") so the UI can tell them apart, and a ``count`` of questions
    available in that category for this language.
    """
    lang = normalize_language(language)
    manifest = load_manifest()

    out: list[dict[str, Any]] = []
    for cat in manifest.get("shared_categories", []):
        entry = {**cat, "scope": "shared"}
        paths = [_shared_path(cat["file"])]
        if cat.get("extra_file"):
            paths.append(_shared_path(cat["extra_file"]))
        entry["count"] = sum(_count_questions(path, lang, scope="shared") for path in paths)
        out.append(entry)

    specific = manifest.get("language_specific", {}).get(lang)
    if specific:
        entry = {**specific, "scope": "language"}
        entry["count"] = _count_questions(
            _by_language_path(lang, specific["file"]), lang, scope="language"
        )
        out.append(entry)
    return out


def _shared_path(file_stem: str) -> str:
    return os.path.join(SHARED_DIR, f"{file_stem}.json")


def _by_language_path(language: str, file_stem: str) -> str:
    return os.path.join(BY_LANGUAGE_DIR, language, f"{file_stem}.json")


def _resolve_category(language: str, category_id: str) -> tuple[dict[str, Any], str, str]:
    """Return (manifest entry, scope, file path) for a language + category.

    Raises ConceptQuizError if the category isn't offered for that language.
    """
    lang = normalize_language(language)
    wanted = (category_id or "").lower().strip()
    manifest = load_manifest()

    for cat in manifest.get("shared_categories", []):
        if cat["id"] == wanted:
            return cat, "shared", _shared_path(cat["file"])

    specific = manifest.get("language_specific", {}).get(lang)
    if specific and specific["id"] == wanted:
        return specific, "language", _by_language_path(lang, specific["file"])

    raise ConceptQuizError(
        f"Category '{category_id}' is not available for {lang}."
    )


def _count_questions(path: str, language: str, *, scope: str) -> int:
    """Count questions available for a language WITHOUT raising if the file is
    missing (a not-yet-authored category simply reports 0)."""
    if not os.path.exists(path):
        return 0
    try:
        data = _read_json(path)
    except ConceptQuizDataError:
        return 0
    count = 0
    for raw in data.get("questions", []):
        try:
            _project_question(raw, language, scope=scope)
            count += 1
        except ConceptQuizDataError:
            # A single malformed item shouldn't zero the whole category count.
            continue
    return count


def _project_question(raw: dict[str, Any], language: str, *, scope: str) -> dict[str, Any]:
    """Flatten one authored item into a single-language question object.

    Shared items have a ``variants`` map; we pull ``variants[language]`` up to
    the top level. Language-specific items already hold their content at the top
    level. Fields common to both (id, concept, difficulty, kind) are preserved.
    Returns a NEW dict; never mutates the cached source.
    """
    kind = str(raw.get("kind", "") or "").strip()
    if kind not in VALID_KINDS:
        raise ConceptQuizDataError(
            f"Question '{raw.get('id', '?')}' has unknown kind '{kind}'."
        )

    base = {
        "id": raw.get("id"),
        "concept": raw.get("concept"),
        "difficulty": str(raw.get("difficulty", "") or "").lower().strip(),
        "kind": kind,
    }
    # Optional shared metadata that lives at the item level for both scopes.
    # (title/typein_mode/goal/debug_style are per-question, not per-language, so
    # the samples put them on the item; a variant-level value still wins below.)
    #
    # `error_class` ties a question to the failure mode it teaches, using the SAME
    # vocabulary the attempt telemetry records (syntax / runtime / wrong_answer /
    # timeout — see services/attempt_telemetry.py). That shared vocabulary is what lets
    # the mastery model close the loop: "your last 4 runs didn't compile" can route the
    # student to the quizzes that teach syntax errors, instead of just telling them they
    # failed. Optional — most questions teach a concept, not a failure mode.
    for optional in ("title", "goal", "debug_style", "typein_mode", "error_class"):
        if optional in raw:
            base[optional] = raw[optional]

    if scope == "shared":
        variants = raw.get("variants")
        if not isinstance(variants, dict):
            raise ConceptQuizDataError(
                f"Shared question '{raw.get('id', '?')}' is missing a variants map."
            )
        variant = variants.get(language)
        if not isinstance(variant, dict):
            raise ConceptQuizDataError(
                f"Question '{raw.get('id', '?')}' has no '{language}' variant."
            )
        # Common fields can live on the question when only code differs by language.
        # A language variant still wins for any field it overrides.
        payload = {**raw, **variant}
    else:
        # Language-specific: content is at the item level. Guard that the file's
        # declared language matches what we're serving.
        item_lang = str(raw.get("language", language) or "").lower().strip()
        item_lang = "cpp" if item_lang in {"cpp", "c++"} else item_lang
        if item_lang != language:
            raise ConceptQuizDataError(
                f"Question '{raw.get('id', '?')}' is for '{item_lang}', not '{language}'."
            )
        payload = raw

    question = {**base, "language": language}
    _apply_variant_fields(question, payload, kind)
    return question


def _apply_variant_fields(question: dict[str, Any], payload: dict[str, Any], kind: str) -> None:
    """Copy the render fields for a given kind onto the flattened question,
    validating that the required pieces are present."""
    question["prompt"] = str(payload.get("prompt", "") or "")
    question["explanation"] = str(payload.get("explanation", "") or "")
    # ``code`` may be null (e.g. "write a statement" type-ins) — keep as-is.
    question["code"] = payload.get("code")

    if kind in {"mcq-output", "mcq-behavior"}:
        choices = payload.get("choices")
        answer_index = payload.get("answer_index")
        if not isinstance(choices, list) or len(choices) < 2:
            raise ConceptQuizDataError(
                f"MCQ '{question.get('id', '?')}' needs at least two choices."
            )
        if not isinstance(answer_index, int) or not (0 <= answer_index < len(choices)):
            raise ConceptQuizDataError(
                f"MCQ '{question.get('id', '?')}' has an out-of-range answer_index."
            )
        question["choices"] = [str(c) for c in choices]
        question["answer_index"] = answer_index
    elif kind == "typein":
        accepted = payload.get("accepted")
        if not isinstance(accepted, list) or not accepted:
            raise ConceptQuizDataError(
                f"Type-in '{question.get('id', '?')}' needs a non-empty accepted list."
            )
        question["accepted"] = [str(a) for a in accepted]
        if "typein_mode" in payload:
            question["typein_mode"] = payload["typein_mode"]
    elif kind == "parsons":
        lines = payload.get("lines")
        if not isinstance(lines, list) or len(lines) < 2:
            raise ConceptQuizDataError(
                f"Parsons '{question.get('id', '?')}' needs at least two lines."
            )
        question["lines"] = [str(line) for line in lines]


def questions_for_category(language: str, category_id: str) -> dict[str, Any]:
    """All questions for one language + category, each projected to that language.

    Returns { language, category, category_label, scope, questions[] }.

    A category in the manifest whose content file has not been authored yet returns an
    EMPTY question list — it is not an error. The manifest is the roadmap of what the
    Practice Library will cover; the files are what exists so far, and the two are
    allowed to disagree while authoring is in progress.

    This mirrors `_count_questions`, which has always reported an unauthored category as
    0 rather than raising. Without it the two disagreed: the category list rendered fine
    ("Loops · 0 questions") and then *clicking* Loops returned a 500. That was a real bug
    for every unauthored category — 10 of Python's 13 at the time of writing — and it
    became a front-door bug the moment Quiz became the Practice Library's default landing.
    """
    lang = normalize_language(language)
    cat, scope, path = _resolve_category(lang, category_id)

    questions: list[dict[str, Any]] = []
    paths = [path]
    if scope == "shared" and cat.get("extra_file"):
        paths.append(_shared_path(cat["extra_file"]))
    for content_path in paths:
        if os.path.exists(content_path):
            data = _read_json(content_path)
            for raw in data.get("questions", []):
                questions.append(_project_question(raw, lang, scope=scope))

    return {
        "language": lang,
        "category": cat["id"],
        "category_label": cat.get("label", cat["id"]),
        "scope": scope,
        "questions": questions,
    }


def find_question(language: str, category_id: str, question_id: str) -> dict[str, Any]:
    """A single projected question by id within a language + category."""
    wanted = (question_id or "").lower().strip()
    for question in questions_for_category(language, category_id)["questions"]:
        if str(question.get("id", "")).lower() == wanted:
            return question
    raise ConceptQuizError(f"Concept-quiz question '{question_id}' not found.")
