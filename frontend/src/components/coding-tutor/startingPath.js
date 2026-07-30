import { scopedStorageKey } from "./storageScope";
import { STARTING_POINT_QUESTIONS } from "./startingPointQuestions";

const STARTING_CHECK_KEY = "csnav.codingStartingCheck";

export const STARTING_PATH_LEVELS = {
  absolute_beginner: {
    level: "absolute_beginner",
    label: "Start Here",
    title: "Start with Python Beginner",
    blurb: "Begin with short lessons that explain Python lines, output, and tiny examples before any coding pressure.",
    actionLabel: "Start Python Beginner",
    action: "learn",
    topics: ["Python line shape", "Printing output", "Reading tiny examples"],
  },
  syntax_beginner: {
    level: "syntax_beginner",
    label: "Syntax Beginner",
    title: "Start with Syntax and Output",
    blurb: "Practice simple Python syntax, storing values, and showing output before moving into problem steps.",
    actionLabel: "Start Syntax quiz",
    action: "syntax-quiz",
    topics: ["Python syntax", "Variables", "Output"],
  },
  control_flow_practice: {
    level: "control_flow_practice",
    label: "Control Flow",
    title: "Practice Choices and Repetition",
    blurb: "Focus on conditionals, loops, and tracing small examples so code flow feels less mysterious.",
    actionLabel: "Start Control Flow quiz",
    action: "control-flow-quiz",
    topics: ["Conditionals", "Loops", "Tracing step by step"],
  },
  functions_practice: {
    level: "functions_practice",
    label: "Functions",
    title: "Practice Functions",
    blurb: "Work on inputs, outputs, reusable named steps, and return values.",
    actionLabel: "Start Functions quiz",
    action: "functions-quiz",
    topics: ["Inputs and outputs", "Reusable named steps", "Return values"],
  },
  data_structures_intro: {
    level: "data_structures_intro",
    label: "Data Structures",
    title: "Try Data Structures Foundations",
    blurb: "Start with collections: lists or arrays, dictionaries or maps, and sets.",
    actionLabel: "Start Lists quiz",
    action: "data-structures-quiz",
    topics: ["Lists and arrays", "Dictionaries and maps", "Sets"],
  },
  debugging_practice: {
    level: "debugging_practice",
    label: "Debugging",
    title: "Practice Debugging Habits",
    blurb: "Use small examples, trace values step by step, and learn how to find where the answer changes.",
    actionLabel: "Start Debugging quiz",
    action: "debugging-quiz",
    topics: ["Testing small examples", "Tracing values", "Finding the first wrong step"],
  },
  code_ready: {
    level: "code_ready",
    label: "Code Ready",
    title: "Ready for Small Coding Problems",
    blurb: "You know enough of the basics to start easy and medium practice, with lessons nearby when you need them.",
    actionLabel: "Open coding warmup",
    action: "code-ready",
    topics: ["Easy and medium warmup", "Small practice problems", "Data structures foundations"],
  },
  advanced_ready: {
    level: "advanced_ready",
    label: "Ready for More",
    title: "Ready for Medium Practice",
    blurb: "Start with medium practice across core patterns, then review the lesson only when a topic feels rusty.",
    actionLabel: "Open medium practice",
    action: "advanced-ready",
    topics: ["Arrays and strings", "Recursion and queues", "Search and window patterns"],
  },
};

export const STARTING_LEVEL_ORDER = [
  "absolute_beginner",
  "syntax_beginner",
  "control_flow_practice",
  "functions_practice",
  "data_structures_intro",
  "debugging_practice",
  "code_ready",
  "advanced_ready",
];

export function shuffleList(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function withOriginalIndexes(options = []) {
  return options.map((option, originalIndex) => ({
    ...option,
    originalIndex,
  }));
}

export function buildStartingQuestionSet() {
  return STARTING_POINT_QUESTIONS.map(question => ({
    ...question,
    options: question.kind === "graded"
      ? [
          ...shuffleList(withOriginalIndexes(question.options)),
          {
            label: "I don't know yet.",
            level: "absolute_beginner",
            correct: false,
            unsure: true,
            originalIndex: question.options.length,
          },
        ]
      : shuffleList(withOriginalIndexes(question.options)),
  }));
}

export function startingCheckStorageKey() {
  return scopedStorageKey(STARTING_CHECK_KEY);
}

export function readStartingCheck() {
  try {
    const raw = localStorage.getItem(startingCheckStorageKey());
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStartingCheck(result) {
  try {
    localStorage.setItem(startingCheckStorageKey(), JSON.stringify(result));
  } catch {
    // Non-fatal; the check still updates this session through React state.
  }
}

export function clearStartingCheck() {
  try {
    localStorage.removeItem(startingCheckStorageKey());
  } catch {
    // Non-fatal.
  }
}

function selectedOption(question, answers) {
  const answer = answers?.[question.id];
  const index = typeof answer === "object" ? answer.display_index : answer;
  return question.options?.[index];
}

export function buildStartingCheckResult(answers, questionSet = STARTING_POINT_QUESTIONS) {
  const counts = Object.fromEntries(STARTING_LEVEL_ORDER.map(level => [level, 0]));
  const missedSkills = [];
  const correctSkills = [];
  let gradedCount = 0;
  let correctCount = 0;
  let bridgeCount = 0;
  let correctBridgeCount = 0;
  let unsureCount = 0;
  let confidence = "medium";

  questionSet.forEach((question) => {
    const picked = selectedOption(question, answers);
    const level = picked?.level || picked?.track;
    if (level) counts[level] = (counts[level] || 0) + 1;
    if (picked?.unsure) unsureCount += 1;
    if (picked?.confidence) confidence = picked.confidence;
    if (question.kind === "graded") {
      gradedCount += 1;
      if (question.bridge) bridgeCount += 1;
      if (picked?.correct) {
        correctCount += 1;
        if (question.bridge) correctBridgeCount += 1;
        if (question.skill) correctSkills.push(question.skill);
      } else if (question.skill) {
        missedSkills.push(question.skill);
      }
    }
  });

  const accuracy = gradedCount ? correctCount / gradedCount : 0;
  let level = "absolute_beginner";
  if (accuracy < 0.35 || unsureCount >= 3) {
    level = "absolute_beginner";
  } else if (missedSkills.includes("syntax")) {
    level = "syntax_beginner";
  } else if (missedSkills.includes("control_flow")) {
    level = "control_flow_practice";
  } else if (missedSkills.includes("functions")) {
    level = "functions_practice";
  } else if (missedSkills.includes("data_structures")) {
    level = "data_structures_intro";
  } else if (missedSkills.includes("debugging")) {
    level = "debugging_practice";
  } else if (bridgeCount > 0 && correctBridgeCount === bridgeCount && confidence === "high") {
    level = "advanced_ready";
  } else if (accuracy >= 0.75) {
    level = "code_ready";
  } else {
    level = "control_flow_practice";
  }

  const profile = STARTING_PATH_LEVELS[level] || STARTING_PATH_LEVELS.absolute_beginner;
  return {
    ...profile,
    confidence: counts[level] || 0,
    correctCount,
    gradedCount,
    correctBridgeCount,
    bridgeCount,
    accuracy,
    levelCounts: counts,
    trackCounts: counts,
    missedSkills,
    answers,
    completedAt: new Date().toISOString(),
  };
}

export function buildPlacementQuestionSet() {
  return buildStartingQuestionSet().map((question) => ({
    ...question,
    placement_category: question.skill || "readiness",
  }));
}

export function buildPlacementRecommendation({ questions, answers }) {
  return buildStartingCheckResult(answers, questions);
}
