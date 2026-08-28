import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaRegQuestionCircle,
  FaBookOpen,
  FaArrowRight,
  FaArrowUp,
  FaArrowDown,
  FaCheckCircle,
  FaTimesCircle,
  FaVolumeUp,
  FaStopCircle,
  FaGripVertical,
} from "react-icons/fa";
import {
  clearQuizLastResult,
  getOrCreateQuizChoiceSeed,
  readQuizDraftAnswers,
  readQuizLastResult,
  resetQuizChoiceSeed,
  writeQuizDraftAnswers,
  writeQuizLastResult,
} from "./conceptQuizProgress";
import { handleHorizontalRovingKeyDown } from "../keyboardNavigation";

// Sequential concept-quiz runner. Renders one question at a time in a split
// layout (code/statement left with Question|Learn tabs, answer UI right),
// tracks answers, and on Submit shows a green/red results screen.
//
// Question kinds:
//   mcq-output / mcq-behavior -> pick one of `choices` (grade vs answer_index)
//   typein                    -> type text (grade vs `accepted`, case-sensitive)
//   parsons                   -> drag the shuffled `lines` into the correct order
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

function isMcqQuestion(question) {
  return question?.kind === "mcq-output" || question?.kind === "mcq-behavior";
}

function cleanSpeechText(value) {
  return String(value ?? "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SPEECH_PAUSE_TOKEN = "[[pause]]";
const SPEECH_SEGMENT_PAUSE_MS = 650;
const SPEECH_WAIT_FOR_REVIEW_MS = 9000;

function speechSegmentsFromText(value) {
  return String(value ?? "")
    .split(SPEECH_PAUSE_TOKEN)
    .map(cleanSpeechText)
    .filter(Boolean);
}

function speechAvailable() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

function ReadAloudButton({ text, label = "Read aloud", className = "", waitForUpdatesMs = 0 }) {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const waitingForUpdateRef = useRef(false);
  const segmentsRef = useRef([]);
  const segmentIndexRef = useRef(0);
  const pauseTimerRef = useRef(null);
  const waitTimerRef = useRef(null);
  const lastTextRef = useRef("");
  const supported = speechAvailable();
  const spokenText = String(text ?? "");
  const hasText = speechSegmentsFromText(spokenText).length > 0;

  const stopSpeech = () => {
    if (pauseTimerRef.current) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (waitTimerRef.current) {
      window.clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    waitingForUpdateRef.current = false;
    segmentsRef.current = [];
    segmentIndexRef.current = 0;
    setSpeaking(false);
  };

  const waitForReviewUpdate = () => {
    if (!waitForUpdatesMs) {
      speakingRef.current = false;
      waitingForUpdateRef.current = false;
      setSpeaking(false);
      return;
    }

    waitingForUpdateRef.current = true;
    waitTimerRef.current = window.setTimeout(() => {
      waitTimerRef.current = null;
      waitingForUpdateRef.current = false;
      speakingRef.current = false;
      setSpeaking(false);
    }, waitForUpdatesMs);
  };

  const speakNextSegment = () => {
    if (!speakingRef.current) return;
    const segment = segmentsRef.current[segmentIndexRef.current];
    if (!segment) {
      speakingRef.current = false;
      setSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(segment);
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.onend = () => {
      segmentIndexRef.current += 1;
      if (segmentIndexRef.current < segmentsRef.current.length) {
        pauseTimerRef.current = window.setTimeout(() => {
          pauseTimerRef.current = null;
          speakNextSegment();
        }, SPEECH_SEGMENT_PAUSE_MS);
      } else {
        waitForReviewUpdate();
      }
    };
    utterance.onerror = () => stopSpeech();
    window.speechSynthesis.speak(utterance);
  };

  const startSpeech = (nextText) => {
    const nextSegments = speechSegmentsFromText(nextText);
    if (!nextSegments.length) return;
    window.speechSynthesis.cancel();
    if (waitTimerRef.current) {
      window.clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    segmentsRef.current = nextSegments;
    segmentIndexRef.current = 0;
    speakingRef.current = true;
    waitingForUpdateRef.current = false;
    lastTextRef.current = String(nextText ?? "");
    setSpeaking(true);
    speakNextSegment();
  };

  useEffect(() => {
    if (!supported) return undefined;
    return () => {
      stopSpeech();
    };
  }, [supported]);

  useEffect(() => {
    if (!supported || !speakingRef.current) {
      lastTextRef.current = spokenText;
      return;
    }

    const previous = lastTextRef.current;
    if (!previous || spokenText === previous) return;

    if (spokenText.startsWith(previous)) {
      const added = spokenText.slice(previous.length);
      const addedSegments = speechSegmentsFromText(added);
      if (addedSegments.length) {
        segmentsRef.current = [...segmentsRef.current, ...addedSegments];
        if (waitingForUpdateRef.current) {
          if (waitTimerRef.current) {
            window.clearTimeout(waitTimerRef.current);
            waitTimerRef.current = null;
          }
          waitingForUpdateRef.current = false;
          speakNextSegment();
        }
      }
    } else {
      startSpeech(spokenText);
    }

    lastTextRef.current = spokenText;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spokenText, supported]);

  if (!supported || !hasText) return null;

  const toggleSpeech = () => {
    if (speaking) {
      stopSpeech();
      return;
    }

    startSpeech(spokenText);
  };

  return (
    <button
      type="button"
      className={`cq-read-aloud ${speaking ? "speaking" : ""} ${className}`.trim()}
      onClick={toggleSpeech}
      aria-pressed={speaking}
      title={speaking ? "Stop reading" : label}
    >
      {speaking ? <FaStopCircle aria-hidden="true" /> : <FaVolumeUp aria-hidden="true" />}
      <span>{speaking ? "Stop" : label}</span>
    </button>
  );
}

function choiceOrderFor(question, seed) {
  if (!isMcqQuestion(question)) return [];
  const indexes = question.choices.map((_, index) => index);
  return seededShuffle(indexes, `${seed}:${question.id}`);
}

function ParsonsBoard({ question, value, onChange, disabled = false }) {
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
    if (!value) {
      onChange(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const move = (from, to) => {
    if (disabled) return;
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
            className={`cq-parsons-line ${disabled ? "locked" : ""}`}
            draggable={!disabled}
            onDragStart={() => {
              if (disabled) return;
              dragIndex.current = index;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (disabled) return;
              move(dragIndex.current, index);
              dragIndex.current = null;
            }}
          >
            <span className="cq-parsons-grip" aria-hidden="true">
              <FaGripVertical />
            </span>
            <code>{line || " "}</code>
            <span className="cq-parsons-controls">
              <button
                type="button"
                aria-label="Move line up"
                title="Move line up"
                disabled={disabled || index === 0}
                onClick={() => move(index, index - 1)}
              >
                <FaArrowUp aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Move line down"
                title="Move line down"
                disabled={disabled || index === order.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <FaArrowDown aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnswerPanel({ question, answer, onAnswer, choiceOrder = [], locked = false }) {
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
          disabled={locked}
          placeholder={
            question.typein_mode === "code" ? "Enter one statement" : "Your answer"
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
        disabled={locked}
      />
    );
  }

  // MCQ (mcq-output / mcq-behavior)
  const displayOrder = choiceOrder.length
    ? choiceOrder
    : question.choices.map((_, index) => index);
  return (
    <div className="cq-answer cq-answer-mcq">
      <p className="cq-answer-heading">Select one of the following options:</p>
      <div className="cq-choices" role="radiogroup">
        {displayOrder.map((originalIndex, displayIndex) => {
          const choice = question.choices[originalIndex];
          const selected = answer?.choice_index === originalIndex;
          return (
            <button
              type="button"
              key={originalIndex}
              role="radio"
              aria-checked={selected}
              className={`cq-choice ${selected ? "selected" : ""}`}
              disabled={locked}
              onClick={() =>
                onAnswer({ choice_index: originalIndex, display_index: displayIndex })
              }
            >
              <span className="cq-choice-marker">
                {String.fromCharCode(65 + displayIndex)}
              </span>
              <span className="cq-choice-text">{withChoiceEmphasis(choice)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const OPERATOR_TOKEN_RE = /(===|!==|==|!=|>=|<=|\+=|-=|\*=|\/=|%=|\+\+|--|&&|\|\||\/\/|\*\*|\b(?:and|or|not)\b|[+\-*/%=<>!^])/g;
const OPERATOR_TOKENS = new Set([
  "===",
  "!==",
  "==",
  "!=",
  ">=",
  "<=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "++",
  "--",
  "&&",
  "||",
  "//",
  "**",
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "<",
  ">",
  "!",
  "^",
  "and",
  "or",
  "not",
]);

// Options should read like answer choices, not little code dumps. The quiz data
// uses backticks to mark snippets, but bolding the whole snippet can give away the
// answer. Strip the marks and emphasize only the operator symbols inside.
function withChoiceEmphasis(text) {
  return String(text || "").split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return part.slice(1, -1).split(OPERATOR_TOKEN_RE).map((piece, pieceIndex) =>
        OPERATOR_TOKENS.has(piece.toLowerCase()) ? (
          <code
            className="cq-choice-emphasis"
            key={`choice-emphasis-${index}-${pieceIndex}`}
          >
            {piece}
          </code>
        ) : (
          piece
        )
      );
    }
    return part;
  });
}

// The refresher, shown beside the question the student is answering.
//
// This is deliberately NOT the whole lesson; mid-question, a student needs a reminder,
// not a chapter. It comes from the SAME file as the full lesson (see backend/lessons.py),
// so the two can never drift apart and tell them different things. If a reminder isn't
// enough, "Read the full lesson" takes them to Learn on this exact topic.
function LearnTab({ apiBase, language, category, categoryLabel, questionId, onOpenLesson }) {
  const [refresher, setRefresher] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRefresher(null);
    const query = questionId ? `?question_id=${encodeURIComponent(questionId)}` : "";
    fetch(`${apiBase}/api/coding/learn/${language}/${category}/refresher${query}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive) setRefresher(data?.refresher || null);
      })
      .catch(() => {
        // A missing refresher is not an error the student needs to see; the Question
        // tab still works. Fall through to the "not written yet" copy below.
        if (alive) setRefresher(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiBase, language, category, questionId]);

  if (loading) return <div className="cq-learn-panel"><p>Loading...</p></div>;

  if (!refresher) {
    return (
      <div className="cq-learn-panel">
        <div className="cq-learn-badge">Coming soon</div>
        <h4>Learn: {categoryLabel}</h4>
        <p>
          The lesson for {categoryLabel.toLowerCase()} is still being written. Use the
          Question tab, and the floating Coding Tutor is always there if you get stuck.
        </p>
      </div>
    );
  }

  return (
    <div className="cq-learn-panel">
      <h4>{refresher.title}</h4>
      <p className="cq-learn-refresher">{withInlineCode(refresher.refresher)}</p>
      {refresher.notice ? (
        <p className="cq-learn-refresher">
          <strong>What to notice:</strong> {withInlineCode(refresher.notice)}
        </p>
      ) : null}
      {refresher.mistake ? (
        <p className="cq-learn-refresher">
          <strong>Common mistake:</strong> {withInlineCode(refresher.mistake)}
        </p>
      ) : null}
      {refresher.refresher_code ? (
        <pre className="cq-learn-code">
          <code>{refresher.refresher_code}</code>
        </pre>
      ) : null}
      {onOpenLesson ? (
        <button
          type="button"
          className="cq-learn-more"
          onClick={() => onOpenLesson(language, category)}
        >
          Read the full lesson <FaArrowRight aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

// `inline code` becomes <code>. Not a markdown parser: refresher text is plain sentences we
// author ourselves, so pulling in a renderer would mean sanitizing HTML we already control.
function withInlineCode(text) {
  const codeParts = String(text || "").split(/(`[^`]+`)/g);
  return codeParts.flatMap((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return [<code key={`code-${i}`}>{part.slice(1, -1)}</code>];
    }
    return part.split(/(\*\*[^*]+\*\*)/g).map((piece, j) =>
      piece.startsWith("**") && piece.endsWith("**") && piece.length > 4 ? (
        <strong key={`strong-${i}-${j}`}>{piece.slice(2, -2)}</strong>
      ) : (
        piece
      )
    );
  });
}

function splitExplanation(text) {
  const sentences = String(text || "")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return {
    summary: sentences.slice(0, 2).join(" "),
    detail: sentences.slice(2).join(" "),
  };
}

function formatAnswer(value) {
  const clean = (text) => String(text)
    .replace(/\u00e2\u20ac\u201d/g, "-")
    .replace(/\u00e2\u20ac\u201c/g, "-")
    .replace(/\u00e2\u20ac\u00a6/g, "...")
    .replace(/\u00e2\u20ac\u02dc|\u00e2\u20ac\u2122/g, "'")
    .replace(/\u00e2\u20ac\u0153|\u00e2\u20ac\ufffd/g, "\"")
    .replace(/\u00c2\u00b7/g, " - ")
    .replace(/\u00c2\u00a0/g, " ");
  if (Array.isArray(value)) return value.map(clean).join("\n");
  if (value == null || value === "") return "No answer";
  return clean(value);
}

function sentence(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function quotedAnswer(value) {
  return `"${formatAnswer(value)}"`;
}

function buildAnswerOptionsSpeech(question, choiceOrder = []) {
  if (!question) return "";

  if (isMcqQuestion(question)) {
    const displayOrder = choiceOrder.length
      ? choiceOrder
      : question.choices.map((_, index) => index);
    return displayOrder
      .map((originalIndex, displayIndex) => {
        const letter = String.fromCharCode(65 + displayIndex);
        return `Option ${letter}: ${question.choices[originalIndex]}.`;
      })
      .join(` ${SPEECH_PAUSE_TOKEN} `);
  }

  if (question.kind === "typein") {
    return question.typein_mode === "code"
      ? "Type the code answer in the answer box."
      : "Type your answer in the answer box.";
  }

  if (question.kind === "parsons") {
    return `Arrange these lines in the correct order: ${(question.lines || []).join("; ")}.`;
  }

  return "";
}

function isAnswerComplete(answer) {
  return (
    answer != null &&
    (answer.choice_index != null ||
      (answer.text != null && answer.text.trim() !== "") ||
      (answer.order != null && answer.order.length > 0))
  );
}

function firstParsonsMismatch(studentLines, expectedLines) {
  const max = Math.max(studentLines.length, expectedLines.length);
  for (let index = 0; index < max; index += 1) {
    if (studentLines[index] !== expectedLines[index]) return index;
  }
  return -1;
}

function gradeAnswerLocally(question, answer) {
  if (!question || !answer) {
    return {
      correct: false,
      studentAnswer: null,
      correctAnswer: null,
    };
  }

  if (question.kind === "mcq-output" || question.kind === "mcq-behavior") {
    const selected = answer.choice_index;
    const correctIndex = question.answer_index;
    return {
      correct: selected === correctIndex,
      studentAnswer:
        typeof selected === "number" ? question.choices?.[selected] : null,
      correctAnswer:
        typeof correctIndex === "number" ? question.choices?.[correctIndex] : null,
    };
  }

  if (question.kind === "typein") {
    const submitted = String(answer.text || "").trim();
    const accepted = question.accepted || [];
    return {
      correct: accepted.map((item) => String(item).trim()).includes(submitted),
      studentAnswer: submitted || null,
      correctAnswer: accepted[0] || null,
    };
  }

  if (question.kind === "parsons") {
    const order = answer.order || [];
    const expected = question.lines || [];
    const firstMismatch = firstParsonsMismatch(order, expected);
    return {
      correct:
        order.length === expected.length &&
        order.every((line, index) => line === expected[index]),
      studentAnswer: order,
      correctAnswer: expected,
      firstMismatch,
    };
  }

  return {
    correct: false,
    studentAnswer: null,
    correctAnswer: null,
  };
}

function buildImmediateReview(question, result, explanation) {
  if (result.correct) {
    return {
      summary: explanation.summary || "This answer follows the rule being tested.",
      points: [],
      nextStep: "",
    };
  }

  const points = [];
  const correct = quotedAnswer(result.correctAnswer);
  const picked = quotedAnswer(result.studentAnswer);
  const explanationText = sentence(
    explanation.summary ||
      "The correct answer follows the rule shown in the question."
  );
  let summary = `You picked ${picked}. That would make sense if that choice matched what the code or rule actually produces. ${explanationText} So the answer is ${correct}.`;

  if (question.kind === "mcq-output" || question.kind === "mcq-behavior") {
    if (explanation.detail) {
      points.push(sentence(explanation.detail));
    }
  } else if (question.kind === "typein") {
    summary = `You typed ${picked}. The expected answer is ${correct}. ${explanationText}`;
    const exactMatchNote =
      "Check spelling, punctuation, capitalization, spacing, and quotes.";
    if (question.typein_mode === "code") {
      points.push(`${exactMatchNote} Then check the operator, variable name, and syntax.`);
    } else {
      points.push(exactMatchNote);
    }
  } else if (question.kind === "parsons") {
    const step = result.firstMismatch >= 0 ? result.firstMismatch + 1 : 1;
    const studentLine = Array.isArray(result.studentAnswer)
      ? result.studentAnswer[result.firstMismatch]
      : null;
    const expectedLine = Array.isArray(result.correctAnswer)
      ? result.correctAnswer[result.firstMismatch]
      : null;
    summary = `The first line out of order is step ${step}. ${explanationText}`;
    points.push(
      `The first line that looks out of place is step ${step}. You placed "${formatAnswer(studentLine)}", but that spot should be "${formatAnswer(expectedLine)}".`
    );
  }

  return {
    summary,
    points,
    nextStep: "",
  };
}

function buildImmediateReviewSpeech(question, answer) {
  if (!answer?.checked) return "";

  const result = gradeAnswerLocally(question, answer);
  const explanation = splitExplanation(question.explanation);
  const review = buildImmediateReview(question, result, explanation);
  const status = result.correct ? "Correct." : "Not quite.";
  const answerReview = result.correct
    ? ""
    : `Your answer was ${formatAnswer(result.studentAnswer)}. The correct answer is ${formatAnswer(result.correctAnswer)}.`;
  const points = review.points.length ? `Notes: ${review.points.join(" ")}` : "";

  return [
    status,
    answerReview,
    review.summary,
    points,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildQuestionSpeech(question, index, total, choiceOrder = [], answer) {
  if (!question) return "";

  const optionsSpeech = buildAnswerOptionsSpeech(question, choiceOrder);
  const reviewSpeech = buildImmediateReviewSpeech(question, answer);

  return [
    `Question ${index + 1} of ${total}.`,
    question.prompt,
    question.code ? `Code: ${question.code}` : "",
    question.goal ? `Goal: ${question.goal}` : "",
    optionsSpeech ? SPEECH_PAUSE_TOKEN : "",
    optionsSpeech,
    reviewSpeech ? SPEECH_PAUSE_TOKEN : "",
    reviewSpeech,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildResultSpeech(question, result, index) {
  if (!question || !result) return "";

  const ok = Boolean(result.correct);
  const explanation = splitExplanation(result.explanation || question.explanation || "");
  const answerReview = ok
    ? ""
    : `Your answer was ${formatAnswer(result.student_answer)}. The correct answer is ${formatAnswer(result.correct_answer)}.`;

  return [
    `Question ${index + 1}.`,
    question.prompt,
    ok ? "Correct." : "Incorrect.",
    answerReview,
    explanation.summary,
    explanation.detail,
  ]
    .filter(Boolean)
    .join(" ");
}

export function ImmediateFeedback({ question, answer, onReviewLesson }) {
  if (!answer?.checked) return null;

  const result = gradeAnswerLocally(question, answer);
  const explanation = splitExplanation(question.explanation);
  const review = buildImmediateReview(question, result, explanation);
  const Icon = result.correct ? FaCheckCircle : FaTimesCircle;

  return (
    <aside
      className={`cq-immediate-feedback ${result.correct ? "correct" : "incorrect"}`}
      aria-live="polite"
    >
      <div className="cq-immediate-feedback-head">
        <Icon aria-hidden="true" />
        <div>
          <strong>{result.correct ? "Correct" : "Not quite"}</strong>
          <span>{result.correct ? "Why it works" : "What went wrong"}</span>
        </div>
      </div>

      {!result.correct ? (
        <div className="cq-immediate-answer-review">
          <div>
            <span>Your answer</span>
            <code>{formatAnswer(result.studentAnswer)}</code>
          </div>
          <div>
            <span>Correct answer</span>
            <code>{formatAnswer(result.correctAnswer)}</code>
          </div>
        </div>
      ) : null}

      <p>{withChoiceEmphasis(review.summary)}</p>

      {!result.correct && review.points.length ? (
        <ul className="cq-feedback-points">
          {review.points.map((point, pointIndex) => (
            <li key={pointIndex}>{withChoiceEmphasis(point)}</li>
          ))}
        </ul>
      ) : null}

      {!result.correct && review.nextStep ? (
        <p className="cq-feedback-next">
          <strong>Next:</strong> {review.nextStep}
        </p>
      ) : null}

      {!result.correct && onReviewLesson ? (
        <button type="button" className="cq-feedback-review" onClick={onReviewLesson}>
          Review this in Learn
        </button>
      ) : null}
    </aside>
  );
}

function ResultsScreen({
  grade,
  questions,
  onRetry,
  onBackToCategory,
  backLabel = "Back to categories",
}) {
  const byId = useMemo(() => {
    const map = {};
    grade.results.forEach((r) => {
      map[r.question_id] = r;
    });
    return map;
  }, [grade]);

  const pct = Math.round((grade.score || 0) * 100);
  const missed = Math.max(0, (grade.total || 0) - (grade.correct || 0));
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
          <h3>{missed === 0 ? "Clean sweep!" : pct >= 70 ? "Nice work!" : "Keep going"}</h3>
          <p>
            {missed === 0
              ? `You got all ${grade.total} correct. Open any row below if you want to review the reasoning.`
              : `You got ${grade.correct} of ${grade.total} correct. The missed questions are expanded for review.`}
          </p>
        </div>
        <div className="cq-results-stats" aria-label="Quiz result summary">
          <span><strong>{grade.correct}</strong><small>correct</small></span>
          <span><strong>{missed}</strong><small>missed</small></span>
          <span><strong>{grade.total}</strong><small>total</small></span>
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
                  <ReadAloudButton
                    className="cq-result-read"
                    label="Read review"
                    text={buildResultSpeech(q, r, index)}
                  />
                </div>
                <p className="cq-result-prompt">{q.prompt}</p>
                {!ok ? (
                  <div className="cq-result-answer-review">
                    <div className="cq-result-answer student">
                      <span>Your answer</span>
                      <code>{formatAnswer(r.student_answer)}</code>
                    </div>
                    <div className="cq-result-answer correct">
                      <span>Correct answer</span>
                      <code>{formatAnswer(r.correct_answer)}</code>
                    </div>
                  </div>
                ) : null}
                {r.explanation ? (() => {
                  const explanation = splitExplanation(r.explanation);
                  return ok ? (
                    <details className="cq-result-more cq-result-correct-more">
                      <summary>Why it works</summary>
                      <p>{withChoiceEmphasis(explanation.summary)}</p>
                      {explanation.detail ? (
                        <p>{withChoiceEmphasis(explanation.detail)}</p>
                      ) : null}
                    </details>
                  ) : (
                    <div className="cq-result-explanation">
                      <strong>{ok ? "Why it works" : "What happened"}</strong>
                      <p>{withChoiceEmphasis(explanation.summary)}</p>
                      {explanation.detail ? (
                        <details className="cq-result-more">
                          <summary>More detail</summary>
                          <p>{withChoiceEmphasis(explanation.detail)}</p>
                        </details>
                      ) : null}
                    </div>
                  );
                })() : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="cq-results-actions">
        <button type="button" className="cq-btn cq-btn-ghost" onClick={onBackToCategory}>
          {backLabel}
        </button>
        <button type="button" className="cq-btn cq-btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

export default function QuizRunner({
  apiBase,
  language,
  category,
  categoryLabel,
  questions,
  index,
  onNavigateIndex,
  onGrade,
  onSaveResult,
  onBackToCategory,
  backLabel,
  onOpenLesson,
}) {
  const [tab, setTab] = useState("question");

  // answersById: { [questionId]: { choice_index? , text?, order? } }
  //
  // Persisted per (language, category) for the SESSION, because this component unmounts
  // the moment a student leaves the quiz  to check a lesson, to look at Code, to answer
  // the door. Held in plain state, every answer they'd given was silently destroyed, and
  // a half-finished quiz could not be resumed at all.
  //
  // sessionStorage, not localStorage: an abandoned quiz should not still be sitting there
  // next week. It should survive a detour, not outlive the visit.
  const [answersById, setAnswersById] = useState(() =>
    readQuizDraftAnswers(language, category)
  );
  const [grade, setGrade] = useState(() => readQuizLastResult(language, category));
  const [choiceSeed, setChoiceSeed] = useState(() =>
    getOrCreateQuizChoiceSeed(language, category)
  );
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");

  // Load the saved answers when the student switches to a DIFFERENT quiz (the component
  // is reused across categories, so the initial state above only runs once).
  useEffect(() => {
    setAnswersById(readQuizDraftAnswers(language, category));
    setGrade(readQuizLastResult(language, category));
    setChoiceSeed(getOrCreateQuizChoiceSeed(language, category));
    setError("");
  }, [language, category]);

  useEffect(() => {
    writeQuizDraftAnswers(language, category, answersById);
  }, [language, category, answersById]);

  // Reset the Learn/Question tab back to Question whenever the question changes.
  useEffect(() => {
    setTab("question");
  }, [index]);

  const question = questions[index];
  const questionCategory = question?.category || category;
  const questionCategoryLabel = question?.category_label || categoryLabel;
  const total = questions.length;
  const answered = question ? answersById[question.id] : undefined;
  const isAnswered = isAnswerComplete(answered);
  const isChecked = Boolean(answered?.checked);
  const choiceOrders = useMemo(() => {
    const byQuestion = {};
    questions.forEach((item) => {
      if (isMcqQuestion(item)) {
        byQuestion[item.id] = choiceOrderFor(item, choiceSeed);
      }
    });
    return byQuestion;
  }, [questions, choiceSeed]);

  const answeredCount = useMemo(
    () => questions.filter((q) => isAnswerComplete(answersById[q.id])).length,
    [questions, answersById]
  );

  const checkedCount = useMemo(
    () => questions.filter((q) => answersById[q.id]?.checked).length,
    [questions, answersById]
  );

  const currentReadAloudText = useMemo(
    () =>
      buildQuestionSpeech(
        question,
        index,
        total,
        question ? choiceOrders[question.id] : [],
        answered
      ),
    [answered, choiceOrders, index, question, total]
  );

  if (grade) {
    return (
      <ResultsScreen
        grade={grade}
        questions={questions}
        onBackToCategory={onBackToCategory}
        backLabel={backLabel}
        onRetry={() => {
          setAnswersById({});
          setGrade(null);
          clearQuizLastResult(language, category);
          setChoiceSeed(resetQuizChoiceSeed(language, category));
          setError("");
          onNavigateIndex(0);
        }}
      />
    );
  }

  if (!question) {
    return <div className="cq-empty">This category has no questions yet.</div>;
  }

  const isLast = index === total - 1;
  const allChecked = checkedCount === total;

  const setAnswer = (patch) => {
    const shouldCheck =
      question.kind === "mcq-output" || question.kind === "mcq-behavior";
    const nextAnswer = {
      ...patch,
      checked: shouldCheck,
    };

    setAnswersById((prev) => ({
      ...prev,
      [question.id]: nextAnswer,
    }));

  };

  const checkAnswer = () => {
    if (!isAnswered) return;
    const nextAnswer = {
      ...(answered || {}),
      checked: true,
    };
    setAnswersById((prev) => ({
      ...prev,
      [question.id]: nextAnswer,
    }));
  };

  const submit = async () => {
    setGrading(true);
    setError("");
    try {
      const answers = questions.map((q) => {
        const {
          checked: _checked,
          display_index: _displayIndex,
          ...answer
        } = answersById[q.id] || {};
        return {
          question_id: q.id,
          ...answer,
        };
      });
      const result = await onGrade(answers);
      // Persist the graded result (status dots + best score on the landing).
      onSaveResult?.(result);
      writeQuizDraftAnswers(language, category, {});
      writeQuizLastResult(language, category, result);
      setAnswersById({});
      setGrade(result);
    } catch (err) {
      setError(err.message || "Could not grade the quiz. Please try again.");
    } finally {
      setGrading(false);
    }
  };

  return (
    <div className={`cq-runner cq-runner-full cq-tab-${tab}`}>
      {/* Top header bar, split to match the columns below: Question/Learn tabs on
          the LEFT half, segmented progress + % on the RIGHT half. */}
      <header className="cq-runner-top">
        <div className="cq-runner-top-left">
          <div className="cq-tabs" role="tablist" aria-label="Concept quiz panels" onKeyDown={handleHorizontalRovingKeyDown}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "question"}
              tabIndex={tab === "question" ? 0 : -1}
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
              tabIndex={tab === "learn" ? 0 : -1}
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
            <span>/</span>
            <span>{answeredCount} answered</span>
            <span>/</span>
            <span>{checkedCount} checked</span>
            <span className="cq-progress-pct">
              {Math.round((checkedCount / total) * 100)}%
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
              const done = Boolean(a?.checked);
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
                <div className="cq-question-tools">
                  <ReadAloudButton text={currentReadAloudText} waitForUpdatesMs={SPEECH_WAIT_FOR_REVIEW_MS} />
                </div>
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
              <LearnTab
                apiBase={apiBase}
                language={language}
                category={questionCategory}
                categoryLabel={questionCategoryLabel}
                questionId={question.id}
                onOpenLesson={onOpenLesson}
              />
            )}
          </div>
        </div>

        <div className="cq-runner-right">
          <div className="cq-pane-body">
            <AnswerPanel
              question={question}
              answer={answered}
              onAnswer={setAnswer}
              choiceOrder={choiceOrders[question.id]}
              locked={isChecked}
            />
            <ImmediateFeedback
              question={question}
              answer={answered}
              onReviewLesson={() => setTab("learn")}
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
            {!isChecked ? (
              <button
                type="button"
                className="cq-btn cq-btn-primary"
                disabled={!isAnswered}
                onClick={checkAnswer}
              >
                Check answer
              </button>
            ) : isLast ? (
              <button
                type="button"
                className="cq-btn cq-btn-primary"
                disabled={grading || !allChecked}
                onClick={submit}
                title={!allChecked ? "Check every question before submitting." : ""}
              >
                {grading ? "Grading..." : "Submit quiz"}
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
