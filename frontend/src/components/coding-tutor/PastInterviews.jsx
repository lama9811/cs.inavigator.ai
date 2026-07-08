import { useState } from "react";
import { FaChevronDown, FaHistory, FaRobot, FaCheckCircle, FaTimesCircle, FaTrash } from "react-icons/fa";
import { useInterviewHistory } from "./interviewHistory";

function fmtTime(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso || "";
  }
}

function titleCase(value = "") {
  return value.split(/[\s-]+/).filter(Boolean).map(p => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}

// Small grade badge mirroring the summary overlay: tests = pass ratio, AI = labeled.
function GradeBadge({ grade }) {
  const g = grade || {};
  if (g.gradedBy === "tests") {
    const ok = g.total > 0 && g.passed === g.total;
    const Icon = ok ? FaCheckCircle : FaTimesCircle;
    return <span className={`pi-grade ${ok ? "pass" : "fail"}`}><Icon aria-hidden="true" /> {g.passed}/{g.total}</span>;
  }
  if (g.gradedBy === "ai") {
    return <span className="pi-grade ai" title={g.verdict}><FaRobot aria-hidden="true" /> AI</span>;
  }
  return <span className="pi-grade none">—</span>;
}

function AttemptCard({ attempt }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`pi-card ${open ? "open" : ""}`}>
      <button type="button" className="pi-card-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="pi-card-date">{fmtDate(attempt.dateISO)}</span>
        <span className="pi-card-score">{attempt.score}%</span>
        <span className="pi-card-meta">
          {attempt.solved}/{attempt.total} solved · {fmtTime(attempt.timeUsedMs)}
        </span>
        <FaChevronDown className="pi-card-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul className="pi-problem-list">
          {(attempt.problems || []).map((p) => (
            <li key={p.id} className="pi-problem">
              <span className="pi-problem-title">{p.title}</span>
              <span className={`pi-problem-diff diff-${(p.difficulty || "easy").toLowerCase()}`}>{titleCase(p.difficulty)}</span>
              <span className={`pi-problem-outcome ${p.outcome}`}>{titleCase(p.outcome || "unattempted")}</span>
              <GradeBadge grade={p.grade} />
              {p.grade && p.grade.gradedBy === "ai" && p.grade.verdict && (
                <p className="pi-problem-verdict"><strong>AI review:</strong> {p.grade.verdict}</p>
              )}
              {(p.code || "").trim() && (
                <pre className="pi-problem-code"><code>{p.code}</code></pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function PastInterviews({ showEmpty = false }) {
  const { history, clear } = useInterviewHistory();
  if (!history.length) {
    if (!showEmpty) return null;
    return (
      <section className="past-interviews">
        <div className="pi-empty">No mock interviews yet. Finish a mock interview and it'll show up here with your score.</div>
      </section>
    );
  }
  return (
    <section className="past-interviews">
      <div className="pi-head">
        <h3><FaHistory aria-hidden="true" /> Past Interviews</h3>
        <button
          type="button"
          className="pi-clear"
          onClick={() => {
            if (window.confirm("Clear your saved mock interview history? This can't be undone.")) clear();
          }}
        >
          <FaTrash aria-hidden="true" /> Clear
        </button>
      </div>
      <div className="pi-list">
        {history.map((attempt) => <AttemptCard key={attempt.id} attempt={attempt} />)}
      </div>
    </section>
  );
}
