import { useEffect, useMemo, useState } from "react";
import { FaListUl, FaArrowRight } from "react-icons/fa";
import {
  fetchQuizLanguages,
  fetchQuizCategories,
  fetchQuizProgress,
  fetchQuizQuestion,
  fetchQuizQuestions,
  gradeMistakeQuiz,
  gradeQuiz,
} from "./conceptQuizApi";
import { LANGUAGE_VISUALS } from "./languageVisuals";
import { saveCategoryResult, saveMistakeBankResult } from "./conceptQuizProgress";
import QuizLanguageLanding from "./QuizLanguageLanding";
import QuizRunner from "./QuizRunner";

// Top-level concept-quiz container. Driven by the route target parsed in
// CodingTutor (view: "quiz" | "language" | "runner" — "code" never reaches here).
// Renders the 4 language cards, the language landing page, or the sequential runner,
// and owns the data fetches that span views (question bank for the runner, grading).
//
// Navigation is URL-first: every view change calls a navigate-* callback that
// rewrites the path, so Back/Forward and deep links work.

const MISTAKE_BANK_THRESHOLD = 3;

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
          return (
            <button
              type="button"
              key={lang.id}
              className={`cq-language-card ${recommended ? "recommended" : ""}`}
              style={{ "--cq-card-tint": accent.tint || "var(--ct-primary)" }}
              onClick={() => onPickLanguage(lang.id)}
              aria-label={`Practice ${lang.label} concept quizzes`}
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

              <span className="cq-language-card-cta">
                Practice <FaArrowRight aria-hidden="true" />
              </span>
            </button>
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
  mastery,
  onPracticeActivity,
  onNavigateToLanguages,
  onNavigateToLanguage,
  onNavigateToQuestion,
  onNavigateToMistakeBank,
  // "I don't remember this" → the full lesson on this exact topic. The in-quiz Learn tab
  // is only a refresher; this is the escape hatch to the real thing.
  onOpenLesson,
}) {
  // The runner needs the full question list + the current index derived from
  // the questionId in the URL. Fetch the bank whenever we're in runner view for
  // a given language+category.
  const [bank, setBank] = useState(null);
  const [bankKey, setBankKey] = useState("");
  const [runnerError, setRunnerError] = useState("");
  const [mistakeBank, setMistakeBank] = useState({
    key: "",
    loading: false,
    error: "",
    questions: [],
    mistakes: [],
  });

  const runnerWanted =
    target.view === "runner" ? `${target.language}/${target.category}` : "";
  const mistakeWanted =
    target.view === "mistake-runner" ? `${target.language}/mistake-bank` : "";

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

  useEffect(() => {
    if (target.view !== "mistake-runner") return;
    let alive = true;
    setMistakeBank({
      key: mistakeWanted,
      loading: true,
      error: "",
      questions: [],
      mistakes: [],
    });

    fetchQuizProgress(apiBase, target.language)
      .then((progress) => {
        if (!alive) return null;
        const mistakes = (progress?.mistakes || []).filter(
          (item) => item.language === target.language
        );
        if (mistakes.length < MISTAKE_BANK_THRESHOLD) {
          setMistakeBank({
            key: mistakeWanted,
            loading: false,
            error: "",
            questions: [],
            mistakes,
          });
          return null;
        }
        return Promise.all(
          mistakes.map(async (mistake) => {
            const question = await fetchQuizQuestion(
              apiBase,
              target.language,
              mistake.category,
              mistake.question_id
            );
            return {
              ...question,
              category: mistake.category,
              category_label: mistake.category.replaceAll("-", " "),
            };
          })
        ).then((questions) => {
          if (!alive) return;
          setMistakeBank({
            key: mistakeWanted,
            loading: false,
            error: "",
            questions,
            mistakes,
          });
        });
      })
      .catch((err) => {
        if (!alive) return;
        setMistakeBank({
          key: mistakeWanted,
          loading: false,
          error: err.message || "Could not load the wrong-answer quiz.",
          questions: [],
          mistakes: [],
        });
      });

    return () => {
      alive = false;
    };
  }, [apiBase, target.view, target.language, mistakeWanted]);

  const runnerIndex = useMemo(() => {
    if (target.view !== "runner" || !bank) return 0;
    const idx = bank.questions.findIndex((q) => q.id === target.questionId);
    return idx >= 0 ? idx : 0;
  }, [target, bank]);

  const labelFor = (langId) =>
    languageLabels[langId] || langId.toUpperCase();

  // "quiz" is the bare /coding/practice landing (the Quiz front door). Anything this
  // component doesn't recognize ALSO lands here rather than falling through to the
  // runner below — a runner with no question bank renders "Loading quiz…" forever, so
  // an unknown view used to hang the page silently instead of failing visibly.
  if (target.view === "quiz" || target.view === "toggle" || !target.view) {
    return <LanguageCards apiBase={apiBase} onPickLanguage={onNavigateToLanguage} />;
  }

  if (target.view === "language") {
    return (
      <QuizLanguageLanding
        apiBase={apiBase}
        language={target.language}
        languageLabel={labelFor(target.language)}
        mastery={mastery}
        onBackToLanguages={onNavigateToLanguages}
        onOpenQuestion={(category, questionId) =>
          onNavigateToQuestion(target.language, category, questionId)
        }
        onOpenMistakeBank={(questionId) =>
          onNavigateToMistakeBank(target.language, questionId)
        }
      />
    );
  }

  if (target.view === "mistake-runner") {
    if (mistakeBank.loading || mistakeBank.key !== mistakeWanted) {
      return <p className="cq-loading">Loading wrong-answer quiz...</p>;
    }

    if (mistakeBank.error) {
      return (
        <div className="cq-runner">
          <button
            type="button"
            className="practice-back-btn"
            onClick={() => onNavigateToLanguage(target.language)}
          >
            ← {labelFor(target.language)}
          </button>
          <p className="cq-error">{mistakeBank.error}</p>
        </div>
      );
    }

    if (mistakeBank.mistakes.length < MISTAKE_BANK_THRESHOLD) {
      return (
        <div className="cq-empty">
          <h3>No wrong-answer quiz yet</h3>
          <p>
            Miss at least {MISTAKE_BANK_THRESHOLD} questions in this language to
            unlock a focused retry quiz.
          </p>
          <button
            type="button"
            className="cq-btn cq-btn-primary"
            onClick={() => onNavigateToLanguage(target.language)}
          >
            Back to {labelFor(target.language)}
          </button>
        </div>
      );
    }

    const mistakeIndex = Math.max(
      0,
      mistakeBank.questions.findIndex((q) => q.id === target.questionId)
    );
    const sourceById = Object.fromEntries(
      mistakeBank.questions.map((question) => [question.id, question.category])
    );

    return (
      <QuizRunner
        apiBase={apiBase}
        language={target.language}
        category="mistake-bank"
        categoryLabel="Wrong-answer quiz"
        questions={mistakeBank.questions}
        index={mistakeIndex}
        onNavigateIndex={(nextIndex) => {
          const q = mistakeBank.questions[nextIndex];
          if (q) onNavigateToMistakeBank(target.language, q.id);
        }}
        onBackToCategory={() => onNavigateToLanguage(target.language)}
        backLabel={`Back to ${labelFor(target.language)}`}
        onOpenLesson={onOpenLesson}
        onGrade={(answers) =>
          gradeMistakeQuiz(apiBase, {
            language: target.language,
            answers: answers.map((answer) => ({
              ...answer,
              category: sourceById[answer.question_id],
            })),
          })
        }
        onSaveResult={(grade) => {
          saveMistakeBankResult(target.language, grade);
          onPracticeActivity?.();
        }}
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
      apiBase={apiBase}
      language={target.language}
      category={target.category}
      categoryLabel={bank.category_label}
      questions={bank.questions}
      index={runnerIndex}
      onNavigateIndex={(nextIndex) => {
        const q = bank.questions[nextIndex];
        if (q) onNavigateToQuestion(target.language, target.category, q.id);
      }}
      onBackToCategory={() => onNavigateToLanguage(target.language)}
      onOpenLesson={onOpenLesson}
      onGrade={(answers) =>
        gradeQuiz(apiBase, {
          language: target.language,
          category: target.category,
          answers,
        })
      }
      onSaveResult={(grade) => {
        saveCategoryResult(
          target.language,
          target.category,
          grade,
          Date.now()
        );
        onPracticeActivity?.();
      }}
    />
  );
}
