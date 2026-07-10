"""Unit tests for General chat mode.

Two pieces of logic here are easy to get subtly wrong and impossible to
eyeball:

1. `groundingChunks` is a single array that BOTH Vertex AI Search and Google
   Search populate. Counting its length conflates web citations with KB
   citations, which would let a purely web-grounded answer pass the KB
   grounding gate.

2. The bounce marker is stripped from a *cumulative snapshot* stream. ADK
   emits growing snapshots and the caller diffs them, so a naive
   `text.replace(MARKER, "")` never matches a half-arrived marker and leaks
   `"[["` to the student's screen.

Both are pure functions operating on plain dicts/strings — no network, no DB.
"""
import pytest

from vertex_agent import (
    _CS_MODE_MARKER,
    _GENERAL_MODE_MARKER,
    _classify_grounding_chunks,
    _extract_web_sources,
    _strip_leading_marker,
    _looks_like_kb_refusal,
    _apply_grounding_gate,
    _apply_faithfulness_gate,
)


# ---------------------------------------------------------------------------
# Grounding chunk classification
# ---------------------------------------------------------------------------

def _kb_chunk(title="Advising Guide", uri="gs://kb/advising.pdf"):
    return {"retrievedContext": {"title": title, "uri": uri}}


def _web_chunk(title="Internships 2026", uri="https://example.com/jobs"):
    return {"web": {"title": title, "uri": uri}}


def test_counts_kb_and_web_chunks_separately():
    chunks = [_kb_chunk(), _web_chunk(), _kb_chunk(), _web_chunk(), _web_chunk()]
    kb, web = _classify_grounding_chunks(chunks)
    assert (kb, web) == (2, 3)


def test_web_only_answer_reports_zero_kb_chunks():
    """The bug this guards: len(chunks) would say 10 KB citations."""
    chunks = [_web_chunk() for _ in range(10)]
    kb, web = _classify_grounding_chunks(chunks)
    assert kb == 0
    assert web == 10


def test_classification_tolerates_empty_and_malformed_chunks():
    chunks = [None, {}, "garbage", {"unknown": {}}, _kb_chunk()]
    kb, web = _classify_grounding_chunks(chunks)
    assert (kb, web) == (1, 0)


def test_extracts_web_sources_in_order_skipping_kb_chunks():
    chunks = [
        _web_chunk("First", "https://a.test"),
        _kb_chunk(),
        _web_chunk("Second", "https://b.test"),
    ]
    assert _extract_web_sources(chunks) == [
        {"title": "First", "uri": "https://a.test"},
        {"title": "Second", "uri": "https://b.test"},
    ]


def test_web_source_missing_title_falls_back_to_empty_string():
    chunks = [{"web": {"uri": "https://a.test"}}]
    assert _extract_web_sources(chunks) == [{"title": "", "uri": "https://a.test"}]


# ---------------------------------------------------------------------------
# Bounce marker: leading-sentinel strip over cumulative snapshots
# ---------------------------------------------------------------------------

def test_partial_marker_is_withheld_rather_than_emitted():
    """A snapshot that is still a proper prefix of the marker must emit nothing.

    This is the whole point: `"[[CS".replace(MARKER, "")` is a no-op, so a
    naive strip would stream `"[["` to the user.
    """
    for partial in ["[", "[[", "[[CS", "[[CS_MODE_SUGGE"]:
        visible, found = _strip_leading_marker(partial)
        assert visible is None, f"{partial!r} should be withheld, got {visible!r}"
        assert found is False


def test_complete_marker_is_stripped_and_flagged():
    visible, found = _strip_leading_marker(_CS_MODE_MARKER + " That's a Morgan question.")
    assert visible == "That's a Morgan question."
    assert found is True


def test_text_that_cannot_become_the_marker_is_released_immediately():
    visible, found = _strip_leading_marker("Recursion is")
    assert visible == "Recursion is"
    assert found is False


def test_text_diverging_from_marker_prefix_is_released_immediately():
    """`"[x"` shares no full prefix with the marker, so don't stall the stream."""
    visible, found = _strip_leading_marker("[x")
    assert visible == "[x"
    assert found is False


def test_empty_snapshot_is_withheld():
    visible, found = _strip_leading_marker("")
    assert visible is None
    assert found is False


def test_marker_exactly_and_nothing_else_yields_empty_visible_text():
    visible, found = _strip_leading_marker(_CS_MODE_MARKER)
    assert visible == ""
    assert found is True


def test_general_mode_marker_strips_and_flags():
    """CS Nav mode emits the GENERAL marker to bounce a non-Morgan question."""
    visible, found = _strip_leading_marker(
        _GENERAL_MODE_MARKER + " That's a general question.", _GENERAL_MODE_MARKER)
    assert visible == "That's a general question."
    assert found is True


def test_general_marker_partial_is_withheld():
    for partial in ["[", "[[", "[[GENERAL", "[[GENERAL_MODE_SUGGE"]:
        visible, found = _strip_leading_marker(partial, _GENERAL_MODE_MARKER)
        assert visible is None, f"{partial!r} should be withheld"
        assert found is False


def test_two_markers_do_not_cross_match():
    """The CS marker must not be mistaken for the GENERAL marker and vice-versa."""
    v, f = _strip_leading_marker(_CS_MODE_MARKER + " x", _GENERAL_MODE_MARKER)
    # "[[CS..." is not a prefix of "[[GENERAL..." past "[[", so once it diverges
    # it's released as ordinary text, not treated as the general marker.
    assert f is False


def test_marker_never_leaks_across_a_realistic_snapshot_stream():
    """Replay growing snapshots the way ADK sends them; assert no leak."""
    final = _CS_MODE_MARKER + " That's a Morgan State-specific question."
    snapshots = [final[:i] for i in range(1, len(final) + 1)]

    emitted = []
    full_text = ""
    suggested = False
    for snap in snapshots:
        visible, found = _strip_leading_marker(snap)
        suggested = suggested or found
        if visible is None:
            continue
        if len(visible) > len(full_text):
            emitted.append(visible[len(full_text):])
            full_text = visible

    assert suggested is True
    assert "[" not in "".join(emitted)
    assert full_text == "That's a Morgan State-specific question."


def test_ordinary_general_answer_streams_unchanged():
    final = "Recursion is when a function calls itself."
    snapshots = [final[:i] for i in range(1, len(final) + 1)]

    full_text = ""
    suggested = False
    for snap in snapshots:
        visible, found = _strip_leading_marker(snap)
        suggested = suggested or found
        if visible is None:
            continue
        if len(visible) > len(full_text):
            full_text = visible

    assert suggested is False
    assert full_text == final


# ---------------------------------------------------------------------------
# The gates must behave correctly for the new mode
# ---------------------------------------------------------------------------

def test_web_grounded_answer_gets_no_morgan_disclaimer():
    """kb_chunks==0 => general lane => a 'verify with the CS dept' note is nonsense."""
    text = "Several internships are open right now."
    assert _apply_grounding_gate(text, 0, coverage=0.0, chat_mode="general") == text


def test_faithfulness_gate_still_runs_in_general_mode():
    """The fabricated-professor backstop matters MORE in general mode, not less."""
    text = "You should email Dr. Fakenamington about that."
    out = _apply_faithfulness_gate(text, chat_mode="general")
    assert out != text
    assert "may not match our department records" in out


def test_faithfulness_gate_accepts_real_faculty_in_general_mode():
    text = "Dr. Mack teaches that course."
    assert _apply_faithfulness_gate(text, chat_mode="general") == text


# ---------------------------------------------------------------------------
# Bounce backstop: recognize a KB refusal when the marker was dropped
# ---------------------------------------------------------------------------

def test_recognizes_standard_kb_refusal_by_phone():
    text = ("I couldn't find that in my knowledge base. For the most accurate "
            "information, contact the CS department at (443) 885-3962.")
    assert _looks_like_kb_refusal(text) is True


def test_recognizes_kb_refusal_by_email():
    text = "I don't have that in my knowledge base. Email compsci@morgan.edu."
    assert _looks_like_kb_refusal(text) is True


def test_ordinary_web_answer_is_not_a_refusal():
    text = "Several internships are open right now at local tech firms."
    assert _looks_like_kb_refusal(text) is False
