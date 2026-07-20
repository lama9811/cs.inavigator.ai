import { useMemo, useState } from "react";
import {
  FaBolt,
  FaCheck,
  FaChevronDown,
  FaCode,
  FaExternalLinkAlt,
  FaHistory,
  FaLayerGroup,
  FaLink,
  FaListUl,
  FaRegCheckCircle,
  FaRoute,
  FaSearch,
  FaShareAlt,
  FaSitemap,
  FaStream,
  FaSyncAlt,
  FaTable,
  FaVideo,
} from "react-icons/fa";
import { markInterviewReviewed, useInterviewReviewed, useInterviewSolved } from "./interviewProgress";
import { useInterviewHistory } from "./interviewHistory";
import "./InterviewPrep.css";

function titleCase(value = "") {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 };
const ROWS_BEFORE_COLLAPSE = 5;

// Topic-specific icons so cards stop looking identical — each topic gets a
// distinct glyph (no two share one). Falls back to a list icon.
const TOPIC_ICONS = {
  arrays: FaTable,
  strings: FaListUl,
  stacks: FaLayerGroup,
  queues: FaStream,
  recursion: FaSyncAlt,        // loop/recurse
  trees: FaSitemap,
  graphs: FaShareAlt,          // connected nodes (graph)
  "linked-lists": FaLink,      // chained links
  "bit-manipulation": FaBolt,
};

// Preferred warmup order for the Recommended Path: confidence-building topics
// first, harder structural topics later. Only topics that actually exist in the
// loaded set are shown, so this adapts if the question bank changes.
const PATH_ORDER = ["arrays", "strings", "recursion", "stacks", "linked-lists", "trees", "graphs", "bit-manipulation"];

function difficultyOf(question) {
  return (question.difficulty || "easy").toLowerCase();
}

function countByDifficulty(questions) {
  return questions.reduce(
    (acc, q) => {
      const d = difficultyOf(q);
      if (d in acc) acc[d] += 1;
      return acc;
    },
    { easy: 0, medium: 0, hard: 0 },
  );
}

function groupByTopic(questions, reviewed, solved = new Set()) {
  const groups = new Map();
  questions.forEach((question) => {
    const topic = question.topic || "general";
    const entry = groups.get(topic) || { topic, questions: [] };
    entry.questions.push(question);
    groups.set(topic, entry);
  });
  return [...groups.values()]
    .map((entry) => {
      const sorted = [...entry.questions].sort(
        (a, b) =>
          (DIFFICULTY_RANK[difficultyOf(a)] ?? 9) - (DIFFICULTY_RANK[difficultyOf(b)] ?? 9) ||
          (a.title || "").localeCompare(b.title || ""),
      );
      const solvedCount = sorted.filter(q => solved.has(q.id)).length;
      // "Done" for the topic progress = solved (auto, from a mock) OR reviewed (manual).
      const reviewedCount = sorted.filter(q => solved.has(q.id) || reviewed.has(q.id)).length;
      return {
        topic: entry.topic,
        questions: sorted,
        breakdown: countByDifficulty(sorted),
        reviewedCount,
        solvedCount,
        total: sorted.length,
      };
    })
    .sort((a, b) => {
      const aIndex = PATH_ORDER.indexOf(a.topic);
      const bIndex = PATH_ORDER.indexOf(b.topic);
      const aRank = aIndex === -1 ? PATH_ORDER.length : aIndex;
      const bRank = bIndex === -1 ? PATH_ORDER.length : bIndex;
      return aRank - bRank || b.total - a.total || a.topic.localeCompare(b.topic);
    });
}

function PageShell({ title, subtitle, heroAside, children }) {
  return (
    <section className="coding-page-panel interview-prep-page">
      <div className="interview-prep-hero">
        <div className="interview-prep-hero-copy">
          <span className="coding-kicker">Interview Prep</span>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {heroAside && <div className="interview-prep-hero-aside">{heroAside}</div>}
      </div>
      {children}
    </section>
  );
}

export default function InterviewPrep({ questions = [], loading = false, onSolve, onStartMock, resolvePracticeTopic, onOpenPracticeTopic, onOpenHistory }) {
  const { reviewed, toggleReviewed } = useInterviewReviewed();
  const solved = useInterviewSolved();
  const { history } = useInterviewHistory();
  const [search, setSearch] = useState("");
  const [openTopic, setOpenTopic] = useState(null);
  // Per-topic UI state, keyed by topic: { diff: "all"|"easy"|.., showAll: bool }.
  const [topicView, setTopicView] = useState({});

  const allGroups = useMemo(() => groupByTopic(questions, reviewed, solved), [questions, reviewed, solved]);

  // Search across title, topic, secondary topics, and patterns. Also supports a
  // bare difficulty word ("medium", "hard") and combos like "medium arrays".
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return questions;
    const terms = q.split(/\s+/);
    return questions.filter((question) => {
      const haystack = [
        question.title,
        question.topic,
        ...(question.topics || []),
        ...(question.patterns || []),
        question.difficulty,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }, [questions, search]);

  const groups = useMemo(() => groupByTopic(filtered, reviewed, solved), [filtered, reviewed, solved]);

  // Surface recognized facets in the search as chips (difficulty + known topics),
  // so "medium arrays" reads back as [Medium] [Arrays] under the bar.
  const searchChips = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const chips = [];
    const knownTopics = new Set(allGroups.map(g => g.topic));
    ["easy", "medium", "hard"].forEach((d) => {
      if (q.includes(d)) chips.push(titleCase(d));
    });
    q.split(/\s+/).forEach((term) => {
      if (knownTopics.has(term) && !chips.includes(titleCase(term))) chips.push(titleCase(term));
    });
    return chips;
  }, [search, allGroups]);

  const totals = useMemo(() => {
    const pathTopics = PATH_ORDER.filter(topic => allGroups.some(group => group.topic === topic));
    const gateTopics = pathTopics.slice(0, 3);
    const gateProgress = gateTopics.map((topic) => {
      const group = allGroups.find(item => item.topic === topic);
      const target = Math.min(2, group?.total || 0);
      const current = Math.min(group?.reviewedCount || 0, target);
      return { topic, current, target, done: target > 0 && current >= target };
    });
    const warmupsComplete = gateProgress.reduce((sum, item) => sum + item.current, 0);
    const warmupsGoal = gateProgress.reduce((sum, item) => sum + item.target, 0);
    const readyPct = warmupsGoal ? Math.round((warmupsComplete / warmupsGoal) * 100) : 0;
    const isReady = warmupsGoal > 0 && warmupsComplete >= warmupsGoal;
    const nextGate = gateProgress.find(item => !item.done);
    const nextPathTopic = pathTopics.find((topic) => {
      const group = allGroups.find(item => item.topic === topic);
      return group && group.reviewedCount < group.total;
    });

    return {
      pathTopics,
      gateTopics,
      gateProgress,
      warmupsComplete,
      warmupsGoal,
      remainingWarmups: Math.max(0, warmupsGoal - warmupsComplete),
      readyPct,
      isReady,
      nextTopic: nextGate?.topic || nextPathTopic || pathTopics[0] || null,
    };
  }, [allGroups]);

  // Which topic card is expanded. Null/"" = all collapsed — we do NOT auto-open the
  // first topic on load; a card only opens when the user clicks it.
  const activeTopic = openTopic || null;

  if (loading) {
    return <PageShell title="Loading interview questions…" />;
  }
  if (!questions.length) {
    return (
      <PageShell
        title="No interview questions yet"
        subtitle="Interview questions could not be loaded. Try refreshing the page."
      />
    );
  }

  const startWarmup = (topic) => {
    const group = allGroups.find(g => g.topic === topic);
    const first = group?.questions.find(question => !reviewed.has(question.id)) || group?.questions[0];
    if (first) onSolve?.(first);
  };

  return (
    <PageShell
      title="Practice common coding interview patterns"
      subtitle="Learn common patterns, practice by topic, and try a timed mock when you feel ready."
      heroAside={
        history.length > 0 && onOpenHistory ? (
          <button
            type="button"
            className="iv-history-entry"
            onClick={onOpenHistory}
            title="View your past mock interviews"
          >
            <FaHistory aria-hidden="true" />
            <span>Past Interviews</span>
          </button>
        ) : null
      }
    >
      {/* Search sits above the readiness hero so students can jump straight to a
          problem without scrolling past the mock-interview flow. */}
      <div className="iv-search-wrap">
        <div className="iv-search">
          <FaSearch aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search problems — try "merge", "medium arrays", "recursion"'
            aria-label="Search interview questions"
          />
          {search && (
            <button type="button" className="iv-search-clear" onClick={() => setSearch("")}>Clear</button>
          )}
        </div>
        {search.trim() && (
          <div className="iv-search-summary">
            Showing <strong>{filtered.length}</strong> match{filtered.length === 1 ? "" : "es"}
            {searchChips.length > 0 && (
              <span className="iv-search-chips">
                {searchChips.map(chip => <span className="iv-search-chip" key={chip}>{chip}</span>)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Readiness Check ladder ──────────────────────────────────────────────
          One merged flow (not two competing banners). The mock interview is the
          GOAL; warming up is framed as the stepping-stone that gets you there. A
          readiness meter fills as gate topics are completed, and the CTA hierarchy
          flips at 100%: below-ready the warmup leads and mock is "…anyway"; at
          ready the mock glows as the primary "You're ready!" action. */}
      <div className={`iv-ladder ${totals.isReady ? "is-ready" : ""}`}>
        <div className="iv-ladder-top">
          <div className="iv-ladder-copy">
            <span className="iv-ladder-eyebrow">Mock interview</span>
            <h3 className="iv-ladder-title">
              {totals.isReady ? "Warm-ups complete. Try a real simulation." : "Build confidence before the timer starts"}
            </h3>
            <p className="iv-ladder-sub">
              Complete {totals.warmupsGoal} recommended problems by solving them or marking them reviewed. You can start the 45-minute mock anytime.
            </p>
          </div>
          <div
            className="iv-ready-meter"
            role="progressbar"
            aria-valuenow={totals.warmupsComplete}
            aria-valuemin={0}
            aria-valuemax={totals.warmupsGoal}
            aria-label="Recommended warm-up progress"
          >
            <div className="iv-ready-meter-head">
              <FaBolt aria-hidden="true" />
              <span>Warm-up progress</span>
              <strong>{totals.warmupsComplete} / {totals.warmupsGoal}</strong>
            </div>
            <div className="iv-ready-track">
              <span className="iv-ready-fill" style={{ width: `${totals.readyPct}%` }} />
            </div>
            <span className="iv-ready-hint">
              {totals.isReady
                ? "You completed the recommended warm-ups."
                : `${totals.remainingWarmups} recommended problem${totals.remainingWarmups === 1 ? "" : "s"} remaining.`}
            </span>
          </div>
        </div>

        {totals.gateProgress.length > 0 && (
          <ol className="iv-checklist" aria-label="Recommended warm-up topics">
            {totals.gateProgress.map((step) => {
              const current = !step.done && step.topic === totals.nextTopic;
              return (
                <li
                  key={step.topic}
                  className={`iv-check-step ${step.done ? "done" : ""} ${current ? "current" : ""}`}
                >
                  <span className="iv-check-mark" aria-hidden="true">
                    {step.done ? <FaCheck /> : current ? <FaRoute /> : ""}
                  </span>
                  <span className="iv-check-label">
                    {titleCase(step.topic)}
                    <small>{step.current} / {step.target} complete{current ? " - next" : ""}</small>
                  </span>
                </li>
              );
            })}
            <li className={`iv-check-step goal ${totals.isReady ? "unlocked" : "available"}`}>
              <span className="iv-check-mark" aria-hidden="true"><FaBolt /></span>
              <span className="iv-check-label">
                Mock Interview
                <small>{totals.isReady ? "Warm-ups complete" : "Available anytime"}</small>
              </span>
            </li>
          </ol>
        )}

        <div className="iv-ladder-actions-row">
          <div className="iv-ladder-actions">
            {totals.isReady ? (
              <>
                <button
                  type="button"
                  className="iv-ladder-cta primary glow"
                  onClick={() => onStartMock?.()}
                >
                  <FaBolt aria-hidden="true" />
                  Start mock interview
                </button>
                {totals.nextTopic && (
                  <button
                    type="button"
                    className="iv-ladder-cta secondary"
                    onClick={() => startWarmup(totals.nextTopic)}
                  >
                    Keep practicing {titleCase(totals.nextTopic)}
                  </button>
                )}
              </>
            ) : (
              <>
                {totals.nextTopic && (
                  <button
                    type="button"
                    className="iv-ladder-cta primary"
                    onClick={() => startWarmup(totals.nextTopic)}
                  >
                    <FaRoute aria-hidden="true" />
                    Continue with {titleCase(totals.nextTopic)}
                  </button>
                )}
                <button
                  type="button"
                  className="iv-ladder-cta secondary"
                  onClick={() => onStartMock?.()}
                >
                  Start mock now
                </button>
              </>
            )}
          </div>
          {!totals.isReady && <p className="iv-ladder-note">Warm-ups are recommended, not required.</p>}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="iv-empty">No questions match “{search}”. Try a topic, a difficulty, or a keyword.</div>
      ) : (
        <>
        <div className="iv-topic-grid">
          {groups.map((group, index) => {
            const isOpen = group.topic === activeTopic;
            const Icon = TOPIC_ICONS[group.topic] || FaListUl;
            const view = topicView[group.topic] || { diff: "all", showAll: false };
            const rows = group.questions.filter(q => view.diff === "all" || difficultyOf(q) === view.diff);
            const shown = view.showAll ? rows : rows.slice(0, ROWS_BEFORE_COLLAPSE);
            const pct = group.total ? Math.round((group.reviewedCount / group.total) * 100) : 0;
            const isDone = group.total > 0 && group.reviewedCount >= group.total;
            const isWarmupTopic = totals.gateTopics.includes(group.topic);
            const isNextTopic = !totals.isReady && group.topic === totals.nextTopic;
            const bd = group.breakdown;

            const setView = (patch) =>
              setTopicView(prev => ({ ...prev, [group.topic]: { ...view, ...patch } }));

            return (
              <article
                key={group.topic}
                className={`iv-topic-card tone-${index % 5} ${isOpen ? "open" : ""} ${isDone && !isOpen ? "is-done" : ""}`}
              >
                <button
                  type="button"
                  className="iv-topic-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpenTopic(isOpen ? "" : group.topic)}
                >
                  <span className="iv-topic-icon" aria-hidden="true"><Icon /></span>
                  <span className="iv-topic-meta">
                    <span className="iv-topic-title-row">
                      <h3>{titleCase(group.topic)}</h3>
                      {isWarmupTopic && (
                        <span className={`iv-topic-recommended ${isNextTopic ? "next" : ""}`}>
                          {isNextTopic ? "Next" : "Warm-up"}
                        </span>
                      )}
                    </span>
                    <p className="iv-topic-counts">
                      {group.total} question{group.total === 1 ? "" : "s"}
                      <span className="iv-topic-breakdown">
                        {bd.easy > 0 && <span className="iv-bd-chip b-easy">{bd.easy} Easy</span>}
                        {bd.medium > 0 && <span className="iv-bd-chip b-med">{bd.medium} Medium</span>}
                        {bd.hard > 0 && <span className="iv-bd-chip b-hard">{bd.hard} Hard</span>}
                      </span>
                    </p>
                  </span>
                  <span className="iv-topic-aside">
                    {/* Circular progress ring — empty at 0%, filled arc as reviewed
                        climbs, green glow at 100%. Replaces the tiny "0/11" text. */}
                    <span
                      className={`iv-ring ${isDone ? "done" : ""}`}
                      style={{ "--pct": pct }}
                      title={`${group.reviewedCount} of ${group.total} completed; ${group.solvedCount} solved`}
                    >
                      <span className="iv-ring-label">
                        {isDone ? <FaCheck aria-hidden="true" /> : `${group.reviewedCount}/${group.total}`}
                      </span>
                    </span>
                    <FaChevronDown className="iv-topic-chevron" aria-hidden="true" />
                  </span>
                </button>

                {isOpen && (
                  <div className="iv-topic-body">
                    <div className="iv-topic-filters">
                      {["all", "easy", "medium", "hard"].map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`iv-diff-pill ${view.diff === d ? "on" : ""}`}
                          onClick={() => setView({ diff: d, showAll: false })}
                        >
                          {d === "all" ? "All" : titleCase(d)}
                        </button>
                      ))}
                    </div>

                    <ul className="iv-question-list">
                      {shown.map((question) => {
                        const isSolved = solved.has(question.id);
                        const isManuallyReviewed = reviewed.has(question.id) && !isSolved;
                        const isReviewed = isManuallyReviewed || isSolved;
                        return (
                          <li key={question.id} className={`iv-question-row ${isReviewed ? "reviewed" : ""}`}>
                            <button
                              type="button"
                              className={`iv-review-check ${isReviewed ? "on" : ""}`}
                              aria-pressed={isReviewed}
                              aria-label={isSolved ? `${question.title} is solved` : isManuallyReviewed ? `Clear reviewed status for ${question.title}` : `Mark ${question.title} as reviewed`}
                              title={isSolved ? "Solved" : isManuallyReviewed ? "Marked reviewed - click to clear" : "Mark as reviewed"}
                              disabled={isSolved}
                              onClick={() => toggleReviewed(question.id)}
                            >
                              {isReviewed ? <FaCheck aria-hidden="true" /> : <FaRegCheckCircle aria-hidden="true" />}
                            </button>
                            <span className="iv-question-main">
                              <span className="iv-question-title-row">
                                <span className="iv-question-title">{question.title}</span>
                                <span className={`iv-question-diff diff-${difficultyOf(question)}`}>
                                  {titleCase(question.difficulty)}
                                </span>
                                {isSolved && <span className="iv-question-solved"><FaCheck aria-hidden="true" /> Solved</span>}
                                {isManuallyReviewed && <span className="iv-question-reviewed">Marked reviewed</span>}
                              </span>
                              {(() => {
                                // Drop the section's own topic (redundant under a topic
                                // group) and anything already implied by it, then show
                                // the *other* background. Linkable ones jump to the
                                // Practice Library so the student can go learn it first.
                                const extras = (question.requires || []).filter(
                                  (r) => r.toLowerCase() !== group.topic.toLowerCase(),
                                );
                                if (!extras.length) return null;
                                return (
                                  <span className="iv-question-requires">
                                    Needs:{" "}
                                    {extras.map((r, i) => {
                                      // Link only when the label resolves to a real
                                      // Practice Library topic; otherwise grey it out so
                                      // it never dead-links to an unfiltered library.
                                      const resolved = resolvePracticeTopic?.(r);
                                      const linkable = resolved && onOpenPracticeTopic;
                                      return (
                                        <span key={r}>
                                          {i > 0 && " · "}
                                          {linkable ? (
                                            <button
                                              type="button"
                                              className="iv-requires-link"
                                              onClick={() => onOpenPracticeTopic(r)}
                                              title={`Practice ${r} in the Practice Library`}
                                            >
                                              {r}
                                            </button>
                                          ) : (
                                            <span className="iv-requires-plain" title="Not yet in the Practice Library">{r}</span>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </span>
                                );
                              })()}
                            </span>
                            <span className="iv-question-actions">
                              <button
                                type="button"
                                className="iv-question-action primary"
                                onClick={() => onSolve?.(question)}
                              >
                                <FaCode aria-hidden="true" />
                                Solve
                              </button>
                              {question.answer_url ? (
                                <a
                                  className="iv-question-action icon-only"
                                  href={question.answer_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="View worked solution"
                                  onClick={() => markInterviewReviewed(question.id)}
                                >
                                  {question.answer_kind === "video" ? <FaVideo aria-hidden="true" /> : <FaExternalLinkAlt aria-hidden="true" />}
                                </a>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>

                    {rows.length > ROWS_BEFORE_COLLAPSE && (
                      <button type="button" className="iv-show-all" onClick={() => setView({ showAll: !view.showAll })}>
                        {view.showAll ? "Show fewer" : `Show all ${rows.length}`}
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        </>
      )}

    </PageShell>
  );
}
