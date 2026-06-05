import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import CodeWorkspace from "./CodeWorkspace";
import DailyChallengeCard from "./DailyChallengeCard";
import ProblemPanel from "./ProblemPanel";
import QuizBank from "./QuizBank";
import TutorPanel from "./TutorPanel";
import TutorChat from "./TutorChat";
import "./CodingTutor.css";

const CODE_LANGUAGES = ["Python", "Java", "JavaScript", "C++"];
const PRACTICE_LANGUAGE_API = {
  Python: "python",
  Java: "java",
  JavaScript: "javascript",
  "C++": "cpp",
};

const CODING_PAGES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "daily", label: "Daily Challenge" },
  { id: "quiz", label: "Quiz Bank" },
  { id: "progress", label: "Progress" },
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

function normalizeSnippet(text = "") {
  return String(text).split("\n").filter(line => line.trim()).slice(0, 5).join("\n");
}

function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1).replace("_", " ") : "";
}

function buildHintSteps(problem, solution, attempts) {
  if (!problem) return [];
  const topic = problem.topic || "the main pattern";
  const givenHints = problem.hints || [];
  const guided = solution?.guided_steps || [];
  const starterSnippet = normalizeSnippet(solution?.starter_code || "");
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
      body: starterSnippet
        ? `Use this only as a shape check:\n\n\`\`\`\n${starterSnippet}\n\`\`\``
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

export default function CodingTutor({ apiBase, codeRenderer }) {
  const [activePage, setActivePage] = useState("dashboard");
  const [workspaceTab, setWorkspaceTab] = useState("Editor");
  const [dailyChallenge, setDailyChallenge] = useState(null);
  const [dailyChallengeLoading, setDailyChallengeLoading] = useState(false);
  const [difficulty, setDifficulty] = useState("easy");
  const [practiceLanguage, setPracticeLanguage] = useState("Python");
  const [selectedLanguage, setSelectedLanguage] = useState("Python");
  const [questions, setQuestions] = useState([]);
  const [progressByQuestion, setProgressByQuestion] = useState({});
  const [activeProblem, setActiveProblem] = useState(null);
  const [activeSolution, setActiveSolution] = useState(null);
  const [problemLoading, setProblemLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [testOutput, setTestOutput] = useState("Load a problem, write an attempt, then use Run. V1 does not execute code.");
  const [revealedHints, setRevealedHints] = useState(0);
  const [tutorMode, setTutorMode] = useState("Guided Tutor");
  const [codingTutorMessages, setCodingTutorMessages] = useState([]);
  const [codingTutorInput, setCodingTutorInput] = useState("");
  const [isCodingTutorLoading, setIsCodingTutorLoading] = useState(false);
  const [chatDockOpen, setChatDockOpen] = useState(true);

  const practiceLanguageKey = PRACTICE_LANGUAGE_API[practiceLanguage] || "python";
  const selectedLanguageKey = PRACTICE_LANGUAGE_API[selectedLanguage] || "python";
  const activeProgress = activeProblem ? progressByQuestion[activeProblem.id] : null;
  const attempts = activeProgress?.attempt_count || 0;
  const hintSteps = useMemo(() => buildHintSteps(activeProblem, activeSolution, attempts), [activeProblem, activeSolution, attempts]);
  const latestFeedback = codingTutorMessages.slice().reverse().find((msg) => msg.sender === "bot" && msg.text)?.text || "";
  const suggestedCodeBlock = latestFeedback.match(/```(?:\w+)?\n([\s\S]*?)```/)?.[1]?.trim() || "";
  const languageFormat = LANGUAGE_FORMATS[selectedLanguage] || LANGUAGE_FORMATS.Python;
  const tutorMessages = codingTutorMessages;

  const progressItems = useMemo(
    () => questions.map(question => ({ question, progress: progressByQuestion[question.id] })),
    [questions, progressByQuestion]
  );
  const solvedCount = progressItems.filter(item => item.progress?.status === "solved").length;
  const attemptedCount = progressItems.filter(item => (item.progress?.attempt_count || 0) > 0 || item.progress?.status === "in_progress" || item.progress?.status === "solved").length;
  const totalAttempts = progressItems.reduce((sum, item) => sum + (item.progress?.attempt_count || 0), 0);
  const completionPercent = questions.length ? Math.round((solvedCount / questions.length) * 100) : 0;
  const displayStreak = Math.min(5, Math.max(0, solvedCount || attemptedCount ? Math.ceil((solvedCount + attemptedCount) / 4) : 0));
  const progressSummary = { solvedCount, attemptedCount, totalAttempts, completionPercent, displayStreak };

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
        const [questionResponse, progressResponse] = await Promise.all([
          fetch(`${apiBase}/api/coding/practice/questions?difficulty=${difficulty}`),
          token
            ? fetch(`${apiBase}/api/coding/practice/progress?difficulty=${difficulty}&language=${practiceLanguageKey}`, {
                headers: { Authorization: `Bearer ${token}` },
              })
            : Promise.resolve(null),
        ]);
        if (!questionResponse.ok) throw new Error(`questions ${questionResponse.status}`);
        const questionData = await questionResponse.json();
        const nextQuestions = questionData.questions || [];
        let nextProgress = {};
        if (progressResponse?.ok) {
          const progressData = await progressResponse.json();
          nextProgress = Object.fromEntries((progressData.items || []).map(item => [item.question_id, item]));
        } else if (progressResponse) {
          console.warn("[coding-progress] list request failed", progressResponse.status, await progressResponse.text());
        }
        nextQuestions.forEach((question) => {
          const local = readLocalProgress(question.id, practiceLanguageKey);
          if (local && !nextProgress[question.id]) nextProgress[question.id] = local;
        });
        if (!cancelled) {
          setQuestions(nextQuestions);
          setProgressByQuestion(nextProgress);
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
  }, [apiBase, difficulty, practiceLanguageKey]);

  const saveProgress = async (questionId, updates = {}, language = selectedLanguageKey) => {
    if (!questionId) return null;
    const current = progressByQuestion[questionId] || readLocalProgress(questionId, language) || {
      question_id: questionId,
      language,
      status: "in_progress",
      code: "",
      attempt_count: 0,
    };
    const optimistic = {
      ...current,
      ...updates,
      language,
      status: updates.status || current.status || "in_progress",
      code: updates.code ?? current.code ?? "",
      attempt_count: updates.increment_attempt ? (current.attempt_count || 0) + 1 : (current.attempt_count || 0),
      updated_at: new Date().toISOString(),
    };
    writeLocalProgress(questionId, language, optimistic);
    setProgressByQuestion(prev => ({ ...prev, [questionId]: optimistic }));

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
      setProgressByQuestion(prev => ({ ...prev, [questionId]: saved }));
      return saved;
    } catch (error) {
      console.warn("[coding-progress] backend save unavailable; using local fallback", error);
      return optimistic;
    }
  };

  const loadQuestionSolution = async (problem, languageName, existingCode = null) => {
    const language = PRACTICE_LANGUAGE_API[languageName] || "python";
    const response = await fetch(`${apiBase}/api/coding/practice/questions/${problem.id}/solution?language=${language}`);
    if (!response.ok) throw new Error(`solution ${response.status}`);
    const solution = await response.json();
    const progress = progressByQuestion[problem.id] || readLocalProgress(problem.id, language);
    setActiveProblem(problem);
    setActiveSolution(solution);
    setSelectedLanguage(languageName);
    setPracticeLanguage(languageName);
    setCode(existingCode ?? progress?.code ?? solution?.starter_code ?? "");
    setNote(`Practice problem: ${problem.title}`);
    setTestOutput(`${problem.title} loaded in ${languageName}. Run logs attempts; execution is not enabled in V1.`);
    setActivePage("workspace");
    setWorkspaceTab("Editor");
    setRevealedHints(0);
    if (!progress) saveProgress(problem.id, { status: "in_progress", code: solution?.starter_code || "" }, language);
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
      await saveProgress(activeProblem.id, { status: activeProgress?.status || "in_progress", code }, selectedLanguageKey);
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
    setTestOutput("Daily challenge loaded. Use LeetCode for official tests; this Run button only logs local reasoning in V1.");
    setTutorMode(withHints ? "Hinting" : "Guided Tutor");
    setActivePage("workspace");
    setWorkspaceTab("Editor");
    setRevealedHints(0);
  };

  const openPersonalWorkspace = () => {
    setTutorMode("Code Review");
    setCodingTutorInput("Review this code and point out the most important issue first:\n\n");
    setChatDockOpen(true);
  };

  const buildTutorPrompt = (mode) => {
    const title = activeProblem?.title || "the current coding problem";
    return [
      "You are a coding tutor. Help the student understand and debug their code without immediately giving away the full solution. Give hints first, ask guiding questions, and explain concepts clearly. When reviewing code, point out the most important issue first.",
      "",
      `Tutor mode: ${mode}.`,
      `Current problem title: ${title}.`,
      `Problem description: ${activeProblem?.prompt || "No quiz-bank problem is active; this is a personal code review workspace."}`,
      `Language: ${selectedLanguage}.`,
      `Attempt count: ${attempts}.`,
      `Active workspace tab: ${workspaceTab}.`,
      note ? `Student note: ${note}` : "",
      "Keep the student's approach. Be concise and educational. Do not give a full final submission.",
      code.trim() ? `Code:\n\`\`\`\n${code}\n\`\`\`` : "No code has been written yet.",
    ].filter(Boolean).join("\n");
  };

  const addCodingTutorMessage = (text, sender, extra = {}) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setCodingTutorMessages(prev => [...prev, { text, sender, time, ...extra }]);
  };

  const sendCodingTutorMessage = async (visibleText, contextMode = "Guided Tutor") => {
    const userText = visibleText.trim();
    if (!userText || isCodingTutorLoading) return;
    const token = localStorage.getItem("token");
    const contextualQuery = [
      buildTutorPrompt(contextMode),
      "",
      "Student message:",
      userText,
    ].join("\n");
    addCodingTutorMessage(userText, "user");
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setCodingTutorMessages(prev => [...prev, { text: "", sender: "bot", time, isStreaming: true }]);
    setCodingTutorInput("");
    setIsCodingTutorLoading(true);
    try {
      const response = await fetch(`${apiBase}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: contextualQuery,
          session_id: `coding-tutor-${activeProblem?.id || "personal"}`,
          skip_cache: true,
          model: "inav-1.1",
          mode: "coding_tutor",
        }),
      });
      if (!response.ok) throw new Error(`coding tutor chat ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "chunk") {
            fullText += event.content;
            setCodingTutorMessages(prev => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], text: fullText, isStreaming: true };
              return next;
            });
          } else if (event.type === "done") {
            fullText = event.content || fullText;
            setCodingTutorMessages(prev => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], text: fullText, isStreaming: false };
              return next;
            });
          } else if (event.type === "error") {
            throw new Error(event.content || "Coding tutor stream error");
          }
        }
      }
      setCodingTutorMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.isStreaming) next[next.length - 1] = { ...last, text: fullText || last.text, isStreaming: false };
        return next;
      });
    } catch (error) {
      console.error("[coding-tutor-chat] failed", error);
      setCodingTutorMessages(prev => {
        const next = [...prev];
        const fallback = "I could not reach the coding tutor service right now. Your code and workspace are still here; try again in a minute.";
        if (next[next.length - 1]?.sender === "bot") {
          next[next.length - 1] = { ...next[next.length - 1], text: fallback, isStreaming: false };
        } else {
          next.push({ text: fallback, sender: "bot", time, isStreaming: false });
        }
        return next;
      });
    } finally {
      setIsCodingTutorLoading(false);
    }
  };

  const runAttempt = async () => {
    if (!activeProblem) {
      setTestOutput("Personal code workspace check. No code was executed and no practice progress was changed. Use the tutor chat or quick actions for review.");
      setWorkspaceTab("Output");
      return;
    }
    const isLocalPractice = activeProblem.source !== "leetcode";
    const saved = isLocalPractice
      ? await saveProgress(activeProblem.id, { status: "in_progress", code, increment_attempt: true })
      : { attempt_count: attempts + 1 };
    const tests = activeSolution?.tests || [];
    const testPreview = tests.length
      ? tests.slice(0, 4).map((test, index) => `${index + 1}. ${typeof test === "string" ? test : `${JSON.stringify(test.input)} -> ${JSON.stringify(test.expected)}`}`).join("\n")
      : "No local tests are listed for this problem yet. Use the examples and edge cases.";
    setTestOutput([
      "Run is a progress check in V1. No code was executed.",
      `Attempts logged: ${saved?.attempt_count || 1}`,
      "",
      "Expected checks:",
      testPreview,
    ].join("\n"));
    setWorkspaceTab("Output");
  };

  const markSolved = async () => {
    if (!activeProblem || activeProblem.source === "leetcode") return;
    await saveProgress(activeProblem.id, { status: "solved", code });
    setTestOutput("Marked solved. Your current code was saved with this problem.");
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

  const sendTutorAction = (action) => {
    if (action === "Hint") {
      setTutorMode("Hinting");
      showNextHint();
      return;
    }
    const modeByAction = {
      Debug: "Debugging",
      Review: "Reviewing",
      Complexity: "Complexity",
      "Edge Cases": "Testing",
      Rewrite: "Rewriting",
    };
    setTutorMode(modeByAction[action] || "Guided Tutor");
    if (!code.trim() && action !== "Edge Cases" && action !== "Complexity") {
      toast.info("Write or load code before using that tutor action.");
      return;
    }
    sendCodingTutorMessage(action, action);
    setWorkspaceTab("Discussion");
  };

  const sendTutorMessage = (text) => {
    setTutorMode("Guided Tutor");
    sendCodingTutorMessage(text, "Guided Tutor");
    setWorkspaceTab("Discussion");
  };

  const renderWorkspace = () => (
    <section className="coding-workbench">
      <div className="coding-workbench-main">
        <ProblemPanel
          problem={activeProblem}
          solution={activeSolution}
          attempts={attempts}
          problemLoading={problemLoading}
          onShowHint={showNextHint}
          onShowAllHints={showAllHints}
          onOpenQuizBank={() => setActivePage("quiz")}
        />
        <CodeWorkspace
          activeProblem={activeProblem}
          code={code}
          note={note}
          selectedLanguage={selectedLanguage}
          languageOptions={CODE_LANGUAGES}
          languageFormat={languageFormat}
          workspaceTab={workspaceTab}
          hints={hintSteps}
          revealedHints={revealedHints}
          testOutput={testOutput}
          latestFeedback={latestFeedback}
          suggestedCodeBlock={suggestedCodeBlock}
          onCodeChange={setCode}
          onNoteChange={setNote}
          onLanguageChange={changeSelectedLanguage}
          onTabChange={setWorkspaceTab}
          onRun={runAttempt}
          onMarkSolved={markSolved}
          onCopyCode={() => navigator.clipboard.writeText(code)}
          onApplyAICode={() => setCode(suggestedCodeBlock)}
          onShowHint={showNextHint}
          onShowAllHints={showAllHints}
          codeRenderer={codeRenderer}
        />
      </div>
      <TutorPanel
        activeProblem={activeProblem}
        selectedLanguage={selectedLanguage}
        attempts={attempts}
        tutorMode={tutorMode}
        messages={tutorMessages}
        input={codingTutorInput}
        isLoading={isCodingTutorLoading}
        onInputChange={setCodingTutorInput}
        onQuickAction={sendTutorAction}
        onSendMessage={sendTutorMessage}
        codeRenderer={codeRenderer}
      />
    </section>
  );

  const renderProgress = () => (
    <section className="coding-page-panel">
      <ProgressOverview progressSummary={progressSummary} />
      <div className="coding-progress-stats"><div><strong>{solvedCount}</strong><span>Solved</span></div><div><strong>{attemptedCount}</strong><span>Attempted</span></div><div><strong>{totalAttempts}</strong><span>Total attempts</span></div></div>
      <div className="practice-question-list progress-list">
        {progressItems.map(({ question, progress }) => <button key={question.id} type="button" className="practice-question-row" onClick={() => selectQuestion(question)}><span><strong>{question.title}</strong><small>{question.topic} / {progress?.attempt_count || 0} attempts</small></span><span className={`practice-status ${progress?.status || "not_started"}`}>{titleCase(progress?.status || "not_started")}</span></button>)}
      </div>
    </section>
  );

  const renderDashboard = () => (
    <section className="coding-dashboard">
      <DailyChallengeCard
        dailyChallenge={dailyChallenge}
        loading={dailyChallengeLoading}
        variant="dashboard"
        onStartChallenge={() => startDailyChallenge(false)}
        onPracticeWithHints={() => startDailyChallenge(true)}
      />
      <button type="button" className="coding-dashboard-card" onClick={() => setActivePage("quiz")}><span className="coding-kicker">Quiz Bank</span><strong>{questions.length} {difficulty} questions</strong><small>Choose a problem and launch into the workspace.</small></button>
      <button type="button" className="coding-dashboard-card" onClick={openPersonalWorkspace}><span className="coding-kicker">Personal Code</span><strong>Paste code into chat</strong><small>Use the coding chatbot without changing practice saves.</small></button>
      <button type="button" className="coding-dashboard-card" onClick={() => setActivePage("progress")}><span className="coding-kicker">Progress</span><strong>{completionPercent}% complete</strong><small>{solvedCount} solved / {attemptedCount} attempted</small></button>
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
    return renderWorkspace();
  };

  return (
    <div className="coding-app">
      <nav className="coding-section-nav" aria-label="Coding tutor navigation">
        {CODING_PAGES.map(page => (
          <button key={page.id} type="button" className={activePage === page.id ? "active" : ""} onClick={() => setActivePage(page.id)}>{page.label}</button>
        ))}
      </nav>
      <div className="coding-app-content">{renderPage()}</div>
      {activePage !== "workspace" && (
        <section className={`coding-chat-dock ${chatDockOpen ? "open" : "collapsed"}`} aria-label="Coding tutor chat">
          <div className="coding-chat-dock-header">
            <div>
              <span className="coding-kicker">Coding Tutor Chat</span>
              <strong>{activeProblem?.title || "Personal code help"}</strong>
            </div>
            <button type="button" onClick={() => setChatDockOpen(prev => !prev)}>
              {chatDockOpen ? "Hide" : "Chat"}
            </button>
          </div>
          {chatDockOpen && (
            <TutorChat
              messages={tutorMessages}
              input={codingTutorInput}
              isLoading={isCodingTutorLoading}
              onInputChange={setCodingTutorInput}
              onSendMessage={sendTutorMessage}
              codeRenderer={codeRenderer}
              variant="dock"
            />
          )}
        </section>
      )}
    </div>
  );
}
