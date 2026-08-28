function authHeaders(extra = {}) {
  const token = localStorage.getItem("token");
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseJsonResponse(res, fallbackMessage) {
  if (!res.ok) {
    let detail = fallbackMessage || `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // keep fallback
    }
    throw new Error(detail);
  }
  return res.json();
}

export function normalizeBackendRecommendation(payload) {
  const recommendation = payload?.recommendation || payload;
  if (!recommendation || typeof recommendation !== "object") return null;
  const target = recommendation.target || {};
  const miniPlan = recommendation.miniPlan || recommendation.mini_plan || [];
  return {
    ...recommendation,
    planId: recommendation.planId || recommendation.plan_id || null,
    planContext: recommendation.planContext || recommendation.plan_context || null,
    actionLabel: recommendation.actionLabel || recommendation.action_label || "Open recommendation",
    beginnerMode: Boolean(recommendation.beginnerMode ?? recommendation.beginner_mode),
    reviewSignal: recommendation.reviewSignal || recommendation.review_signal || null,
    miniPlan,
    mini_plan: miniPlan,
    target: {
      ...target,
      questionId: target.questionId || target.question_id || null,
      actionLabel: target.actionLabel || target.action_label || null,
    },
    raw: payload,
  };
}

export async function fetchAdaptiveNextStep(apiBase, { language = "python", surface = "home" } = {}) {
  const url = new URL(`${apiBase}/api/coding/adaptive/next-step`);
  url.searchParams.set("language", language);
  url.searchParams.set("surface", surface);
  const res = await fetch(url.toString(), {
    headers: authHeaders(),
  });
  const data = await parseJsonResponse(res, "Could not load the next-step recommendation.");
  return normalizeBackendRecommendation(data);
}

export async function recordLearningEvent(apiBase, payload = {}) {
  const res = await fetch(`${apiBase}/api/coding/learning-events`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res, "Could not save this learning event.");
}

export async function fetchStartingCheckProgress(apiBase, language = "python") {
  const url = new URL(`${apiBase}/api/coding/starting-check`);
  url.searchParams.set("language", language);
  const res = await fetch(url.toString(), {
    headers: authHeaders(),
  });
  return parseJsonResponse(res, "Could not load the starting check.");
}

export async function saveStartingCheckProgress(apiBase, { language = "python", status, recommendation, answers, resultLevel }) {
  const res = await fetch(`${apiBase}/api/coding/starting-check`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      language,
      status,
      recommendation,
      answers,
      result_level: resultLevel || recommendation?.level || null,
    }),
  });
  return parseJsonResponse(res, "Could not save the starting check.");
}

export async function saveLearnProgress(apiBase, { language = "python", category, status = "completed" }) {
  const res = await fetch(`${apiBase}/api/coding/learn/progress`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ language, category, status }),
  });
  return parseJsonResponse(res, "Could not save lesson progress.");
}
