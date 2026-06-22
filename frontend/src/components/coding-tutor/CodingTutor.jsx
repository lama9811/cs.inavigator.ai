import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  FaBook,
  FaChartLine,
  FaChevronLeft,
  FaChevronRight,
  FaEye,
  FaEyeSlash,
  FaHome,
  FaLaptopCode,
  FaUserGraduate,
} from "react-icons/fa";
import { toast } from "sonner";
import CodeWorkspace from "./CodeWorkspace";
import DailyChallengeCard from "./DailyChallengeCard";
import ProblemPanel from "./ProblemPanel";
import ProgressBadges from "./ProgressBadges";
import QuizBank from "./QuizBank";
import TerminalPanel from "./TerminalPanel";
import TopicPracticePacks from "./TopicPracticePacks";
import "./CodingTutor.css";
import "./TerminalPanel.css";

const CODE_LANGUAGES = ["Python", "Java", "JavaScript", "C++"];
const PRACTICE_LANGUAGE_API = {
  Python: "python",
  Java: "java",
  JavaScript: "javascript",
  "C++": "cpp",
};
const PRACTICE_LANGUAGE_KEYS = ["python", "java", "javascript", "cpp"];
const PRACTICE_DIFFICULTIES = ["easy", "medium", "hard"];

const CODING_PAGES = [
  { id: "dashboard", label: "Home", icon: FaHome },
  { id: "quiz", label: "Quiz Bank", icon: FaBook },
  { id: "interview", label: "Interview Prep", icon: FaUserGraduate },
  { id: "workspace", label: "Workspace", icon: FaLaptopCode },
  { id: "progress", label: "Progress", icon: FaChartLine },
];

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

function estimateChallengeTime(difficulty = "Easy") {
  const normalized = String(difficulty).toLowerCase();
  if (normalized === "hard") return "25 min";
  if (normalized === "medium") return "15 min";
  return "5 min";
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

function buildQualityChecklist(language, output = {}) {
  if (output.status !== "passed") return [];
  return [
    "All local tests passed.",
    `Review ${language} naming, indentation, and readability before submitting.`,
    "Check one empty/minimum input and one larger input by hand.",
    "Confirm the time and space complexity match your intended approach.",
  ];
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

function ProgressOverview({ progressSummary }) {
  return (
    <section className="practice-progress-overview">
      <div>
        <span className="coding-kicker">Progress Overview</span>
        <strong>{progressSummary.completionPercent}% complete</strong>
      </div>
      <div className="progress-bar" aria-label={`${progressSummary.completionPercent}% complete`}>
        <span style={{ width: `${progressSummary.completionPercent}%` }} />
      </div>
      <div className="progress-overview-stats">
        <span>{progressSummary.solvedCount} Solved</span>
        <span>{progressSummary.attemptedCount} Attempted</span>
        <span>{progressSummary.displayStreak} Day Streak</span>
      </div>
    </section>
  );
}

export default function CodingTutor({
  apiBase,
  codeRenderer,
  messages = [],
  onContextChange,
  onActivePageChange,
  onPrefillChat,
  onStartFreshChat,
  onSendToChat,
  tutorModeRequest,
}) {
  const location = useLocation();
  const [activePage, setActivePage] = useState("dashboard");
  const [lastNonWorkspacePage, setLastNonWorkspacePage] = useState("dashboard");
  const [workspaceVisible, setWorkspaceVisible] = useState(true);
  const [miniSidebarCollapsed, setMiniSidebarCollapsed] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState("Editor");
  const [dailyChallenge, setDailyChallenge] = useState(null);
  const [dailyChallengeLoading, setDailyChallengeLoading] = useState(false);
  const [difficulty, setDifficulty] = useState("easy");
  const [selectedTopicPack, setSelectedTopicPack] = useState("");
  const [practiceLanguage, setPracticeLanguage] = useState("Python");
  const [selectedLanguage, setSelectedLanguage] = useState("Python");
  const [questions, setQuestions] = useState([]);
  const [allQuestions, setAllQuestions] = useState([]);
  const [progressByQuestion, setProgressByQuestion] = useState({});
  const [progressByLanguage, setProgressByLanguage] = useState({});
  const [activeProblem, setActiveProblem] = useState(null);
  const [activeSolution, setActiveSolution] = useState(null);
  const [problemLoading, setProblemLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [testOutput, setTestOutput] = useState({ status: "ready", message: "Load a Quiz Bank problem to run graded tests, or just write Python/JavaScript here and press Run to test your own code." });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [revealedHints, setRevealedHints] = useState(0);
  const [tutorMode, setTutorMode] = useState("Guided Tutor");
  const [quizPdfStartIndex, setQuizPdfStartIndex] = useState(null);
  const [workspaceSnapshots, setWorkspaceSnapshots] = useState({});
  const questionCacheRef = useRef({});
  const solutionCacheRef = useRef({});
  const selectedLanguageKey = PRACTICE_LANGUAGE_API[selectedLanguage] || "python";
  const activeLanguageProgress = activeProblem ? progressByLanguage[activeProblem.id]?.[selectedLanguageKey] : null;
  const activeProgress = activeLanguageProgress || (activeProblem ? progressByQuestion[activeProblem.id] : null);
  const attempts = activeProgress?.attempt_count || 0;
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
  const displayStreak = Math.min(5, Math.max(0, solvedCount || attemptedCount ? Math.ceil((solvedCount + attemptedCount) / 4) : 0));
  const progressSummary = { solvedCount, attemptedCount, totalAttempts, completionPercent, displayStreak };
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

  const explainFailedTests = useCallback(() => {
    const summary = summarizeRunForTutor(testOutput);
    if (!summary) {
      toast.info("Run your code first so the tutor can see the test output.");
      return;
    }
    setTutorMode("Debugging");
    onSendToChat?.([
      "Explain these failed tests in small chunks. Point out the likely code issue first, then give one focused next step.",
      "",
      summary,
    ].join("\n"), true);
  }, [onSendToChat, testOutput]);

  const explainError = useCallback(() => {
    const out = testOutput || {};
    const errorText = [out.stderr, out.message].filter(Boolean).join("\n").trim();
    if (!errorText) {
      toast.info("Run your code first so the tutor can see the error.");
      return;
    }
    setTutorMode("Debugging");
    onSendToChat?.([
      "My code produced this error when I ran it. In plain English: what does this error mean, what is the most likely cause, and what is one focused fix to try? Do not rewrite my whole program.",
      "",
      `Language: ${selectedLanguage}`,
      "Error output:",
      "```",
      errorText.slice(0, 1500),
      "```",
    ].join("\n"), true);
  }, [onSendToChat, testOutput, selectedLanguage]);

  useEffect(() => {
    const isWorkspaceContext = activePage === "workspace" && workspaceVisible;
    onContextChange?.({
      activeProblem: isWorkspaceContext ? activeProblem : null,
      selectedLanguage,
      code: isWorkspaceContext ? code : "",
      attempts: isWorkspaceContext ? attempts : 0,
      workspaceTab: isWorkspaceContext ? workspaceTab : activePage,
      note: isWorkspaceContext ? note : "",
      tutorMode,
      runnerSummary: isWorkspaceContext ? runnerSummary : "",
      workspaceSnapshots: isWorkspaceContext ? activeSnapshots : {},
      suggestedCodeBlock,
      onApplyAICode: suggestedCodeBlock ? applyAiCode : null,
    });
  }, [activePage, activeProblem, attempts, code, note, onContextChange, selectedLanguage, suggestedCodeBlock, tutorMode, workspaceTab, workspaceVisible, runnerSummary, activeSnapshots, applyAiCode]);

  useEffect(() => {
    onActivePageChange?.(activePage);
  }, [activePage, onActivePageChange]);

  useEffect(() => {
    const requestedPage = new URLSearchParams(location.search).get("page");
    if (!requestedPage) return;

    const allowedPages = new Set(["dashboard", "quiz", "interview", "workspace", "progress"]);
    if (!allowedPages.has(requestedPage)) return;

    if (requestedPage !== "workspace") setLastNonWorkspacePage(requestedPage);
    if (requestedPage === "workspace") setWorkspaceVisible(true);
    setActivePage(requestedPage);
  }, [location.search]);

  useEffect(() => {
    if (tutorModeRequest?.mode) setTutorMode(tutorModeRequest.mode);
  }, [tutorModeRequest]);

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
        if (!cancelled) setListLoading(false);
      }
    };
    fetchPractice();
    return () => { cancelled = true; };
  }, [apiBase, difficulty]);

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
    const nextCode = existingCode ?? progress?.code ?? solution?.starter_code ?? "";
    setCode(nextCode);
    setWorkspaceSnapshots(prev => ({
      ...prev,
      [`${problem.id}:${language}`]: {
        ...(prev[`${problem.id}:${language}`] || {}),
        starter: solution?.starter_code || "",
        current: nextCode,
      },
    }));
    setNote(`Practice problem: ${problem.title}`);
    const runnerLabel = language === "python" || language === "javascript"
      ? `${languageName} local tests can run from the terminal below the editor.`
      : `${languageName} starter loaded. Java and C++ runners are coming later.`;
    setTestOutput({ status: "ready", message: `${problem.title} loaded in ${languageName}. ${runnerLabel}` });
    setTerminalOpen(false);
    setActivePage("workspace");
    setWorkspaceVisible(true);
    setWorkspaceTab("Editor");
    setRevealedHints(0);
  };

  const selectQuestion = async (problem) => {
    setProblemLoading(true);
    try {
      await loadQuestionSolution(problem, practiceLanguage);
    } catch (error) {
      console.error("[coding-practice] select failed", error);
      toast.error("Could not load that practice problem");
    } finally {
      setProblemLoading(false);
    }
  };

  const changeSelectedLanguage = async (languageName) => {
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
    const title = dailyChallenge?.title || "Daily coding challenge";
    const prompt = dailyChallenge?.available
      ? `Solve today's LeetCode daily challenge: ${title}. Open the LeetCode link for the full prompt, then use this workspace for notes and code.`
      : "Daily challenge is unavailable. Use this workspace for a short practice prompt or open Quiz Bank.";
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
    setActivePage("workspace");
    setWorkspaceVisible(true);
    setWorkspaceTab("Editor");
    setRevealedHints(0);
  };

  const openPersonalWorkspace = () => {
    setTutorMode("Code Review");
    if (onStartFreshChat) {
      onStartFreshChat({
        type: "prefill",
        title: "Review my code",
        text: "Review this code and point out the most important issue first:\n\n",
      });
      return;
    }
    onPrefillChat?.("Review this code and point out the most important issue first:\n\n");
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

  const openTopicPack = (topic) => {
    setSelectedTopicPack(topic);
    setActivePage("quiz");
    setLastNonWorkspacePage("quiz");
  };

  const findTopicVideo = (topic) => {
    window.open(topicVideoUrl(topic), "_blank", "noopener,noreferrer");
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
    if (!["python", "javascript"].includes(selectedLanguageKey)) {
      setTestOutput({ status: "error", message: "Free run supports Python and JavaScript. Switch to one of those languages to run personal code." });
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
    try {
      const response = await fetch(`${apiBase}/api/coding/practice/freerun`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ language: selectedLanguageKey, code }),
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
      console.error("[coding-freerun] failed", error);
      setTestOutput({ status: "error", free_run: true, message: "The local runner could not complete.", stderr: String(error.message || error) });
    } finally {
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
    try {
      const response = await fetch(`${apiBase}/api/coding/practice/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question_id: activeProblem.id, language: selectedLanguageKey, code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `runner ${response.status}`);
      const enrichedData = {
        ...data,
        quality_checklist: buildQualityChecklist(selectedLanguage, data),
      };
      setTestOutput(enrichedData);
      setWorkspaceSnapshots(prev => ({
        ...prev,
        [activeSnapshotKey]: {
          ...(prev[activeSnapshotKey] || {}),
          current: code,
          lastRun: summarizeRunForTutor(enrichedData),
          ...(enrichedData.status === "passed" ? { lastPassing: code } : {}),
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
      console.error("[coding-runner] failed", error);
      setTestOutput({ status: "error", message: "The local runner could not complete.", stderr: String(error.message || error) });
    } finally {
      setIsRunning(false);
    }
  };

  const markSolved = async () => {
    if (!activeProblem || !isQuizBankProblem) return;
    await saveProgress(activeProblem.id, { status: "solved", code });
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
    setActiveProblem(null);
    setActiveSolution(null);
    setCode("");
    setNote("");
    setRevealedHints(0);
    setWorkspaceTab("Editor");
    setTerminalOpen(false);
    setTestOutput({ status: "ready", message: "Workspace cleared. Write your own Python or JavaScript and press Run to test it (not graded)." });
    toast.success("Workspace cleared. Reopen a problem from Quiz Bank to restore it.");
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
    if (pageId !== "workspace") setLastNonWorkspacePage(pageId);
    if (pageId === "workspace") setWorkspaceVisible(true);
    setActivePage(pageId);
  };

  const toggleWorkspace = () => {
    if (activePage === "workspace" && workspaceVisible) {
      setWorkspaceVisible(false);
      setActivePage(lastNonWorkspacePage || "dashboard");
      return;
    }
    setWorkspaceVisible(true);
    setActivePage("workspace");
  };

  const renderDashboard = () => (
    <section className="coding-dashboard">
      <ProgressOverview progressSummary={progressSummary} />
      <section className="coding-blurb-section">
        <div className="coding-dashboard-prompts" aria-label="Coding tutor prompt suggestions">
          <button type="button" className="coding-prompt-card blue" onClick={() => sendDashboardPrompt("Can you generate a practice quiz for me on arrays, strings, and loops?", { quizPdf: true, title: "Practice quiz" })}>
            Can you generate a practice quiz for me?
          </button>
          <button type="button" className="coding-prompt-card red" onClick={() => openPersonalWorkspace()}>
            Review my code and explain the biggest issue.
          </button>
          <button type="button" className="coding-prompt-card gold" onClick={() => sendDashboardPrompt("Help me prepare for a technical interview problem with hints first.", { title: "Interview prep" })}>
            Help me prepare for a technical interview problem.
          </button>
        </div>
        {latestQuizResponse && (
          <button type="button" className="save-quiz-pdf-btn" onClick={saveLatestQuizAsPdf}>
            Save generated quiz as PDF
          </button>
        )}
      </section>
      <section className="daily-feature-card dashboard-daily coding-dashboard-section">
        <span className="coding-kicker">Today&apos;s Challenge</span>
        <h2>{dailyChallenge?.title || "Daily practice"}</h2>
        <div className="daily-meta-row">
          <span className={`daily-difficulty ${String(dailyChallenge?.difficulty || "Easy").toLowerCase()}`}>{dailyChallenge?.difficulty || "Easy"}</span>
          <span className="daily-eta-pill">Estimated Time: {estimateChallengeTime(dailyChallenge?.difficulty)}</span>
        </div>
        {dailyChallenge?.available === false && <p>{dailyChallenge.message}</p>}
        <div className="daily-actions">
          <button type="button" className="daily-practice-btn" onClick={() => startDailyChallenge(true)}>
            Practice
          </button>
          {dailyChallenge?.url && (
            <a href={dailyChallenge.url} target="_blank" rel="noopener noreferrer" className="daily-link">
              Source
            </a>
          )}
        </div>
      </section>
    </section>
  );

  const renderWorkspace = () => (
    <section className={`coding-workbench ${terminalOpen ? "terminal-open" : "terminal-closed"}`}>
      <div className="coding-workbench-main">
        <ProblemPanel
          problem={activeProblem}
          solution={activeSolution}
          attempts={attempts}
          problemLoading={problemLoading}
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
        />
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
          canMarkSolved={isQuizBankProblem}
          onCodeChange={setCode}
          onLanguageChange={changeSelectedLanguage}
          onTabChange={setWorkspaceTab}
          onToggleTerminal={() => setTerminalOpen(true)}
          onRun={runAttempt}
          onMarkSolved={markSolved}
          onCopyCode={() => navigator.clipboard.writeText(code)}
          onApplyAICode={applyAiCode}
          onClearWorkspace={clearWorkspace}
          onShowHint={showNextHint}
          onShowAllHints={showAllHints}
          codeRenderer={codeRenderer}
        />
      </div>
    </section>
  );

  const renderProgress = () => (
    <section className="coding-page-panel progress-page">
      <ProgressOverview progressSummary={progressSummary} />
      <div className="coding-progress-stats"><div><strong>{solvedCount}</strong><span>Solved</span></div><div><strong>{attemptedCount}</strong><span>Attempted</span></div><div><strong>{completionPercent}%</strong><span>Complete</span></div></div>
      <ProgressBadges
        questions={allQuestions.length ? allQuestions : questions}
        progressByQuestion={progressByQuestion}
        progressByLanguage={progressByLanguage}
        progressSummary={progressSummary}
      />
    </section>
  );

  const renderInterviewPrep = () => (
    <section className="coding-page-panel interview-prep-page">
      <div className="interview-prep-hero">
        <span className="coding-kicker">Interview Prep</span>
        <h2>Practice by topic</h2>
        <p>
          Pick a topic pack to filter Quiz Bank across Easy, Medium, and Hard problems.
          Use the video link when you want a quick refresher before practicing.
        </p>
      </div>
      <TopicPracticePacks
        packs={topicPacks}
        selectedTopic={selectedTopicPack}
        onSelectTopic={openTopicPack}
        onFindVideo={findTopicVideo}
      />
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
          selectedTopicPack={selectedTopicPack}
          onDifficultyChange={setDifficulty}
          onLanguageChange={setPracticeLanguage}
          onClearTopicPack={() => setSelectedTopicPack("")}
          onSelectProblem={selectQuestion}
        />
      );
    }
    if (activePage === "interview") return renderInterviewPrep();
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
    <div className={`coding-app ${miniSidebarCollapsed ? "mini-sidebar-collapsed" : ""} ${activePage === "workspace" ? "coding-workspace-active" : ""} ${terminalOpen ? "terminal-open" : "terminal-closed"}`}>
      <nav className="coding-section-nav" aria-label="Coding tutor navigation">
        <button
          type="button"
          className="coding-nav-collapse"
          onClick={() => setMiniSidebarCollapsed(prev => !prev)}
          title={miniSidebarCollapsed ? "Expand coding navigation" : "Collapse coding navigation"}
        >
          {miniSidebarCollapsed ? <FaChevronRight aria-hidden="true" /> : <FaChevronLeft aria-hidden="true" />}
        </button>
        {CODING_PAGES.map(page => {
          const Icon = page.icon;
          return (
          <button
            key={page.id}
            type="button"
            className={activePage === page.id ? "active" : ""}
            onClick={() => openPage(page.id)}
            title={page.label}
          >
            <span className="coding-nav-icon" aria-hidden="true"><Icon /></span>
            <span className="coding-nav-label">{page.label}</span>
          </button>
          );
        })}
        <button type="button" className="coding-nav-workspace-toggle" onClick={toggleWorkspace} title={workspaceVisible ? "Hide Workspace" : "Show Workspace"}>
          <span className="coding-nav-icon" aria-hidden="true">{workspaceVisible ? <FaEyeSlash /> : <FaEye />}</span>
          <span className="coding-nav-label">{activePage === "workspace" && workspaceVisible ? "Hide Workspace" : "Show Workspace"}</span>
        </button>
      </nav>
      <div className="coding-app-main">
        <div className="coding-app-content">{renderPage()}</div>
      </div>
      {activePage === "workspace" && workspaceVisible && (
        terminalOpen && (
          <div className="coding-shell-terminal">
            <TerminalPanel
              testOutput={testOutput}
              expanded
              onClose={() => setTerminalOpen(false)}
              onExplainFailedTests={explainFailedTests}
              onExplainError={explainError}
            />
          </div>
        )
      )}
    </div>
  );
}
