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

function normalizeDiffLines(value = "") {
  return String(value).replace(/\r\n/g, "\n").replace(/\s+$/g, "").split("\n");
}

function buildLineDiff(studentCode = "", referenceCode = "") {
  const student = normalizeDiffLines(studentCode);
  const reference = normalizeDiffLines(referenceCode);
  const rows = Array.from({ length: student.length + 1 }, () =>
    Array(reference.length + 1).fill(0)
  );

  for (let i = student.length - 1; i >= 0; i -= 1) {
    for (let j = reference.length - 1; j >= 0; j -= 1) {
      rows[i][j] = student[i] === reference[j]
        ? rows[i + 1][j + 1] + 1
        : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }

  const diff = [];
  let i = 0;
  let j = 0;
  while (i < student.length && j < reference.length) {
    if (student[i] === reference[j]) {
      diff.push({ type: "same", text: student[i] || " " });
      i += 1;
      j += 1;
    } else if (rows[i + 1][j] >= rows[i][j + 1]) {
      diff.push({ type: "removed", text: student[i] || " " });
      i += 1;
    } else {
      diff.push({ type: "added", text: reference[j] || " " });
      j += 1;
    }
  }
  while (i < student.length) {
    diff.push({ type: "removed", text: student[i] || " " });
    i += 1;
  }
  while (j < reference.length) {
    diff.push({ type: "added", text: reference[j] || " " });
    j += 1;
  }
  return diff;
}

function includesAny(text = "", terms = []) {
  const haystack = String(text).toLowerCase();
  return terms.some(term => haystack.includes(term));
}

function buildSolutionInsights(studentCode = "", referenceCode = "", diffLines = []) {
  const student = String(studentCode || "");
  const reference = String(referenceCode || "");
  if (!student.trim() || !reference.trim()) return [];

  const added = diffLines.filter(line => line.type === "added").length;
  const removed = diffLines.filter(line => line.type === "removed").length;
  const same = diffLines.filter(line => line.type === "same").length;
  const insights = [];

  if (added === 0 && removed === 0 && same > 0) {
    insights.push("Your solution is very close to the reference structure, so focus on naming, clarity, and edge-case confidence.");
  } else if (added > removed + 2) {
    insights.push("The reference breaks the idea into more explicit steps. Compare whether those extra steps make state changes easier to follow.");
  } else if (removed > added + 2) {
    insights.push("Your passing solution is more compact than the reference. Compact is fine, but make sure each edge case is still easy to explain.");
  } else {
    insights.push("Both versions pass the authored tests, but they organize the same idea differently. Use the diff to compare the main decisions, not to copy line for line.");
  }

  const patterns = [
    { label: "a stack", terms: ["stack", ".push", "push_back", "append(", ".pop", "pop("] },
    { label: "a queue/front-of-line state", terms: ["queue", "deque", "shift(", "poll(", "front"] },
    { label: "a set or map for remembering seen values", terms: ["set(", "hashset", "map<", "hashmap", "dict", "seen"] },
    { label: "two pointers", terms: ["left", "right", "lo", "hi"] },
    { label: "a sliding window", terms: ["window", "left", "right", "sum"] },
    { label: "a recursive base case", terms: ["recursive", "return 1", "return 0", "base case"] },
    { label: "tree index math", terms: ["2 *", "2*", "left child", "right child"] },
    { label: "linked-list traversal state", terms: ["nextindexes", "next_indexes", "head", "cur", "current"] },
  ];

  const difference = patterns.find(pattern =>
    includesAny(reference, pattern.terms) && !includesAny(student, pattern.terms)
  );
  if (difference) {
    insights.push(`The reference makes ${difference.label} explicit. If your code uses a different shape, check that it is tracking the same information.`);
  }

  if (/\breturn\b/.test(reference) && !/\breturn\b/.test(student)) {
    insights.push("The reference returns the final value directly. If your code relies on printing, switch to returning for the grader.");
  }

  return insights.slice(0, 3);
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
          No output yet.
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

function SolutionReview({ review }) {
  const [open, setOpen] = useState(false);
  if (!review?.studentCode || !review?.reference) return null;

  const referenceLooksLikeCode = /\n|\b(def|class|function|return)\b|[{};]/.test(review.reference);
  const diffLines = referenceLooksLikeCode
    ? buildLineDiff(review.studentCode, review.reference)
    : [];
  const insights = buildSolutionInsights(review.studentCode, review.reference, diffLines);
  return (
    <section className="terminal-solution-review">
      <button
        type="button"
        className="terminal-solution-review-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <strong>Review your passing solution</strong>
          <small>Compare your work with one reference approach.</small>
        </span>
        <span aria-hidden="true">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="terminal-solution-review-body">
          <p>
            Your code passed the authored tests. The reference is another approach,
            not the only correct answer.
          </p>
          {insights.length ? (
            <div className="terminal-solution-insights" aria-label="Tutor explanation of solution differences">
              <span>Tutor notes</span>
              <ul>
                {insights.map((insight, index) => (
                  <li key={`${index}-${insight}`}>{insight}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {diffLines.length ? (
            <div className="terminal-solution-diff" aria-label="Line-by-line solution diff">
              <div className="terminal-solution-diff-head">
                <span>Diff</span>
                <small>
                  <strong>-</strong> your line
                  <strong>+</strong> reference line
                </small>
              </div>
              <pre>
                {diffLines.map((line, index) => (
                  <code key={`${line.type}-${index}`} className={`diff-line ${line.type}`}>
                    <span aria-hidden="true">
                      {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                    </span>
                    {line.text}
                  </code>
                ))}
              </pre>
            </div>
          ) : null}
          <div className="terminal-solution-columns">
            <div>
              <span>Your solution</span>
              <pre><code>{review.studentCode}</code></pre>
            </div>
            <div>
              <span>Reference approach</span>
              {referenceLooksLikeCode
                ? <pre><code>{review.reference}</code></pre>
                : <p className="terminal-reference-note">{review.reference}</p>}
            </div>
          </div>
          {review.complexity ? (
            <p className="terminal-complexity-note"><strong>Complexity:</strong> {review.complexity}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TerminalTestsPane({ output, tests, onExplainFailedTests, onRequestReview, onExplainOneTest, solutionReview }) {
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
          Run code to see tests.
        </div>
      )}
      {output.status === "passed" ? <SolutionReview review={solutionReview} /> : null}
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
  solutionReview,
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
          solutionReview={solutionReview}
        />
      </div>
    </div>
  );
}
