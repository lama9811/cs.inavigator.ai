import { useEffect, useMemo, useState } from "react";
import { FaFire, FaCheckCircle, FaPenFancy, FaChartLine, FaSearch } from "react-icons/fa";
import QuizProblemCard from "./QuizProblemCard";

function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1).replace("_", " ") : "";
}

// How many problem cards to render initially / reveal per "Show more" click.
// Caps the number of mounted cards so the grid stays fast as the bank grows.
const PAGE_SIZE = 15;

// Map a question's progress record to one of the three status buckets used by
// the Status filter. Mirrors the parent's status logic (CodingTutor.jsx).
function statusOf(progress) {
  if (progress?.status === "solved") return "solved";
  if (progress?.status === "in_progress" || (progress?.attempt_count || 0) > 0) return "in_progress";
  return "not_started";
}

const TOPIC_INSIGHTS = {
  strings: {
    objectives: ["String normalization", "Character comparison", "Edge case handling"],
    mistakes: ["Forgetting lowercase conversion", "Ignoring spaces or punctuation", "Using extra loops when a two-pointer pass fits"],
  },
  arrays: {
    objectives: ["Index tracking", "Single-pass updates", "Boundary checks"],
    mistakes: ["Skipping the first or last item", "Mutating input unexpectedly", "Using nested loops without needing them"],
  },
  "two pointers": {
    objectives: ["Pointer movement rules", "Loop stopping conditions", "Pair comparison"],
    mistakes: ["Moving both pointers too early", "Missing equal-value cases", "Not testing short inputs"],
  },
  loops: {
    objectives: ["Loop invariants", "Accumulator updates", "Manual tracing"],
    mistakes: ["Off-by-one ranges", "Resetting counters inside loops", "Returning before the loop finishes"],
  },
  hashmaps: {
    objectives: ["Frequency counting", "Lookup-first reasoning", "Key normalization"],
    mistakes: ["Checking after overwriting values", "Using the wrong key shape", "Forgetting default counts"],
  },
};

// Compact one-row progress strip for the Practice Library. Same numbers as the
// big StatTiles cards (streak / solved / attempted / % complete) but inline, so
// the problem grid rises into view on a page whose job is "pick a problem".
// The Home dashboard no longer shows stat tiles; the Progress page keeps the
// full StatTiles cards (progress is the point there).
function ProgressStrip({ progressSummary }) {
  const items = [
    { key: "streak", Icon: FaFire, value: progressSummary.displayStreak, label: "day streak" },
    { key: "solved", Icon: FaCheckCircle, value: progressSummary.solvedCount, label: "solved" },
    { key: "attempted", Icon: FaPenFancy, value: progressSummary.attemptedCount, label: "attempted" },
    { key: "complete", Icon: FaChartLine, value: `${progressSummary.completionPercent}%`, label: "complete" },
  ];
  return (
    <div className="practice-progress-strip" aria-label="Your coding progress at a glance">
      {items.map((item) => {
        const Icon = item.Icon;
        return (
          <span className={`practice-progress-item progress-${item.key}`} key={item.key}>
            <Icon aria-hidden="true" />
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </span>
        );
      })}
    </div>
  );
}

function insightForTopic(topic = "") {
  const normalized = topic.toLowerCase();
  const key = Object.keys(TOPIC_INSIGHTS).find(name => normalized.includes(name));
  return TOPIC_INSIGHTS[key] || {
    objectives: [`Practice ${topic || "problem"} reasoning`, "Trace examples by hand", "Test edge cases before finalizing"],
    mistakes: ["Skipping the smallest input", "Not explaining the approach first", "Changing too much code at once"],
  };
}

export default function QuizBank({
  questions,
  allQuestions = [],
  progressByQuestion,
  listLoading,
  progressSummary,
  selectedTopicPack,
  onDifficultyChange,
  onClearTopicPack,
  onSelectProblem,
}) {
  // The full cross-difficulty set is the source for browsing/filtering. The
  // parent loads all difficulties into allQuestions; fall back to the current
  // difficulty's `questions` only if that hasn't arrived yet.
  const sourceQuestions = allQuestions.length ? allQuestions : questions;

  // ---- Local filter state ----
  // Difficulty/topic/status default to "all"; a topic pack opened from Interview
  // Prep pre-selects that topic so the page lands already filtered.
  const [search, setSearch] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState(selectedTopicPack || "all");
  // How many topic-progress rows are visible; "Show more" reveals 5 at a time.
  const [visibleTopicCount, setVisibleTopicCount] = useState(5);
  // How many problem cards are visible; "Show more" reveals PAGE_SIZE at a time.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Keep the local topic filter in sync if the page is opened with a topic pack.
  const effectiveTopic = selectedTopicPack || topicFilter;

  // Topic options come from the whole set so the dropdown is stable regardless
  // of the other active filters.
  const topicOptions = useMemo(
    () => [...new Set(sourceQuestions.map(question => (question.topic || "").toLowerCase()).filter(Boolean))].sort(),
    [sourceQuestions],
  );

  const normalizedSearch = search.trim().toLowerCase();
  const searchActive = normalizedSearch.length > 0;
  const topicActive = effectiveTopic !== "all" && effectiveTopic !== "";
  const anyFilterActive = searchActive || topicActive || difficultyFilter !== "all" || statusFilter !== "all";

  // Apply all filters to the source set.
  const filteredQuestions = useMemo(() => sourceQuestions.filter((question) => {
    if (difficultyFilter !== "all" && (question.difficulty || "").toLowerCase() !== difficultyFilter) return false;
    if (topicActive && (question.topic || "").toLowerCase() !== effectiveTopic.toLowerCase()) return false;
    if (statusFilter !== "all" && statusOf(progressByQuestion[question.id]) !== statusFilter) return false;
    if (searchActive) {
      const haystack = `${question.title || ""} ${question.topic || ""}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) return false;
    }
    return true;
  }), [sourceQuestions, difficultyFilter, topicActive, effectiveTopic, statusFilter, searchActive, normalizedSearch, progressByQuestion]);

  // Reset pagination to the first page whenever the filtered result set changes
  // (new search/topic/difficulty/status) so the user never lands on a hidden page.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filteredQuestions]);

  // Cap how many cards actually render. "Show more" raises visibleCount.
  const visibleQuestions = useMemo(
    () => filteredQuestions.slice(0, visibleCount),
    [filteredQuestions, visibleCount],
  );
  const hasMore = visibleCount < filteredQuestions.length;

  // Grouping rule: when neither search nor a topic filter is active, group by
  // topic so the library reads as an organized catalog. When the student is
  // actively searching or has picked a topic, show a single flat result list.
  // We group the *visible* slice so paging reveals more cards within the groups.
  const groupByTopic = !searchActive && !topicActive;
  const groupedQuestions = useMemo(() => {
    if (!groupByTopic) return [];
    const groups = new Map();
    for (const question of visibleQuestions) {
      const topic = question.topic || "Other";
      if (!groups.has(topic)) groups.set(topic, []);
      groups.get(topic).push(question);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [groupByTopic, visibleQuestions]);

  const clearAllFilters = () => {
    setSearch("");
    setDifficultyFilter("all");
    setStatusFilter("all");
    setTopicFilter("all");
    onClearTopicPack?.();
  };

  // Solved / total per topic group, so section headers read "Arrays · 0/11 solved".
  const solvedInGroup = (group) =>
    group.filter(question => statusOf(progressByQuestion[question.id]) === "solved").length;

  // Full per-topic totals from the *filtered* set (not the paginated slice), so
  // a group heading shows "Arrays · 11 problems · 2 solved" even while only some
  // of its cards are rendered yet.
  const topicTotals = useMemo(() => {
    const totals = new Map();
    for (const question of filteredQuestions) {
      const topic = question.topic || "Other";
      const entry = totals.get(topic) || { total: 0, solved: 0 };
      entry.total += 1;
      if (statusOf(progressByQuestion[question.id]) === "solved") entry.solved += 1;
      totals.set(topic, entry);
    }
    return totals;
  }, [filteredQuestions, progressByQuestion]);

  // One recommended problem in the current view gets a stronger accent: the
  // first in-progress problem, else the first not-started one.
  const recommendedId = useMemo(() => {
    const resume = filteredQuestions.find(q => statusOf(progressByQuestion[q.id]) === "in_progress");
    if (resume) return resume.id;
    const next = filteredQuestions.find(q => statusOf(progressByQuestion[q.id]) === "not_started");
    return next ? next.id : null;
  }, [filteredQuestions, progressByQuestion]);

  // Active-filter chips: each removable, so students see *why* the list is narrowed.
  const STATUS_LABELS = { not_started: "Not Started", in_progress: "In Progress", solved: "Solved" };
  const activeChips = [
    searchActive && { key: "search", label: `Search: "${search.trim()}"`, clear: () => setSearch("") },
    topicActive && {
      key: "topic",
      label: `Topic: ${titleCase(effectiveTopic)}`,
      clear: () => { setTopicFilter("all"); if (selectedTopicPack) onClearTopicPack?.(); },
    },
    difficultyFilter !== "all" && {
      key: "difficulty",
      label: `Difficulty: ${titleCase(difficultyFilter)}`,
      clear: () => setDifficultyFilter("all"),
    },
    statusFilter !== "all" && {
      key: "status",
      label: `Status: ${STATUS_LABELS[statusFilter]}`,
      clear: () => setStatusFilter("all"),
    },
  ].filter(Boolean);

  // ---- Practice Guide (driven by what's currently in view) ----
  // Topics in view + per-topic progress (solved / total) for the filtered set.
  const topicsInView = [...new Set(filteredQuestions.map(q => q.topic).filter(Boolean))];
  const topicProgress = topicsInView.map((topic) => {
    const group = filteredQuestions.filter(q => q.topic === topic);
    const solved = group.filter(q => statusOf(progressByQuestion[q.id]) === "solved").length;
    return { topic, solved, total: group.length };
  });

  // Common mistakes for the topics in view (curated copy).
  const mistakes = [...new Set(topicsInView.flatMap(topic => insightForTopic(topic).mistakes))].slice(0, 4);

  return (
    <section className="coding-page-panel quiz-bank-page">
      <header className="practice-library-header">
        <div className="practice-library-heading">
          <span className="coding-kicker">Practice Library</span>
          <h2>Practice Library</h2>
          <p>Choose a problem by topic, difficulty, or progress.</p>
        </div>
      </header>
      <ProgressStrip progressSummary={progressSummary} />
      <div className="quiz-bank-layout">
        <div className="quiz-library">
          <div className="practice-toolbar">
            <div className="practice-search">
              <FaSearch aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search problems..."
                aria-label="Search problems by title or topic"
              />
            </div>
            <div className="practice-controls compact">
              <label>Difficulty
                <select
                  className="coding-select"
                  value={difficultyFilter}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDifficultyFilter(value);
                    // Keep the parent's loaded difficulty warm when a concrete level is chosen.
                    if (value !== "all") onDifficultyChange?.(value);
                  }}
                >
                  <option value="all">All</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
              <label>Topic
                <select
                  className="coding-select"
                  value={topicActive ? effectiveTopic.toLowerCase() : "all"}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTopicFilter(value);
                    // Picking a topic here overrides any externally-set topic pack.
                    if (selectedTopicPack) onClearTopicPack?.();
                  }}
                >
                  <option value="all">All</option>
                  {topicOptions.map(topic => (
                    <option key={topic} value={topic}>{titleCase(topic)}</option>
                  ))}
                </select>
              </label>
              <label>Status
                <select
                  className="coding-select"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">All</option>
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="solved">Solved</option>
                </select>
              </label>
            </div>
          </div>
          {anyFilterActive && (
            <div className="practice-filter-chips">
              <span className="practice-chips-count">
                {filteredQuestions.length} {filteredQuestions.length === 1 ? "problem" : "problems"}
              </span>
              {activeChips.map(chip => (
                <button
                  key={chip.key}
                  type="button"
                  className="practice-chip"
                  onClick={chip.clear}
                  aria-label={`Remove filter ${chip.label}`}
                >
                  {chip.label} <span aria-hidden="true">×</span>
                </button>
              ))}
              <button type="button" className="practice-chips-clear" onClick={clearAllFilters}>
                Clear all
              </button>
            </div>
          )}
          {listLoading ? (
            <div className="daily-challenge-loading">Loading CS Navigator practice...</div>
          ) : !filteredQuestions.length ? (
            <div className="practice-empty-state">
              <strong>No problems match your filters.</strong>
              <p>Try a different topic or difficulty, or clear the filters to see everything.</p>
              {anyFilterActive && (
                <button type="button" onClick={clearAllFilters}>Clear filters</button>
              )}
            </div>
          ) : groupByTopic ? (
            <>
              <div className="practice-topic-groups">
                {groupedQuestions.map(([topic, group]) => {
                  const totals = topicTotals.get(topic) || { total: group.length, solved: solvedInGroup(group) };
                  return (
                    <section className="practice-topic-group" key={topic}>
                      <h3 className="practice-topic-heading">
                        <span className="practice-topic-name">{titleCase(topic)}</span>
                        <span className="practice-topic-dot" aria-hidden="true">·</span>
                        <span className="practice-topic-meta">{totals.total} {totals.total === 1 ? "problem" : "problems"}</span>
                        <span className="practice-topic-count">{totals.solved} solved</span>
                      </h3>
                      <div className="quiz-card-grid">
                        {group.map(question => (
                          <QuizProblemCard
                            key={question.id}
                            question={question}
                            progress={progressByQuestion[question.id]}
                            recommended={question.id === recommendedId}
                            onSelect={onSelectProblem}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
              {hasMore && (
                <div className="practice-show-more-wrap">
                  <button
                    type="button"
                    className="practice-show-more"
                    onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                  >
                    Show more
                    <span>{visibleQuestions.length} of {filteredQuestions.length}</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="practice-topic-group">
              <h3 className="practice-topic-heading">
                <span className="practice-topic-name">
                  {topicActive ? titleCase(effectiveTopic) : "Results"}
                </span>
                <span className="practice-topic-dot" aria-hidden="true">·</span>
                <span className="practice-topic-meta">
                  {filteredQuestions.length} {filteredQuestions.length === 1 ? "problem" : "problems"}
                </span>
                <span className="practice-topic-count">{solvedInGroup(filteredQuestions)} solved</span>
              </h3>
              <div className="quiz-card-grid">
                {visibleQuestions.map(question => (
                  <QuizProblemCard
                    key={question.id}
                    question={question}
                    progress={progressByQuestion[question.id]}
                    recommended={question.id === recommendedId}
                    onSelect={onSelectProblem}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="practice-show-more-wrap">
                  <button
                    type="button"
                    className="practice-show-more"
                    onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                  >
                    Show more
                    <span>{visibleQuestions.length} of {filteredQuestions.length}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="quiz-insight-panel">
          <div className="practice-guide-title">Practice Guide</div>

          <section className="practice-guide-section">
            <h3>Topics in view</h3>
            {topicsInView.length ? (
              <div className="practice-guide-chips">
                {topicsInView.map(topic => <span key={topic}>{titleCase(topic)}</span>)}
              </div>
            ) : (
              <p>No topics match the current filters.</p>
            )}
          </section>

          <section className="practice-guide-section">
            <h3>Topic progress</h3>
            {topicProgress.length ? (
              <>
                <ul className="practice-guide-progress">
                  {topicProgress.slice(0, visibleTopicCount).map(({ topic, solved, total }) => (
                    <li key={topic}>
                      <span>{titleCase(topic)}</span>
                      <strong>{solved}/{total} solved</strong>
                    </li>
                  ))}
                </ul>
                {topicProgress.length > 5 && (
                  <button
                    type="button"
                    className="practice-guide-viewall"
                    onClick={() =>
                      setVisibleTopicCount(count =>
                        count >= topicProgress.length ? 5 : Math.min(count + 5, topicProgress.length),
                      )
                    }
                  >
                    {visibleTopicCount >= topicProgress.length ? "Show less" : "Show more"}
                  </button>
                )}
              </>
            ) : (
              <p>Pick a topic or clear filters to see progress.</p>
            )}
          </section>

          <section className="practice-guide-section">
            <h3>Common mistakes</h3>
            {mistakes.length ? (
              <ul className="practice-guide-mistakes">
                {mistakes.map(item => <li key={item}>{item}</li>)}
              </ul>
            ) : (
              <p>Common mistakes appear here based on the topics you&apos;re viewing.</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
