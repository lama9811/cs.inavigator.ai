"""Session-summary gate + realtime/idle helpers (no live Vertex)."""
import services.memory_service as ms


def test_summarize_older_turns_empty_returns_none():
    assert ms.summarize_older_turns("") is None
    assert ms.summarize_older_turns("   ") is None


def test_summarize_older_turns_uses_injected_client():
    class _Resp:
        text = "A concise summary."

    class _Models:
        def generate_content(self, **kw):
            return _Resp()

    class _Client:
        models = _Models()

    assert ms.summarize_older_turns("User: hi\nAssistant: yo", client=_Client()) == "A concise summary."


def test_consolidate_single_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_MEMORY", "false")
    assert ms.consolidate_user_memories_single(1)["status"] == "disabled"


def test_consolidate_idle_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_MEMORY", "false")
    assert ms.consolidate_idle_users()["status"] == "disabled"


def test_run_session_summary_gate_under_8_turns(monkeypatch):
    # A user with no turns must not attempt a summary (gate: >=8).
    assert ms.run_session_summary(987654, "no-such-session") is None
