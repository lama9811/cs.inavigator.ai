import { useMemo, useState, useRef, useEffect } from "react";
import { FaFileUpload } from "@react-icons/all-files/fa/FaFileUpload";
import { FaFileDownload } from "@react-icons/all-files/fa/FaFileDownload";
import { FaTimes } from "@react-icons/all-files/fa/FaTimes";
import { isFieldActive } from "../coding-tutor/advisingFormSchema";
import { courseLabel } from "../coding-tutor/courseCatalog";

// A dropdown that allows checking multiple options. Value is stored as a
// "||"-joined string (same format as multi_choice) so save/print stay consistent.
function MultiSelect({ field, value, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = value ? value.split("||").filter(Boolean) : [];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (opt) => {
    const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
    onChange(next.join("||"));
  };

  const summary = selected.length === 0 ? "Select…"
    : selected.length === 1 ? selected[0]
    : `${selected.length} selected`;

  return (
    <div className="af-multiselect" ref={ref}>
      <button
        type="button"
        className="af-input af-multiselect-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected.length ? "" : "af-ms-placeholder"}>{summary}</span>
        <span className={`af-ms-caret${open ? " open" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="af-multiselect-menu" role="listbox">
          {field.options.map((o) => (
            <label key={o} className="af-ms-option">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Normalize a typed course code: trim, collapse spaces, uppercase (so "cosc 349"
// and "COSC349" both land as a clean chip). Empty input yields "".
function normalizeCourse(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ").toUpperCase();
}

// Course picker: a checklist of suggested courses (seeded from the Planner) that
// the student can tick, PLUS a text box to add any course code not in the list.
// Selections (suggested + manually added) are stored as a "||"-joined string.
function CoursePicker({ value, disabled, suggestions = [], onChange }) {
  const [typed, setTyped] = useState("");
  const selected = useMemo(
    () => (value ? value.split("||").filter(Boolean) : []),
    [value],
  );

  // The option list = Planner suggestions plus any already-selected courses that
  // aren't in the suggestion list (so manually-added ones still show a checkbox).
  const options = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const c of [...suggestions, ...selected]) {
      const key = normalizeCourse(c);
      if (key && !seen.has(key)) { seen.add(key); list.push(key); }
    }
    return list;
  }, [suggestions, selected]);

  const commit = (next) => onChange(next.join("||"));

  const toggle = (opt) => {
    const next = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    commit(next);
  };

  const addTyped = () => {
    const c = normalizeCourse(typed);
    if (!c) return;
    if (!selected.includes(c)) commit([...selected, c]);
    setTyped("");
  };

  return (
    <div className="af-coursepicker">
      {options.length > 0 && (
        <div className="af-cp-options">
          {options.map((o) => (
            <label key={o} className="af-cp-option" title={courseLabel(o)}>
              <input
                type="checkbox"
                checked={selected.includes(o)}
                disabled={disabled}
                onChange={() => toggle(o)}
              />
              <span>{courseLabel(o)}</span>
            </label>
          ))}
        </div>
      )}
      <div className="af-cp-add">
        <input
          className="af-input"
          value={typed}
          disabled={disabled}
          placeholder="Add a course, e.g. COSC 349"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
        />
        <button type="button" className="af-cp-add-btn" disabled={disabled || !typed.trim()} onClick={addTyped}>
          Add
        </button>
      </div>
      {selected.length > 0 && (
        <div className="af-chips af-cp-chips">
          {selected.map((c) => (
            <span key={c} className="af-chip on af-cp-chip" title={courseLabel(c)}>
              {courseLabel(c)}
              <button
                type="button"
                className="af-cp-chip-x"
                disabled={disabled}
                aria-label={`Remove ${c}`}
                onClick={() => commit(selected.filter((s) => s !== c))}
              >
                <FaTimes size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// File upload: pick a file, hand it to the parent's uploader (which POSTs it to the
// backend and returns a stored filename), then store that filename in the draft via
// onChange so it saves + validates like any other field.
function FileField({ field, value, disabled, onChange, onUpload }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  const pick = async (file) => {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const stored = await onUpload(file);
      if (!stored) throw new Error("upload failed");
      onChange(stored);
    } catch {
      setErr("Upload failed. Check the file and try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="af-file">
      <input
        ref={inputRef}
        type="file"
        className="af-file-input"
        accept={field.accept || undefined}
        disabled={disabled || busy}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <button
        type="button"
        className="af-file-btn"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        <FaFileUpload size={13} /> {busy ? "Uploading…" : value ? "Replace file" : "Choose file"}
      </button>
      {value && !busy && <span className="af-file-name">{value}</span>}
      {err && <span className="af-file-err">{err}</span>}
    </div>
  );
}

// Data-driven renderer for one advising form (a schema with sections/fields).
// Handles every field type, conditional show/hide (requiredWhen), DegreeWorks
// pre-fill shown read-only with a per-field "edit" toggle, and validation.
//
// Controlled: the parent owns `values` and `locked` (the set of pre-filled fields
// still locked) and passes setters. This component only renders + reports changes.

function FieldControl({ field, value, disabled, courseSuggestions, onChange, onUpload }) {
  const common = { id: `af-${field.id}`, className: "af-input", disabled };

  if (field.type === "choice") {
    return (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (field.type === "yes_no" || field.type === "yes_no_maybe") {
    const opts = field.type === "yes_no_maybe" ? ["Yes", "No", "Maybe"] : ["Yes", "No"];
    return (
      <div className="af-toggle-row">
        {opts.map((o) => (
          <button
            key={o}
            type="button"
            className={`af-toggle${value === o ? " on" : ""}`}
            disabled={disabled}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }

  if (field.type === "multi_select") {
    return <MultiSelect field={field} value={value} disabled={disabled} onChange={onChange} />;
  }

  if (field.type === "course_picker") {
    return (
      <CoursePicker
        value={value}
        disabled={disabled}
        suggestions={field.plannerSeeded ? courseSuggestions : []}
        onChange={onChange}
      />
    );
  }

  if (field.type === "date") {
    return (
      <input
        {...common}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (field.type === "file") {
    return <FileField field={field} value={value} disabled={disabled} onChange={onChange} onUpload={onUpload} />;
  }

  if (field.type === "multi_choice") {
    // Stored as a comma-joined string; toggled chips.
    const selected = value ? value.split("||").filter(Boolean) : [];
    const toggle = (opt) => {
      const next = selected.includes(opt)
        ? selected.filter((s) => s !== opt)
        : [...selected, opt];
      onChange(next.join("||"));
    };
    return (
      <div className="af-chips">
        {field.options.map((o) => (
          <button
            key={o}
            type="button"
            className={`af-chip${selected.includes(o) ? " on" : ""}`}
            disabled={disabled}
            onClick={() => toggle(o)}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }

  // text / number
  return (
    <input
      {...common}
      type={field.type === "number" ? "number" : "text"}
      value={value}
      placeholder={field.hint || ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function FormRenderer({
  form, values, locked, disabled = false, courseSuggestions = [], onChange, onUnlock, onUpload,
}) {
  // Only fields whose conditions are met are shown.
  const visibleBySection = useMemo(
    () => form.sections.map((section) => ({
      section,
      fields: section.fields.filter((f) => isFieldActive(f, values)),
    })),
    [form, values],
  );

  const displayValue = (id) => {
    const v = values[id];
    if (v == null || v === "") return "—";
    return String(v).replaceAll("||", ", ");  // multi_choice pretty-print
  };

  return (
    <div className="af-form">
      {visibleBySection.map(({ section, fields }) => (
        <fieldset className="af-section" key={section.id}>
          <legend className="af-section-title">{section.title}</legend>
          {section.references?.length > 0 && (
            <div className="af-refs">
              <span className="af-refs-label">Attach these with your DegreeWorks PDF:</span>
              <div className="af-refs-links">
                {section.references.map((r) => (
                  <a key={r.href} className="af-ref-link" href={r.href} target="_blank" rel="noopener noreferrer">
                    <FaFileDownload size={12} /> {r.label}
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="af-grid">
            {fields.map((field) => {
              const isLocked = locked?.has(field.id);
              // Course pickers and long text need the full row width.
              const wide = field.type === "course_picker" || field.type === "file";
              return (
                <div className={`af-field${wide ? " af-field-wide" : ""}`} key={field.id}>
                  <label className="af-label" htmlFor={`af-${field.id}`}>
                    {field.label}
                    {!field.required && !field.requiredWhen && (
                      <span className="af-opt"> (optional)</span>
                    )}
                  </label>

                  {isLocked ? (
                    <div className="af-locked">
                      <span className="af-locked-val">{displayValue(field.id)}</span>
                      <button
                        type="button"
                        className="af-edit"
                        onClick={() => onUnlock(field.id)}
                        disabled={disabled}
                      >
                        edit
                      </button>
                    </div>
                  ) : (
                    <FieldControl
                      field={field}
                      value={values[field.id] || ""}
                      disabled={disabled}
                      courseSuggestions={courseSuggestions}
                      onChange={(val) => onChange(field.id, val)}
                      onUpload={onUpload}
                    />
                  )}

                  {field.hint && !isLocked && field.type !== "text" && field.type !== "number" && (
                    <span className="af-hint">{field.hint}</span>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
