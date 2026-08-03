import { useMemo, useState } from "react";
import {
  FaCheckCircle,
  FaChevronDown,
  FaClock,
  FaCode,
  FaExternalLinkAlt,
  FaHistory,
  FaLayerGroup,
  FaRegCircle,
  FaRobot,
  FaTimesCircle,
  FaTrash,
} from "react-icons/fa";
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
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso || "";
  }
}

function titleCase(value = "") {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function scoreTone(score = 0) {
  if (score >= 80) return "strong";
  if (score >= 50) return "okay";
  return "needs-work";
}

function outcomeMeta(outcome = "unattempted") {
  if (outcome === "solved") {
    return { label: "Solved", Icon: FaCheckCircle, cls: "solved" };
  }
  if (outcome === "attempted") {
    return { label: "Attempted", Icon: FaClock, cls: "attempted" };
  }
  if (outcome === "skipped") {
    return { label: "Skipped", Icon: FaRegCircle, cls: "skipped" };
  }
  return { label: "Not tried", Icon: FaRegCircle, cls: "unattempted" };
}

function hasUsefulCode(problem) {
  const code = String(problem?.code || "").trim();
  if (!code || problem?.outcome === "unattempted" || problem?.outcome === "skipped") {
    return false;
  }

  const compact = code.toLowerCase();
  const placeholderSignals = [
    "write your solution here",
    "return false",
    "return 0",
    "pass",
  ];
  return !placeholderSignals.every((signal) => compact.includes(signal));
}

function Stat({ icon, label, value }) {
  const Icon = icon;
  return (
    <span className="pi-stat">
      <Icon aria-hidden="true" />
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </span>
  );
}

function GradeBadge({ grade }) {
  const g = grade || {};
  if (g.gradedBy === "tests") {
    const ok = g.total > 0 && g.passed === g.total;
    const Icon = ok ? FaCheckCircle : FaTimesCircle;
    return (
      <span className={`pi-grade ${ok ? "pass" : "fail"}`}>
        <Icon aria-hidden="true" /> Tests {g.passed}/{g.total}
      </span>
    );
  }
  if (g.gradedBy === "ai") {
    return (
      <span className="pi-grade ai" title={g.verdict}>
        <FaRobot aria-hidden="true" /> AI review
      </span>
    );
  }
  return <span className="pi-grade none">Not graded</span>;
}

function OutcomeBadge({ outcome }) {
  const { Icon, label, cls } = outcomeMeta(outcome);
  return (
    <span className={`pi-problem-outcome ${cls}`}>
      <Icon aria-hidden="true" />
      {label}
    </span>
  );
}

function AttemptCard({ attempt, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const topics = attempt.topics?.filter(Boolean) || [];
  const score = Number(attempt.score) || 0;

  return (
    <article className={`pi-card ${open ? "open" : ""}`}>
      <button
        type="button"
        className="pi-card-head"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`pi-card-score-ring ${scoreTone(score)}`}>
          <strong>{score}%</strong>
          <small>score</small>
        </span>
        <span className="pi-card-main">
          <span className="pi-card-date">{fmtDate(attempt.dateISO)}</span>
          <span className="pi-card-meta">
            {attempt.solved}/{attempt.total} solved / {attempt.attempted || 0} attempted /{" "}
            {fmtTime(attempt.timeUsedMs)}
          </span>
          {topics.length ? (
            <span className="pi-card-topics">
              {topics.slice(0, 4).map((topic) => (
                <span key={topic}>{titleCase(topic)}</span>
              ))}
            </span>
          ) : null}
        </span>
        <FaChevronDown className="pi-card-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <ul className="pi-problem-list">
          {(attempt.problems || []).map((problem) => (
            <li key={problem.id} className="pi-problem">
              <div className="pi-problem-top">
                <span className="pi-problem-title">{problem.title}</span>
                <span className={`pi-problem-diff diff-${(problem.difficulty || "easy").toLowerCase()}`}>
                  {titleCase(problem.difficulty)}
                </span>
              </div>

              <div className="pi-problem-meta">
                <OutcomeBadge outcome={problem.outcome} />
                <GradeBadge grade={problem.grade} />
                {problem.topic ? (
                  <span className="pi-problem-topic">{titleCase(problem.topic)}</span>
                ) : null}
              </div>

              {problem.grade?.gradedBy === "ai" && problem.grade.verdict ? (
                <p className="pi-problem-verdict">
                  <strong>AI review:</strong> {problem.grade.verdict}
                </p>
              ) : null}

              {hasUsefulCode(problem) ? (
                <details className="pi-code-details">
                  <summary>
                    <FaCode aria-hidden="true" /> Show saved code
                  </summary>
                  <pre className="pi-problem-code"><code>{problem.code}</code></pre>
                </details>
              ) : (
                <p className="pi-no-code">
                  {problem.outcome === "unattempted" || problem.outcome === "skipped"
                    ? "No saved attempt for this problem."
                    : "Only starter code was saved for this problem."}
                </p>
              )}

              {problem.answer_url ? (
                <a className="pi-solution-link" href={problem.answer_url} target="_blank" rel="noreferrer">
                  Review reference <FaExternalLinkAlt aria-hidden="true" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export default function PastInterviews({ showEmpty = false }) {
  const { history, clear } = useInterviewHistory();
  const stats = useMemo(() => {
    const totalSolved = history.reduce((sum, attempt) => sum + (Number(attempt.solved) || 0), 0);
    const bestScore = history.reduce((best, attempt) => Math.max(best, Number(attempt.score) || 0), 0);
    const totalTime = history.reduce((sum, attempt) => sum + (Number(attempt.timeUsedMs) || 0), 0);
    return { attempts: history.length, totalSolved, bestScore, totalTime };
  }, [history]);

  if (!history.length) {
    if (!showEmpty) return null;
    return (
      <section className="past-interviews">
        <div className="pi-empty">
          <FaHistory aria-hidden="true" />
          <strong>No mock interviews yet</strong>
          <span>
            Finish a mock interview and this page will save the score, problems, and
            meaningful code attempts.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="past-interviews">
      <div className="pi-head">
        <div>
          <h3><FaHistory aria-hidden="true" /> Past Interviews</h3>
          <p>Newest attempts first. Open a session to review outcomes and saved work.</p>
        </div>
        <button
          type="button"
          className="pi-clear"
          onClick={() => {
            if (window.confirm("Clear your saved mock interview history? This can't be undone.")) {
              clear();
            }
          }}
        >
          <FaTrash aria-hidden="true" /> Clear
        </button>
      </div>

      <div className="pi-stats" aria-label="Interview history summary">
        <Stat icon={FaHistory} label="attempts" value={stats.attempts} />
        <Stat icon={FaCheckCircle} label="solved" value={stats.totalSolved} />
        <Stat icon={FaLayerGroup} label="best score" value={`${stats.bestScore}%`} />
        <Stat icon={FaClock} label="total time" value={fmtTime(stats.totalTime)} />
      </div>

      <div className="pi-list">
        {history.map((attempt, index) => (
          <AttemptCard key={attempt.id} attempt={attempt} defaultOpen={index === 0} />
        ))}
      </div>
    </section>
  );
}
