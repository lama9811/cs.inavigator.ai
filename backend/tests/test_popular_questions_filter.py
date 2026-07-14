import os

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-not-for-production")

import pytest
from sqlalchemy import create_engine, func, or_, and_
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base
from models import ChatHistory
from main import (
    _is_cs_department_question,
    _dedupe_near_duplicates,
    _POPULAR_Q_CODING_MARKERS,
    _POPULAR_Q_FEATURE_SESSION_PREFIXES,
    _POPULAR_Q_MIN_LEN,
)


class TestPersonLookupsAreRejected:
    """"Who is X" questions are answered better by the chat than by a homepage chip,
    and they are what filled the welcome screen with "who is dr mack at moragn?"."""

    def test_rejects_who_questions(self):
        assert _is_cs_department_question("who is dr wang?") is False
        assert _is_cs_department_question("who is dr mack at moragn?") is False
        assert _is_cs_department_question("Who is the chair of the CS department?") is False

    def test_rejects_who_even_with_a_topic_word(self):
        # "professor" is a topic keyword, but this is still a person lookup.
        assert _is_cs_department_question("who is the professor for COSC 112?") is False


class TestPersonalRecallIsRejected:
    def test_rejects_personal_recall(self):
        assert _is_cs_department_question("what is my name?") is False
        assert _is_cs_department_question("what's my gpa") is False
        assert _is_cs_department_question("who is my advisor?") is False

    def test_keeps_generic_advising_questions_that_contain_my(self):
        """"How do I contact my academic advisor?" is a real CS-advising question. The
        personal filter must key on the recall shape, not on the word "my"."""
        assert _is_cs_department_question("How do I contact my academic advisor?") is True
        assert _is_cs_department_question("What courses should I take next semester if I'm interested in AI/ML?") is True


class TestOffTopicIsRejected:
    def test_rejects_world_knowledge(self):
        assert _is_cs_department_question("who is president of Us") is False
        assert _is_cs_department_question("what is the weather today") is False

    def test_requires_a_cs_department_topic(self):
        assert _is_cs_department_question("tell me a joke about bears") is False


class TestCsDepartmentQuestionsAreKept:
    def test_keeps_course_and_curriculum_questions(self):
        assert _is_cs_department_question("What are the prerequisites for COSC 450 Operating Systems?") is True
        assert _is_cs_department_question("How many credits do I need to graduate with a CS degree?") is True
        assert _is_cs_department_question("How do I register for CS courses?") is True
        assert _is_cs_department_question("Name one AI course at Morgan State.") is True


class TestDedupe:
    def test_collapses_near_identical_phrasings(self):
        """These two both surfaced on the live welcome screen, differing only by "I am"
        vs "I'm". Exact-match frequency ranking treats them as separate questions."""
        out = _dedupe_near_duplicates([
            "What courses should I take next semester if I am interested in AI/ML?",
            "What courses should I take next semester if I'm interested in AI/ML?",
        ])
        assert len(out) == 1

    def test_keeps_genuinely_different_questions(self):
        out = _dedupe_near_duplicates([
            "What are the prerequisites for COSC 450?",
            "How do I register for CS courses?",
        ])
        assert len(out) == 2

    def test_preserves_order_of_first_occurrence(self):
        out = _dedupe_near_duplicates(["How do I register for CS courses?", "What electives count toward the CS degree?"])
        assert out[0] == "How do I register for CS courses?"


# ---------------------------------------------------------------------------
# The DB-level filter. Every test above checks a pure text helper, and that is
# precisely why Coding Tutor questions kept reaching the home screen: the leak was in
# the QUERY, where nothing was looking.
# ---------------------------------------------------------------------------

@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    yield db
    db.close()


def _eligible(db):
    """Mirror the filters that /api/chat/popular-questions applies in the DB.

    Kept in step with main.py deliberately: the whole bug was that the query let coding
    rows through, so a test that doesn't exercise the query proves nothing.
    """
    normalized = func.lower(func.trim(ChatHistory.user_query))
    rows = (
        db.query(func.max(ChatHistory.user_query).label("display"))
        .filter(ChatHistory.user_query.isnot(None))
        .filter(func.char_length(func.trim(ChatHistory.user_query)) >= _POPULAR_Q_MIN_LEN)
        .filter(func.coalesce(ChatHistory.mode, "regular") == "regular")
        .filter(
            or_(
                ChatHistory.session_id.is_(None),
                and_(*[
                    ~ChatHistory.session_id.like(f"{p}%")
                    for p in _POPULAR_Q_FEATURE_SESSION_PREFIXES
                ]),
            )
        )
        .group_by(normalized)
        .all()
    )
    return [
        r.display
        for r in rows
        if not any(m in r.display.lower() for m in _POPULAR_Q_CODING_MARKERS)
    ]


def _ask(db, query, session_id="1783612676914", mode="regular"):
    db.add(ChatHistory(user_id=1, session_id=session_id, mode=mode,
                       user_query=query, bot_response="..."))
    db.commit()


class TestAdvisingPanelTrafficIsExcluded:
    """The advising-form side panel logs to chat_history too, and its questions were
    reaching the welcome screen.

    These only make sense with the form open. A student who clicks "What should I write
    for my career goals?" from the home screen lands in a general chat with no form in
    front of them, which is a worse experience than not offering it at all.
    """

    def test_advising_helper_question_is_excluded(self, session):
        """The exact question found leaking in the real chat_history."""
        _ask(session, "What should I write for my career goals?",
             session_id="advising-helper")
        assert _eligible(session) == []

    def test_a_future_advising_session_is_also_excluded(self):
        """The rule is a PREFIX, so a new advising-* session works without another patch.
        This is the point of a prefix list rather than a chain of special cases."""
        assert any(p == "advising-" for p in _POPULAR_Q_FEATURE_SESSION_PREFIXES)

    def test_asking_about_advising_in_the_MAIN_chat_is_still_kept(self, session):
        """The general chat is where advising questions SHOULD come from. Only the panel
        is excluded, not the topic — otherwise the fix would gut the welcome screen."""
        _ask(session, "can you help me with advising?", session_id="1783612676914")
        assert _eligible(session) == ["can you help me with advising?"]


class TestCodingTutorTrafficIsExcluded:
    """The bug: Coding Tutor questions were reaching the advising welcome screen.

    Two existing filters were assumed to stop them and neither did:

      * `mode == "regular"` — coding rows are WRITTEN with mode "regular", not
        "coding_tutor", so they pass straight through it.
      * the marker list — it matches five hard-coded phrases, so any coding question
        worded differently sails through.

    Keying on the session id is what actually catches them, whatever the wording.
    """

    def test_coding_workspace_question_is_excluded(self, session):
        _ask(session, "Can you provide a video that explains time complexity?",
             session_id="coding-1783451536388")
        assert _eligible(session) == []

    def test_coding_widget_question_is_excluded(self, session):
        _ask(session, "who is the chair of the comp sci department",
             session_id="coding-widget-1783005603401")
        assert _eligible(session) == []

    def test_a_coding_question_with_no_marker_phrase_is_still_excluded(self, session):
        """The exact leak seen in production. This question contains none of the five
        marker phrases, so the old filter let it through."""
        _ask(session, "Can you explain what recursion actually does here?",
             session_id="coding-1783451536388")
        assert _eligible(session) == []

    def test_mode_filter_alone_would_not_have_caught_it(self, session):
        """Pins the root cause. Coding rows carry mode "regular", so anyone who assumes
        the mode filter handles this (as main did) will be wrong."""
        _ask(session, "Can you explain what recursion actually does here?",
             session_id="coding-1783451536388", mode="regular")
        row = session.query(ChatHistory).one()
        assert row.mode == "regular", "coding rows really are stored as mode=regular"
        assert _eligible(session) == []


class TestAdvisingQuestionsSurvive:
    """The fix must not empty the welcome screen of the questions it exists to show."""

    def test_normal_advising_question_is_kept(self, session):
        _ask(session, "what are the prereqs for cosc 350", session_id="1783612676914")
        assert _eligible(session) == ["what are the prereqs for cosc 350"]

    def test_legacy_null_session_id_is_kept(self, session):
        """Rows predating session_id have NULL. An unguarded NOT LIKE evaluates to NULL
        for these and silently drops every one, emptying the welcome screen of exactly
        the advising history it's built from. The or_(is_(None), ...) guard prevents it."""
        _ask(session, "can you help me with advising?", session_id=None)
        assert _eligible(session) == ["can you help me with advising?"]

    def test_a_question_that_merely_mentions_code_is_kept(self, session):
        """"coding" in the TEXT is not "coding" in the SESSION. A student asking about
        coding courses in the advising chat is a legitimate advising question."""
        _ask(session, "which coding courses count toward the CS major?",
             session_id="1783612676914")
        assert _eligible(session) == ["which coding courses count toward the CS major?"]

    def test_advising_and_coding_together(self, session):
        _ask(session, "what are the prereqs for cosc 350", session_id="1783612676914")
        _ask(session, "Can you explain what recursion does here?",
             session_id="coding-1783451536388")
        assert _eligible(session) == ["what are the prereqs for cosc 350"]
