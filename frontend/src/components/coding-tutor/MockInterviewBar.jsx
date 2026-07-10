import { FaArrowRight, FaCheck, FaFlagCheckered, FaForward, FaRegClock, FaStop } from "react-icons/fa";

function fmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Urgency tier from remaining time: navy → orange (<10m) → red (<2m) → expired.
function tier(remaining) {
  if (remaining <= 0) return "expired";
  if (remaining <= 2 * 60 * 1000) return "red";
  if (remaining <= 10 * 60 * 1000) return "orange";
  return "navy";
}

export default function MockInterviewBar({ session, now, canGoPrev = false, onSolved, onSkip, onNext, onPrev, onFinish, onEnd }) {
  if (!session) return null;
  const remaining = session.endsAt - now;
  const urgency = tier(remaining);
  const count = session.questions.length;
  const atLast = session.index >= count - 1;
  const current = session.questions[session.index];
  const outcome = current ? session.outcomes[current.id] : "unattempted";

  const perProblemMs = (session.endsAt - session.startedAt) / count;
  const onThisMs = now - session.problemStartedAt;

  const vals = Object.values(session.outcomes);
  const solved = vals.filter(v => v === "solved").length;
  const attempted = vals.filter(v => v !== "unattempted").length;
  const remainingCount = vals.filter(v => v === "unattempted").length;

  return (
    <div className={`mock-bar tier-${urgency}`}>
      <div className="mock-bar-row mock-bar-row-main">
        <span className="mock-bar-label">Mock Interview</span>

        <span className="mock-bar-stepper" aria-label={`Problem ${session.index + 1} of ${count}`}>
          {session.questions.map((q, i) => {
            const o = session.outcomes[q.id];
            const cls =
              i === session.index ? "current" :
              o === "solved" ? "solved" :
              o === "skipped" ? "skipped" :
              o !== "unattempted" ? "attempted" : "";
            return <span key={q.id} className={`mock-step ${cls}`} title={`Problem ${i + 1}`} />;
          })}
        </span>

        <span className="mock-bar-timer">
          <FaRegClock aria-hidden="true" />
          <span>{fmt(remaining)}</span>
          <small>{urgency === "expired" ? "time's up" : "remaining"}</small>
        </span>

        <button type="button" className="mock-bar-end" onClick={onEnd}>
          <FaStop aria-hidden="true" />
          End
        </button>
      </div>

      <div className="mock-bar-row mock-bar-row-sub">
        <span className="mock-bar-meta">
          Problem {session.index + 1} of {count} · on this {fmt(onThisMs)} · pace ~{fmt(perProblemMs)}/problem
        </span>
        <span className="mock-bar-progress">
          <span className="mp solved">{solved} solved</span>
          <span className="mp att">{attempted} attempted</span>
          <span className="mp rem">{remainingCount} remaining</span>
        </span>
        <span className="mock-bar-actions">
          <button
            type="button"
            className="mock-bar-prev"
            onClick={onPrev}
            disabled={!canGoPrev}
            title={canGoPrev ? "Back to the previous (non-skipped) problem" : "No earlier problem to return to (skipped problems are one-way)"}
          >
            Previous
          </button>
          <button
            type="button"
            className={`mock-bar-solved ${outcome === "solved" ? "on" : ""}`}
            onClick={onSolved}
          >
            <FaCheck aria-hidden="true" />
            {outcome === "solved" ? "Solved" : "Mark solved"}
          </button>
          <button
            type="button"
            className="mock-bar-skip"
            onClick={onSkip}
            disabled={outcome === "skipped"}
            title="Skip this problem — you won't be able to return to it"
          >
            <FaForward aria-hidden="true" />
            Skip
          </button>
          {atLast ? (
            <button type="button" className="mock-bar-finish" onClick={onFinish}>
              <FaFlagCheckered aria-hidden="true" />
              Finish &amp; see results
            </button>
          ) : (
            <button type="button" className="mock-bar-next" onClick={onNext}>
              Next
              <FaArrowRight aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
