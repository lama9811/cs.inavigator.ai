"""The memory-port columns exist on the ORM models (build on a fresh SQLite DB)."""
from models import ChatHistory, UserMemory, User


def test_chat_history_has_memory_columns():
    cols = ChatHistory.__table__.columns.keys()
    for c in ("session_summary", "summary_through_id", "embedding", "embedding_model", "topic_label"):
        assert c in cols, f"ChatHistory missing {c}"


def test_user_memory_has_embedding_columns():
    cols = UserMemory.__table__.columns.keys()
    for c in ("embedding", "embedding_model", "paused"):
        assert c in cols, f"UserMemory missing {c}"


def test_user_has_last_chat_at():
    assert "last_chat_at" in User.__table__.columns.keys()
