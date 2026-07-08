// Post-interview HYBRID grader for mock interviews.
//
//   • Questions with authored test cases  -> deterministic backend grading
//     (POST /api/coding/interview/grade), returns real pass/fail per test. Free, exact.
//   • Questions with no test cases         -> an AI review from the Vertex ADK tutor
//     (POST /chat), returned as a short LABELED verdict, never a hard pass/fail.
//
// Both are best-effort: a failure on one question never blocks the summary. The caller
// shows the summary first, then merges these verdicts in as they arrive.

// fetch with a hard timeout so grading can NEVER hang the summary on "Grading…". If the
// backend/AI is slow or down, the request aborts and the question just shows "Not graded".
async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Heuristic: is this code still the untouched starter stub (no real attempt)? Strips the
// comment/pass scaffolding and checks whether anything meaningful is left. Conservative —
// only treats obviously-empty stubs as "not attempted".
function isStarterStub(code) {
  const meaningful = String(code || "")
    .split("\n")
    .map((line) => line.replace(/#.*$|\/\/.*$/, "").trim())    // strip line comments
    .filter((line) => line && line !== "pass" && !/^def\s|^function\s|^class\s|^int main/.test(line));
  return meaningful.length === 0;
}

// Grade the test-backed questions in one batch. Returns a map: questionId -> grade.
async function gradeWithTests(apiBase, token, problems) {
  const answers = problems
    .filter((p) => (p.code || "").trim())
    .map((p) => ({ question_id: p.id, language: p.language || "python", code: p.code }));
  if (!answers.length) return {};
  try {
    const res = await fetchWithTimeout(`${apiBase}/api/coding/interview/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ answers }),
    }, 15000);
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    (data.results || []).forEach((r) => {
      map[r.question_id] = r;
    });
    return map;
  } catch {
    return {}; // network/runner failure -> those questions fall through to AI/none
  }
}

// Ask the tutor agent for a short verdict on one open-ended answer. Best-effort; a
// failure resolves to null so the question just shows "Not graded".
async function gradeWithAi(apiBase, token, problem) {
  const code = (problem.code || "").trim();
  if (!code) return null;
  const prompt =
    "You are grading a mock coding-interview answer. Be concise and honest.\n\n" +
    `Problem: ${problem.title}\n` +
    (problem.prompt ? `Prompt: ${problem.prompt}\n` : "") +
    `\nCandidate's ${problem.language || "python"} code:\n\`\`\`\n${code}\n\`\`\`\n\n` +
    "In 2-3 sentences, say whether this looks correct and complete, note the single " +
    "biggest issue if any, and end with a verdict of Strong, Passable, or Needs work. " +
    "Do not rewrite the code.";
  try {
    const res = await fetchWithTimeout(`${apiBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: prompt, session_id: "interview-grader", mode: "coding_tutor" }),
    }, 20000);
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.response || data.message || "").trim();
    return text || null;
  } catch {
    return null;
  }
}

// Grade every problem in a summary. Returns a NEW problems array with each problem's
// `grade` filled: { gradedBy: "tests"|"ai"|"none", ... }. Never throws.
export async function gradeMockSummary(apiBase, summary) {
  const token = localStorage.getItem("token");
  const problems = summary.problems || [];

  // 1) deterministic tests (batch)
  const testGrades = token ? await gradeWithTests(apiBase, token, problems) : {};

  // 2) AI fallback only for the ones tests didn't cover, in parallel, best-effort.
  //    Skip AI grading for questions the student didn't really work: skipped /
  //    unattempted, or code still at the untouched starter stub. Grading an empty stub
  //    wastes an API call and produces a pointless "the function body is empty" review.
  const graded = await Promise.all(
    problems.map(async (p) => {
      const tg = testGrades[p.id];
      if (tg && tg.gradedBy === "tests") {
        return { ...p, grade: tg };
      }
      const workedOn = p.outcome === "attempted" || p.outcome === "solved";
      const hasRealCode = (p.code || "").trim() && !isStarterStub(p.code);
      if (!token || !workedOn || !hasRealCode) {
        return { ...p, grade: { gradedBy: "none" } };
      }
      const verdict = await gradeWithAi(apiBase, token, p);
      return {
        ...p,
        grade: verdict
          ? { gradedBy: "ai", label: "AI review", verdict }
          : { gradedBy: "none" },
      };
    }),
  );

  return graded;
}

// Compute a simple 0-100 score from graded problems: a fully-passing tested question
// or a "Strong" AI verdict counts as solved; partial credit for partial test passes.
export function scoreFromGraded(problems) {
  if (!problems.length) return 0;
  let earned = 0;
  problems.forEach((p) => {
    const g = p.grade || {};
    if (g.gradedBy === "tests" && g.total > 0) {
      earned += g.passed / g.total;
    } else if (g.gradedBy === "ai" && /strong/i.test(g.verdict || "")) {
      earned += 1;
    } else if (g.gradedBy === "ai" && /passable/i.test(g.verdict || "")) {
      earned += 0.5;
    }
  });
  return Math.round((earned / problems.length) * 100);
}
