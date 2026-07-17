import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { FaClipboardList } from "@react-icons/all-files/fa/FaClipboardList";
import { FaCheckCircle } from "@react-icons/all-files/fa/FaCheckCircle";
import { FaDownload } from "@react-icons/all-files/fa/FaDownload";
import { FaArrowRight } from "@react-icons/all-files/fa/FaArrowRight";
import { getApiBase } from "../../lib/apiBase";
import { ADVISING_STEPS } from "../coding-tutor/advisingFormSchema";
import FormRenderer from "./FormRenderer";
import AdvisingHelper from "./AdvisingHelper";
import { missingRequired, visibleFields, fileListLabel } from "./formHelpers";
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
  const [lockedByForm, setLockedByForm] = useState({});   // { formId: Set(fieldId) } — DegreeWorks-prefilled, still read-only
  const [courseSuggestions, setCourseSuggestions] = useState([]);  // Planner course codes (upcoming-semester pickers)
  const [registeredCourses, setRegisteredCourses] = useState([]);  // student's current/registered course codes (current-semester picker)
  const [status, setStatus] = useState({ loading: true, saving: false, saved: false, submitted: false, error: "" });
  // A "help me write this" request from a free-writing field: { field, currentText, nonce }.
  // The nonce lets the helper re-fire even if the same field is clicked twice.
  const [writingRequest, setWritingRequest] = useState(null);

  const token = localStorage.getItem("token");
  const form = ADVISING_STEPS[stepIndex];

  // Guards so autosave only fires on real user edits: true once the initial
  // load has finished, and true once the user changes/uploads/unlocks anything.
  const hydrated = useRef(false);
  const dirty = useRef(false);
  const autosaveTimer = useRef(null);
  // Latest locked-set + step, read inside the debounced autosave without re-arming it.
  const lockedRef = useRef(lockedByForm);
  useEffect(() => { lockedRef.current = lockedByForm; }, [lockedByForm]);
  const stepRef = useRef(stepIndex);
  useEffect(() => { stepRef.current = stepIndex; }, [stepIndex]);

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

        // Restore the last step the student was on (persisted under a reserved
        // __meta key inside the draft), so a reload doesn't send them back to Step 1.
        const savedStep = Number(draft?.forms?.__meta?.step);
        if (Number.isInteger(savedStep) && savedStep >= 0 && savedStep < ADVISING_STEPS.length) {
          setStepIndex(savedStep);
        }
        setValuesByForm(seededValues);
        setLockedByForm(seededLocked);
        hydrated.current = true;   // enable autosave now that seeded values are in place
        setStatus((s) => ({ ...s, loading: false, submitted: Boolean(draft?.submitted) }));
      } catch {
        if (!cancelled) { hydrated.current = true; setStatus((s) => ({ ...s, loading: false, error: "Could not load your data. You can still fill the form manually." })); }
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

  // Pull the student's CURRENT/registered courses so the "registered courses" picker
  // is pre-seeded with what they're actually taking now: DegreeWorks in-progress +
  // Banner registered sections. Best-effort — if neither is connected the picker just
  // falls back to search + type-in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const codes = [];
      const seen = new Set();
      const add = (raw) => {
        const code = String(raw || "").trim().toUpperCase().replace(/\s+/g, " ");
        if (code && !seen.has(code)) { seen.add(code); codes.push(code); }
      };
      try {
        const [dwRes, bannerRes] = await Promise.all([
          fetch(`${API_BASE}/api/degreeworks`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE}/api/banner/data`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (dwRes.ok) {
          const dw = await dwRes.json();
          for (const c of dw?.data?.courses_in_progress || []) add(c?.code);
        }
        if (bannerRes.ok) {
          const b = await bannerRes.json();
          for (const c of b?.data?.registered_courses || []) add(c?.code || c);
        }
        if (!cancelled) setRegisteredCourses(codes);
      } catch {
        /* registered-course seed is optional — ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Upload one advising document (Course Sequence sheet / DegreeWorks PDF). Returns
  // BOTH the id the backend stores the bytes under and the original filename, so the
  // form can keep the id but still show the student a readable name. Null on failure.
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
    const id = data?.stored_name || data?.id;
    if (!id) return null;
    return { id: String(id), filename: data?.filename || file.name };
  }, [token]);

  // Delete the stored blob when a student removes a file, so it doesn't linger as
  // an orphan in the DB. Non-fatal: a failed delete just leaves a sweepable orphan,
  // it must never block the UI from removing the file reference.
  const deleteDocument = useCallback(async (id) => {
    if (!id) return;
    try {
      await fetch(`${API_BASE}/api/advising/file/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* best-effort cleanup; ignore */
    }
  }, [token]);

  const values = useMemo(() => valuesByForm[form.id] || {}, [valuesByForm, form.id]);
  const locked = lockedByForm[form.id] || new Set();

  // A labeled snapshot of everything the student has filled across BOTH forms, so the
  // free-writing helper can ground its suggestions in their own answers (e.g. use the
  // internship-form organization + job title when helping write "relevance of
  // experience"). Only non-empty, non-locked-blank values; "||" shown as commas.
  const filledValues = useMemo(() => {
    const out = [];
    for (const f of ADVISING_STEPS) {
      const vals = valuesByForm[f.id] || {};
      for (const section of f.sections) {
        for (const field of section.fields) {
          const v = vals[field.id];
          if (v != null && String(v).trim() !== "") {
            // File fields store "name::id" pairs; the helper only ever sees the
            // filenames, not the internal storage ids.
            const shown = field.type === "file"
              ? fileListLabel(v)
              : String(v).replaceAll("||", ", ");
            if (shown.trim() !== "") out.push({ label: field.label, value: shown });
          }
        }
      }
    }
    return out;
  }, [valuesByForm]);

  const setField = useCallback((fieldId, val) => {
    dirty.current = true;
    setValuesByForm((prev) => ({ ...prev, [form.id]: { ...(prev[form.id] || {}), [fieldId]: val } }));
    // Editing after "Finish & save" means it's a draft again, so drop the badge.
    setStatus((s) => ({ ...s, saved: false, submitted: false }));
  }, [form.id]);

  // Hand a free-writing field to the side-panel helper. The nonce (a counter via
  // Date-free increment) makes each click a fresh request the helper reacts to.
  const requestWritingHelp = useCallback((field, currentText) => {
    setWritingRequest((prev) => ({ field, currentText, nonce: (prev?.nonce || 0) + 1 }));
  }, []);

  const unlock = useCallback((fieldId) => {
    // Editing a DegreeWorks-prefilled field makes it a user-owned value: it leaves
    // the locked set, so from now on it's persisted in the draft (and no longer
    // re-derived from DegreeWorks on reload).
    dirty.current = true;
    setLockedByForm((prev) => {
      const next = new Set(prev[form.id] || []);
      next.delete(fieldId);
      return { ...prev, [form.id]: next };
    });
  }, [form.id]);

  const missing = useMemo(() => missingRequired(form, values), [form, values]);
  const visible = useMemo(() => visibleFields(form, values), [form, values]);
  const filledCount = visible.filter((f) => String(values[f.id] || "").trim()).length;

  // Build the payload that gets persisted. We store ONLY user-owned values, not the
  // DegreeWorks/profile prefill: fields that are still locked (prefilled + untouched)
  // are stripped, so on the next load they re-derive fresh from DegreeWorks and stay
  // read-only. A field the student edited has left the locked set, so it's kept.
  // This keeps prefill-vs-saved precedence intact across reloads (see the load effect).
  const buildDraftPayload = useCallback(() => {
    const out = {};
    for (const [formId, fields] of Object.entries(valuesByForm)) {
      const lockedSet = lockedRef.current[formId] || new Set();
      const kept = {};
      for (const [fieldId, val] of Object.entries(fields || {})) {
        if (lockedSet.has(fieldId)) continue;          // untouched DegreeWorks prefill — don't persist
        if (val == null || val === "") continue;       // don't persist blanks
        kept[fieldId] = val;
      }
      out[formId] = kept;
    }
    // Reserved key: the current step, so a reload returns the student where they were.
    out.__meta = { step: stepRef.current };
    return out;
  }, [valuesByForm]);

  // `submitted` is only sent when the student presses "Finish & save"; autosave and
  // the plain "Save draft" button leave it out so the draft stays a draft.
  const saveDraft = useCallback(async (submitted = false) => {
    setStatus((s) => ({ ...s, saving: true, error: "" }));
    try {
      const body = { forms: buildDraftPayload() };
      if (submitted) body.submitted = true;
      const res = await fetch(`${API_BASE}/api/advising/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json().catch(() => ({}));
      setStatus((s) => ({ ...s, saving: false, saved: true, submitted: Boolean(data.submitted) }));
      return true;
    } catch {
      setStatus((s) => ({ ...s, saving: false, error: "Couldn't save your draft. Check your connection and try again." }));
      return false;
    }
  }, [token, buildDraftPayload]);

  // Debounced autosave: ~1.2s after the last edit, once the form is hydrated and the
  // user has actually changed something. The explicit "Save draft" button and
  // save-on-Next still work; this just means students rarely need to press them.
  useEffect(() => {
    if (!hydrated.current || !dirty.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { saveDraft(); }, 1200);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [valuesByForm, lockedByForm, saveDraft]);

  // Persist the step immediately whenever it changes (after the initial load), so a
  // reload keeps the student on the form they'd moved to — even if they never edited
  // a field on it. Runs after stepRef is updated by the effect above.
  useEffect(() => {
    if (!hydrated.current) return;
    stepRef.current = stepIndex;
    saveDraft();
  }, [stepIndex, saveDraft]);

  const downloadPdf = () => {
    // Browser print-to-PDF: open a clean printable doc of everything filled so far.
    buildAdvisingPrintDoc(ADVISING_STEPS, valuesByForm);
  };

  const goNext = () => {
    // Advancing changes stepIndex, which the step effect persists (with current
    // field values) — no separate save call needed here.
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
        <button type="button" className="advising-btn ghost advising-hero-download" onClick={downloadPdf}>
          <FaDownload size={13} /> Download PDF
        </button>
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
            /* Don't disable fields while a background autosave is in flight — that
               blurs the input the student is typing in (one digit, then focus is
               lost). Autosave is silent; only the initial load blocks the form. */
            disabled={false}
            courseSuggestions={courseSuggestions}
            registeredCourses={registeredCourses}
            onChange={setField}
            onUnlock={unlock}
            onUpload={uploadDocument}
            onDeleteFile={deleteDocument}
            onWritingHelp={requestWritingHelp}
          />

          <footer className="advising-actions">
            <div className="advising-actions-left">
              <button type="button" className="advising-btn ghost" onClick={() => saveDraft()} disabled={status.saving}>
                {status.saving ? "Saving…" : status.submitted ? "Submitted ✓" : status.saved ? "Draft saved ✓" : "Save draft"}
              </button>
              <span className="advising-autosave-hint">Changes save automatically</span>
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
                <button type="button" className="advising-btn primary" onClick={() => saveDraft(true)} disabled={missing.length > 0 || status.saving}>
                  {status.submitted ? "Submitted ✓" : "Finish & save"}
                </button>
              )}
            </div>
          </footer>
        </div>

        <div className="advising-side">
          <AdvisingHelper
            form={form}
            courseSuggestions={courseSuggestions}
            writingRequest={writingRequest}
            filledValues={filledValues}
          />
        </div>
      </div>
    </div>
  );
}
