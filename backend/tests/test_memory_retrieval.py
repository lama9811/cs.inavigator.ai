"""Retrieval gating + 3-section context assembly."""
import services.memory_service as ms


def test_build_memory_context_three_sections():
    ctx = ms.build_memory_context(
        memories=[{"memory_type": "interest", "content": "Likes ML"}],
        relevant_memories=[{"memory_type": "career_goal", "content": "Wants grad school"}],
        relevant_turns=[{"timestamp": "2026-07-01T00:00:00", "user_query": "q", "bot_response": "a"}],
    )
    assert "USER MEMORY" in ctx
    assert "RELEVANT FROM PAST MEMORIES" in ctx
    assert "FROM PAST CONVERSATIONS" in ctx


def test_build_memory_context_empty():
    assert ms.build_memory_context([], None, None) == ""


def test_build_memory_context_only_longterm():
    ctx = ms.build_memory_context([{"memory_type": "interest", "content": "X"}])
    assert "USER MEMORY" in ctx
    assert "RELEVANT FROM PAST MEMORIES" not in ctx


def test_retrieve_relevant_memories_disabled(monkeypatch):
    monkeypatch.setenv("USE_SEMANTIC_MEMORY_RECALL", "false")
    assert ms.retrieve_relevant_memories(1, "anything") == []


def test_retrieve_relevant_turns_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_VERBATIM_RECALL", "false")
    assert ms.retrieve_relevant_turns(1, "anything") == []


def test_retrieve_empty_query_returns_empty():
    assert ms.retrieve_relevant_memories(1, "   ") == []
    assert ms.retrieve_relevant_turns(1, "") == []


def test_embed_turn_disabled_returns_false(monkeypatch):
    monkeypatch.setenv("ENABLE_VERBATIM_RECALL", "false")
    assert ms.embed_and_store_turn(999999) is False
