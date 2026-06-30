import { useEffect, useMemo, useState } from "react";
import { FaFire, FaCheckCircle, FaPenFancy, FaChartLine, FaSearch, FaSlidersH } from "react-icons/fa";
import QuizProblemCard from "./QuizProblemCard";

function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1).replace("_", " ") : "";
}

// How many problem cards to render initially / reveal per "Show more" click.
// Caps the number of mounted cards so the grid stays fast as the bank grows.
const PAGE_SIZE = 20;

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];
const STATUS_OPTIONS = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "solved", label: "Solved" },
];
const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 };
const SORT_OPTIONS = [
  { value: "topic", label: "Topic order" },
  { value: "easy", label: "Easy first" },
  { value: "hard", label: "Hardest first" },
  { value: "unsolved", label: "Unsolved first" },
  { value: "attempted", label: "Attempted first" },
  { value: "az", label: "A–Z" },
];

// Toggle a value in/out of a multi-select array.
function toggleInArray(arr, value) {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
}

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

  // ---- Local filter state (multi-select) ----
  // Difficulty/topic/status are arrays of selected values (empty = no filter).
  // A topic pack opened from Interview Prep seeds the topic selection.
  const [search, setSearch] = useState("");
  const [difficultyFilters, setDifficultyFilters] = useState([]);
  const [statusFilters, setStatusFilters] = useState([]);
  const [topicFilters, setTopicFilters] = useState(selectedTopicPack ? [selectedTopicPack.toLowerCase()] : []);
  const [sortBy, setSortBy] = useState("topic");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [topicSearch, setTopicSearch] = useState("");
  // How many topic-progress rows are visible; "Show more" reveals 5 at a time.
  const [visibleTopicCount, setVisibleTopicCount] = useState(5);
  // How many problem cards are visible; "Show more" reveals PAGE_SIZE at a time.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // A topic pack opened from Interview Prep takes precedence and seeds the topic
  // selection so the page lands already filtered. Memoized so the array identity
  // is stable across renders (keeps the filter useMemo deps from thrashing).
  const effectiveTopics = useMemo(
    () => (selectedTopicPack ? [selectedTopicPack.toLowerCase()] : topicFilters),
    [selectedTopicPack, topicFilters],
  );

  // Topic options come from the whole set so the list is stable regardless of
  // the other active filters.
  const topicOptions = useMemo(
    () => [...new Set(sourceQuestions.map(question => (question.topic || "").toLowerCase()).filter(Boolean))].sort(),
    [sourceQuestions],
  );

  const normalizedSearch = search.trim().toLowerCase();
  const searchActive = normalizedSearch.length > 0;
  const topicActive = effectiveTopics.length > 0;
  const activeFilterCount =
    difficultyFilters.length + effectiveTopics.length + statusFilters.length;
  const anyFilterActive = searchActive || activeFilterCount > 0;

  // A single predicate, optionally skipping one filter group. Skipping a group
  // is how facet counts are computed: "how many would Arrays yield given the
  // OTHER active filters" ignores the topic group itself.
  const matchesFilters = useMemo(() => (question, skipGroup) => {
    const difficulty = (question.difficulty || "").toLowerCase();
    const topic = (question.topic || "").toLowerCase();
    if (skipGroup !== "difficulty" && difficultyFilters.length && !difficultyFilters.includes(difficulty)) return false;
    if (skipGroup !== "topic" && topicActive && !effectiveTopics.includes(topic)) return false;
    if (skipGroup !== "status" && statusFilters.length && !statusFilters.includes(statusOf(progressByQuestion[question.id]))) return false;
    if (searchActive) {
      const haystack = `${question.title || ""} ${question.topic || ""}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) return false;
    }
    return true;
  }, [difficultyFilters, topicActive, effectiveTopics, statusFilters, searchActive, normalizedSearch, progressByQuestion]);

  // Apply all filters (multi-select = OR within a group, AND across groups).
  const matchedQuestions = useMemo(
    () => sourceQuestions.filter(q => matchesFilters(q)),
    [sourceQuestions, matchesFilters],
  );

  // Smart facet counts: for each option, how many results it would yield given
  // the other active filters (its own group skipped). Zero-count options get
  // muted in the drawer so students don't pick dead ends.
  const facetCounts = useMemo(() => {
    const counts = { difficulty: {}, status: {}, topic: {} };
    for (const q of sourceQuestions) {
      const difficulty = (q.difficulty || "").toLowerCase();
      const topic = (q.topic || "").toLowerCase();
      const status = statusOf(progressByQuestion[q.id]);
      if (matchesFilters(q, "difficulty") && difficulty) counts.difficulty[difficulty] = (counts.difficulty[difficulty] || 0) + 1;
      if (matchesFilters(q, "status")) counts.status[status] = (counts.status[status] || 0) + 1;
      if (matchesFilters(q, "topic") && topic) counts.topic[topic] = (counts.topic[topic] || 0) + 1;
    }
    return counts;
  }, [sourceQuestions, matchesFilters, progressByQuestion]);

  // Apply the chosen sort. "topic" keeps the natural source order (grouping
  // handles topic sections); the rest reorder the flat list.
  const filteredQuestions = useMemo(() => {
    const list = [...matchedQuestions];
    const statusRank = { not_started: 0, in_progress: 1, solved: 2 };
    switch (sortBy) {
      case "easy":
        return list.sort((a, b) => (DIFFICULTY_RANK[(a.difficulty || "").toLowerCase()] ?? 9) - (DIFFICULTY_RANK[(b.difficulty || "").toLowerCase()] ?? 9));
      case "hard":
        return list.sort((a, b) => (DIFFICULTY_RANK[(b.difficulty || "").toLowerCase()] ?? -1) - (DIFFICULTY_RANK[(a.difficulty || "").toLowerCase()] ?? -1));
      case "unsolved":
        // not_started + in_progress first, solved last.
        return list.sort((a, b) => (statusRank[statusOf(progressByQuestion[a.id])]) - (statusRank[statusOf(progressByQuestion[b.id])]));
      case "attempted": {
        // in_progress first, then solved, then untouched.
        const attemptRank = { in_progress: 0, solved: 1, not_started: 2 };
        return list.sort((a, b) => attemptRank[statusOf(progressByQuestion[a.id])] - attemptRank[statusOf(progressByQuestion[b.id])]);
      }
      case "az":
        return list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      case "topic":
      default:
        return list;
    }
  }, [matchedQuestions, sortBy, progressByQuestion]);

  // Reset pagination to the first page whenever the filtered result set changes
  // (new search/topic/difficulty/status) so the user never lands on a hidden page.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filteredQuestions]);

  // While the filter drawer is open: lock body scroll and close on Escape.
  useEffect(() => {
    if (!filtersOpen) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setFiltersOpen(false); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [filtersOpen]);

  // Grouping rule: group by topic only in the default "Topic order" sort with no
  // search/topic filter. Any search, topic filter, or non-topic sort shows a
  // single flat result list.
  const groupByTopic = !searchActive && !topicActive && sortBy === "topic";

  // Build the full (unpaginated) topic groups from the whole filtered set.
  const allGroups = useMemo(() => {
    if (!groupByTopic) return [];
    const groups = new Map();
    for (const question of filteredQuestions) {
      const topic = question.topic || "Other";
      if (!groups.has(topic)) groups.set(topic, []);
      groups.get(topic).push(question);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [groupByTopic, filteredQuestions]);

  // Paginate by WHOLE groups (never split a topic): include complete groups until
  // we've shown at least `visibleCount` cards. This fixes the bug where slicing
  // the flat list left a section header with missing/partial cards.
  const groupedQuestions = useMemo(() => {
    const shown = [];
    let count = 0;
    for (const entry of allGroups) {
      if (count >= visibleCount) break;
      shown.push(entry);
      count += entry[1].length;
    }
    return shown;
  }, [allGroups, visibleCount]);

  // In flat (non-grouped) view we still slice the flat list.
  const visibleQuestions = useMemo(
    () => (groupByTopic ? [] : filteredQuestions.slice(0, visibleCount)),
    [groupByTopic, filteredQuestions, visibleCount],
  );

  // "More to show" differs by mode: more groups in topic view, more cards in flat.
  const hasMore = groupByTopic
    ? groupedQuestions.length < allGroups.length
    : visibleCount < filteredQuestions.length;

  const clearAllFilters = () => {
    setSearch("");
    setDifficultyFilters([]);
    setStatusFilters([]);
    setTopicFilters([]);
    onClearTopicPack?.();
  };

  // Picking any topic locally overrides an externally-set topic pack.
  const toggleTopic = (topic) => {
    if (selectedTopicPack) onClearTopicPack?.();
    setTopicFilters(prev => toggleInArray(selectedTopicPack ? [] : prev, topic));
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

  // Active-filter chips: one removable chip per selected value, so students see
  // *why* the list is narrowed and can peel off filters individually.
  const STATUS_LABELS = { not_started: "Not Started", in_progress: "In Progress", solved: "Solved" };
  const activeChips = [
    searchActive && { key: "search", label: `Search: "${search.trim()}"`, clear: () => setSearch("") },
    ...effectiveTopics.map(topic => ({
      key: `topic-${topic}`,
      label: titleCase(topic),
      clear: () => toggleTopic(topic),
    })),
    ...difficultyFilters.map(value => ({
      key: `difficulty-${value}`,
      label: titleCase(value),
      clear: () => setDifficultyFilters(prev => prev.filter(v => v !== value)),
    })),
    ...statusFilters.map(value => ({
      key: `status-${value}`,
      label: STATUS_LABELS[value],
      clear: () => setStatusFilters(prev => prev.filter(v => v !== value)),
    })),
  ].filter(Boolean);

  // ---- Practice Guide (driven by what's actually on screen) ----
  // "Topics in view" = topics of the cards currently rendered (the visible
  // slice), so the chips match what the student can actually see. As they click
  // "Show more", more topics surface.
  // The questions actually rendered, in either mode (flat slice or whole groups).
  const onScreenQuestions = useMemo(
    () => (groupByTopic ? groupedQuestions.flatMap(([, group]) => group) : visibleQuestions),
    [groupByTopic, groupedQuestions, visibleQuestions],
  );
  const topicsInView = useMemo(
    () => [...new Set(onScreenQuestions.map(q => q.topic).filter(Boolean))],
    [onScreenQuestions],
  );
  // Topic progress: only rows for topics that have a card on screen, but each
  // row's count is the *true* solved/total for that topic across the full
  // filtered set (so "Arrays 1/11 solved" isn't misreported as 1/3 just because
  // only 3 Arrays cards are rendered).
  const topicProgress = useMemo(() => topicsInView.map((topic) => {
    const group = filteredQuestions.filter(q => q.topic === topic);
    const solved = group.filter(q => statusOf(progressByQuestion[q.id]) === "solved").length;
    return { topic, solved, total: group.length };
  }), [topicsInView, filteredQuestions, progressByQuestion]);

  // Weakest topic: lowest solved/total ratio among the topics in view, ties
  // broken toward the larger group (more room to improve). Null until there's at
  // least one solve to compare against, so we don't shame a brand-new student.
  const weakestTopic = useMemo(() => {
    const anySolved = topicProgress.some(t => t.solved > 0);
    if (!anySolved || topicProgress.length < 2) return null;
    return [...topicProgress].sort((a, b) => {
      const ra = a.solved / a.total;
      const rb = b.solved / b.total;
      if (ra !== rb) return ra - rb;
      return b.total - a.total;
    })[0];
  }, [topicProgress]);

  // Common mistakes for the topics in view (curated copy).
  const mistakes = [...new Set(topicsInView.flatMap(topic => insightForTopic(topic).mistakes))].slice(0, 4);

  return (
    <section className="coding-page-panel quiz-bank-page">
      <header className="practice-library-header">
        <div className="practice-library-heading">
          <h2>Practice Library</h2>
          <p>Choose a problem by topic, difficulty, or progress.</p>
        </div>
        <ProgressStrip progressSummary={progressSummary} />
      </header>
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
            <button
              type="button"
              className={`practice-filters-btn${activeFilterCount ? " has-active" : ""}${filtersOpen ? " is-open" : ""}`}
              onClick={() => setFiltersOpen(open => !open)}
              aria-expanded={filtersOpen}
            >
              <FaSlidersH aria-hidden="true" />
              Filters
              {activeFilterCount > 0 && <span className="practice-filters-badge">{activeFilterCount}</span>}
            </button>
            <label className="practice-sort">
              <span>Sort</span>
              <select
                className="coding-select"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                aria-label="Sort problems"
              >
                {SORT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          {filtersOpen && (
            <div className="practice-drawer-root">
              <button
                type="button"
                className="practice-drawer-overlay"
                aria-label="Close filters"
                onClick={() => setFiltersOpen(false)}
              />
              <div className="practice-drawer" role="dialog" aria-label="Filter problems" aria-modal="true">
                <div className="practice-drawer-head">
                  <strong>Filters</strong>
                  <button type="button" className="practice-drawer-close" aria-label="Close" onClick={() => setFiltersOpen(false)}>×</button>
                </div>

                <div className="practice-drawer-body">
                  <div className="practice-filter-group">
                    <h4>Difficulty</h4>
                    <div className="practice-pill-row">
                      {DIFFICULTY_OPTIONS.map(option => {
                        const count = facetCounts.difficulty[option.value] || 0;
                        const on = difficultyFilters.includes(option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`practice-pill${on ? " is-on" : ""}${count === 0 && !on ? " is-empty" : ""}`}
                            onClick={() => {
                              setDifficultyFilters(prev => toggleInArray(prev, option.value));
                              onDifficultyChange?.(option.value);
                            }}
                          >
                            {option.label} <span className="practice-pill-count">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="practice-filter-group">
                    <h4>Status</h4>
                    <div className="practice-pill-row">
                      {STATUS_OPTIONS.map(option => {
                        const count = facetCounts.status[option.value] || 0;
                        const on = statusFilters.includes(option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`practice-pill${on ? " is-on" : ""}${count === 0 && !on ? " is-empty" : ""}`}
                            onClick={() => setStatusFilters(prev => toggleInArray(prev, option.value))}
                          >
                            {option.label} <span className="practice-pill-count">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="practice-filter-group">
                    <div className="practice-topic-head">
                      <h4>Topic</h4>
                      <div className="practice-topic-search">
                        <FaSearch aria-hidden="true" />
                        <input
                          type="search"
                          value={topicSearch}
                          onChange={(event) => setTopicSearch(event.target.value)}
                          placeholder="Search topics"
                          aria-label="Search topics"
                        />
                      </div>
                    </div>
                    <div className="practice-pill-row">
                      {topicOptions
                        .filter(topic => topic.includes(topicSearch.trim().toLowerCase()))
                        .map(topic => {
                          const count = facetCounts.topic[topic] || 0;
                          const on = effectiveTopics.includes(topic);
                          return (
                            <button
                              key={topic}
                              type="button"
                              className={`practice-pill${on ? " is-on" : ""}${count === 0 && !on ? " is-empty" : ""}`}
                              onClick={() => toggleTopic(topic)}
                            >
                              {titleCase(topic)} <span className="practice-pill-count">{count}</span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>

                <div className="practice-drawer-foot">
                  <button type="button" className="practice-panel-clear" onClick={clearAllFilters} disabled={!anyFilterActive}>
                    Clear all
                  </button>
                  <button type="button" className="practice-drawer-show" onClick={() => setFiltersOpen(false)}>
                    Show {filteredQuestions.length} {filteredQuestions.length === 1 ? "result" : "results"}
                  </button>
                </div>
              </div>
            </div>
          )}
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
              <strong>No problems match these filters.</strong>
              <p>Try removing a filter, or reset to see the whole library.</p>
              {anyFilterActive && (
                <div className="practice-empty-actions">
                  <button type="button" className="practice-empty-primary" onClick={clearAllFilters}>
                    Clear filters
                  </button>
                  <button type="button" className="practice-empty-secondary" onClick={() => { clearAllFilters(); setFiltersOpen(false); }}>
                    Show all problems
                  </button>
                </div>
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
              {(hasMore || visibleCount > PAGE_SIZE) && (
                <div className="practice-show-more-wrap">
                  {hasMore && (
                    <button
                      type="button"
                      className="practice-show-more"
                      onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                    >
                      Show more
                      <span>{onScreenQuestions.length} of {filteredQuestions.length}</span>
                    </button>
                  )}
                  {visibleCount > PAGE_SIZE && (
                    <button
                      type="button"
                      className="practice-show-less"
                      onClick={() => setVisibleCount(PAGE_SIZE)}
                    >
                      Show less
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="practice-topic-group">
              <h3 className="practice-topic-heading">
                <span className="practice-topic-name">
                  {effectiveTopics.length === 1 ? titleCase(effectiveTopics[0]) : "Results"}
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
              {(hasMore || visibleCount > PAGE_SIZE) && (
                <div className="practice-show-more-wrap">
                  {hasMore && (
                    <button
                      type="button"
                      className="practice-show-more"
                      onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                    >
                      Show more
                      <span>{visibleQuestions.length} of {filteredQuestions.length}</span>
                    </button>
                  )}
                  {visibleCount > PAGE_SIZE && (
                    <button
                      type="button"
                      className="practice-show-less"
                      onClick={() => setVisibleCount(PAGE_SIZE)}
                    >
                      Show less
                    </button>
                  )}
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

          {weakestTopic && (
            <section className="practice-guide-section">
              <h3>Focus next</h3>
              <p className="practice-guide-weakest">
                <strong>{titleCase(weakestTopic.topic)}</strong> is your weakest topic in view
                ({weakestTopic.solved}/{weakestTopic.total} solved). Try another one next.
              </p>
            </section>
          )}

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
