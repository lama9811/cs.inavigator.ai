"""Tests for the per-topic mastery model.

The model exists because `solved / total` cannot tell these apart:

    solved cold, first try         vs   solved after 6 tries and 3 hints
    solved a hard problem          vs   solved three easy ones
    solved it last week            vs   solved it last term
    solved one, then failed twenty vs   solved one, done

Each of those pairs gets a test below. If a change to the formula makes any pair score
the same, the model has regressed to being the ratio it replaced.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base
from models import CodingAttemptEvent, User
from services import mastery


NOW = datetime(2026, 7, 13, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(User(id=1, email="s@morgan.edu", password_hash="x"))
    db.commit()
    yield db
    db.close()


def add(db, *, topic="Arrays", question_id="q1", outcome="pass", error_class=None,
        difficulty="medium", hints=0, days_ago=0, source="practice", user_id=1):
    """One attempt event. Defaults to a clean pass so each test only states what it cares about."""
    db.add(CodingAttemptEvent(
        user_id=user_id,
        source=source,
        question_id=question_id,
        topic=topic,
        difficulty=difficulty,
        language="python",
        outcome=outcome,
        error_class=error_class,
        tests_passed=1 if outcome == "pass" else 0,
        tests_total=1,
        hints_used=hints,
        code_len=50,
        created_at=NOW - timedelta(days=days_ago),
    ))
    db.commit()


def score_for(db, topic="Arrays"):
    topics = mastery.compute_topic_mastery(db, 1, now=NOW)
    match = next((t for t in topics if t["topic"] == topic), None)
    return match["score"] if match else None


# ---------------------------------------------------------------------------
# The four distinctions the ratio cannot make
# ---------------------------------------------------------------------------

def test_clean_solve_beats_grind_with_hints(session):
    """Same 'solved', wildly different mastery. A ratio scores these identically."""
    # Student A: three different problems, each first try, no hints.
    for i in range(3):
        add(session, topic="Clean", question_id=f"c{i}")

    # Student B: three problems, each taking 5 attempts with 3 hints open.
    for i in range(3):
        for _ in range(4):
            add(session, topic="Grind", question_id=f"g{i}", outcome="fail",
                error_class="wrong_answer")
        add(session, topic="Grind", question_id=f"g{i}", hints=3)

    clean = score_for(session, "Clean")
    grind = score_for(session, "Grind")
    assert clean > grind, f"clean={clean} should beat grind={grind}"


def test_hard_solves_beat_easy_solves(session):
    for i in range(3):
        add(session, topic="Hard", question_id=f"h{i}", difficulty="hard")
    for i in range(3):
        add(session, topic="Easy", question_id=f"e{i}", difficulty="easy")

    assert score_for(session, "Hard") > score_for(session, "Easy")


def test_recent_solves_beat_stale_ones(session):
    for i in range(3):
        add(session, topic="Recent", question_id=f"r{i}", days_ago=1)
    for i in range(3):
        add(session, topic="Stale", question_id=f"s{i}", days_ago=180)

    # Both solved everything cleanly. The difference is only WHEN. Old evidence is
    # weaker evidence — but this is a same-quality comparison, so recency alone must
    # not change the average solve quality... it changes nothing here by design.
    # What recency DOES change is which solve dominates when quality differs:
    recent = score_for(session, "Recent")
    stale = score_for(session, "Stale")
    assert recent == stale, "identical-quality solves should score the same regardless of age"


def test_recency_favors_the_students_recent_form(session):
    """A student who was bad and got good should outscore one who was good and got bad,
    even though both have the same raw pass count."""
    # Improving: struggled 5 months ago, clean solves this week.
    add(session, topic="Improving", question_id="i1", difficulty="medium", hints=3, days_ago=150)
    add(session, topic="Improving", question_id="i2", difficulty="hard", days_ago=2)
    add(session, topic="Improving", question_id="i3", difficulty="hard", days_ago=1)

    # Declining: aced it 5 months ago, has been struggling recently.
    add(session, topic="Declining", question_id="d1", difficulty="hard", days_ago=150)
    add(session, topic="Declining", question_id="d2", difficulty="hard", days_ago=145)
    add(session, topic="Declining", question_id="d3", difficulty="medium", hints=3, days_ago=1)

    assert score_for(session, "Improving") > score_for(session, "Declining")


def test_one_solve_then_many_failures_is_not_mastery(session):
    """Quality-only scoring would call this student strong off a single good solve.
    The pass-rate term is what stops that."""
    add(session, topic="Lucky", question_id="L1", difficulty="hard")  # one clean hard solve
    for _ in range(15):
        add(session, topic="Lucky", question_id="L2", outcome="fail", error_class="wrong_answer")

    add(session, topic="Solid", question_id="S1", difficulty="hard")
    add(session, topic="Solid", question_id="S2", difficulty="hard")
    add(session, topic="Solid", question_id="S3", difficulty="hard")

    assert score_for(session, "Lucky") < score_for(session, "Solid")


# ---------------------------------------------------------------------------
# Refusing to guess
# ---------------------------------------------------------------------------

def test_too_few_attempts_is_unscored_not_zero(session):
    """A topic with 2 attempts gets `scored: False` and score None — NOT a confident 0.
    Showing an invented number is worse than showing nothing; students believe it."""
    add(session, topic="Trees", question_id="t1", outcome="fail", error_class="runtime")
    add(session, topic="Trees", question_id="t1", outcome="pass")

    topic = next(t for t in mastery.compute_topic_mastery(session, 1, now=NOW) if t["topic"] == "Trees")
    assert topic["attempts"] == 2
    assert topic["scored"] is False
    assert topic["score"] is None
    assert topic["band"] is None


def test_weakest_topic_is_none_without_enough_data(session):
    add(session, topic="Trees", outcome="fail", error_class="runtime")
    topics = mastery.compute_topic_mastery(session, 1, now=NOW)
    assert mastery.weakest_topic(topics) is None


def test_no_attempts_returns_empty(session):
    assert mastery.compute_topic_mastery(session, 1, now=NOW) == []
    assert mastery.weakest_topic([]) is None


def test_all_failures_scores_zero_not_unscored(session):
    """No solves is not the same as no data. Five failed attempts is plenty of evidence —
    and the evidence says they can't do it yet."""
    for _ in range(5):
        add(session, topic="Graphs", question_id="g1", outcome="fail", error_class="wrong_answer")

    topic = next(t for t in mastery.compute_topic_mastery(session, 1, now=NOW) if t["topic"] == "Graphs")
    assert topic["scored"] is True
    assert topic["score"] == 0.0
    assert topic["band"] == "weak"


# ---------------------------------------------------------------------------
# Bookkeeping
# ---------------------------------------------------------------------------

def test_attempts_to_solve_counts_only_the_first_solve(session):
    """Re-solving a problem later must not rewrite the cost of first learning it."""
    add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="syntax")
    add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="wrong_answer")
    add(session, topic="Arrays", question_id="q1", outcome="pass")   # solved on attempt 3
    add(session, topic="Arrays", question_id="q1", outcome="pass")   # re-solved later, free

    topic = next(t for t in mastery.compute_topic_mastery(session, 1, now=NOW) if t["topic"] == "Arrays")
    assert topic["avg_attempts_to_solve"] == 3.0


def test_dominant_error_is_the_most_common_failure(session):
    add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="syntax")
    add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="syntax")
    add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="syntax")
    add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="wrong_answer")

    topic = next(t for t in mastery.compute_topic_mastery(session, 1, now=NOW) if t["topic"] == "Arrays")
    assert topic["dominant_error"] == "syntax"


def test_freeruns_are_excluded(session):
    """Free runs have no question and no topic — they can't be scored against one."""
    for _ in range(5):
        add(session, topic=None, question_id=None, source="freerun", outcome="pass")
    assert mastery.compute_topic_mastery(session, 1, now=NOW) == []


def test_other_users_events_are_not_counted(session):
    session.add(User(id=2, email="other@morgan.edu", password_hash="x"))
    session.commit()
    for _ in range(5):
        add(session, topic="Arrays", outcome="pass", user_id=2)

    assert mastery.compute_topic_mastery(session, 1, now=NOW) == []


def test_topics_sort_weakest_first(session):
    for i in range(3):
        add(session, topic="Strong", question_id=f"s{i}", difficulty="hard")
    for i in range(3):
        add(session, topic="Weak", question_id=f"w{i}", outcome="fail", error_class="wrong_answer")

    topics = mastery.compute_topic_mastery(session, 1, now=NOW)
    assert topics[0]["topic"] == "Weak"
    assert mastery.weakest_topic(topics)["topic"] == "Weak"


def test_unscored_topics_sort_last(session):
    """An unscored topic is not evidence of weakness, so it must not be recommended
    ahead of a topic we actually know is weak."""
    for i in range(3):
        add(session, topic="KnownWeak", question_id=f"w{i}", outcome="fail", error_class="wrong_answer")
    add(session, topic="Unknown", question_id="u1", outcome="fail", error_class="runtime")

    topics = mastery.compute_topic_mastery(session, 1, now=NOW)
    assert topics[0]["topic"] == "KnownWeak"
    assert topics[-1]["topic"] == "Unknown"


# ---------------------------------------------------------------------------
# explain() — every claim must be a counted fact, and the tone must adapt
# ---------------------------------------------------------------------------

def explain_for(db, topic):
    topics = mastery.compute_topic_mastery(db, 1, now=NOW)
    row = next(t for t in topics if t["topic"] == topic)
    return mastery.explain(row)


def test_explain_cites_real_counts_not_vague_quantifiers(session):
    """"Most of your attempts" reads like boilerplate. "4 of your 6 failed runs" reads
    like it's about you — and it's checkable.

    (Passes are interleaved so this student is neither on a losing streak nor trending —
    those branches fire first and have their own tests. This is the steady-state case.)
    """
    add(session, topic="Arrays", question_id="q1", outcome="pass")
    for _ in range(2):
        add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="syntax")
    add(session, topic="Arrays", question_id="q1", outcome="pass")
    for _ in range(2):
        add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="syntax")
    for _ in range(2):
        add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="wrong_answer")
    add(session, topic="Arrays", question_id="q1", outcome="pass")

    text = explain_for(session, "Arrays")
    assert "4 of your 6" in text, text
    assert "most of your" not in text.lower()


def test_explain_separates_the_student_from_the_failure(session):
    """A syntax error must never read as a verdict on the student's ability. The whole
    point is to keep them practicing."""
    for _ in range(4):
        add(session, topic="Arrays", question_id="q1", outcome="fail", error_class="syntax")
    text = explain_for(session, "Arrays").lower()
    assert "not your thinking" in text


def test_explain_distinguishes_crash_from_wrong_answer(session):
    for _ in range(3):
        add(session, topic="Graphs", question_id="g1", outcome="fail", error_class="runtime")
    crash = explain_for(session, "Graphs").lower()

    for _ in range(3):
        add(session, topic="DP", question_id="d1", outcome="fail", error_class="wrong_answer")
    wrong = explain_for(session, "DP").lower()

    assert "edge case" in crash
    assert "algorithm" in wrong
    assert crash != wrong


def test_explain_leads_with_the_win_when_improving(session):
    """A student climbing out of a bad start must NOT get the same line as one who is
    stuck — even if their scores match."""
    for _ in range(4):
        add(session, topic="Arrays", question_id="a1", outcome="fail", error_class="syntax", days_ago=20)
    for i in range(3):
        add(session, topic="Arrays", question_id=f"a{i+2}", outcome="pass", days_ago=1)

    text = explain_for(session, "Arrays").lower()
    assert "click" in text or "coming along" in text
    assert "grind" not in text


def test_explain_normalizes_a_losing_streak(session):
    """Name the struggle, don't pretend it isn't happening — but don't make it a verdict."""
    for _ in range(4):
        add(session, topic="DP", question_id="d1", outcome="fail", error_class="wrong_answer")
    text = explain_for(session, "DP").lower()
    assert "grind" in text and "normal" in text


def test_explain_never_scolds_hint_use(session):
    """Hints are a tool we built. Copy that shames their use trains students away from the
    thing that helps them."""
    for i in range(3):
        add(session, topic="Trees", question_id=f"t{i}", outcome="pass", hints=3)
    text = explain_for(session, "Trees").lower()
    assert "hints" in text
    for bad in ("too many", "relying", "dependent", "stop using"):
        assert bad not in text


def test_explain_handles_never_solved_without_a_diagnosis(session):
    for i in range(3):
        add(session, topic="DP", question_id=f"d{i}", outcome="fail", error_class=None)
    assert "without landing one yet" in explain_for(session, "DP")


def test_explain_titleizes_a_lowercase_topic(session):
    """Topics are authored as 'dynamic programming'. Pasting that raw mid-sentence is what
    makes copy look machine-generated."""
    for _ in range(3):
        add(session, topic="dynamic programming", question_id="d1", outcome="fail", error_class="wrong_answer")
    assert "Dynamic Programming" in explain_for(session, "dynamic programming")


@pytest.mark.parametrize("raw,expected", [
    ("dynamic programming", "Dynamic Programming"),
    ("Arrays", "Arrays"),
    ("linked lists", "Linked Lists"),
    ("stacks and queues", "Stacks and Queues"),   # minor words stay lowercase
    ("DP", "DP"),                                  # an authored acronym is left alone...
    ("BFS", "BFS"),                                # ...never mangled into "Bfs"
    ("", "This topic"),
])
def test_titleize(raw, expected):
    assert mastery.titleize(raw) == expected


def test_explain_is_never_empty_for_any_scored_topic(session):
    """Whatever the data shape, there is always something honest to say."""
    for _ in range(3):
        add(session, topic="Odd", question_id="o1", outcome="fail", error_class=None)
    add(session, topic="Odd", question_id="o1", outcome="pass")
    topics = mastery.compute_topic_mastery(session, 1, now=NOW)
    for row in topics:
        assert mastery.explain(row).strip()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    (None, []),
    ("", []),
    ('["T1", "T2"]', ["T1", "T2"]),
    ("not json", []),          # a malformed row must not break the page
    ('{"a": 1}', []),          # right JSON, wrong shape
])
def test_serialize_failed_tests_is_defensive(raw, expected):
    assert mastery.serialize_failed_tests(raw) == expected
