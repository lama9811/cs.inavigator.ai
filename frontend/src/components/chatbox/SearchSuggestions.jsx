import DOMPurify from "dompurify";
import "./SearchSuggestions.css";

/**
 * Renders Google Search grounding attribution under a General-mode answer.
 *
 * Google's Terms require displaying the Search Suggestions ("searchEntryPoint")
 * on any response grounded with Google Search. The HTML is Google-provided, but
 * it still flows through dangerouslySetInnerHTML, so we sanitize it with
 * DOMPurify and scope it inside `.search-suggestions` so Google's injected
 * styles can't leak into the rest of the app.
 */
export default function SearchSuggestions({ grounding }) {
  if (!grounding) return null;

  const { searchEntryPoint, sources = [] } = grounding;
  const cleanChips = searchEntryPoint
    ? DOMPurify.sanitize(searchEntryPoint, { USE_PROFILES: { html: true } })
    : "";

  if (!cleanChips && sources.length === 0) return null;

  return (
    <div className="search-suggestions">
      {cleanChips && (
        <div
          className="search-suggestions-chips"
          dangerouslySetInnerHTML={{ __html: cleanChips }}
        />
      )}
      {sources.length > 0 && (
        <div className="search-suggestions-sources">
          <span className="search-suggestions-label">Sources</span>
          <ul>
            {sources.map((s, i) => (
              <li key={i}>
                <a href={s.uri} target="_blank" rel="noopener noreferrer">
                  {s.title || s.uri}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
