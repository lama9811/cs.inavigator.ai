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

function CampusLearningQueue({ nextUpQuestion, focus, onSelect, onOpenSnippets, onOpenQuizBank }) {
  // The hero owns "what to do right now" (resume / recommended). This section is a
  // guided path: next track, personal workspace, and a data-driven focus nudge.
  return (
    <section className="campus-learning-queue" aria-label="Your coding path">
      <div className="campus-section-heading">
        <span className="coding-kicker">Your Coding Path</span>
        <h3>Continue your last attempt or start the next recommended problem.</h3>
      </div>
      <div className="campus-queue-grid three-up">
        <article className="campus-queue-item featured">
          <span>Recommended Next</span>
          <strong>{nextUpQuestion?.title || "Review your solved set"}</strong>
          <p>
            {nextUpQuestion?.topic
              ? `${nextUpQuestion.topic} — a good next track for you.`
              : "Use the Practice Library to choose another track."}
          </p>
          <button
            type="button"
            className="campus-primary-action"
            onClick={() => (nextUpQuestion ? onSelect(nextUpQuestion) : onOpenQuizBank())}
          >
            {nextUpQuestion ? "Start problem" : "Browse Practice Library"}
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
          <strong>
            {focus?.hasProgress
              ? `Level up ${focus.next.topic}`
              : focus
                ? `Begin with ${focus.first.topic}`
                : "Find your track"}
          </strong>
          <p>{focusCopy(focus)}</p>
          <button type="button" onClick={onOpenQuizBank}>Browse Practice Library</button>
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

function CampusDailyMission({ dailyChallenge, dailyDoneToday, displayStreak, onPractice }) {
  const isLeetCode = (dailyChallenge?.source || "").toLowerCase() === "leetcode";
  const problemNumber = dailyChallenge?.frontend_id;
  const tags = Array.isArray(dailyChallenge?.tags) ? dailyChallenge.tags.filter(Boolean) : [];
  const practiceTags = tags.slice(0, 3);
  return (
    <section className="campus-daily-mission" aria-label="LeetCode daily challenge">
      <div>
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
        {tags.length > 0 && (
          <>
            <p className="daily-practice-for">
              Good for practicing:
            </p>
            <div className="daily-tags">
              {tags.map(tag => <span key={tag}>{tag}</span>)}
            </div>
          </>
        )}
      </div>
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
  dailyDoneToday,
  displayStreak,
  latestQuizResponse,
  onStartDaily,
  onOpenSnippets,
  onSelectQuestion,
  onOpenQuizBank,
  onPrompt,
  onSaveQuiz,
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
        dailyDoneToday={dailyDoneToday}
        displayStreak={displayStreak}
        onPractice={onStartDaily}
      />

      <CampusLearningQueue
        nextUpQuestion={nextUpQuestion}
        focus={focus}
        onSelect={onSelectQuestion}
        onOpenSnippets={onOpenSnippets}
        onOpenQuizBank={onOpenQuizBank}
      />

      <CampusTutorActions
        latestQuizResponse={latestQuizResponse}
        onPrompt={onPrompt}
        onSaveQuiz={onSaveQuiz}
      />
    </section>
  );
}

