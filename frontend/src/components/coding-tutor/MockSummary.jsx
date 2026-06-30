import { FaCheckCircle, FaExternalLinkAlt, FaForward, FaRegCircle, FaTrophy, FaVideo } from "react-icons/fa";

function fmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function titleCase(value = "") {
  return value.split(/[\s-]+/).filter(Boolean).map(p => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}

const OUTCOME_META = {
  solved: { icon: FaCheckCircle, label: "Solved", cls: "solved" },
  skipped: { icon: FaForward, label: "Skipped", cls: "skipped" },
  attempted: { icon: FaRegCircle, label: "Attempted", cls: "attempted" },
  unattempted: { icon: FaRegCircle, label: "Not attempted", cls: "unattempted" },
};

export default function MockSummary({ summary, onClose, onReview }) {
  if (!summary) return null;
  return (
    <div className="mock-summary-overlay" role="dialog" aria-modal="true" aria-label="Mock interview results">
      <div className="mock-summary">
        <div className="mock-summary-head">
          <span className="mock-summary-trophy" aria-hidden="true"><FaTrophy /></span>
          <div>
            <h2>Mock Interview Results</h2>
            <p>{summary.topics.map(titleCase).join(" · ") || "Mixed topics"}</p>
          </div>
        </div>

        <div className="mock-summary-stats">
          <div className="mss"><span className="mss-num">{summary.solved}<small>/{summary.total}</small></span><span className="mss-lbl">Solved</span></div>
          <div className="mss"><span className="mss-num">{summary.attempted}<small>/{summary.total}</small></span><span className="mss-lbl">Attempted</span></div>
          <div className="mss"><span className="mss-num">{fmt(summary.timeUsedMs)}</span><span className="mss-lbl">Time used</span></div>
        </div>

        <ul className="mock-summary-list">
          {summary.problems.map((p) => {
            const meta = OUTCOME_META[p.outcome] || OUTCOME_META.unattempted;
            const Icon = meta.icon;
            return (
              <li key={p.id} className="mock-summary-item">
                <span className={`mock-summary-outcome ${meta.cls}`}><Icon aria-hidden="true" /> {meta.label}</span>
                <span className="mock-summary-title">{p.title}</span>
                <span className={`mock-summary-diff diff-${(p.difficulty || "easy").toLowerCase()}`}>{titleCase(p.difficulty)}</span>
                {p.answer_url && (
                  <a className="mock-summary-review" href={p.answer_url} target="_blank" rel="noreferrer">
                    {p.answer_kind === "video" ? <FaVideo aria-hidden="true" /> : <FaExternalLinkAlt aria-hidden="true" />}
                    Review
                  </a>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mock-summary-foot">
          <button type="button" className="mock-summary-close" onClick={onClose}>Back to Interview Prep</button>
          {onReview && (
            <button type="button" className="mock-summary-again" onClick={onReview}>Run another</button>
          )}
        </div>
      </div>
    </div>
  );
}
