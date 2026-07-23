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
const QUIZ_DRAFT_PREFIX = "cq_answers";

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

export function quizDraftKey(language, category) {
  return `${QUIZ_DRAFT_PREFIX}:${language}:${category}`;
}

export function readQuizDraftAnswers(language, category) {
  try {
    const raw = sessionStorage.getItem(quizDraftKey(language, category));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeQuizDraftAnswers(language, category, answers) {
  try {
    const draftKey = quizDraftKey(language, category);
    if (!answers || !Object.keys(answers).length) sessionStorage.removeItem(draftKey);
    else sessionStorage.setItem(draftKey, JSON.stringify(answers));
  } catch {
    // Storage unavailable/full — the quiz still works, it just won't resume.
  }
}

// ── Lesson-read tracking ────────────────────────────────────────────────────
// Learn has no backend yet, so "completed this lesson" lives in the same local store
// as quiz progress, one flat set of "language:category" keys.
// Swappable for a coding_learn_progress table later without touching callers.
const LESSONS_KEY = `${PREFIX}:lessons_completed_v2`;
const LEGACY_LESSONS_KEY = `${PREFIX}:lessons_read`;

function readLessonSet() {
  try {
    const raw =
      localStorage.getItem(LESSONS_KEY) ??
      localStorage.getItem(LEGACY_LESSONS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!localStorage.getItem(LESSONS_KEY) && raw) {
      localStorage.setItem(LESSONS_KEY, JSON.stringify(arr));
    }
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

// Mark one lesson as read. Idempotent — called on lesson open, so it fires often
// and must stay cheap and side-effect-free beyond the write.
export function hasReadLesson(language, category) {
  if (!language || !category) return false;
  return readLessonSet().has(`${language}:${category}`);
}

export function countReadLessons(language, categories = []) {
  if (!language || !Array.isArray(categories)) return 0;
  const set = readLessonSet();
  return categories.filter((category) =>
    category?.has_lesson && set.has(`${language}:${category.id}`)
  ).length;
}

export function markLessonRead(language, category) {
  if (!language || !category) return;
  const set = readLessonSet();
  const id = `${language}:${category}`;
  if (set.has(id)) return;
  set.add(id);
  try {
    localStorage.setItem(LESSONS_KEY, JSON.stringify([...set]));
  } catch {
    // storage full / unavailable — non-fatal.
  }
}

// ── Aggregate progress for the badge system ─────────────────────────────────
// Scans every concept_quiz_progress:<lang>:<cat> record and folds it into the
// signals the achievement badges read. One localStorage pass, tolerant of any
// malformed record (skips it rather than throwing).
export function summarizeLearnQuizProgress() {
  const PASS = 0.7; // a "passed" quiz — matches the quiz UI's PASS_THRESHOLD
  const out = {
    lessonsRead: 0,
    quizCategoriesAttempted: 0,
    quizCategoriesPassed: 0,
    quizPerfectCategories: 0,     // scored 100% on at least one attempt
    quizLanguages: new Set(),
    totalQuizCorrect: 0,
  };

  try {
    out.lessonsRead = readLessonSet().size;
  } catch {
    out.lessonsRead = 0;
  }

  let scanned = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${PREFIX}:`) || k === LESSONS_KEY || k === LEGACY_LESSONS_KEY) continue;
      // key shape: concept_quiz_progress:<language>:<category>
      const parts = k.split(":");
      if (parts.length < 3) continue;
      const language = parts[1];
      let record;
      try {
        record = JSON.parse(localStorage.getItem(k));
      } catch {
        continue;
      }
      if (!record || !record.best) continue;
      scanned += 1;
      out.quizCategoriesAttempted += 1;
      out.quizLanguages.add(language);
      const best = record.best;
      if (typeof best.score === "number" && best.score >= PASS) {
        out.quizCategoriesPassed += 1;
      }
      if (best.total > 0 && best.correct === best.total) {
        out.quizPerfectCategories += 1;
      }
      // Count correct answers from the best attempt of each category.
      if (typeof best.correct === "number") out.totalQuizCorrect += best.correct;
    }
  } catch {
    // localStorage wholly unavailable — return zeros, badges just stay locked.
  }

  return {
    lessonsRead: out.lessonsRead,
    quizCategoriesAttempted: out.quizCategoriesAttempted,
    quizCategoriesPassed: out.quizCategoriesPassed,
    quizPerfectCategories: out.quizPerfectCategories,
    quizLanguagesCount: out.quizLanguages.size,
    totalQuizCorrect: out.totalQuizCorrect,
    _scanned: scanned,
  };
}
