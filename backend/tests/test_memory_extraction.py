"""Serialize round-trip + extraction JSON parsing + the FERPA filter rule."""
import services.memory_service as ms


def test_serialize_roundtrip():
    vec = [0.1, 0.2, 0.3]
    s = ms._serialize_embedding(vec)
    assert isinstance(s, str)
    assert ms._deserialize_embedding(s) == vec


def test_serialize_none_and_bad():
    assert ms._serialize_embedding(None) is None
    assert ms._serialize_embedding([]) is None
    assert ms._deserialize_embedding(None) is None
    assert ms._deserialize_embedding("not json") is None


def test_extraction_rules_exclude_grades_and_gpa():
    # The filter must forbid grades/GPA (guards the FERPA rule).
    assert "GPA" in ms.EXTRACTION_RULES_TEXT
    assert "grades" in ms.EXTRACTION_RULES_TEXT.lower()


def test_extraction_categories_are_the_approved_five():
    for cat in ("major_track", "interest", "career_goal", "preference", "context"):
        assert f'"{cat}"' in ms.EXTRACTION_RULES_TEXT
    # faculty-only ORA categories must NOT leak in
    for bad in ("irb_protocol", "iacuc_protocol", "active_grant", "sponsor"):
        assert bad not in ms.EXTRACTION_RULES_TEXT


class _FakeResp:
    def __init__(self, text):
        self.text = text


class _FakeModels:
    def __init__(self, text):
        self._text = text

    def generate_content(self, **kw):
        return _FakeResp(self._text)


class _FakeClient:
    def __init__(self, text):
        self.models = _FakeModels(text)


def test_extract_parses_fenced_json():
    client = _FakeClient('```json\n[{"type":"interest","content":"Likes ML"}]\n```')
    out = ms._extract_memories("Student: hi\nBot: hello", "None", client=client)
    assert out == [{"memory_type": "interest", "content": "Likes ML"}]


def test_extract_drops_empty_content():
    client = _FakeClient('[{"type":"interest","content":""},{"type":"goal","content":"Grad school"}]')
    out = ms._extract_memories("t", "None", client=client)
    assert out == [{"memory_type": "goal", "content": "Grad school"}]
