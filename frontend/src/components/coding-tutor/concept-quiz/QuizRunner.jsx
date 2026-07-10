import { useEffect, useMemo, useRef, useState } from "react";
import { FaRegQuestionCircle, FaBookOpen } from "react-icons/fa";

// Sequential concept-quiz runner. Renders one question at a time in a split
// layout (code/statement left with Question|Learn tabs, answer UI right),
// tracks answers, and on Submit shows a green/red results screen.
//
// Question kinds:
//   mcq-output / mcq-behavior → pick one of `choices` (grade vs answer_index)
//   typein                    → type text (grade vs `accepted`, case-sensitive)
//   parsons                   → drag the shuffled `lines` into the correct order
//
// Grading is done server-side via `onGrade` (the /grade endpoint) so answers
// aren't trusted from the client. The parent supplies questions, current index
// (from the URL), and navigation callbacks so the Back button steps through.

// Deterministic shuffle seeded by the question id, so the scrambled Parsons
// order is stable across re-renders (no Math.random re-scrambling on keypress)
// but still differs per question.
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
  // Avoid the (rare) already-sorted scramble so it's never a freebie.
  const sorted = arr.every((item, i) => item.index === i);
  if (sorted && arr.length > 1) {
    [arr[0], arr[1]] = [arr[1], arr[0]];
  }
  return arr.map((item) => item.value);
}

function ParsonsBoard({ question, value, onChange }) {
  // `value` is the student's current ordering (array of line strings).
  const initial = useMemo(
    () => value ?? seededShuffle(question.lines, question.id),
    // Re-seed only when the question changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question.id]
  );
  const [order, setOrder] = useState(initial);
  const dragIndex = useRef(null);

  // Keep parent in sync when we first mount / re-seed for a new question.
  useEffect(() => {
    setOrder(initial);
    onChange(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const move = (from, to) => {
    if (from === to || from == null || to == null) return;
    const next = order.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    onChange(next);
  };

  return (
    <div className="cq-parsons">
      <p className="cq-parsons-hint">Drag the lines into the correct order.</p>
      <ul className="cq-parsons-list">
        {order.map((line, index) => (
          <li
            key={`${line}-${index}`}
            className="cq-parsons-line"
            draggable
            onDragStart={() => {
              dragIndex.current = index;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              move(dragIndex.current, index);
              dragIndex.current = null;
            }}
          >
            <span className="cq-parsons-grip" aria-hidden="true">
              ⠿
            </span>
            <code>{line || " "}</code>
            <span className="cq-parsons-controls">
              <button
                type="button"
                aria-label="Move line up"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move line down"
                disabled={index === order.length - 1}
                onClick={() => move(index, index + 1)}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerPanel({ question, answer, onAnswer }) {
  if (question.kind === "typein") {
    return (
      <div className="cq-answer cq-answer-typein">
        <label className="cq-typein-label" htmlFor="cq-typein">
          {question.typein_mode === "code"
            ? "Type your code:"
            : "Type your answer:"}
        </label>
        <textarea
          id="cq-typein"
          className="cq-typein-input"
          rows={question.typein_mode === "code" ? 3 : 1}
          spellCheck={false}
          autoComplete="off"
          value={answer?.text ?? ""}
          placeholder={
            question.typein_mode === "code" ? "e.g. print(\"Hello\")" : "Your answer"
          }
          onChange={(event) => onAnswer({ text: event.target.value })}
        />
      </div>
    );
  }

  if (question.kind === "parsons") {
    return (
      <ParsonsBoard
        question={question}
        value={answer?.order}
        onChange={(order) => onAnswer({ order })}
      />
    );
  }

  // MCQ (mcq-output / mcq-behavior)
  return (
    <div className="cq-answer cq-answer-mcq">
      <p className="cq-answer-heading">Select one of the following options:</p>
      <div className="cq-choices" role="radiogroup">
      {question.choices.map((choice, index) => {
        const selected = answer?.choice_index === index;
        return (
          <button
            type="button"
            key={index}
            role="radio"
            aria-checked={selected}
            className={`cq-choice ${selected ? "selected" : ""}`}
            onClick={() => onAnswer({ choice_index: index })}
          >
            <span className="cq-choice-marker">
              {String.fromCharCode(65 + index)}
            </span>
            <span className="cq-choice-text">{choice}</span>
          </button>
        );
      })}
      </div>
    </div>
  );
}

function LearnTab({ categoryLabel }) {
  return (
    <div className="cq-learn-panel">
      <div className="cq-learn-badge">Coming soon</div>
      <h4>Learn: {categoryLabel}</h4>
      <p>
        Short lessons on {categoryLabel.toLowerCase()} will live here so you can
        brush up before you practice. For now, use the Question tab — and the
        floating Coding Tutor is always available if you get stuck.
      </p>
    </div>
  );
}

function ResultsScreen({ grade, questions, onRetry, onBackToCategory }) {
  const byId = useMemo(() => {
    const map = {};
    grade.results.forEach((r) => {
      map[r.question_id] = r;
    });
    return map;
  }, [grade]);

  const pct = Math.round((grade.score || 0) * 100);
  return (
    <div className="cq-results">
      <div className="cq-results-header">
        <div className={`cq-score-ring ${pct >= 70 ? "pass" : "try-again"}`}>
          <span className="cq-score-pct">{pct}%</span>
          <span className="cq-score-frac">
            {grade.correct}/{grade.total}
          </span>
        </div>
        <div className="cq-results-copy">
          <h3>{pct >= 70 ? "Nice work!" : "Keep going"}</h3>
          <p>
            You got {grade.correct} of {grade.total} correct. Review the ones you
            missed below.
          </p>
        </div>
      </div>

      <ul className="cq-results-list">
        {questions.map((q, index) => {
          const r = byId[q.id] || {};
          const ok = r.correct;
          return (
            <li
              key={q.id}
              className={`cq-result-row ${ok ? "correct" : "incorrect"}`}
            >
              <span className="cq-result-bar" aria-hidden="true" />
              <div className="cq-result-body">
                <div className="cq-result-top">
                  <span className="cq-result-num">Q{index + 1}</span>
                  <span className="cq-result-tag">
                    {ok ? "Correct" : "Incorrect"}
                  </span>
                </div>
                <p className="cq-result-prompt">{q.prompt}</p>
                {r.explanation ? (
                  <p className="cq-result-explanation">{r.explanation}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="cq-results-actions">
        <button type="button" className="cq-btn cq-btn-ghost" onClick={onBackToCategory}>
          Back to categories
        </button>
        <button type="button" className="cq-btn cq-btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

export default function QuizRunner({
  categoryLabel,
  questions,
  index,
  onNavigateIndex,
  onGrade,
  onSaveResult,
  onBackToCategory,
}) {
  const [tab, setTab] = useState("question");
  // answersById: { [questionId]: { choice_index? , text?, order? } }
  const [answersById, setAnswersById] = useState({});
  const [grade, setGrade] = useState(null);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");

  // Reset the Learn/Question tab back to Question whenever the question changes.
  useEffect(() => {
    setTab("question");
  }, [index]);

  const question = questions[index];
  const total = questions.length;
  const answered = question ? answersById[question.id] : undefined;
  const isAnswered =
    answered != null &&
    (answered.choice_index != null ||
      (answered.text != null && answered.text.trim() !== "") ||
      (answered.order != null && answered.order.length > 0));

  const answeredCount = useMemo(
    () =>
      questions.filter((q) => {
        const a = answersById[q.id];
        return (
          a != null &&
          (a.choice_index != null ||
            (a.text != null && a.text.trim() !== "") ||
            (a.order != null && a.order.length > 0))
        );
      }).length,
    [questions, answersById]
  );

  if (grade) {
    return (
      <ResultsScreen
        grade={grade}
        questions={questions}
        onBackToCategory={onBackToCategory}
        onRetry={() => {
          setAnswersById({});
          setGrade(null);
          setError("");
          onNavigateIndex(0);
        }}
      />
    );
  }

  if (!question) {
    return <div className="cq-empty">This category has no questions yet.</div>;
  }

  const setAnswer = (patch) => {
    setAnswersById((prev) => ({ ...prev, [question.id]: patch }));
  };

  const submit = async () => {
    setGrading(true);
    setError("");
    try {
      const answers = questions.map((q) => ({
        question_id: q.id,
        ...(answersById[q.id] || {}),
      }));
      const result = await onGrade(answers);
      // Persist the graded result (status dots + best score on the landing).
      onSaveResult?.(result);
      setGrade(result);
    } catch (err) {
      setError(err.message || "Could not grade the quiz. Please try again.");
    } finally {
      setGrading(false);
    }
  };

  const isLast = index === total - 1;

  return (
    <div className="cq-runner cq-runner-full">
      {/* Top header bar, split to match the columns below: Question/Learn tabs on
          the LEFT half, segmented progress + % on the RIGHT half. */}
      <header className="cq-runner-top">
        <div className="cq-runner-top-left">
          <div className="cq-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "question"}
              className={`cq-tab ${tab === "question" ? "active" : ""}`}
              onClick={() => setTab("question")}
            >
              <FaRegQuestionCircle aria-hidden="true" />
              Question
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "learn"}
              className={`cq-tab ${tab === "learn" ? "active" : ""}`}
              onClick={() => setTab("learn")}
            >
              <FaBookOpen aria-hidden="true" />
              Learn
            </button>
          </div>
        </div>

        <div className="cq-runner-top-right">
          <div className="cq-progress-meta">
            <span>
              Question {index + 1} of {total}
            </span>
            <span>·</span>
            <span>{answeredCount} answered</span>
            <span className="cq-progress-pct">
              {Math.round((answeredCount / total) * 100)}%
            </span>
          </div>
          <div
            className="cq-progress-segments"
            role="progressbar"
            aria-valuenow={index + 1}
            aria-valuemin={1}
            aria-valuemax={total}
          >
            {questions.map((q, i) => {
              const a = answersById[q.id];
              const done =
                a != null &&
                (a.choice_index != null ||
                  (a.text != null && a.text.trim() !== "") ||
                  (a.order != null && a.order.length > 0));
              return (
                <button
                  type="button"
                  key={q.id}
                  aria-label={`Go to question ${i + 1}`}
                  className={`cq-progress-seg ${done ? "done" : ""} ${
                    i === index ? "current" : ""
                  }`}
                  onClick={() => onNavigateIndex(i)}
                />
              );
            })}
          </div>
        </div>
      </header>

      <div className="cq-runner-split">
        <div className="cq-runner-left">
          <div className="cq-pane-body">
            {tab === "question" ? (
              <div className="cq-question-panel">
                <p className="cq-prompt">{question.prompt}</p>
                {question.code ? (
                  <pre className="cq-code">
                    <code>{question.code}</code>
                  </pre>
                ) : null}
                {question.goal ? (
                  <p className="cq-goal">
                    <strong>Goal:</strong> {question.goal}
                  </p>
                ) : null}
              </div>
            ) : (
              <LearnTab categoryLabel={categoryLabel} />
            )}
          </div>
        </div>

        <div className="cq-runner-right">
          <div className="cq-pane-body">
            <AnswerPanel
              question={question}
              answer={answered}
              onAnswer={setAnswer}
            />
            {error ? <p className="cq-error">{error}</p> : null}
          </div>

          {/* Both nav buttons live together on the answer side's footer. */}
          <div className="cq-pane-nav">
            <button
              type="button"
              className="cq-btn cq-btn-ghost"
              disabled={index === 0}
              onClick={() => onNavigateIndex(index - 1)}
            >
              Previous
            </button>
            {isLast ? (
              <button
                type="button"
                className="cq-btn cq-btn-primary"
                disabled={grading}
                onClick={submit}
              >
                {grading ? "Grading…" : "Submit quiz"}
              </button>
            ) : (
              <button
                type="button"
                className="cq-btn cq-btn-primary"
                disabled={!isAnswered}
                onClick={() => onNavigateIndex(index + 1)}
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
