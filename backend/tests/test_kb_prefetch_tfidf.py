"""Ranking behaviour of the KB pre-injection scorer (`adk_agent/.../kb_prefetch.py`).

This layer is advisory ONLY. It exists so the model always has real KB text in
the prompt and therefore has no excuse to answer a Morgan question from training
memory. It is NOT the retriever, and it never produces grounding metadata --
`VertexAiSearchTool` does. See `test_prefetch_is_not_a_grounding_source`.

The scorer has broken twice, so these pin the properties that must hold:
  1. A term carries weight in inverse proportion to how many docs hold it.
     ("amjad" in 2 of 70 docs must beat "office" in 40 of 70.)
  2. A term in EVERY doc carries no information and must contribute nothing.
  3. Title matching is on TOKENS, never substrings ("dr" in "withDRawal").
  4. An exact course-code hit outranks any amount of word overlap.
"""
import importlib.util
import math
import time
from pathlib import Path

import pytest

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "adk_agent" / "cs_navigator_unified" / "kb_prefetch.py"
)


def _load_module():
    """Import kb_prefetch by path. Going through the package would run
    `cs_navigator_unified/__init__.py`, which pulls in the whole ADK agent."""
    spec = importlib.util.spec_from_file_location("kb_prefetch_under_test", _MODULE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def kb():
    return _load_module()


def _seed(mod, docs: dict[str, tuple[str, str]]):
    """Install a known corpus: {doc_id: (title, content)}."""
    cache = {doc_id: {"title": t, "content": c} for doc_id, (t, c) in docs.items()}
    mod._install_cache(cache)
    mod._cache_ts = time.time()


def _ranked_ids(mod, query, top_k=10):
    """Doc ids in the order the injected block lists them."""
    block = mod.prefetch_kb_context(query, top_k=top_k)
    if not block:
        return []
    return [doc_id for doc_id in mod._cache if f"[{mod._cache[doc_id]['title']}]" in block]


# ---------------------------------------------------------------------------
# 1. IDF shape -- the property the pre-BM25 scorer lacked entirely.
# ---------------------------------------------------------------------------

def test_rare_term_weighs_far_more_than_a_half_common_one(kb):
    """A term in 1 of 10 docs must weigh MORE THAN 3x one in 5 of 10.

    This is the discriminating assertion between weighting schemes. TF-IDF's
    log(N/df) gives 2.303 vs 0.693 -> 3.32x. BM25's smoothed idf gives 2.01 vs
    0.693 -> 2.90x, which fails. The whole reason the scorer was rewritten was
    that generic words could decide the ranking, so the sharper curve is the
    point, not an accident.
    """
    kb._df.clear()
    kb._df.update({"rare": 1, "half": 5})

    rare = kb._idf("rare", 10)
    half = kb._idf("half", 10)

    assert rare > 3.0 * half


def test_a_term_in_every_document_contributes_nothing(kb):
    """log(N/df) is exactly 0 when df == N. A word every doc contains cannot
    discriminate between them, so a doc matching ONLY that word must not be
    injected at all."""
    _seed(kb, {
        "a": ("Advising", "morgan advising walkthrough"),
        "b": ("Tutoring", "morgan tutoring hours"),
        "c": ("Refunds", "morgan refund policy"),
    })

    assert kb._idf("morgan", 3) == 0.0
    assert kb.prefetch_kb_context("morgan") == ""


def test_rare_surname_outranks_a_doc_stuffed_with_the_common_word(kb):
    """The original bug, end to end: "amjad" (1 of 5 docs) lost to "office"
    (5 of 5) because there was no IDF term at all."""
    _seed(kb, {
        "faculty":   ("CS Faculty", "Dr. Amjad Ali teaches systems. His office is McMechen 507."),
        "directory": ("Campus Directory", "office office office office office hours and office locations"),
        "refunds":   ("Refund Policy", "the bursar office issues refunds"),
        "advising":  ("Advising", "the advising office is open weekdays"),
        "tutoring":  ("Tutoring", "the tutoring office runs evening sessions"),
    })

    ranked = _ranked_ids(kb, "amjad ali office")

    assert ranked[0] == "faculty"


# ---------------------------------------------------------------------------
# 2. Title matching -- the "withDRawal" bug.
# ---------------------------------------------------------------------------

def test_title_match_is_token_level_not_substring(kb):
    """`"dr" in "Academic Withdrawal Refunds"` is True as a substring, which is
    how the faculty doc got buried at rank #28 for "Dr. Amjad Ali's office"."""
    _seed(kb, {
        "withdrawal": ("Academic Withdrawal Refunds", "refund schedule after withdrawal"),
        "faculty":    ("CS Faculty", "Dr. Amjad Ali, office McMechen 507, amjad.ali@morgan.edu"),
    })

    ranked = _ranked_ids(kb, "dr amjad ali office email")

    assert ranked[0] == "faculty"


# ---------------------------------------------------------------------------
# 3. Exact course code beats word overlap.
# ---------------------------------------------------------------------------

def test_exact_course_code_outranks_generic_word_overlap(kb):
    _seed(kb, {
        "schedule": ("Fall Schedule", "COSC 354 Operating Systems MW 10:00 Dr. Wang"),
        "catalog":  ("Course Catalog", "course course course descriptions and credits listing"),
    })

    ranked = _ranked_ids(kb, "who teaches COSC 354")

    assert ranked[0] == "schedule"


# ---------------------------------------------------------------------------
# 4. Scope -- this layer is anti-hallucination only.
# ---------------------------------------------------------------------------

def test_prefetch_is_not_a_grounding_source(kb):
    """The injected block must tell the model it is NOT the knowledge base and
    that the search tool still has to run. If this header ever reads as an
    authoritative KB lookup, the model stops calling `VertexAiSearchTool`,
    `kb_chunks` goes to 0, and answers get refused or ungrounded -- which is
    exactly the failure this text was rewritten to prevent."""
    # Needs a multi-doc corpus: with N == 1 every term has df == N, so log(N/df)
    # is 0 for all of them and nothing is injected. That is correct TF-IDF, not a
    # bug -- "inverse document frequency" says nothing about a one-doc corpus.
    _seed(kb, {
        "faculty":  ("CS Faculty", "Dr. Amjad Ali, office McMechen 507"),
        "refunds":  ("Refund Policy", "the bursar issues refunds after withdrawal"),
        "tutoring": ("Tutoring", "evening tutoring runs in the science complex"),
    })

    block = kb.prefetch_kb_context("amjad ali office")

    assert block
    assert "NOT" in block and "knowledge base" in block.lower()
    assert "search" in block.lower()


def test_scoring_never_reports_grounding(kb):
    """The scorer returns prompt text and nothing else -- no chunk counts, no
    coverage, no metadata. Grounding is measured only from Vertex's
    `groundingMetadata` in vertex_agent._classify_grounding_chunks."""
    # Needs a multi-doc corpus: with N == 1 every term has df == N, so log(N/df)
    # is 0 for all of them and nothing is injected. That is correct TF-IDF, not a
    # bug -- "inverse document frequency" says nothing about a one-doc corpus.
    _seed(kb, {
        "faculty":  ("CS Faculty", "Dr. Amjad Ali, office McMechen 507"),
        "refunds":  ("Refund Policy", "the bursar issues refunds after withdrawal"),
        "tutoring": ("Tutoring", "evening tutoring runs in the science complex"),
    })

    assert isinstance(kb.prefetch_kb_context("amjad ali office"), str)
    assert not hasattr(kb, "get_last_grounding")
    assert not any("grounding" in name.lower() for name in dir(kb))
