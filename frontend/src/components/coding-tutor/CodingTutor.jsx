import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaBook,
  FaChartLine,
  FaEye,
  FaEyeSlash,
  FaFileCode,
  FaHome,
  FaLaptopCode,
  FaMoon,
  FaSun,
  FaUserGraduate,
} from "react-icons/fa";
import { toast } from "sonner";
import CodeWorkspace from "./CodeWorkspace";
import CampusLabHome from "./CampusLabHome";
import DailyChallengeCard from "./DailyChallengeCard";
import PersonalPanel from "./PersonalPanel";
import ProblemPanel from "./ProblemPanel";
import ProgressBadges from "./ProgressBadges";
import QuizBank from "./QuizBank";
import StatTiles from "./StatTiles";
import InterviewPrep from "./InterviewPrep";
import PastInterviews from "./PastInterviews";
import MockInterviewBar from "./MockInterviewBar";
import MockSummary from "./MockSummary";
import MockConfirm from "./MockConfirm";
import { gradeMockSummary, scoreFromGraded } from "./interviewGrade";
import { appendInterviewAttempt } from "./interviewHistory";
import { markInterviewSolved } from "./interviewProgress";
import {
  saveDraft,
  readDraft,
  clearDraft,
  saveLastWorkspace,
  readLastWorkspace,
  clearLastWorkspace,
} from "./workspaceDraft";
import { listSnippets, getSnippet, saveSnippet, deleteSnippet, syncSnippetsFromServer, extractCodeFromFile, languageFromFilename } from "../../lib/snippets";
import "./CodingTutor.css";
// Scoped "Morgan Coding Lab" sub-brand palette — imported AFTER CodingTutor.css
// so its --ct-* token re-points win over the inherited global chain.
import "./CodingTutorTheme.css";

const CODE_LANGUAGES = ["Python", "Java", "JavaScript", "C++"];
// The exact primary topic strings the Practice Library (Quiz Bank) filters on — the
// filter matches question.topic, so a prerequisite link only lands on real problems if
// it resolves to one of THESE. Keep in sync with backend/data_sources/quiz.
const PRACTICE_LIBRARY_TOPICS = [
  "arrays", "strings", "stacks", "queues", "trees", "graphs", "recursion",
  "hash maps", "sets", "two pointers", "sliding window", "binary search",
  "dynamic programming", "prefix sums", "intervals", "heaps", "tries", "matrices",
  "math", "disjoint sets", "conditionals",
];
// Prerequisite labels used on interview problems don't always match the library's exact
// topic name. This maps a label -> the library topic it should filter by. Anything not
// here and not already a library topic has NO matching problems -> shown greyed out.
const PREREQ_TO_LIBRARY_TOPIC = {
  "hash sets": "sets",
  "hashing": "hash maps",
  "2d matrices": "matrices",
  "matrix": "matrices",
  "binary search idea": "binary search",
  "binary search trees": "trees",
  "breadth-first search": "graphs",
  "bfs": "graphs",
  "prefix sums": "prefix sums",
};
// Resolve a prerequisite label to a real Practice Library topic, or null if the library
// has nothing for it (so the UI can grey it out instead of dead-linking).
function resolvePracticeTopic(label) {
  const key = String(label || "").toLowerCase().trim();
  if (PRACTICE_LIBRARY_TOPICS.includes(key)) return key;
  const mapped = PREREQ_TO_LIBRARY_TOPIC[key];
  return mapped && PRACTICE_LIBRARY_TOPICS.includes(mapped) ? mapped : null;
}
const PRACTICE_LANGUAGE_API = {
  Python: "python",
  Java: "java",
  JavaScript: "javascript",
  "C++": "cpp",
};
// Reverse of PRACTICE_LANGUAGE_API: api key -> display name (for restoring the
// last workspace, where we persist the api-language key).
const PRACTICE_LANGUAGE_NAME = {
  python: "Python",
  java: "Java",
  javascript: "JavaScript",
  cpp: "C++",
};
const PRACTICE_LANGUAGE_KEYS = ["python", "java", "javascript", "cpp"];
const PRACTICE_DIFFICULTIES = ["easy", "medium", "hard"];

const CODING_PAGES = [
  { id: "dashboard", label: "Home", icon: FaHome },
  { id: "quiz", label: "Practice Library", icon: FaBook },
  { id: "interview", label: "Interview Prep", icon: FaUserGraduate },
  { id: "workspace", label: "Workspace", icon: FaLaptopCode },
  { id: "progress", label: "Progress", icon: FaChartLine },
];

// Each Coding Tutor section is a real route under /coding. `activePage` (the
// existing internal id) is derived FROM the URL; navigation writes the URL.
// The component stays mounted across these routes, so shared state (active
// problem, code, mock session, …) is never lost — only the rendered section
// changes. "daily" has no nav button but is reachable from the Home card.
const PAGE_TO_PATH = {
  dashboard: "/coding",
  quiz: "/coding/practice",
  interview: "/coding/interview-prep",
  history: "/coding/interview-prep/history",
  workspace: "/coding/workspace",
  progress: "/coding/progress",
  daily: "/coding/daily",
};
const PATH_TO_PAGE = {
  "/coding": "dashboard",
  "/coding/practice": "quiz",
  "/coding/interview-prep": "interview",
  "/coding/interview-prep/history": "history",
  "/coding/workspace": "workspace",
  "/coding/progress": "progress",
  "/coding/daily": "daily",
};
// Back-compat: old links used /coding?page=<id>. Map those ids to the new paths.
const LEGACY_PAGE_QUERY_TO_PATH = {
  dashboard: "/coding",
  quiz: "/coding/practice",
  interview: "/coding/interview-prep",
  workspace: "/coding/workspace",
  progress: "/coding/progress",
};
function pageFromPath(pathname) {
  // Trim a trailing slash (except the root) so "/coding/practice/" still maps.
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  // Any /coding/workspace/* sub-path (personal, problem/:id) is still the
  // "workspace" section — the suffix selects what's open WITHIN the workspace.
  if (clean === "/coding/workspace" || clean.startsWith("/coding/workspace/")) return "workspace";
  return PATH_TO_PAGE[clean] || "dashboard";
}

// Parse the workspace sub-route: which thing is open inside the workspace.
// → { kind: "personal" } | { kind: "problem", id } | { kind: "snippet", id }
//   | { kind: "none" }
function workspaceTargetFromPath(pathname) {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (clean === "/coding/workspace/personal") return { kind: "personal" };
  const problemMatch = clean.match(/^\/coding\/workspace\/problem\/(.+)$/);
  if (problemMatch) return { kind: "problem", id: decodeURIComponent(problemMatch[1]) };
  const snippetMatch = clean.match(/^\/coding\/workspace\/snippet\/(.+)$/);
  if (snippetMatch) return { kind: "snippet", id: decodeURIComponent(snippetMatch[1]) };
  return { kind: "none" };
}
// Interview-set ids are prefixed "iv-" (e.g. iv-easy-01); everything else is the
// practice set. Lets a cold-loaded /problem/:id fetch from the right library.
function questionSetForId(id) {
  return String(id || "").startsWith("iv-") ? "interview" : "practice";
}
const workspacePathForProblem = (id) => `/coding/workspace/problem/${encodeURIComponent(id)}`;
const workspacePathForSnippet = (id) => `/coding/workspace/snippet/${encodeURIComponent(id)}`;

const LANGUAGE_FORMATS = {
  Python: { file: "solution.py", style: "Function-focused" },
  Java: { file: "Solution.java", style: "Class method" },
  JavaScript: { file: "solution.js", style: "Function export" },
  "C++": { file: "solution.cpp", style: "Solution class" },
};

function progressKey(questionId, language) {
  return `coding_practice_progress:${questionId}:${language}`;
}

function readLocalProgress(questionId, language) {
  try {
    const raw = localStorage.getItem(progressKey(questionId, language));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("[coding-progress] local fallback read failed", error);
    return null;
  }
}

function writeLocalProgress(questionId, language, progress) {
  try {
    localStorage.setItem(progressKey(questionId, language), JSON.stringify(progress));
  } catch (error) {
    console.warn("[coding-progress] local fallback write failed", error);
  }
}

function clearLocalProgress(questionId, language) {
  try {
    localStorage.removeItem(progressKey(questionId, language));
  } catch (error) {
    console.warn("[coding-progress] local fallback clear failed", error);
  }
}

// ── Daily-challenge streak (gamification, #8) ─────────────────────────────
// We record the local date (YYYY-MM-DD) each day the student practices the daily
// challenge, then count back from today to get a real consecutive-day streak.
// Per-device only (localStorage) — no backend needed.
const DAILY_STREAK_KEY = "coding_daily_streak_days";

function localDateKey(date = new Date()) {
  // Local calendar date, not UTC, so "today" matches the student's clock.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readDailyStreakDays() {
  try {
    const raw = localStorage.getItem(DAILY_STREAK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (error) {
    console.warn("[coding-streak] read failed", error);
    return [];
  }
}

// Mark today as a daily-challenge completion. Returns the updated day list.
function recordDailyChallengeDay() {
  const today = localDateKey();
  const days = readDailyStreakDays();
  if (!days.includes(today)) days.push(today);
  // Keep the list bounded — a year of dates is plenty for a streak count.
  const trimmed = days.sort().slice(-370);
  try {
    localStorage.setItem(DAILY_STREAK_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.warn("[coding-streak] write failed", error);
  }
  return trimmed;
}

// Count consecutive days ending today (or yesterday — so an unfinished today
// doesn't break a streak until the day actually rolls over).
function computeDailyStreak(days = readDailyStreakDays()) {
  if (!days.length) return 0;
  const set = new Set(days);
  const cursor = new Date();
  // If today isn't done yet but yesterday was, the streak still stands.
  if (!set.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (set.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// True only when today's daily challenge is already recorded.
function isDailyDoneToday(days = readDailyStreakDays()) {
  return days.includes(localDateKey());
}

// ── Mock-interview completion counter (per-device, for the mock badges) ────────
// A finished mock interview increments this. Read by ProgressBadges via
// progressSummary to award Mock Rookie (1) / Mock Veteran (5).
const MOCK_DONE_KEY = "coding_mock_completed";

function readMockCompleted() {
  try {
    const raw = Number(localStorage.getItem(MOCK_DONE_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch (error) {
    console.warn("[coding-mock] read failed", error);
    return 0;
  }
}

function recordMockCompleted() {
  const next = readMockCompleted() + 1;
  try {
    localStorage.setItem(MOCK_DONE_KEY, String(next));
  } catch (error) {
    console.warn("[coding-mock] write failed", error);
  }
  return next;
}

// ── Best streak ever (so Steady Streak is a trophy you don't un-earn) ─────────
// The current streak resets to 0 when a day is missed; this remembers the highest
// streak reached so the "3-day streak" badge stays earned forever.
const BEST_STREAK_KEY = "coding_best_streak";

function readBestStreak() {
  try {
    const raw = Number(localStorage.getItem(BEST_STREAK_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch (error) {
    console.warn("[coding-streak] best read failed", error);
    return 0;
  }
}

// Persist the max of the stored best and the current streak; returns the new best.
function recordBestStreak(currentStreak = 0) {
  const best = Math.max(readBestStreak(), Number(currentStreak) || 0);
  try {
    localStorage.setItem(BEST_STREAK_KEY, String(best));
  } catch (error) {
    console.warn("[coding-streak] best write failed", error);
  }
  return best;
}

function normalizeSnippet(text = "") {
  return String(text).split("\n").filter(line => line.trim()).slice(0, 5).join("\n");
}

function buildShapeSnippet(solution = {}) {
  const referenceLines = String(solution.reference_solution || "")
    .split("\n")
    .filter(line => line.trim() && !/^\s*(import|from\s+.+\s+import|def\s+|class\s+)/.test(line));
  if (referenceLines.length) return referenceLines.slice(0, 4).join("\n");
  const guided = solution.guided_steps || [];
  const codeLikeStep = guided.find(step => /[=()[\]{}:]|return|for |while |if /.test(String(step)));
  return normalizeSnippet(codeLikeStep || solution.starter_code || "");
}

function normalizeCodeForCompare(value = "") {
  return String(value).replace(/\r\n/g, "\n").trim();
}

function hasStarterCodeChanged(code = "", starterCode = "") {
  const normalizedCode = normalizeCodeForCompare(code);
  const normalizedStarter = normalizeCodeForCompare(starterCode);
  return Boolean(normalizedCode) && normalizedCode !== normalizedStarter;
}

function detectLanguageMismatch(code = "", languageKey = "python") {
  const source = String(code);
  const looksPython = /^\s*def\s+\w+\s*\(/m.test(source)
    || /^\s*from\s+\w+/m.test(source)
    || /^\s*import\s+\w+/m.test(source)
    || /\bNone\b|\bTrue\b|\bFalse\b/.test(source);
  const looksJavaScript = /\bfunction\s+\w+\s*\(/.test(source)
    || /=>/.test(source)
    || /^\s*export\s+/m.test(source)
    || /\bconst\s+\w+|\blet\s+\w+|\bvar\s+\w+/.test(source);

  if (languageKey === "python" && looksJavaScript) {
    return "This code looks like JavaScript, but Python is selected. Switch the language dropdown to JavaScript or load the Python starter before running.";
  }
  if (languageKey === "javascript" && looksPython) {
    return "This code looks like Python, but JavaScript is selected. Switch the language dropdown to Python or load the JavaScript starter before running.";
  }
  return "";
}

function aggregateQuestionProgress(languageProgress = {}) {
  const items = Object.values(languageProgress).filter(Boolean);
  if (!items.length) return null;
  const solved = items.find(item => item.status === "solved");
  const inProgress = items.find(item => item.status === "in_progress" || (item.attempt_count || 0) > 0);
  const base = solved || inProgress || items[0];
  return {
    ...base,
    status: solved ? "solved" : inProgress ? "in_progress" : "not_started",
    attempt_count: items.reduce((sum, item) => sum + (item.attempt_count || 0), 0),
    solved_languages: items.filter(item => item.status === "solved").map(item => item.language),
  };
}

function aggregateProgressMap(progressByLanguage = {}) {
  return Object.fromEntries(
    Object.entries(progressByLanguage)
      .map(([questionId, languageProgress]) => [questionId, aggregateQuestionProgress(languageProgress)])
      .filter(([, progress]) => progress)
  );
}

function summarizeRunForTutor(output = {}) {
  if (!output || output.status === "ready") return "";
  const tests = Array.isArray(output.tests) ? output.tests : [];
  const failed = tests.filter(test => !test.passed);
  const summary = [
    `Runner status: ${output.status || "unknown"}`,
    typeof output.passed === "number" && typeof output.total === "number" ? `Tests: ${output.passed}/${output.total} passed` : "",
    typeof output.duration_ms === "number" ? `Duration: ${Math.round(output.duration_ms)} ms` : "",
    output.stdout ? `stdout:\n${output.stdout}` : "",
    output.stderr ? `stderr:\n${output.stderr}` : "",
    failed.length ? `Failed tests:\n${failed.slice(0, 3).map(test => [
      `- ${test.name || "Unnamed test"}`,
      `  Input: ${JSON.stringify(test.args)}`,
      `  Expected: ${JSON.stringify(test.expected)}`,
      `  Actual: ${JSON.stringify(test.actual)}`,
      test.error ? `  Error: ${test.error}` : "",
    ].filter(Boolean).join("\n")).join("\n")}` : "",
  ].filter(Boolean);
  return summary.join("\n");
}

// A blank editor reads as "broken", so seed a minimal language-appropriate stub
// (function signature + a "write your solution" marker) for interview problems,
// which ship no starter code of their own. Module-level so it can be used both in
// handlers and in a render-time "has the student started coding?" check.
function interviewStarterStub(question, languageName) {
  // Graded interview questions ship an authored starter_code (Python) whose function
  // signature matches the backend test cases — prefer it so what the student fills in
  // is exactly what the grader calls. Other languages fall back to the generic stub
  // (and grade via AI review, since only Python tests are authored).
  if (question?.starter_code && (languageName || "Python").toLowerCase() === "python") {
    return question.starter_code.endsWith("\n") ? question.starter_code : `${question.starter_code}\n`;
  }
  const fn = String(question?.title || "solution")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "solution";
  switch ((languageName || "Python").toLowerCase()) {
    case "javascript":
      return `function ${fn}(input) {\n  // write your solution here\n}\n`;
    case "java":
      return `class Solution {\n    // write your solution here\n}\n`;
    case "c++":
    case "cpp":
      return `// write your solution here\nint main() {\n    return 0;\n}\n`;
    default:
      return `def ${fn}(input):\n    # write your solution here\n    pass\n`;
  }
}

function topicVideoUrl(topic = "") {
  const normalized = topic.toLowerCase();
  if (normalized.includes("two pointers") || normalized.includes("palindrome")) return "https://www.youtube.com/watch?v=On03HWe2tZM";
  if (normalized.includes("hash") || normalized.includes("set")) return "https://www.youtube.com/watch?v=shs0KM3wKv8";
  if (normalized.includes("recursion") || normalized.includes("tree")) return "https://www.youtube.com/watch?v=mz6tAJMVmfM";
  if (normalized.includes("dynamic")) return "https://www.youtube.com/watch?v=oBt53YbR9Kk";
  if (normalized.includes("graph") || normalized.includes("bfs") || normalized.includes("dfs")) return "https://www.youtube.com/watch?v=pcKY4hjDrxk";
  if (normalized.includes("binary")) return "https://www.youtube.com/watch?v=s4DPM8ct1pI";
  if (normalized.includes("stack")) return "https://www.youtube.com/watch?v=Pr6T-3yB9RM";
  return "https://www.youtube.com/watch?v=MK-NZ4hN7rs";
}

function buildHintSteps(problem, solution, attempts) {
  if (!problem) return [];
  const topic = problem.topic || "the main pattern";
  const givenHints = problem.hints || [];
  const guided = solution?.guided_steps || [];
  const shapeSnippet = buildShapeSnippet(solution || {});
  return [
    {
      level: 1,
      title: "Strategy",
      body: givenHints[0] || `Describe the ${topic} idea in plain English first. Name what you compare, count, or store before writing the loop.`,
      locked: false,
    },
    {
      level: 2,
      title: "Key Condition",
      body: givenHints[1] || guided[0] || "Find the exact condition that changes your answer. Test that condition with the smallest input first.",
      locked: false,
    },
    {
      level: 3,
      title: "Code Shape",
      body: shapeSnippet
        ? `Use this only as a shape check:\n\n\`\`\`\n${shapeSnippet}\n\`\`\``
        : givenHints[2] || guided[1] || "Write just the loop or branch that updates your answer, then stop and test it manually.",
      locked: false,
    },
    {
      level: 4,
      title: "Near Solution",
      body: guided[2] || givenHints[2] || "Connect the helper logic to the return value, then test an empty, one-item, and typical input.",
      locked: attempts < 2,
    },
  ];
}

export default function CodingTutor({
  apiBase,
  codeRenderer,
  messages = [],
  onContextChange,
  onActivePageChange,
  onStartFreshChat,
  onSendToWidget,
  onSendToChat,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  // Dark mode is scoped to the Coding Tutor only (the rest of the app stays
  // light). We drive it with `body.coding-dark` instead of the global
  // `body.dark`, so it survives main removing the app-wide dark toggle. Persist
  // separately under "codingTheme".
  const [codingDark, setCodingDark] = useState(
    () => localStorage.getItem("codingTheme") === "dark"
  );
  // The active section is DERIVED from the URL (each section is a real route
  // under /coding). Navigating changes the URL via goToPage(); React re-derives
  // activePage. No setActivePage — use goToPage(id) to switch sections.
  const activePage = pageFromPath(location.pathname);
  const goToPage = useCallback((pageId) => {
    navigate(PAGE_TO_PATH[pageId] || "/coding");
  }, [navigate]);
  const [lastNonWorkspacePage, setLastNonWorkspacePage] = useState("dashboard");
  const [workspaceVisible, setWorkspaceVisible] = useState(true);
  const [workspaceTab, setWorkspaceTab] = useState("Editor");
  const [dailyChallenge, setDailyChallenge] = useState(null);
  const [dailyChallengeLoading, setDailyChallengeLoading] = useState(false);
  // Recorded local dates (YYYY-MM-DD) the student practiced the daily challenge.
  // Drives the real "day streak" tile instead of a derived guess.
  const [dailyStreakDays, setDailyStreakDays] = useState(() => readDailyStreakDays());
  const [difficulty, setDifficulty] = useState("easy");
  // A topic to pre-filter the Practice Library by, set when a student clicks a
  // prerequisite ("Needs: …") link on an interview problem. Consumed + cleared by QuizBank.
  const [pendingQuizTopic, setPendingQuizTopic] = useState(null);
  const [practiceLanguage, setPracticeLanguage] = useState("Python");
  const [selectedLanguage, setSelectedLanguage] = useState("Python");
  const [questions, setQuestions] = useState([]);
  const [allQuestions, setAllQuestions] = useState([]);
  // Interview Prep is its own question library (set=interview): link-only study
  // problems, no autograder/progress. Loaded independently of the practice set.
  const [interviewQuestions, setInterviewQuestions] = useState([]);
  const [interviewLoading, setInterviewLoading] = useState(true);
  // Mock Interview session: a timed run through N picked interview problems.
  // { questions, index, endsAt, startedAt, problemStartedAt,
  //   outcomes: {id: "unattempted"|"attempted"|"solved"|"skipped"},
  //   stuck: [ids] } or null when not running.
  const [mockSession, setMockSession] = useState(null);
  // Live mirror of mockSession so handlers can read the CURRENT session synchronously
  // (a setState updater is not guaranteed to run before the next line). Synced below.
  const mockSessionRef = useRef(null);
  mockSessionRef.current = mockSession;
  const [mockNow, setMockNow] = useState(0); // ticked each second to re-render the timer
  const [mockSummary, setMockSummary] = useState(null); // post-interview results overlay
  // Per-device counters that back the mock + best-streak badges (localStorage).
  const [mockCompleted, setMockCompleted] = useState(() => readMockCompleted());
  const [bestStreak, setBestStreak] = useState(() => readBestStreak());
  // Confirm dialog for mock-mode actions: { title, body, confirmLabel, onConfirm }.
  const [mockConfirm, setMockConfirm] = useState(null);
  const mockSessionActive = Boolean(mockSession); // ticker dep: only (re)start on begin/end
  const [progressByQuestion, setProgressByQuestion] = useState({});
  const [progressByLanguage, setProgressByLanguage] = useState({});
  const [activeProblem, setActiveProblem] = useState(null);
  const [activeSolution, setActiveSolution] = useState(null);
  const [problemLoading, setProblemLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  // Personal "My Snippets" workspace: a fresh, non-graded space separate from the
  // Quiz Bank. snippets are stored per-device in localStorage.
  const [snippets, setSnippets] = useState(() => listSnippets());
  const [activeSnippetId, setActiveSnippetId] = useState(null);
  const personalFileInputRef = useRef(null);
  // The code as it was last saved/loaded, used to detect unsaved changes in the
  // personal workspace so we can warn before the student loses work.
  const [personalSavedCode, setPersonalSavedCode] = useState("");
  // A pending navigation action held while the "unsaved changes" prompt is shown.
  const [unsavedPrompt, setUnsavedPrompt] = useState(null);
  const [code, setCode] = useState("");
  // Live mirrors of the editor code + language key, so the mock-nav setMockSession
  // updaters (which run before React commits fresh state) can snapshot the CURRENT
  // answer without a stale closure. Kept in sync by the effect below.
  const codeRef = useRef("");
  const langKeyRef = useRef("python");
  const [note, setNote] = useState("");
  const [testOutput, setTestOutput] = useState({ status: "ready", message: "" });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  // Lets the Stop button abort an in-flight run. The backend's hard CPU/time
  // limit also kills a truly stuck process, so this frees the UI immediately.
  const runAbortRef = useRef(null);

  const stopRun = useCallback(() => {
    if (runAbortRef.current) {
      runAbortRef.current.abort();
      runAbortRef.current = null;
    }
    setIsRunning(false);
    setTestOutput({ status: "error", free_run: true, tests: [], stdout: "", stderr: "Run stopped.", message: "You stopped the run." });
  }, []);
  const [revealedHints, setRevealedHints] = useState(0);
  const [tutorMode, setTutorMode] = useState("Guided Tutor");
  const [quizPdfStartIndex, setQuizPdfStartIndex] = useState(null);
  const [workspaceSnapshots, setWorkspaceSnapshots] = useState({});
  const questionCacheRef = useRef({});
  const solutionCacheRef = useRef({});
  // Tracks which /coding/workspace/problem/:id we've already restored, so the
  // cold-load effect opens a problem once per id (not on every render).
  const restoredWorkspaceTargetRef = useRef(null);
  // Ensures the "auto-reopen last workspace" fallback only fires once per mount.
  const autoReopenedRef = useRef(false);
  const selectedLanguageKey = PRACTICE_LANGUAGE_API[selectedLanguage] || "python";
  // Mirror the live editor code + language into refs every render so the mock-nav
  // handlers can read the current answer synchronously when switching questions.
  codeRef.current = code;
  langKeyRef.current = selectedLanguageKey;
  const activeLanguageProgress = activeProblem ? progressByLanguage[activeProblem.id]?.[selectedLanguageKey] : null;
  const activeProgress = activeLanguageProgress || (activeProblem ? progressByQuestion[activeProblem.id] : null);
  const attempts = activeProgress?.attempt_count || 0;
  // Interview simulation: pick your language on the FIRST question of the mock, then it
  // LOCKS for the rest of the round (advancing past Q1 commits it — like committing to a
  // language in a real interview). Stays locked even if you go Back to Q1, so a committed
  // language can't be swapped mid-round. Outside a mock it's freely switchable.
  const interviewLanguageLocked = Boolean(mockSession && activeProblem?.mock && mockSession.languageCommitted);
  const hintSteps = useMemo(() => buildHintSteps(activeProblem, activeSolution, attempts), [activeProblem, activeSolution, attempts]);
  const latestFeedback = messages.slice().reverse().find((msg) => msg.sender === "bot" && msg.text)?.text || "";
  const suggestedCodeBlock = latestFeedback.match(/```(?:\w+)?\n([\s\S]*?)```/)?.[1]?.trim() || "";
  const latestQuizResponse = quizPdfStartIndex !== null
    ? messages.slice(quizPdfStartIndex).slice().reverse().find((msg) => msg.sender === "bot" && msg.text)?.text || ""
    : "";
  const languageFormat = LANGUAGE_FORMATS[selectedLanguage] || LANGUAGE_FORMATS.Python;
  const activeQuestionIndex = activeProblem?.source !== "leetcode"
    ? questions.findIndex(question => question.id === activeProblem?.id)
    : -1;
  const isQuizBankProblem = Boolean(activeProblem && activeQuestionIndex >= 0 && activeProblem.source !== "personal");
  const isPersonalMode = activeProblem?.source === "personal";
  // Next/Back cycle only through unsolved problems. Solved problems can still be
  // opened directly from Quiz Bank, but are skipped here to focus on what is left.
  const findAdjacentUnsolvedIndex = useCallback((fromIndex, direction) => {
    for (let index = fromIndex + direction; index >= 0 && index < questions.length; index += direction) {
      if (progressByQuestion[questions[index].id]?.status !== "solved") return index;
    }
    return -1;
  }, [questions, progressByQuestion]);
  const canGoPrevious = activeQuestionIndex >= 0 && findAdjacentUnsolvedIndex(activeQuestionIndex, -1) >= 0;
  const canGoNext = activeQuestionIndex >= 0 && findAdjacentUnsolvedIndex(activeQuestionIndex, 1) >= 0;
  const activeQuestionProgress = activeProblem ? progressByQuestion[activeProblem.id] : null;
  const activeSolvedLanguages = activeQuestionProgress?.solved_languages || [];
  const isActiveProblemSolved = isQuizBankProblem
    && (activeQuestionProgress?.status === "solved" || activeLanguageProgress?.status === "solved");

  const progressQuestions = useMemo(
    () => (allQuestions.length ? allQuestions : questions),
    [allQuestions, questions]
  );
  const progressItems = useMemo(
    () => progressQuestions.map(question => ({ question, progress: progressByQuestion[question.id] })),
    [progressQuestions, progressByQuestion]
  );
  const solvedCount = progressItems.filter(item => item.progress?.status === "solved").length;
  const attemptedCount = progressItems.filter(item => (item.progress?.attempt_count || 0) > 0 || item.progress?.status === "solved").length;
  const totalAttempts = progressItems.reduce((sum, item) => sum + (item.progress?.attempt_count || 0), 0);
  const completionPercent = progressQuestions.length ? Math.round((solvedCount / progressQuestions.length) * 100) : 0;
  // Real consecutive-day streak from daily-challenge completions.
  const displayStreak = useMemo(() => computeDailyStreak(dailyStreakDays), [dailyStreakDays]);
  const dailyDoneToday = useMemo(() => isDailyDoneToday(dailyStreakDays), [dailyStreakDays]);

  // Remember the best streak ever so Steady Streak is a trophy that isn't lost when
  // the current streak resets. Bump the persisted best whenever the streak climbs.
  useEffect(() => {
    if (displayStreak > bestStreak) setBestStreak(recordBestStreak(displayStreak));
  }, [displayStreak, bestStreak]);

  // ── Cross-device sync for the aggregate badge signals (mock count, best streak,
  // daily days). The server is the source of truth; localStorage stays as an
  // offline cache. On mount we GET + merge down (and seed the server from local if
  // it's empty — the migration for existing single-device users). On change we
  // debounce a PUT up. The server merges (max / set-union), so nothing is clobbered
  // and offline just falls back to localStorage. Gated so the first PUT only fires
  // after the initial GET has merged.
  const codingSyncReadyRef = useRef(false);
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/coding/user-progress`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const server = await res.json();
        if (cancelled) return;
        // Merge server → local (max for counters, union for days).
        const localDays = readDailyStreakDays();
        const mergedDays = [...new Set([...localDays, ...(server.daily_days || [])])].sort();
        const mergedMock = Math.max(readMockCompleted(), server.mock_completed || 0);
        const mergedBest = Math.max(readBestStreak(), server.best_streak || 0);
        // Write merged values back to the localStorage cache + state.
        try {
          localStorage.setItem(MOCK_DONE_KEY, String(mergedMock));
          localStorage.setItem(BEST_STREAK_KEY, String(mergedBest));
          localStorage.setItem(DAILY_STREAK_KEY, JSON.stringify(mergedDays.slice(-370)));
        } catch { /* cache write best-effort */ }
        setMockCompleted(mergedMock);
        setBestStreak(mergedBest);
        setDailyStreakDays(mergedDays.slice(-370));
        // If local had more than the server (existing single-device user), push up.
        const serverBehind =
          mergedMock > (server.mock_completed || 0) ||
          mergedBest > (server.best_streak || 0) ||
          mergedDays.length > (server.daily_days || []).length;
        if (serverBehind) {
          fetch(`${apiBase}/api/coding/user-progress`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ mock_completed: mergedMock, best_streak: mergedBest, daily_days: mergedDays }),
          }).catch(() => {});
        }
      } catch {
        // Offline / backend down → keep using localStorage. No UI error.
      } finally {
        if (!cancelled) codingSyncReadyRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  // Debounced PUT when any aggregate signal changes (after the initial sync).
  useEffect(() => {
    if (!codingSyncReadyRef.current) return undefined;
    const token = localStorage.getItem("token");
    if (!token) return undefined;
    const handle = setTimeout(() => {
      fetch(`${apiBase}/api/coding/user-progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mock_completed: mockCompleted,
          best_streak: Math.max(bestStreak, displayStreak),
          daily_days: dailyStreakDays,
        }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(handle);
  }, [apiBase, mockCompleted, bestStreak, displayStreak, dailyStreakDays]);

  const progressSummary = {
    solvedCount, attemptedCount, totalAttempts, completionPercent, displayStreak,
    dailyDaysCompleted: dailyStreakDays.length,
    mockCompleted,
    bestStreak: Math.max(bestStreak, displayStreak),
  };

  // "Up Next" recommendation: the first question the student hasn't started yet
  // (not solved, no attempts). Falls back to the first non-solved if every
  // question has at least been touched. Easy problems come first when ordered.
  const nextUpQuestion = useMemo(() => {
    const ordered = [...progressQuestions].sort((a, b) => {
      const rank = { easy: 0, medium: 1, hard: 2 };
      return (rank[String(a.difficulty || "easy").toLowerCase()] ?? 1)
        - (rank[String(b.difficulty || "easy").toLowerCase()] ?? 1);
    });
    const untouched = ordered.find(q => {
      const p = progressByQuestion[q.id];
      return !p || (p.status !== "solved" && (p.attempt_count || 0) === 0 && p.status !== "in_progress");
    });
    return untouched || ordered.find(q => progressByQuestion[q.id]?.status !== "solved") || null;
  }, [progressQuestions, progressByQuestion]);
  const topicPacks = useMemo(() => {
    const grouped = new Map();
    allQuestions.forEach((question) => {
      const topic = question.topic || "practice";
      const existing = grouped.get(topic) || { topic, count: 0, solved: 0, attempted: 0, videoUrl: topicVideoUrl(topic) };
      const progress = progressByQuestion[question.id];
      existing.count += 1;
      if (progress?.status === "solved") existing.solved += 1;
      if ((progress?.attempt_count || 0) > 0 || progress?.status === "solved") existing.attempted += 1;
      grouped.set(topic, existing);
    });
    return [...grouped.values()].sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)).slice(0, 8);
  }, [allQuestions, progressByQuestion]);
  const activeSnapshotKey = activeProblem ? `${activeProblem.id}:${selectedLanguageKey}` : "personal";
  const activeSnapshots = useMemo(
    () => workspaceSnapshots[activeSnapshotKey] || {},
    [activeSnapshotKey, workspaceSnapshots]
  );
  const runnerSummary = useMemo(() => summarizeRunForTutor(testOutput), [testOutput]);
  const applyAiCode = useCallback(() => {
    if (!suggestedCodeBlock) return;
    setCode(suggestedCodeBlock);
    setWorkspaceSnapshots(prev => ({
      ...prev,
      [activeSnapshotKey]: {
        ...(prev[activeSnapshotKey] || {}),
        aiRewrite: suggestedCodeBlock,
        current: suggestedCodeBlock,
      },
    }));
    toast.success("AI code applied to workspace");
  }, [activeSnapshotKey, suggestedCodeBlock]);

  // All terminal actions (explain error / explain tests / review) send to the FLOATING
  // widget: it opens automatically and appends to the ONE ongoing widget thread, so the
  // reply is visible next to the code and every action in a session stays under one
  // history. Falls back to the plain chat send if the widget handler isn't wired.
  const sendToWidget = useCallback((text, tutorMode) => {
    if (tutorMode) setTutorMode(tutorMode);
    if (onSendToWidget) {
      onSendToWidget(text, { tutorMode });
    } else {
      onSendToChat?.(text, true);
    }
  }, [onSendToWidget, onSendToChat]);

  const explainFailedTests = useCallback(() => {
    const summary = summarizeRunForTutor(testOutput);
    if (!summary) {
      toast.info("Run your code first so the tutor can see the test output.");
      return;
    }
    sendToWidget([
      "Explain these failed tests in small chunks. Point out the likely code issue first, then give one focused next step.",
      "",
      summary,
    ].join("\n"), "Debugging");
  }, [sendToWidget, testOutput]);

  const explainOneTest = useCallback((test, index) => {
    if (!test) return;
    const label = test.name || `Test ${index + 1}`;
    const lines = [
      `Help me with one specific failing test case. Focus only on this case — explain why my code gives the wrong answer here and give one focused next step. Do not rewrite my whole program.`,
      "",
      `Failing case: ${label}`,
      `Input: ${JSON.stringify(test.args)}`,
      `Expected: ${JSON.stringify(test.expected)}`,
      `Actual: ${JSON.stringify(test.actual)}`,
      test.error ? `Error: ${test.error}` : "",
      "",
      `Language: ${selectedLanguage}`,
    ].filter(Boolean);
    sendToWidget(lines.join("\n"), "Debugging");
  }, [sendToWidget, selectedLanguage]);

  const explainError = useCallback(() => {
    const out = testOutput || {};
    const errorText = [out.stderr, out.message].filter(Boolean).join("\n").trim();
    if (!errorText) {
      toast.info("Run your code first so the tutor can see the error.");
      return;
    }
    sendToWidget([
      "My code produced this error when I ran it. In plain English: what does this error mean, what is the most likely cause, and what is one focused fix to try? Do not rewrite my whole program.",
      "",
      `Language: ${selectedLanguage}`,
      "Error output:",
      "```",
      errorText.slice(0, 1500),
      "```",
    ].join("\n"), "Debugging");
  }, [sendToWidget, testOutput, selectedLanguage]);

  const requestReview = useCallback(() => {
    if (!code || !code.trim()) {
      toast.info("Write some code first so the tutor has something to review.");
      return;
    }
    const reviewPrompt = "Review my current code for correctness and style. Point out the single biggest issue first, then any smaller ones. Don't rewrite the whole thing — guide me.";
    // Opens the floating widget and appends to the ongoing Coding Tutor thread (same
    // history as Explain error and typed questions). No confirm / no new conversation —
    // the reply just appears in the widget next to the code.
    sendToWidget(reviewPrompt, "Reviewing");
  }, [sendToWidget, code]);

  // Apply the scoped dark signal to <body> while CodingTutor is mounted, and
  // strip it on unmount so leaving the section returns the rest of the app to
  // light. We reuse the `theme-switching` one-frame transition suppressor so the
  // swap snaps instead of cross-fading.
  useEffect(() => {
    const body = document.body;
    body.classList.add("theme-switching");
    body.classList.toggle("coding-dark", codingDark);
    localStorage.setItem("codingTheme", codingDark ? "dark" : "light");
    void body.offsetWidth;
    const raf = requestAnimationFrame(() => {
      body.classList.remove("theme-switching");
    });
    return () => {
      cancelAnimationFrame(raf);
      // If we unmount (or re-run) before the RAF fires, drop the class ourselves
      // so `theme-switching` can't stay stuck on <body> and suppress transitions.
      body.classList.remove("theme-switching");
    };
  }, [codingDark]);

  useEffect(() => {
    // Always clear the scoped dark class when the Coding Tutor unmounts, so the
    // rest of the app never inherits the coding-only dark theme.
    return () => {
      document.body.classList.remove("coding-dark");
    };
  }, []);

  useEffect(() => {
    // Pull the account's saved snippets from the server once on load and merge
    // them into the local cache, so My Snippets follows the user across devices.
    // No-op (keeps local cache) when signed out or offline.
    let cancelled = false;
    syncSnippetsFromServer().then(() => {
      if (!cancelled) setSnippets(listSnippets());
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // The chat should use the student's workspace code whenever there IS code (or
    // a loaded problem) — not only while the Workspace tab is the active page. This
    // keeps the floating chat grounded in the current attempt from any sub-page.
    const hasWorkspaceCode = Boolean(code && code.trim());
    const useWorkspace = hasWorkspaceCode || Boolean(activeProblem);
    onContextChange?.({
      activeProblem: useWorkspace ? activeProblem : null,
      selectedLanguage,
      code: useWorkspace ? code : "",
      attempts: useWorkspace ? attempts : 0,
      workspaceTab: activePage === "workspace" && workspaceVisible ? workspaceTab : activePage,
      note: useWorkspace ? note : "",
      tutorMode,
      runnerSummary: useWorkspace ? runnerSummary : "",
      workspaceSnapshots: useWorkspace ? activeSnapshots : {},
      suggestedCodeBlock,
      onApplyAICode: suggestedCodeBlock ? applyAiCode : null,
    });
  }, [activePage, activeProblem, attempts, code, note, onContextChange, selectedLanguage, suggestedCodeBlock, tutorMode, workspaceTab, workspaceVisible, runnerSummary, activeSnapshots, applyAiCode]);

  useEffect(() => {
    onActivePageChange?.(activePage);
  }, [activePage, onActivePageChange]);

  // Back-compat shim: old links used /coding?page=<id>. Redirect them once to the
  // new path equivalent (replace: true so back doesn't bounce to the legacy URL).
  useEffect(() => {
    const requestedPage = new URLSearchParams(location.search).get("page");
    if (!requestedPage) return;
    const target = LEGACY_PAGE_QUERY_TO_PATH[requestedPage];
    if (target) navigate(target, { replace: true });
  }, [location.search, navigate]);

  // Keep "last non-workspace section" in sync as the URL changes, so toggling the
  // workspace off returns to wherever the student was (Home/Practice/…).
  useEffect(() => {
    if (activePage !== "workspace") setLastNonWorkspacePage(activePage);
  }, [activePage]);

  useEffect(() => {
    if (!activeProblem || !code) return;
    setWorkspaceSnapshots(prev => ({
      ...prev,
      [activeSnapshotKey]: {
        ...(prev[activeSnapshotKey] || {}),
        current: code,
      },
    }));
  }, [activeProblem, activeSnapshotKey, code]);

  // Persist the editor buffer to a local draft (per problem + language) so unrun
  // code survives navigating to the full chat (which unmounts this workspace) and
  // switching languages. Debounced so we don't hammer localStorage on every key.
  // Interview mock problems keep their own per-question answer map, so skip them.
  // When the draft diverges from the starter, also mark the problem in-progress
  // locally (no backend round-trip) so it shows under "Continue where you left off"
  // even if the student never ran it.
  useEffect(() => {
    if (!activeProblem || activeProblem.mock) return;
    if (activeProblem.source === "personal") return; // snippets aren't practice progress
    const problemId = activeProblem.id;
    const language = selectedLanguageKey;
    const starter = activeSolution?.starter_code || "";
    const handle = setTimeout(() => {
      saveDraft(problemId, language, code);
      if (
        isQuizBankProblem &&
        activeLanguageProgress?.status !== "solved" &&
        hasStarterCodeChanged(code, starter)
      ) {
        markInProgressLocal(problemId, language, code);
      }
    }, 400);
    return () => clearTimeout(handle);
    // markInProgressLocal is a stable setState closure; excluded on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProblem, selectedLanguageKey, code, activeSolution, isQuizBankProblem, activeLanguageProgress]);

  useEffect(() => {
    let cancelled = false;
    const fetchDailyChallenge = async () => {
      setDailyChallengeLoading(true);
      try {
        const response = await fetch(`${apiBase}/api/coding/daily-challenge`);
        const data = await response.json();
        if (!cancelled) setDailyChallenge(data);
      } catch (error) {
        console.error("[coding-daily] failed", error);
        if (!cancelled) {
          setDailyChallenge({
            available: false,
            title: "Daily practice",
            difficulty: "Easy",
            message: "Daily challenge is unavailable right now.",
            url: "https://leetcode.com/problemset/",
          });
        }
      } finally {
        if (!cancelled) setDailyChallengeLoading(false);
      }
    };
    fetchDailyChallenge();
    return () => { cancelled = true; };
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;
    const fetchPractice = async () => {
      setListLoading(true);
      try {
        const token = localStorage.getItem("token");
        const progressRequests = token
          ? PRACTICE_LANGUAGE_KEYS.map(language => fetch(`${apiBase}/api/coding/practice/progress?language=${language}`, {
              headers: { Authorization: `Bearer ${token}` },
            }).then(response => ({ language, response })))
          : [];
        const cachedQuestions = questionCacheRef.current[difficulty];
        const allQuestionRequests = PRACTICE_DIFFICULTIES.map(level => (
          questionCacheRef.current[level]
            ? Promise.resolve({ level, questions: questionCacheRef.current[level] })
            : fetch(`${apiBase}/api/coding/practice/questions?difficulty=${level}`)
                .then(async response => {
                  if (!response.ok) throw new Error(`questions ${level} ${response.status}`);
                  const data = await response.json();
                  questionCacheRef.current[level] = data.questions || [];
                  return { level, questions: data.questions || [] };
                })
        ));
        const [questionResponse, allQuestionResults, ...progressResults] = await Promise.all([
          cachedQuestions
            ? Promise.resolve(null)
            : fetch(`${apiBase}/api/coding/practice/questions?difficulty=${difficulty}`),
          Promise.all(allQuestionRequests),
          ...progressRequests,
        ]);
        let nextQuestions = cachedQuestions || [];
        if (!cachedQuestions) {
          if (!questionResponse.ok) throw new Error(`questions ${questionResponse.status}`);
          const questionData = await questionResponse.json();
          nextQuestions = questionData.questions || [];
          questionCacheRef.current[difficulty] = nextQuestions;
        }
        const nextAllQuestions = allQuestionResults.flatMap(result => result.questions || []);
        const nextLanguageProgress = {};
        for (const result of progressResults) {
          if (result?.response?.ok) {
            const progressData = await result.response.json();
            (progressData.items || []).forEach((item) => {
              nextLanguageProgress[item.question_id] = {
                ...(nextLanguageProgress[item.question_id] || {}),
                [result.language]: item,
              };
            });
          } else if (result?.response) {
            console.warn("[coding-progress] list request failed", result.language, result.response.status, await result.response.text());
          }
        }
        nextAllQuestions.forEach((question) => {
          PRACTICE_LANGUAGE_KEYS.forEach((language) => {
            const local = readLocalProgress(question.id, language);
            if (local && !nextLanguageProgress[question.id]?.[language]) {
              nextLanguageProgress[question.id] = {
                ...(nextLanguageProgress[question.id] || {}),
                [language]: local,
              };
            }
          });
        });
        if (!cancelled) {
          setQuestions(nextQuestions);
          setAllQuestions(nextAllQuestions);
          setProgressByLanguage(nextLanguageProgress);
          setProgressByQuestion(aggregateProgressMap(nextLanguageProgress));
        }
      } catch (error) {
        console.error("[coding-practice] load failed", error);
        if (!cancelled) {
          setQuestions([]);
          setAllQuestions([]);
          setProgressByQuestion({});
        }
      } finally {
        if (!cancelled) {
          setListLoading(false);
        }
      }
    };
    fetchPractice();
    return () => { cancelled = true; };
  }, [apiBase, difficulty]);

  // Load the interview library once (set=interview, all difficulties). Separate
  // from the practice loader: these are reference problems with no progress to
  // join, so they don't need the per-language progress plumbing above.
  useEffect(() => {
    let cancelled = false;
    const fetchInterview = async () => {
      setInterviewLoading(true);
      try {
        const results = await Promise.all(
          PRACTICE_DIFFICULTIES.map(level =>
            fetch(`${apiBase}/api/coding/practice/questions?set=interview&difficulty=${level}`)
              .then(async (response) => {
                if (!response.ok) throw new Error(`interview ${level} ${response.status}`);
                const data = await response.json();
                return data.questions || [];
              }),
          ),
        );
        if (!cancelled) setInterviewQuestions(results.flat());
      } catch (error) {
        console.error("[interview-prep] load failed", error);
        if (!cancelled) setInterviewQuestions([]);
      } finally {
        if (!cancelled) setInterviewLoading(false);
      }
    };
    fetchInterview();
    return () => { cancelled = true; };
  }, [apiBase]);

  // Local-only in-progress mark for unrun-but-edited code. Mirrors the optimistic
  // shape saveProgress writes, but never hits the backend — it just lights up
  // "Continue where you left off" and the topic's in-progress state on this device.
  // The authoritative backend save still happens on run / problem-switch.
  const markInProgressLocal = (questionId, language, draftCode) => {
    if (!questionId) return;
    const existing = progressByLanguage[questionId]?.[language] || readLocalProgress(questionId, language);
    // Don't clobber a solved/attempted record or re-fire when already in-progress
    // with the same code (keeps the effect from thrashing state on every keystroke).
    if (existing?.status === "solved") return;
    if (existing?.status === "in_progress" && existing?.code === draftCode) return;
    const record = {
      question_id: questionId,
      language,
      ...(existing || {}),
      status: existing?.status === "attempted" ? "attempted" : "in_progress",
      code: draftCode,
      attempt_count: existing?.attempt_count || 0,
      updated_at: new Date().toISOString(),
    };
    writeLocalProgress(questionId, language, record);
    setProgressByLanguage(prev => {
      const next = {
        ...prev,
        [questionId]: { ...(prev[questionId] || {}), [language]: record },
      };
      setProgressByQuestion(aggregateProgressMap(next));
      return next;
    });
  };

  const saveProgress = async (questionId, updates = {}, language = selectedLanguageKey) => {
    if (!questionId) return null;
    const current = progressByLanguage[questionId]?.[language] || readLocalProgress(questionId, language) || {
      question_id: questionId,
      language,
      status: "not_started",
      code: "",
      attempt_count: 0,
    };
    const optimistic = {
      ...current,
      ...updates,
      language,
      status: updates.status || current.status || "not_started",
      code: updates.code ?? current.code ?? "",
      attempt_count: updates.increment_attempt ? (current.attempt_count || 0) + 1 : (current.attempt_count || 0),
      updated_at: new Date().toISOString(),
    };
    writeLocalProgress(questionId, language, optimistic);
    setProgressByLanguage(prev => {
      const next = {
        ...prev,
        [questionId]: {
          ...(prev[questionId] || {}),
          [language]: optimistic,
        },
      };
      setProgressByQuestion(aggregateProgressMap(next));
      return next;
    });

    const token = localStorage.getItem("token");
    if (!token) return optimistic;
    try {
      const response = await fetch(`${apiBase}/api/coding/practice/questions/${questionId}/progress`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ language, ...updates }),
      });
      if (!response.ok) {
        console.warn("[coding-progress] backend save failed", response.status, await response.text());
        return optimistic;
      }
      const saved = await response.json();
      writeLocalProgress(questionId, language, saved);
      setProgressByLanguage(prev => {
        const next = {
          ...prev,
          [questionId]: {
            ...(prev[questionId] || {}),
            [language]: saved,
          },
        };
        setProgressByQuestion(aggregateProgressMap(next));
        return next;
      });
      return saved;
    } catch (error) {
      console.warn("[coding-progress] backend save unavailable; using local fallback", error);
      return optimistic;
    }
  };

  const loadQuestionSolution = async (problem, languageName, existingCode = null) => {
    const language = PRACTICE_LANGUAGE_API[languageName] || "python";
    const solutionCacheKey = `${problem.id}:${language}`;
    let solution = solutionCacheRef.current[solutionCacheKey];
    if (!solution) {
      const response = await fetch(`${apiBase}/api/coding/practice/questions/${problem.id}/solution?language=${language}`);
      if (!response.ok) throw new Error(`solution ${response.status}`);
      solution = await response.json();
      solutionCacheRef.current[solutionCacheKey] = solution;
    }
    let progress = progressByLanguage[problem.id]?.[language] || readLocalProgress(problem.id, language);
    const isStarterOnlyProgress = progress?.status === "in_progress"
      && (progress?.attempt_count || 0) === 0
      && !hasStarterCodeChanged(progress?.code || "", solution?.starter_code || "");
    if (isStarterOnlyProgress) {
      clearLocalProgress(problem.id, language);
      progress = null;
      setProgressByLanguage(prev => {
        const next = { ...prev, [problem.id]: { ...(prev[problem.id] || {}) } };
        delete next[problem.id][language];
        if (!Object.keys(next[problem.id]).length) delete next[problem.id];
        setProgressByQuestion(aggregateProgressMap(next));
        return next;
      });
    }
    setActiveProblem(problem);
    setActiveSolution(solution);
    setSelectedLanguage(languageName);
    setPracticeLanguage(languageName);
    // Code precedence: an explicit restore wins, then a local unrun draft (freshest
    // edit, survives unmount), then saved backend progress, then the starter stub.
    const draftCode = existingCode == null ? readDraft(problem.id, language) : null;
    const nextCode = existingCode ?? draftCode ?? progress?.code ?? solution?.starter_code ?? "";
    setCode(nextCode);
    // Remember this problem+language so the workspace can auto-reopen it if the
    // student navigates to the full chat (which unmounts the workspace) and back.
    saveLastWorkspace(problem.id, language);
    setWorkspaceSnapshots(prev => ({
      ...prev,
      [`${problem.id}:${language}`]: {
        ...(prev[`${problem.id}:${language}`] || {}),
        starter: solution?.starter_code || "",
        current: nextCode,
      },
    }));
    setNote(`Practice problem: ${problem.title}`);
    const runnerLabel = `${languageName} local tests can run from the terminal below the editor.`;
    setTestOutput({ status: "ready", message: `${problem.title} loaded in ${languageName}. ${runnerLabel}` });
    setTerminalOpen(false);
    setWorkspaceVisible(true);
    setWorkspaceTab("Editor");
    setRevealedHints(0);
    navigate(workspacePathForProblem(problem.id));
  };

  // Persist the CURRENT quiz problem as in-progress if its code changed from the
  // starter, so editing a problem (even without running it) makes it show up under
  // "Continue where you left off". Skips personal/leetcode/solved.
  const savePendingProblemProgress = async () => {
    if (!activeProblem || !isQuizBankProblem) return;
    if (activeLanguageProgress?.status === "solved") return;
    if (!hasStarterCodeChanged(code, activeSolution?.starter_code)) return;
    try {
      await saveProgress(activeProblem.id, { status: "in_progress", code }, selectedLanguageKey);
    } catch (error) {
      console.warn("[coding-practice] save pending progress failed", error);
    }
  };

  const selectQuestion = async (problem) => {
    // Opening a regular practice problem leaves any mock session behind (a mock is
    // a focused round; picking another problem ends it — silently, no summary).
    abandonMockIfActive();
    setProblemLoading(true);
    try {
      // Save edits to the problem we're leaving before loading the new one.
      await savePendingProblemProgress();
      await loadQuestionSolution(problem, practiceLanguage);
    } catch (error) {
      console.error("[coding-practice] select failed", error);
      toast.error("Could not load that practice problem");
    } finally {
      setProblemLoading(false);
    }
  };

  const changeSelectedLanguage = async (languageName) => {
    // Interview problems have no per-language solution files, so switching language
    // just swaps the editor language + re-seeds the starter stub (only if the code
    // is still untouched, so we never clobber the student's work). Same lightweight
    // path as leetcode/personal — no /solution fetch (which would 404).
    if (activeProblem?.source === "interview") {
      // In a MOCK, the language locks after Q1 (dropdown disabled), so this is a no-op
      // once locked. While still on Q1 the student may switch freely; record the choice
      // onto the session so every later question uses it. Outside a mock, switching is
      // always free. Only Python ships an authored starter today; other languages fall
      // back to a generic stub (see interviewStarterStub) — TODO: author Java/JS/C++.
      if (interviewLanguageLocked) return;
      setSelectedLanguage(languageName);
      setPracticeLanguage(languageName);
      setCode(interviewStarterStub(activeProblem, languageName));
      if (activeProblem?.mock) {
        setMockSession((prev) => (prev ? { ...prev, language: languageName } : prev));
      }
      return;
    }
    if (!activeProblem || activeProblem.source === "leetcode" || activeProblem.source === "personal") {
      setSelectedLanguage(languageName);
      setPracticeLanguage(languageName);
      return;
    }
    setProblemLoading(true);
    try {
      if (hasStarterCodeChanged(code, activeSolution?.starter_code)) {
        await saveProgress(activeProblem.id, { status: activeLanguageProgress?.status === "solved" ? "solved" : "in_progress", code }, selectedLanguageKey);
      }
      await loadQuestionSolution(activeProblem, languageName);
    } catch (error) {
      console.error("[coding-practice] language switch failed", error);
      toast.error("Could not switch language for this problem");
    } finally {
      setProblemLoading(false);
    }
  };

  const startDailyChallenge = (withHints = false) => {
    // Practicing the daily challenge counts toward the day streak (gamification).
    setDailyStreakDays(recordDailyChallengeDay());
    const title = dailyChallenge?.title || "Daily coding challenge";
    const prompt = dailyChallenge?.available
      ? `Solve today's LeetCode daily challenge: ${title}. Open the LeetCode link for the full prompt, then use this workspace for notes and code.`
      : "Daily challenge is unavailable. Use this workspace for a short practice prompt or open the Practice Library.";
    setActiveProblem({
      id: `daily-${new Date().toISOString().slice(0, 10)}`,
      title,
      difficulty: dailyChallenge?.difficulty || "Easy",
      topic: dailyChallenge?.tags?.[0] || "Daily Challenge",
      prompt,
      examples: [],
      constraints: dailyChallenge?.url ? [`Source: ${dailyChallenge.url}`] : [],
      source: "leetcode",
    });
    setActiveSolution(null);
    setSelectedLanguage(practiceLanguage);
    setCode("");
    setNote(withHints ? `Daily challenge: ${title}. I want hints first.` : `Daily challenge: ${title}`);
    setTestOutput({ status: "ready", message: "Daily challenge loaded. LeetCode daily problems are source-linked practice only; local auto-grading is for CS Navigator quiz-bank questions." });
    setTerminalOpen(false);
    setTutorMode(withHints ? "Hinting" : "Guided Tutor");
    setWorkspaceVisible(true);
    setWorkspaceTab("Editor");
    setRevealedHints(0);
    goToPage("workspace");
  };

  // Open an Interview Prep problem in the workspace. Modeled on the daily challenge:
  // a real prompt + examples to work out in the editor, but NO autograder (these
  // are reference problems, has_tests=false). source="interview" keeps the runner
  // on free-run (runAttempt routes non-quiz-bank sources to runFreeform) and hides
  // "Run tests" / "Mark solved" / problem-nav (all gated on isQuizBankProblem). The
  // worked solution stays a "View solution" link out (answer_url), shown in the
  // problem panel. opts.mock tags it as part of a timed mock session.
  const openInterviewProblem = (question, opts = {}) => {
    if (!question) return;
    // Opening a normal interview problem (not part of a mock) ends any lingering
    // mock session silently. Mock problems pass opts.mock and keep the session.
    if (!opts.mock) abandonMockIfActive();
    setActiveProblem({
      id: question.id,
      title: question.title,
      difficulty: question.difficulty || "easy",
      topic: question.topic || "interview",
      prompt: question.prompt || "",
      examples: question.examples || [],
      constraints: question.constraints || [],
      requires: question.requires || [],
      answer_url: question.answer_url || null,
      answer_kind: question.answer_kind || null,
      source: "interview",
      mock: Boolean(opts.mock),
    });
    setActiveSolution(null);
    // Restore a saved mock answer (with its language) if the caller passed one;
    // otherwise seed the fresh starter stub. This is what stops mock navigation
    // from wiping the student's in-progress code.
    if (opts.restoreCode != null) {
      setSelectedLanguage(opts.restoreLanguage || practiceLanguage);
      setCode(opts.restoreCode);
    } else {
      setSelectedLanguage(practiceLanguage);
      setCode(interviewStarterStub(question, practiceLanguage));
    }
    setNote(`Interview prep: ${question.title}`);
    setTestOutput({
      status: "ready",
      message: `${question.title} loaded. Work it out in the editor and press Run to execute your code. Interview prep problems are not auto-graded — use "View solution" for the walkthrough.`,
    });
    setTerminalOpen(false);
    setTutorMode("Guided Tutor");
    setLastNonWorkspacePage("interview");
    setWorkspaceVisible(true);
    setWorkspaceTab("Editor");
    setRevealedHints(0);
    // A mock problem stays on the plain /coding/workspace URL (the mock session is
    // in-memory, not addressable); a normal interview problem gets a shareable
    // /problem/:id URL like practice problems.
    if (opts.mock) goToPage("workspace");
    else navigate(workspacePathForProblem(question.id));
  };

  // ── Mock Interview ────────────────────────────────────────────────────────
  // Pick a mixed-difficulty set (prefer one easy, one medium, one hard; fill from
  // the rest if a tier is short) and start a timed run in the workspace.
  const MOCK_COUNT = 3;
  const MOCK_MINUTES = 45;

  const startMockInterview = () => {
    if (!interviewQuestions.length) {
      toast.error("Interview questions are still loading.");
      return;
    }
    if (interviewQuestions.length < 2) {
      toast.error("Not enough interview questions for a mock round yet.");
      return;
    }
    const byDiff = { easy: [], medium: [], hard: [] };
    interviewQuestions.forEach((q) => {
      const d = (q.difficulty || "easy").toLowerCase();
      (byDiff[d] || byDiff.easy).push(q);
    });
    const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
    const picked = [];
    ["easy", "medium", "hard"].forEach((d) => {
      const pool = shuffle(byDiff[d] || []);
      if (pool.length) picked.push(pool[0]);
    });
    // Top up to MOCK_COUNT from any remaining, avoiding duplicates.
    if (picked.length < MOCK_COUNT) {
      const chosen = new Set(picked.map(q => q.id));
      shuffle(interviewQuestions).forEach((q) => {
        if (picked.length < MOCK_COUNT && !chosen.has(q.id)) {
          picked.push(q);
          chosen.add(q.id);
        }
      });
    }
    const now = Date.now();
    const finalQuestions = picked.slice(0, MOCK_COUNT);
    const session = {
      questions: finalQuestions,
      index: 0,
      endsAt: now + MOCK_MINUTES * 60 * 1000,
      startedAt: now,
      problemStartedAt: now,
      outcomes: Object.fromEntries(finalQuestions.map(q => [q.id, "unattempted"])),
      stuck: [],
      // The working language for the round. Chosen on the first question (switchable
      // there), then locked from Q2 onward. Seeded with the current default.
      language: practiceLanguage,
      // Per-question editor code, keyed by question id: { code, language }. Snapshotted
      // when the student navigates away so switching questions never loses their work.
      answers: {},
    };
    setMockSession(session);
    setMockNow(now);
    setMockSummary(null);
    openInterviewProblem(finalQuestions[0], { mock: true });
    toast.success(`Mock interview started — ${finalQuestions.length} problems, ${MOCK_MINUTES} minutes. Pick your language on this first question — it locks once you move on.`);
  };

  // Snapshot the CURRENT question's editor code (from the live refs) into the
  // session's per-question answers map. Pure: returns a new session, no side effects.
  const snapshotMockAnswer = (session) => {
    if (!session) return session;
    const currentId = session.questions[session.index]?.id;
    if (!currentId) return session;
    return {
      ...session,
      answers: {
        ...session.answers,
        [currentId]: { code: codeRef.current, language: langKeyRef.current },
      },
    };
  };

  // Build the restore opts for a target question from a saved answer (if any).
  const restoreOptsFor = (session, question) => {
    const saved = session.answers?.[question.id];
    return saved ? { restoreCode: saved.code, restoreLanguage: saved.language } : {};
  };

  const gotoMockProblem = (nextIndex) => {
    setMockSession((prev) => {
      if (!prev) return prev;
      const saved = snapshotMockAnswer(prev);
      const clamped = Math.max(0, Math.min(nextIndex, saved.questions.length - 1));
      const target = saved.questions[clamped];
      openInterviewProblem(target, { mock: true, ...restoreOptsFor(saved, target) });
      // Advancing beyond Q1 commits the chosen language for the rest of the round.
      const languageCommitted = saved.languageCommitted || clamped > 0;
      return { ...saved, index: clamped, problemStartedAt: Date.now(), languageCommitted };
    });
  };

  // Navigate backward to the nearest EARLIER problem that wasn't skipped (skipped
  // problems are one-way — you can't return to them).
  const goToPreviousMockProblem = () => {
    setMockSession((prev) => {
      if (!prev) return prev;
      const saved = snapshotMockAnswer(prev);
      let target = saved.index - 1;
      while (target >= 0 && saved.outcomes[saved.questions[target].id] === "skipped") target -= 1;
      if (target < 0) return prev; // nothing reachable behind us
      const targetQ = saved.questions[target];
      openInterviewProblem(targetQ, { mock: true, ...restoreOptsFor(saved, targetQ) });
      return { ...saved, index: target, problemStartedAt: Date.now() };
    });
  };

  // True when there is a non-skipped earlier problem to return to.
  const canGoPrevMock = (() => {
    if (!mockSession) return false;
    for (let i = mockSession.index - 1; i >= 0; i -= 1) {
      if (mockSession.outcomes[mockSession.questions[i].id] !== "skipped") return true;
    }
    return false;
  })();

  // Skip is one-way: confirm, mark skipped, then advance. If it's the last problem,
  // skipping just marks it (nothing to advance to).
  const requestSkipMock = () => {
    if (!mockSession) return;
    const atLast = mockSession.index >= mockSession.questions.length - 1;
    setMockConfirm({
      title: "Skip this problem?",
      body: "Skipping is one-way — you won't be able to come back to this problem during the round. (Use Next instead if you might return.)",
      confirmLabel: "Skip problem",
      tone: "warn",
      onConfirm: () => {
        setMockOutcome("skipped");
        if (!atLast) gotoMockProblem(mockSession.index + 1);
        setMockConfirm(null);
      },
    });
  };

  // Viewing the worked solution mid-round ends the interview (with a warning).
  const requestViewSolutionMock = (url) => {
    setMockConfirm({
      title: "View the worked solution?",
      body: "Opening the solution ends the mock interview. You'll see your summary, and the solution opens in a new tab.",
      confirmLabel: "View solution & end",
      tone: "danger",
      onConfirm: () => {
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        setMockConfirm(null);
        endMockInterview();
      },
    });
  };

  // Record an outcome for the current mock problem (without leaving it).
  const setMockOutcome = (outcome) => {
    // Capture the current question id for the side effect below (kept OUT of the pure
    // updater so it runs once, not twice under StrictMode).
    const currentId = mockSessionRef.current?.questions[mockSessionRef.current.index]?.id;
    setMockSession((prev) => {
      if (!prev) return prev;
      const id = prev.questions[prev.index]?.id;
      if (!id) return prev;
      return { ...prev, outcomes: { ...prev.outcomes, [id]: outcome } };
    });
    // Marking a mock problem solved also marks it solved in the Interview Prep bank.
    if (outcome === "solved" && currentId) markInterviewSolved(currentId);
  };

  // Mark the current problem "attempted" (lowest rung) unless already higher.
  const markMockAttempted = () => {
    setMockSession((prev) => {
      if (!prev) return prev;
      const id = prev.questions[prev.index]?.id;
      if (!id || prev.outcomes[id] !== "unattempted") return prev;
      return { ...prev, outcomes: { ...prev.outcomes, [id]: "attempted" } };
    });
  };

  // "I'm stuck": unlocks the solution link for this problem and counts as an attempt.
  const markMockStuck = () => {
    setMockSession((prev) => {
      if (!prev) return prev;
      const id = prev.questions[prev.index]?.id;
      if (!id) return prev;
      const stuck = prev.stuck.includes(id) ? prev.stuck : [...prev.stuck, id];
      const outcomes = prev.outcomes[id] === "unattempted"
        ? { ...prev.outcomes, [id]: "attempted" }
        : prev.outcomes;
      return { ...prev, stuck, outcomes };
    });
  };

  // Build the results summary. Snapshots the CURRENT question's code first (so the
  // last problem the student was on is captured), then emits per-question code +
  // language + an empty `grade` slot that the async grader fills in later.
  const buildMockSummary = (rawSession) => {
    const session = snapshotMockAnswer(rawSession);
    const used = Math.min(Date.now(), session.endsAt) - session.startedAt;
    const vals = Object.values(session.outcomes);
    return {
      total: session.questions.length,
      solved: vals.filter(v => v === "solved").length,
      attempted: vals.filter(v => v !== "unattempted").length,
      skipped: vals.filter(v => v === "skipped").length,
      timeUsedMs: Math.max(0, used),
      topics: [...new Set(session.questions.map(q => q.topic).filter(Boolean))],
      grading: false, // flipped true while the post-interview grader runs
      problems: session.questions.map(q => ({
        id: q.id,
        title: q.title,
        topic: q.topic,
        difficulty: q.difficulty,
        outcome: session.outcomes[q.id],
        answer_url: q.answer_url,
        answer_kind: q.answer_kind,
        prompt: q.prompt || "",
        code: session.answers?.[q.id]?.code || "",
        language: session.answers?.[q.id]?.language || "python",
        grade: null, // { gradedBy: "tests"|"ai"|"none", ... } — filled by the grader
      })),
    };
  };

  // Grade the finished mock in the background (hybrid: tests where authored, AI review
  // otherwise), then merge verdicts into the on-screen summary and save the attempt to
  // local history. Best-effort — a grading failure still records the outcome-only
  // attempt so history and the summary never get stuck on "Grading…".
  const gradeAndRecordMock = async (summary) => {
    const attemptId = `mock-${Date.now()}`;
    let gradedProblems = summary.problems;
    try {
      gradedProblems = await gradeMockSummary(apiBase, summary);
      // A question that PASSED its auto-grader tests is marked solved in the Interview
      // Prep bank (deterministic proof of correctness, stronger than the manual button).
      gradedProblems.forEach((p) => {
        const g = p.grade;
        if (g && g.gradedBy === "tests" && g.total > 0 && g.passed === g.total) {
          markInterviewSolved(p.id);
        }
      });
      // Only update if this summary is still the one on screen (user hasn't closed it).
      setMockSummary((cur) =>
        cur && cur.startedKey === summary.startedKey
          ? { ...cur, problems: gradedProblems, grading: false }
          : cur,
      );
    } catch (err) {
      console.error("[mock-grade] failed", err);
      setMockSummary((cur) =>
        cur && cur.startedKey === summary.startedKey ? { ...cur, grading: false } : cur,
      );
    }
    // Persist to local Past Interviews history (score derived from the graded set).
    try {
      appendInterviewAttempt({
        id: attemptId,
        dateISO: new Date().toISOString(),
        total: summary.total,
        solved: summary.solved,
        attempted: summary.attempted,
        skipped: summary.skipped,
        timeUsedMs: summary.timeUsedMs,
        topics: summary.topics,
        score: scoreFromGraded(gradedProblems),
        problems: gradedProblems.map((p) => ({
          id: p.id,
          title: p.title,
          topic: p.topic,
          difficulty: p.difficulty,
          outcome: p.outcome,
          answer_url: p.answer_url,
          answer_kind: p.answer_kind,
          code: p.code,
          language: p.language,
          grade: p.grade,
        })),
      });
    } catch (err) {
      console.error("[mock-history] save failed", err);
    }
  };

  // Single funnel for every way a mock can end (Finish button, End, timeout). Takes
  // the ended session, shows the summary overlay immediately, records the badge, and
  // kicks off async grading + history save. Kept OUT of any setState updater so its
  // side effects (badge counter, toasts) run exactly once even under StrictMode.
  const concludeMock = (endedSession) => {
    if (!endedSession) return;
    // Tag the summary so a late-arriving grade only patches THIS overlay, not a newer
    // one the user may have opened by starting another round.
    const summary = { ...buildMockSummary(endedSession), grading: true, startedKey: `${endedSession.startedAt}` };
    setMockSummary(summary);
    // Count this finished mock toward the Mock Rookie / Veteran badges.
    setMockCompleted(recordMockCompleted());
    setActiveProblem((prev) => (prev?.mock ? { ...prev, mock: false } : prev));
    // Leave the workspace and land on Interview Prep underneath the results modal, so
    // closing the modal drops the student straight onto the interview page (and the new
    // Past Interviews entry) instead of a stale mock workspace. The summary overlay is
    // portaled to <body>, so it survives this route change and stays on top.
    goToPage("interview");
    // Grade in the background, then persist to local history once verdicts land.
    gradeAndRecordMock(summary);
  };

  // End → show the results overlay. Also clear the stale `mock` flag on the active
  // problem so opening a normal interview problem afterward isn't treated as mock.
  const endMockInterview = () => {
    // Read the CURRENT session synchronously from the ref (React does not guarantee a
    // setState updater runs before the next line, so capturing `ended` inside the
    // updater was unreliable and left the summary un-set). Snapshot first, conclude,
    // then clear the session.
    const ended = mockSessionRef.current;
    if (!ended) return;
    setMockSession(null);
    concludeMock(ended);
  };

  // Finish the round from the last problem (the primary "Finish & see results"
  // action). Same conclusion path as End, just without the "are you sure" framing —
  // reaching the end and asking for results is the intended, non-destructive finish.
  const finishMock = () => {
    endMockInterview();
  };

  // Silently abandon a mock session (no summary popup) — used when the student
  // deliberately leaves the mock by opening a different (non-mock) problem. Without
  // this the timer would keep ticking on a regular problem and could fire
  // "time's up" mid-practice.
  const abandonMockIfActive = () => {
    setMockSession((prev) => (prev ? null : prev));
    setActiveProblem((prev) => (prev?.mock ? { ...prev, mock: false } : prev));
  };

  // Confirm before ending (the round can't be resumed once closed).
  const confirmEndMock = () => {
    if (window.confirm("End mock interview?\nYou'll see your summary and can review solutions.")) {
      endMockInterview();
    }
  };

  // Tick the mock timer once a second while a session is live; auto-end at zero
  // (auto-end still produces a summary so the round always closes cleanly). The
  // expiry check reads the LATEST session via the functional setState updater, so
  // a last-second outcome change is reflected in the summary (no stale closure).
  useEffect(() => {
    if (!mockSession) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      setMockNow(now);
      // Read the session via a snapshot in the updater but keep the updater PURE
      // (only returns new state) — side effects run once, outside it. React can
      // invoke updaters twice under StrictMode; recordMockCompleted() increments a
      // persisted counter and toast() is user-visible, so running them inside would
      // double-count the badge / double-toast. `expired` is captured for the effects.
      let expired = null;
      setMockSession((prev) => {
        if (!prev || now < prev.endsAt) return prev;
        expired = prev;
        return null;
      });
      if (expired) {
        // A timed-out mock is still a completed mock — same conclusion path as
        // ending manually (summary + badge + async grading + history).
        concludeMock(expired);
        toast("Time's up! Mock interview ended.", { icon: "⏱️" });
      }
    }, 1000);
    return () => clearInterval(id);
    // Restart the ticker only when a session begins/ends, not on every state edit;
    // the expiry check reads the latest session via the functional updater above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockSessionActive]);

  // Mirror the active-mock flag onto the <body> so other parts of the app (the
  // floating Coding Tutor chat, which lives in Chatbox.jsx and shares no state
  // with this component) can hide AI help during a mock — same body-class bridge
  // pattern as the scoped dark mode. Cleared on unmount so a stray flag never
  // sticks if the workspace is left mid-session.
  useEffect(() => {
    document.body.classList.toggle("coding-mock-active", mockSessionActive);
    window.dispatchEvent(new CustomEvent("coding-mock-change", { detail: { active: mockSessionActive } }));
    return () => {
      document.body.classList.remove("coding-mock-active");
      window.dispatchEvent(new CustomEvent("coding-mock-change", { detail: { active: false } }));
    };
  }, [mockSessionActive]);

  // Open the fresh PERSONAL workspace (My Snippets) — a synthetic personal
  // "problem" so the existing workspace renders the editor/terminal, but the left
  // panel shows the snippets list instead of quiz guidance. Reachable ONLY from
  // the home button, not the nav.
  const openPersonalWorkspace = (snippet = null) => {
    abandonMockIfActive(); // leaving a mock for the personal scratch workspace ends it
    setActiveSolution(null);
    setActiveProblem({ id: "personal", source: "personal", title: snippet?.name || "My Snippet" });
    setActiveSnippetId(snippet?.id || null);
    setCode(snippet?.code || "");
    setPersonalSavedCode(snippet?.code || ""); // baseline for unsaved-change detection
    if (snippet?.language) {
      setSelectedLanguage(snippet.language);
      setPracticeLanguage(snippet.language);
    }
    setNote("");
    setRevealedHints(0);
    setWorkspaceTab("Editor");
    setTerminalOpen(false);
    setTestOutput({ status: "ready", message: "" });
    setWorkspaceVisible(true);
    setSnippets(listSnippets());
    // A saved snippet gets its own addressable URL (shareable / refresh-restorable);
    // a fresh/empty scratch workspace stays on the plain /personal route.
    navigate(snippet?.id ? workspacePathForSnippet(snippet.id) : "/coding/workspace/personal");
  };

  // True when in the personal workspace and the code differs from what was last
  // saved/loaded (and there's actually something to lose).
  const hasUnsavedPersonalChanges = isPersonalMode
    && code.trim() !== ""
    && normalizeCodeForCompare(code) !== normalizeCodeForCompare(personalSavedCode);

  // Run `proceed` immediately if there's nothing unsaved; otherwise stash it and
  // show the "unsaved changes" prompt (Save / Discard / Cancel).
  const guardPersonalNav = (proceed) => {
    if (hasUnsavedPersonalChanges) {
      setUnsavedPrompt(() => proceed);
      return;
    }
    proceed();
  };

  const newSnippet = () => openPersonalWorkspace(null);

  // Home "My Snippets" card: reopen the most recently saved snippet (so the user
  // resumes what they were working on); if none saved, open a clean workspace.
  const openMySnippets = () => {
    const saved = listSnippets();
    openPersonalWorkspace(saved.length ? saved[0] : null);
  };

  // Fetch a single problem by id from the right library (practice vs interview)
  // and open it in the workspace. Used to RESTORE a /coding/workspace/problem/:id
  // URL on a cold load / refresh, when the problem isn't already active.
  const restoreWorkspaceProblem = useCallback(async (problemId) => {
    const set = questionSetForId(problemId);
    try {
      const response = await fetch(
        `${apiBase}/api/coding/practice/questions/${encodeURIComponent(problemId)}?set=${set}`
      );
      if (!response.ok) throw new Error(`question ${response.status}`);
      const question = await response.json();
      if (set === "interview") {
        openInterviewProblem(question);
      } else {
        // Restore the language the student last used on THIS problem (defaulting to
        // the current practice language) so a reopen doesn't reset them to Python.
        // loadQuestionSolution then restores that language's saved draft.
        const last = readLastWorkspace();
        const restoreLanguage =
          last?.problemId === question.id && PRACTICE_LANGUAGE_NAME[last.language]
            ? PRACTICE_LANGUAGE_NAME[last.language]
            : practiceLanguage;
        await loadQuestionSolution(question, restoreLanguage);
      }
    } catch (error) {
      console.warn("[coding-workspace] could not restore problem from URL", problemId, error);
      toast.error("That problem could not be opened. Showing the workspace instead.");
      restoredWorkspaceTargetRef.current = null;
      navigate("/coding/workspace", { replace: true });
    }
    // openInterviewProblem / loadQuestionSolution are stable closures over setState
    // (recreated each render but behaviourally identical); excluded on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, practiceLanguage, navigate]);

  // Cold-load / refresh restore for workspace sub-routes. Runs when the URL points
  // at a specific workspace target but the workspace isn't already showing it.
  // Guards: never hijack a running mock; open each problem id only once.
  useEffect(() => {
    if (activePage !== "workspace") return;
    const target = workspaceTargetFromPath(location.pathname);

    if (target.kind === "personal") {
      if (!isPersonalMode) openPersonalWorkspace(null);
      return;
    }
    if (target.kind === "snippet") {
      // Already showing this snippet → leave it. Otherwise look it up locally and
      // open it; if it's not on this device (or was deleted), fall back to the
      // scratch personal workspace with a note rather than a dead route.
      if (isPersonalMode && activeSnippetId === target.id) return;
      if (restoredWorkspaceTargetRef.current === target.id) return;
      restoredWorkspaceTargetRef.current = target.id;
      const snippet = getSnippet(target.id);
      if (snippet) {
        openPersonalWorkspace(snippet);
      } else {
        toast.info("That snippet isn't saved on this device.");
        openPersonalWorkspace(null);
      }
      return;
    }
    if (target.kind === "problem") {
      // Already on this problem, or a mock owns the workspace → leave it alone.
      if (mockSession && activeProblem?.mock) return;
      if (activeProblem?.id === target.id) return;
      if (restoredWorkspaceTargetRef.current === target.id) return;
      restoredWorkspaceTargetRef.current = target.id;
      restoreWorkspaceProblem(target.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, activePage]);

  // Fallback auto-reopen: if the student returns to an EMPTY Workspace page (e.g.
  // from the full chat, which unmounts this component) with no problem loaded,
  // re-open the last problem + language they were working on so their unrun draft
  // is restored instead of a blank Python editor. Scoped to the Workspace page so
  // it never hijacks the Practice Library / dashboard, and only when the URL has no
  // specific problem (that path's own restore owns it). Fires once per mount.
  useEffect(() => {
    if (autoReopenedRef.current) return;
    if (activePage !== "workspace") return;
    if (activeProblem || isPersonalMode) return;
    if (mockSession && activeProblem?.mock) return;
    if (workspaceTargetFromPath(location.pathname).kind !== "none") return; // a specific target owns it
    if (listLoading) return; // wait until the practice list is ready
    const last = readLastWorkspace();
    if (!last?.problemId || questionSetForId(last.problemId) === "interview") return;
    autoReopenedRef.current = true;
    const languageName = PRACTICE_LANGUAGE_NAME[last.language] || practiceLanguage;
    (async () => {
      try {
        const response = await fetch(
          `${apiBase}/api/coding/practice/questions/${encodeURIComponent(last.problemId)}?set=practice`
        );
        if (!response.ok) throw new Error(`question ${response.status}`);
        const question = await response.json();
        await loadQuestionSolution(question, languageName);
      } catch (error) {
        console.warn("[coding-workspace] auto-reopen last workspace failed", error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, listLoading]);

  // Returns the saved record, or null if the user cancelled the name prompt.
  const handleSaveSnippet = () => {
    if (!code.trim()) {
      toast.info("Write some code before saving.");
      return null;
    }
    const suggested = activeProblem?.title && activeProblem.title !== "My Snippet"
      ? activeProblem.title
      : "My snippet";
    const name = window.prompt("Name this snippet:", suggested);
    if (name === null) return null; // cancelled
    const record = saveSnippet({ id: activeSnippetId, name, language: selectedLanguage, code });
    setActiveSnippetId(record.id);
    setActiveProblem(prev => (prev ? { ...prev, title: record.name } : prev));
    setPersonalSavedCode(code); // baseline updated — no longer "unsaved"
    setSnippets(listSnippets());
    toast.success("Snippet saved.");
    return record;
  };

  const handleDeleteSnippet = (id) => {
    if (!window.confirm("Delete this snippet? This cannot be undone.")) return;
    deleteSnippet(id);
    setSnippets(listSnippets());
    if (id === activeSnippetId) {
      setActiveSnippetId(null);
    }
    toast.success("Snippet deleted.");
  };

  const handleUploadSnippetFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-uploading the same file
    if (!file) return;
    const lower = file.name.toLowerCase();
    const allowed = [".py", ".ipynb", ".js", ".jsx", ".ts", ".tsx", ".java", ".cpp", ".cc", ".c", ".h", ".hpp", ".txt"];
    if (!allowed.some(ext => lower.endsWith(ext))) {
      toast.error("Unsupported file. Upload a .py, .ipynb, or other code/text file.");
      return;
    }
    if (file.size > 512 * 1024) {
      toast.error("That file is too large (max 512 KB).");
      return;
    }
    try {
      const text = await file.text();
      const extracted = extractCodeFromFile(file.name, text);
      setCode(extracted);
      const lang = languageFromFilename(file.name);
      if (lang) {
        setSelectedLanguage(lang);
        setPracticeLanguage(lang);
      }
      setActiveSnippetId(null);
      setActiveProblem(prev => (prev ? { ...prev, title: file.name } : prev));
      toast.success(`Loaded ${file.name} into the editor.`);
    } catch (error) {
      console.error("[snippets] upload failed", error);
      toast.error("Could not read that file.");
    }
  };

  const sendDashboardPrompt = (text, options = {}) => {
    if (options.quizPdf) setQuizPdfStartIndex(messages.length);
    if (onStartFreshChat) {
      onStartFreshChat({
        type: "send",
        title: options.title || "Coding Tutor",
        text,
      });
      return;
    }
    onSendToChat?.(text, true);
  };

  const saveLatestQuizAsPdf = () => {
    if (!latestQuizResponse) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      toast.error("Allow popups to save the generated quiz as a PDF.");
      return;
    }
    const escapedContent = latestQuizResponse
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>CS Navigator Generated Quiz</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111827; margin: 40px; line-height: 1.5; }
            h1 { color: #1d4ed8; margin-bottom: 4px; }
            small { color: #6b7280; }
            pre { white-space: pre-wrap; font-family: inherit; margin-top: 28px; }
          </style>
        </head>
        <body>
          <h1>CS Navigator Generated Quiz</h1>
          <small>${new Date().toLocaleString()}</small>
          <pre>${escapedContent}</pre>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const navigatePracticeProblem = async (direction) => {
    if (activeQuestionIndex < 0) return;
    const targetIndex = findAdjacentUnsolvedIndex(activeQuestionIndex, direction);
    if (targetIndex < 0) return;
    const nextQuestion = questions[targetIndex];
    if (!nextQuestion) return;
    setProblemLoading(true);
    try {
      if (activeProblem && activeProblem.source !== "leetcode") {
        if (hasStarterCodeChanged(code, activeSolution?.starter_code)) {
          await saveProgress(activeProblem.id, { status: activeLanguageProgress?.status === "solved" ? "solved" : "in_progress", code }, selectedLanguageKey);
        }
      }
      await loadQuestionSolution(nextQuestion, practiceLanguage);
    } catch (error) {
      console.error("[coding-practice] navigation failed", error);
      toast.error("Could not load the next practice problem");
    } finally {
      setProblemLoading(false);
    }
  };

  const runFreeform = async () => {
    // Running code during a mock counts the current problem as attempted.
    if (mockSession && activeProblem?.mock) markMockAttempted();
    if (!["python", "javascript", "java", "cpp"].includes(selectedLanguageKey)) {
      setTestOutput({ status: "error", message: "Free run supports Python, JavaScript, Java, and C++." });
      setTerminalOpen(true);
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
      setTestOutput({ status: "error", message: "Please sign in before running code." });
      setTerminalOpen(true);
      return;
    }
    setIsRunning(true);
    setTerminalOpen(true);
    setTestOutput({ status: "running", message: `Running your ${selectedLanguage} code...` });
    const controller = new AbortController();
    runAbortRef.current = controller;
    try {
      const response = await fetch(`${apiBase}/api/coding/practice/freerun`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ language: selectedLanguageKey, code }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `runner ${response.status}`);
      setTestOutput(data);
      setWorkspaceSnapshots(prev => ({
        ...prev,
        [activeSnapshotKey]: {
          ...(prev[activeSnapshotKey] || {}),
          current: code,
          lastRun: summarizeRunForTutor(data),
        },
      }));
    } catch (error) {
      if (error.name === "AbortError") return; // stopRun already set the message
      console.error("[coding-freerun] failed", error);
      setTestOutput({ status: "error", free_run: true, message: "The local runner could not complete.", stderr: String(error.message || error) });
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      setIsRunning(false);
    }
  };

  const runAttempt = async () => {
    if (!activeProblem || activeProblem.source === "personal") {
      await runFreeform();
      return;
    }
    if (activeProblem.source === "leetcode") {
      setTestOutput({ status: "error", message: "Daily LeetCode challenges are not auto-graded in CS Navigator yet. Open the Source link for official tests." });
      setTerminalOpen(true);
      return;
    }
    if (!isQuizBankProblem) {
      await runFreeform();
      return;
    }
    if (!["python", "javascript"].includes(selectedLanguageKey)) {
      setTestOutput({ status: "error", message: "The V2.1 runner supports Python and JavaScript. Switch to one of those languages, edit your solution, and retry." });
      setTerminalOpen(true);
      return;
    }
    if (!hasStarterCodeChanged(code, activeSolution?.starter_code)) {
      setTestOutput({ status: "ready", message: "Make a change to the starter code before running tests. Loading a starter does not count as progress." });
      setTerminalOpen(true);
      return;
    }
    const mismatchMessage = detectLanguageMismatch(code, selectedLanguageKey);
    if (mismatchMessage) {
      setTestOutput({ status: "error", message: mismatchMessage });
      setTerminalOpen(true);
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
      setTestOutput({ status: "error", message: "Please sign in before running local practice tests." });
      setTerminalOpen(true);
      return;
    }

    setIsRunning(true);
    setTerminalOpen(true);
    setTestOutput({ status: "running", message: `Running local ${selectedLanguage} tests...` });
    const controller = new AbortController();
    runAbortRef.current = controller;
    try {
      const response = await fetch(`${apiBase}/api/coding/practice/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question_id: activeProblem.id, language: selectedLanguageKey, code }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `runner ${response.status}`);
      setTestOutput(data);
      setWorkspaceSnapshots(prev => ({
        ...prev,
        [activeSnapshotKey]: {
          ...(prev[activeSnapshotKey] || {}),
          current: code,
          lastRun: summarizeRunForTutor(data),
          ...(data.status === "passed" ? { lastPassing: code } : {}),
        },
      }));
      if (data.progress) {
        writeLocalProgress(activeProblem.id, selectedLanguageKey, data.progress);
        setProgressByLanguage(prev => {
          const next = {
            ...prev,
            [activeProblem.id]: {
              ...(prev[activeProblem.id] || {}),
              [selectedLanguageKey]: data.progress,
            },
          };
          setProgressByQuestion(aggregateProgressMap(next));
          return next;
        });
      } else if (data.status === "passed") {
        const localProgress = {
          question_id: activeProblem.id,
          language: selectedLanguageKey,
          status: "solved",
          code,
          attempt_count: (activeProgress?.attempt_count || 0) + 1,
          updated_at: new Date().toISOString(),
          solved_at: new Date().toISOString(),
        };
        writeLocalProgress(activeProblem.id, selectedLanguageKey, localProgress);
        // Solved for this language → the unrun draft is now redundant; drop it so a
        // future reopen shows the saved solved code, not a stale draft.
        clearDraft(activeProblem.id, selectedLanguageKey);
        setProgressByLanguage(prev => {
          const next = {
            ...prev,
            [activeProblem.id]: {
              ...(prev[activeProblem.id] || {}),
              [selectedLanguageKey]: localProgress,
            },
          };
          setProgressByQuestion(aggregateProgressMap(next));
          return next;
        });
      }
      if (data.status === "passed") {
        toast.success("All local tests passed. Problem marked solved.");
      }
    } catch (error) {
      if (error.name === "AbortError") return; // stopRun already set the message
      console.error("[coding-runner] failed", error);
      setTestOutput({ status: "error", message: "The local runner could not complete.", stderr: String(error.message || error) });
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      setIsRunning(false);
    }
  };

  const markSolved = async () => {
    if (!activeProblem || !isQuizBankProblem) return;
    await saveProgress(activeProblem.id, { status: "solved", code });
    clearDraft(activeProblem.id, selectedLanguageKey);
    setTerminalOpen(true);
    setTestOutput({ status: "passed", message: "Marked solved manually. Your current code was saved with this problem.", passed: 0, total: 0, tests: [] });
    toast.success("Practice problem marked solved");
  };

  const clearWorkspace = async () => {
    // Save the current quiz problem first so reopening it later restores the
    // latest code, then unload it and leave a blank scratchpad.
    if (activeProblem && activeProblem.source !== "leetcode" && activeProblem.source !== "personal") {
      if (hasStarterCodeChanged(code, activeSolution?.starter_code)) {
        try {
          await saveProgress(
            activeProblem.id,
            { status: activeLanguageProgress?.status === "solved" ? "solved" : "in_progress", code },
            selectedLanguageKey,
          );
        } catch (error) {
          console.warn("[coding-practice] save before clear failed", error);
        }
      }
    }
    // Explicit clear = don't auto-reopen this problem next time (the draft stays,
    // so reopening it from the library still restores the code on demand).
    clearLastWorkspace();
    autoReopenedRef.current = true;
    setActiveProblem(null);
    setActiveSolution(null);
    setCode("");
    setNote("");
    setRevealedHints(0);
    setWorkspaceTab("Editor");
    setTerminalOpen(false);
    setTestOutput({ status: "ready", message: "Workspace cleared. Write your own Python or JavaScript and press Run to test it (not graded)." });
    toast.success("Workspace cleared. Reopen a problem from the Practice Library to restore it.");
  };

  const showNextHint = () => {
    const unlocked = hintSteps.filter(hint => !hint.locked).length;
    if (revealedHints >= unlocked && hintSteps.some(hint => hint.locked)) {
      toast.info("Final hint unlocks after 2 Run attempts.");
      return;
    }
    setRevealedHints(prev => Math.min(prev + 1, unlocked));
    setWorkspaceTab("Hints");
  };

  const showAllHints = () => {
    const unlocked = hintSteps.filter(hint => !hint.locked).length;
    if (unlocked < hintSteps.length) toast.info("Final hint unlocks after 2 Run attempts.");
    setRevealedHints(unlocked);
    setWorkspaceTab("Hints");
  };

  const openPage = (pageId) => {
    // Guard: leaving the personal workspace with unsaved code prompts to save first.
    guardPersonalNav(() => {
      // Record edits to a quiz problem before navigating away (so it appears under
      // "Continue where you left off" even if it was never run).
      savePendingProblemProgress();
      if (pageId === "workspace") {
        setWorkspaceVisible(true);
        // The nav "Workspace" tab is the CODING (Quiz Bank) workspace. If we were in
        // the personal "My Snippets" workspace, leave it so this shows the quiz
        // empty state with "Open Quiz Bank" — the personal workspace is reached only
        // from the Home button.
        if (activeProblem?.source === "personal") {
          setActiveProblem(null);
          setActiveSolution(null);
          setActiveSnippetId(null);
          setCode("");
          setPersonalSavedCode("");
          setTestOutput({ status: "ready", message: "" });
          setTerminalOpen(false);
        }
      }
      goToPage(pageId);
    });
  };

  const toggleWorkspace = () => {
    if (activePage === "workspace" && workspaceVisible) {
      setWorkspaceVisible(false);
      goToPage(lastNonWorkspacePage || "dashboard");
      return;
    }
    setWorkspaceVisible(true);
    goToPage("workspace");
  };

  const renderDashboard = () => (
    <CampusLabHome
      progressSummary={progressSummary}
      topicPacks={topicPacks}
      questions={allQuestions.length ? allQuestions : questions}
      progressByQuestion={progressByQuestion}
      nextUpQuestion={nextUpQuestion}
      dailyChallenge={dailyChallenge}
      dailyChallengeLoading={dailyChallengeLoading}
      dailyDoneToday={dailyDoneToday}
      displayStreak={displayStreak}
      latestQuizResponse={latestQuizResponse}
      onStartDaily={() => startDailyChallenge(true)}
      onOpenSnippets={openMySnippets}
      onSelectQuestion={selectQuestion}
      onOpenQuizBank={() => openPage("quiz")}
      onPrompt={sendDashboardPrompt}
      onSaveQuiz={saveLatestQuizAsPdf}
    />
  );

  // On a cold load / reload of a /coding/workspace/problem/:id URL, activeProblem
  // is still null while restoreWorkspaceProblem() fetches it. Derive that "restoring"
  // window PURELY from the URL + current problem (no state that can get stuck): the
  // URL points at a problem whose id we haven't loaded yet. While true, show the
  // panel's loading state instead of the empty "Open Practice Library" guide, which
  // was flashing on every reload. Reverts to false the moment activeProblem matches.
  const workspaceUrlTarget = workspaceTargetFromPath(location.pathname);
  const isRestoringProblem =
    workspaceUrlTarget.kind === "problem" &&
    activeProblem?.id !== workspaceUrlTarget.id;

  const renderWorkspace = () => (
    <section className={`coding-workbench ${terminalOpen ? "terminal-open" : "terminal-closed"} ${isPersonalMode ? "personal-workspace" : ""}`}>
      {/* Only show the mock bar while actually ON a mock problem. A mock session
          can linger in state after opening a regular problem; gating on
          activeProblem?.mock keeps the timer off non-mock problems. */}
      <MockInterviewBar
        session={mockSession && activeProblem?.mock ? mockSession : null}
        now={mockNow}
        canGoPrev={canGoPrevMock}
        onPrev={goToPreviousMockProblem}
        onNext={() => gotoMockProblem(mockSession.index + 1)}
        onSolved={() => setMockOutcome("solved")}
        onSkip={requestSkipMock}
        onFinish={finishMock}
        onEnd={confirmEndMock}
      />
      <div className="coding-workbench-main">
        {isPersonalMode ? (
          <PersonalPanel
            snippets={snippets}
            activeSnippetId={activeSnippetId}
            onNewSnippet={() => guardPersonalNav(() => newSnippet())}
            onOpenSnippet={(snippet) => guardPersonalNav(() => openPersonalWorkspace(snippet))}
            onDeleteSnippet={handleDeleteSnippet}
          />
        ) : (
          <ProblemPanel
            problem={activeProblem}
            solution={activeSolution}
            attempts={attempts}
            problemLoading={problemLoading || isRestoringProblem}
            isSolved={isActiveProblemSolved}
            solvedLanguages={activeSolvedLanguages}
            showProblemNavigation={isQuizBankProblem}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
            onPreviousProblem={() => navigatePracticeProblem(-1)}
            onNextProblem={() => navigatePracticeProblem(1)}
            onShowHint={showNextHint}
            onShowAllHints={showAllHints}
            onOpenQuizBank={() => openPage("quiz")}
            mockMode={Boolean(activeProblem?.mock && mockSession)}
            solutionUnlocked={
              !activeProblem?.mock ||
              (mockSession &&
                (mockSession.stuck.includes(activeProblem.id) ||
                  mockSession.outcomes[activeProblem.id] !== "unattempted"))
            }
            onStuck={markMockStuck}
            onViewSolutionMock={requestViewSolutionMock}
          />
        )}
        <CodeWorkspace
          activeProblem={activeProblem}
          code={code}
          selectedLanguage={selectedLanguage}
          languageOptions={CODE_LANGUAGES}
          languageFormat={languageFormat}
          workspaceTab={workspaceTab}
          hints={hintSteps}
          revealedHints={revealedHints}
          isRunning={isRunning}
          latestFeedback={latestFeedback}
          suggestedCodeBlock={suggestedCodeBlock}
          terminalOpen={terminalOpen}
          testOutput={testOutput}
          canMarkSolved={isQuizBankProblem}
          isPersonalMode={isPersonalMode}
          onCodeChange={setCode}
          onLanguageChange={changeSelectedLanguage}
          languageLocked={interviewLanguageLocked}
          onTabChange={setWorkspaceTab}
          onToggleTerminal={() => setTerminalOpen(prev => !prev)}
          onCloseTerminal={() => setTerminalOpen(false)}
          onRun={runAttempt}
          onMarkSolved={markSolved}
          onCopyCode={() => navigator.clipboard.writeText(code)}
          onApplyAICode={applyAiCode}
          onClearWorkspace={clearWorkspace}
          onShowHint={showNextHint}
          onShowAllHints={showAllHints}
          onExplainFailedTests={explainFailedTests}
          onExplainError={explainError}
          onExplainOneTest={explainOneTest}
          onStopRun={stopRun}
          onRequestReview={activeProblem?.source === "interview" ? null : requestReview}
          onSaveSnippet={handleSaveSnippet}
          onUploadFile={() => personalFileInputRef.current?.click()}
          codeRenderer={codeRenderer}
        />
      </div>
      <input
        ref={personalFileInputRef}
        type="file"
        accept=".py,.ipynb,.js,.jsx,.ts,.tsx,.java,.cpp,.cc,.c,.h,.hpp,.txt"
        style={{ display: "none" }}
        onChange={handleUploadSnippetFile}
      />
    </section>
  );

  const renderProgress = () => (
    <section className="coding-page-panel progress-page">
      <ProgressBadges
        questions={allQuestions.length ? allQuestions : questions}
        progressByQuestion={progressByQuestion}
        progressByLanguage={progressByLanguage}
        progressSummary={progressSummary}
        midSlot={<StatTiles progressSummary={progressSummary} />}
      />
    </section>
  );

  // Open the Practice Library pre-filtered to a topic (used by interview-problem
  // "Needs: …" prerequisite links so a student can go practice the fundamental first).
  // Resolves the label to a real library topic; ignores it if the library has none.
  const openPracticeTopic = (label) => {
    const topic = resolvePracticeTopic(label);
    if (!topic) return;
    setPendingQuizTopic(topic);
    goToPage("quiz");
  };

  const renderInterviewPrep = () => (
    <InterviewPrep
      questions={interviewQuestions}
      loading={interviewLoading}
      onSolve={openInterviewProblem}
      onStartMock={startMockInterview}
      resolvePracticeTopic={resolvePracticeTopic}
      onOpenPracticeTopic={openPracticeTopic}
      onOpenHistory={() => goToPage("history")}
    />
  );

  const renderInterviewHistory = () => (
    <section className="coding-page-panel interview-prep-page">
      <div className="interview-prep-hero">
        <span className="coding-kicker">Interview Prep</span>
        <h2>Past Interviews</h2>
        <p>Review the mock interviews you've completed — the questions you got, your saved code, and how you scored.</p>
        <button type="button" className="iv-history-back" onClick={() => goToPage("interview")}>
          ← Back to Interview Prep
        </button>
      </div>
      <PastInterviews showEmpty />
    </section>
  );

  const renderPage = () => {
    if (activePage === "dashboard") return renderDashboard();
    if (activePage === "daily") {
      return (
        <DailyChallengeCard
          dailyChallenge={dailyChallenge}
          loading={dailyChallengeLoading}
          onStartChallenge={() => startDailyChallenge(false)}
          onPracticeWithHints={() => startDailyChallenge(true)}
        />
      );
    }
    if (activePage === "quiz") {
      return (
        <QuizBank
          questions={questions}
          allQuestions={allQuestions}
          progressByQuestion={progressByQuestion}
          listLoading={listLoading}
          difficulty={difficulty}
          selectedLanguage={practiceLanguage}
          languageOptions={CODE_LANGUAGES}
          progressSummary={progressSummary}
          onDifficultyChange={setDifficulty}
          onLanguageChange={setPracticeLanguage}
          onSelectProblem={selectQuestion}
          initialTopic={pendingQuizTopic}
          onConsumeInitialTopic={() => setPendingQuizTopic(null)}
        />
      );
    }
    if (activePage === "interview") return renderInterviewPrep();
    if (activePage === "history") return renderInterviewHistory();
    if (activePage === "progress") return renderProgress();
    if (activePage === "workspace" && !workspaceVisible) {
      return (
        <section className="coding-page-panel workspace-hidden-panel">
          <span className="coding-kicker">Workspace Hidden</span>
          <h2>Your active workspace is saved.</h2>
          <p>Show it again from the mini sidebar when you want to keep coding.</p>
          <button type="button" className="daily-practice-btn" onClick={toggleWorkspace}>Show Workspace</button>
        </section>
      );
    }
    return renderWorkspace();
  };

  return (
    <div className={`coding-app ${activePage === "workspace" ? "coding-workspace-active" : ""} ${terminalOpen ? "terminal-open" : "terminal-closed"}`}>
      <div className="coding-nav-row">
        <nav className="coding-section-nav campus-section-nav" aria-label="Coding tutor sections">
        {CODING_PAGES.map(page => {
          const Icon = page.icon;
          return (
          <button
            key={page.id}
            type="button"
            className={activePage === page.id ? "active" : ""}
            onClick={() => openPage(page.id)}
            title={page.label}
            aria-label={page.label}
          >
            <span className="coding-nav-icon" aria-hidden="true"><Icon /></span>
            <span className="coding-nav-label">{page.label}</span>
          </button>
          );
        })}
        {/* Direct shortcut to the personal scratch space (My Snippets) — separate
            from the graded Workspace toggle below so the two stay distinctly named.
            Active when the personal workspace is the thing currently open. */}
        <button
          type="button"
          className={`coding-nav-snippets-btn ${activePage === "workspace" && isPersonalMode ? "active" : ""}`}
          onClick={() => guardPersonalNav(() => {
            // Match the other nav destinations (openPage): prompt before discarding
            // unsaved personal edits, and persist in-progress quiz-bank work first.
            savePendingProblemProgress();
            openMySnippets();
          })}
          title="My Snippets"
          aria-label="My Snippets"
          aria-pressed={activePage === "workspace" && isPersonalMode}
        >
          <span className="coding-nav-icon" aria-hidden="true"><FaFileCode /></span>
          <span className="coding-nav-label">My Snippets</span>
        </button>
        {/* toggleWorkspace HIDES only when we're already on the workspace; from any
            other page it SHOWS it. Derive every label from that same condition so
            the title/aria-label match what the click actually does (on Home the
            button opens the workspace, so it must say "Show Workspace"). */}
        {(() => {
          const willHideWorkspace = activePage === "workspace" && workspaceVisible;
          const label = willHideWorkspace ? "Hide Workspace" : "Show Workspace";
          return (
            <button
              type="button"
              className="coding-nav-workspace-toggle"
              onClick={toggleWorkspace}
              title={label}
              aria-label={label}
            >
              <span className="coding-nav-icon" aria-hidden="true">{willHideWorkspace ? <FaEyeSlash /> : <FaEye />}</span>
              <span className="coding-nav-label">{label}</span>
            </button>
          );
        })()}
        {/* Theme toggle sits last as a compact icon-only circle — a setting, not a
            destination. */}
        <button
          type="button"
          className="coding-nav-theme-toggle"
          onClick={() => setCodingDark(prev => !prev)}
          title={codingDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={codingDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-pressed={codingDark}
        >
          <span className="coding-nav-icon" aria-hidden="true">{codingDark ? <FaSun /> : <FaMoon />}</span>
          <span className="coding-nav-label">{codingDark ? "Light Mode" : "Dark Mode"}</span>
        </button>
        </nav>
      </div>
      <div className="coding-app-main">
        <div className="coding-app-content">{renderPage()}</div>
      </div>

      {mockSummary && (
        <MockSummary
          summary={mockSummary}
          onClose={() => { setMockSummary(null); goToPage("interview"); }}
          onReview={() => { setMockSummary(null); startMockInterview(); }}
        />
      )}

      <MockConfirm
        open={Boolean(mockConfirm)}
        title={mockConfirm?.title}
        body={mockConfirm?.body}
        confirmLabel={mockConfirm?.confirmLabel}
        tone={mockConfirm?.tone}
        onConfirm={mockConfirm?.onConfirm}
        onCancel={() => setMockConfirm(null)}
      />

      {unsavedPrompt && (
        <div className="unsaved-overlay" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
          <div className="unsaved-modal">
            <h3 id="unsaved-title">Unsaved changes</h3>
            <p>You have unsaved code in this workspace. Save it as a snippet before leaving, or discard your changes.</p>
            <div className="unsaved-actions">
              <button
                type="button"
                className="unsaved-btn unsaved-save"
                onClick={() => {
                  const proceed = unsavedPrompt;
                  const saved = handleSaveSnippet();
                  if (saved) { setUnsavedPrompt(null); proceed(); }
                  // if the name prompt was cancelled, keep the dialog open
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="unsaved-btn unsaved-discard"
                onClick={() => { const proceed = unsavedPrompt; setUnsavedPrompt(null); proceed(); }}
              >
                Discard
              </button>
              <button
                type="button"
                className="unsaved-btn unsaved-cancel"
                onClick={() => setUnsavedPrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
