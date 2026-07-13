import { useState, useEffect, useCallback } from "react";
import { FaGraduationCap } from "@react-icons/all-files/fa/FaGraduationCap";
import { FaExternalLinkAlt } from "@react-icons/all-files/fa/FaExternalLinkAlt";
import { FaSearch } from "@react-icons/all-files/fa/FaSearch";
import { getApiBase } from "../../lib/apiBase";
import "./ScholarshipsPage.css";

const API_BASE = getApiBase();

// The three urgency buckets the backend returns, in the order students should read
// them: what closes first comes first.
const GROUPS = [
  { key: "URGENT", label: "Closing soon", hint: "Less than 7 days left" },
  { key: "UPCOMING", label: "Coming up", hint: "Less than 30 days left" },
  { key: "OPEN", label: "Open", hint: "More than 30 days out, or rolling" },
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
  return `${d} days left`;
}

function OpportunityCard({ item }) {
  const days = daysLabel(item);
  const hasLink = item.url && item.url !== "(not listed)";

  return (
    <li className="sch-card">
      <div className="sch-card-head">
        <h3 className="sch-card-name">{item.name}</h3>
        {item.kind && <span className={`sch-kind sch-kind-${item.kind}`}>{item.kind}</span>}
      </div>

      {item.award && item.award !== "(not listed)" && (
        <p className="sch-award">{item.award}</p>
      )}
      {item.why && <p className="sch-why">{item.why}</p>}

      <dl className="sch-meta">
        {item.eligibility && (
          <div>
            <dt>Eligibility</dt>
            <dd>{item.eligibility}</dd>
          </div>
        )}
        <div>
          <dt>Deadline</dt>
          <dd>
            {item.deadline && item.deadline !== "(not listed)" ? item.deadline : "Not listed"}
            {days && <span className="sch-days"> · {days}</span>}
          </dd>
        </div>
      </dl>

      {hasLink && (
        <a className="sch-apply" href={item.url} target="_blank" rel="noopener noreferrer">
          How to apply <FaExternalLinkAlt size={11} />
        </a>
      )}
    </li>
  );
}

export default function ScholarshipsPage() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  // null = still checking; false = the backend has no TAVILY_API_KEY.
  const [configured, setConfigured] = useState(null);

  const token = localStorage.getItem("token");

  // Ask up front whether search is even usable, so we can explain rather than
  // let the student type a query and hit a 503.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/scholarships/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = res.ok ? await res.json() : { configured: false };
        if (!cancelled) setConfigured(Boolean(data.configured));
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const search = useCallback(async (q) => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/scholarships/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
  }, [token]);

  const onSubmit = (e) => {
    e.preventDefault();
    if (!busy) search(query);
  };

  const total = result?.total ?? 0;

  return (
    <div className="sch-page">
      <header className="sch-header">
        <h1>
          <FaGraduationCap /> Scholarships &amp; Internships
        </h1>
        <p className="sch-sub">
          Matched against your DegreeWorks data, so you only see what you can actually
          apply for. Expired deadlines are filtered out.
        </p>
      </header>

      {configured === false && (
        <div className="sch-notice sch-notice-warn">
          Scholarship search isn&apos;t set up yet. An admin needs to add a Tavily API
          key before this page can return results.
        </div>
      )}

      <form className="sch-search" onSubmit={onSubmit}>
        <input
          type="text"
          className="sch-input"
          placeholder="What are you looking for? e.g. summer internships for juniors"
          value={query}
          maxLength={500}
          disabled={busy || configured === false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          className="sch-btn"
          disabled={busy || configured === false}
        >
          <FaSearch size={13} /> {busy ? "Searching…" : "Search"}
        </button>
      </form>

      {!result && !busy && configured !== false && (
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
                        <OpportunityCard key={`${item.name}-${i}`} item={item} />
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
    </div>
  );
}
