"""Integration test: drive the REAL _run_query_stream against a mocked ADK SSE
stream. Unit tests prove the marker algorithm in isolation; this proves it's
actually wired into the streaming loop — the bug we most fear is the marker
leaking to the client as a bare "[[".
"""
import json
import types as _types

import vertex_agent


class _FakeResp:
    """Mimics requests' streaming Response for iter_lines()."""
    def __init__(self, lines):
        self.status_code = 200
        self._lines = lines

    def raise_for_status(self):
        pass

    def iter_lines(self):
        for ln in self._lines:
            yield ln.encode("utf-8") if isinstance(ln, str) else ln


def _sse(obj):
    return f"data: {json.dumps(obj)}"


def _model_event(text):
    return _sse({"content": {"role": "model", "parts": [{"text": text}]}})


def _drive(monkeypatch, snapshots, chat_mode, grounding_meta=None):
    """Feed `snapshots` (cumulative model texts) through the real stream fn."""
    lines = [_model_event(s) for s in snapshots]
    if grounding_meta is not None:
        # attach grounding to the final event
        lines.append(_sse({"groundingMetadata": grounding_meta,
                            "content": {"role": "model", "parts": [{"text": snapshots[-1]}]}}))

    monkeypatch.setattr(vertex_agent.requests, "post", lambda *a, **k: _FakeResp(lines))
    monkeypatch.setattr(vertex_agent, "_get_auth_headers", lambda: {})

    events = list(vertex_agent._run_query_stream(
        "who is dr mack", "u1", "sess1", chat_mode=chat_mode))
    return events


def test_split_marker_never_leaks_a_chunk(monkeypatch):
    final = vertex_agent._CS_MODE_MARKER + " That's a Morgan question, switch to CS Nav."
    snapshots = [final[:i] for i in range(1, len(final) + 1)]  # 1-char growth

    events = _drive(monkeypatch, snapshots, chat_mode="general")

    chunks = [e["content"] for e in events if e["type"] == "chunk"]
    assert "[" not in "".join(chunks), f"marker leaked: {chunks!r}"

    done = [e for e in events if e["type"] == "done"]
    assert done, "no done event"
    assert done[-1]["suggested_mode"] == "regular"
    assert "[[CS_MODE_SUGGESTED]]" not in done[-1]["content"]
    assert done[-1]["content"].startswith("That's a Morgan question")


def test_cs_nav_declines_non_morgan_and_suggests_general(monkeypatch):
    """CS Nav mode bounces a non-Morgan question to General mode, no marker leak."""
    final = vertex_agent._GENERAL_MODE_MARKER + " I answer Morgan State CS questions here."
    snapshots = [final[:i] for i in range(1, len(final) + 1)]

    events = _drive(monkeypatch, snapshots, chat_mode="regular")

    chunks = [e["content"] for e in events if e["type"] == "chunk"]
    assert "[" not in "".join(chunks), f"marker leaked: {chunks!r}"

    done = [e for e in events if e["type"] == "done"][-1]
    assert done["suggested_mode"] == "general"
    assert "[[GENERAL_MODE_SUGGESTED]]" not in done["content"]
    assert done["content"].startswith("I answer Morgan State CS questions")


def test_general_web_answer_carries_grounding_and_no_bounce(monkeypatch):
    snapshots = ["Several", "Several internships", "Several internships are open."]
    grounding = {
        "groundingChunks": [
            {"web": {"title": "Jobs", "uri": "https://jobs.test"}},
            {"web": {"title": "More", "uri": "https://more.test"}},
        ],
        "searchEntryPoint": {"renderedContent": "<div>chips</div>"},
        "webSearchQueries": ["cs internships"],
    }
    events = _drive(monkeypatch, snapshots, chat_mode="general", grounding_meta=grounding)

    done = [e for e in events if e["type"] == "done"][-1]
    assert done["suggested_mode"] is None
    assert done["grounding"] is not None
    assert done["grounding"]["searchEntryPoint"] == "<div>chips</div>"
    assert len(done["grounding"]["sources"]) == 2
    assert done["grounding"]["sources"][0]["uri"] == "https://jobs.test"


def test_regular_mode_kb_answer_has_no_grounding_payload(monkeypatch):
    snapshots = ["COSC 111", "COSC 111 meets MWF."]
    grounding = {
        "groundingChunks": [
            {"retrievedContext": {"title": "Schedule", "uri": "gs://kb/sched"}},
            {"retrievedContext": {"title": "Catalog", "uri": "gs://kb/cat"}},
        ],
    }
    events = _drive(monkeypatch, snapshots, chat_mode="regular", grounding_meta=grounding)

    done = [e for e in events if e["type"] == "done"][-1]
    # KB-grounded => no web grounding payload, no bounce
    assert done["grounding"] is None
    assert done["suggested_mode"] is None
