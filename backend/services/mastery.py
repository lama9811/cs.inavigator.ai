"""Per-topic mastery — how well does this student actually know Arrays?

Replaces the browser-side `solved / total` ratio (QuizBank.jsx), which cannot tell apart:

* solved it cold, first try            → knows it
* solved it after 6 tries and 3 hints  → does not know it
* solved it 4 months ago               → probably doesn't know it *now*
* solved 2 easy ones, 0 hard ones      → knows the shallow end

All four look identical to a ratio, and the first and last of those are the difference
between "move on" and "drill this". The attempt telemetry (`coding_attempt_events`) is
what makes the distinction possible; this module is the first thing that reads it back.

**Computed, never stored.** There is deliberately no `mastery` table. A score is a *view*
over the event log, so improving the formula re-scores all history instead of stranding
students on numbers produced by an old version. It's cheap: one indexed query per student.

The score is 0..100 and is built from four signals the roadmap calls for:

  base        pass rate on the topic, recency-weighted (a run last week counts more
              than one last term)
  difficulty  credit scales with the difficulty actually solved — 3 easy problems is
              not mastery
  efficiency  attempts-before-solve; grinding a problem 8 times is a weaker signal than
              getting it in 2
  hints       solving unaided beats solving with the answer half-revealed

None of these is meaningful on one attempt, so a topic below MIN_ATTEMPTS_FOR_SCORE is
reported as `insufficient data` rather than given a confident-looking number. A mastery
score invented from a single data point is worse than no score, because students believe it.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from models import CodingAttemptEvent

# Below this many attempts we report the topic as unscored. Two attempts can't
# distinguish "knows it" from "got lucky".
MIN_ATTEMPTS_FOR_SCORE = 3

# Recency half-life. An attempt 30 days old carries half the weight of one today, so a
# student who has genuinely improved isn't held down by a bad week last semester — and
# one who peaked in September doesn't keep credit for it forever.
RECENCY_HALF_LIFE_DAYS = 30.0

# How much a solve at each difficulty is worth. Solving hard problems is the actual
# evidence of mastery; easy ones mostly prove you showed up.
DIFFICULTY_WEIGHT = {"easy": 0.7, "medium": 1.0, "hard": 1.3}
DEFAULT_DIFFICULTY_WEIGHT = 1.0

# Mastery bands. These are labels for humans, not thresholds the ladder branches on —
# the ladder should read the raw score.
BANDS = (
    (80, "strong"),
    (60, "steady"),
    (35, "shaky"),
    (0, "weak"),
)

# Only these count as real practice. Free runs have no question and no topic, so they
# can't be scored against one.
SCORED_SOURCES = ("practice", "interview")


def _band(score: float) -> str:
    for threshold, label in BANDS:
        if score >= threshold:
            return label
    return "weak"


def _recency_weight(created_at: Optional[datetime], now: datetime) -> float:
    """Exponential decay by half-life. Returns 1.0 for an attempt right now, 0.5 for one
    a half-life ago, and so on. Never returns 0 — old evidence is weak, not void."""
    if not created_at:
        return 0.5
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    age_days = max(0.0, (now - created_at).total_seconds() / 86400.0)
    return math.pow(0.5, age_days / RECENCY_HALF_LIFE_DAYS)


def _difficulty_weight(difficulty: Optional[str]) -> float:
    return DIFFICULTY_WEIGHT.get(str(difficulty or "").lower(), DEFAULT_DIFFICULTY_WEIGHT)


def _efficiency_factor(attempts_to_solve: int) -> float:
    """1.0 for a first-try solve, decaying toward a floor as attempts pile up.

    Floored at 0.5, not 0: grinding a problem until it passes is still learning. It's
    just weaker evidence than getting it right away.
    """
    if attempts_to_solve <= 1:
        return 1.0
    return max(0.5, 1.0 / (1.0 + 0.18 * (attempts_to_solve - 1)))


def _hint_factor(hints_used: int) -> float:
    """Solving with hints open is weaker evidence than solving cold.

    Floored at 0.6 on purpose. Hints are a *teaching tool we built* — punishing their use
    too hard would train students to avoid the thing that helps them, which is the exact
    opposite of what the Coding Tutor is for.
    """
    return max(0.6, 1.0 - 0.13 * max(0, hints_used))


def _dominant_error(counts: dict[str, int]) -> Optional[str]:
    """The failure mode a student hits most on this topic. This is what makes the
    'common mistakes' copy per-student instead of generic."""
    if not counts:
        return None
    return max(counts.items(), key=lambda kv: kv[1])[0]


# How many of the most recent attempts the trend looks at. Small on purpose: this is
# "how is today going", not a semester average — the score already handles the long view.
TREND_WINDOW = 4


def _recent_streak(sequence: list[str]) -> int:
    """Length of the current run of the same outcome, counting back from the newest
    attempt. Positive for passes, negative for failures, 0 for no attempts.

    This is what lets the copy say "your last 3 runs all compiled" — a specific, checkable
    claim, rather than a vague "you seem to be improving".
    """
    if not sequence:
        return 0
    newest = sequence[-1]
    count = 0
    for outcome in reversed(sequence):
        if outcome != newest:
            break
        count += 1
    return count if newest == "pass" else -count


def _trend(sequence: list[str]) -> str:
    """"improving" | "declining" | "steady" — comparing the recent window against
    everything before it.

    Drives the coaching TONE. A student clawing their way up from a bad start and a
    student sliding backwards can have the exact same score, and telling them the same
    thing would be both useless and demoralizing for one of them.
    """
    if len(sequence) < TREND_WINDOW + 2:
        return "steady"
    recent = sequence[-TREND_WINDOW:]
    earlier = sequence[:-TREND_WINDOW]
    recent_rate = sum(1 for o in recent if o == "pass") / len(recent)
    earlier_rate = sum(1 for o in earlier if o == "pass") / len(earlier)
    if recent_rate - earlier_rate > 0.2:
        return "improving"
    if earlier_rate - recent_rate > 0.2:
        return "declining"
    return "steady"


# What each failure class actually MEANS to a student, in their words — the thing to work
# on, and the reassurance that goes with it. Kept as data so the tone is easy to tune
# without touching the branching logic below.
# `reassure` is a complete sentence with no trailing punctuation and NO internal em-dash —
# the callers below join these into one line, and a second dash in the same sentence reads
# as machine-assembled, which is exactly the thing we're fixing.
_ERROR_COPY = {
    "syntax": {
        "what": "didn't compile",
        "reassure": "That's the language tripping you up, not your thinking",
        "next": "Slow down on the syntax and the rest will follow.",
    },
    "runtime": {
        "what": "crashed partway through",
        "reassure": "Your approach is running, so it's the edge cases biting",
        "next": "Try an empty input and a single-element input before you submit.",
    },
    "wrong_answer": {
        "what": "ran fine but returned the wrong answer",
        "reassure": "The code works, so this is the algorithm rather than your coding",
        "next": "Trace one failing example by hand before changing anything.",
    },
    "timeout": {
        "what": "timed out",
        "reassure": "Your logic is right, it's just too slow",
        "next": "Look for a nested loop you can trade for a hash map.",
    },
}


def compute_topic_mastery(
    db: Session,
    user_id: int,
    *,
    now: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """Score every topic this student has attempted. Strongest signal first is NOT the
    order — weakest first, because the point of this list is deciding what to practice.

    Returns one dict per topic:
        topic, score (0-100 or None), band, attempts, solved_questions,
        pass_rate, avg_attempts_to_solve, avg_hints_used, dominant_error,
        last_attempt_at, scored (bool)
    """
    now = now or datetime.now(timezone.utc)

    events = (
        db.query(CodingAttemptEvent)
        .filter(
            CodingAttemptEvent.user_id == user_id,
            CodingAttemptEvent.source.in_(SCORED_SOURCES),
            CodingAttemptEvent.topic.isnot(None),
        )
        .order_by(CodingAttemptEvent.created_at.asc())
        .all()
    )

    # Bucket by topic, and within a topic by question — "attempts before solve" is a
    # per-question idea, so it can only be counted per question.
    topics: dict[str, dict[str, Any]] = {}
    for event in events:
        topic = (event.topic or "").strip()
        if not topic:
            continue
        bucket = topics.setdefault(topic, {
            "questions": {},        # question_id -> per-question attempt record
            "attempts": 0,
            "passes": 0,
            "error_counts": {},
            "last_attempt_at": None,
            # Ordered oldest→newest outcome list. Drives the coaching TONE: a student
            # who is improving should not be told the same thing as one who is stuck,
            # even when their scores are identical.
            "sequence": [],
        })
        bucket["attempts"] += 1
        bucket["sequence"].append(event.outcome)
        if event.created_at and (
            bucket["last_attempt_at"] is None or event.created_at > bucket["last_attempt_at"]
        ):
            bucket["last_attempt_at"] = event.created_at

        if event.outcome == "pass":
            bucket["passes"] += 1
        elif event.error_class:
            bucket["error_counts"][event.error_class] = (
                bucket["error_counts"].get(event.error_class, 0) + 1
            )

        qid = event.question_id or "_unknown"
        question = bucket["questions"].setdefault(qid, {
            "attempts": 0,
            "solved": False,
            "attempts_to_solve": None,
            "hints_at_solve": 0,
            "difficulty": event.difficulty,
            "solved_at": None,
        })
        question["attempts"] += 1
        if event.difficulty:
            question["difficulty"] = event.difficulty

        # First pass on this question is the solve. Events are ordered oldest-first, so
        # `attempts` at this moment IS the attempts-to-solve count. Later re-solves don't
        # overwrite it — we want the cost of learning it, not the cost of repeating it.
        if event.outcome == "pass" and not question["solved"]:
            question["solved"] = True
            question["attempts_to_solve"] = question["attempts"]
            question["hints_at_solve"] = event.hints_used or 0
            question["solved_at"] = event.created_at

    results: list[dict[str, Any]] = []
    for topic, bucket in topics.items():
        attempts = bucket["attempts"]
        questions = bucket["questions"]
        solved = [q for q in questions.values() if q["solved"]]

        pass_rate = (bucket["passes"] / attempts) if attempts else 0.0
        avg_attempts = (
            sum(q["attempts_to_solve"] or 0 for q in solved) / len(solved)
        ) if solved else None
        avg_hints = (
            sum(q["hints_at_solve"] for q in solved) / len(solved)
        ) if solved else None

        scored = attempts >= MIN_ATTEMPTS_FOR_SCORE
        score: Optional[float] = None

        if scored:
            # The score is a recency-weighted average of per-solve quality, where each
            # solve is worth (difficulty x efficiency x hint-independence). A topic where
            # every attempt failed has no solves, so it scores 0 — which is correct: no
            # evidence of mastery is not the same as "no data", and we have plenty of data.
            weighted_credit = 0.0
            weight_total = 0.0
            for question in solved:
                w = _recency_weight(question["solved_at"], now)
                quality = (
                    _difficulty_weight(question["difficulty"])
                    * _efficiency_factor(question["attempts_to_solve"] or 1)
                    * _hint_factor(question["hints_at_solve"])
                )
                weighted_credit += w * quality
                weight_total += w

            if weight_total > 0:
                # Average solve quality, normalized so a "perfect" solve (hard, first
                # try, no hints) lands at 100 rather than at the raw 1.3 weight.
                avg_quality = weighted_credit / weight_total
                solve_score = min(1.0, avg_quality / DIFFICULTY_WEIGHT["hard"])
            else:
                solve_score = 0.0

            # Blend the quality of what they solved with how often they pass at all.
            # Quality-only would let a student who solved one hard problem and then
            # failed twenty attempts look strong; pass-rate-only is the old ratio.
            score = round(100.0 * (0.65 * solve_score + 0.35 * pass_rate), 1)

        error_counts = bucket["error_counts"]
        dominant = _dominant_error(error_counts)
        bucket["recent_streak"] = _recent_streak(bucket["sequence"])
        bucket["trend"] = _trend(bucket["sequence"])

        results.append({
            "topic": topic,
            "score": score,
            "band": _band(score) if score is not None else None,
            "scored": scored,
            "attempts": attempts,
            "questions_attempted": len(questions),
            "questions_solved": len(solved),
            "pass_rate": round(pass_rate, 3),
            "avg_attempts_to_solve": round(avg_attempts, 2) if avg_attempts is not None else None,
            "avg_hints_used": round(avg_hints, 2) if avg_hints is not None else None,
            "dominant_error": dominant,
            # Raw counts so the coaching line can cite REAL numbers ("4 of your 6 failed
            # runs didn't compile") instead of vague quantifiers ("most of your
            # attempts"). A concrete number is what makes the sentence read as being
            # about this student rather than as boilerplate.
            "failures": attempts - bucket["passes"],
            "dominant_error_count": error_counts.get(dominant, 0) if dominant else 0,
            "recent_streak": bucket["recent_streak"],
            "trend": bucket["trend"],
            "last_attempt_at": (
                bucket["last_attempt_at"].isoformat() if bucket["last_attempt_at"] else None
            ),
        })

    # Weakest first — this list exists to answer "what should I practice?", and an
    # unscored topic (too little data) is not evidence of weakness, so it sorts last.
    results.sort(key=lambda r: (r["score"] is None, r["score"] if r["score"] is not None else 0))
    return results


def weakest_topic(topics: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """The topic to recommend next, or None if nothing has enough data.

    Deliberately refuses to guess. The old browser ratio would happily call a topic
    "weakest" on the basis of 0/1 solved; recommending practice on that is noise, and a
    recommendation the student can tell is arbitrary is worse than none — it teaches them
    to ignore the next one.
    """
    scored = [t for t in topics if t["scored"] and t["score"] is not None]
    return scored[0] if scored else None


def explain(topic: dict[str, Any]) -> str:
    """A short, warm, second-person note about this topic — why it's the one to work on.

    The roadmap's "Why this problem" requirement: an adaptive system that won't explain
    itself feels arbitrary and students stop trusting it.

    Three rules this copy follows, in order of importance:

    1. **Every claim is a counted fact.** "4 of your 6 failed runs didn't compile" comes
       straight from `dominant_error_count` / `failures`. No LLM, so nothing can invent a
       diagnosis the data doesn't support — the failure that got the old panel pulled.
       Concrete numbers are also what make it read as being about *this student* instead
       of as boilerplate.
    2. **The tone adapts to the trend, not just the score.** A student climbing out of a
       bad start and one sliding backwards can have identical scores. Telling them the
       same thing is useless to one and demoralizing to the other.
    3. **Separate the student from the failure.** "It's the syntax tripping you up, not
       your thinking." A student who reads their weakest topic as a verdict on their
       ability stops practicing, which is the one outcome this whole feature exists to
       prevent.
    """
    name = titleize(topic["topic"])
    error = topic.get("dominant_error")
    solved = topic.get("questions_solved") or 0
    attempted = topic.get("questions_attempted") or 0
    failures = topic.get("failures") or 0
    error_count = topic.get("dominant_error_count") or 0
    streak = topic.get("recent_streak") or 0
    trend = topic.get("trend") or "steady"
    hints = topic.get("avg_hints_used")
    attempts = topic.get("avg_attempts_to_solve")

    copy = _ERROR_COPY.get(error or "")

    # --- Improving: lead with the win. They're working; say so before anything else. ---
    if trend == "improving":
        if streak >= 2:
            return f"{name} is starting to click — your last {streak} runs passed. Keep the streak going."
        return f"{name} is coming along. You're passing more than you were, so this is worth another round."

    # --- On a losing streak: name it, normalize it, then point at the fix. ---
    if streak <= -3 and copy:
        return (
            f"{name} is a grind right now, and that's normal. "
            f"Your last {abs(streak)} runs {copy['what']}. {copy['reassure']}. "
            f"{copy['next']}"
        )

    # --- A clear dominant failure mode: cite the real count, then reassure. ---
    if copy and error_count >= 2 and failures > 0:
        # "9 of your 9" reads like a machine. When it's all of them, say so in words.
        share = (
            f"Every one of your {failures} failed {name} runs"
            if error_count == failures
            else f"{error_count} of your {failures} failed {name} runs"
        )
        return f"{share} {copy['what']}. {copy['reassure']}. {copy['next']}"

    # --- Leaning on hints: gently noted, never scolded. Hints are a tool we built. ---
    if hints and hints >= 2 and solved > 0:
        return (
            f"You're getting {name} problems out, but with about {hints:.0f} hints each. "
            f"Try the next one cold and see how far you get — you may need them less than you think."
        )

    # --- Grinding to a solve: effort is real, efficiency isn't there yet. ---
    if attempts and attempts >= 3:
        return (
            f"You're solving {name} problems, but it's taking about {attempts:.0f} tries each. "
            f"A bit more practice here should make it feel a lot smoother."
        )

    # --- Attempted, never solved, and no clear error pattern to point at. ---
    if solved == 0 and attempted > 0:
        return (
            f"You've taken a run at {attempted} {name} problem{'s' if attempted != 1 else ''} "
            f"without landing one yet. That's the sign to slow down and work through a single "
            f"one all the way, hints and all."
        )

    # --- Nothing distinctive to say. Say the plain, honest thing. ---
    return f"{name} is where you have the most room to grow right now. A good place to spend the next session."


# Words that stay lowercase inside a topic name. Without this, "Stacks and Queues" becomes
# the stilted "Stacks And Queues".
_MINOR_WORDS = {"and", "or", "of", "the", "in", "on", "to", "a", "an", "vs"}


def titleize(topic: str) -> str:
    """Topics are authored inconsistently ("dynamic programming", "Arrays", "linked lists").
    Present them uniformly, so the copy doesn't read as a raw database field pasted
    mid-sentence — which is a large part of what makes generated text *look* generated.
    """
    cleaned = (topic or "").strip()
    if not cleaned:
        return "This topic"

    words = cleaned.split()
    out = []
    for i, word in enumerate(words):
        # Leave any word that already carries internal capitals alone — that's an
        # authored acronym or proper form ("DP", "BFS", "McKinsey"), and forcing it
        # through .capitalize() would mangle it into "Dp".
        if any(ch.isupper() for ch in word[1:]):
            out.append(word)
        elif i > 0 and word.lower() in _MINOR_WORDS:
            out.append(word.lower())
        else:
            out.append(word[0].upper() + word[1:] if word else word)
    return " ".join(out)


def serialize_failed_tests(raw: Optional[str]) -> list[str]:
    """`CodingAttemptEvent.failed_tests` is a JSON string (Text column, for MySQL/SQLite
    portability). Decode defensively — a malformed row should not break the whole page."""
    if not raw:
        return []
    try:
        value = json.loads(raw)
        return [str(v) for v in value] if isinstance(value, list) else []
    except (ValueError, TypeError):
        return []
