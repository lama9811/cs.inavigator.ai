function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1).replace("_", " ") : "";
}

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
  const description = (question.prompt || "").trim();

  return (
    <button type="button" className={className} onClick={() => onSelect(question)}>
      <div className="quiz-problem-top">
        <strong className="quiz-problem-name">{question.title}</strong>
        {/* Not Started is the default for nearly every card, so we don't label it
            at all — only In Progress / Solved get a pill, so the eye is drawn to
            cards with actual progress instead of a wall of "Not Started". */}
        {status !== "not_started" && (
          <span className={`quiz-status-pill status-${status}`}>{meta.label}</span>
        )}
      </div>

      {/* Always rendered (even if empty) so every card reserves the same 2-line
          slot and the grid rows stay uniform height. */}
      <p className="quiz-problem-desc">{description}</p>

      <div className="quiz-problem-foot">
        <span className="quiz-problem-tags">
          <span className="quiz-tag quiz-tag-topic">{titleCase(question.topic)}</span>
          <span className="quiz-tag quiz-tag-difficulty">{titleCase(question.difficulty)}</span>
        </span>
        <span className="quiz-problem-action">{meta.action}</span>
      </div>
    </button>
  );
}
