import { useState } from "react";
import { FaStop } from "react-icons/fa";

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

// A single test case in the explorer. Failing cases start open; passing cases
// start collapsed so the student focuses on what went wrong first.
function TestCaseRow({ test, index, onAsk }) {
  const [open, setOpen] = useState(!test.passed);
  // On a re-run a case can flip pass<->fail. Re-derive the default open state
  // (failing = open, passing = collapsed) when that happens, so a case that now
  // fails reopens instead of staying stuck in its previous state. Adjusting state
  // during render on a changed input avoids an extra render pass (React's
  // recommended pattern over a useEffect for this).
  const [prevPassed, setPrevPassed] = useState(test.passed);
  if (prevPassed !== test.passed) {
    setPrevPassed(test.passed);
    setOpen(!test.passed);
  }
  const label = test.name || `Test ${index + 1}`;
  return (
    <article className={`terminal-panel-test ${test.passed ? "passed" : "failed"} ${open ? "open" : ""}`}>
      <button
        type="button"
        className="terminal-panel-test-summary"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
      >
        <span className="terminal-panel-test-status">{test.passed ? "PASS" : "FAIL"}</span>
        <strong>{label}</strong>
        <span className="terminal-panel-test-caret" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="terminal-panel-test-detail">
          <code>Input: {formatValue(test.args)}</code>
          <code>Expected: {formatValue(test.expected)}</code>
          <code className={test.passed ? "" : "terminal-actual-bad"}>Actual: {formatValue(test.actual)}</code>
          {test.error && <small>{test.error}</small>}
          {!test.passed && onAsk && (
            <button type="button" className="terminal-ask-case-btn" onClick={() => onAsk(test, index)}>
              Ask the tutor about this case
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function TerminalTestsPane({ output, tests, onExplainFailedTests, onRequestReview, onExplainOneTest }) {
  const hasSummary = typeof output.passed === "number" && typeof output.total === "number";
  const hasFailedTests = tests.some(test => !test.passed);

  if (output.free_run) {
    return (
      <section className="terminal-panel-tests" aria-label="Run summary">
        <div className="terminal-panel-heading">
          <span>Run</span>
          {typeof output.duration_ms === "number" && <em>{Math.round(output.duration_ms)} ms</em>}
          {onRequestReview && (
            <button type="button" className="terminal-explain-btn" onClick={onRequestReview}>
              Ask for a review
            </button>
          )}
        </div>
        {output.message && <p className="terminal-panel-message">{output.message}</p>}
        <p className="terminal-panel-message">
          {onRequestReview
            ? "Personal code runs are not auto-graded. Use the floating Coding Tutor for review or hints."
            : "This run isn't auto-graded. Interview questions are graded after the mock — open View solution for the walkthrough."}
        </p>
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
        {!hasFailedTests && onRequestReview && (
          <button type="button" className="terminal-explain-btn" onClick={onRequestReview}>
            Ask for a review
          </button>
        )}
      </div>
      {output.message && <p className="terminal-panel-message">{output.message}</p>}
      {tests.length > 0 ? (
        <div className="terminal-panel-test-list">
          {tests
            // Keep original index for stable labels/keys, then surface failing
            // cases first so the student sees what to fix without scrolling.
            .map((test, index) => ({ test, index }))
            .sort((a, b) => Number(a.test.passed) - Number(b.test.passed))
            .map(({ test, index }) => (
              <TestCaseRow
                key={`${test.name || "test"}-${index}`}
                test={test}
                index={index}
                onAsk={onExplainOneTest}
              />
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

export default function TerminalPanel({
  testOutput,
  isRunning = false,
  expanded = false,
  onClose,
  onStop,
  onExplainFailedTests,
  onExplainError,
  onExplainOneTest,
  onRequestReview,
}) {
  const output = typeof testOutput === "string" ? { status: "ready", message: testOutput } : (testOutput || {});
  const tests = output.tests || [];
  const running = isRunning || output.status === "running";

  return (
    <div className={`coding-terminal terminal-panel ${expanded ? "expanded" : ""}`} aria-live="polite">
      <div className="coding-terminal-header">
        <div className="coding-terminal-tabs" aria-label="Workspace panel tabs">
          <span className="active">Terminal</span>
        </div>
        <div className="coding-terminal-controls">
          <span className={`terminal-status ${output.status || "ready"}`}>{statusLabel(output.status)}</span>
          {running && onStop && (
            <button
              type="button"
              className="terminal-stop-btn"
              onClick={onStop}
              aria-label="Stop running"
              title="Stop (use if the run is stuck or looping)"
            >
              <FaStop aria-hidden="true" />
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close terminal" title="Close terminal">
              x
            </button>
          )}
        </div>
      </div>
      <div className="terminal-panel-body">
        <TerminalOutputPane output={output} tests={tests} onExplainError={onExplainError} />
        <TerminalTestsPane
          output={output}
          tests={tests}
          onExplainFailedTests={onExplainFailedTests}
          onRequestReview={onRequestReview}
          onExplainOneTest={onExplainOneTest}
        />
      </div>
    </div>
  );
}
