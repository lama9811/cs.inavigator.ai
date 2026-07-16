import { useState, useEffect, useCallback } from "react";
import { FaGraduationCap } from "@react-icons/all-files/fa/FaGraduationCap";
import { FaExternalLinkAlt } from "@react-icons/all-files/fa/FaExternalLinkAlt";
import { FaSearch } from "@react-icons/all-files/fa/FaSearch";
import { FaRegBookmark } from "@react-icons/all-files/fa/FaRegBookmark";
import { FaBookmark } from "@react-icons/all-files/fa/FaBookmark";
import { FaTrashAlt } from "@react-icons/all-files/fa/FaTrashAlt";
import { FaRegListAlt } from "@react-icons/all-files/fa/FaRegListAlt";
import { getApiBase } from "../../lib/apiBase";
import ScholarshipDetail from "./ScholarshipDetail";
import "./ScholarshipsPage.css";

const API_BASE = getApiBase();

// The three urgency buckets the backend returns, in the order students should read
// them: what closes first comes first.
const GROUPS = [
  { key: "URGENT", label: "Closing soon", hint: "Less than 7 days left" },
  { key: "UPCOMING", label: "Coming up", hint: "Less than 30 days left" },
  { key: "OPEN", label: "Open", hint: "More than 30 days out, or rolling" },
];

// The pipeline a saved item moves through. Order is the natural progression, so the
// dropdown reads like a story from "I might apply" to "I heard back".
const STATUSES = [
  { key: "interested", label: "Interested" },
  { key: "applying", label: "Applying" },
  { key: "submitted", label: "Submitted" },
  { key: "awarded", label: "Awarded" },
  { key: "rejected", label: "Not selected" },
  { key: "expired", label: "Expired" },
];

// Starter prompts so the page isn't a blank box.
const EXAMPLES = [
  "Scholarships I qualify for right now",
  "Summer internships for CS majors",
  "HBCU scholarships with a fall deadline",
  "Research programs (REU) for undergrads",
];

function daysLabel(item) {
  const d = item.days_remaining;
  if (d == null) return null;
  if (d === 0) return "Due today";
  if (d === 1) return "1 day left";
  if (d < 0) return "Deadline passed";
  return `${d} days left`;
}

// The fields we send to the backend when saving. Kept in one place so a search
// result and a re-save stay in sync.
function toSavePayload(item) {
  return {
    kind: item.kind || "scholarship",
    name: item.name,
    award: item.award,
    eligibility: item.eligibility,
    pay: item.pay,
    term: item.term,
    location: item.location,
    role: item.role,
    deadline: item.deadline,
    url: item.url,
    source_url: item.source_url,
    why: item.why,
  };
}

// Match a search result against the saved list. The backend dedupes on a hash of
// name+url; here we mirror that loosely so the Save button flips to "Saved" without
// a round-trip. Exact name+url match is enough for the button state.
function findSaved(saved, item) {
  const url = (item.url || "").trim().toLowerCase();
  const name = (item.name || "").trim().toLowerCase();
  return saved.find(
    (s) => (s.name || "").trim().toLowerCase() === name &&
           (s.url || "").trim().toLowerCase() === url
  );
}

function OpportunityCard({ item, saved, onSave, onRemove, saving }) {
  const days = daysLabel(item);
  const hasLink = item.url && item.url !== "(not listed)";
  const isInternship = item.kind === "internship";

  return (
    <li className="sch-card">
      <div className="sch-card-head">
        <h3 className="sch-card-name">
          {item.curated && <span className="sch-rec" title="Curated by CS Navigator">★ Recommended</span>}
          {item.name}
        </h3>
        {item.kind && <span className={`sch-kind sch-kind-${item.kind}`}>{item.kind}</span>}
      </div>

      {/* Internships lead with pay/role; scholarships with the award. */}
      {isInternship
        ? (item.pay && item.pay !== "(not listed)" && (
            <p className="sch-award">{item.pay}</p>
          ))
        : (item.award && item.award !== "(not listed)" && (
            <p className="sch-award">{item.award}</p>
          ))}
      {item.why && <p className="sch-why">{item.why}</p>}

      <dl className="sch-meta">
        {isInternship && item.role && (
          <div><dt>Role</dt><dd>{item.role}</dd></div>
        )}
        {isInternship && item.term && (
          <div><dt>Term</dt><dd>{item.term}</dd></div>
        )}
        {isInternship && item.location && (
          <div><dt>Location</dt><dd>{item.location}</dd></div>
        )}
        {!isInternship && item.eligibility && (
          <div><dt>Eligibility</dt><dd>{item.eligibility}</dd></div>
        )}
        <div>
          <dt>Deadline</dt>
          <dd>
            {item.deadline && item.deadline !== "(not listed)" ? item.deadline : "Not listed"}
            {days && <span className="sch-days"> · {days}</span>}
          </dd>
        </div>
      </dl>

      <div className="sch-card-actions">
        {hasLink && (
          <a className="sch-apply" href={item.url} target="_blank" rel="noopener noreferrer">
            How to apply <FaExternalLinkAlt size={11} />
          </a>
        )}
        {saved ? (
          <button
            type="button"
            className="sch-save is-saved"
            onClick={() => onRemove(saved)}
            disabled={saving}
          >
            <FaBookmark size={12} /> Saved
          </button>
        ) : (
          <button
            type="button"
            className="sch-save"
            onClick={() => onSave(item)}
            disabled={saving}
          >
            <FaRegBookmark size={12} /> Save
          </button>
        )}
      </div>
    </li>
  );
}

function SavedCard({ item, onStatus, onRemove, onOpen, busy }) {
  const days = daysLabel(item);
  const expired = item.urgency === "EXPIRED";

  const prog = item.checklist_progress || { done: 0, total: 0 };
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <li className={`sch-card sch-saved-card ${expired ? "is-expired" : ""}`}>
      <div className="sch-card-head">
        <h3 className="sch-card-name">{item.name}</h3>
        {item.kind && <span className={`sch-kind sch-kind-${item.kind}`}>{item.kind}</span>}
      </div>

      {item.award && item.award !== "(not listed)" && (
        <p className="sch-award">{item.award}</p>
      )}
      {item.pay && item.pay !== "(not listed)" && (
        <p className="sch-award">{item.pay}</p>
      )}

      <dl className="sch-meta">
        <div>
          <dt>Deadline</dt>
          <dd>
            {item.deadline && item.deadline !== "(not listed)" ? item.deadline : "Not listed"}
            {days && (
              <span className={`sch-days ${expired ? "is-expired" : ""}`}> · {days}</span>
            )}
          </dd>
        </div>
      </dl>

      {/* Compact checklist progress, so the card shows at a glance how far along
          an application is without opening the detail view. */}
      {prog.total > 0 && (
        <div className="sch-card-progress">
          <div className="sch-progress">
            <div className="sch-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="sch-card-progress-label">{prog.done}/{prog.total} steps</span>
        </div>
      )}

      <div className="sch-card-actions">
        <label className="sch-status-pick">
          <span className="sch-status-label">Status</span>
          <select
            className={`sch-status-select is-${item.status}`}
            value={item.status}
            disabled={busy}
            onChange={(e) => onStatus(item, e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>

        <button type="button" className="sch-open" onClick={() => onOpen?.(item)}>
          <FaRegListAlt size={12} /> {prog.total > 0 ? "Checklist" : "View"}
        </button>
        <button
          type="button"
          className="sch-remove"
          onClick={() => onRemove(item)}
          disabled={busy}
          aria-label={`Remove ${item.name} from saved`}
        >
          <FaTrashAlt size={12} />
        </button>
      </div>
    </li>
  );
}

export default function ScholarshipsPage() {
  const [tab, setTab] = useState("search"); // "search" | "saved"
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  // null = still checking; false = the backend has no TAVILY_API_KEY.
  const [configured, setConfigured] = useState(null);

  const [saved, setSaved] = useState([]);
  const [savingKey, setSavingKey] = useState(null); // name+url currently in flight
  const [openId, setOpenId] = useState(null);        // saved id shown in the detail view
  const [saveError, setSaveError] = useState("");    // surfaced save/unsave failures

  const token = localStorage.getItem("token");
  const authHeaders = { Authorization: `Bearer ${token}` };

  // Ask up front whether search is even usable, so we can explain rather than
  // let the student type a query and hit a 503.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/scholarships/status`, {
          headers: authHeaders,
        });
        const data = res.ok ? await res.json() : { configured: false };
        if (!cancelled) setConfigured(Boolean(data.configured));
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Load the saved list once on mount, so the Save buttons show "Saved" from the
  // start and the Saved tab has data ready.
  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/scholarships/saved`, {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setSaved(data.items || []);
      }
    } catch {
      /* saved list is a convenience; a failure here shouldn't block search */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const search = useCallback(async (q) => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/scholarships/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail || "Search failed. Please try again.");
      }
      setResult(await res.json());
    } catch (e) {
      setError(e.message || "Search failed. Please try again.");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const onSubmit = (e) => {
    e.preventDefault();
    if (!busy) search(query);
  };

  const saveItem = useCallback(async (item) => {
    const key = `${item.name}|${item.url || ""}`;
    setSavingKey(key);
    setSaveError("");
    try {
      const res = await fetch(`${API_BASE}/api/scholarships/saved`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(toSavePayload(item)),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail || `Couldn't save (error ${res.status}).`);
      }
      const row = await res.json();
      // Replace an existing row with the same id, or add the new one.
      setSaved((prev) => {
        const without = prev.filter((s) => s.id !== row.id);
        return [row, ...without];
      });
    } catch (e) {
      // Surface it — a silently-failing Save button is worse than an error.
      setSaveError(e.message || "Couldn't save. Please try again.");
    } finally {
      setSavingKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const removeItem = useCallback(async (row) => {
    const key = `${row.name}|${row.url || ""}`;
    setSavingKey(key);
    setSaveError("");
    try {
      const res = await fetch(`${API_BASE}/api/scholarships/saved/${row.id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail || `Couldn't remove (error ${res.status}).`);
      }
      setSaved((prev) => prev.filter((s) => s.id !== row.id));
      setOpenId((cur) => (cur === row.id ? null : cur)); // close detail if it was open
    } catch (e) {
      setSaveError(e.message || "Couldn't remove. Please try again.");
    } finally {
      setSavingKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Merge a server-updated row (from status change or checklist edit) into the
  // saved list, so the card's progress bar and the detail view stay in sync.
  const mergeSaved = useCallback((row) => {
    setSaved((prev) => prev.map((s) => (s.id === row.id ? { ...s, ...row } : s)));
  }, []);

  const setStatus = useCallback(async (row, status) => {
    setSavingKey(`${row.name}|${row.url || ""}`);
    // Optimistic: reflect the choice immediately, roll back on failure.
    setSaved((prev) => prev.map((s) => (s.id === row.id ? { ...s, status } : s)));
    try {
      const res = await fetch(`${API_BASE}/api/scholarships/saved/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSaved((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        loadSaved(); // resync from the server on rejection
      }
    } catch {
      loadSaved();
    } finally {
      setSavingKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loadSaved]);

  const total = result?.total ?? 0;
  const inFlight = (item) => savingKey === `${item.name}|${item.url || ""}`;
  // The saved item currently open in the detail view (if any). Derived so it
  // always reflects the latest saved data (progress, status).
  const openItem = openId != null ? saved.find((s) => s.id === openId) : null;
  const showDetail = tab === "saved" && openItem;

  return (
    <div className="sch-page">
      <header className="sch-header">
        <h1>
          <FaGraduationCap /> Scholarships &amp; Internships
        </h1>
        <p className="sch-sub">
          Matched against your DegreeWorks data, so you only see what you can actually
          apply for. Save the ones you want and track them as you apply.
        </p>
      </header>

      {/* Tabs hide while a detail view is open; the detail has its own back link. */}
      {!showDetail && (
        <div className="sch-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "search"}
            className={`sch-tab ${tab === "search" ? "is-active" : ""}`}
            onClick={() => setTab("search")}
          >
            <FaSearch size={12} /> Search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "saved"}
            className={`sch-tab ${tab === "saved" ? "is-active" : ""}`}
            onClick={() => setTab("saved")}
          >
            <FaBookmark size={12} /> My Scholarships
            {saved.length > 0 && <span className="sch-tab-count">{saved.length}</span>}
          </button>
        </div>
      )}

      {saveError && (
        <div className="sch-notice sch-notice-error" role="alert">{saveError}</div>
      )}

      {tab === "search" ? (
        <>
          {configured === false && (
            <div className="sch-notice">
              Showing our curated list of top scholarships and internships. Live web
              search isn&apos;t set up yet, but these are the awards worth applying to.
            </div>
          )}

          <form className="sch-search" onSubmit={onSubmit}>
            <input
              type="text"
              className="sch-input"
              placeholder="What are you looking for? e.g. summer internships for juniors"
              value={query}
              maxLength={500}
              disabled={busy}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="sch-btn" disabled={busy}>
              <FaSearch size={13} /> {busy ? "Searching…" : "Search"}
            </button>
          </form>

          {!result && !busy && (
            <div className="sch-examples">
              <span className="sch-examples-label">Try:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="sch-chip"
                  onClick={() => { setQuery(ex); search(ex); }}
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {busy && (
            <p className="sch-status">Searching for opportunities that match your profile…</p>
          )}

          {error && <div className="sch-notice sch-notice-error">{error}</div>}

          {result && (
            <>
              {result.has_degreeworks === false && (
                <div className="sch-notice">
                  Connect DegreeWorks in your profile to get results filtered by your GPA,
                  major and class year.
                </div>
              )}

              {total === 0 && !error && (
                <p className="sch-status">
                  {result.note || "No matching opportunities came back. Try a different search."}
                </p>
              )}

              {total > 0 && (
                <>
                  {GROUPS.map(({ key, label, hint }) => {
                    const items = result.groups?.[key] || [];
                    if (!items.length) return null;
                    return (
                      <section className="sch-group" key={key}>
                        <h2 className={`sch-group-head sch-group-${key.toLowerCase()}`}>
                          {label} <span className="sch-group-hint">{hint}</span>
                        </h2>
                        <ul className="sch-list">
                          {items.map((item, i) => (
                            <OpportunityCard
                              key={`${item.name}-${i}`}
                              item={item}
                              saved={findSaved(saved, item)}
                              onSave={saveItem}
                              onRemove={removeItem}
                              saving={inFlight(item)}
                            />
                          ))}
                        </ul>
                      </section>
                    );
                  })}

                  {result.note && <p className="sch-note">{result.note}</p>}

                  {result.sources?.length > 0 && (
                    <details className="sch-sources">
                      <summary>Where these came from ({result.sources.length} sources)</summary>
                      <ul>
                        {result.sources.map((s) => (
                          <li key={s.url}>
                            <a href={s.url} target="_blank" rel="noopener noreferrer">
                              {s.title || s.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </>
          )}
        </>
      ) : openItem ? (
        <ScholarshipDetail
          item={openItem}
          onBack={() => setOpenId(null)}
          onSaved={mergeSaved}
        />
      ) : (
        <SavedView
          saved={saved}
          onStatus={setStatus}
          onRemove={removeItem}
          onOpen={(row) => setOpenId(row.id)}
          inFlight={inFlight}
          onGoSearch={() => setTab("search")}
        />
      )}
    </div>
  );
}

// The sort options for the saved list. "deadline" leans on days_remaining (which
// the backend recomputes on load); undated items sink. "recommended" floats the
// curated picks; "name" is a plain A–Z.
const SORTS = [
  { key: "deadline", label: "Deadline (soonest)" },
  { key: "recommended", label: "Recommended first" },
  { key: "name", label: "Name (A–Z)" },
];

function sortSaved(items, sort) {
  const copy = [...items];
  if (sort === "name") {
    copy.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  } else if (sort === "recommended") {
    copy.sort((a, b) => (b.curated ? 1 : 0) - (a.curated ? 1 : 0));
  } else {
    // deadline: dated first (soonest), undated last
    copy.sort((a, b) => {
      const da = a.days_remaining, db = b.days_remaining;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }
  return copy;
}

// The "My Scholarships" tab. Scholarships and internships are split into their own
// sections because they are different objects (an internship has no award amount).
// A filter/sort bar sits on top so a student with many saved items can slice them.
function SavedView({ saved, onStatus, onRemove, onOpen, inFlight, onGoSearch }) {
  const [kind, setKind] = useState("all");        // all | scholarship | internship
  const [status, setStatus] = useState("all");    // all | <a pipeline status>
  const [sort, setSort] = useState("deadline");

  if (!saved.length) {
    return (
      <div className="sch-empty">
        <FaBookmark size={26} />
        <p>You haven&apos;t saved anything yet.</p>
        <p className="sch-empty-sub">
          Search for opportunities, then tap <strong>Save</strong> to keep track of the
          ones you want to apply for.
        </p>
        <button type="button" className="sch-btn" onClick={onGoSearch}>
          <FaSearch size={13} /> Find opportunities
        </button>
      </div>
    );
  }

  // Apply the status filter (kind is handled per-section below).
  const afterStatus = status === "all"
    ? saved
    : saved.filter((s) => s.status === status);

  const scholarships = sortSaved(afterStatus.filter((s) => s.kind !== "internship"), sort);
  const internships = sortSaved(afterStatus.filter((s) => s.kind === "internship"), sort);

  const showScholarships = kind !== "internship";
  const showInternships = kind !== "scholarship";
  const nothingMatches =
    (!showScholarships || !scholarships.length) &&
    (!showInternships || !internships.length);

  const renderSection = (label, items) =>
    items.length > 0 && (
      <section className="sch-group">
        <h2 className="sch-group-head">
          {label} <span className="sch-group-hint">{items.length}</span>
        </h2>
        <ul className="sch-list">
          {items.map((item) => (
            <SavedCard
              key={item.id}
              item={item}
              onStatus={onStatus}
              onRemove={onRemove}
              onOpen={onOpen}
              busy={inFlight(item)}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <>
      <div className="sch-toolbar">
        <label className="sch-toolbar-field">
          <span>Show</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All</option>
            <option value="scholarship">Scholarships</option>
            <option value="internship">Internships</option>
          </select>
        </label>
        <label className="sch-toolbar-field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Any</option>
            {STATUSES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="sch-toolbar-field">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      {nothingMatches ? (
        <p className="sch-status">Nothing matches those filters. Try widening them.</p>
      ) : (
        <>
          {showScholarships && renderSection("Scholarships", scholarships)}
          {showInternships && renderSection("Internships", internships)}
        </>
      )}
    </>
  );
}
