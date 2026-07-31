import { useEffect, useRef, useState } from "react";
import { FaBook, FaChartLine, FaLaptopCode, FaPlay, FaRegCompass } from "react-icons/fa";
import { currentUserStorageScope } from "./storageScope";
import {
  buildStartingCheckResult,
  buildStartingQuestionSet,
  clearStartingCheck,
  readStartingCheck,
  writeStartingCheck,
} from "./startingPath";
import useFocusTrap from "./useFocusTrap";

function findResumeItem(questions, progressByQuestion) {
  return Object.entries(progressByQuestion || {})
    .map(([id, progress]) => ({ id, progress, question: questions.find(q => q.id === id) }))
    .filter(item => item.question && item.progress
      && item.progress.status !== "solved"
      && (item.progress.attempt_count > 0 || item.progress.status === "in_progress"))
    .sort((a, b) => new Date(b.progress.updated_at || 0) - new Date(a.progress.updated_at || 0))[0] || null;
}

function difficultyClass(value) {
  return String(value || "easy").toLowerCase();
}

// One concrete next step, derived from real data — not generic filler.
// Priority: resume in-progress → today's daily → recommended next → library.
function buildFocusPlan({ resumeItem, nextUpQuestion, dailyChallenge, dailyDoneToday }) {
  if (resumeItem?.question) {
    return `Finish ${resumeItem.question.title} — run your tests, then ask for one hint if you're stuck.`;
  }
  if (!dailyDoneToday && dailyChallenge?.available !== false && dailyChallenge?.title) {
    const diff = (dailyChallenge.difficulty || "the").toString().toLowerCase();
    return `Open today's ${diff} LeetCode problem, then use CS Navigator if you want a scratchpad or hints.`;
  }
  if (nextUpQuestion?.title) {
    const topic = nextUpQuestion.topic ? `${nextUpQuestion.topic} ` : "";
    return `Start one ${topic}problem (${nextUpQuestion.title}), run the tests, and ask for a hint only if needed.`;
  }
  return "Open the Practice Library, pick one problem, run it, and review your solution.";
}

// Pick the topic to nudge next, from already-computed per-topic progress.
// Weakest = lowest solved ratio among topics the student has actually attempted;
// strongest = most solved. Falls back to the first two topics for new users.
function pickFocusTopics(topicPacks) {
  const packs = (topicPacks || []).filter(p => p && p.topic && p.count > 0);
  if (!packs.length) return null;
  const attempted = packs.filter(p => (p.attempted || 0) > 0 && p.solved < p.count);
  const ratio = p => (p.count ? p.solved / p.count : 0);
  if (attempted.length) {
    const strongest = [...packs].sort((a, b) => b.solved - a.solved || ratio(b) - ratio(a))[0];
    const weakest = [...attempted].sort((a, b) => ratio(a) - ratio(b) || a.solved - b.solved)[0];
    // If strongest and weakest collapse to the same topic, suggest the next untouched one.
    const next = weakest.topic !== strongest.topic
      ? weakest
      : (packs.find(p => (p.attempted || 0) === 0) || weakest);
    return { hasProgress: true, strongest, next };
  }
  // No attempts yet — recommend a gentle starting order.
  return { hasProgress: false, first: packs[0], second: packs[1] || null };
}

const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 };

function statusOf(progress) {
  if (progress?.status === "solved") return "solved";
  if (progress?.status === "in_progress" || (progress?.attempt_count || 0) > 0) return "in_progress";
  return "not_started";
}

function problemRank(question) {
  return DIFFICULTY_RANK[String(question?.difficulty || "easy").toLowerCase()] ?? 1;
}

function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1).replace("_", " ") : "";
}

function learningStyleHint(style) {
  if (style === "worked_examples") return "Start with a worked example, then try one similar problem.";
  if (style === "concept_then_code") return "Start with the idea in plain English, then move into code.";
  return "Try one problem first. If you get stuck, ask for a small hint.";
}

function focusActionKind(style) {
  return style === "try_then_hint" ? "practice" : "lesson";
}

function compactWeakTopicReason({ mastery, weakTopic }) {
  if (mastery?.weakest?.topic) {
    return `Recent practice points to ${titleCase(weakTopic)}.`;
  }
  if (weakTopic) return `This topic could use another pass.`;
  return "Pick one shaky topic.";
}

function firstUnsolved(questions, progressByQuestion, predicate = () => true) {
  return (questions || [])
    .filter(predicate)
    .filter(q => statusOf(progressByQuestion?.[q.id]) !== "solved")
    .sort((a, b) => problemRank(a) - problemRank(b) || (a.title || "").localeCompare(b.title || ""))[0] || null;
}

function unsolvedByTopic(questions, progressByQuestion, topic) {
  const wanted = String(topic || "").toLowerCase();
  if (!wanted) return [];
  return (questions || [])
    .filter(q => String(q.topic || "").toLowerCase() === wanted)
    .filter(q => statusOf(progressByQuestion?.[q.id]) !== "solved")
    .sort((a, b) => problemRank(a) - problemRank(b) || (a.title || "").localeCompare(b.title || ""));
}

function buildTodayPath({ questions, progressByQuestion, resumeItem, nextUpQuestion, mastery, focus }) {
  const path = [];
  const used = new Set();
  const add = (kind, label, question, fallback, reason) => {
    if (question?.id && !used.has(question.id)) {
      used.add(question.id);
      path.push({ kind, label, question, reason });
      return;
    }
    if (fallback) path.push({ kind, label, fallback, reason });
  };

  add(
    "start",
    resumeItem?.question ? "Finish" : "Start",
    resumeItem?.question || nextUpQuestion || firstUnsolved(questions, progressByQuestion),
    "Open the Practice Library and choose one easy problem.",
    resumeItem?.question
      ? "You already started this one."
      : "This is a good first problem for today."
  );

  const weakTopic = mastery?.weakest?.topic || focus?.next?.topic || focus?.first?.topic;
  const weakPick = unsolvedByTopic(questions, progressByQuestion, weakTopic)
    .find(q => !used.has(q.id));
  add(
    "practice",
    weakTopic ? `Practice ${titleCase(weakTopic)}` : "Practice a weak spot",
    weakPick,
    "Pick one topic that feels shaky and solve one problem from it.",
    compactWeakTopicReason({ mastery, weakTopic })
  );

  const stretchPick = firstUnsolved(
    questions,
    progressByQuestion,
    q => !used.has(q.id) && problemRank(q) >= 1
  );
  add(
    "stretch",
    "Stretch",
    stretchPick,
    "After one pass, try a medium problem or review a failed test.",
    "A slightly harder step after the warm-up."
  );

  return path.slice(0, 3);
}

function CampusHero({
  progressSummary,
  resumeItem,
  nextUpQuestion,
  dailyChallenge,
  dailyDoneToday,
  onResume,
  onOpenLearnStart,
  onOpenBeginnerWarmup,
  onSelectQuestion,
}) {
  // State-first hero: lead with the student's status and ONE primary action —
  // resume in-progress work if any, otherwise start the recommended problem.
  const primaryQuestion = resumeItem?.question || nextUpQuestion || null;
  const isResume = Boolean(resumeItem?.question);
  // The hero owns the next action: one concrete "Today's Focus" line (was a
  // separate strip below the hero).
  const focusPlan = buildFocusPlan({ resumeItem, nextUpQuestion, dailyChallenge, dailyDoneToday });
  const streakDays = Number(progressSummary.displayStreak) || 0;
  const streakValue = streakDays > 0 ? `${streakDays}-day` : "0";
  const streakLabel = streakDays > 0 ? "streak" : "day streak";

  return (
    <section className="campus-lab-hero" aria-label="Coding Tutor start">
      <div className="campus-hero-copy">
        <span className="coding-kicker campus-hero-kicker">
          Coding Lab
          <span className="campus-hero-org">Morgan State CS</span>
        </span>
        <h2>Welcome back!</h2>
        <div className="campus-hero-stats" aria-label="Your progress at a glance">
          <span className="campus-hero-stat accent">
            <strong>{streakValue}</strong>
            <i>{streakLabel}</i>
          </span>
          <span className="campus-hero-stat success">
            <strong>{progressSummary.solvedCount}</strong>
            <i>solved</i>
          </span>
          <span className="campus-hero-stat">
            <strong>{progressSummary.completionPercent}%</strong>
            <i>complete</i>
          </span>
        </div>
        <div className="campus-hero-actions">
          {primaryQuestion ? (
            <button
              type="button"
              className="campus-primary-action"
              onClick={() => (isResume ? onResume(primaryQuestion) : onSelectQuestion(primaryQuestion))}
            >
              <FaPlay aria-hidden="true" />
              {isResume ? `Resume: ${primaryQuestion.title}` : `Start: ${primaryQuestion.title}`}
            </button>
          ) : (
            <button type="button" className="campus-primary-action" onClick={onOpenLearnStart}>
              <FaBook aria-hidden="true" />
              Start Python Beginner
            </button>
          )}
          <button type="button" className="campus-secondary-action" onClick={onOpenBeginnerWarmup}>
            <FaRegCompass aria-hidden="true" />
            Before Class Warmup
          </button>
        </div>
        <div className="campus-hero-focus" role="note">
          <span className="campus-hero-focus-label">
            <FaRegCompass aria-hidden="true" />
            Today’s focus
          </span>
          <span className="campus-hero-focus-text">{focusPlan}</span>
        </div>
      </div>
    </section>
  );
}

// Build the "Recommended Focus" copy from real per-topic progress.
function _focusCopy(focus) {
  if (!focus) {
    return "Start with the Practice Library, then build a steady weekly rhythm.";
  }
  if (focus.hasProgress) {
    return `You're strongest on ${focus.strongest.topic} — try one ${focus.next.topic} problem next to round out your skills.`;
  }
  if (focus.second) {
    return `Start with ${focus.first.topic}, then move into ${focus.second.topic}.`;
  }
  return `Start with ${focus.first.topic} and build from there.`;
}

function focusReason(focus) {
  if (!focus) return "No progress pattern yet, so start with one small problem.";
  if (focus.hasProgress) {
    return `${titleCase(focus.next.topic)} is your next useful focus.`;
  }
  return "This is a beginner-friendly place to start.";
}

function CampusLearningQueue({
  questions,
  progressByQuestion,
  resumeItem,
  nextUpQuestion,
  focus,
  mastery,
  adaptivePractice,
  startingCheck,
  onSelect,
  onOpenQuizBank,
  onOpenBeginnerWarmup,
  onOpenTopic,
  onOpenLessonReview,
  onOpenStartingPath,
  learningStyle,
}) {
  // The hero owns "what to do right now" (resume / recommended). This section is a
  // guided path: next track, personal workspace, and a data-driven focus nudge.
  const todayPath = buildTodayPath({
    questions,
    progressByQuestion,
    resumeItem,
    nextUpQuestion,
    mastery,
    focus,
  });
  const firstPathQuestion = todayPath.find(step => step.question)?.question || null;
  const hasRealProgress = Object.values(progressByQuestion || {}).some(progress =>
    progress?.status === "solved" || (progress?.attempt_count || 0) > 0
  );
  const adaptiveRecommendation = hasRealProgress ? adaptivePractice?.recommendation || null : null;
  const reviewSignal = adaptivePractice?.review_signal || null;
  const adaptiveTopic = adaptiveRecommendation?.topic || "";
  const adaptiveDifficulty = adaptiveRecommendation?.difficulty || "";
  const adaptiveReady = adaptiveRecommendation?.action === "ladder" && adaptiveRecommendation?.ladder_ready;
  const focusTopic = adaptiveTopic || (focus?.hasProgress ? focus.next?.topic : focus?.first?.topic);
  const needsStartingCheck = !hasRealProgress && !startingCheck;
  const placementProfile = !hasRealProgress ? startingCheck : null;
  const focusTitle = needsStartingCheck ? "Find your starting point" : placementProfile?.title || (adaptiveReady
    ? `${titleCase(adaptiveTopic)} adaptive ladder`
    : adaptiveRecommendation?.action === "practice_review"
      ? `Review ${titleCase(adaptiveTopic)}`
      : focus?.hasProgress
    ? `Practice ${titleCase(focus.next.topic)}`
    : focus
      ? `Start with ${titleCase(focus.first.topic)}`
      : "Choose a topic");
  const focusBlurb = needsStartingCheck
    ? "Take the quick check above so this card can recommend a calm first step instead of guessing."
    : placementProfile?.blurb || (adaptiveRecommendation?.reason
    ? adaptiveRecommendation.reason
    : focusTopic
      ? `${focusReason(focus)} ${learningStyleHint(learningStyle)}`
    : "Pick one topic and solve the first problem you see.");
  const focusAction = adaptiveReady ? "practice" : focusActionKind(learningStyle);
  const focusButton = adaptiveReady
    ? `Open ${titleCase(adaptiveDifficulty)} step`
    : focusAction === "practice" ? "Open practice" : "Open topic lesson";
  const focusClick = () => {
    if (needsStartingCheck) {
      onOpenStartingPath?.({ action: "syntax-quiz" });
      return;
    }
    if (placementProfile) {
      onOpenStartingPath?.(placementProfile);
      return;
    }
    if (focusTopic) onOpenTopic?.(focusTopic, focusAction, { difficulty: adaptiveReady ? adaptiveDifficulty : null });
    else onOpenQuizBank();
  };
  return (
    <section className="campus-learning-queue" aria-label="Your coding path">
      <div className="campus-section-heading">
        <span className="coding-kicker">Do This Next</span>
      </div>
      <div className="campus-queue-grid three-up">
        <article className="campus-queue-item featured">
          <span>One Small Step</span>
          <strong>{todayPath[0]?.question?.title || "Start with one problem"}</strong>
          <ol className="campus-path-list">
            {todayPath.map((step, index) => (
              <li key={`${step.kind}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <b>{step.label}</b>
                  {step.question ? (
                    <button
                      type="button"
                      className="campus-path-step-btn"
                      onClick={() => onSelect(step.question)}
                    >
                      {step.question.title}
                    </button>
                  ) : (
                    <em>{step.fallback}</em>
                  )}
                  {step.reason && <small className="campus-path-reason">{step.reason}</small>}
                </div>
              </li>
            ))}
          </ol>
          <p>
            {nextUpQuestion?.topic
              ? `${nextUpQuestion.topic} — a good next track for you.`
              : "Use the Practice Library to choose another track."}
          </p>
          <button
            type="button"
            className="campus-primary-action"
            onClick={() => (firstPathQuestion ? onSelect(firstPathQuestion) : onOpenQuizBank())}
          >
            {firstPathQuestion ? "Start first step" : "Browse Practice Library"}
          </button>
        </article>
        <article className="campus-queue-item warmup">
          <span>5-10 Minutes</span>
          <strong>Before Class Warmup</strong>
          <p>Open a small set of beginner-friendly problems: conditionals, arrays, strings, math, tuples, sets, and maps.</p>
          <button type="button" onClick={onOpenBeginnerWarmup}>Start warmup</button>
        </article>
        <article className="campus-queue-item focus">
          <span>Recommended Next</span>
          <strong>{focusTitle}</strong>
          <p>{focusBlurb}</p>
          {placementProfile ? (
            <small className="campus-focus-badge is-ready">{placementProfile.label}</small>
          ) : null}
          {adaptiveRecommendation ? (
            <small className={adaptiveReady ? "campus-focus-badge is-ready" : "campus-focus-badge"}>
              {adaptiveReady ? "Ladder-ready" : "Review-only for now"}
            </small>
          ) : null}
          {reviewSignal ? (
            <div className="campus-review-signal">
              <small>Review pattern</small>
              <strong>{reviewSignal.title || "Review recent errors"}</strong>
              <p>{reviewSignal.reason}</p>
              <button
                type="button"
                className="campus-review-signal-btn"
                onClick={() => onOpenLessonReview?.(reviewSignal)}
              >
                Open review lesson
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={focusClick}
          >
            {needsStartingCheck
              ? "Start Syntax quiz"
              : placementProfile?.actionLabel || (focusTopic ? `${focusButton}: ${titleCase(focusTopic)}` : "Browse Practice Library")}
          </button>
        </article>
      </div>
    </section>
  );
}

function StartingCheckCard({ result, onComplete, onSkip, onReset }) {
  const [answers, setAnswers] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questionSet, setQuestionSet] = useState(() => buildStartingQuestionSet());
  const advanceTimerRef = useRef(null);
  const answeredCount = Object.keys(answers).length;
  const complete = answeredCount === questionSet.length;
  const currentQuestion = questionSet[currentIndex];
  const currentAnswered = answers[currentQuestion?.id] !== undefined;
  const isLastQuestion = currentIndex === questionSet.length - 1;
  const modalRef = useFocusTrap(!result, { onEscape: onSkip });

  useEffect(() => {
    if (!result) {
      setAnswers({});
      setCurrentIndex(0);
      setQuestionSet(buildStartingQuestionSet());
    }
  }, [result]);

  const choose = (questionId, optionIndex) => {
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    const option = currentQuestion?.options?.[optionIndex];
    setAnswers(prev => ({
      ...prev,
      [questionId]: {
        choice_index: option?.originalIndex ?? optionIndex,
        display_index: optionIndex,
        unsure: Boolean(option?.unsure),
      },
    }));
    if (!isLastQuestion) {
      advanceTimerRef.current = window.setTimeout(() => {
        setCurrentIndex(index => Math.min(questionSet.length - 1, index + 1));
      }, 280);
    }
  };

  const isOptionSelected = (questionId, optionIndex) => {
    const answer = answers[questionId];
    if (answer && typeof answer === "object") {
      return answer.display_index === optionIndex;
    }
    return answer === optionIndex;
  };

  useEffect(() => () => {
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
  }, []);

  const submit = () => {
    if (!complete) return;
    onComplete(buildStartingCheckResult(answers, questionSet));
  };

  if (result) {
    return (
      <section className="starting-check-card is-complete" aria-label="Coding starting point">
        <div>
          <span className="coding-kicker">Starting Point</span>
          <h3>{result.label}</h3>
          <p>{result.blurb}</p>
          {Array.isArray(result.topics) && result.topics.length > 0 ? (
            <ul className="starting-check-topics" aria-label="Topics you will see next">
              {result.topics.map(topic => <li key={topic}>{topic}</li>)}
            </ul>
          ) : null}
        </div>
        <button type="button" className="starting-check-link" onClick={onReset}>
          Retake check
        </button>
      </section>
    );
  }

  return (
    <div className="starting-check-modal-backdrop" role="presentation">
      <section
        ref={modalRef}
        className="starting-check-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="starting-check-title"
        aria-describedby="starting-check-description"
        tabIndex={-1}
      >
        <div className="starting-check-modal-head">
          <div>
            <span className="coding-kicker">Before You Start</span>
            <h3 id="starting-check-title">Find your starting point</h3>
            <p id="starting-check-description">Answer a few quick questions so Coding Tutor can unlock a calmer first path.</p>
          </div>
          <button type="button" className="starting-check-link" onClick={onSkip} data-autofocus>
            Skip for now
          </button>
        </div>

        <div className="starting-check-progress" aria-label={`Question ${currentIndex + 1} of ${questionSet.length}`}>
          <span style={{ width: `${((currentIndex + 1) / questionSet.length) * 100}%` }} />
        </div>

        <div className="starting-check-panel">
          <fieldset className="starting-check-question" key={currentQuestion.id}>
            <legend>
              <span>{currentIndex + 1}</span>
              {currentQuestion.prompt}
            </legend>
            {currentQuestion.code ? (
              <pre className="starting-check-code"><code>{currentQuestion.code}</code></pre>
            ) : null}
            <div className="starting-check-options">
              {currentQuestion.options.map((option, optionIndex) => (
                <button
                  type="button"
                  key={option.label || option.code}
                  className={isOptionSelected(currentQuestion.id, optionIndex) ? "selected" : ""}
                  onClick={() => choose(currentQuestion.id, optionIndex)}
                >
                  <span>{String.fromCharCode(65 + optionIndex)}</span>
                  {option.code ? <code>{option.code}</code> : option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="starting-check-footer">
            <span>
              {isLastQuestion && complete
                ? "Ready to unlock your starting path."
                : `${answeredCount}/${questionSet.length} answered`}
            </span>
            <div>
              <button
                type="button"
                className="starting-check-link"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex(index => Math.max(0, index - 1))}
              >
                Back
              </button>
              {isLastQuestion ? (
                <button type="button" className="campus-primary-action" disabled={!complete} onClick={submit}>
                  Use this starting point
                </button>
              ) : (
                <button
                  type="button"
                  className="campus-primary-action"
                  disabled={!currentAnswered}
                  onClick={() => setCurrentIndex(index => Math.min(questionSet.length - 1, index + 1))}
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function CampusTutorActions({ latestQuizResponse, onPrompt, onOpenInterviewPrep, onOpenSnippets, onSaveQuiz }) {
  return (
    <section className="campus-tutor-actions" aria-label="Ask the tutor">
      <div className="campus-section-heading">
        <span className="coding-kicker">Ask the Tutor</span>
      </div>
      <div className="campus-action-list compact">
        <button type="button" onClick={() => onPrompt("Can you generate a practice quiz for me on arrays, strings, and loops?", { quizPdf: true, title: "Practice quiz" })}>
          <FaBook aria-hidden="true" />
          <span>Generate a 5-question quiz</span>
        </button>
        <button type="button" onClick={() => onPrompt("Help me pick what to practice next based on my progress. Keep it short and give me three clear steps.", { title: "Practice plan" })}>
          <FaRegCompass aria-hidden="true" />
          <span>Plan my next practice</span>
        </button>
        <button type="button" onClick={onOpenInterviewPrep}>
          <FaChartLine aria-hidden="true" />
          <span>Explore interview prep</span>
        </button>
        <button type="button" onClick={onOpenSnippets}>
          <FaLaptopCode aria-hidden="true" />
          <span>Open personal code lab</span>
        </button>
      </div>
      {latestQuizResponse && (
        <button type="button" className="save-quiz-pdf-btn" onClick={onSaveQuiz}>
          Save generated quiz as PDF
        </button>
      )}
    </section>
  );
}

function CampusDailyMission({ dailyChallenge, loading, dailyDoneToday, displayStreak, onPractice, onOpenScratch }) {
  const isLeetCode = (dailyChallenge?.source || "").toLowerCase() === "leetcode";
  const problemNumber = dailyChallenge?.frontend_id;
  const tags = Array.isArray(dailyChallenge?.tags) ? dailyChallenge.tags.filter(Boolean) : [];
  const focusSkills = tags.slice(0, 3);

  // Until the fetch resolves we hold a placeholder payload, so gate the whole card
  // (and especially Practice Now) behind a disabled skeleton — otherwise the CTA
  // could start a challenge against stale/placeholder data and bump the streak early.
  if (loading || !dailyChallenge) {
    return (
      <section className="campus-daily-mission is-loading" aria-label="Daily challenge" aria-busy="true">
        <div className="daily-mission-main">
          <span className="coding-kicker">Today’s Challenge</span>
          <h2 className="daily-skeleton-title" aria-hidden="true">&nbsp;</h2>
          <div className="daily-meta-row">
            <span className="daily-difficulty daily-skeleton-pill" aria-hidden="true">&nbsp;</span>
          </div>
        </div>
        <aside className="daily-mission-aside">
          <div className="daily-actions">
            <button type="button" className="daily-practice-btn" disabled>
              Loading…
            </button>
          </div>
        </aside>
      </section>
    );
  }

  return (
    <section className="campus-daily-mission" aria-label="LeetCode daily challenge">
      {/* Left column: identity + meta. */}
      <div className="daily-mission-main">
        <span className="coding-kicker">
          {isLeetCode ? "LeetCode Daily Problem" : "Today’s Challenge"}
        </span>
        <h2>
          {problemNumber ? `${problemNumber}. ` : ""}
          {dailyChallenge?.title || "Daily practice"}
        </h2>
        {dailyChallenge?.available === false && <p>{dailyChallenge.message}</p>}
        {isLeetCode && dailyChallenge?.available !== false && (
          <p className="daily-mission-summary">
            Open the full prompt on LeetCode. Use CS Navigator when you want a scratchpad, notes, or tutor help.
          </p>
        )}
        <div className="daily-meta-row">
          <span className={`daily-difficulty ${difficultyClass(dailyChallenge?.difficulty)}`}>{dailyChallenge?.difficulty || "Easy"}</span>
          {isLeetCode && <span className="daily-source-pill">LeetCode</span>}
          {dailyDoneToday
            ? <span className="daily-streak-pill done">Practiced today - {displayStreak}-day streak</span>
            : displayStreak > 0 && <span className="daily-streak-pill">{displayStreak}-day streak</span>}
        </div>
      </div>

      {/* Right column: focus skills + the actions. (Tags now live ONLY here as
          "Focus skills" — the left-column "Good for practicing" list was the same
          data shown twice, so it was removed.) */}
      <aside className="daily-mission-aside">
        {focusSkills.length > 0 && (
          <dl className="daily-mission-facts">
            <div>
              <dt>Focus skills</dt>
              <dd>{focusSkills.join(" · ")}</dd>
            </div>
          </dl>
        )}
        <div className="daily-actions">
          <button type="button" className="daily-practice-btn" onClick={onPractice}>
            {isLeetCode ? "Open on LeetCode" : "Practice Now"}
          </button>
          {isLeetCode && (
            <button type="button" className="daily-practice-btn secondary" onClick={onOpenScratch}>
              Use CS Navigator scratchpad
            </button>
          )}
          {dailyChallenge?.url && !isLeetCode && (
            <a href={dailyChallenge.url} target="_blank" rel="noopener noreferrer" className="daily-link">
              View Source
            </a>
          )}
        </div>
        {isLeetCode && (
          <p className="daily-handoff-note">
            Full prompt and official judging stay on LeetCode. The scratchpad is for notes, experiments, and tutor help.
          </p>
        )}
      </aside>
    </section>
  );
}

export default function CampusLabHome({
  progressSummary,
  questions,
  progressByQuestion,
  nextUpQuestion,
  topicPacks,
  dailyChallenge,
  dailyChallengeLoading,
  dailyDoneToday,
  displayStreak,
  latestQuizResponse,
  onStartDaily,
  onOpenDailyScratch,
  onOpenSnippets,
  onOpenLearnStart,
  onOpenBeginnerWarmup,
  onOpenStartingPath,
  onSelectQuestion,
  onOpenQuizBank,
  onOpenTopic,
  onOpenLessonReview,
  onOpenInterviewPrep,
  onPrompt,
  onSaveQuiz,
  mastery,
  adaptivePractice,
  learningStyle = "try_then_hint",
}) {
  const queueQuestions = questions || [];
  const resumeItem = findResumeItem(queueQuestions, progressByQuestion);
  const focus = pickFocusTopics(topicPacks);
  const storageScope = currentUserStorageScope();
  const [startingCheckResult, setStartingCheckResult] = useState(() => readStartingCheck());
  const hasCodingHistory =
    (Number(progressSummary?.solvedCount) || 0) > 0 ||
    (Number(progressSummary?.attemptedCount) || 0) > 0 ||
    Object.values(progressByQuestion || {}).some(progress =>
      progress?.status === "solved" || (progress?.attempt_count || 0) > 0
    );
  const startingCheck = startingCheckResult?.skipped ? null : startingCheckResult;
  const shouldShowStartingCheck = !hasCodingHistory && !startingCheckResult?.skipped;

  useEffect(() => {
    setStartingCheckResult(readStartingCheck());
  }, [storageScope]);

  const completeStartingCheck = (result) => {
    writeStartingCheck(result);
    setStartingCheckResult(result);
  };

  const skipStartingCheck = () => {
    const result = { skipped: true, completedAt: new Date().toISOString() };
    writeStartingCheck(result);
    setStartingCheckResult(result);
  };

  const resetStartingCheck = () => {
    clearStartingCheck();
    setStartingCheckResult(null);
  };

  // One landing for everyone. The hero already handles the brand-new case
  // gracefully (0 streak / 0 solved, recommended starter, start-here focus copy),
  // so there's no separate "new user" view to swap in after progress loads —
  // that swap was causing the flash where the first hero disappeared.
  return (
    <section className="coding-dashboard campus-lab-home">
      <CampusHero
        progressSummary={progressSummary}
        resumeItem={resumeItem}
        nextUpQuestion={nextUpQuestion}
        dailyChallenge={dailyChallenge}
        dailyDoneToday={dailyDoneToday}
        onResume={onSelectQuestion}
        onOpenLearnStart={onOpenLearnStart}
        onOpenBeginnerWarmup={onOpenBeginnerWarmup}
        onSelectQuestion={onSelectQuestion}
      />

      {shouldShowStartingCheck ? (
        <StartingCheckCard
          result={startingCheck}
          onComplete={completeStartingCheck}
          onSkip={skipStartingCheck}
          onReset={resetStartingCheck}
        />
      ) : startingCheck ? (
        <StartingCheckCard
          result={startingCheck}
          onComplete={completeStartingCheck}
          onSkip={skipStartingCheck}
          onReset={resetStartingCheck}
        />
      ) : null}

      {/* The hero already shows streak / solved / % complete and the "Today's
          focus" line, so the standalone progress/plan strips were redundant and
          removed. Starting Point now comes before the LeetCode daily card so new
          students get placed before they see outside challenge work. */}
      <CampusDailyMission
        dailyChallenge={dailyChallenge}
        loading={dailyChallengeLoading}
        dailyDoneToday={dailyDoneToday}
        displayStreak={displayStreak}
        onPractice={onStartDaily}
        onOpenScratch={onOpenDailyScratch}
      />

      <CampusLearningQueue
        questions={queueQuestions}
        progressByQuestion={progressByQuestion}
        resumeItem={resumeItem}
        nextUpQuestion={nextUpQuestion}
        focus={focus}
        mastery={mastery}
        adaptivePractice={adaptivePractice}
        startingCheck={startingCheck}
        onSelect={onSelectQuestion}
        onOpenQuizBank={onOpenQuizBank}
        onOpenBeginnerWarmup={onOpenBeginnerWarmup}
        onOpenTopic={onOpenTopic}
        onOpenLessonReview={onOpenLessonReview}
        onOpenStartingPath={onOpenStartingPath}
        learningStyle={learningStyle}
      />

      <CampusTutorActions
        latestQuizResponse={latestQuizResponse}
        onPrompt={onPrompt}
        onOpenInterviewPrep={onOpenInterviewPrep}
        onOpenSnippets={onOpenSnippets}
        onSaveQuiz={onSaveQuiz}
      />
    </section>
  );
}

