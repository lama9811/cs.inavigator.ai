import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function HintPanel({ hints, revealedHints, onShowHint, onShowAllHints, codeRenderer }) {
  const totalHints = Array.isArray(hints) ? hints.length : 0;
  const unlockedHints = Array.isArray(hints) ? hints.filter(hint => !hint.locked).length : 0;
  const nextHintNumber = Math.min(revealedHints + 1, Math.max(unlockedHints, 1));
  const allAvailableShown = unlockedHints > 0 && revealedHints >= unlockedHints;

  return (
    <div className="workspace-hints-panel">
      <div className="daily-actions">
        <button
          type="button"
          className="daily-practice-btn secondary"
          onClick={onShowHint}
          disabled={!unlockedHints || allAvailableShown}
        >
          {!totalHints
            ? "No hints available"
            : !unlockedHints
            ? "No hints unlocked yet"
            : allAvailableShown
            ? `All available hints shown (${revealedHints} of ${totalHints})`
            : `Show hint ${nextHintNumber} of ${totalHints}`}
        </button>
        <button
          type="button"
          className="daily-practice-btn secondary"
          onClick={onShowAllHints}
          disabled={!unlockedHints || allAvailableShown}
        >
          Show available hints
        </button>
      </div>
      {revealedHints > 0 ? (
        <ol>
          {hints.slice(0, revealedHints).map(hint => (
            <li key={hint.level}>
              <strong>{hint.title}:</strong>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: codeRenderer }}>
                {hint.body}
              </ReactMarkdown>
            </li>
          ))}
        </ol>
      ) : <p>Hints unlock one step at a time. Start with the question check, then run your code to unlock deeper guidance.</p>}
    </div>
  );
}
