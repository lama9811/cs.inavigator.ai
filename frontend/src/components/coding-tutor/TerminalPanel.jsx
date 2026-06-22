function statusLabel(status) {
  if (status === "passed") return "Passed";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  if (status === "error") return "Error";
  if (status === "ran") return "Done";
  return "Ready";
}

function formatValue(value) {
  if (typeof value === "undefined") return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function TerminalOutputPane({ output, tests, onExplainError }) {
  const capturedOutput = [output.stdout, output.stderr].filter(Boolean).join("\n");
  const hasRunResults = ["passed", "failed", "error"].includes(output.status) && tests.length > 0;
  const returnOutput = hasRunResults
    ? tests.map((test) => {
        if (test.error) return test.error;
        return formatValue(test.actual);
      }).join("\n")
    : "";
  // An actual crash/runtime/syntax error: status "error" or stderr present.
  const hasError = output.status === "error" || Boolean(output.stderr);

  return (
    <section className="terminal-panel-output" aria-label="Terminal output">
      <div className="terminal-panel-heading">
        <span>Output</span>
        {hasError && onExplainError && (
          <button type="button" className="terminal-explain-btn" onClick={onExplainError}>
            Explain this error
          </button>
        )}
      </div>
      {capturedOutput ? (
        <>
          <span className="terminal-output-kind">Program output</span>
          <pre>{capturedOutput}</pre>
        </>
      ) : returnOutput ? (
        <>
          <span className="terminal-output-kind">Return value</span>
          <pre>{returnOutput}</pre>
        </>
      ) : (
        <div className="terminal-panel-empty">
          Terminal output is empty. Return values will appear here after a run, and print / console output will appear here when your code writes it.
        </div>
      )}
    </section>
  );
}

function TerminalTestsPane({ output, tests, onExplainFailedTests }) {
  const hasSummary = typeof output.passed === "number" && typeof output.total === "number";
  const hasFailedTests = tests.some(test => !test.passed);
  const checklist = Array.isArray(output.quality_checklist) ? output.quality_checklist : [];

  if (output.free_run) {
    return (
      <section className="terminal-panel-tests" aria-label="Run summary">
        <div className="terminal-panel-heading">
          <span>Run</span>
          {typeof output.duration_ms === "number" && <em>{Math.round(output.duration_ms)} ms</em>}
        </div>
        {output.message && <p className="terminal-panel-message">{output.message}</p>}
        <p className="terminal-panel-message">Personal code runs are not auto-graded. Use the floating Coding Tutor for review or hints.</p>
      </section>
    );
  }

  return (
    <section className="terminal-panel-tests" aria-label="Test cases">
      <div className="terminal-panel-heading">
        <span>Tests</span>
        {hasSummary && (
          <strong>
            {output.passed}/{output.total} passed
          </strong>
        )}
        {typeof output.duration_ms === "number" && <em>{Math.round(output.duration_ms)} ms</em>}
        {hasFailedTests && onExplainFailedTests && (
          <button type="button" className="terminal-explain-btn" onClick={onExplainFailedTests}>
            Explain failed tests
          </button>
        )}
      </div>
      {output.message && <p className="terminal-panel-message">{output.message}</p>}
      {checklist.length > 0 && (
        <div className="terminal-quality-checklist">
          <strong>Code quality checklist</strong>
          <ul>{checklist.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      )}
      {tests.length > 0 ? (
        <div className="terminal-panel-test-list">
          {tests.map((test, index) => (
            <article key={`${test.name || "test"}-${index}`} className={`terminal-panel-test ${test.passed ? "passed" : "failed"}`}>
              <span>{test.passed ? "PASS" : "FAIL"}</span>
              <div className="terminal-panel-test-detail">
                <strong>{test.name || `Test ${index + 1}`}</strong>
                <code>Input: {formatValue(test.args)}</code>
                <code>Expected: {formatValue(test.expected)}</code>
                <code>Actual: {formatValue(test.actual)}</code>
                {test.error && <small>{test.error}</small>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="terminal-panel-empty">
          Test cases will appear here after you run a local practice problem.
        </div>
      )}
    </section>
  );
}

export default function TerminalPanel({ testOutput, expanded = false, onClose, onExplainFailedTests, onExplainError }) {
  const output = typeof testOutput === "string" ? { status: "ready", message: testOutput } : (testOutput || {});
  const tests = output.tests || [];

  return (
    <div className={`coding-terminal terminal-panel ${expanded ? "expanded" : ""}`} aria-live="polite">
      <div className="coding-terminal-header">
        <div className="coding-terminal-tabs" aria-label="Workspace panel tabs">
          <span className="active">Terminal</span>
        </div>
        <div className="coding-terminal-controls">
          <span className={`terminal-status ${output.status || "ready"}`}>{statusLabel(output.status)}</span>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close terminal" title="Close terminal">
              x
            </button>
          )}
        </div>
      </div>
      <div className="terminal-panel-body">
        <TerminalOutputPane output={output} tests={tests} onExplainError={onExplainError} />
        <TerminalTestsPane output={output} tests={tests} onExplainFailedTests={onExplainFailedTests} />
      </div>
    </div>
  );
}
