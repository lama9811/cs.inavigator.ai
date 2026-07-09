import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendarAlt } from "@react-icons/all-files/fa/FaCalendarAlt";
import { FaClock } from "@react-icons/all-files/fa/FaClock";
import { FaMapMarkerAlt } from "@react-icons/all-files/fa/FaMapMarkerAlt";
import { FaArrowRight } from "@react-icons/all-files/fa/FaArrowRight";
import { FaSync } from "@react-icons/all-files/fa/FaSync";
import { FaCheckCircle } from "@react-icons/all-files/fa/FaCheckCircle";
import { getApiBase } from "../lib/apiBase";
import "./PlannerPage.css";

const API_BASE = getApiBase();

const TIME_PREFS = [
  { key: "any", label: "Any time" },
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const INTERESTS = [
  { key: "ai", label: "AI / ML" },
  { key: "security", label: "Security" },
  { key: "data", label: "Data" },
  { key: "web", label: "Web / Mobile" },
  { key: "game", label: "Games" },
  { key: "systems", label: "Systems" },
];

const prettySemester = (key) =>
  !key ? "" : key.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

// "2026-07-02T18:00:00+00:00" -> "2h ago" for the live-seats freshness badge.
const relTime = (iso) => {
  if (!iso) return "just now";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

// Per-section availability label from the backend's `availability` + seat count.
const SEAT_LABEL = {
  open: (c) => `${c.seats_available ?? ""} seat${c.seats_available === 1 ? "" : "s"}`.trim(),
  waitlist: () => "Waitlist",
  full: () => "Full",
};

export default function PlannerPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Controls
  const [semester, setSemester] = useState("");
  const [timePref, setTimePref] = useState("any");
  const [maxCredits, setMaxCredits] = useState(15);
  const [interests, setInterests] = useState([]);
  // Regenerate cycles this to rotate the GenEd/minor picks (CS courses come from the
  // interests selector, not the variant). Any control change resets it to 0.
  const [variant, setVariant] = useState(0);

  const fetchPlan = useCallback((overrides = {}) => {
    const token = localStorage.getItem("token");
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError("");
    const sem = overrides.semester ?? semester;
    // A regenerate passes its own variant; any other control change resets to 0.
    const nextVariant = overrides.variant ?? 0;
    if (nextVariant !== variant) setVariant(nextVariant);
    const params = new URLSearchParams({
      time_pref: overrides.timePref ?? timePref,
      max_credits: String(overrides.maxCredits ?? maxCredits),
      interests: (overrides.interests ?? interests).join(","),
      variant: String(nextVariant),
    });
    if (sem) params.set("semester", sem);
    fetch(`${API_BASE}/api/planning/next-semester?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load your plan"))))
      .then((d) => {
        setData(d);
        if (d.semester && !semester) setSemester(d.semester);
      })
      .catch((e) => setError(e.message || "Something went wrong"))
      .finally(() => setLoading(false));
  }, [semester, timePref, maxCredits, interests, variant]);

  const regenerate = () => fetchPlan({ variant: variant + 1 });

  useEffect(() => { fetchPlan(); /* initial */ // eslint-disable-next-line
  }, []);

  const toggleInterest = (key) => {
    const next = interests.includes(key)
      ? interests.filter((i) => i !== key)
      : [...interests, key];
    setInterests(next);
    fetchPlan({ interests: next });
  };

  const onSemester = (val) => { setSemester(val); fetchPlan({ semester: val }); };
  const onTimePref = (val) => { setTimePref(val); fetchPlan({ timePref: val }); };
  const onCredits = (val) => { setMaxCredits(val); fetchPlan({ maxCredits: val }); };

  if (loading && !data) {
    return (
      <div className="pl"><div className="pl-center"><FaSync className="pl-spin" size={20} /><p>Building your plan…</p></div></div>
    );
  }

  if (data && data.connected === false) {
    return (
      <div className="pl">
        <div className="pl-center">
          <FaCalendarAlt size={40} className="pl-empty-icon" />
          <h2>Connect DegreeWorks to plan</h2>
          <p className="pl-muted">
            The planner needs your completed courses and remaining requirements to suggest what to take next.
          </p>
          <button className="pl-primary-btn" onClick={() => navigate("/profile")}>
            <FaSync size={13} /> Connect in Profile
          </button>
        </div>
      </div>
    );
  }

  const options = data?.options || [];

  return (
    <div className="pl">
      <header className="pl-head">
        <div>
          <h1>Next-Semester Planner</h1>
          <span className="pl-muted">
            Conflict-free schedules for <strong>{prettySemester(data?.semester)}</strong> — only courses you're eligible for.
          </span>
        </div>
        {data?.data_source && (
          <span
            className={`pl-live-badge ${data.data_source === "live" ? "live" : "static"}`}
            title={
              data.data_source === "live"
                ? "Seat counts pulled live from Banner"
                : "Seat counts aren't live — confirm open seats in Banner before registering"
            }
          >
            {data.data_source === "live" ? (
              <>● Live seats · updated {relTime(data.as_of)}</>
            ) : (
              <>Availability not live — verify in Banner</>
            )}
          </span>
        )}
      </header>

      {/* Controls */}
      <div className="pl-controls">
        <label className="pl-control">
          <span>Semester</span>
          <select value={semester} onChange={(e) => onSemester(e.target.value)}>
            {(data?.available_semesters || []).map((s) => (
              <option key={s} value={s}>{prettySemester(s)}</option>
            ))}
          </select>
        </label>

        <label className="pl-control">
          <span>Time of day</span>
          <select value={timePref} onChange={(e) => onTimePref(e.target.value)}>
            {TIME_PREFS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>

        <label className="pl-control">
          <span>Max credits: {maxCredits}</span>
          <input type="range" min={9} max={18} value={maxCredits}
                 onChange={(e) => setMaxCredits(Number(e.target.value))}
                 onMouseUp={(e) => onCredits(Number(e.target.value))}
                 onTouchEnd={(e) => onCredits(Number(e.target.value))} />
        </label>

        <div className="pl-control pl-interests">
          <span>Interests</span>
          <div className="pl-chips">
            {INTERESTS.map((i) => (
              <button key={i.key} type="button"
                className={`pl-chip ${interests.includes(i.key) ? "on" : ""}`}
                onClick={() => toggleInterest(i.key)}>
                {i.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pl-control pl-regen-control">
          <button
            type="button"
            className="pl-regen-link"
            onClick={regenerate}
            disabled={loading}
            title="Show a different mix of GenEd/minor courses"
          >
            <FaSync size={12} className={loading ? "pl-spin" : ""} />
            {loading ? "Building…" : "Regenerate"}
          </button>
        </div>
      </div>

      {error && <div className="pl-error">{error}</div>}

      {/* Options */}
      {options.length === 0 ? (
        <div className="pl-empty-note">
          No schedule could be built for {prettySemester(data?.semester)} with these settings.
          Try a different semester or raise the credit limit.
        </div>
      ) : (
        <div className="pl-options">
          {options.map((opt) => (
            <div key={opt.label} className="pl-option-card">
              <div className="pl-option-head">
                <h3>{opt.label}</h3>
                <span className="pl-credits">{opt.total_credits} cr</span>
              </div>
              <div className="pl-courses">
                {opt.courses.map((c) => (
                  <div key={c.code + (c.section || "")} className={`pl-course${c.untimed ? " untimed" : ""}`}>
                    <div className="pl-course-top">
                      <span className="pl-code">{c.code}</span>
                      <span className="pl-course-credits">{c.credits} cr</span>
                    </div>
                    <div className="pl-course-name">{c.name}</div>
                    {c.untimed ? (
                      // GenEd/minor course blended into the plan — no class time yet.
                      <>
                        <div className="pl-course-meta">
                          <span className="pl-pick-time"><FaClock size={11} /> Pick your section in WEBSIS</span>
                        </div>
                        <div className="pl-course-tags">
                          <span className={`pl-tag ${c.kind === "minor" ? "minor" : "gened"}`}>
                            {c.satisfies}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="pl-course-meta">
                          {c.availability && c.availability !== "unknown" && (
                            <span className={`pl-seat ${c.availability}`}>
                              {(SEAT_LABEL[c.availability] || (() => c.availability))(c)}
                            </span>
                          )}
                          <span><FaClock size={11} /> {c.time}</span>
                          {c.room && c.room !== "TBA" && <span><FaMapMarkerAlt size={11} /> {c.room}</span>}
                        </div>
                        {c.instructor && <div className="pl-course-instr">{c.instructor}</div>}
                        <div className="pl-course-tags">
                          {c.satisfies && (
                            <span className="pl-tag satisfies"><FaCheckCircle size={10} /> {c.satisfies}</span>
                          )}
                          {c.unlocks && c.unlocks.length > 0 && (
                            <span className="pl-tag unlocks">
                              <FaArrowRight size={10} /> unlocks {c.unlocks.slice(0, 2).join(", ")}
                              {c.unlocks.length > 2 ? ` +${c.unlocks.length - 2}` : ""}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.notes?.length > 0 && (
        <div className="pl-notes">
          {data.notes.map((n, i) => <span key={i}>· {n}</span>)}
        </div>
      )}
    </div>
  );
}
