import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaChevronDown, FaExternalLinkAlt, FaForward, FaRegCircle, FaRobot, FaCheckCircle, FaTimesCircle, FaTimes, FaTrophy, FaVideo } from "react-icons/fa";

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

// Render the grade cell for one problem. Tests -> hard green/red pass ratio. AI -> an
// amber "AI review" chip (labeled, never a hard pass). None / still grading -> muted.
function GradeCell({ grade, grading }) {
  if (grading && !grade) {
    return <span className="mock-summary-grade is-grading">Grading…</span>;
  }
  const g = grade || {};
  if (g.gradedBy === "tests") {
    const ok = g.total > 0 && g.passed === g.total;
    const Icon = ok ? FaCheckCircle : FaTimesCircle;
    return (
      <span className={`mock-summary-grade ${ok ? "is-pass" : "is-fail"}`}>
        <Icon aria-hidden="true" /> {g.passed}/{g.total} tests
      </span>
    );
  }
  if (g.gradedBy === "ai") {
    return (
      <span className="mock-summary-grade is-ai" title={g.verdict}>
        <FaRobot aria-hidden="true" /> AI review
      </span>
    );
  }
  return <span className="mock-summary-grade is-none">Not graded</span>;
}

function ProblemRow({ p, grading }) {
  const [open, setOpen] = useState(false);
  const meta = OUTCOME_META[p.outcome] || OUTCOME_META.unattempted;
  const Icon = meta.icon;
  const hasDetail = Boolean((p.code || "").trim()) || (p.grade && p.grade.gradedBy === "ai" && p.grade.verdict);
  return (
    <li className="mock-summary-item">
      <div className="mock-summary-item-main">
        <span className={`mock-summary-outcome ${meta.cls}`}><Icon aria-hidden="true" /> {meta.label}</span>
        <span className="mock-summary-title">{p.title}</span>
        <span className={`mock-summary-diff diff-${(p.difficulty || "easy").toLowerCase()}`}>{titleCase(p.difficulty)}</span>
        <GradeCell grade={p.grade} grading={grading} />
        <span className="mock-summary-actions">
          {hasDetail && (
            <button
              type="button"
              className={`mock-summary-expand ${open ? "open" : ""}`}
              aria-expanded={open}
              onClick={() => setOpen(o => !o)}
            >
              <FaChevronDown aria-hidden="true" /> {open ? "Hide" : "Details"}
            </button>
          )}
          {p.answer_url && (
            <a className="mock-summary-review" href={p.answer_url} target="_blank" rel="noreferrer">
              {p.answer_kind === "video" ? <FaVideo aria-hidden="true" /> : <FaExternalLinkAlt aria-hidden="true" />}
              Solution
            </a>
          )}
        </span>
      </div>
      {open && hasDetail && (
        <div className="mock-summary-detail">
          {p.grade && p.grade.gradedBy === "ai" && p.grade.verdict && (
            <p className="mock-summary-verdict"><strong>AI review:</strong> {p.grade.verdict}</p>
          )}
          {(p.code || "").trim() && (
            <pre className="mock-summary-code"><code>{p.code}</code></pre>
          )}
        </div>
      )}
    </li>
  );
}

export default function MockSummary({ summary, onClose, onReview }) {
  const [paused, setPaused] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const grading = summary?.grading;

  // Auto-close after 8s so the modal never traps the student — they can always reopen
  // it from Past Interviews. The countdown does NOT run while grading is still in
  // flight (so results aren't hidden before they land) or while the mouse is over the
  // modal (so it won't vanish mid-read). The X button + backdrop still close instantly.
  useEffect(() => {
    if (!summary || grading || paused) return undefined;
    const id = setTimeout(() => onCloseRef.current?.(), 8000);
    return () => clearTimeout(id);
  }, [summary, grading, paused]);

  if (!summary) return null;
  // Portal to <body> so the fixed overlay escapes .coding-app's stacking/containment
  // context and reliably covers the whole viewport (same fix as the support modal).
  // Wrap in `.coding-app` so the portaled content still inherits the --ct-* theme tokens
  // and all `.coding-app .mock-summary-*` styles (which otherwise wouldn't match outside
  // the app subtree). This is what stops the modal from rendering unstyled/barebones.
  return createPortal(
    <div className="coding-app mock-summary-portal">
    <div className="mock-summary-overlay" role="dialog" aria-modal="true" aria-label="Mock interview results" onClick={onClose}>
      <div
        className="mock-summary"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <button type="button" className="mock-summary-x" onClick={onClose} aria-label="Close results">
          <FaTimes aria-hidden="true" />
        </button>
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

        {summary.grading && (
          <p className="mock-summary-grading-note">Grading your answers… test-backed questions score instantly; open-ended ones get an AI review.</p>
        )}

        <ul className="mock-summary-list">
          {summary.problems.map((p) => (
            <ProblemRow key={p.id} p={p} grading={summary.grading} />
          ))}
        </ul>

        <div className="mock-summary-foot">
          {grading && <span className="mock-summary-autoclose">Grading…</span>}
          <button type="button" className="mock-summary-close" onClick={onClose}>Back to Interview Prep</button>
          {onReview && (
            <button type="button" className="mock-summary-again" onClick={onReview}>Run another</button>
          )}
        </div>
      </div>
    </div>
    </div>,
    document.body,
  );
}
