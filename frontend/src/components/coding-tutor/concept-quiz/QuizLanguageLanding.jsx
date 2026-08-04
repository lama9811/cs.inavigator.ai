import { useEffect, useMemo, useState } from "react";
import {
  FaChevronDown,
  FaLock,
  FaListUl,
  FaKeyboard,
  FaArrowsAltV,
  FaCheckCircle,
  FaTimesCircle,
  FaRegCircle,
  FaTrophy,
  FaHourglassHalf,
  FaRedo,
} from "react-icons/fa";
import {
  fetchQuizCategories,
  fetchQuizProgress,
  fetchQuizQuestion,
  fetchQuizQuestions,
  gradeMistakeQuiz,
} from "./conceptQuizApi";
import { LANGUAGE_VISUALS } from "./languageVisuals";
import {
  readCategoryProgress,
  readQuizDraftAnswers,
  saveMistakeBankResult,
} from "./conceptQuizProgress";
import {
  AnswerPanel,
  ImmediateFeedback,
} from "./QuizRunner";

// Language landing page: a progress hero plus an ACCORDION of categories. Each
// category row expands inline to reveal its question table (name | type | status).
// Selecting a question routes into the runner. Per-category scores + per-question
// status come from the local progress store (saved on Submit).

// A category counts toward the hero's "complete" tally once its best score
// passes this bar.
const PASS_THRESHOLD = 0.7;

const TOPIC_ALIASES = {
  arrays: "lists",
  array: "lists",
  stacks: "stacks",
  stack: "stacks",
  queues: "queues",
  queue: "queues",
  "hash maps": "hash-maps-sets",
  "hash map": "hash-maps-sets",
  maps: "hash-maps-sets",
  map: "hash-maps-sets",
  sets: "hash-maps-sets",
  "linked lists": "linked-lists",
  "linked list": "linked-lists",
  recursion: "recursion-patterns",
  "binary search": "binary-search",
  "two pointers": "two-pointers",
  "sliding window": "sliding-window",
  trees: "trees",
  graphs: "graphs",
};

function categoryForMastery(topic, categories) {
  const normalized = String(topic || "").toLowerCase().trim();
  // An empty topic must match nothing. Otherwise `category.id.includes("")` is
  // always true and we'd spuriously return the first category when mastery is
  // absent, leaving adaptiveCategory set with no real signal.
  if (!normalized) return undefined;
  const alias = TOPIC_ALIASES[normalized] || normalized.replaceAll(" ", "-");
  return categories.find((category) =>
    category.id === alias ||
    category.id.includes(alias) ||
    alias.includes(category.id)
  );
}

function mergeProgress(local, remote) {
  if (!local) return remote || null;
  if (!remote) return local;
  const localBest = local.best;
  const remoteBest = remote.best;
  const best = !localBest || (remoteBest?.score ?? -1) > (localBest.score ?? -1)
    ? remoteBest
    : localBest;
  const localAt = Number(local.last?.at || 0);
  const remoteAt = Date.parse(remote.last?.at || "") || 0;
  const localIsNewer = localAt > remoteAt;
  return {
    ...remote,
    best,
    last: localIsNewer ? local.last : remote.last,
    // Per-question status follows the same recency call as `last`, so a stale
    // side never clobbers the newer attempt's answers. Fall back to whichever
    // map exists when one is missing.
    questions: localIsNewer
      ? { ...(remote.questions || {}), ...(local.questions || {}) }
      : { ...(local.questions || {}), ...(remote.questions || {}) },
  };
}

const TRACKS = [
  {
    id: "beginner",
    label: "Beginner",
    description: "Core concepts plus your first algorithm and debugging practice.",
  },
  {
    id: "intermediate",
    label: "Intermediate",
    description: "Multi-step problems and language-specific concepts.",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Data structures and interview-style patterns, explained step by step.",
  },
];

const CLOSED_TRACKS = Object.fromEntries(TRACKS.map((track) => [track.id, false]));

function orderTrackCategories(trackId, categories) {
  if (trackId !== "intermediate") return categories;

  const algorithmPartTwo = categories.find(
    (category) => category.id === "algorithm-problems-2"
  );
  const debugPartTwo = categories.find((category) => category.id === "debug-2");
  const ordered = categories.filter(
    (category) =>
      category.id !== "algorithm-problems-2" && category.id !== "debug-2"
  );

  if (algorithmPartTwo) {
    ordered.splice(Math.min(2, ordered.length), 0, algorithmPartTwo);
  }
  if (debugPartTwo) {
    ordered.splice(Math.min(5, ordered.length), 0, debugPartTwo);
  }
  return ordered;
}

// Per-kind badge meta: a color group (drives the badge palette), an icon, and a
// label. Grouping MCQ variants together and giving each type its own color +
// icon makes the Type column scannable at a glance.
const KIND_META = {
  "mcq-output": { group: "mcq", label: "Multiple choice", Icon: FaListUl },
  "mcq-behavior": { group: "mcq", label: "Multiple choice", Icon: FaListUl },
  typein: { group: "typein", label: "Type-in", Icon: FaKeyboard },
  parsons: { group: "parsons", label: "Drag & drop", Icon: FaArrowsAltV },
};

function hasDraftAnswer(answer) {
  return (
    answer != null &&
    (answer.choice_index != null ||
      (answer.text != null && answer.text.trim() !== "") ||
      (answer.order != null && answer.order.length > 0))
  );
}

// The inner question table shown when a category is expanded. Loads that
// category's questions on first open and caches them in the parent.
function CategoryQuestions({
  apiBase,
  language,
  category,
  cached,
  progress,
  onLoaded,
  onOpenQuestion,
}) {
  const statusByQuestion = progress?.questions || {};
  const draftAnswers = readQuizDraftAnswers(language, category.id);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const questions = cached || [];

  useEffect(() => {
    if (cached) return;
    let alive = true;
    setLoading(true);
    setError("");
    fetchQuizQuestions(apiBase, language, category.id)
      .then((data) => {
        if (alive) onLoaded(category.id, data.questions || []);
      })
      .catch((err) => {
        if (alive) setError(err.message || "Could not load questions.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, language, category.id]);

  if (loading) return <p className="cq-loading cq-cat-loading">Loading questions…</p>;
  if (error) return <p className="cq-error">{error}</p>;

  return (
    <table className="cq-question-table">
      <thead>
        <tr>
          <th>Problem Name</th>
          <th>Type</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {questions.map((q) => (
          <tr key={q.id}>
            <td>
              <button
                type="button"
                className="cq-question-link"
                onClick={() => onOpenQuestion(category.id, q.id)}
              >
                {q.title || q.prompt}
              </button>
            </td>
            <td>
              {(() => {
                const meta = KIND_META[q.kind] || {
                  group: "mcq",
                  label: "Question",
                  Icon: FaListUl,
                };
                const BadgeIcon = meta.Icon;
                return (
                  <span className={`cq-question-kind group-${meta.group}`}>
                    <BadgeIcon aria-hidden="true" />
                    {meta.label}
                  </span>
                );
              })()}
            </td>
            <td className="cq-question-status">
              {(() => {
                const status = statusByQuestion[q.id]; // "correct" | "incorrect" | undefined
                if (hasDraftAnswer(draftAnswers[q.id])) {
                  return (
                    <span className="cq-status-icon in-progress" title="In progress">
                      <FaHourglassHalf aria-label="In progress" />
                    </span>
                  );
                }
                if (status === "correct") {
                  return (
                    <span className="cq-status-icon correct" title="Passed">
                      <FaCheckCircle aria-label="Passed" />
                    </span>
                  );
                }
                if (status === "incorrect") {
                  return (
                    <span className="cq-status-icon incorrect" title="Missed">
                      <FaTimesCircle aria-label="Missed" />
                    </span>
                  );
                }
                return (
                  <span className="cq-status-icon" title="Not started">
                    <FaRegCircle aria-label="Not started" />
                  </span>
                );
              })()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function seededShuffle(list, seed) {
  const arr = list.map((value, index) => ({ value, index }));
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  }
  for (let i = arr.length - 1; i > 0; i -= 1) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const j = h % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.map((item) => item.value);
}

function isMistakeAnswerComplete(answer) {
  return (
    answer != null &&
    (answer.choice_index != null ||
      (answer.text != null && answer.text.trim() !== "") ||
      (answer.order != null && answer.order.length > 0))
  );
}

function mistakeChoiceOrderFor(question, seed) {
  if (question?.kind !== "mcq-output" && question?.kind !== "mcq-behavior") return [];
  return seededShuffle(
    question.choices.map((_, index) => index),
    `${seed}:${question.id}`
  );
}

function formatMistakeAnswer(value) {
  if (Array.isArray(value)) return value.join("\n");
  if (value == null || value === "") return "No answer";
  return String(value);
}

function mistakeKey(item) {
  return `${item.category}:${item.question_id || item.id}`;
}

function MistakeBankQuiz({
  apiBase,
  language,
  mistakes,
  onProgressRefresh,
  onOpenQuestion,
}) {
  const [expanded, setExpanded] = useState(false);
  const [started, setStarted] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const seed = useMemo(
    () => `mistake-bank:${language}:${mistakes.map(mistakeKey).join("|")}`,
    [language, mistakes]
  );
  const current = questions[index] || null;
  const currentKey = current ? `${current.category}:${current.id}` : "";
  const currentAnswer = currentKey ? answers[currentKey] : null;
  const answeredCount = questions.filter((question) =>
    isMistakeAnswerComplete(answers[`${question.category}:${question.id}`])
  ).length;
  const checkedCount = questions.filter(
    (question) => answers[`${question.category}:${question.id}`]?.checked
  ).length;
  const canSubmit = questions.length > 0 && checkedCount === questions.length;

  const loadQuestions = async () => {
    if (questions.length) return questions;
    setLoading(true);
    setError("");
    try {
      const loaded = await Promise.all(
        mistakes.map(async (mistake) => {
          const question = await fetchQuizQuestion(
            apiBase,
            language,
            mistake.category,
            mistake.question_id
          );
          return {
            ...question,
            category: mistake.category,
            category_label: mistake.category.replaceAll("-", " "),
          };
        })
      );
      setQuestions(loaded);
      setIndex(0);
      return loaded;
    } catch (err) {
      setError(err.message || "Could not load the wrong-answer quiz yet.");
      return [];
    } finally {
      setLoading(false);
    }
  };

  const startQuiz = async () => {
    setStarted(true);
    setResult(null);
    await loadQuestions();
  };

  const updateCurrentAnswer = (patch) => {
    if (!current) return;
    const isMcq = current.kind === "mcq-output" || current.kind === "mcq-behavior";
    setAnswers((prev) => ({
      ...prev,
      [currentKey]: {
        ...(prev[currentKey] || {}),
        ...patch,
        checked: isMcq ? true : Boolean(patch.checked),
      },
    }));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const payloadAnswers = questions.map((question) => {
        const answer = { ...(answers[`${question.category}:${question.id}`] || {}) };
        delete answer.checked;
        delete answer.display_index;
        return {
          category: question.category,
          question_id: question.id,
          ...answer,
        };
      });
      const grade = await gradeMistakeQuiz(apiBase, { language, answers: payloadAnswers });
      saveMistakeBankResult(language, grade);
      setResult(grade);
      await onProgressRefresh?.();
    } catch (err) {
      setError(err.message || "Could not submit the wrong-answer quiz yet.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!mistakes.length) return null;

  return (
    <section className={"cq-track-group cq-mistake-bank" + (expanded ? " open" : "")}>
      <button
        type="button"
        className="cq-track-toggle"
        aria-expanded={expanded}
        aria-controls="cq-mistake-bank-content"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="cq-track-badge is-mistakes">Wrong answers</span>
        <span className="cq-track-copy">
          <strong>Practice the questions you missed</strong>
          <span>Hidden until there are real missed questions from this language.</span>
        </span>
        <span className="cq-track-stats">
          <strong>{mistakes.length}</strong>
          <small>to retry</small>
        </span>
        <FaChevronDown className="cq-track-chevron" aria-hidden="true" />
      </button>

      {expanded ? (
        <div className="cq-track-content cq-mistake-bank-content" id="cq-mistake-bank-content">
          {!started ? (
            <>
              <div className="cq-mistake-bank-intro">
                <div>
                  <h4>Turn misses into a focused mini-quiz</h4>
                  <p>
                    This pulls missed questions from Beginner, Intermediate, and Advanced.
                    When you fix one, the original category updates too.
                  </p>
                </div>
                <button type="button" className="cq-btn cq-btn-primary" onClick={startQuiz}>
                  <FaRedo aria-hidden="true" /> Start wrong-answer quiz
                </button>
              </div>
              <div className="cq-mistake-bank-list">
                {mistakes.slice(0, 8).map((mistake) => (
                  <article key={mistakeKey(mistake)}>
                    <small>{mistake.category.replaceAll("-", " ")}</small>
                    <strong>{mistake.title}</strong>
                    <button
                      type="button"
                      className="cq-question-link"
                      onClick={() => onOpenQuestion(mistake.category, mistake.question_id)}
                    >
                      Open original question
                    </button>
                  </article>
                ))}
              </div>
            </>
          ) : null}

          {started && loading ? <p className="cq-loading">Loading wrong-answer quiz...</p> : null}
          {error ? <p className="cq-error">{error}</p> : null}

          {started && result ? (
            <div className="cq-mistake-bank-result">
              <span className="cq-hero-eyebrow">Retry complete</span>
              <h4>
                {result.correct}/{result.total} fixed this round
              </h4>
              <div className="cq-mistake-bank-review">
                {(result.results || []).map((item) => (
                  <article
                    key={`${item.category}:${item.question_id}`}
                    className={item.correct ? "correct" : "incorrect"}
                  >
                    <strong>{item.category.replaceAll("-", " ")}</strong>
                    <span>{item.correct ? "Fixed" : "Still needs a look"}</span>
                    {!item.correct ? (
                      <small>Correct answer: {formatMistakeAnswer(item.correct_answer)}</small>
                    ) : null}
                  </article>
                ))}
              </div>
              <button
                type="button"
                className="cq-btn cq-btn-secondary"
                onClick={() => {
                  setStarted(false);
                  setQuestions([]);
                  setAnswers({});
                  setResult(null);
                  setIndex(0);
                }}
              >
                Back to mistake bank
              </button>
            </div>
          ) : null}

          {started && !loading && !result && current ? (
            <div className="cq-mistake-bank-runner">
              <div className="cq-mistake-bank-question-head">
                <div>
                  <span className="cq-hero-eyebrow">
                    {current.category_label} · Question {index + 1} of {questions.length}
                  </span>
                  <h4>{current.title}</h4>
                  <p>{current.prompt}</p>
                </div>
                <span>
                  {answeredCount}/{questions.length} answered · {checkedCount}/{questions.length} checked
                </span>
              </div>

              {current.code ? (
                <pre className="cq-code-block">
                  <code>{current.code}</code>
                </pre>
              ) : null}

              <AnswerPanel
                question={current}
                answer={currentAnswer}
                onAnswer={updateCurrentAnswer}
                choiceOrder={mistakeChoiceOrderFor(current, seed)}
              />

              {currentAnswer?.checked ? (
                <ImmediateFeedback question={current} answer={currentAnswer} />
              ) : null}

              <div className="cq-mistake-bank-controls">
                <button
                  type="button"
                  className="cq-btn cq-btn-secondary"
                  disabled={index === 0}
                  onClick={() => setIndex((value) => Math.max(0, value - 1))}
                >
                  Previous
                </button>
                {current.kind !== "mcq-output" && current.kind !== "mcq-behavior" ? (
                  <button
                    type="button"
                    className="cq-btn cq-btn-secondary"
                    disabled={!isMistakeAnswerComplete(currentAnswer)}
                    onClick={() => updateCurrentAnswer({ checked: true })}
                  >
                    Check answer
                  </button>
                ) : null}
                <button
                  type="button"
                  className="cq-btn cq-btn-secondary"
                  disabled={index >= questions.length - 1}
                  onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}
                >
                  Next
                </button>
                <button
                  type="button"
                  className="cq-btn cq-btn-primary"
                  disabled={!canSubmit || submitting}
                  onClick={submit}
                >
                  {submitting ? "Saving..." : "Submit retry quiz"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function QuizLanguageLanding({
  apiBase,
  language,
  languageLabel,
  mastery,
  onOpenQuestion,
}) {
  const [categories, setCategories] = useState([]);
  const [openId, setOpenId] = useState("");
  const [openTracks, setOpenTracks] = useState({
    ...CLOSED_TRACKS,
    beginner: true,
  });
  // Per-category question cache: { [categoryId]: question[] }.
  const [questionsByCat, setQuestionsByCat] = useState({});
  const [loadingCats, setLoadingCats] = useState(true);
  const [error, setError] = useState("");
  const [serverProgress, setServerProgress] = useState({ categories: [], mistakes: [] });

  const refreshProgress = () =>
    fetchQuizProgress(apiBase, language)
      .then((data) => {
        setServerProgress(data || { categories: [], mistakes: [] });
      })
      .catch(() => {
        // Local progress remains available when sync is temporarily offline.
        setServerProgress({ categories: [], mistakes: [] });
      });

  // Load the available shared and language-specific categories.
  useEffect(() => {
    let alive = true;
    setLoadingCats(true);
    setError("");
    setQuestionsByCat({});
    fetchQuizCategories(apiBase, language)
      .then((data) => {
        if (!alive) return;
        const cats = (data.categories || []).filter((category) => !category.lesson_only);
        setCategories(cats);
        setOpenTracks({ ...CLOSED_TRACKS, beginner: true });
        // Open the first category that actually has questions by default.
        const firstReady = cats.find((c) => c.count > 0);
        setOpenId(firstReady ? firstReady.id : "");
      })
      .catch((err) => {
        if (alive) setError(err.message || "Could not load categories.");
      })
      .finally(() => {
        if (alive) setLoadingCats(false);
      });
    return () => {
      alive = false;
    };
  }, [apiBase, language]);

  useEffect(() => {
    let alive = true;
    fetchQuizProgress(apiBase, language)
      .then((data) => {
        if (alive) setServerProgress(data || { categories: [], mistakes: [] });
      })
      .catch(() => {
        if (alive) setServerProgress({ categories: [], mistakes: [] });
      });
    return () => {
      alive = false;
    };
  }, [apiBase, language]);

  // Saved progress per category, read fresh from the local store. This component
  // unmounts when the runner opens and re-mounts on return, so reading on
  // category load reflects the latest Submit.
  const progressByCat = useMemo(() => {
    const map = {};
    const remote = Object.fromEntries(
      (serverProgress.categories || []).map((item) => [item.category, item])
    );
    categories.forEach((c) => {
      const progress = mergeProgress(
        readCategoryProgress(language, c.id),
        remote[c.id]
      );
      if (progress) map[c.id] = progress;
    });
    return map;
  }, [categories, language, serverProgress]);

  const totalQuestions = useMemo(
    () => categories.reduce((sum, c) => sum + (c.count || 0), 0),
    [categories]
  );
  const readyCategories = useMemo(
    () => categories.filter((c) => c.count > 0),
    [categories]
  );
  const categoriesByTrack = useMemo(
    () =>
      Object.fromEntries(
        TRACKS.map((track) => [
          track.id,
          orderTrackCategories(
            track.id,
            categories.filter((category) => category.track === track.id)
          ),
        ])
      ),
    [categories]
  );
  // A category is "complete" once its best score passes the bar.
  const doneCategories = useMemo(
    () =>
      readyCategories.filter(
        (c) => (progressByCat[c.id]?.best?.score ?? 0) >= PASS_THRESHOLD
      ).length,
    [readyCategories, progressByCat]
  );
  const heroPct = readyCategories.length
    ? Math.round((doneCategories / readyCategories.length) * 100)
    : 0;

  const mistakes = (serverProgress.mistakes || []).filter(
    (item) => item.language === language
  );
  const adaptiveCategory = categoryForMastery(mastery?.weakest?.topic, readyCategories);
  const nextCategory = adaptiveCategory || readyCategories.find(
    (category) => (progressByCat[category.id]?.best?.score ?? 0) < PASS_THRESHOLD
  );
  const recommendationReason = adaptiveCategory
    ? mastery.weakest.reason
    : nextCategory
      ? `This is the next ${nextCategory.track} topic you have not passed yet.`
      : "You have completed every available category in this language.";

  const cacheQuestions = (categoryId, list) =>
    setQuestionsByCat((prev) => ({ ...prev, [categoryId]: list }));

  const categoryForStartingPath = (recommendation) => {
    if (recommendation?.category) return recommendation.category;
    if (recommendation?.action === "syntax-quiz") return "syntax";
    if (recommendation?.action === "variables-quiz") return "variables";
    if (recommendation?.action === "control-flow-quiz") return "conditionals";
    if (recommendation?.action === "functions-quiz") return "functions";
    if (recommendation?.action === "data-structures-quiz") return "lists";
    if (recommendation?.action === "debugging-quiz") return "debug";
    return null;
  };

  const showRecommendation = (recommendation) => {
    const category = categoryForStartingPath(recommendation);
    if (!category) return;
    const track = recommendation.track || readyCategories.find((item) => item.id === category)?.track || "beginner";
    setOpenTracks({ ...CLOSED_TRACKS, [track]: true });
    setOpenId(category);
    window.setTimeout(() => {
      document.getElementById(`cq-category-${category}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 50);
  };

  const startRecommendedTopic = async (recommendation) => {
    showRecommendation(recommendation);
    setError("");

    const categoryId = categoryForStartingPath(recommendation);
    if (!categoryId) return;

    try {
      const questions = questionsByCat[categoryId] || (
        await fetchQuizQuestions(apiBase, language, categoryId)
      ).questions || [];
      if (!questionsByCat[categoryId]) cacheQuestions(categoryId, questions);

      const categoryProgress = progressByCat[categoryId]?.questions || {};
      const draftAnswers = readQuizDraftAnswers(language, categoryId);
      const draftQuestion = questions.find((question) => hasDraftAnswer(draftAnswers[question.id]));
      const nextQuestion =
        draftQuestion ||
        questions.find((question) => categoryProgress[question.id] !== "correct") ||
        questions[0];

      if (!nextQuestion?.id) {
        setError("No questions are available for the recommended topic yet.");
        return;
      }
      onOpenQuestion(categoryId, nextQuestion.id);
    } catch (err) {
      setError(err.message || "Could not open the recommended topic yet.");
    }
  };

  return (
    <div className="cq-landing">

      <section className={`cq-hero cq-hero-${language}`}>
        {(() => {
          const Icon = LANGUAGE_VISUALS[language]?.Icon;
          return Icon ? (
            <span
              className="cq-hero-icon"
              aria-hidden="true"
              style={{ "--cq-card-tint": LANGUAGE_VISUALS[language]?.tint }}
            >
              <Icon />
            </span>
          ) : null;
        })()}
        <div className="cq-hero-copy">
          <span className="cq-hero-eyebrow">Concept Quiz</span>
          <h2>{languageLabel}</h2>
          <p>
            {totalQuestions} question{totalQuestions === 1 ? "" : "s"} across{" "}
            {readyCategories.length} ready categor
            {readyCategories.length === 1 ? "y" : "ies"}.
          </p>
        </div>
        <div className="cq-hero-progress">
          <div
            className={`cq-hero-ring ${heroPct === 0 ? "empty" : ""}`}
            style={{ "--cq-ring-pct": `${heroPct}%` }}
          >
            <span className="cq-hero-pct">{heroPct}%</span>
          </div>
          <span className="cq-hero-progress-label">
            {doneCategories}/{readyCategories.length} categories complete
          </span>
        </div>
      </section>

      <section className="cq-guidance-card">
        <div>
          <span className="cq-hero-eyebrow">Recommended next</span>
          <h3>{nextCategory ? nextCategory.label : "All caught up"}</h3>
          <p>{recommendationReason}</p>
        </div>
        <div className="cq-guidance-actions">
          {nextCategory ? (
            <button
              type="button"
              className="cq-btn cq-btn-primary"
              onClick={() => startRecommendedTopic({ track: nextCategory.track, category: nextCategory.id })}
            >
              Open this topic
            </button>
          ) : null}
        </div>
      </section>

      {error ? <p className="cq-error">{error}</p> : null}

      {loadingCats ? (
        <p className="cq-loading">Loading categories...</p>
      ) : (
        <div className="cq-track-groups">
          {TRACKS.map((track) => {
            const trackCategories = categoriesByTrack[track.id] || [];
            const expanded = openTracks[track.id];
            const trackQuestions = trackCategories.reduce(
              (sum, category) => sum + (category.count || 0),
              0
            );

            if (trackCategories.length === 0) return null;

            return (
              <section
                key={track.id}
                className={"cq-track-group" + (expanded ? " open" : "")}
              >
                <button
                  type="button"
                  className="cq-track-toggle"
                  aria-expanded={expanded}
                  aria-controls={"cq-" + track.id + "-categories"}
                  onClick={() =>
                    setOpenTracks((current) => ({
                      ...CLOSED_TRACKS,
                      [track.id]: !current[track.id],
                    }))
                  }
                >
                  <span className={"cq-track-badge is-" + track.id}>
                    {track.label}
                  </span>
                  <span className="cq-track-copy">
                    <strong>{track.label} topics</strong>
                    <span>{track.description}</span>
                  </span>
                  <span className="cq-track-stats">
                    <strong>{trackCategories.length}</strong>
                    <small>topics</small>
                    <strong>{trackQuestions}</strong>
                    <small>questions</small>
                  </span>
                  <FaChevronDown className="cq-track-chevron" aria-hidden="true" />
                </button>

                {expanded ? (
                  <div
                    className="cq-track-content"
                    id={"cq-" + track.id + "-categories"}
                  >
                    <ul className="cq-accordion">
                      {trackCategories.map((cat, index) => {
                        const empty = cat.count === 0;
                        const open = openId === cat.id && !empty;
                        const best = progressByCat[cat.id]?.best;
                        const bestPct = best ? Math.round(best.score * 100) : null;
                        const draftAnswers = readQuizDraftAnswers(language, cat.id);
                        const draftCount = Object.values(draftAnswers).filter(hasDraftAnswer).length;
                        const submittedQuestions = Object.keys(
                          progressByCat[cat.id]?.questions || {}
                        ).length;
                        const completedCount = Math.min(cat.count || 0, submittedQuestions);
                        const inProgressCount = draftCount;
                        return (
                          <li
                            key={cat.id}
                            id={`cq-category-${cat.id}`}
                            className={
                              "cq-accordion-item" +
                              (open ? " open" : "") +
                              (empty ? " empty" : "")
                            }
                          >
                            <button
                              type="button"
                              className="cq-accordion-head"
                              aria-expanded={open}
                              disabled={empty}
                              onClick={() => setOpenId(open ? "" : cat.id)}
                            >
                              <span className="cq-accordion-num">{index + 1}</span>
                              <span className="cq-accordion-copy">
                                <span className="cq-accordion-title">
                                  {cat.label}
                                  {empty ? (
                                    <span className="cq-accordion-soon">Coming soon</span>
                                  ) : (
                                    <span className="cq-accordion-count">{cat.count}</span>
                                  )}
                                </span>
                                {cat.blurb ? (
                                  <span className="cq-accordion-blurb">{cat.blurb}</span>
                                ) : null}
                                {bestPct != null ? (
                                  <span
                                    className={
                                      "cq-accordion-best " +
                                      (bestPct >= PASS_THRESHOLD * 100 ? "pass" : "try")
                                    }
                                  >
                                    <FaTrophy aria-hidden="true" />
                                    Best score: {bestPct}% ({best.correct}/{best.total})
                                  </span>
                                ) : null}
                                {!empty && (completedCount > 0 || inProgressCount > 0) ? (
                                  <span className="cq-accordion-progress-badges">
                                    {inProgressCount > 0 ? (
                                      <span className="cq-progress-badge in-progress">
                                        {inProgressCount} in progress
                                      </span>
                                    ) : null}
                                    {completedCount > 0 ? (
                                      <span className="cq-progress-badge complete">
                                        {completedCount}/{cat.count} completed
                                      </span>
                                    ) : null}
                                  </span>
                                ) : null}
                              </span>
                              <span className="cq-accordion-chevron" aria-hidden="true">
                                {empty ? <FaLock /> : <FaChevronDown />}
                              </span>
                            </button>

                            {open ? (
                              <div className="cq-accordion-body">
                                <CategoryQuestions
                                  apiBase={apiBase}
                                  language={language}
                                  category={cat}
                                  cached={questionsByCat[cat.id]}
                                  progress={progressByCat[cat.id]}
                                  onLoaded={cacheQuestions}
                                  onOpenQuestion={onOpenQuestion}
                                />
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </section>
            );
          })}
          <MistakeBankQuiz
            apiBase={apiBase}
            language={language}
            mistakes={mistakes}
            onProgressRefresh={refreshProgress}
            onOpenQuestion={onOpenQuestion}
          />
        </div>
      )}
    </div>
  );
}
