import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPlacementQuiz, gradePlacementQuiz } from "./conceptQuizApi";

export default function PlacementCheck({ apiBase, language, onClose, onUseRecommendation }) {
  const dialogRef = useRef(null);
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchPlacementQuiz(apiBase, language)
      .then((data) => {
        if (alive) setQuestions(data.questions || []);
      })
      .catch((err) => {
        if (alive) setError(err.message || "Could not load the placement check.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiBase, language]);

  // Native <dialog> gives us focus-move-on-open, a focus trap, Escape-to-close,
  // and focus restore on close for free. showModal() records the previously
  // focused element and returns focus there when the dialog closes.
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return undefined;
    if (!node.open) node.showModal();
    const handleCancel = (event) => {
      event.preventDefault(); // don't let Escape close without running onClose
      onClose?.();
    };
    node.addEventListener("cancel", handleCancel);
    return () => {
      node.removeEventListener("cancel", handleCancel);
      if (node.open) node.close();
    };
  }, [onClose]);

  const answeredCount = useMemo(
    () => questions.filter((question) => answers[question.id]?.choice_index != null).length,
    [questions, answers]
  );
  const question = questions[index];

  const submit = async () => {
    if (answeredCount !== questions.length) {
      setError("Answer all five questions before checking your starting point.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = questions.map((item) => ({
        question_id: item.id,
        ...answers[item.id],
      }));
      setResult(await gradePlacementQuiz(apiBase, language, payload));
    } catch (err) {
      setError(err.message || "Could not grade the placement check.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="cq-placement-dialog"
      aria-labelledby="cq-placement-title"
      onClose={onClose}
    >
      <div className="cq-placement-dialog-inner">
        <header className="cq-placement-header">
          <div>
            <span className="cq-hero-eyebrow">Five quick questions</span>
            <h3 id="cq-placement-title">Find your starting point</h3>
          </div>
          <button type="button" className="cq-placement-close" onClick={onClose} aria-label="Close placement check">
            X
          </button>
        </header>

        {loading ? <p className="cq-loading">Loading placement check...</p> : null}
        {error ? <p className="cq-error">{error}</p> : null}

        {!loading && !result && question ? (
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
                  const selected = answers[question.id]?.choice_index === choiceIndex;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`cq-choice ${selected ? "selected" : ""}`}
                      key={`${question.id}-${choiceIndex}`}
                      onClick={() => setAnswers((current) => ({
                        ...current,
                        [question.id]: { choice_index: choiceIndex },
                      }))}
                    >
                      <span className="cq-choice-marker">{String.fromCharCode(65 + choiceIndex)}</span>
                      <span className="cq-choice-text">{choice}</span>
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
                  disabled={answers[question.id]?.choice_index == null}
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
            <span className="cq-placement-score">{result.correct}/{result.total}</span>
            <h4>Start with the {result.recommendation.track} track</h4>
            <p>{result.recommendation.reason}</p>
            <div className="cq-placement-actions">
              <button type="button" className="cq-btn cq-btn-ghost" onClick={onClose}>Close</button>
              <button
                type="button"
                className="cq-btn cq-btn-primary"
                onClick={() => onUseRecommendation(result.recommendation)}
              >
                Show my recommended topic
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
