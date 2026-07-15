// Client for the concept-quiz backend (CodeChef-style MCQ / type-in / Parsons).
// Endpoints live in backend/main.py under /api/coding/concept-quiz/*. These are
// thin fetch wrappers that throw on non-2xx so callers can show one error state.

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(detail);
  }
  return res.json();
}

// The 4 language cards shown when the student toggles to Quiz mode.
export function fetchQuizLanguages(apiBase) {
  return getJson(`${apiBase}/api/coding/concept-quiz/languages`);
}

// The shared categories plus one language-specific category for one language, each
// with a live `count` and `scope`.
export function fetchQuizCategories(apiBase, language) {
  return getJson(
    `${apiBase}/api/coding/concept-quiz/${encodeURIComponent(language)}/categories`
  );
}

// Every question in one language + category, projected to that language.
export function fetchQuizQuestions(apiBase, language, category) {
  return getJson(
    `${apiBase}/api/coding/concept-quiz/${encodeURIComponent(language)}/${encodeURIComponent(
      category
    )}/questions`
  );
}

// Server-verified grading for a submitted set. `answers` is a list of
// { question_id, choice_index? , text?, order? } depending on question kind.
export async function gradeQuiz(apiBase, { language, category, answers }) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${apiBase}/api/coding/concept-quiz/grade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ language, category, answers }),
  });
  if (!res.ok) {
    let detail = `Grading failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // keep generic
    }
    throw new Error(detail);
  }
  return res.json();
}
