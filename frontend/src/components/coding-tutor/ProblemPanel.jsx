export default function ProblemPanel({
  problem,
  solution,
  problemLoading,
  isSolved = false,
  solvedLanguages = [],
  showProblemNavigation = false,
  canGoPrevious = false,
  canGoNext = false,
  onPreviousProblem,
  onNextProblem,
  onOpenQuizBank,
  mockMode = false,
  solutionUnlocked = true,
  onStuck,
  onViewSolutionMock,
}) {
  return (
    <aside className={`coding-problem-panel ${mockMode ? "is-mock" : ""}`}>
      {problemLoading ? <div className="coding-problem-empty">Loading problem...</div> : problem ? (
        <div className="coding-problem-content">
          {mockMode && (
            <div className="mock-rules">
              <strong>Mock Interview Mode</strong>
              <span>Try first. Use hints sparingly. Review after the round.</span>
              <span className="mock-rules-note">🔒 Your language locks once you start coding — like a real interview.</span>
            </div>
          )}
          <div className="daily-challenge-title-row">
            <h2>{problem.title}</h2>
            <span className="problem-meta-pills">
              <span className={`daily-difficulty ${String(problem.difficulty || "easy").toLowerCase()}`}>{problem.difficulty}</span>
              {isSolved && (
                <span
                  className="problem-solved-badge"
                  title={solvedLanguages.length ? `Solved in ${solvedLanguages.join(", ")}` : "You have solved this problem"}
                >
                  Solved
                </span>
              )}
            </span>
          </div>
          <div className="daily-tags">
            <span>{problem.topic}</span>
            {solution?.function_name && <span>{solution.function_name}</span>}
          </div>
          {showProblemNavigation && (
            <div className="problem-navigation">
              <button type="button" onClick={onPreviousProblem} disabled={!canGoPrevious} title="Previous unsolved problem (solved problems are skipped)">Back</button>
              <button type="button" onClick={onNextProblem} disabled={!canGoNext} title="Next unsolved problem (solved problems are skipped)">Next</button>
            </div>
          )}
          <p>{problem.prompt}</p>
          {(solution?.starter_guidance || solution?.guided_steps?.length > 0) && (
            <section className="starter-guidance-panel">
              <h3>Starter Guidance</h3>
              {solution?.starter_guidance && <p>{solution.starter_guidance}</p>}
              {solution?.guided_steps?.length > 0 && (
                <ul>{solution.guided_steps.slice(0, 3).map((step, index) => <li key={index}>{step}</li>)}</ul>
              )}
            </section>
          )}
          {/* In mock mode, collapse examples into a <details> so code space wins;
              normal mode shows them expanded. */}
          {problem.examples?.length > 0 && (
            mockMode ? (
              <details className="problem-examples-compact">
                <summary>Examples ({problem.examples.length})</summary>
                {problem.examples.map((example, index) => (
                  <div className="problem-example" key={index}>
                    <code>Input: {example.input}</code>
                    <code>Output: {example.output}</code>
                  </div>
                ))}
              </details>
            ) : (
              <section>
                <h3>Examples</h3>
                {problem.examples.map((example, index) => (
                  <div className="problem-example" key={index}>
                    <code>Input: {example.input}</code>
                    <code>Output: {example.output}</code>
                  </div>
                ))}
              </section>
            )
          )}
          {problem.constraints?.length > 0 && !mockMode && (
            <section className="problem-constraints-card">
              <h3>Constraints</h3>
              <ul>{problem.constraints.map((constraint, index) => <li key={index}>{constraint}</li>)}</ul>
            </section>
          )}
          {/* Interview-prep problems are not auto-graded; the worked answer lives
              on an external page. In mock mode it stays locked until the student
              attempts the problem or clicks "I'm stuck", to keep the simulation honest. */}
          {problem.answer_url && (
            !solutionUnlocked ? (
              <button type="button" className="problem-solution-locked" onClick={onStuck}>
                I&apos;m stuck — reveal solution
              </button>
            ) : mockMode ? (
              // In mock mode, viewing the solution ends the round — route through a
              // confirm instead of opening the link directly.
              <button
                type="button"
                className="problem-solution-link"
                onClick={() => onViewSolutionMock?.(problem.answer_url)}
              >
                {problem.answer_kind === "video" ? "Watch the solution walkthrough" : "View the worked solution"} ↗
              </button>
            ) : (
              <a
                className="problem-solution-link"
                href={problem.answer_url}
                target="_blank"
                rel="noreferrer"
              >
                {problem.answer_kind === "video" ? "Watch the solution walkthrough" : "View the worked solution"} ↗
              </a>
            )
          )}
        </div>
      ) : (
        <div className="coding-problem-empty">
          <h2>No problem loaded</h2>
          <p>Open the Practice Library for a graded problem, or write your own code and press Run.</p>
          <button type="button" onClick={onOpenQuizBank}>Open Practice Library</button>
        </div>
      )}
    </aside>
  );
}

