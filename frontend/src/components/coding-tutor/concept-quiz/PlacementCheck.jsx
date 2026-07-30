import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildPlacementQuestionSet,
  buildPlacementRecommendation,
} from "../startingPath";

export default function PlacementCheck({ onClose, onUseRecommendation }) {
  const advanceTimerRef = useRef(null);
  const [questions] = useState(() => buildPlacementQuestionSet());
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    };
  }, []);

  const answeredCount = useMemo(
    () => questions.filter((question) => answers[question.id]?.display_index != null).length,
    [questions, answers]
  );
  const question = questions[index];

  const selectChoice = (choice, choiceIndex) => {
    if (!question || result) return;
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    setAnswers((current) => ({
      ...current,
      [question.id]: {
        choice_index: choice.originalIndex ?? choiceIndex,
        display_index: choiceIndex,
        unsure: Boolean(choice.unsure),
      },
    }));
    if (index < questions.length - 1) {
      advanceTimerRef.current = window.setTimeout(() => {
        setIndex((value) => Math.min(value + 1, questions.length - 1));
      }, 280);
    }
  };

  const submit = async () => {
    if (answeredCount !== questions.length) {
      setError("Answer each question before checking your starting point.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      setResult({
        recommendation: buildPlacementRecommendation({
          questions,
          answers,
        }),
      });
    } catch (err) {
      setError(err.message || "Could not grade the placement check.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cq-placement-backdrop" role="presentation">
    <section
      className="cq-placement-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cq-placement-title"
    >
      <div className="cq-placement-dialog-inner">
        <header className="cq-placement-header">
          <div>
            <span className="cq-hero-eyebrow">Quick starting check</span>
            <h3 id="cq-placement-title">Find your starting point</h3>
            <p>Pick what feels closest. If you are unsure, that is useful too.</p>
          </div>
          <button type="button" className="cq-placement-close" onClick={onClose} aria-label="Close placement check">
            X
          </button>
        </header>

        {error ? <p className="cq-error">{error}</p> : null}

        {!result && question ? (
          <>
            <div className="cq-placement-progress">
              <span>Question {index + 1} of {questions.length}</span>
              <span>{answeredCount} answered</span>
            </div>
            <div className="cq-placement-track" aria-hidden="true">
              {questions.map((item, itemIndex) => (
                <span
                  key={item.id}
                  className={`${answers[item.id] ? "done" : ""} ${itemIndex === index ? "current" : ""}`}
                />
              ))}
            </div>
            <article className="cq-placement-question">
              <small>{String(question.placement_category || "foundation").replaceAll("-", " ")}</small>
              <p>{question.prompt}</p>
              {question.code ? <pre className="cq-code"><code>{question.code}</code></pre> : null}
              <div className="cq-choices" role="radiogroup">
                {(question.choices || []).map((choice, choiceIndex) => {
                  const selected = answers[question.id]?.display_index === choiceIndex;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`cq-choice ${selected ? "selected" : ""}`}
                      key={`${question.id}-${choice.originalIndex}-${choiceIndex}`}
                      onClick={() => selectChoice(choice, choiceIndex)}
                    >
                      <span className="cq-choice-marker">{String.fromCharCode(65 + choiceIndex)}</span>
                      <span className="cq-choice-text">
                        {choice.code ? <code>{choice.code}</code> : choice.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </article>
            <footer className="cq-placement-actions">
              <button type="button" className="cq-btn cq-btn-ghost" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>
                Previous
              </button>
              {index < questions.length - 1 ? (
                <button
                  type="button"
                  className="cq-btn cq-btn-primary"
                  disabled={answers[question.id]?.display_index == null}
                  onClick={() => setIndex((value) => value + 1)}
                >
                  Next
                </button>
              ) : (
                <button type="button" className="cq-btn cq-btn-primary" disabled={submitting || answeredCount !== questions.length} onClick={submit}>
                  {submitting ? "Checking..." : "Show my starting point"}
                </button>
              )}
            </footer>
          </>
        ) : null}

        {result ? (
          <div className="cq-placement-result">
            <span className="cq-placement-score">Ready</span>
            <h4>{result.recommendation.title || "Try this next"}</h4>
            <p>{result.recommendation.reason || result.recommendation.blurb}</p>
            <div className="cq-placement-actions">
              <button type="button" className="cq-btn cq-btn-ghost" onClick={onClose}>Close</button>
              <button
                type="button"
                className="cq-btn cq-btn-primary"
                onClick={() => onUseRecommendation(result.recommendation)}
              >
                {result.recommendation.actionLabel || "Start here"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
    </div>
  );
}
