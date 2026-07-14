import { useEffect, useState } from "react";
import { FaBookOpen, FaArrowRight, FaClock, FaLock, FaCheck } from "react-icons/fa";
import { LANGUAGE_VISUALS } from "../concept-quiz/languageVisuals";
import LessonView from "./LessonView";

// Learn — the first of the Practice Library's three modes (Learn → Practice → Code).
//
// A beginner who has never seen a function has nowhere to start in the other two: a quiz
// can only tell them they're wrong, and a blank editor is a wall. Learn is where the idea
// comes from, and every lesson hands off to the quiz on the same topic.
//
// Three views, all URL-backed (see practiceTargetFromPath in CodingTutor):
//   languages → the 4 language cards
//   lessons   → one language's lesson list
//   lesson    → a single lesson

function LanguageCards({ languages, onPick }) {
  return (
    <div className="cq-language-cards">
      <div className="cq-cards-intro">
        <h2>Learn</h2>
        <p>
          Short lessons that teach the idea before you're tested on it. Read one,
          then practice it. Pick a language to start.
        </p>
      </div>
      <div className="cq-cards-grid">
        {languages.map((lang) => {
          const accent = LANGUAGE_VISUALS[lang.id] || {};
          const Icon = accent.Icon;
          const recommended = lang.id === "python";
          return (
            <div
              key={lang.id}
              className={`cq-language-card ${recommended ? "recommended" : ""}`}
              style={{ "--cq-card-tint": accent.tint || "var(--ct-primary)" }}
              role="button"
              tabIndex={0}
              onClick={() => onPick(lang.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(lang.id);
                }
              }}
            >
              {recommended ? (
                <span className="cq-language-card-flag">Start here</span>
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
              <span className="cq-language-card-cta">
                Start learning <FaArrowRight aria-hidden="true" />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LessonList({ language, languageLabel, categories, onOpen, onBack }) {
  // A category with no lesson yet is shown but locked — the manifest is the roadmap of
  // what this library will cover, so hiding unwritten topics would hide the plan. It is
  // never a dead click: the card says so before the student presses it.
  const ready = categories.filter((c) => c.has_lesson);

  return (
    <div className="learn-list">
      <header className="learn-list-head">
        <h2>
          <FaBookOpen aria-hidden="true" /> {languageLabel}
        </h2>
        <p>
          {ready.length
            ? `${ready.length} lesson${ready.length === 1 ? "" : "s"} ready. Read one, then practice it.`
            : "Lessons for this language are being written."}
        </p>
      </header>

      <ol className="learn-lesson-grid">
        {categories.map((cat, index) => {
          const locked = !cat.has_lesson;
          return (
            <li key={cat.id}>
              <button
                type="button"
                className={`learn-lesson-card ${locked ? "locked" : ""}`}
                disabled={locked}
                onClick={() => onOpen(language, cat.id)}
              >
                <span className="learn-lesson-num">{index + 1}</span>
                <span className="learn-lesson-body">
                  <span className="learn-lesson-title">{cat.label}</span>
                  {cat.blurb ? (
                    <span className="learn-lesson-blurb">{cat.blurb}</span>
                  ) : null}
                </span>
                <span className="learn-lesson-meta">
                  {locked ? (
                    <span className="learn-lesson-soon">
                      <FaLock aria-hidden="true" /> Coming soon
                    </span>
                  ) : (
                    <>
                      {cat.count > 0 ? (
                        <span className="learn-lesson-qcount">{cat.count} questions</span>
                      ) : null}
                      <FaArrowRight aria-hidden="true" />
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <button type="button" className="practice-guide-viewall" onClick={onBack}>
        ← All languages
      </button>
    </div>
  );
}

export default function LearnMode({
  apiBase,
  target,
  languageLabels,
  onNavigateToLanguages,
  onNavigateToLanguage,
  onNavigateToLesson,
  onPracticeCategory,
}) {
  const [languages, setLanguages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const labelFor = (id) => languageLabels[id] || (id || "").toUpperCase();

  // Language list (for the cards view).
  useEffect(() => {
    if (target.view !== "languages") return undefined;
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`${apiBase}/api/coding/concept-quiz/languages`)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load languages.");
        return r.json();
      })
      .then((data) => {
        if (alive) setLanguages(data.languages || []);
      })
      .catch((err) => {
        if (alive) setError(err.message || "Could not load languages.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiBase, target.view]);

  // Category list for one language (the lesson list). Reuses the concept-quiz category
  // endpoint, which now reports `has_lesson` per category — Learn and Practice are keyed
  // to the SAME categories by design, so "Learn Loops" and "Practice Loops" can't drift.
  useEffect(() => {
    if (target.view !== "lessons" || !target.language) return undefined;
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`${apiBase}/api/coding/concept-quiz/${target.language}/categories`)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load lessons.");
        return r.json();
      })
      .then((data) => {
        if (alive) setCategories(data.categories || []);
      })
      .catch((err) => {
        if (alive) setError(err.message || "Could not load lessons.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiBase, target.view, target.language]);

  if (target.view === "lesson") {
    return (
      <LessonView
        apiBase={apiBase}
        language={target.language}
        category={target.category}
        languageLabel={labelFor(target.language)}
        onPractice={() => onPracticeCategory(target.language, target.category)}
        onBack={() => onNavigateToLanguage(target.language)}
      />
    );
  }

  if (loading) return <p className="cq-loading">Loading lessons…</p>;
  if (error) return <p className="cq-error">{error}</p>;

  if (target.view === "lessons") {
    return (
      <LessonList
        language={target.language}
        languageLabel={labelFor(target.language)}
        categories={categories}
        onOpen={onNavigateToLesson}
        onBack={onNavigateToLanguages}
      />
    );
  }

  return <LanguageCards languages={languages} onPick={onNavigateToLanguage} />;
}
