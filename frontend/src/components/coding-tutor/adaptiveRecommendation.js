const BEGINNER_TOPICS = ["conditionals", "arrays", "strings", "math", "tuples", "sets", "hash maps"];
const ADVANCED_TOPICS = new Set([
  "binary search",
  "bit manipulation",
  "disjoint sets",
  "dynamic programming",
  "graphs",
  "heaps",
  "intervals",
  "linked lists",
  "prefix sums",
  "recursion",
  "sliding window",
  "trees",
  "tries",
  "two pointers",
]);

const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 };

function norm(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function titleTopic(value = "") {
  return norm(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function statusOf(progress) {
  if (progress?.status === "solved") return "solved";
  if (progress?.status === "in_progress" || Number(progress?.attempt_count || progress?.attempts || 0) > 0) {
    return "in_progress";
  }
  return "not_started";
}

function questionRank(question) {
  return DIFFICULTY_RANK[norm(question?.difficulty || "easy")] ?? 1;
}

function firstUnsolved(questions = [], progressByQuestion = {}, predicate = () => true) {
  return questions
    .filter(predicate)
    .filter(question => statusOf(progressByQuestion?.[question.id]) !== "solved")
    .sort((a, b) => questionRank(a) - questionRank(b) || String(a.title || "").localeCompare(String(b.title || "")))[0] || null;
}

function findResumeQuestion(questions = [], progressByQuestion = {}) {
  return Object.entries(progressByQuestion || {})
    .map(([id, progress]) => ({ id, progress, question: questions.find(question => question.id === id) }))
    .filter(item => item.question && statusOf(item.progress) === "in_progress")
    .sort((a, b) => new Date(b.progress?.updated_at || 0) - new Date(a.progress?.updated_at || 0))[0]?.question || null;
}

function hasPracticeSignal(progressSummary = {}, progressByQuestion = {}) {
  if (Number(progressSummary.solvedCount || 0) > 0) return true;
  if (Number(progressSummary.attemptedCount || 0) > 0) return true;
  return Object.values(progressByQuestion || {}).some(progress => statusOf(progress) !== "not_started");
}

function hasLearnQuizSignal(learnQuizStats = {}) {
  return (
    Number(learnQuizStats.lessonsRead || 0) > 0 ||
    Number(learnQuizStats.quizCategoriesAttempted || 0) > 0 ||
    Number(learnQuizStats.quizCategoriesPassed || 0) > 0 ||
    Number(learnQuizStats.totalQuizCorrect || 0) > 0
  );
}

export function hasMeaningfulAdaptiveSignal({ progressSummary, progressByQuestion, learnQuizStats, startingCheck }) {
  return (
    hasPracticeSignal(progressSummary, progressByQuestion) ||
    hasLearnQuizSignal(learnQuizStats) ||
    Boolean(startingCheck && !startingCheck.skipped)
  );
}

function beginnerTopicFromQuestions(questions = []) {
  const topics = new Set(questions.map(question => norm(question.topic)));
  return BEGINNER_TOPICS.find(topic => topics.has(topic)) || BEGINNER_TOPICS[0];
}

function cleanReason(value = "") {
  return String(value || "")
    .replace(/\s*This topic is review-only for now:\s*[^.]+\.?\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[;:\s]+$/, ".");
}

function lessonTargetForPlacement(startingCheck, languageKey) {
  const action = startingCheck?.action;
  const language = languageKey || "python";
  if (action === "syntax-quiz") return { mode: "quiz", language, category: "syntax" };
  if (action === "control-flow-quiz") return { mode: "quiz", language, category: "conditionals" };
  if (action === "functions-quiz") return { mode: "quiz", language, category: "functions" };
  if (action === "data-structures-quiz") return { mode: "quiz", language, category: "lists" };
  if (action === "debugging-quiz") return { mode: "quiz", language, category: "debug" };
  if (action === "code-ready") return { mode: "practice", topic: "arrays", difficulty: "easy" };
  if (action === "advanced-ready") return { mode: "practice", topic: "arrays", difficulty: "medium" };
  return { mode: "learn", language, track: "beginner" };
}

export function buildCodingRecommendation({
  questions = [],
  progressSummary = {},
  progressByQuestion = {},
  learnQuizStats = {},
  startingCheck = null,
  adaptivePractice = null,
  mastery = null,
  languageKey = "python",
  learningStyle = "concept_then_code",
  activeProblem = null,
}) {
  const resume = findResumeQuestion(questions, progressByQuestion);
  if (resume) {
    return {
      kind: "resume",
      title: resume.title,
      reason: "You already started this problem. Continue from your saved code and run the tests.",
      actionLabel: `Resume ${resume.title}`,
      target: { mode: "workspace", questionId: resume.id },
      confidence: "high",
      source: "practice_progress",
      question: resume,
      beginnerMode: false,
    };
  }

  const hasSignal = hasMeaningfulAdaptiveSignal({ progressSummary, progressByQuestion, learnQuizStats, startingCheck });
  const activeTopic = norm(activeProblem?.topic);
  const startedActive = activeProblem?.id && statusOf(progressByQuestion?.[activeProblem.id]) !== "solved";
  if (startedActive && activeTopic) {
    return {
      kind: "workspace_continue",
      title: activeProblem.title,
      reason: "This is the problem currently open in your workspace.",
      actionLabel: "Continue in Workspace",
      target: { mode: "workspace", questionId: activeProblem.id },
      confidence: "high",
      source: "workspace_state",
      question: activeProblem,
      beginnerMode: !hasSignal,
    };
  }

  if (!hasSignal) {
    const topic = beginnerTopicFromQuestions(questions);
    const starter = firstUnsolved(
      questions,
      progressByQuestion,
      question => norm(question.difficulty) === "easy" && norm(question.topic) === topic,
    );
    return {
      kind: "first_run",
      title: "Start with Python Beginner",
      reason: "Start with a short lesson, then try a few simple questions before coding.",
      actionLabel: "Start Python Beginner",
      target: { mode: "learn", language: "python", track: "beginner", topic, questionId: starter?.id || null },
      confidence: "high",
      source: "first_run",
      question: starter,
      topic,
      beginnerMode: true,
    };
  }

  if (startingCheck && !startingCheck.skipped && !hasPracticeSignal(progressSummary, progressByQuestion)) {
    return {
      kind: "placement",
      title: startingCheck.title || "Start from your check result",
      reason: startingCheck.blurb || "Use your starting check to pick the next lesson or practice set.",
      actionLabel: startingCheck.actionLabel || "Open recommendation",
      target: lessonTargetForPlacement(startingCheck, languageKey),
      confidence: "medium",
      source: "starting_check",
      beginnerMode: false,
    };
  }

  const reviewSignal = adaptivePractice?.review_signal;
  if (reviewSignal?.topic || reviewSignal?.lesson_category) {
    return {
      kind: "review",
      title: reviewSignal.title || `Review ${titleTopic(reviewSignal.topic)}`,
      reason: cleanReason(reviewSignal.reason) || "Recent runs show a repeated error pattern.",
      actionLabel: "Open review lesson",
      target: {
        mode: "lesson_review",
        topic: reviewSignal.topic || "",
        category: reviewSignal.lesson_category || "",
      },
      confidence: "high",
      source: "attempt_errors",
      topic: reviewSignal.topic,
      reviewSignal,
      beginnerMode: false,
    };
  }

  const adaptive = adaptivePractice?.recommendation;
  const adaptiveTopic = norm(adaptive?.topic);
  if (adaptiveTopic && !ADVANCED_TOPICS.has(adaptiveTopic)) {
    const difficulty = norm(adaptive.difficulty || "easy");
    return {
      kind: adaptive.action === "ladder" ? "practice_ladder" : "practice_review",
      title: titleTopic(adaptiveTopic),
      reason: cleanReason(adaptive.reason) || `Practice ${titleTopic(adaptiveTopic)} next.`,
      actionLabel: adaptive.action === "ladder"
        ? `Open ${titleTopic(difficulty)} problem`
        : `Practice ${titleTopic(adaptiveTopic)}`,
      target: { mode: "practice", topic: adaptiveTopic, difficulty: adaptive.action === "ladder" ? difficulty : null },
      confidence: adaptive.ladder_ready ? "high" : "medium",
      source: "adaptive_practice",
      topic: adaptiveTopic,
      beginnerMode: false,
    };
  }

  const weakestTopic = norm(mastery?.weakest?.topic);
  if (weakestTopic && !ADVANCED_TOPICS.has(weakestTopic)) {
    return {
      kind: "mastery_review",
      title: titleTopic(weakestTopic),
      reason: cleanReason(mastery.weakest.reason) || `Practice ${titleTopic(weakestTopic)} next.`,
      actionLabel: `Practice ${titleTopic(weakestTopic)}`,
      target: { mode: "practice", topic: weakestTopic },
      confidence: "medium",
      source: "mastery",
      topic: weakestTopic,
      beginnerMode: false,
    };
  }

  const lessonFirst = learningStyle !== "try_then_hint";
  const starterTopic = beginnerTopicFromQuestions(questions);
  const starter = firstUnsolved(
    questions,
    progressByQuestion,
    question => norm(question.difficulty) === "easy" && BEGINNER_TOPICS.includes(norm(question.topic)),
  );
  return {
    kind: "starter",
    title: lessonFirst ? `Review ${titleTopic(starterTopic)}` : starter?.title || `Practice ${titleTopic(starterTopic)}`,
    reason: lessonFirst
      ? `Read a short ${titleTopic(starterTopic)} lesson, then answer the matching questions.`
      : `Try one Easy ${titleTopic(starterTopic)} problem.`,
    actionLabel: lessonFirst ? "Open lesson" : "Open practice",
    target: lessonFirst
      ? { mode: "learn_topic", language: languageKey, topic: starterTopic }
      : { mode: "practice", topic: starterTopic, difficulty: "easy", questionId: starter?.id || null },
    confidence: "low",
    source: "beginner_fallback",
    topic: starterTopic,
    question: starter,
    beginnerMode: false,
  };
}

export function buildPracticeGuideRecommendation({
  codingRecommendation,
  topicsInView = [],
  filteredQuestions = [],
  progressByQuestion = {},
  updateFilter,
  onOpenLessonReview,
  onOpenMiniPlanStep,
}) {
  const inView = new Set((topicsInView || []).map(norm));
  const recTopic = norm(codingRecommendation?.topic || codingRecommendation?.target?.topic);
  const recFitsView = !recTopic || !inView.size || inView.has(recTopic);

  if (codingRecommendation && recFitsView) {
    const miniPlan = codingRecommendation.miniPlan || codingRecommendation.mini_plan || [];
    const currentStep = miniPlan.find(step => step?.is_current) || null;
    return {
      label: "Recommended next",
      title: currentStep?.label || codingRecommendation.title,
      band: codingRecommendation.kind === "first_run" ? "Easy" : titleTopic(codingRecommendation.target?.difficulty || "Review"),
      bandClass: codingRecommendation.kind === "review" ? "shaky" : "steady",
      reason: codingRecommendation.reason,
      cta: currentStep?.label || codingRecommendation.actionLabel,
      recommendation: codingRecommendation,
      explanation: codingRecommendation.explanation || null,
      miniPlan,
      cooldowns: codingRecommendation.cooldowns || [],
      onClick: () => {
        if (currentStep) {
          onOpenMiniPlanStep?.(currentStep, codingRecommendation);
          return;
        }
        const target = codingRecommendation.target || {};
        if (target.mode === "lesson_review") {
          onOpenLessonReview?.(codingRecommendation.reviewSignal || target);
          return;
        }
        if (target.topic) {
          updateFilter({
            topic: [target.topic],
            ...(target.difficulty ? { difficulty: [target.difficulty] } : {}),
            status: [],
            sort: "topic",
          });
        }
      },
    };
  }

  const firstVisible = firstUnsolved(filteredQuestions, progressByQuestion);
  const topic = norm(firstVisible?.topic) || norm(topicsInView?.[0]) || BEGINNER_TOPICS[0];
  return {
    label: "Recommended next",
    title: titleTopic(topic),
    band: titleTopic(firstVisible?.difficulty || "Easy"),
    bandClass: "steady",
    reason: `Practice ${titleTopic(topic)} from the topics currently shown.`,
    cta: firstVisible ? `Start ${firstVisible.title}` : `Practice ${titleTopic(topic)}`,
    onClick: () => {
      updateFilter({
        topic: [topic],
        ...(firstVisible?.difficulty ? { difficulty: [norm(firstVisible.difficulty)] } : {}),
      });
    },
  };
}
