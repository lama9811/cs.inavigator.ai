import { useEffect, useMemo, useState } from "react";
import { FaListUl, FaArrowRight } from "react-icons/fa";
import {
  fetchQuizLanguages,
  fetchQuizCategories,
  fetchQuizQuestions,
  gradeQuiz,
} from "./conceptQuizApi";
import { LANGUAGE_VISUALS } from "./languageVisuals";
import { saveCategoryResult } from "./conceptQuizProgress";
import QuizLanguageLanding from "./QuizLanguageLanding";
import QuizRunner from "./QuizRunner";

// Top-level concept-quiz container. Driven by the route target parsed in
// CodingTutor (view: "toggle" | "language" | "runner"). Renders the 4 language
// cards, the language landing page, or the sequential runner, and owns the
// data fetches that span views (question bank for the runner, grading).
//
// Navigation is URL-first: every view change calls a navigate-* callback that
// rewrites the path, so Back/Forward and deep links work.

function LanguageCards({ apiBase, onPickLanguage }) {
  const [languages, setLanguages] = useState([]);
  // Per-language stats: { [id]: { ready, total, questions } }.
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetchQuizLanguages(apiBase)
      .then((data) => {
        if (!alive) return;
        const langs = data.languages || [];
        setLanguages(langs);
        // Pull each language's categories in parallel so the cards can show
        // real counts (ready categories / total questions).
        return Promise.all(
          langs.map((lang) =>
            fetchQuizCategories(apiBase, lang.id)
              .then((res) => {
                const cats = res.categories || [];
                const ready = cats.filter((c) => c.count > 0);
                return [
                  lang.id,
                  {
                    ready: ready.length,
                    total: cats.length,
                    questions: cats.reduce((sum, c) => sum + (c.count || 0), 0),
                  },
                ];
              })
              // A per-language failure shouldn't sink the whole grid.
              .catch(() => [lang.id, null])
          )
        );
      })
      .then((entries) => {
        if (alive && entries) {
          setStats(Object.fromEntries(entries.filter(([, v]) => v)));
        }
      })
      .catch((err) => {
        if (alive) setError(err.message || "Could not load quiz languages.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiBase]);

  if (loading) return <p className="cq-loading">Loading quizzes…</p>;
  if (error) return <p className="cq-error">{error}</p>;

  return (
    <div className="cq-language-cards">
      <div className="cq-cards-intro">
        <h2>Concept Quizzes</h2>
        <p>
          Short questions that check what you know — output, behavior, type-ins,
          and drag-and-drop. Pick a language to start.
        </p>
      </div>
      <div className="cq-cards-grid">
        {languages.map((lang) => {
          const accent = LANGUAGE_VISUALS[lang.id] || {};
          const Icon = accent.Icon;
          const stat = stats[lang.id];
          const recommended = lang.id === "python";
          const readyPct =
            stat && stat.total ? Math.round((stat.ready / stat.total) * 100) : 0;
          return (
            <div
              key={lang.id}
              className={`cq-language-card ${recommended ? "recommended" : ""}`}
              style={{ "--cq-card-tint": accent.tint || "var(--ct-primary)" }}
              role="button"
              tabIndex={0}
              onClick={() => onPickLanguage(lang.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPickLanguage(lang.id);
                }
              }}
            >
              {recommended ? (
                <span className="cq-language-card-flag">Beginner friendly</span>
              ) : null}

              <span className="cq-language-card-head">
                {Icon ? (
                  <span className="cq-language-card-icon" aria-hidden="true">
                    <Icon />
                  </span>
                ) : null}
                <span className="cq-language-card-name">{lang.label}</span>
              </span>

              {accent.blurb ? (
                <span className="cq-language-card-blurb">{accent.blurb}</span>
              ) : null}

              <span className="cq-language-card-stats">
                <span className="cq-language-stat">
                  <FaListUl aria-hidden="true" />
                  {stat ? `${stat.questions} questions` : "Questions"}
                </span>
              </span>

              {/* Category progress bar (ready categories out of total). */}
              <span className="cq-language-card-progress">
                <span className="cq-language-progress-track">
                  <span
                    className="cq-language-progress-fill"
                    style={{ width: `${readyPct}%` }}
                  />
                </span>
                <span className="cq-language-progress-label">
                  {stat ? `${stat.ready}/${stat.total} categories ready` : "…"}
                </span>
              </span>

              <span className="cq-language-card-cta">
                Practice <FaArrowRight aria-hidden="true" />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ConceptQuiz({
  apiBase,
  target,
  languageLabels,
  onNavigateToLanguages,
  onNavigateToLanguage,
  onNavigateToQuestion,
}) {
  // The runner needs the full question list + the current index derived from
  // the questionId in the URL. Fetch the bank whenever we're in runner view for
  // a given language+category.
  const [bank, setBank] = useState(null);
  const [bankKey, setBankKey] = useState("");
  const [runnerError, setRunnerError] = useState("");

  const runnerWanted =
    target.view === "runner" ? `${target.language}/${target.category}` : "";

  useEffect(() => {
    if (target.view !== "runner") return;
    if (bankKey === runnerWanted && bank) return;
    let alive = true;
    setRunnerError("");
    fetchQuizQuestions(apiBase, target.language, target.category)
      .then((data) => {
        if (!alive) return;
        setBank(data);
        setBankKey(runnerWanted);
      })
      .catch((err) => {
        if (alive) setRunnerError(err.message || "Could not load this quiz.");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, target.view, runnerWanted]);

  const runnerIndex = useMemo(() => {
    if (target.view !== "runner" || !bank) return 0;
    const idx = bank.questions.findIndex((q) => q.id === target.questionId);
    return idx >= 0 ? idx : 0;
  }, [target, bank]);

  const labelFor = (langId) =>
    languageLabels[langId] || langId.toUpperCase();

  if (target.view === "toggle") {
    return <LanguageCards apiBase={apiBase} onPickLanguage={onNavigateToLanguage} />;
  }

  if (target.view === "language") {
    return (
      <QuizLanguageLanding
        apiBase={apiBase}
        language={target.language}
        languageLabel={labelFor(target.language)}
        onBackToLanguages={onNavigateToLanguages}
        onOpenQuestion={(category, questionId) =>
          onNavigateToQuestion(target.language, category, questionId)
        }
      />
    );
  }

  // runner view
  if (runnerError) {
    return (
      <div className="cq-runner">
        <button
          type="button"
          className="practice-back-btn"
          onClick={() => onNavigateToLanguage(target.language)}
        >
          ← {labelFor(target.language)}
        </button>
        <p className="cq-error">{runnerError}</p>
      </div>
    );
  }

  if (!bank || bankKey !== runnerWanted) {
    return <p className="cq-loading">Loading quiz…</p>;
  }

  return (
    <QuizRunner
      categoryLabel={bank.category_label}
      questions={bank.questions}
      index={runnerIndex}
      onNavigateIndex={(nextIndex) => {
        const q = bank.questions[nextIndex];
        if (q) onNavigateToQuestion(target.language, target.category, q.id);
      }}
      onBackToCategory={() => onNavigateToLanguage(target.language)}
      onGrade={(answers) =>
        gradeQuiz(apiBase, {
          language: target.language,
          category: target.category,
          answers,
        })
      }
      onSaveResult={(grade) =>
        saveCategoryResult(
          target.language,
          target.category,
          grade,
          Date.now()
        )
      }
    />
  );
}
