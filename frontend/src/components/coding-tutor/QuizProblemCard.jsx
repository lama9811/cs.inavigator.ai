function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1).replace("_", " ") : "";
}

// All practice problems run in these four languages (the runner generates the
// per-language signature). `available: false` would render a muted pill if a
// runner were ever not ready for a language.
const LANGUAGES = [
  { key: "py", label: "Py", available: true },
  { key: "js", label: "JS", available: true },
  { key: "java", label: "Java", available: true },
  { key: "cpp", label: "C++", available: true },
];

const STATUS_META = {
  solved: { label: "Solved", action: "Review" },
  in_progress: { label: "In Progress", action: "Resume" },
  not_started: { label: "Not Started", action: "Start" },
};

function statusKey(progress) {
  if (progress?.status === "solved") return "solved";
  if (progress?.status === "in_progress" || (progress?.attempt_count || 0) > 0) return "in_progress";
  return "not_started";
}

export default function QuizProblemCard({ question, progress, onSelect, recommended = false }) {
  const status = statusKey(progress);
  const meta = STATUS_META[status];
  const className = `quiz-problem-card status-${status}${recommended ? " is-recommended" : ""}`;

  return (
    <button type="button" className={className} onClick={() => onSelect(question)}>
      <div className="quiz-problem-top">
        <strong className="quiz-problem-name">{question.title}</strong>
        <span className={`quiz-status-pill status-${status}`}>{meta.label}</span>
      </div>

      <div className="quiz-problem-tags">
        <span className="quiz-tag quiz-tag-topic">{titleCase(question.topic)}</span>
        <span className="quiz-tag quiz-tag-difficulty">{titleCase(question.difficulty)}</span>
      </div>

      <div className="quiz-problem-foot">
        <span className="quiz-lang-pills" aria-label="Languages available">
          {LANGUAGES.map(lang => (
            <span
              key={lang.key}
              className={`quiz-lang-pill${lang.available ? "" : " is-muted"}`}
              title={lang.available ? `${lang.label} ready` : `${lang.label} coming later`}
            >
              {lang.label}
            </span>
          ))}
        </span>
        <span className="quiz-problem-action">{meta.action}</span>
      </div>
    </button>
  );
}
