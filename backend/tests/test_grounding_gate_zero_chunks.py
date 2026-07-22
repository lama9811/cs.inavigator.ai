"""Grounding gate: the chunks == 0 branch.

The gate used to `return text` for every zero-chunk answer. That silently waved
through the one case it existed to catch — a CS Nav refusal with no retrieval
behind it, which is an agent bug, not evidence the knowledge base lacks content.
These tests pin all four causes of "zero KB chunks" apart.
"""
import vertex_agent as va


REFUSAL = (
    "I couldn't find that in my knowledge base. For the most accurate information, "
    "contact the CS department at (443) 885-3962 or compsci@morgan.edu."
)
DISCLAIMER = va._GROUNDING_DISCLAIMER


def _reset():
    va._set_grounding(False, 0, 0.0)


# --- the three benign causes: must stay untouched -------------------------

def test_general_mode_web_answer_is_untouched():
    """General mode answers from the web. A 'verify with the CS dept' note there
    would be nonsense."""
    _reset()
    text = "The latest stable release of Python is 3.14.6."
    assert va._apply_grounding_gate(text, 0, chat_mode="general") == text
    assert not va.get_last_grounding()["false_refusal_suspected"]


def test_mode_bounce_decline_is_untouched():
    """The 'ask this in General mode' decline is not an answer at all."""
    _reset()
    text = "I answer Morgan State CS questions here in CS Nav mode. Switch to General mode."
    out = va._apply_grounding_gate(text, 0, chat_mode="regular", bounced=True)
    assert out == text
    assert not va.get_last_grounding()["false_refusal_suspected"]


def test_student_data_answer_is_untouched():
    """Answered from DegreeWorks/Canvas — legitimately needs no KB chunk."""
    _reset()
    text = "You have 92 credits earned and 28 remaining."
    out = va._apply_grounding_gate(text, 0, chat_mode="regular", has_student_data=True)
    assert out == text
    assert DISCLAIMER not in out


def test_coding_tutor_is_untouched():
    _reset()
    text = "Your loop is off by one; start the index at 0."
    assert va._apply_grounding_gate(text, 0, chat_mode="coding_tutor") == text


# --- the bug case: must be detected ---------------------------------------

def test_false_refusal_is_flagged():
    """CS Nav mode + refusal + zero retrieval == the blind spot. The text is left
    alone (the refusal already carries the contact info) but it must be flagged."""
    _reset()
    out = va._apply_grounding_gate(REFUSAL, 0, chat_mode="regular")
    assert out == REFUSAL, "a refusal must not gain a redundant disclaimer"
    assert va.get_last_grounding()["false_refusal_suspected"] is True


def test_ungrounded_assertion_is_not_modified():
    """An unretrieved answer is often still correct — it can come from the
    kb_prefetch excerpts. It is logged, never disclaimed: the gate must not put
    "I may not have complete information" on a correct answer."""
    _reset()
    text = "Dr. Amjad Ali's office is in McMechen Hall 502."
    out = va._apply_grounding_gate(text, 0, chat_mode="regular")
    assert out == text
    assert DISCLAIMER not in out


def test_zero_chunk_path_never_rewrites_text():
    """Whole chunks == 0 branch is detection-only, whatever the answer looks like."""
    _reset()
    for text in [REFUSAL, "The CS department is in McMechen Hall.", "120 credits."]:
        assert va._apply_grounding_gate(text, 0, chat_mode="regular") == text


def test_greeting_still_skipped_before_zero_chunk_logic():
    """_SKIP_GROUNDING_RE runs first, so canned greetings never get a disclaimer."""
    _reset()
    text = "Hey! I'm CS Navigator, a chatbot for Computer Science students."
    out = va._apply_grounding_gate(text, 0, chat_mode="regular")
    assert out == text


# --- regression: the existing non-zero behaviour is unchanged -------------

def test_two_chunks_still_passes():
    _reset()
    text = "COSC 354 requires COSC 220 and COSC 241."
    assert va._apply_grounding_gate(text, 2, coverage=0.0, chat_mode="regular") == text


def test_one_chunk_low_coverage_still_flagged():
    _reset()
    text = "COSC 354 requires COSC 220 and COSC 241."
    out = va._apply_grounding_gate(text, 1, coverage=0.1, chat_mode="regular")
    assert out.endswith(DISCLAIMER)


def test_one_chunk_high_coverage_passes():
    _reset()
    text = "COSC 354 requires COSC 220 and COSC 241."
    out = va._apply_grounding_gate(text, 1, coverage=0.9, chat_mode="regular")
    assert out == text
