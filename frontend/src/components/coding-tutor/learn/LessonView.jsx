import { useEffect, useState } from "react";
import {
  FaClock,
  FaArrowRight,
  FaArrowLeft,
  FaLightbulb,
  FaExclamationTriangle,
  FaTimesCircle,
  FaCheck,
  FaTimes,
} from "react-icons/fa";
import { markLessonRead } from "../concept-quiz/conceptQuizProgress";
import LessonPlayBar from "./LessonPlayBar";

// One lesson. Renders the authored block types (see backend/lessons.py) and ends with
// the handoff that gives Learn its purpose: "Practice this."
//
// Reading without doing doesn't stick. Every lesson exits into the quiz on the same
// topic, so Learn → Practice is one motion rather than two decisions.

const CALLOUT_ICON = {
  tip: FaLightbulb,
  warning: FaExclamationTriangle,
  mistake: FaTimesCircle,
};

const CALLOUT_DEFAULT_TITLE = {
  tip: "Tip",
  warning: "Watch out",
  mistake: "Common mistake",
};

// `inline code` → <code>. Authored prose uses backticks; anything else renders as-is.
// Deliberately NOT a markdown parser: lesson bodies are plain sentences, and pulling in
// a renderer would mean sanitizing HTML for content we already control.
function withInlineCode(text) {
  const parts = String(text || "").split(/(`[^`]+`)/g);
  return parts.map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      part
    )
  );
}

function Block({ block }) {
  if (block.kind === "text") {
    return <p className="lesson-text">{withInlineCode(block.body)}</p>;
  }

  if (block.kind === "code") {
    return (
      <figure className="lesson-code">
        {block.caption ? (
          <figcaption>{withInlineCode(block.caption)}</figcaption>
        ) : null}
        <pre>
          <code>{block.code}</code>
        </pre>
        {block.output ? (
          <div className="lesson-output">
            <span className="lesson-output-label">Output</span>
            <pre>
              <code>{block.output}</code>
            </pre>
          </div>
        ) : null}
      </figure>
    );
  }

  if (block.kind === "callout") {
    const Icon = CALLOUT_ICON[block.tone] || FaLightbulb;
    const title = block.title || CALLOUT_DEFAULT_TITLE[block.tone] || "Note";
    return (
      <aside className={`lesson-callout is-${block.tone}`}>
        <span className="lesson-callout-head">
          <Icon aria-hidden="true" />
          {title}
        </span>
        <p>{withInlineCode(block.body)}</p>
      </aside>
    );
  }

  if (block.kind === "compare") {
    return (
      <figure className="lesson-compare">
        <div className="lesson-compare-grid">
          <div className="lesson-compare-col is-wrong">
            <span className="lesson-compare-label">{block.wrong_label}</span>
            <pre>
              <code>{block.wrong}</code>
            </pre>
          </div>
          <div className="lesson-compare-col is-right">
            <span className="lesson-compare-label">{block.right_label}</span>
            <pre>
              <code>{block.right}</code>
            </pre>
          </div>
        </div>
        {block.caption ? (
          <figcaption>{withInlineCode(block.caption)}</figcaption>
        ) : null}
      </figure>
    );
  }

  if (block.kind === "list") {
    return (
      <div className="lesson-list-block">
        {block.title ? <h3>{block.title}</h3> : null}
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>
              <FaCheck aria-hidden="true" />
              <span>{withInlineCode(item)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.kind === "check") {
    return <CheckBlock block={block} />;
  }

  return null;
}

// An inline "did that land?" question. Answered right here in the lesson, revealed
// immediately, and nothing is recorded anywhere.
//
// Deliberately not graded: Learn is the one place in the Coding Tutor that isn't a test,
// and scoring these would turn it into one. The point is that the student *does* something
// before being handed to Practice, and arrives there having already got two right.
//
// Answering is one-way on purpose. Once you've seen why, re-picking would only let you
// paper over a wrong guess, and the wrong guess is the part worth sitting with.
function CheckBlock({ block }) {
  const [picked, setPicked] = useState(null);
  const answered = picked !== null;
  const correct = picked === block.answer_index;

  return (
    <div className={`lesson-check ${answered ? "is-answered" : ""}`}>
      <span className="lesson-check-kicker">Check yourself</span>
      <p className="lesson-check-prompt">{withInlineCode(block.prompt)}</p>

      {block.code ? (
        <pre className="lesson-check-code">
          <code>{block.code}</code>
        </pre>
      ) : null}

      <div className="lesson-check-choices" role="radiogroup">
        {block.choices.map((choice, i) => {
          const isAnswer = i === block.answer_index;
          const isPicked = i === picked;
          // After answering, always show which one was right, not merely whether the
          // student's pick was wrong. "Wrong, try again" teaches nothing.
          const state = !answered
            ? ""
            : isAnswer
              ? "is-correct"
              : isPicked
                ? "is-wrong"
                : "is-dimmed";
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={isPicked}
              disabled={answered}
              className={`lesson-check-choice ${state}`}
              onClick={() => setPicked(i)}
            >
              <span className="lesson-check-marker">
                {answered && isAnswer ? (
                  <FaCheck aria-hidden="true" />
                ) : answered && isPicked ? (
                  <FaTimes aria-hidden="true" />
                ) : (
                  String.fromCharCode(65 + i)
                )}
              </span>
              <span>{choice}</span>
            </button>
          );
        })}
      </div>

      {answered ? (
        <div className={`lesson-check-why ${correct ? "is-correct" : "is-wrong"}`}>
          <span className="lesson-check-verdict">
            {correct ? "That's it." : "Not quite."}
          </span>{" "}
          {withInlineCode(block.why)}
        </div>
      ) : null}
    </div>
  );
}

export default function LessonView({
  apiBase,
  language,
  category,
  languageLabel,
  onPractice,
  onBack,
}) {
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setLesson(null);
    fetch(`${apiBase}/api/coding/learn/${language}/${category}`)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load this lesson.");
        return r.json();
      })
      .then((data) => {
        // `lesson: null` means "not authored yet" — a real, expected state, not an error.
        if (alive) setLesson(data.lesson);
        // Record the read only when a real lesson loaded, so "not authored yet"
        // pages don't count toward the reading badges.
        if (alive && data.lesson) markLessonRead(language, category);
      })
      .catch((err) => {
        if (alive) setError(err.message || "Could not load this lesson.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiBase, language, category]);

  if (loading) return <p className="cq-loading">Loading lesson…</p>;
  if (error) return <p className="cq-error">{error}</p>;

  if (!lesson) {
    return (
      <div className="lesson-empty">
        <h2>This lesson is being written</h2>
        <p>
          We haven't finished the {languageLabel} lesson for this topic yet. The
          practice questions for it may already be here.
        </p>
        <button type="button" className="lesson-practice-cta" onClick={onPractice}>
          Try the practice questions <FaArrowRight aria-hidden="true" />
        </button>
        <button type="button" className="learn-back-link" onClick={onBack}>
          <FaArrowLeft aria-hidden="true" /> Back to {languageLabel}
        </button>
      </div>
    );
  }

  return (
    <article className="lesson-view">
      <header className="lesson-head">
        <span className="lesson-kicker">{languageLabel}</span>
        <h1>{lesson.title}</h1>
        {lesson.summary ? <p className="lesson-summary">{lesson.summary}</p> : null}
        {lesson.minutes ? (
          <span className="lesson-minutes">
            <FaClock aria-hidden="true" /> {lesson.minutes} min read
          </span>
        ) : null}
      </header>

      {/* Read-aloud. Free browser TTS — reads the prose, skips code and the checks. */}
      <LessonPlayBar lesson={lesson} />

      <div className="lesson-body">
        {lesson.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>

      {/* The handoff. Reading without doing doesn't stick, so a lesson always exits
          into the quiz on the same topic rather than into nothing. */}
      <footer className="lesson-foot">
        <p>Ready to check it?</p>
        <button type="button" className="lesson-practice-cta" onClick={onPractice}>
          Practice {lesson.title} <FaArrowRight aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}
