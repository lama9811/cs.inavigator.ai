import { useState, useCallback, useEffect, useRef } from "react";
import { FaExternalLinkAlt } from "@react-icons/all-files/fa/FaExternalLinkAlt";
import { FaArrowLeft } from "@react-icons/all-files/fa/FaArrowLeft";
import { FaPlus } from "@react-icons/all-files/fa/FaPlus";
import { FaTimes } from "@react-icons/all-files/fa/FaTimes";
import { FaMagic } from "@react-icons/all-files/fa/FaMagic";
import { getApiBase } from "../../lib/apiBase";

const API_BASE = getApiBase();

function daysLabel(item) {
  const d = item.days_remaining;
  if (d == null) return null;
  if (d === 0) return "Due today";
  if (d === 1) return "1 day left";
  if (d < 0) return "Deadline passed";
  return `${d} days left`;
}

// Give a brand-new blank row a client-unique id. The backend re-ids on save, so
// this only needs to be unique within the current in-memory list.
function newItemId() {
  return `new-${Math.random().toString(36).slice(2, 9)}`;
}

// The detail view for one saved opportunity: everything the card can't fit, plus
// the application checklist the student fills out. `item` is the saved row (with
// its checklist); `onSaved` receives the updated row after any server write.
export default function ScholarshipDetail({ item, onBack, onSaved }) {
  const [checklist, setChecklist] = useState(item.checklist || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const token = localStorage.getItem("token");
  const authHeaders = { Authorization: `Bearer ${token}` };

  const days = daysLabel(item);
  const hasLink = item.url && item.url !== "(not listed)";
  const isInternship = item.kind === "internship";

  const done = (checklist || []).filter((c) => c.done).length;
  const total = (checklist || []).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  // Persist the whole checklist. The student owns the list; we send it wholesale
  // on every change, which is race-free and keeps the server the source of truth.
  const persist = useCallback(async (next) => {
    setChecklist(next); // optimistic
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/api/scholarships/saved/${item.id}/checklist`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ checklist: next }),
        }
      );
      if (!res.ok) throw new Error("Could not save your checklist. Please retry.");
      const row = await res.json();
      setChecklist(row.checklist || []);
      onSaved?.(row);
    } catch (e) {
      setError(e.message || "Could not save your checklist.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, token, onSaved]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/api/scholarships/saved/${item.id}/checklist/generate`,
        { method: "POST", headers: authHeaders }
      );
      if (!res.ok) throw new Error("Could not build the checklist. Please retry.");
      const row = await res.json();
      setChecklist(row.checklist || []);
      onSaved?.(row);
    } catch (e) {
      setError(e.message || "Could not build the checklist.");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, token, onSaved]);

  // Auto-build the checklist the first time a student opens an item that has none,
  // so "View" always lands on a real, actionable list instead of an empty panel
  // with a button to press. Guarded so it fires once per item, never re-generating
  // over an existing (possibly edited) checklist.
  const autoGenTried = useRef(false);
  useEffect(() => {
    if (checklist === null && !autoGenTried.current) {
      autoGenTried.current = true;
      generate();
    }
  }, [checklist, generate]);

  const toggleItem = (id) =>
    persist((checklist || []).map((c) => (c.id === id ? { ...c, done: !c.done } : c)));

  const editLabel = (id, label) =>
    setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)));

  const editNote = (id, note) =>
    setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, note } : c)));

  const removeItem = (id) =>
    persist((checklist || []).filter((c) => c.id !== id));

  const addItem = () =>
    setChecklist((prev) => [
      ...(prev || []),
      { id: newItemId(), label: "", done: false, note: "" },
    ]);

  // Commit label/note edits on blur — no request per keystroke.
  const commit = () => persist(checklist || []);

  return (
    <div className="sch-detail">
      <button type="button" className="sch-detail-back" onClick={onBack}>
        <FaArrowLeft size={12} /> Back to My Scholarships
      </button>

      <div className="sch-detail-head">
        <div>
          <h2 className="sch-detail-name">{item.name}</h2>
          {item.kind && (
            <span className={`sch-kind sch-kind-${item.kind}`}>{item.kind}</span>
          )}
        </div>
        {hasLink && (
          <a
            className="sch-detail-apply"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open application <FaExternalLinkAlt size={12} />
          </a>
        )}
      </div>

      <dl className="sch-detail-meta">
        {(item.award && item.award !== "(not listed)") && (
          <div><dt>Award</dt><dd>{item.award}</dd></div>
        )}
        {isInternship && item.pay && item.pay !== "(not listed)" && (
          <div><dt>Pay</dt><dd>{item.pay}</dd></div>
        )}
        {isInternship && item.role && <div><dt>Role</dt><dd>{item.role}</dd></div>}
        {isInternship && item.term && <div><dt>Term</dt><dd>{item.term}</dd></div>}
        {isInternship && item.location && (
          <div><dt>Location</dt><dd>{item.location}</dd></div>
        )}
        {item.eligibility && (
          <div><dt>Eligibility</dt><dd>{item.eligibility}</dd></div>
        )}
        <div>
          <dt>Deadline</dt>
          <dd>
            {item.deadline && item.deadline !== "(not listed)" ? item.deadline : "Not listed"}
            {days && (
              <span className={`sch-days ${item.urgency === "EXPIRED" ? "is-expired" : ""}`}>
                {" "}· {days}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {item.why && <p className="sch-detail-why">{item.why}</p>}

      {/* The checklist. This is the point of the detail view. */}
      <section className="sch-checklist">
        <div className="sch-checklist-head">
          <h3>Application checklist</h3>
          {total > 0 && (
            <span className="sch-checklist-count">{done} of {total} done</span>
          )}
        </div>

        {total > 0 && (
          <div className="sch-progress" aria-hidden="true">
            <div className="sch-progress-bar" style={{ width: `${pct}%` }} />
          </div>
        )}

        {error && <div className="sch-notice sch-notice-error">{error}</div>}

        {checklist === null ? (
          <div className="sch-checklist-empty">
            {busy ? (
              <p className="sch-checklist-building">
                <FaMagic size={14} /> Building your checklist from this{" "}
                {isInternship ? "internship" : "scholarship"}&apos;s requirements…
              </p>
            ) : (
              <>
                <p>
                  Couldn&apos;t build the checklist automatically. Try again, or add
                  items yourself.
                </p>
                <button type="button" className="sch-btn" onClick={generate}>
                  <FaMagic size={13} /> Build my checklist
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <ul className="sch-checklist-items">
              {checklist.map((c) => (
                <li key={c.id} className={`sch-check-item ${c.done ? "is-done" : ""}`}>
                  <label className="sch-check-row">
                    <input
                      type="checkbox"
                      checked={c.done}
                      onChange={() => toggleItem(c.id)}
                    />
                    <input
                      type="text"
                      className="sch-check-label"
                      value={c.label}
                      placeholder="What's required?"
                      onChange={(e) => editLabel(c.id, e.target.value)}
                      onBlur={commit}
                    />
                    <button
                      type="button"
                      className="sch-check-remove"
                      onClick={() => removeItem(c.id)}
                      aria-label="Remove item"
                    >
                      <FaTimes size={11} />
                    </button>
                  </label>
                  <input
                    type="text"
                    className="sch-check-note"
                    value={c.note || ""}
                    placeholder="Add a note (optional)"
                    onChange={(e) => editNote(c.id, e.target.value)}
                    onBlur={commit}
                  />
                </li>
              ))}
            </ul>

            <div className="sch-checklist-actions">
              <button type="button" className="sch-check-add" onClick={addItem}>
                <FaPlus size={11} /> Add item
              </button>
              <button
                type="button"
                className="sch-check-regen"
                onClick={generate}
                disabled={busy}
              >
                <FaMagic size={11} /> {busy ? "Rebuilding…" : "Rebuild from requirements"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
