// Local (per-browser) progress store for concept quizzes. Saved on Submit and
// read by the language landing to show per-question status dots + each
// category's best score. No backend yet — a coding_concept_progress table can
// replace this store later without changing the callers.
//
// Storage shape, one key per language+category:
//   concept_quiz_progress:<language>:<category> = {
//     best: { correct, total, score, at },        // best attempt so far
//     last: { correct, total, score, at },        // most recent attempt
//     questions: { [questionId]: "correct" | "incorrect" }  // latest per-Q result
//   }

const PREFIX = "concept_quiz_progress";

function key(language, category) {
  return `${PREFIX}:${language}:${category}`;
}

export function readCategoryProgress(language, category) {
  try {
    const raw = localStorage.getItem(key(language, category));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Save a graded result. `grade` is the /grade response
// ({ correct, total, score, results:[{question_id, correct}] }). Keeps the best
// attempt, records the last, and stores each question's latest correct/incorrect.
// `stampAt` is an optional timestamp (ms) — pass Date.now() from the caller since
// this module stays side-effect free otherwise. Returns the updated record.
export function saveCategoryResult(language, category, grade, stampAt) {
  const prev = readCategoryProgress(language, category) || {};
  const attempt = {
    correct: grade.correct,
    total: grade.total,
    score: grade.score,
    at: stampAt ?? null,
  };

  const questions = { ...(prev.questions || {}) };
  (grade.results || []).forEach((r) => {
    if (r && r.question_id) {
      questions[r.question_id] = r.correct ? "correct" : "incorrect";
    }
  });

  // Best = higher score; ties keep the earlier best.
  const best =
    prev.best && prev.best.score >= attempt.score ? prev.best : attempt;

  const record = { best, last: attempt, questions };
  try {
    localStorage.setItem(key(language, category), JSON.stringify(record));
  } catch {
    // storage full / unavailable — non-fatal; the results screen still shows.
  }
  return record;
}

// Convenience: the latest correct/incorrect for one question ("correct" |
// "incorrect" | null if never answered).
export function readQuestionStatus(language, category, questionId) {
  const prog = readCategoryProgress(language, category);
  return prog?.questions?.[questionId] || null;
}
