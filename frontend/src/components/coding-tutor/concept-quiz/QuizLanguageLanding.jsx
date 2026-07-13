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
} from "react-icons/fa";
import { fetchQuizCategories, fetchQuizQuestions } from "./conceptQuizApi";
import { LANGUAGE_VISUALS } from "./languageVisuals";
import { readCategoryProgress } from "./conceptQuizProgress";

// Language landing page: a progress hero plus an ACCORDION of categories. Each
// category row expands inline to reveal its question table (name | type | status).
// Selecting a question routes into the runner. Per-category scores + per-question
// status come from the local progress store (saved on Submit).

// A category counts toward the hero's "complete" tally once its best score
// passes this bar.
const PASS_THRESHOLD = 0.7;

// Per-kind badge meta: a color group (drives the badge palette), an icon, and a
// label. Grouping MCQ variants together and giving each type its own color +
// icon makes the Type column scannable at a glance.
const KIND_META = {
  "mcq-output": { group: "mcq", label: "Multiple choice", Icon: FaListUl },
  "mcq-behavior": { group: "mcq", label: "Multiple choice", Icon: FaListUl },
  typein: { group: "typein", label: "Type-in", Icon: FaKeyboard },
  parsons: { group: "parsons", label: "Drag & drop", Icon: FaArrowsAltV },
};

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

export default function QuizLanguageLanding({
  apiBase,
  language,
  languageLabel,
  onOpenQuestion,
}) {
  const [categories, setCategories] = useState([]);
  const [openId, setOpenId] = useState("");
  // Per-category question cache: { [categoryId]: question[] }.
  const [questionsByCat, setQuestionsByCat] = useState({});
  const [loadingCats, setLoadingCats] = useState(true);
  const [error, setError] = useState("");

  // Load the 13 categories for this language.
  useEffect(() => {
    let alive = true;
    setLoadingCats(true);
    setError("");
    setQuestionsByCat({});
    fetchQuizCategories(apiBase, language)
      .then((data) => {
        if (!alive) return;
        const cats = data.categories || [];
        setCategories(cats);
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

  // Saved progress per category, read fresh from the local store. This component
  // unmounts when the runner opens and re-mounts on return, so reading on
  // category load reflects the latest Submit.
  const progressByCat = useMemo(() => {
    const map = {};
    categories.forEach((c) => {
      const p = readCategoryProgress(language, c.id);
      if (p) map[c.id] = p;
    });
    return map;
  }, [categories, language]);

  const totalQuestions = useMemo(
    () => categories.reduce((sum, c) => sum + (c.count || 0), 0),
    [categories]
  );
  const readyCategories = useMemo(
    () => categories.filter((c) => c.count > 0),
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

  const cacheQuestions = (categoryId, list) =>
    setQuestionsByCat((prev) => ({ ...prev, [categoryId]: list }));

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

      {error ? <p className="cq-error">{error}</p> : null}

      {loadingCats ? (
        <p className="cq-loading">Loading categories…</p>
      ) : (
        <ul className="cq-accordion">
          {categories.map((cat, index) => {
            const empty = cat.count === 0;
            const open = openId === cat.id && !empty;
            const best = progressByCat[cat.id]?.best;
            const bestPct = best ? Math.round(best.score * 100) : null;
            return (
              <li
                key={cat.id}
                className={`cq-accordion-item ${open ? "open" : ""} ${
                  empty ? "empty" : ""
                }`}
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
                        className={`cq-accordion-best ${
                          bestPct >= PASS_THRESHOLD * 100 ? "pass" : "try"
                        }`}
                      >
                        <FaTrophy aria-hidden="true" />
                        Best score: {bestPct}% ({best.correct}/{best.total})
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
      )}
    </div>
  );
}
