import { useEffect, useMemo, useRef, useState } from "react";
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
} from "react-icons/fa";
import { toast } from "sonner";
import CodeWorkspace from "./CodeWorkspace";
import DailyChallengeCard from "./DailyChallengeCard";
import ProblemPanel from "./ProblemPanel";
import QuizBank from "./QuizBank";
import TerminalPanel from "./TerminalPanel";
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

const CODING_PAGES = [
  { id: "dashboard", label: "Home", icon: FaHome },
  { id: "quiz", label: "Quiz Bank", icon: FaBook },
  { id: "workspace", label: "Workspace", icon: FaLaptopCode },
  { id: "progress", label: "Progress", icon: FaChartLine },
];

const LANGUAGE_FORMATS = {
  Python: { indent: "4 spaces", file: "solution.py", style: "Function-focused" },
  Java: { indent: "4 spaces", file: "Solution.java", style: "Class method" },
  JavaScript: { indent: "2 spaces", file: "solution.js", style: "Function export" },
  "C++": { indent: "4 spaces", file: "solution.cpp", style: "Solution class" },
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

function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1).replace("_", " ") : "";
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
  const [practiceLanguage, setPracticeLanguage] = useState("Python");
  const [selectedLanguage, setSelectedLanguage] = useState("Python");
  const [questions, setQuestions] = useState([]);
  const [progressByQuestion, setProgressByQuestion] = useState({});
  const [progressByLanguage, setProgressByLanguage] = useState({});
  const [activeProblem, setActiveProblem] = useState(null);
  const [activeSolution, setActiveSolution] = useState(null);
  const [problemLoading, setProblemLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [testOutput, setTestOutput] = useState({ status: "ready", message: "Load a local Python or JavaScript practice problem, write an attempt, then use Run." });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [revealedHints, setRevealedHints] = useState(0);
  const [tutorMode, setTutorMode] = useState("Guided Tutor");
  const [quizPdfStartIndex, setQuizPdfStartIndex] = useState(null);
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
  const canGoPrevious = activeQuestionIndex > 0;
  const canGoNext = activeQuestionIndex >= 0 && activeQuestionIndex < questions.length - 1;

  const progressItems = useMemo(
    () => questions.map(question => ({ question, progress: progressByQuestion[question.id] })),
    [questions, progressByQuestion]
  );
  const solvedCount = progressItems.filter(item => item.progress?.status === "solved").length;
  const attemptedCount = progressItems.filter(item => (item.progress?.attempt_count || 0) > 0 || item.progress?.status === "solved").length;
  const totalAttempts = progressItems.reduce((sum, item) => sum + (item.progress?.attempt_count || 0), 0);
  const completionPercent = questions.length ? Math.round((solvedCount / questions.length) * 100) : 0;
  const displayStreak = Math.min(5, Math.max(0, solvedCount || attemptedCount ? Math.ceil((solvedCount + attemptedCount) / 4) : 0));
  const progressSummary = { solvedCount, attemptedCount, totalAttempts, completionPercent, displayStreak };

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
      suggestedCodeBlock,
      onApplyAICode: suggestedCodeBlock ? () => setCode(suggestedCodeBlock) : null,
    });
  }, [activePage, activeProblem, attempts, code, note, onContextChange, selectedLanguage, suggestedCodeBlock, tutorMode, workspaceTab, workspaceVisible]);

  useEffect(() => {
    onActivePageChange?.(activePage);
  }, [activePage, onActivePageChange]);

  useEffect(() => {
    const requestedPage = new URLSearchParams(location.search).get("page");
    if (!requestedPage) return;

    const allowedPages = new Set(["dashboard", "quiz", "workspace", "progress"]);
    if (!allowedPages.has(requestedPage)) return;

    if (requestedPage !== "workspace") setLastNonWorkspacePage(requestedPage);
    if (requestedPage === "workspace") setWorkspaceVisible(true);
    setActivePage(requestedPage);
  }, [location.search]);

  useEffect(() => {
    if (tutorModeRequest?.mode) setTutorMode(tutorModeRequest.mode);
  }, [tutorModeRequest]);

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
          ? PRACTICE_LANGUAGE_KEYS.map(language => fetch(`${apiBase}/api/coding/practice/progress?difficulty=${difficulty}&language=${language}`, {
              headers: { Authorization: `Bearer ${token}` },
            }).then(response => ({ language, response })))
          : [];
        const cachedQuestions = questionCacheRef.current[difficulty];
        const [questionResponse, ...progressResults] = await Promise.all([
          cachedQuestions
            ? Promise.resolve(null)
            : fetch(`${apiBase}/api/coding/practice/questions?difficulty=${difficulty}`),
          ...progressRequests,
        ]);
        let nextQuestions = cachedQuestions || [];
        if (!cachedQuestions) {
          if (!questionResponse.ok) throw new Error(`questions ${questionResponse.status}`);
          const questionData = await questionResponse.json();
          nextQuestions = questionData.questions || [];
          questionCacheRef.current[difficulty] = nextQuestions;
        }
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
        nextQuestions.forEach((question) => {
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
          setProgressByLanguage(nextLanguageProgress);
          setProgressByQuestion(aggregateProgressMap(nextLanguageProgress));
        }
      } catch (error) {
        console.error("[coding-practice] load failed", error);
        if (!cancelled) {
          setQuestions([]);
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
    setCode(existingCode ?? progress?.code ?? solution?.starter_code ?? "");
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
    if (!activeProblem || activeProblem.source === "leetcode") {
      setSelectedLanguage(languageName);
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
    const nextQuestion = questions[activeQuestionIndex + direction];
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

  const runAttempt = async () => {
    if (!activeProblem) {
      setTestOutput({ status: "error", message: "Load a local quiz-bank problem before running tests. For personal code, use the floating tutor chat for review." });
      setTerminalOpen(true);
      return;
    }
    if (activeProblem.source === "leetcode") {
      setTestOutput({ status: "error", message: "Daily LeetCode challenges are not auto-graded in CS Navigator yet. Open the Source link for official tests." });
      setTerminalOpen(true);
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
      setTestOutput(data);
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
    if (!activeProblem || activeProblem.source === "leetcode") return;
    await saveProgress(activeProblem.id, { status: "solved", code });
    setTerminalOpen(true);
    setTestOutput({ status: "passed", message: "Marked solved manually. Your current code was saved with this problem.", passed: 0, total: 0, tests: [] });
    toast.success("Practice problem marked solved");
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
          <span>Estimated Time: {estimateChallengeTime(dailyChallenge?.difficulty)}</span>
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
          onCodeChange={setCode}
          onLanguageChange={changeSelectedLanguage}
          onTabChange={setWorkspaceTab}
          onToggleTerminal={() => setTerminalOpen(true)}
          onRun={runAttempt}
          onMarkSolved={markSolved}
          onCopyCode={() => navigator.clipboard.writeText(code)}
          onApplyAICode={() => setCode(suggestedCodeBlock)}
          onShowHint={showNextHint}
          onShowAllHints={showAllHints}
          codeRenderer={codeRenderer}
        />
      </div>
    </section>
  );

  const renderProgress = () => (
    <section className="coding-page-panel">
      <ProgressOverview progressSummary={progressSummary} />
      <div className="coding-progress-stats"><div><strong>{solvedCount}</strong><span>Solved</span></div><div><strong>{attemptedCount}</strong><span>Attempted</span></div><div><strong>{completionPercent}%</strong><span>Complete</span></div></div>
      <div className="practice-question-list progress-list">
        {progressItems.map(({ question, progress }) => <button key={question.id} type="button" className="practice-question-row" onClick={() => selectQuestion(question)}><span><strong>{question.title}</strong><small>{question.topic}</small></span><span className={`practice-status ${progress?.status || "not_started"}`}>{titleCase(progress?.status || "not_started")}</span></button>)}
      </div>
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
          progressByQuestion={progressByQuestion}
          listLoading={listLoading}
          difficulty={difficulty}
          selectedLanguage={practiceLanguage}
          languageOptions={CODE_LANGUAGES}
          progressSummary={progressSummary}
          onDifficultyChange={setDifficulty}
          onLanguageChange={setPracticeLanguage}
          onSelectProblem={selectQuestion}
        />
      );
    }
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
            <TerminalPanel testOutput={testOutput} expanded onClose={() => setTerminalOpen(false)} />
          </div>
        )
      )}
    </div>
  );
}
