import { FaBook, FaChartLine, FaCode, FaLaptopCode, FaPlay, FaRegCompass } from "react-icons/fa";

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
    return `Solve today's ${diff} LeetCode problem, run it, and review your approach.`;
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
  const add = (kind, label, question, fallback) => {
    if (question?.id && !used.has(question.id)) {
      used.add(question.id);
      path.push({ kind, label, question });
      return;
    }
    if (fallback) path.push({ kind, label, fallback });
  };

  add(
    "start",
    resumeItem?.question ? "Finish" : "Start",
    resumeItem?.question || nextUpQuestion || firstUnsolved(questions, progressByQuestion),
    "Open the Practice Library and choose one easy problem."
  );

  const weakTopic = mastery?.weakest?.topic || focus?.next?.topic || focus?.first?.topic;
  const weakPick = unsolvedByTopic(questions, progressByQuestion, weakTopic)
    .find(q => !used.has(q.id));
  add(
    "practice",
    weakTopic ? `Practice ${titleCase(weakTopic)}` : "Practice a weak spot",
    weakPick,
    "Pick one topic that feels shaky and solve one problem from it."
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
    "After one pass, try a medium problem or review a failed test."
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
  onOpenSnippets,
  onSelectQuestion,
}) {
  // State-first hero: lead with the student's status and ONE primary action —
  // resume in-progress work if any, otherwise start the recommended problem.
  const primaryQuestion = resumeItem?.question || nextUpQuestion || null;
  const isResume = Boolean(resumeItem?.question);
  // The hero owns the next action: one concrete "Today's Focus" line (was a
  // separate strip below the hero).
  const focusPlan = buildFocusPlan({ resumeItem, nextUpQuestion, dailyChallenge, dailyDoneToday });

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
            <strong>{progressSummary.displayStreak}</strong>
            <i>day streak</i>
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
            <button type="button" className="campus-primary-action" onClick={onOpenSnippets}>
              <FaLaptopCode aria-hidden="true" />
              Open My Workspace
            </button>
          )}
          <button type="button" className="campus-secondary-action" onClick={onOpenSnippets}>
            <FaLaptopCode aria-hidden="true" />
            My Workspace
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
function focusCopy(focus) {
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

function CampusLearningQueue({
  questions,
  progressByQuestion,
  resumeItem,
  nextUpQuestion,
  focus,
  mastery,
  onSelect,
  onOpenSnippets,
  onOpenQuizBank,
  onOpenTopic,
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
  const focusTopic = focus?.hasProgress ? focus.next?.topic : focus?.first?.topic;
  const focusTitle = focus?.hasProgress
    ? `Practice ${titleCase(focus.next.topic)}`
    : focus
      ? `Start with ${titleCase(focus.first.topic)}`
      : "Choose a topic";
  const focusBlurb = focusTopic
    ? "Opens the library with this topic selected."
    : "Pick one topic and solve the first problem you see.";
  return (
    <section className="campus-learning-queue" aria-label="Your coding path">
      <div className="campus-section-heading">
        <span className="coding-kicker">Your Coding Path</span>
      </div>
      <div className="campus-queue-grid three-up">
        <article className="campus-queue-item featured">
          <span>Today&apos;s Path</span>
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
        <article className="campus-queue-item personal">
          <span>Personal Code Lab</span>
          <strong>My Snippets</strong>
          <p>Write, run, save, and review your own code.</p>
          <button type="button" onClick={onOpenSnippets}>Open Workspace</button>
        </article>
        <article className="campus-queue-item focus">
          <span>Recommended Focus</span>
          <strong>{focusTitle}</strong>
          <p>{focusBlurb}</p>
          <button type="button" onClick={() => (focusTopic ? onOpenTopic?.(focusTopic) : onOpenQuizBank())}>
            {focusTopic ? `Open ${titleCase(focusTopic)}` : "Browse Practice Library"}
          </button>
        </article>
      </div>
    </section>
  );
}

function CampusTutorActions({ latestQuizResponse, onPrompt, onSaveQuiz }) {
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
        <button type="button" onClick={() => onPrompt("Review my current code and explain the biggest issue first.", { title: "Code review" })}>
          <FaCode aria-hidden="true" />
          <span>Review my current code</span>
        </button>
        <button type="button" onClick={() => onPrompt("Help me prepare for a technical interview problem with hints first.", { title: "Interview prep" })}>
          <FaChartLine aria-hidden="true" />
          <span>Start a mock interview</span>
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

function CampusDailyMission({ dailyChallenge, loading, dailyDoneToday, displayStreak, onPractice }) {
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
        <div className="daily-meta-row">
          <span className={`daily-difficulty ${difficultyClass(dailyChallenge?.difficulty)}`}>{dailyChallenge?.difficulty || "Easy"}</span>
          {isLeetCode && <span className="daily-source-pill">LeetCode</span>}
          {dailyDoneToday
            ? <span className="daily-streak-pill done">Done today - {displayStreak}-day streak</span>
            : displayStreak > 0 && <span className="daily-streak-pill">{displayStreak}-day streak - keep it going</span>}
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
            Practice Now
          </button>
          {dailyChallenge?.url && (
            <a href={dailyChallenge.url} target="_blank" rel="noopener noreferrer" className="daily-link">
              View Source
            </a>
          )}
        </div>
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
  onOpenSnippets,
  onSelectQuestion,
  onOpenQuizBank,
  onOpenTopic,
  onPrompt,
  onSaveQuiz,
  mastery,
}) {
  const queueQuestions = questions || [];
  const resumeItem = findResumeItem(queueQuestions, progressByQuestion);
  const focus = pickFocusTopics(topicPacks);

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
        onOpenSnippets={onOpenSnippets}
        onSelectQuestion={onSelectQuestion}
      />

      {/* The hero already shows streak / solved / % complete and the "Today's
          focus" line, so the standalone progress/plan strips were redundant and
          removed. The LeetCode daily challenge is the focal point under the hero. */}
      <CampusDailyMission
        dailyChallenge={dailyChallenge}
        loading={dailyChallengeLoading}
        dailyDoneToday={dailyDoneToday}
        displayStreak={displayStreak}
        onPractice={onStartDaily}
      />

      <CampusLearningQueue
        questions={queueQuestions}
        progressByQuestion={progressByQuestion}
        resumeItem={resumeItem}
        nextUpQuestion={nextUpQuestion}
        focus={focus}
        mastery={mastery}
        onSelect={onSelectQuestion}
        onOpenSnippets={onOpenSnippets}
        onOpenQuizBank={onOpenQuizBank}
        onOpenTopic={onOpenTopic}
      />

      <CampusTutorActions
        latestQuizResponse={latestQuizResponse}
        onPrompt={onPrompt}
        onSaveQuiz={onSaveQuiz}
      />
    </section>
  );
}

