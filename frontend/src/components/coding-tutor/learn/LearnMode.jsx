import { useEffect, useState } from "react";
import { FaBookOpen, FaArrowRight, FaLock } from "react-icons/fa";
import { LANGUAGE_VISUALS } from "../concept-quiz/languageVisuals";
import LessonView from "./LessonView";

// Learn is the first Practice Library mode: Learn -> Practice -> Code.
//
// Four URL-backed views keep the address bar, Back/Forward, and refresh in sync:
//   languages -> the four language cards
//   tracks    -> Beginner and Intermediate cards for one language
//   lessons   -> the selected track's smaller lesson list
//   lesson    -> one authored lesson

const TRACKS = [
  {
    id: "beginner",
    label: "Beginner Track",
    kicker: "Start here",
    description:
      "Build the foundation one idea at a time, then try your first algorithm and debugging lessons.",
    cta: "Start with the basics",
  },
  {
    id: "intermediate",
    label: "Intermediate Track",
    kicker: "Next step",
    description:
      "Build on Part 1 with multi-step problems and the next concepts that matter most in this language.",
    cta: "Explore next steps",
  },
];

function trackDefinition(trackId) {
  return TRACKS.find((track) => track.id === trackId) || null;
}

function LanguageCards({ languages, onPick }) {
  return (
    <div className="cq-language-cards">
      <div className="cq-cards-intro">
        <h2>Learn</h2>
        <p>
          Short lessons that teach the idea before you're tested on it. Pick a
          language, then choose the pace that fits where you are.
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
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
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
                Choose a track <FaArrowRight aria-hidden="true" />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrackCards({ language, languageLabel, categories, onPick, onBack }) {
  const languageAccent = LANGUAGE_VISUALS[language]?.tint || "#7c3aed";

  return (
    <div className="learn-tracks">
      <header className="learn-tracks-head">
        <span className="lesson-kicker">{languageLabel}</span>
        <h2>Choose your learning track</h2>
        <p>
          Start with the foundation or jump to the next step when those ideas already
          feel familiar. Nothing is locked.
        </p>
      </header>

      <div className="learn-track-grid">
        {TRACKS.map((track) => {
          const trackCategories = categories.filter(
            (category) => category.track === track.id
          );
          const ready = trackCategories.filter((category) => category.has_lesson).length;
          const questions = trackCategories.reduce(
            (total, category) => total + (category.count || 0),
            0
          );
          const accent = track.id === "beginner" ? "#16a34a" : languageAccent;

          return (
            <button
              key={track.id}
              type="button"
              className={`learn-track-card is-${track.id}`}
              style={{ "--learn-track-accent": accent }}
              onClick={() => onPick(language, track.id)}
            >
              <span className="learn-track-kicker">{track.kicker}</span>
              <span className="learn-track-title">{track.label}</span>
              <span className="learn-track-description">{track.description}</span>
              <span className="learn-track-stats">
                <span>{ready} lessons</span>
                <span aria-hidden="true">•</span>
                <span>{questions} practice questions</span>
              </span>
              <span className="learn-track-cta">
                {track.cta} <FaArrowRight aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>

      <button type="button" className="practice-guide-viewall" onClick={onBack}>
        ← All languages
      </button>
    </div>
  );
}

function LessonList({
  language,
  languageLabel,
  track,
  categories,
  onOpen,
  onBack,
}) {
  const ready = categories.filter((category) => category.has_lesson);

  return (
    <div className="learn-list">
      <header className="learn-list-head">
        <span className="lesson-kicker">{languageLabel}</span>
        <h2>
          <FaBookOpen aria-hidden="true" /> {track.label}
        </h2>
        <p>
          {ready.length
            ? `${ready.length} lesson${ready.length === 1 ? "" : "s"} ready. ${track.description}`
            : "Lessons for this track are being written."}
        </p>
      </header>

      <ol className="learn-lesson-grid">
        {categories.map((category, index) => {
          const locked = !category.has_lesson;
          return (
            <li key={category.id}>
              <button
                type="button"
                className={`learn-lesson-card ${locked ? "locked" : ""}`}
                disabled={locked}
                onClick={() => onOpen(language, category.id, track.id)}
              >
                <span className="learn-lesson-num">{index + 1}</span>
                <span className="learn-lesson-body">
                  <span className="learn-lesson-title">{category.label}</span>
                  {category.blurb ? (
                    <span className="learn-lesson-blurb">{category.blurb}</span>
                  ) : null}
                </span>
                <span className="learn-lesson-meta">
                  {locked ? (
                    <span className="learn-lesson-soon">
                      <FaLock aria-hidden="true" /> Coming soon
                    </span>
                  ) : (
                    <>
                      {category.count > 0 ? (
                        <span className="learn-lesson-qcount">
                          {category.count} questions
                        </span>
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
        ← Back to tracks
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
  onNavigateToTrack,
  onNavigateToLesson,
  onPracticeCategory,
}) {
  const [languages, setLanguages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const labelFor = (id) => languageLabels[id] || (id || "").toUpperCase();

  useEffect(() => {
    if (target.view !== "languages") return undefined;
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`${apiBase}/api/coding/concept-quiz/languages`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load languages.");
        return response.json();
      })
      .then((data) => {
        if (alive) setLanguages(data.languages || []);
      })
      .catch((fetchError) => {
        if (alive) setError(fetchError.message || "Could not load languages.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiBase, target.view]);

  // Track cards and lesson lists use the same category endpoint as Practice. The
  // manifest owns the track field, so Learn never keeps a second topic registry.
  useEffect(() => {
    if (!["tracks", "lessons"].includes(target.view) || !target.language) {
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`${apiBase}/api/coding/concept-quiz/${target.language}/categories`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load lessons.");
        return response.json();
      })
      .then((data) => {
        if (alive) setCategories(data.categories || []);
      })
      .catch((fetchError) => {
        if (alive) setError(fetchError.message || "Could not load lessons.");
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
        onBack={() =>
          target.track
            ? onNavigateToTrack(target.language, target.track)
            : onNavigateToLanguage(target.language)
        }
      />
    );
  }

  if (loading) return <p className="cq-loading">Loading lessons…</p>;
  if (error) return <p className="cq-error">{error}</p>;

  if (target.view === "tracks") {
    return (
      <TrackCards
        language={target.language}
        languageLabel={labelFor(target.language)}
        categories={categories}
        onPick={onNavigateToTrack}
        onBack={onNavigateToLanguages}
      />
    );
  }

  if (target.view === "lessons") {
    const track = trackDefinition(target.track);
    const trackCategories = categories.filter(
      (category) => category.track === target.track
    );
    return (
      <LessonList
        language={target.language}
        languageLabel={labelFor(target.language)}
        track={track}
        categories={trackCategories}
        onOpen={onNavigateToLesson}
        onBack={() => onNavigateToLanguage(target.language)}
      />
    );
  }

  return <LanguageCards languages={languages} onPick={onNavigateToLanguage} />;
}