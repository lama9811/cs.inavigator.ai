import { useMemo, useState, useRef, useEffect } from "react";
import { FaFileUpload } from "@react-icons/all-files/fa/FaFileUpload";
import { FaFileDownload } from "@react-icons/all-files/fa/FaFileDownload";
import { FaTimes } from "@react-icons/all-files/fa/FaTimes";
import { isFieldActive } from "../coding-tutor/advisingFormSchema";
import { courseLabel, searchCatalog, normalizeCourseCode, COURSE_GROUP } from "../coding-tutor/courseCatalog";

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

// Course picker: a COMPACT searchable dropdown multiselector (keeps the page from
// being crowded by long checklists) that still shows the chosen courses as chips
// below the trigger. The dropdown searches the whole catalog by code OR name;
// `seeds` (the student's registered courses, or Planner suggestions, depending on
// the field) are pinned to the top so the relevant ones are one tap away. Anything
// not in the catalog can still be added by typing its code. Selections are stored
// as a "||"-joined string (same format as before, so saved drafts stay compatible).
function CoursePicker({ value, disabled, seeds = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  const selected = useMemo(
    () => (value ? value.split("||").filter(Boolean) : []),
    [value],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Pinned seeds = the field's suggested courses (registered or Planner), normalized
  // and de-duped, shown first so students grab the relevant ones without searching.
  const pinned = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const c of seeds) {
      const code = normalizeCourseCode(c);
      if (code && !seen.has(code)) { seen.add(code); list.push(code); }
    }
    return list;
  }, [seeds]);

  // Search results from the whole catalog, grouped the way the advising form lays
  // courses out (General Education -> CS Curriculum -> Minor Courses). Pinned seeds
  // are pulled out into their own "Suggested for you" group so they stay one tap away.
  const results = useMemo(() => {
    const pinnedSet = new Set(pinned);
    const q = query.trim().toLowerCase();

    const shownPinned = !q
      ? pinned
      : pinned.filter((code) => courseLabel(code).toLowerCase().includes(q));

    // Catalog hits (already sorted GenEd->CS->Minor by the catalog), minus pinned.
    const hits = searchCatalog(query).filter((c) => !pinnedSet.has(c.code));
    const order = [COURSE_GROUP.GENED, COURSE_GROUP.CS, COURSE_GROUP.MINOR];
    const groups = order
      .map((g) => ({ group: g, codes: hits.filter((c) => c.group === g).map((c) => c.code) }))
      .filter((g) => g.codes.length > 0);

    return { shownPinned, groups, total: hits.length + shownPinned.length };
  }, [query, pinned]);

  const commit = (next) => onChange(next.join("||"));
  const toggle = (code) => {
    const next = selected.includes(code) ? selected.filter((s) => s !== code) : [...selected, code];
    commit(next);
  };

  // One-click "add all suggested": select every pinned seed the student hasn't
  // ticked yet (e.g. all their registered courses at once). Only meaningful when
  // there are pinned seeds still unselected.
  const unpickedPinned = pinned.filter((code) => !selected.includes(code));
  const addAllPinned = () => {
    if (unpickedPinned.length === 0) return;
    commit([...selected, ...unpickedPinned]);
  };

  // Add a typed course that isn't in the catalog (e.g. a brand-new/odd code).
  const addTyped = () => {
    const code = normalizeCourseCode(query);
    if (!code) return;
    if (!selected.includes(code)) commit([...selected, code]);
    setQuery("");
  };

  const summary = selected.length === 0
    ? "Search or select courses…"
    : `${selected.length} course${selected.length === 1 ? "" : "s"} selected`;

  const typedIsNew = query.trim() && !searchCatalog(query).some((c) => c.code === normalizeCourseCode(query))
    && !pinned.includes(normalizeCourseCode(query));

  return (
    <div className="af-coursepicker">
      <div className="af-cp-select" ref={ref}>
        <button
          type="button"
          className="af-input af-cp-trigger"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={selected.length ? "" : "af-ms-placeholder"}>{summary}</span>
          <span className={`af-ms-caret${open ? " open" : ""}`}>▾</span>
        </button>

        {open && (
          <div className="af-cp-menu" role="listbox">
            <input
              className="af-input af-cp-search"
              value={query}
              autoFocus
              placeholder="Search by code or name, e.g. COSC or Networks"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && typedIsNew) { e.preventDefault(); addTyped(); } }}
            />
            <div className="af-cp-list">
              {results.shownPinned.length > 0 && (
                <>
                  <div className="af-cp-group af-cp-group-row">
                    <span>Suggested for you</span>
                    {unpickedPinned.length > 0 && (
                      <button type="button" className="af-cp-addall" onClick={addAllPinned}>
                        + Add all ({unpickedPinned.length})
                      </button>
                    )}
                  </div>
                  {results.shownPinned.map((code) => (
                    <label key={code} className="af-cp-option" title={courseLabel(code)}>
                      <input type="checkbox" checked={selected.includes(code)} onChange={() => toggle(code)} />
                      <span>{courseLabel(code)}</span>
                    </label>
                  ))}
                </>
              )}
              {results.groups.map((g) => (
                <div key={g.group}>
                  <div className="af-cp-group">{g.group}</div>
                  {g.codes.map((code) => (
                    <label key={code} className="af-cp-option" title={courseLabel(code)}>
                      <input type="checkbox" checked={selected.includes(code)} onChange={() => toggle(code)} />
                      <span>{courseLabel(code)}</span>
                    </label>
                  ))}
                </div>
              ))}
              {results.total === 0 && !typedIsNew && (
                <div className="af-cp-empty">No matching courses.</div>
              )}
              {typedIsNew && (
                <button type="button" className="af-cp-addtyped" onClick={addTyped}>
                  + Add “{normalizeCourseCode(query)}” (not in catalog)
                </button>
              )}
            </div>
          </div>
        )}
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

function FieldControl({ field, value, disabled, courseSuggestions, registeredCourses, onChange, onUpload }) {
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
    // Pinned seeds depend on the field's purpose: the current-semester "registered
    // courses" picker seeds from what the student is taking now; the upcoming-semester
    // pickers seed from the Planner. Either way the full catalog stays searchable.
    const seeds = field.seedSource === "registered" ? registeredCourses
      : field.seedSource === "planner" ? courseSuggestions
      : [];
    return (
      <CoursePicker
        value={value}
        disabled={disabled}
        seeds={seeds}
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

  // Free-writing narrative fields get a roomier textarea instead of a one-line input.
  if (field.freeWriting) {
    return (
      <textarea
        {...common}
        className="af-input af-textarea"
        rows={3}
        value={value}
        placeholder={field.hint || "Write a few sentences…"}
        onChange={(e) => onChange(e.target.value)}
      />
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
  form, values, locked, disabled = false, courseSuggestions = [], registeredCourses = [], onChange, onUnlock, onUpload, onWritingHelp,
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
                      registeredCourses={registeredCourses}
                      onChange={(val) => onChange(field.id, val)}
                      onUpload={onUpload}
                    />
                  )}

                  {field.hint && !isLocked && field.type !== "text" && field.type !== "number" && (
                    <span className="af-hint">{field.hint}</span>
                  )}

                  {/* Free-writing fields get a "help me write this" link that hands the
                      field + the student's current draft to the side-panel helper. It
                      guides/polishes; the student keeps ownership of the wording. */}
                  {field.freeWriting && !isLocked && onWritingHelp && (
                    <button
                      type="button"
                      className="af-write-help"
                      onClick={() => onWritingHelp(field, values[field.id] || "")}
                    >
                      ✨ Help me write this
                    </button>
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
