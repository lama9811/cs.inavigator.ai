import { useState, useEffect, useMemo, useCallback } from "react";
import { FaClipboardList } from "@react-icons/all-files/fa/FaClipboardList";
import { FaCheckCircle } from "@react-icons/all-files/fa/FaCheckCircle";
import { FaDownload } from "@react-icons/all-files/fa/FaDownload";
import { FaArrowRight } from "@react-icons/all-files/fa/FaArrowRight";
import { getApiBase } from "../../lib/apiBase";
import { ADVISING_STEPS } from "../coding-tutor/advisingFormSchema";
import FormRenderer from "./FormRenderer";
import AdvisingHelper from "./AdvisingHelper";
import { missingRequired, visibleFields } from "./formHelpers";
import { buildAdvisingPrintDoc } from "./advisingPrint";
import "./AdvisingPage.css";

const API_BASE = getApiBase();

// DegreeWorks stores the full program string (e.g. "Bachelor of Science in
// Computer Science"), but the form's Major field wants just the major name
// ("Computer Science"). Strip a leading degree phrase ("... in <Major>").
function majorFromProgram(program) {
  const s = String(program || "").trim();
  if (!s) return "";
  const m = s.match(/\b(?:bachelor|master|associate|doctor|b\.?s\.?|b\.?a\.?|m\.?s\.?|ph\.?d\.?)[^]*?\bin\s+(.+)$/i);
  return (m ? m[1] : s).trim();
}

// Split a "First [Middle…] Last" name into first + last. DegreeWorks names often
// include a middle initial (e.g. "Michelle S Oladele-Kuyoro") — the last WORD is the
// surname; anything between first and last is a middle name/initial the form doesn't
// have a field for, so it's dropped rather than glued onto the last name.
function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts[parts.length - 1] };
}

// Build the prefill map from DegreeWorks + the account profile. DegreeWorks is the
// richer source; the profile fills in things DW doesn't carry (notably the MSU
// email, and student ID / major as fallbacks). DegreeWorks wins where both have a
// value. Empty keys are dropped so we never lock a blank field.
function buildPrefill(dw, profile) {
  const out = {};
  const put = (key, val) => { if (val != null && String(val).trim() !== "" && out[key] == null) out[key] = String(val); };

  // DegreeWorks first (preferred).
  if (dw) {
    const { first, last } = splitName(dw.student_name);
    put("first_name", first);
    put("last_name", last);
    put("student_id", dw.student_id);
    put("major", majorFromProgram(dw.degree_program));
    put("minor", dw.minor);
    put("classification", dw.classification);
    put("advisor", dw.advisor);
    if (dw.overall_gpa != null) put("gpa", dw.overall_gpa);
    if (dw.total_credits_earned != null) put("credits_earned", dw.total_credits_earned);
  }

  // Profile (account) — email always comes from here; student_id/major as fallback.
  if (profile) {
    put("msu_email", profile.email);
    put("student_id", profile.studentId);
    if (profile.major) put("major", majorFromProgram(profile.major));
    if (profile.name) {
      const { first, last } = splitName(profile.name);
      put("first_name", first);
      put("last_name", last);
    }
  }

  return out;
}

export default function AdvisingPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const [valuesByForm, setValuesByForm] = useState({});   // { formId: {fieldId: value} }
  const [lockedByForm, setLockedByForm] = useState({});   // { formId: Set(fieldId) }
  const [courseSuggestions, setCourseSuggestions] = useState([]);  // Planner course codes for the course pickers
  const [status, setStatus] = useState({ loading: true, saving: false, saved: false, error: "" });

  const token = localStorage.getItem("token");
  const form = ADVISING_STEPS[stepIndex];

  // Load DegreeWorks + account profile prefill + any saved draft on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dwRes, profileRes, draftRes] = await Promise.all([
          fetch(`${API_BASE}/api/degreeworks`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE}/api/profile`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE}/api/advising/draft`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const dw = dwRes.ok ? await dwRes.json() : null;
        const profile = profileRes.ok ? await profileRes.json() : null;
        const pf = buildPrefill(dw?.data, profile);
        const draft = draftRes.ok ? await draftRes.json() : null;

        if (cancelled) return;

        // Seed each form's values: saved draft wins, else DegreeWorks/profile prefill.
        const seededValues = {};
        const seededLocked = {};
        for (const f of ADVISING_STEPS) {
          const saved = draft?.forms?.[f.id] || {};
          const vals = {};
          const locked = new Set();
          for (const section of f.sections) {
            for (const field of section.fields) {
              if (saved[field.id] != null && saved[field.id] !== "") {
                vals[field.id] = saved[field.id];
              } else if (field.prefillKey && pf[field.prefillKey] != null) {
                vals[field.id] = pf[field.prefillKey];
                locked.add(field.id);   // pre-filled from DegreeWorks -> read-only
              }
            }
          }
          seededValues[f.id] = vals;
          seededLocked[f.id] = locked;
        }
        setValuesByForm(seededValues);
        setLockedByForm(seededLocked);
        setStatus((s) => ({ ...s, loading: false }));
      } catch {
        if (!cancelled) setStatus((s) => ({ ...s, loading: false, error: "Could not load your data. You can still fill the form manually." }));
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Pull the Planner's suggested next-semester courses so the "courses you'd like
  // to take" picker is pre-seeded. Best-effort: if the planner isn't connected or
  // fails, the picker just falls back to manual type-in (no error surfaced).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/planning/next-semester`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const plan = await res.json();
        const codes = [];
        const seen = new Set();
        for (const opt of plan?.options || []) {
          for (const c of opt?.courses || []) {
            const code = String(c?.code || "").trim().toUpperCase();
            if (code && !seen.has(code)) { seen.add(code); codes.push(code); }
          }
        }
        if (!cancelled) setCourseSuggestions(codes);
      } catch {
        /* planner is optional — ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Upload an advising document (Course Sequence / DegreeWorks PDF). Returns the
  // stored filename the form should keep, or null on failure.
  const uploadDocument = useCallback(async (file) => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${API_BASE}/api/advising/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.filename || data?.stored_name || null;
  }, [token]);

  const values = useMemo(() => valuesByForm[form.id] || {}, [valuesByForm, form.id]);
  const locked = lockedByForm[form.id] || new Set();

  const setField = useCallback((fieldId, val) => {
    setValuesByForm((prev) => ({ ...prev, [form.id]: { ...(prev[form.id] || {}), [fieldId]: val } }));
    setStatus((s) => ({ ...s, saved: false }));
  }, [form.id]);

  const unlock = useCallback((fieldId) => {
    setLockedByForm((prev) => {
      const next = new Set(prev[form.id] || []);
      next.delete(fieldId);
      return { ...prev, [form.id]: next };
    });
  }, [form.id]);

  const missing = useMemo(() => missingRequired(form, values), [form, values]);
  const visible = useMemo(() => visibleFields(form, values), [form, values]);
  const filledCount = visible.filter((f) => String(values[f.id] || "").trim()).length;

  const saveDraft = async () => {
    setStatus((s) => ({ ...s, saving: true, error: "" }));
    try {
      const res = await fetch(`${API_BASE}/api/advising/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ forms: valuesByForm }),
      });
      if (!res.ok) throw new Error("save failed");
      setStatus((s) => ({ ...s, saving: false, saved: true }));
    } catch {
      setStatus((s) => ({ ...s, saving: false, error: "Couldn't save your draft. Check your connection and try again." }));
    }
  };

  const downloadPdf = () => {
    // Browser print-to-PDF: open a clean printable doc of everything filled so far.
    buildAdvisingPrintDoc(ADVISING_STEPS, valuesByForm);
  };

  const goNext = async () => {
    await saveDraft();
    if (stepIndex < ADVISING_STEPS.length - 1) setStepIndex((i) => i + 1);
  };

  if (status.loading) {
    return <div className="advising-page"><div className="af-loading">Loading your advising form…</div></div>;
  }

  return (
    <div className="advising-page">
      <header className="advising-hero">
        <div className="advising-hero-icon"><FaClipboardList size={22} /></div>
        <div>
          <h1>Advising</h1>
          <p>Fill out your advising paperwork here. Details we already have from DegreeWorks are filled in for you — tap <em>edit</em> to change any of them. Your progress saves as a draft, and you can download a copy to submit.</p>
        </div>
      </header>

      {/* Step indicator */}
      <ol className="advising-steps">
        {ADVISING_STEPS.map((f, i) => (
          <li
            key={f.id}
            className={`advising-step${i === stepIndex ? " current" : ""}${i < stepIndex ? " done" : ""}`}
          >
            <span className="advising-step-num">{i < stepIndex ? <FaCheckCircle size={15} /> : i + 1}</span>
            <span className="advising-step-label">{i === 0 ? "Internship Form" : "Advising Form"}</span>
          </li>
        ))}
      </ol>

      <div className="advising-form-head">
        <div>
          <h2>{form.title}</h2>
          <p className="advising-form-sub">{form.subtitle}</p>
        </div>
        <span className="advising-progress">{filledCount}/{visible.length} filled</span>
      </div>

      {status.error && <div className="advising-alert">{status.error}</div>}

      <div className="advising-body">
        <div className="advising-main">
          <FormRenderer
            form={form}
            values={values}
            locked={locked}
            disabled={status.saving}
            courseSuggestions={courseSuggestions}
            onChange={setField}
            onUnlock={unlock}
            onUpload={uploadDocument}
          />

          <footer className="advising-actions">
            <div className="advising-actions-left">
              <button type="button" className="advising-btn ghost" onClick={saveDraft} disabled={status.saving}>
                {status.saving ? "Saving…" : status.saved ? "Draft saved ✓" : "Save draft"}
              </button>
              <button type="button" className="advising-btn ghost" onClick={downloadPdf}>
                <FaDownload size={13} /> Download PDF
              </button>
            </div>
            <div className="advising-actions-right">
              {missing.length > 0 && (
                <span className="advising-missing">{missing.length} required field{missing.length > 1 ? "s" : ""} left</span>
              )}
              {stepIndex > 0 && (
                <button type="button" className="advising-btn ghost" onClick={() => setStepIndex((i) => i - 1)}>Back</button>
              )}
              {stepIndex < ADVISING_STEPS.length - 1 ? (
                <button type="button" className="advising-btn primary" onClick={goNext} disabled={missing.length > 0}>
                  Next: Advising Form <FaArrowRight size={13} />
                </button>
              ) : (
                <button type="button" className="advising-btn primary" onClick={saveDraft} disabled={missing.length > 0 || status.saving}>
                  Finish & save
                </button>
              )}
            </div>
          </footer>
        </div>

        <div className="advising-side">
          <AdvisingHelper form={form} courseSuggestions={courseSuggestions} />
        </div>
      </div>
    </div>
  );
}
