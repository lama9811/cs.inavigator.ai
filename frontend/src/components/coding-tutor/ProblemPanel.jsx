export default function ProblemPanel({ problem, solution, attempts, problemLoading, onShowHint, onShowAllHints, onOpenQuizBank }) {
  return (
    <aside className="coding-problem-panel">
      {problemLoading ? <div className="coding-problem-empty">Loading problem...</div> : problem ? (
        <div className="coding-problem-content">
          <div className="daily-challenge-title-row">
            <h2>{problem.title}</h2>
            <span className={`daily-difficulty ${String(problem.difficulty || "easy").toLowerCase()}`}>{problem.difficulty}</span>
          </div>
          <div className="daily-tags">
            <span>{problem.topic}</span>
            {solution?.function_name && <span>{solution.function_name}</span>}
            <span>{attempts} attempts</span>
          </div>
          <p>{problem.prompt}</p>
          {problem.examples?.length > 0 && (
            <section>
              <h3>Examples</h3>
              {problem.examples.map((example, index) => (
                <div className="problem-example" key={index}>
                  <code>Input: {example.input}</code>
                  <code>Output: {example.output}</code>
                </div>
              ))}
            </section>
          )}
          {problem.constraints?.length > 0 && (
            <section>
              <h3>Constraints</h3>
              <ul>{problem.constraints.map((constraint, index) => <li key={index}>{constraint}</li>)}</ul>
            </section>
          )}
          <div className="daily-actions">
            <button type="button" className="daily-practice-btn secondary" onClick={onShowHint}>Show Hint</button>
            <button type="button" className="daily-practice-btn secondary" onClick={onShowAllHints}>Show All</button>
          </div>
        </div>
      ) : (
        <div className="coding-problem-empty">
          <h2>No problem loaded</h2>
          <p>Open Quiz Bank or Daily Challenge to start working.</p>
          <button type="button" onClick={onOpenQuizBank}>Open Quiz Bank</button>
        </div>
      )}
    </aside>
  );
}
