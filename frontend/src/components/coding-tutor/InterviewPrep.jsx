import { useMemo, useState } from "react";
import {
  FaArrowRight,
  FaBolt,
  FaCheck,
  FaChevronDown,
  FaCode,
  FaExternalLinkAlt,
  FaHistory,
  FaLayerGroup,
  FaListUl,
  FaProjectDiagram,
  FaRegCheckCircle,
  FaRegStar,
  FaRoute,
  FaSearch,
  FaSitemap,
  FaStream,
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

// Topic-specific icons so cards stop looking identical. Falls back to a list icon.
const TOPIC_ICONS = {
  arrays: FaTable,
  strings: FaListUl,
  stacks: FaLayerGroup,
  queues: FaStream,
  recursion: FaProjectDiagram,
  trees: FaSitemap,
  graphs: FaProjectDiagram,
  "linked-lists": FaStream,
  "bit-manipulation": FaBolt,
};

// Preferred warmup order for the Recommended Path: confidence-building topics
// first, harder structural topics later. Only topics that actually exist in the
// loaded set are shown, so this adapts if the question bank changes.
const PATH_ORDER = ["arrays", "strings", "stacks", "recursion", "linked-lists", "trees", "graphs", "bit-manipulation"];

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
    .sort((a, b) => b.total - a.total || a.topic.localeCompare(b.topic));
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
    const reviewedCount = questions.filter(q => reviewed.has(q.id)).length;
    const topicsTouched = allGroups.filter(g => g.reviewedCount > 0).length;
    // Strongest = highest reviewed ratio (needs ≥1 reviewed); next = first path
    // topic not yet fully reviewed.
    const ranked = [...allGroups]
      .filter(g => g.reviewedCount > 0)
      .sort((a, b) => b.reviewedCount / b.total - a.reviewedCount / a.total);
    const strongest = ranked[0]?.topic || null;
    const pathTopics = PATH_ORDER.filter(t => allGroups.some(g => g.topic === t));
    const nextTopic =
      pathTopics.find((t) => {
        const g = allGroups.find(gg => gg.topic === t);
        return g && g.reviewedCount < g.total;
      }) || pathTopics[0] || null;
    return {
      reviewedCount,
      total: questions.length,
      topicsTouched,
      topicsTotal: allGroups.length,
      strongest,
      nextTopic,
      pathTopics,
    };
  }, [questions, allGroups, reviewed]);

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
    const first = group?.questions.find(q => !reviewed.has(q.id)) || group?.questions[0];
    if (first) onSolve?.(first);
  };

  return (
    <PageShell
      title="Practice common coding interview patterns"
      subtitle="Choose a topic, solve a problem, then review a walkthrough. These are classic interview questions — attempt each one before opening the solution."
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
      {/* Progress strip — each metric a small pill-card with an icon. */}
      <div className="iv-progress-strip">
        <div className="iv-stats">
          <div className="iv-stat">
            <span className="iv-stat-icon"><FaRegCheckCircle aria-hidden="true" /></span>
            <span className="iv-stat-body">
              <span className="iv-stat-num">{totals.reviewedCount}<span className="iv-stat-den">/{totals.total}</span></span>
              <span className="iv-stat-label">Reviewed</span>
            </span>
          </div>
          <div className="iv-stat">
            <span className="iv-stat-icon"><FaListUl aria-hidden="true" /></span>
            <span className="iv-stat-body">
              <span className="iv-stat-num">{totals.topicsTouched}<span className="iv-stat-den">/{totals.topicsTotal}</span></span>
              <span className="iv-stat-label">Topics started</span>
            </span>
          </div>
          <div className="iv-stat">
            <span className="iv-stat-icon"><FaRegStar aria-hidden="true" /></span>
            <span className="iv-stat-body">
              <span className="iv-stat-num iv-stat-text">{totals.strongest ? titleCase(totals.strongest) : "—"}</span>
              <span className="iv-stat-label">Strongest</span>
            </span>
          </div>
          <div className="iv-stat">
            <span className="iv-stat-icon"><FaRoute aria-hidden="true" /></span>
            <span className="iv-stat-body">
              <span className="iv-stat-num iv-stat-text">{totals.nextTopic ? titleCase(totals.nextTopic) : "—"}</span>
              <span className="iv-stat-label">Practice next</span>
            </span>
          </div>
        </div>
        <button type="button" className="iv-mock-btn" onClick={() => onStartMock?.()}>
          <FaBolt aria-hidden="true" />
          <span>
            <strong>Start Mock Interview</strong>
            <small>3 problems · 45 min · mixed</small>
          </span>
        </button>
      </div>

      {/* Recommended path — clickable topic chips that jump to that warmup. */}
      {totals.pathTopics.length > 1 && (
        <div className="iv-path-strip">
          <div className="iv-path-head">
            <FaRoute aria-hidden="true" />
            <span>Recommended Path</span>
          </div>
          <div className="iv-path-chain">
            {totals.pathTopics.slice(0, 4).map((topic, i) => (
              <span className="iv-path-node" key={topic}>
                <button
                  type="button"
                  className={`iv-path-chip ${topic === totals.nextTopic ? "is-next" : ""}`}
                  onClick={() => startWarmup(topic)}
                >
                  {titleCase(topic)}
                </button>
                {i < Math.min(totals.pathTopics.length, 4) - 1 && <FaArrowRight className="iv-path-arrow" aria-hidden="true" />}
              </span>
            ))}
          </div>
          {totals.nextTopic && (
            <button type="button" className="iv-path-cta" onClick={() => startWarmup(totals.nextTopic)}>
              Start {titleCase(totals.nextTopic)} warmup
            </button>
          )}
        </div>
      )}

      {/* Search + active result summary. */}
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

            const setView = (patch) =>
              setTopicView(prev => ({ ...prev, [group.topic]: { ...view, ...patch } }));

            return (
              <article key={group.topic} className={`iv-topic-card tone-${index % 5} ${isOpen ? "open" : ""}`}>
                <button
                  type="button"
                  className="iv-topic-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpenTopic(isOpen ? "" : group.topic)}
                >
                  <span className="iv-topic-icon" aria-hidden="true"><Icon /></span>
                  <span className="iv-topic-meta">
                    <h3>{titleCase(group.topic)}</h3>
                    <p className="iv-topic-counts">
                      {group.total} question{group.total === 1 ? "" : "s"}
                      <span className="iv-topic-breakdown">
                        {group.breakdown.easy > 0 && <span className="iv-bd-chip b-easy">{group.breakdown.easy} Easy</span>}
                        {group.breakdown.medium > 0 && <span className="iv-bd-chip b-med">{group.breakdown.medium} Med</span>}
                        {group.breakdown.hard > 0 && <span className="iv-bd-chip b-hard">{group.breakdown.hard} Hard</span>}
                      </span>
                    </p>
                    <span className="iv-topic-progress" aria-label={`${group.reviewedCount} of ${group.total} reviewed`}>
                      <span className="iv-topic-progress-fill" style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                  <span className="iv-topic-aside">
                    {group.solvedCount > 0 && (
                      <span className="iv-topic-solved" title={`${group.solvedCount} solved`}>
                        <FaCheck aria-hidden="true" /> {group.solvedCount} solved
                      </span>
                    )}
                    <span className="iv-topic-reviewed">{group.reviewedCount}/{group.total}</span>
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
                        const isReviewed = reviewed.has(question.id) || solved.has(question.id);
                        const isSolved = solved.has(question.id);
                        return (
                          <li key={question.id} className={`iv-question-row ${isReviewed ? "reviewed" : ""}`}>
                            <button
                              type="button"
                              className={`iv-review-check ${isReviewed ? "on" : ""}`}
                              aria-pressed={isReviewed}
                              title={isReviewed ? "Reviewed — click to clear" : "Mark as reviewed"}
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
