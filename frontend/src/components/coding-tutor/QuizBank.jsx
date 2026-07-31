import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaFire, FaCheckCircle, FaPenFancy, FaChartLine, FaSearch, FaSlidersH } from "react-icons/fa";
import QuizProblemCard from "./QuizProblemCard";
import useFocusTrap from "./useFocusTrap";

function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1).replace("_", " ") : "";
}

// How many problem cards to show per routed library page.
const PAGE_SIZE = 24;

const PRACTICE_TOPIC_ORDER = [
  "conditionals", "arrays", "math", "tuples",
  "strings", "sets", "hash maps", "matrices",
  "recursion", "stacks", "queues", "two pointers", "sliding window", "binary search",
  "prefix sums", "intervals", "graphs", "trees", "heaps", "tries",
  "dynamic programming", "disjoint sets",
];
const topicOrderIndex = (topic) => {
  const index = PRACTICE_TOPIC_ORDER.indexOf(String(topic || "").toLowerCase());
  return index === -1 ? PRACTICE_TOPIC_ORDER.length : index;
};
const sortTopics = (a, b) => topicOrderIndex(a) - topicOrderIndex(b) || String(a).localeCompare(String(b));

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
  { value: "az", label: "A-Z" },
];
const SORT_VALUES = new Set(SORT_OPTIONS.map(option => option.value));
const DIFFICULTY_VALUES = new Set(DIFFICULTY_OPTIONS.map(option => option.value));
const STATUS_VALUES = new Set(STATUS_OPTIONS.map(option => option.value));
const BEGINNER_STARTER_TOPICS = ["conditionals", "arrays", "strings", "math", "tuples", "sets", "hash maps"];

function splitParam(value, allowed = null) {
  return String(value || "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .filter(item => !allowed || allowed.has(item));
}

function pageFromParam(value) {
  const page = Number.parseInt(value || "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

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

// Parked: curated per-topic objectives + common mistakes. The "Common mistakes"
// panel that consumed this was hidden because the copy was identical for every
// user (not personalized). Kept here as seed copy for the future per-user version
// - see ROADMAP "Practice Guide: per-user common mistakes". Re-enable insightForTopic()
// and the panel render in PracticeLibrary when that work begins.
// const TOPIC_INSIGHTS = {
//   strings: {
//     objectives: ["String normalization", "Character comparison", "Edge case handling"],
//     mistakes: ["Forgetting lowercase conversion", "Ignoring spaces or punctuation", "Using extra loops when a two-pointer pass fits"],
//   },
//   arrays: {
//     objectives: ["Index tracking", "Single-pass updates", "Boundary checks"],
//     mistakes: ["Skipping the first or last item", "Mutating input unexpectedly", "Using nested loops without needing them"],
//   },
//   "two pointers": {
//     objectives: ["Pointer movement rules", "Loop stopping conditions", "Pair comparison"],
//     mistakes: ["Moving both pointers too early", "Missing equal-value cases", "Not testing short inputs"],
//   },
//   loops: {
//     objectives: ["Loop invariants", "Accumulator updates", "Manual tracing"],
//     mistakes: ["Off-by-one ranges", "Resetting counters inside loops", "Returning before the loop finishes"],
//   },
//   hashmaps: {
//     objectives: ["Frequency counting", "Lookup-first reasoning", "Key normalization"],
//     mistakes: ["Checking after overwriting values", "Using the wrong key shape", "Forgetting default counts"],
//   },
// };

// Compact one-row progress strip for the Practice Library. Same numbers as the
// big StatTiles cards (streak / solved / attempted / % complete) but inline, so
// the problem grid rises into view on a page whose job is "pick a problem".
// The Home dashboard no longer shows stat tiles; the Progress page keeps the
// full StatTiles cards (progress is the point there).
function ProgressStrip({ progressSummary }) {
  const streakDays = Number(progressSummary.displayStreak) || 0;
  const items = [
    { key: "streak", Icon: FaFire, value: streakDays > 0 ? `${streakDays}-day` : "0", label: streakDays > 0 ? "streak" : "day streak" },
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

// Parked alongside TOPIC_INSIGHTS above (see ROADMAP "Practice Guide: per-user
// common mistakes"). Re-enable when the per-user version is built.
// function insightForTopic(topic = "") {
//   const normalized = topic.toLowerCase();
//   const key = Object.keys(TOPIC_INSIGHTS).find(name => normalized.includes(name));
//   return TOPIC_INSIGHTS[key] || {
//     objectives: [`Practice ${topic || "problem"} reasoning`, "Trace examples by hand", "Test edge cases before finalizing"],
//     mistakes: ["Skipping the smallest input", "Not explaining the approach first", "Changing too much code at once"],
//   };
// }

export default function QuizBank({
  questions,
  allQuestions = [],
  progressByQuestion,
  listLoading,
  progressSummary,
  onDifficultyChange,
  onSelectProblem,
  initialTopic = null,
  onConsumeInitialTopic,
  // Server-computed per-topic mastery (GET /api/coding/mastery). Null until it
  // loads, and `weakest` is null until some topic has enough attempts to score.
  mastery = null,
  adaptivePractice = null,
  onOpenLessonReview = null,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  // The full cross-difficulty set is the source for browsing/filtering. The
  // parent loads all difficulties into allQuestions; fall back to the current
  // difficulty's `questions` only if that hasn't arrived yet.
  const sourceQuestions = allQuestions.length ? allQuestions : questions;

  // ---- Local filter state (multi-select) ----
  // Difficulty/topic/status are arrays of selected values (empty = no filter).
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const search = queryParams.get("q") || "";
  const difficultyFilters = splitParam(queryParams.get("difficulty"), DIFFICULTY_VALUES);
  const statusFilters = splitParam(queryParams.get("status"), STATUS_VALUES);
  const topicFilters = splitParam(queryParams.get("topic"));
  const requestedSort = queryParams.get("sort") || "topic";
  const sortBy = SORT_VALUES.has(requestedSort) ? requestedSort : "topic";
  const requestedPage = pageFromParam(queryParams.get("page"));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [topicSearch, setTopicSearch] = useState("");
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const drawerRef = useFocusTrap(filtersOpen, { onEscape: closeFilters });
  // (Topic-progress paging removed - the list is now a collapsed <details> that shows
  // every topic at once when opened, so an incremental "show 5 more" no longer applies.)
  // How many problem cards are visible; "Show more" reveals PAGE_SIZE at a time.
  // The active topic selection drives filtering. Kept as its own name so the
  // downstream filter logic reads clearly.
  const effectiveTopics = topicFilters;

  const updateQuery = useCallback((updates, { replace = false } = {}) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (Array.isArray(value)) {
        if (value.length) next.set(key, value.join(","));
        else next.delete(key);
      } else if (value == null || value === "" || (key === "page" && Number(value) <= 1)) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    }
    const searchText = next.toString();
    navigate({
      pathname: location.pathname,
      search: searchText ? `?${searchText}` : "",
    }, { replace });
  }, [location.pathname, location.search, navigate]);

  const updateFilter = useCallback((updates, options = {}) => {
    updateQuery({ ...updates, page: 1 }, options);
  }, [updateQuery]);

  const toggleListFilter = useCallback((key, current, value) => {
    updateFilter({ [key]: toggleInArray(current, value) });
  }, [updateFilter]);

  // Deep-link/recommended-focus entry: pre-select that topic filter if the library
  // has it. Keep the drawer closed; the active chip already explains why the list
  // is narrowed, and opening the drawer makes the handoff feel unfinished.
  useEffect(() => {
    if (!initialTopic) return;
    const wanted = initialTopic.toLowerCase();
    const match = [...new Set(sourceQuestions.map(q => (q.topic || "").toLowerCase()))].find(t => t === wanted);
    if (match) {
      updateFilter({ topic: [match] }, { replace: true });
      setFiltersOpen(false);
    }
    onConsumeInitialTopic?.();
  }, [initialTopic, sourceQuestions, onConsumeInitialTopic, updateFilter]);

  // Topic options come from the whole set so the list is stable regardless of
  // the other active filters.
  const topicOptions = useMemo(
    () => [...new Set(sourceQuestions.map(question => (question.topic || "").toLowerCase()).filter(Boolean))].sort(sortTopics),
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

  // Grouping rule: group by topic only in the default "Topic order" sort with no
  // search/topic filter. Any search, topic filter, or non-topic sort shows a
  // single flat result list.
  const groupByTopic = !searchActive && !topicActive && sortBy === "topic";

  const topicPages = useMemo(() => {
    if (!groupByTopic) return [];
    const groups = new Map();
    for (const question of filteredQuestions) {
      const topic = question.topic || "Other";
      if (!groups.has(topic)) groups.set(topic, []);
      groups.get(topic).push(question);
    }
    const orderedGroups = [...groups.entries()].sort((a, b) => sortTopics(a[0], b[0]));
    const pages = [];
    let page = [];
    let count = 0;
    for (const group of orderedGroups) {
      const groupSize = group[1].length;
      if (page.length && count + groupSize > PAGE_SIZE) {
        pages.push(page);
        page = [];
        count = 0;
      }
      page.push(group);
      count += groupSize;
    }
    if (page.length) pages.push(page);
    return pages;
  }, [groupByTopic, filteredQuestions]);

  const totalPages = groupByTopic
    ? Math.max(1, topicPages.length)
    : Math.max(1, Math.ceil(filteredQuestions.length / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageGroups = useMemo(
    () => (groupByTopic ? topicPages[currentPage - 1] || [] : []),
    [currentPage, groupByTopic, topicPages],
  );
  const paginatedQuestions = useMemo(
    () => {
      if (groupByTopic) return pageGroups.flatMap(([, group]) => group);
      const start = filteredQuestions.length ? (currentPage - 1) * PAGE_SIZE : 0;
      return filteredQuestions.slice(start, start + PAGE_SIZE);
    },
    [currentPage, filteredQuestions, groupByTopic, pageGroups],
  );
  const pageStart = useMemo(() => {
    if (!filteredQuestions.length) return 0;
    if (!groupByTopic) return (currentPage - 1) * PAGE_SIZE;
    return topicPages
      .slice(0, currentPage - 1)
      .reduce((sum, groups) => sum + groups.reduce((inner, [, group]) => inner + group.length, 0), 0);
  }, [currentPage, filteredQuestions.length, groupByTopic, topicPages]);
  const pageEnd = Math.min(pageStart + paginatedQuestions.length, filteredQuestions.length);

  const paginationPages = useMemo(() => {
    const pages = new Set([1, totalPages]);
    for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
      if (page >= 1 && page <= totalPages) pages.add(page);
    }
    return [...pages].sort((a, b) => a - b);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (requestedPage > totalPages) {
      updateQuery({ page: totalPages }, { replace: true });
    }
  }, [requestedPage, totalPages, updateQuery]);

  const clearAllFilters = () => {
    updateFilter({ q: "", difficulty: [], status: [], topic: [] });
  };

  const toggleTopic = (topic) => {
    toggleListFilter("topic", effectiveTopics, topic);
  };

  const goToPage = (page) => {
    updateQuery({ page });
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
    searchActive && { key: "search", label: `Search: "${search.trim()}"`, clear: () => updateFilter({ q: "" }) },
    ...effectiveTopics.map(topic => ({
      key: `topic-${topic}`,
      label: titleCase(topic),
      clear: () => toggleTopic(topic),
    })),
    ...difficultyFilters.map(value => ({
      key: `difficulty-${value}`,
      label: titleCase(value),
      clear: () => updateFilter({ difficulty: difficultyFilters.filter(v => v !== value) }),
    })),
    ...statusFilters.map(value => ({
      key: `status-${value}`,
      label: STATUS_LABELS[value],
      clear: () => updateFilter({ status: statusFilters.filter(v => v !== value) }),
    })),
  ].filter(Boolean);

  // ---- Practice Guide (driven by what's actually on screen) ----
  // "Topics in view" = topics of the cards currently rendered on this page, so
  // the chips match what the student can actually see.
  // The questions actually rendered, in either mode (flat page or topic groups).
  const onScreenQuestions = useMemo(
    () => (groupByTopic ? pageGroups.flatMap(([, group]) => group) : paginatedQuestions),
    [groupByTopic, pageGroups, paginatedQuestions],
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

  // Fallback weakest topic: lowest solved/total ratio among the topics in view.
  // Only used before the server has enough attempts to say anything real - a ratio
  // can't tell a first-try solve from a six-attempt grind with three hints open.
  const weakestByRatio = useMemo(() => {
    const anySolved = topicProgress.some(t => t.solved > 0);
    if (!anySolved || topicProgress.length < 2) return null;
    return [...topicProgress].sort((a, b) => {
      const ra = a.solved / a.total;
      const rb = b.solved / b.total;
      if (ra !== rb) return ra - rb;
      return b.total - a.total;
    })[0];
  }, [topicProgress]);

  // The real answer, when we have it: computed server-side from the attempt log,
  // weighted by difficulty, attempts-to-solve, hints used, and recency. Comes with
  // a reason, because a recommendation that won't explain itself gets ignored.
  const masteryWeakest = mastery?.weakest || null;
  const mistakePatterns = Array.isArray(mastery?.mistake_patterns) ? mastery.mistake_patterns : [];
  const adaptiveRecommendation = adaptivePractice?.recommendation || null;
  const adaptiveReviewSignal = adaptivePractice?.review_signal || null;
  const adaptiveReady = adaptiveRecommendation?.action === "ladder" && adaptiveRecommendation?.ladder_ready;
  const beginnerStarterActive =
    difficultyFilters.length === 1 &&
    difficultyFilters[0] === "easy" &&
    BEGINNER_STARTER_TOPICS.every(topic => effectiveTopics.includes(topic));
  const starterCount = sourceQuestions.filter((question) => {
    const topic = String(question.topic || "").toLowerCase();
    const difficulty = String(question.difficulty || "").toLowerCase();
    return difficulty === "easy" && BEGINNER_STARTER_TOPICS.includes(topic);
  }).length;
  const applyBeginnerStarter = () => {
    updateFilter({
      difficulty: ["easy"],
      topic: BEGINNER_STARTER_TOPICS,
      status: [],
      sort: "topic",
    });
    setFiltersOpen(false);
  };

  const guideRecommendation = adaptiveReviewSignal
    ? {
      label: "Recommended next",
      title: adaptiveReviewSignal.title || "Review recent errors",
      band: titleCase(adaptiveReviewSignal.error_class || "Review"),
      bandClass: "shaky",
      reason: adaptiveReviewSignal.reason,
      cta: "Open review lesson",
      onClick: () => onOpenLessonReview?.(adaptiveReviewSignal),
    }
    : adaptiveRecommendation?.topic
      ? {
        label: "Recommended next",
        title: titleCase(adaptiveRecommendation.topic),
        band: adaptiveReady ? titleCase(adaptiveRecommendation.difficulty) : "Review",
        bandClass: adaptiveReady ? "steady" : "shaky",
        reason: adaptiveRecommendation.reason,
        cta: adaptiveReady
          ? `Open ${titleCase(adaptiveRecommendation.difficulty)} ladder step`
          : `Review ${titleCase(adaptiveRecommendation.topic)}`,
        onClick: () => {
          updateFilter({
            topic: [adaptiveRecommendation.topic],
            ...(adaptiveReady && adaptiveRecommendation.difficulty ? { difficulty: [adaptiveRecommendation.difficulty] } : {}),
          });
          setFiltersOpen(false);
        },
      }
      : masteryWeakest
        ? {
          label: "Recommended next",
          title: titleCase(masteryWeakest.topic),
          band: Math.round(masteryWeakest.score),
          bandClass: masteryWeakest.band,
          reason: masteryWeakest.reason,
          cta: `Practice ${titleCase(masteryWeakest.topic)}`,
          onClick: () => {
            updateFilter({ topic: [masteryWeakest.topic] });
            setFiltersOpen(false);
          },
        }
        : weakestByRatio
          ? {
            label: "Recommended next",
            title: titleCase(weakestByRatio.topic),
            band: `${weakestByRatio.solved}/${weakestByRatio.total}`,
            bandClass: "shaky",
            reason: `${titleCase(weakestByRatio.topic)} has the lowest solved count in this view. Try one more problem there.`,
            cta: `Practice ${titleCase(weakestByRatio.topic)}`,
            onClick: () => {
              updateFilter({ topic: [weakestByRatio.topic] });
              setFiltersOpen(false);
            },
          }
          : {
            label: "Recommended next",
            title: "Beginner starter set",
            band: "Easy",
            bandClass: "steady",
            reason: "A short COSC 101/102-friendly set is ready when you want a low-pressure warmup.",
            cta: "Open beginner starter set",
            onClick: applyBeginnerStarter,
          };

  // Per-topic mastery scores, keyed for a quick lookup in the topic-progress list.
  const scoreByTopic = useMemo(() => {
    const map = new Map();
    for (const row of mastery?.topics || []) {
      if (row.scored && row.score !== null) map.set(row.topic, row);
    }
    return map;
  }, [mastery]);

  // NOTE: the "Common mistakes" panel was parked because its copy was identical for
  // every student. `masteryWeakest.reason` is the per-student version - every claim
  // in it is drawn from a counted field in the attempt log (dominant error class,
  // average attempts-to-solve, average hints used), never invented copy.

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
                onChange={(event) => updateFilter({ q: event.target.value }, { replace: true })}
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
                onChange={(event) => updateFilter({ sort: event.target.value })}
                aria-label="Sort problems"
              >
                {SORT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="practice-starter-strip" aria-label="Beginner practice shortcut">
            <div>
              <strong>New here?</strong>
              <span>Use a small Easy starter set before opening the full library.</span>
            </div>
            <button
              type="button"
              className={beginnerStarterActive ? "is-active" : ""}
              onClick={applyBeginnerStarter}
            >
              {beginnerStarterActive ? "Starter set active" : `Beginner starter set (${starterCount})`}
            </button>
          </div>

          {filtersOpen && (
            <div className="practice-drawer-root">
              <button
                type="button"
                className="practice-drawer-overlay"
                aria-label="Close filters"
                onClick={closeFilters}
              />
              <div
                ref={drawerRef}
                className="practice-drawer"
                role="dialog"
                aria-modal="true"
                aria-labelledby="practice-filter-title"
                tabIndex={-1}
              >
                <div className="practice-drawer-head">
                  <strong id="practice-filter-title">Filters</strong>
                  <button type="button" className="practice-drawer-close" aria-label="Close filters" onClick={closeFilters} data-autofocus>x</button>
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
                              toggleListFilter("difficulty", difficultyFilters, option.value);
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
                            onClick={() => toggleListFilter("status", statusFilters, option.value)}
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
                  <button type="button" className="practice-drawer-show" onClick={closeFilters}>
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
                  {chip.label} <span aria-hidden="true">x</span>
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
                {pageGroups.map(([topic, group]) => {
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
                {paginatedQuestions.map(question => (
                  <QuizProblemCard
                    key={question.id}
                    question={question}
                    progress={progressByQuestion[question.id]}
                    recommended={question.id === recommendedId}
                    onSelect={onSelectProblem}
                  />
                ))}
              </div>
            </div>
          )}
          {!listLoading && filteredQuestions.length > PAGE_SIZE && (
            <nav className="practice-pagination" aria-label="Practice problem pages">
              <span className="practice-pagination-summary">
                Showing {pageStart + 1}-{pageEnd} of {filteredQuestions.length} problems
              </span>
              <div className="practice-pagination-controls">
                <button
                  type="button"
                  className="practice-page-btn"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  Previous
                </button>
                {paginationPages.map((page, index) => {
                  const previous = paginationPages[index - 1];
                  const showGap = previous && page - previous > 1;
                  return (
                    <span className="practice-page-slot" key={page}>
                      {showGap && <span className="practice-page-gap" aria-hidden="true">...</span>}
                      <button
                        type="button"
                        className={`practice-page-btn${page === currentPage ? " is-active" : ""}`}
                        onClick={() => goToPage(page)}
                        aria-current={page === currentPage ? "page" : undefined}
                      >
                        {page}
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  className="practice-page-btn"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </div>
        <aside className="quiz-insight-panel">
          <div className="practice-guide-title">Practice Guide</div>

          {guideRecommendation && (
            <section className="practice-guide-section">
              <h3>{guideRecommendation.label}</h3>
              <div className="practice-guide-focus">
                <p className="practice-guide-weakest is-mastery">
                  <strong>{guideRecommendation.title}</strong>
                  <span className={`practice-mastery-band is-${guideRecommendation.bandClass}`}>
                    {guideRecommendation.band}
                  </span>
                </p>
                <p className="practice-guide-reason">{guideRecommendation.reason}</p>
                <button
                  type="button"
                  className="practice-guide-focus-cta"
                  onClick={guideRecommendation.onClick}
                >
                  {guideRecommendation.cta}
                </button>
              </div>
            </section>
          )}

          <section className="practice-guide-section">
            <h3>Your recent patterns</h3>
            {mistakePatterns.length ? (
              <ul className="practice-guide-patterns">
                {mistakePatterns.map(pattern => (
                  <li key={`${pattern.topic}-${pattern.error_class}`}>
                    <div className="practice-guide-pattern-head">
                      <strong>{pattern.title || `${titleCase(pattern.topic)} pattern`}</strong>
                      <span>{pattern.count}x</span>
                    </div>
                    <p>{pattern.summary}</p>
                    <small>{pattern.next_step}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="practice-guide-unlocked-note">
                Run a few tests and this will unlock patterns from your own attempts.
              </p>
            )}
          </section>

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

          {/* Topic progress is COLLAPSED by default. The guide's job is to answer
              "what should I do next", and one clear answer does that better than a
              23-row table does - this list is reference, not the headline. Collapsing
              it also keeps the panel a fixed height as the library grows toward 500
              questions across 23+ topics, instead of scrolling ever further off-screen. */}
          {topicProgress.length ? (
            <details className="practice-guide-topics">
              <summary>
                All topics
                <span className="practice-guide-topics-count">{topicProgress.length}</span>
              </summary>
              <ul className="practice-guide-progress">
                {topicProgress.map(({ topic, solved, total }) => {
                  const scored = scoreByTopic.get(topic);
                  return (
                    <li key={topic}>
                      <span>{titleCase(topic)}</span>
                      <strong>
                        {solved}/{total}
                        {scored && (
                          <span className={`practice-mastery-band is-${scored.band}`}>
                            {Math.round(scored.score)}
                          </span>
                        )}
                      </strong>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : (
            <section className="practice-guide-section">
              <h3>Topic progress</h3>
              <p>Pick a topic or clear filters to see progress.</p>
            </section>
          )}

          {/* The old "Common mistakes" panel is now unnecessary: its per-user version
              IS the reason line under Focus next, generated from this student's own
              attempt log rather than the identical curated copy that got it parked. */}
        </aside>
      </div>
    </section>
  );
}

