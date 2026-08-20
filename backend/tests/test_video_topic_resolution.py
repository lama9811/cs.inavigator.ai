import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from main import (
    clean_video_topic_label,
    resolve_video_request_topic_and_query,
    resolve_video_topic,
)


def test_video_followup_uses_previous_concrete_coding_topic():
    history = [
        {
            "user_query": "What is time complexity?",
            "bot_response": "Time complexity describes how runtime grows.",
        }
    ]

    topic, query = resolve_video_request_topic_and_query(
        "Can you give me a video explaining the concept?",
        "Problem: Count Vowels\nDescription: Count vowels in a string.",
        history,
        True,
    )

    assert topic == "time complexity"
    assert query == "time complexity"
    assert "concept" not in query.lower()


def test_video_followup_uses_previous_hashmaps_concept_before_workspace_problem():
    history = [
        {
            "user_query": "\n".join([
                "Current coding workspace context:",
                "Problem: Grade Bucket",
                "Language: Python",
                "Student message:",
                "Explain what hashmaps are in beginner terms.",
            ]),
            "bot_response": "Hash maps store values by key for fast lookup.",
        }
    ]

    topic, query = resolve_video_request_topic_and_query(
        "Can you provide a video that explain it to me?",
        "\n".join([
            "Current coding workspace context:",
            "Problem: Grade Bucket",
            "Language: Python",
            "Student message:",
            "Can you provide a video that explain it to me?",
        ]),
        history,
        True,
    )

    assert topic == "hash maps"
    assert query == "hash maps"


def test_explicit_hashmaps_video_request_is_not_treated_as_vague():
    topic, query = resolve_video_request_topic_and_query(
        "Can you provide a video that explains hashmaps to me?",
        "Problem: Grade Bucket\nDescription: Convert a score to a letter grade.",
        [],
        True,
    )

    assert topic == "hash maps"
    assert query == "hash maps"


def test_hidden_recent_coding_topic_hint_beats_workspace_fallback():
    topic, query = resolve_video_request_topic_and_query(
        "Can you provide a video that explain it to me?",
        "\n".join([
            "Current coding workspace context:",
            "Problem: Grade Bucket",
            "Recent coding conversation topic: hashmaps",
            "Student message:",
            "Can you provide a video that explain it to me?",
        ]),
        [],
        True,
    )

    assert topic == "hash maps"
    assert query == "hash maps"


def test_vague_video_topic_without_history_can_use_workspace_context():
    topic, query = resolve_video_request_topic_and_query(
        "Can you show me a video for this?",
        "Problem: Longest Unique Window\nDescription: Use a sliding window.",
        [],
        True,
    )

    assert topic
    assert "Longest Unique Window" in query
    assert "sliding window" in query


def test_clean_video_topic_treats_concept_as_vague():
    assert clean_video_topic_label("Can you give me a video explaining the concept?", fallback="") == ""
    assert resolve_video_topic(
        "Can you give me a video explaining the concept?",
        [{"user_query": "Explain recursion", "bot_response": "Recursion calls itself."}],
    ) == "recursion"
