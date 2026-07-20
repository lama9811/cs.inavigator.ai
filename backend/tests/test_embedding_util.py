"""Pure-function tests for the embedding utility (no live Vertex)."""
import numpy as np
from services.embedding_util import embed_text, cosine_sim, DEFAULT_MODEL, DEFAULT_DIMS


def test_constants():
    assert DEFAULT_MODEL == "text-embedding-004"
    assert DEFAULT_DIMS == 256


def test_embed_text_empty_returns_none():
    assert embed_text("") is None
    assert embed_text("   ") is None


def test_cosine_sim_identical_is_one():
    v = [1.0, 2.0, 3.0]
    assert abs(cosine_sim(v, v) - 1.0) < 1e-6


def test_cosine_sim_orthogonal_is_zero():
    assert abs(cosine_sim([1.0, 0.0], [0.0, 1.0])) < 1e-6


def test_cosine_sim_handles_none_and_empty():
    assert cosine_sim(None, [1.0]) == 0.0
    assert cosine_sim([], [1.0]) == 0.0


def test_cosine_sim_accepts_ndarray():
    assert abs(cosine_sim(np.array([1.0, 1.0]), [1.0, 1.0]) - 1.0) < 1e-6
