"""Grounding gate thresholds: distinct sources, coverage, and the watch/enforce switch.

The gate's job is to decide whether an answer is backed well enough by the KB to
ship. Three things changed here and each fixes a way the old gate could be
satisfied without real backing:

1. **Sources, not chunks.** `_classify_grounding_chunks` counted raw chunks, and
   Vertex routinely returns several chunks from the SAME document. Two chunks out
   of `academic_faculty.json` is one source agreeing with itself, and it used to
   clear a "2 sources" bar. Now distinct documents are counted.

2. **Coverage floor 0.3 -> 0.5.**

3. **The no-segment fallback no longer auto-passes.** When Vertex returned KB
   chunks but no `groundingSupports`, coverage was hardcoded to exactly 0.5 --
   which would clear a `>= 0.5` bar on a magic number, in precisely the case
   where we have the least evidence. It is now 0.0, so missing evidence fails.

The connector is OR (`_GROUNDING_REQUIRE_BOTH = False`): either enough distinct
sources or enough coverage is sufficient.
"""
import pytest

import vertex_agent as va


TEXT = "The CS department office is in McMechen Hall 507 and opens at 8am."


def _kb(doc_name, title="Faculty"):
    return {"retrievedContext": {"document_name": doc_name, "title": title}}


# ---------------------------------------------------------------------------
# Distinct source counting
# ---------------------------------------------------------------------------

def test_two_chunks_from_the_same_document_count_as_one_source():
    """The whole point of the change: one document cannot corroborate itself."""
    chunks = [_kb("projects/x/documents/faculty"), _kb("projects/x/documents/faculty")]

    assert va._count_distinct_kb_sources(chunks) == 1


def test_chunks_from_different_documents_count_separately():
    chunks = [_kb("projects/x/documents/faculty"), _kb("projects/x/documents/schedule")]

    assert va._count_distinct_kb_sources(chunks) == 2


def test_web_chunks_are_never_counted_as_kb_sources():
    """A Google-Search-grounded answer must not satisfy a KB bar."""
    chunks = [{"web": {"uri": "https://a.com"}}, {"web": {"uri": "https://b.com"}}]

    assert va._count_distinct_kb_sources(chunks) == 0


def test_chunks_with_no_identifier_collapse_into_one_source():
    """If we cannot tell two chunks apart, we must not assume they are distinct.
    Counting them as one keeps the gate conservative rather than optimistic."""
    chunks = [{"retrievedContext": {}}, {"retrievedContext": {}}, {"retrievedContext": {}}]

    assert va._count_distinct_kb_sources(chunks) == 1


def test_uri_identifies_a_document_when_document_name_is_absent():
    chunks = [
        {"retrievedContext": {"uri": "gs://kb/a.json"}},
        {"retrievedContext": {"uri": "gs://kb/b.json"}},
    ]

    assert va._count_distinct_kb_sources(chunks) == 2


# ---------------------------------------------------------------------------
# Coverage computation, incl. the fallback that used to auto-pass
# ---------------------------------------------------------------------------

def test_coverage_is_the_grounded_fraction_of_the_answer():
    supports = [{"segment": {"startIndex": 0, "endIndex": 33}}]
    text = "x" * 66

    assert va._compute_coverage(supports, text, kb_chunks=1) == 0.5


def test_missing_segment_data_yields_zero_coverage_not_a_passing_half():
    """Was hardcoded to 0.5, which would clear a 0.5 threshold on a magic number.
    No evidence must not read as half evidence."""
    assert va._compute_coverage([], TEXT, kb_chunks=3) == 0.0


# ---------------------------------------------------------------------------
# The gate decision (OR)
# ---------------------------------------------------------------------------

def test_two_distinct_sources_pass_even_on_thin_coverage():
    out = va._apply_grounding_gate(TEXT, 4, coverage=0.1, sources=2, chat_mode="regular")

    assert out == TEXT


def test_high_coverage_passes_even_on_a_single_source():
    out = va._apply_grounding_gate(TEXT, 3, coverage=0.8, sources=1, chat_mode="regular")

    assert out == TEXT


def test_one_source_and_thin_coverage_fails():
    out = va._apply_grounding_gate(TEXT, 3, coverage=0.2, sources=1, chat_mode="regular")

    assert out != TEXT


def test_coverage_just_below_the_floor_fails():
    """0.49 with a single source clears neither arm of the OR."""
    out = va._apply_grounding_gate(TEXT, 3, coverage=0.49, sources=1, chat_mode="regular")

    assert out != TEXT


def test_several_chunks_from_one_document_no_longer_pass_the_source_bar():
    """The regression this change exists to close: 5 chunks, all one document."""
    out = va._apply_grounding_gate(TEXT, 5, coverage=0.1, sources=1, chat_mode="regular")

    assert out != TEXT


# ---------------------------------------------------------------------------
# Watch vs enforce
# ---------------------------------------------------------------------------

def test_watch_mode_leaves_the_answer_readable(monkeypatch):
    """Watch mode must not change what today's students see: the answer still
    ships, with the same disclaimer the old gate appended."""
    monkeypatch.setattr(va, "_GROUNDING_ENFORCE", False)

    out = va._apply_grounding_gate(TEXT, 3, coverage=0.1, sources=1, chat_mode="regular")

    assert out.startswith(TEXT)
    assert va._GROUNDING_DISCLAIMER.strip() in out


def test_enforce_mode_replaces_the_answer_entirely(monkeypatch):
    """Enforce mode is the actual prevention: the ungrounded text does not ship."""
    monkeypatch.setattr(va, "_GROUNDING_ENFORCE", True)

    out = va._apply_grounding_gate(TEXT, 3, coverage=0.1, sources=1, chat_mode="regular")

    assert TEXT not in out
    assert "compsci@morgan.edu" in out


def test_enforce_mode_does_not_touch_a_passing_answer(monkeypatch):
    monkeypatch.setattr(va, "_GROUNDING_ENFORCE", True)

    out = va._apply_grounding_gate(TEXT, 4, coverage=0.9, sources=2, chat_mode="regular")

    assert out == TEXT


# ---------------------------------------------------------------------------
# Exemptions that must survive the change
# ---------------------------------------------------------------------------

def test_student_data_answers_stay_exempt(monkeypatch):
    """GPA/Canvas answers come from the database, not the KB. Gating them on KB
    sources would break the planner and grade pages."""
    monkeypatch.setattr(va, "_GROUNDING_ENFORCE", True)

    out = va._apply_grounding_gate(
        TEXT, 1, coverage=0.0, sources=0, has_student_data=True, chat_mode="regular"
    )

    assert out == TEXT


def test_coding_tutor_stays_exempt(monkeypatch):
    monkeypatch.setattr(va, "_GROUNDING_ENFORCE", True)

    out = va._apply_grounding_gate(TEXT, 0, coverage=0.0, sources=0, chat_mode="coding_tutor")

    assert out == TEXT


def test_general_mode_is_not_gated_on_kb_sources(monkeypatch):
    """General mode answers from Google Search and has no KB chunks by design."""
    monkeypatch.setattr(va, "_GROUNDING_ENFORCE", True)

    out = va._apply_grounding_gate(TEXT, 0, coverage=0.0, sources=0, chat_mode="general")

    assert out == TEXT


def test_zero_chunks_still_delegates_to_the_zero_chunk_handler(monkeypatch):
    """Zero chunks has four distinct causes and its own handler. Enforcement must
    not swallow that path -- it never rewrites text, by design."""
    monkeypatch.setattr(va, "_GROUNDING_ENFORCE", True)

    out = va._apply_grounding_gate(TEXT, 0, coverage=0.0, sources=0, chat_mode="regular")

    assert out == TEXT
