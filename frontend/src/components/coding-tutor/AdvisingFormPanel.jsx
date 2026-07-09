import { useMemo, useState } from "react";
import { ADVISING_FIELDS } from "./advisingFormSchema";
import "./AdvisingFormPanel.css";

// PROTOTYPE: an inline advising-form panel (Step 2 student fields) rendered as a
// bot message in the chat. All entry happens IN the panel; the main chat box stays
// free for questions to the agent. Pre-filled DegreeWorks values (advisor, name,
// GPA, ...) are shown read-only with a per-field "edit" toggle to override.
//
// Free-text fields are typed in the panel (not the chat), so nothing hijacks the
// chat input. On Submit, the collected values are handed back to the caller as one
// structured payload, which the chat sends as the student's "answer" turn.
//
// The field schema lives in advisingFormSchema.js and the marker helpers
// (hasAdvisingPanel / stripAdvisingPanel / parseAdvisingPrefill) in
// advisingPanelMarker.js, so this file stays a pure component.

export default function AdvisingFormPanel({ prefill = {}, disabled = false, onSubmit }) {
  // Values start from the prefill (DegreeWorks). Track which fields are locked
  // (came pre-filled) vs. free to edit.
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of ADVISING_FIELDS) {
      v[f.id] = prefill[f.id] != null ? String(prefill[f.id]) : "";
    }
    return v;
  });
  const [locked, setLocked] = useState(() => {
    const l = {};
    for (const f of ADVISING_FIELDS) l[f.id] = prefill[f.id] != null && prefill[f.id] !== "";
    return l;
  });
  const [submitted, setSubmitted] = useState(false);

  const setField = (id, val) => setValues((prev) => ({ ...prev, [id]: val }));
  const unlock = (id) => setLocked((prev) => ({ ...prev, [id]: false }));

  // Required = every field except the ones marked optional.
  const missing = useMemo(
    () => ADVISING_FIELDS.filter((f) => !f.optional && !String(values[f.id] || "").trim()),
    [values],
  );
  const filledCount = ADVISING_FIELDS.filter((f) => String(values[f.id] || "").trim()).length;

  const handleSubmit = () => {
    if (missing.length > 0 || disabled || submitted) return;
    setSubmitted(true);
    // Hand back a clean object of field_id -> value.
    const payload = {};
    for (const f of ADVISING_FIELDS) {
      const val = String(values[f.id] || "").trim();
      if (val) payload[f.id] = val;
    }
    onSubmit?.(payload);
  };

  return (
    <div className="afp" role="group" aria-label="Advising form">
      <div className="afp-head">
        <span className="afp-title">Advising Form</span>
        <span className="afp-progress" aria-live="polite">
          {filledCount}/{ADVISING_FIELDS.length} filled
        </span>
      </div>

      <div className="afp-grid">
        {ADVISING_FIELDS.map((f) => {
          const isLocked = locked[f.id] && !submitted;
          const val = values[f.id] || "";
          return (
            <div className="afp-field" key={f.id}>
              <label className="afp-label" htmlFor={`afp-${f.id}`}>
                {f.label}
                {f.optional && <span className="afp-opt"> (optional)</span>}
              </label>

              {isLocked ? (
                <div className="afp-locked">
                  <span className="afp-locked-val">{val || "—"}</span>
                  <button
                    type="button"
                    className="afp-edit"
                    onClick={() => unlock(f.id)}
                    disabled={disabled || submitted}
                  >
                    edit
                  </button>
                </div>
              ) : f.type === "choice" ? (
                <select
                  id={`afp-${f.id}`}
                  className="afp-input"
                  value={val}
                  disabled={disabled || submitted}
                  onChange={(e) => setField(f.id, e.target.value)}
                >
                  <option value="">Select…</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : f.type === "yes_no" ? (
                <div className="afp-yesno">
                  {["Yes", "No"].map((o) => (
                    <button
                      key={o}
                      type="button"
                      className={`afp-toggle${val === o ? " on" : ""}`}
                      disabled={disabled || submitted}
                      onClick={() => setField(f.id, o)}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  id={`afp-${f.id}`}
                  className="afp-input"
                  type={f.type === "number" ? "number" : "text"}
                  value={val}
                  placeholder={f.hint || ""}
                  disabled={disabled || submitted}
                  onChange={(e) => setField(f.id, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="afp-foot">
        {!submitted && missing.length > 0 && (
          <span className="afp-missing">{missing.length} required field{missing.length > 1 ? "s" : ""} left</span>
        )}
        <button
          type="button"
          className="afp-submit"
          onClick={handleSubmit}
          disabled={disabled || submitted || missing.length > 0}
        >
          {submitted ? "Submitted" : "Submit form"}
        </button>
      </div>
    </div>
  );
}
