import {
  FaBolt,
  FaBrain,
  FaBug,
  FaCalendarCheck,
  FaCheckCircle,
  FaCode,
  FaCompass,
  FaCubes,
  FaDatabase,
  FaFire,
  FaGraduationCap,
  FaJsSquare,
  FaKeyboard,
  FaLanguage,
  FaLayerGroup,
  FaLightbulb,
  FaMedal,
  FaMountain,
  FaPython,
  FaRedo,
  FaRocket,
  FaSeedling,
  FaShieldAlt,
  FaSitemap,
  FaStar,
  FaStopwatch,
  FaSync,
  FaTasks,
  FaThLarge,
  FaCrown,
  FaTrophy,
  FaUserTie,
  FaUserGraduate,
} from "react-icons/fa";
import "./ProgressBadges.css";

function countSolvedByTopic(questions = [], progressByQuestion = {}) {
  return questions.reduce((acc, question) => {
    const topic = question.topic || "practice";
    if (progressByQuestion[question.id]?.status === "solved") {
      acc[topic] = (acc[topic] || 0) + 1;
    }
    return acc;
  }, {});
}

function countSolvedByDifficulty(questions = [], progressByQuestion = {}) {
  return questions.reduce((acc, question) => {
    if (progressByQuestion[question.id]?.status === "solved") {
      const difficulty = (question.difficulty || "easy").toLowerCase();
      acc[difficulty] = (acc[difficulty] || 0) + 1;
    }
    return acc;
  }, {});
}

function countAttemptedByDifficulty(questions = [], progressByQuestion = {}) {
  return questions.reduce((acc, question) => {
    const progress = progressByQuestion[question.id];
    if (progress?.status === "solved" || progress?.status === "in_progress" || (progress?.attempt_count || 0) > 0) {
      const difficulty = (question.difficulty || "easy").toLowerCase();
      acc[difficulty] = (acc[difficulty] || 0) + 1;
    }
    return acc;
  }, {});
}

// Distinct topics the student has *attempted* (solved, in-progress, or any run) —
// rewards exploration, not just completion.
function countAttemptedTopics(questions = [], progressByQuestion = {}) {
  const topics = new Set();
  questions.forEach((question) => {
    const progress = progressByQuestion[question.id];
    const touched = progress?.status === "solved"
      || progress?.status === "in_progress"
      || (progress?.attempt_count || 0) > 0;
    if (touched) topics.add(question.topic || "practice");
  });
  return topics.size;
}

// How many problems were solved only after 3+ attempts — the "kept at it" signal.
function countComebacks(questions = [], progressByQuestion = {}) {
  return questions.reduce((sum, question) => {
    const progress = progressByQuestion[question.id];
    if (progress?.status === "solved" && (progress?.attempt_count || 0) >= 3) return sum + 1;
    return sum;
  }, 0);
}

// True if any problem was solved on the very first run (exactly 1 attempt) — a
// clean, no-fail solve. attempt_count of 1 means one run and it passed.
function hasFirstTrySolve(questions = [], progressByQuestion = {}) {
  return questions.some((question) => {
    const progress = progressByQuestion[question.id];
    return progress?.status === "solved" && (progress?.attempt_count || 0) === 1;
  });
}

// True if the student has fully cleared at least one topic (every problem in that
// topic solved). Requires the topic have at least one problem.
function hasClearedAnyTopic(questions = [], progressByQuestion = {}) {
  const total = {};
  const solved = {};
  questions.forEach((question) => {
    const topic = question.topic || "practice";
    total[topic] = (total[topic] || 0) + 1;
    if (progressByQuestion[question.id]?.status === "solved") {
      solved[topic] = (solved[topic] || 0) + 1;
    }
  });
  return Object.keys(total).some((topic) => total[topic] > 0 && solved[topic] === total[topic]);
}

function hasSolvedLanguage(progressByLanguage = {}, language) {
  return Object.values(progressByLanguage).some(item => item?.[language]?.status === "solved");
}

// How many distinct languages the student has solved at least one problem in.
function countSolvedLanguages(progressByLanguage = {}, languages = ["python", "java", "javascript", "cpp"]) {
  return languages.filter(lang => hasSolvedLanguage(progressByLanguage, lang)).length;
}

function hasSolvedTopic(solvedByTopic = {}, topicPart = "") {
  return Object.entries(solvedByTopic).some(([topic, count]) => topic.toLowerCase().includes(topicPart) && count > 0);
}

// Derive the raw progress signals every badge reads from. Keeping this separate
// from buildBadges() means the badge list is pure declaration — no counting
// logic inline — which the categories / rarity / percent work builds on.
function computeStats({ questions = {}, progressByQuestion = {}, progressByLanguage = {}, progressSummary = {} } = {}) {
  const solvedByTopic = countSolvedByTopic(questions, progressByQuestion);
  const solvedByDifficulty = countSolvedByDifficulty(questions, progressByQuestion);
  const attemptedByDifficulty = countAttemptedByDifficulty(questions, progressByQuestion);
  return {
    solvedByTopic,
    solvedByDifficulty,
    attemptedByDifficulty,
    uniqueTopicsSolved: Object.keys(solvedByTopic).length,
    solvedCount: progressSummary.solvedCount || 0,
    attemptedCount: progressSummary.attemptedCount || 0,
    totalAttempts: Object.values(progressByQuestion).reduce((sum, item) => sum + (item?.attempt_count || 0), 0),
    solvedPython: hasSolvedLanguage(progressByLanguage, "python"),
    solvedJavaScript: hasSolvedLanguage(progressByLanguage, "javascript"),
    solvedLanguages: countSolvedLanguages(progressByLanguage),
    attemptedTopics: countAttemptedTopics(questions, progressByQuestion),
    comebacks: countComebacks(questions, progressByQuestion),
    firstTrySolve: hasFirstTrySolve(questions, progressByQuestion),
    clearedAnyTopic: hasClearedAnyTopic(questions, progressByQuestion),
    displayStreak: progressSummary.displayStreak || 0,
    bestStreak: progressSummary.bestStreak || 0,
    dailyDaysCompleted: progressSummary.dailyDaysCompleted || 0,
    mockCompleted: progressSummary.mockCompleted || 0,
    completionPercent: progressSummary.completionPercent || 0,
    easySolved: solvedByDifficulty.easy || 0,
    mediumSolved: solvedByDifficulty.medium || 0,
    hardSolved: solvedByDifficulty.hard || 0,
    easyAttempted: attemptedByDifficulty.easy || 0,
  };
}

// Build the full badge list as declarative data. Each badge carries:
//   kind:    "count" (has a goal → shows a % bar) | "boolean" (locked/earned only)
//   current/goal: only meaningful for kind:"count"; drives the progress bar
//   category, rarity: presentation grouping/styling (used by later steps)
//   earned:  the unlock predicate, unchanged from the original flat list
function buildBadges(stats) {
  const s = stats;
  const count = (fields) => ({ kind: "count", ...fields, earned: (fields.current || 0) >= fields.goal });
  const bool = (fields) => ({ kind: "boolean", current: 0, goal: 0, ...fields });

  return [
    // Names avoid forced alliteration and lean on plain language + a few real
    // programmer references (Hello World, rubber-duck debugging, green build,
    // base case). Keep `id` values stable — they're React keys / future persistence.
    count({ id: "first-run", label: "Hello, World", detail: "Ran your first test", icon: FaBolt, tone: "blue", category: "Starter", rarity: "common", current: s.attemptedCount, goal: 1 }),
    count({ id: "first-solve", label: "First Solve", detail: "Solved your first problem", icon: FaMedal, tone: "orange", category: "Starter", rarity: "common", current: s.solvedCount, goal: 1 }),
    count({ id: "topic-sampler", label: "Branching Out", detail: "Solved problems in two topics", icon: FaStar, tone: "purple", category: "Topics", rarity: "uncommon", current: s.uniqueTopicsSolved, goal: 2 }),
    bool({ id: "python-path", label: "Pythonista", detail: "Solved a problem in Python", icon: FaPython, tone: "green", category: "Languages", rarity: "uncommon", earned: s.solvedPython }),
    bool({ id: "javascript-path", label: "In the Script", detail: "Solved a problem in JavaScript", icon: FaJsSquare, tone: "gold", category: "Languages", rarity: "uncommon", earned: s.solvedJavaScript }),
    count({ id: "five-solved", label: "High Five", detail: "Solved 5 problems", icon: FaTrophy, tone: "red", category: "Mastery", rarity: "uncommon", current: s.solvedCount, goal: 5 }),
    bool({ id: "steady-streak", label: "Steady Streak", detail: "Practiced 3 days straight", icon: FaFire, tone: "pink", category: "Consistency", rarity: "uncommon", earned: s.bestStreak >= 3 }),
    bool({ id: "halfway", label: "Halfway There", detail: "Solved half the set", icon: FaCode, tone: "cyan", category: "Mastery", rarity: "rare", earned: s.completionPercent >= 50 }),
    count({ id: "ten-solved", label: "Perfect Ten", detail: "Solved 10 problems", icon: FaRocket, tone: "blue", category: "Mastery", rarity: "uncommon", current: s.solvedCount, goal: 10 }),
    count({ id: "twenty-solved", label: "Twenty Club", detail: "Solved 20 problems", icon: FaGraduationCap, tone: "purple", category: "Mastery", rarity: "rare", current: s.solvedCount, goal: 20 }),
    bool({ id: "completionist", label: "Completionist", detail: "Solved all problems", icon: FaCheckCircle, tone: "green", category: "Mastery", rarity: "epic", earned: s.completionPercent >= 100 }),
    count({ id: "three-runs", label: "Warming Up", detail: "Ran tests 3 times", icon: FaTasks, tone: "cyan", category: "Testing", rarity: "common", current: s.totalAttempts, goal: 3 }),
    count({ id: "ten-runs", label: "Test Driven", detail: "Ran tests 10 times", icon: FaKeyboard, tone: "orange", category: "Testing", rarity: "uncommon", current: s.totalAttempts, goal: 10 }),
    bool({ id: "easy-starter", label: "Off the Mark", detail: "Solved an Easy problem", icon: FaSeedling, tone: "green", category: "Starter", rarity: "common", earned: s.easySolved >= 1 }),
    bool({ id: "medium-climber", label: "Stepping Up", detail: "Solved a Medium problem", icon: FaCompass, tone: "gold", category: "Mastery", rarity: "uncommon", earned: s.mediumSolved >= 1 }),
    bool({ id: "hard-hunter", label: "Deep End", detail: "Solved a Hard problem", icon: FaShieldAlt, tone: "red", category: "Mastery", rarity: "rare", earned: s.hardSolved >= 1 }),
    bool({ id: "strings-spark", label: "String Theory", detail: "Solved a strings problem", icon: FaLightbulb, tone: "orange", category: "Topics", rarity: "common", earned: hasSolvedTopic(s.solvedByTopic, "string") }),
    bool({ id: "arrays-ace", label: "Array Adept", detail: "Solved an arrays problem", icon: FaLayerGroup, tone: "blue", category: "Topics", rarity: "common", earned: hasSolvedTopic(s.solvedByTopic, "array") }),
    bool({ id: "sets-scout", label: "Set Solver", detail: "Solved a sets problem", icon: FaDatabase, tone: "cyan", category: "Topics", rarity: "uncommon", earned: hasSolvedTopic(s.solvedByTopic, "set") }),
    bool({ id: "graph-guide", label: "Well Connected", detail: "Solved a graph problem", icon: FaCubes, tone: "purple", category: "Topics", rarity: "rare", earned: hasSolvedTopic(s.solvedByTopic, "graph") }),
    bool({ id: "debug-persistence", label: "Rubber Duck", detail: "Kept debugging until it passed", icon: FaBug, tone: "pink", category: "Persistence", rarity: "uncommon", earned: s.totalAttempts >= s.solvedCount + 3 && s.totalAttempts >= 3 }),
    bool({ id: "polyglot", label: "Polyglot", detail: "Solved in two languages", icon: FaBrain, tone: "gold", category: "Languages", rarity: "rare", earned: s.solvedPython && s.solvedJavaScript }),
    count({ id: "warmup-master", label: "Easy Does It", detail: "Attempted 5 Easy problems", icon: FaFire, tone: "red", category: "Starter", rarity: "uncommon", current: s.easyAttempted, goal: 5 }),
    bool({ id: "interview-ready", label: "Interview Ready", detail: "Solved across three topics", icon: FaTrophy, tone: "green", category: "Interview Prep", rarity: "epic", earned: s.solvedCount >= 8 && s.uniqueTopicsSolved >= 3 }),

    // ── Added badges: persistence, daily habit, curiosity, breadth ──
    bool({ id: "comeback-kid", label: "Green Build", detail: "Passed after 3+ failed runs", icon: FaRedo, tone: "pink", category: "Persistence", rarity: "uncommon", earned: s.comebacks >= 1 }),
    bool({ id: "daily-devotee", label: "Showed Up", detail: "Did a daily challenge", icon: FaCalendarCheck, tone: "cyan", category: "Consistency", rarity: "common", earned: s.dailyDaysCompleted >= 1 }),
    count({ id: "daily-triple", label: "Daily Grind", detail: "Daily challenge 3 days straight", icon: FaFire, tone: "orange", category: "Consistency", rarity: "rare", current: s.displayStreak, goal: 3 }),
    count({ id: "topic-explorer", label: "Curious Mind", detail: "Tried problems in 3 topics", icon: FaCompass, tone: "purple", category: "Topics", rarity: "uncommon", current: s.attemptedTopics, goal: 3 }),
    bool({ id: "recursion-ranger", label: "Base Case", detail: "Solved a recursion problem", icon: FaSync, tone: "gold", category: "Topics", rarity: "uncommon", earned: hasSolvedTopic(s.solvedByTopic, "recursion") }),
    bool({ id: "trees-tracker", label: "Tree Solver", detail: "Solved a tree problem", icon: FaSitemap, tone: "green", category: "Topics", rarity: "rare", earned: hasSolvedTopic(s.solvedByTopic, "tree") }),
    count({ id: "three-languages", label: "Trilingual", detail: "Solved in three languages", icon: FaLanguage, tone: "blue", category: "Languages", rarity: "epic", current: s.solvedLanguages, goal: 3 }),
    count({ id: "half-century", label: "The Long Haul", detail: "Ran tests 50 times", icon: FaMountain, tone: "red", category: "Testing", rarity: "epic", current: s.totalAttempts, goal: 50 }),

    // ── Skill-signal badges (reward clean solves + breadth, not just volume) ──
    bool({ id: "first-try", label: "Nailed It", detail: "Solved a problem on the first run", icon: FaStopwatch, tone: "gold", category: "Persistence", rarity: "rare", earned: s.firstTrySolve }),
    bool({ id: "full-house", label: "Full House", detail: "Solved an Easy, Medium, and Hard", icon: FaThLarge, tone: "orange", category: "Mastery", rarity: "rare", earned: s.easySolved >= 1 && s.mediumSolved >= 1 && s.hardSolved >= 1 }),
    bool({ id: "topic-master", label: "Topic Master", detail: "Cleared every problem in a topic", icon: FaCrown, tone: "purple", category: "Mastery", rarity: "epic", earned: s.clearedAnyTopic }),

    // ── Mock interview badges (backed by the per-device mock-completion counter) ──
    bool({ id: "mock-rookie", label: "First Interview", detail: "Finished a mock interview", icon: FaUserTie, tone: "cyan", category: "Interview Prep", rarity: "uncommon", earned: s.mockCompleted >= 1 }),
    count({ id: "mock-veteran", label: "Seasoned", detail: "Finished 5 mock interviews", icon: FaUserGraduate, tone: "gold", category: "Interview Prep", rarity: "epic", current: s.mockCompleted, goal: 5 }),
  ];
}

// Categories render in this fixed order; any badge whose category isn't listed
// falls into a trailing "More" group so nothing silently disappears.
const CATEGORY_ORDER = [
  "Starter",
  "Consistency",
  "Persistence",
  "Languages",
  "Topics",
  "Testing",
  "Interview Prep",
  "Mastery",
];

const RARITY_LABEL = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
};

// Group badges by category (in CATEGORY_ORDER), earned-first within each group.
function groupByCategory(badges) {
  const buckets = new Map();
  badges.forEach((badge) => {
    const key = CATEGORY_ORDER.includes(badge.category) ? badge.category : "More";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(badge);
  });
  const order = [...CATEGORY_ORDER, "More"];
  return order
    .filter((key) => buckets.has(key))
    .map((key) => ({
      category: key,
      // Earned badges rise to the top of their category.
      badges: buckets.get(key).slice().sort((a, b) => Number(b.earned) - Number(a.earned)),
    }));
}

// Pick the single locked count-based badge the student is closest to earning,
// ranked by fraction complete then by smallest remaining. Boolean badges are
// excluded (no partial progress to rank). Returns null when nothing is in
// progress (e.g. a brand-new user at 0/goal on everything) — the strip then
// falls back to a generic "start here" nudge.
function pickNearestMilestone(badges) {
  const candidates = badges
    .filter(b => b.kind === "count" && !b.earned && (b.current || 0) > 0 && b.goal > 0)
    .map(b => ({ badge: b, frac: (b.current || 0) / b.goal, remaining: b.goal - (b.current || 0) }));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.frac - a.frac) || (a.remaining - b.remaining));
  return candidates[0];
}

// One-line screen-reader summary so the card reads as a single coherent phrase
// ("First Run, Common, locked, 0 of 1") instead of fragmented pieces.
function badgeAriaLabel(badge, current) {
  const state = badge.earned ? "earned" : "locked";
  const rarity = RARITY_LABEL[badge.rarity] || badge.rarity;
  const progress = badge.kind === "count" && !badge.earned ? `, ${current} of ${badge.goal}` : "";
  return `${badge.label}, ${rarity}, ${state}${progress}. ${badge.detail}`;
}

function BadgeCard({ badge }) {
  const Icon = badge.icon;
  // Show a progress bar only on count-based badges that aren't earned yet.
  // Boolean badges have no partial progress; earned badges show the pill.
  const showProgress = badge.kind === "count" && !badge.earned;
  const current = Math.min(badge.current || 0, badge.goal);
  const percent = badge.goal > 0 ? Math.round((current / badge.goal) * 100) : 0;
  return (
    <article
      className={`progress-badge-card ${badge.tone} rarity-${badge.rarity} ${badge.earned ? "earned" : "locked"}`}
      aria-label={badgeAriaLabel(badge, current)}
    >
      {/* Inner pieces are aria-hidden: the article's aria-label already speaks the
          whole card, so screen readers don't re-read each fragment. */}
      <span className="progress-badge-icon" aria-hidden="true"><Icon /></span>
      <div className="progress-badge-body" aria-hidden="true">
        <div className="progress-badge-titlerow">
          <h3>{badge.label}</h3>
          <span className={`progress-badge-rarity rarity-${badge.rarity}`}>{RARITY_LABEL[badge.rarity] || badge.rarity}</span>
        </div>
        <p>{badge.detail}</p>
        {showProgress && (
          <div className="progress-badge-meter">
            <div className="progress-badge-meter-track">
              <span className="progress-badge-meter-fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="progress-badge-meter-label">{current} / {badge.goal}</span>
          </div>
        )}
      </div>
      <strong aria-hidden="true">{badge.earned ? "Earned" : "Locked"}</strong>
    </article>
  );
}

// `midSlot` renders between the header trio (Milestones + earned count + Next-up
// nudge) and the badge category grids — the Progress tab passes the stat tiles
// here so the page reads: achievements framing → at-a-glance stats → the badges.
export default function ProgressBadges({ questions = [], progressByQuestion = {}, progressByLanguage = {}, progressSummary = {}, midSlot = null }) {
  const stats = computeStats({ questions, progressByQuestion, progressByLanguage, progressSummary });
  const badges = buildBadges(stats);
  const groups = groupByCategory(badges);

  const earnedCount = badges.filter(badge => badge.earned).length;
  const nearest = pickNearestMilestone(badges);
  // Nearest-milestone nudge: concrete goal when something's in progress, else a
  // generic start-here for brand-new users. aria-live so SR users hear it update.
  const nearestText = nearest
    ? `You're ${nearest.remaining} away from ${nearest.badge.label}.`
    : "Run your first test or solve a problem to start unlocking milestones.";

  return (
    <section className="progress-badge-section" aria-label="Coding progress badges">
      <div className="progress-badge-header">
        <span className="coding-kicker">Milestones</span>
        <span>{earnedCount}/{badges.length} earned</span>
      </div>
      <div className="progress-badge-nudge" role="status" aria-live="polite">
        <span className="progress-badge-nudge-tag">Next up</span>
        <span className="progress-badge-nudge-text">{nearestText}</span>
      </div>
      {midSlot}
      {groups.map((group) => {
        const groupEarned = group.badges.filter(b => b.earned).length;
        return (
          <div key={group.category} className="progress-badge-group">
            <div className="progress-badge-group-head">
              <h3>{group.category}</h3>
              <span>{groupEarned}/{group.badges.length}</span>
            </div>
            <div className="progress-badge-grid">
              {group.badges.map((badge) => (
                <BadgeCard key={badge.id} badge={badge} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
