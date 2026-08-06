import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeEditor from "./CodeEditor";
import HintPanel from "./HintPanel";
import RunControls from "./RunControls";
import TerminalPanel from "./TerminalPanel";
import { WorkspaceVisualizerModal, WorkspaceVisualizerPanel } from "./WorkspaceVisualizer";
import { handleHorizontalRovingKeyDown } from "./keyboardNavigation";
import useFocusTrap from "./useFocusTrap";
import { FaTimes } from "react-icons/fa";
import "./CodeWorkspace.css";
import "./TerminalPanel.css";

const WORKSPACE_TABS = ["Editor", "Hints", "Discussion", "Visualize"];
const PYTHON_TRACE_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "break",
  "class",
  "continue",
  "def",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);

// Docked-terminal height bounds (px). The drag handle clamps within this range.
const TERMINAL_MIN_H = 140;
const TERMINAL_MAX_H = 560;
const TERMINAL_DEFAULT_H = 240;
const TERMINAL_H_KEY = "csnav.terminalHeight";

function readStoredTerminalHeight() {
  try {
    const raw = window.localStorage.getItem(TERMINAL_H_KEY);
    const value = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(value)) {
      return Math.min(TERMINAL_MAX_H, Math.max(TERMINAL_MIN_H, value));
    }
  } catch {
    /* ignore storage errors */
  }
  return TERMINAL_DEFAULT_H;
}

function parseTraceDisplayValue(value) {
  const raw = String(value ?? "");
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatTraceDisplayValue(value) {
  const parsed = parseTraceDisplayValue(value);
  if (Array.isArray(parsed)) {
    return {
      type: "list",
      inline: `[${parsed.length} item${parsed.length === 1 ? "" : "s"}]`,
      detail: JSON.stringify(parsed, null, 2),
    };
  }
  if (parsed && typeof parsed === "object") {
    const keys = Object.keys(parsed);
    return {
      type: "dict",
      inline: `{${keys.length} key${keys.length === 1 ? "" : "s"}}`,
      detail: JSON.stringify(parsed, null, 2),
    };
  }
  if (typeof parsed === "string") {
    const looksLikeSet = parsed.startsWith("{") && parsed.endsWith("}") && !parsed.includes(":");
    return {
      type: looksLikeSet ? "set" : "str",
      inline: looksLikeSet ? parsed : `"${parsed}"`,
      detail: null,
    };
  }
  return {
    type: typeof parsed,
    inline: String(parsed),
    detail: null,
  };
}

function TraceValue({ value }) {
  const formatted = formatTraceDisplayValue(value);
  return (
    <>
      <code className={`code-trace-value code-trace-value-${formatted.type}`}>{formatted.inline}</code>
      {formatted.detail ? <pre>{formatted.detail}</pre> : null}
    </>
  );
}

function TraceInlineValue({ value }) {
  const formatted = formatTraceDisplayValue(value);
  return <code className={`code-trace-value code-trace-value-${formatted.type}`}>{formatted.inline}</code>;
}

function isTraceStructuredValue(value) {
  const parsed = parseTraceDisplayValue(value);
  return Array.isArray(parsed) || (parsed && typeof parsed === "object");
}

function TraceObjectValue({ value, variableName, isUsedNow, status }) {
  const formatted = formatTraceDisplayValue(value);
  const parsed = parseTraceDisplayValue(value);

  if (Array.isArray(parsed)) {
    return (
      <div
        className={`code-trace-object-card code-trace-object-list is-${status} ${isUsedNow ? "is-used-now" : ""}`}
        aria-label={`${variableName} list object`}
      >
        <div className="code-trace-object-head">
          <span>list object</span>
          <strong>{variableName}</strong>
        </div>
        <div className="code-trace-object-meta">
          <span>{formatted.inline}</span>
          <span>{status === "same" ? "stored" : status}</span>
          {isUsedNow ? <span>active line</span> : null}
        </div>
        <div className="code-trace-list-slots">
          {parsed.slice(0, 8).map((item, index) => (
            <span key={`${variableName}-${index}`}>
              <em>{index}</em>
              <strong>{String(item)}</strong>
            </span>
          ))}
          {parsed.length > 8 ? <span className="is-more">+{parsed.length - 8}</span> : null}
        </div>
      </div>
    );
  }

  if (parsed && typeof parsed === "object") {
    return (
      <div
        className={`code-trace-object-card code-trace-object-map is-${status} ${isUsedNow ? "is-used-now" : ""}`}
        aria-label={`${variableName} object`}
      >
        <div className="code-trace-object-head">
          <span>object</span>
          <strong>{variableName}</strong>
        </div>
        <div className="code-trace-object-meta">
          <span>{formatted.inline}</span>
          <span>{status === "same" ? "stored" : status}</span>
          {isUsedNow ? <span>active line</span> : null}
        </div>
        <div className="code-trace-object-pairs">
          {Object.entries(parsed).slice(0, 6).map(([key, item]) => (
            <span key={`${variableName}-${key}`}>
              <em>{key}</em>
              <strong>{String(item)}</strong>
            </span>
          ))}
          {Object.keys(parsed).length > 6 ? <span className="is-more">+{Object.keys(parsed).length - 6}</span> : null}
        </div>
      </div>
    );
  }

  return <TraceInlineValue value={formatted.inline} />;
}

function normalizeTraceValue(value) {
  return String(value ?? "");
}

function extractLineVariableNames(line = "", locals = {}) {
  const localNames = new Set(Object.keys(locals || {}));
  const names = [];
  String(line || "").replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (name, offset, fullLine) => {
    if (PYTHON_TRACE_KEYWORDS.has(name)) return name;
    if (!localNames.has(name)) return name;
    if (fullLine[offset - 1] === ".") return name;
    if (!names.includes(name)) names.push(name);
    return name;
  });
  return names;
}

function variableStatus(name, value, previousLocals = {}) {
  if (!previousLocals || !Object.prototype.hasOwnProperty.call(previousLocals, name)) return "new";
  return normalizeTraceValue(previousLocals[name]) === normalizeTraceValue(value) ? "same" : "changed";
}

function describeTraceOperation(line = "", locals = {}, previousLine = "") {
  const source = String(line || "").trim();
  const previousSource = String(previousLine || "").trim();
  const sourceToExplain = source || previousSource;
  if (!sourceToExplain) return "";

  const loopWithMethod = previousSource.match(/^for\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\.(lower|upper|strip|split|replace)\s*\(/);
  if (loopWithMethod && Object.prototype.hasOwnProperty.call(locals, loopWithMethod[1])) {
    const [, itemName, sourceName, methodName] = loopWithMethod;
    const itemValue = formatTraceDisplayValue(locals[itemName]).inline;
    const methodCopy =
      methodName === "lower" ? "a lowercase copy"
        : methodName === "upper" ? "an uppercase copy"
          : methodName === "strip" ? "a trimmed copy"
            : methodName === "split" ? "pieces from a split copy"
              : "a replaced copy";
    return `${sourceName}.${methodName}() creates ${methodCopy}; ${itemName} is now ${itemValue} from that result.`;
  }

  const assignmentWithMethod = source.match(/^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.(lower|upper|strip|split|replace)\s*\(/);
  if (assignmentWithMethod) {
    const [, targetName, sourceName, methodName] = assignmentWithMethod;
    const targetValue = Object.prototype.hasOwnProperty.call(locals, targetName)
      ? ` ${targetName} now stores ${formatTraceDisplayValue(locals[targetName]).inline}.`
      : "";
    return `${sourceName}.${methodName}() returns a new value; it does not change ${sourceName} in place.${targetValue}`;
  }

  const lenCall = sourceToExplain.match(/\blen\s*\(\s*([A-Za-z_]\w*)\s*\)/);
  if (lenCall) {
    return `len(${lenCall[1]}) counts how many items or characters are in ${lenCall[1]}.`;
  }

  const rangeCall = sourceToExplain.match(/\brange\s*\(([^)]*)\)/);
  if (rangeCall) {
    return `range(${rangeCall[1].trim()}) creates the sequence of numbers the loop will step through.`;
  }

  const directMethod = sourceToExplain.match(/\b([A-Za-z_]\w*)\.(lower|upper|strip|split|replace)\s*\(/);
  if (directMethod) {
    const [, sourceName, methodName] = directMethod;
    return `${sourceName}.${methodName}() returns a transformed value for this operation; ${sourceName} itself stays stored unless the result is assigned back.`;
  }

  return "";
}

function traceErrorInfo(traceResult, activeStep) {
  const raw = String(activeStep?.exception || traceResult?.stderr || "").trim();
  if (!raw) return null;
  const syntaxLine = raw.match(/syntax error:?\s*([^()]*?)\s*\(line\s+(\d+)\)/i);
  const pythonLine = raw.match(/\bline\s+(\d+)\b/i);
  const exceptionName = raw.match(/\b([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception))\b/);
  const isSyntax = /syntax error/i.test(raw);
  const lineNo = activeStep?.line_no || Number(syntaxLine?.[2] || pythonLine?.[1]) || null;
  const label = isSyntax ? "Syntax error" : activeStep?.exception ? "Runtime error" : "Trace error";
  const message = syntaxLine?.[1]?.trim()
    ? `Python could not read the code: ${syntaxLine[1].trim()}.`
    : exceptionName
      ? `Python raised ${exceptionName[1]} while tracing this run.`
      : raw.replace(/^Runner security check blocked this code:\s*/i, "");
  const location = lineNo
    ? `You would see this at line ${lineNo}${activeStep?.line ? `: ${activeStep.line.trim()}` : "."}`
    : "This happened before the trace could step through your function.";
  return { label, message, location, raw };
}

function CodeTraceModal({
  traceResult,
  code = "",
  isTracing,
  onTraceCode,
  onClose,
}) {
  const trace = useMemo(() => (Array.isArray(traceResult?.trace) ? traceResult.trace : []), [traceResult]);
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const lineRefs = useRef(new Map());
  const activeStep = trace[stepIndex] || null;
  const previousStep = stepIndex > 0 ? trace[stepIndex - 1] : null;
  const activeCallStack = Array.isArray(activeStep?.call_stack) ? activeStep.call_stack : [];
  const hasTraceError = traceResult?.status === "error" || Boolean(traceResult?.stderr);
  const codeLines = useMemo(() => {
    const sourceLines = String(code || "").replace(/\r\n/g, "\n").split("\n");
    if (sourceLines.length && (sourceLines.length > 1 || sourceLines[0])) {
      return sourceLines.map((line, index) => [index + 1, line]);
    }
    const byLine = new Map();
    trace.forEach((step) => {
      if (step.line_no && step.line && !byLine.has(step.line_no)) {
        byLine.set(step.line_no, step.line);
      }
    });
    return [...byLine.entries()].sort((left, right) => left[0] - right[0]);
  }, [code, trace]);
  const activeLocals = useMemo(
    () => (activeStep?.locals && typeof activeStep.locals === "object" ? activeStep.locals : {}),
    [activeStep?.locals]
  );
  const previousLocals = useMemo(
    () => (previousStep?.locals && typeof previousStep.locals === "object" ? previousStep.locals : {}),
    [previousStep?.locals]
  );
  const activeLineVariables = useMemo(
    () => extractLineVariableNames(activeStep?.line, activeLocals),
    [activeStep?.line, activeLocals]
  );
  const variableStore = useMemo(() => {
    const names = [
      ...activeLineVariables,
      ...Object.keys(activeLocals).filter((name) => !activeLineVariables.includes(name)),
    ];
    return names.map((name) => ({
      name,
      value: activeLocals[name],
      status: variableStatus(name, activeLocals[name], previousLocals),
      usedNow: activeLineVariables.includes(name),
    }));
  }, [activeLineVariables, activeLocals, previousLocals]);
  const activeErrorInfo = traceErrorInfo(traceResult, activeStep);
  const canGoBack = stepIndex > 0;
  const canGoNext = stepIndex < trace.length - 1;
  const screenOutput = activeStep?.stdout || (!canGoNext ? traceResult?.stdout : "");
  const operationInsight = useMemo(
    () => describeTraceOperation(activeStep?.line, activeLocals, previousStep?.line),
    [activeStep?.line, activeLocals, previousStep?.line]
  );
  const activeExplanation = useMemo(() => {
    if (!activeStep) return "Run a trace to step through your Python code.";
    if (activeStep.event === "return") {
      return `The function is returning ${formatTraceDisplayValue(activeStep.return_value).inline}.`;
    }
    if (activeStep.event === "exception") {
      return activeStep.exception ? `Python stopped on line ${activeStep.line_no} because ${activeStep.exception}.` : "Python raised an exception on this step.";
    }
    if (operationInsight) return operationInsight;
    return `Python is about to run line ${activeStep.line_no}. Watch the variables below before and after this line.`;
  }, [activeStep, operationInsight]);
  const modalRef = useFocusTrap(true, { onEscape: onClose });

  const goToStep = useCallback((nextIndex) => {
    if (!trace.length) return;
    setStepIndex(Math.max(0, Math.min(trace.length - 1, nextIndex)));
  }, [trace.length]);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(false);
  }, [traceResult]);

  useEffect(() => {
    if (!activeStep?.line_no) return;
    const lineElement = lineRefs.current.get(activeStep.line_no);
    lineElement?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [activeStep?.line_no, stepIndex]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    if (!canGoNext) {
      setIsPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => goToStep(stepIndex + 1), 900);
    return () => window.clearTimeout(timer);
  }, [canGoNext, goToStep, isPlaying, stepIndex]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIsPlaying(false);
        goToStep(stepIndex - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIsPlaying(false);
        goToStep(stepIndex + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToStep, stepIndex]);

  return (
    <div className="workspace-visualizer-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="code-trace-title"
        aria-describedby="code-trace-description"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <section className="workspace-visualizer is-modal code-trace-modal">
          <header className="workspace-visualizer-head">
            <div>
              <span className="workspace-visualizer-kicker">Trace My Code</span>
              <h3 id="code-trace-title">Python execution trace</h3>
              <p id="code-trace-description">Steps through the Python code currently in your editor and shows what changes as it runs.</p>
            </div>
            <button
              type="button"
              className="workspace-visual-close code-trace-close"
              onClick={onClose}
              data-autofocus
              aria-label="Close trace"
            >
              <FaTimes aria-hidden="true" />
            </button>
          </header>

          {traceResult?.stderr && !activeErrorInfo ? <p className="workspace-visualizer-error">{traceResult.stderr}</p> : null}
          {traceResult?.truncated ? <p className="workspace-visualizer-lock">Trace capped at the first 80 executed steps.</p> : null}

          <div className="code-trace-actions">
            <button type="button" onClick={onTraceCode} disabled={isTracing}>
              {isTracing ? "Tracing..." : trace.length ? "Trace again" : "Start trace"}
            </button>
          </div>

          {trace.length ? (
            <>
              <div className="code-trace-progress" aria-label="Trace steps">
                {trace.map((step, index) => (
                  <button
                    type="button"
                    key={`${step.line_no}-${index}`}
                    className={index === stepIndex ? "is-active" : ""}
                    aria-label={`Go to step ${index + 1}, line ${step.line_no}`}
                    aria-current={index === stepIndex ? "step" : undefined}
                    onClick={() => {
                      setIsPlaying(false);
                      goToStep(index);
                    }}
                  />
                ))}
              </div>

              <div className="code-trace-stage">
                <section className="code-trace-code-window" aria-label="Executed code">
                  <div>
                    <span>Step {stepIndex + 1} of {trace.length}</span>
                    <strong>{activeStep?.function}</strong>
                    <code>line {activeStep?.line_no}</code>
                    {activeStep?.call_depth ? <code>depth {activeStep.call_depth}</code> : null}
                  </div>
                  <pre>
                    {codeLines.map(([lineNo, line]) => (
                      <span
                        key={lineNo}
                        ref={(node) => {
                          if (node) lineRefs.current.set(lineNo, node);
                          else lineRefs.current.delete(lineNo);
                        }}
                        className={lineNo === activeStep?.line_no ? "is-active" : ""}
                      >
                        <em>{lineNo}</em>
                        <code>{line || " "}</code>
                      </span>
                    ))}
                  </pre>
                </section>

                <aside className="code-trace-state-panel" aria-label="Current trace state">
                  <div>
                    <span>What is happening</span>
                    <h4>{activeExplanation}</h4>
                  </div>
                  {activeCallStack.length ? (
                    <div className="code-trace-call-stack">
                      <span>Call stack</span>
                      <ol>
                        {activeCallStack.map((name, index) => (
                          <li key={`${name}-${index}`} className={index === activeCallStack.length - 1 ? "is-current" : ""}>
                            {name}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                  {activeStep?.line ? (
                    <div className="code-trace-current-line">
                      <span>Current line</span>
                      <code>{activeStep.line.trim()}</code>
                    </div>
                  ) : null}
                  {activeErrorInfo ? (
                    <div className="code-trace-error-card">
                      <span>{activeErrorInfo.label}</span>
                      <strong>{activeErrorInfo.message}</strong>
                      <p>{activeErrorInfo.location}</p>
                    </div>
                  ) : null}
                  {activeStep?.return_value != null ? (
                    <div className="code-trace-result-box">
                      <span>Returned value</span>
                      <strong><TraceValue value={activeStep.return_value} /></strong>
                    </div>
                  ) : null}
                  {screenOutput ? (
                    <div className="code-trace-output-box">
                      <span>{canGoNext ? "Screen output so far" : "Final screen output"}</span>
                      <pre>{screenOutput}</pre>
                    </div>
                  ) : null}
                  <div className="code-trace-variable-updates" aria-label="Variable updates for this trace step">
                    <span>Variable updates</span>
                    {variableStore.length ? (
                      <div className="code-trace-frame-object-view">
                        <section className="code-trace-frame-card" aria-label={`${activeStep?.function || "function"} frame`}>
                          <div className="code-trace-frame-head">
                            <span>Function frame</span>
                            <strong>{activeStep?.function || "current function"}</strong>
                          </div>
                          <div className="code-trace-frame-locals">
                            {variableStore.map(({ name, value, status, usedNow }) => (
                              <div
                                key={name}
                                className={`code-trace-frame-local is-${status} ${usedNow ? "is-used-now" : ""}`}
                              >
                                <strong>{name}</strong>
                                <span>{status === "same" ? "stored" : status}</span>
                                <TraceInlineValue value={value} />
                              </div>
                            ))}
                          </div>
                        </section>
                        {variableStore.some(({ value }) => isTraceStructuredValue(value)) ? (
                          <section className="code-trace-objects-card" aria-label="Objects used by declared variables">
                            <div className="code-trace-frame-head">
                              <span>Objects</span>
                              <strong>referenced values</strong>
                            </div>
                            <div className="code-trace-object-list-wrap">
                              {variableStore
                                .filter(({ value }) => isTraceStructuredValue(value))
                                .map(({ name, value, status, usedNow }) => (
                                  <TraceObjectValue
                                    key={`${name}-object`}
                                    value={value}
                                    variableName={name}
                                    status={status}
                                    isUsedNow={usedNow}
                                  />
                                ))}
                            </div>
                          </section>
                        ) : null}
                      </div>
                    ) : (
                      <p className="code-trace-no-declared-vars">No variables captured yet.</p>
                    )}
                  </div>
                </aside>
              </div>

              <footer className="code-trace-controls">
                <button type="button" onClick={() => { setIsPlaying(false); goToStep(0); }}>
                  Reset
                </button>
                <button type="button" disabled={!canGoBack} onClick={() => { setIsPlaying(false); goToStep(stepIndex - 1); }}>
                  Previous
                </button>
                <button type="button" disabled={!canGoNext && !isPlaying} onClick={() => setIsPlaying((current) => !current)}>
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button type="button" disabled={!canGoNext} onClick={() => { setIsPlaying(false); goToStep(stepIndex + 1); }}>
                  Next
                </button>
              </footer>
            </>
          ) : (
            <div className={`code-trace-empty-state ${hasTraceError ? "is-error" : ""}`}>
              <strong>{hasTraceError ? "Trace could not start" : "No trace generated yet"}</strong>
              <p>
                {hasTraceError && activeErrorInfo
                  ? `${activeErrorInfo.message} ${activeErrorInfo.location}`
                  : hasTraceError
                    ? "Check that your code defines the expected function name and has no syntax errors, then try again."
                    : "Press Trace my code, then step forward and backward through your code."}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function CodeWorkspace({
  activeProblem,
  code,
  selectedLanguage,
  languageOptions,
  languageFormat,
  workspaceTab,
  hints,
  revealedHints,
  isRunning,
  latestFeedback,
  discussionMessages = [],
  terminalOpen,
  testOutput,
  solutionReview,
  canMarkSolved = true,
  isSolved = false,
  isPersonalMode = false,
  languageLocked = false,
  onCodeChange,
  onSelectionChange,
  onLanguageChange,
  onTabChange,
  onToggleTerminal,
  onCloseTerminal,
  onRun,
  onMarkSolved,
  onCopyCode,
  onClearWorkspace,
  onShowHint,
  onShowAllHints,
  onExplainFailedTests,
  onExplainError,
  onExplainOneTest,
  onStopRun,
  onRequestReview,
  onTraceCode,
  isTracingCode = false,
  traceResult = null,
  visualizerOpen = false,
  traceModalOpen = false,
  onCloseVisualizer,
  onCloseTraceModal,
  onSaveSnippet,
  onUploadFile,
  codeRenderer,
}) {
  const [caret, setCaret] = useState({ line: 1, col: 1, chars: 0 });
  const [terminalHeight, setTerminalHeight] = useState(readStoredTerminalHeight);
  const stackRef = useRef(null);
  const dragState = useRef(null);
  const canTracePython = useMemo(
    () => selectedLanguage === "Python",
    [selectedLanguage],
  );

  // Drag-to-resize the docked terminal. We resize from the divider: dragging up
  // grows the terminal, dragging down shrinks it. Height is clamped + persisted.
  const onDividerPointerDown = useCallback((event) => {
    event.preventDefault();
    const stack = stackRef.current;
    const available = stack ? stack.getBoundingClientRect().height : window.innerHeight;
    dragState.current = {
      startY: event.clientY,
      startHeight: terminalHeight,
      // Never let the terminal eat the whole stack — leave room for the editor.
      maxForStack: Math.min(TERMINAL_MAX_H, Math.max(TERMINAL_MIN_H, available - 180)),
    };
    document.body.classList.add("ct-terminal-resizing");
    try {
      event.target.setPointerCapture?.(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
  }, [terminalHeight]);

  const onDividerPointerMove = useCallback((event) => {
    const state = dragState.current;
    if (!state) return;
    const delta = state.startY - event.clientY; // up = positive = taller terminal
    const next = Math.min(state.maxForStack, Math.max(TERMINAL_MIN_H, state.startHeight + delta));
    setTerminalHeight(next);
  }, []);

  const endDrag = useCallback(() => {
    if (!dragState.current) return;
    dragState.current = null;
    document.body.classList.remove("ct-terminal-resizing");
    setTerminalHeight((value) => {
      try {
        window.localStorage.setItem(TERMINAL_H_KEY, String(Math.round(value)));
      } catch {
        /* ignore storage errors */
      }
      return value;
    });
  }, []);

  // Keyboard resize on the divider for accessibility (Up/Down arrows).
  const onDividerKeyDown = useCallback((event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setTerminalHeight((v) => Math.min(TERMINAL_MAX_H, v + step));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setTerminalHeight((v) => Math.max(TERMINAL_MIN_H, v - step));
    }
  }, []);

  useEffect(() => {
    return () => document.body.classList.remove("ct-terminal-resizing");
  }, []);

  const renderTab = () => {
    if (workspaceTab === "Hints") {
      return (
        <HintPanel
          hints={hints}
          revealedHints={revealedHints}
          onShowHint={onShowHint}
          onShowAllHints={onShowAllHints}
          codeRenderer={codeRenderer}
        />
      );
    }
    if (workspaceTab === "Discussion") {
      return (
        <div className="workspace-discussion-panel">
          {discussionMessages.length ? (
            <div className="workspace-discussion-thread" role="log" aria-label="Coding tutor discussion">
              {discussionMessages.map((message) => (
                <article
                  key={message.id || `${message.sender}-${message.time}-${message.text?.slice(0, 20)}`}
                  className={`workspace-discussion-message ${message.sender === "user" ? "user" : "bot"}`}
                >
                  <span className="workspace-discussion-speaker">
                    {message.sender === "user" ? "You" : "Coding Tutor"}
                  </span>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: codeRenderer }}>
                    {message.text || (message.isStreaming ? "Thinking..." : "")}
                  </ReactMarkdown>
                </article>
              ))}
            </div>
          ) : latestFeedback ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: codeRenderer }}>
              {latestFeedback}
            </ReactMarkdown>
          ) : (
            <p>Tutor replies will appear here after you ask for review, debugging, or edge cases.</p>
          )}
        </div>
      );
    }
    if (workspaceTab === "Visualize") {
      return <WorkspaceVisualizerPanel activeProblem={activeProblem} />;
    }
    // The editor "window": a title bar (filename + language selector, like
    // LeetCode's code panel) and a bottom status bar.
    return (
      <div className="code-editor-window">
        <div className="code-editor-titlebar">
          <span className="code-editor-filename">{languageFormat.file}</span>
          <div className="code-editor-titlebar-right">
            <RunControls
              code={code}
              activeProblem={activeProblem}
              isRunning={isRunning}
              canMarkSolved={canMarkSolved}
              isSolved={isSolved}
              isPersonalMode={isPersonalMode}
              onRun={onRun}
              onMarkSolved={onMarkSolved}
              onCopyCode={onCopyCode}
              onClearWorkspace={onClearWorkspace}
              onSaveSnippet={onSaveSnippet}
              onUploadFile={onUploadFile}
            />
            <button
              type="button"
              className="code-trace-button"
              onClick={onTraceCode}
              disabled={!canTracePython || isTracingCode}
              title={canTracePython ? "Trace your actual Python code step by step" : "Code tracing is available for Python first"}
            >
              {isTracingCode ? "Tracing..." : "Trace My Code"}
            </button>
            <span className="code-editor-lang-control">
            <select
              className="code-editor-lang-select"
              value={selectedLanguage}
              onChange={(event) => onLanguageChange(event.target.value)}
              disabled={languageLocked}
              title={languageLocked ? "Language is locked for the rest of this mock — you committed it after the first question" : "Change language"}
            >
              {languageOptions.map(language => <option key={language} value={language}>{language}</option>)}
            </select>
            </span>
          </div>
        </div>
        <CodeEditor
          code={code}
          onCodeChange={onCodeChange}
          onCursorChange={setCaret}
          onSelectionChange={onSelectionChange}
          language={selectedLanguage}
        />
        <div className="code-editor-statusbar" aria-hidden="true">
          <span className="status-left">
            <span className="status-pill">{selectedLanguage}</span>
            <span>UTF-8</span>
            <span>Spaces: 4</span>
          </span>
          <span className="status-right">
            <span>Ln {caret.line}, Col {caret.col}</span>
            <span>{caret.chars} chars</span>
          </span>
        </div>
      </div>
    );
  };

  const showTerminal = terminalOpen && workspaceTab === "Editor";

  return (
    <main className="coding-editor-center">
      <div className="coding-pane-header">
        <div><span className="coding-kicker">Workspace</span><h2>{activeProblem?.title || "Code Editor"}</h2></div>
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="Workspace panels" onKeyDown={handleHorizontalRovingKeyDown}>
        {WORKSPACE_TABS.map(tab => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={workspaceTab === tab}
            tabIndex={workspaceTab === tab ? 0 : -1}
            className={workspaceTab === tab ? "active" : ""}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
        <button
          type="button"
          className={terminalOpen ? "active terminal-tab" : "terminal-tab"}
          onClick={onToggleTerminal}
          aria-pressed={terminalOpen}
          title={terminalOpen ? "Close terminal" : "Open terminal"}
        >
          Terminal
        </button>
      </div>

      {/* The editor + terminal are ONE stacked unit. The terminal docks below the
          editor with a draggable divider — not a detached footer. */}
      <div className={`editor-terminal-stack ${showTerminal ? "terminal-docked" : ""}`} ref={stackRef}>
        <div className="workspace-tab-body">{renderTab()}</div>
        {showTerminal && (
          <>
            <div
              className="editor-terminal-divider"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize terminal"
              aria-valuemin={TERMINAL_MIN_H}
              aria-valuemax={TERMINAL_MAX_H}
              aria-valuenow={Math.round(terminalHeight)}
              aria-valuetext={`Terminal height ${Math.round(terminalHeight)} pixels`}
              tabIndex={0}
              onPointerDown={onDividerPointerDown}
              onPointerMove={onDividerPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onDividerKeyDown}
            >
              <span className="editor-terminal-divider-grip" aria-hidden="true" />
            </div>
            <div className="coding-dock-terminal" style={{ height: `${terminalHeight}px` }}>
              <TerminalPanel
                testOutput={testOutput}
                isRunning={isRunning}
                expanded
                onClose={onCloseTerminal}
                onStop={onStopRun}
                onExplainFailedTests={onExplainFailedTests}
                onExplainError={onExplainError}
                onExplainOneTest={onExplainOneTest}
                onRequestReview={onRequestReview}
                solutionReview={solutionReview}
              />
            </div>
          </>
        )}
      </div>
      {visualizerOpen ? (
        <WorkspaceVisualizerModal activeProblem={activeProblem} onClose={onCloseVisualizer} />
      ) : null}
      {traceModalOpen ? (
        <CodeTraceModal
          traceResult={traceResult}
          code={code}
          isTracing={isTracingCode}
          onTraceCode={onTraceCode}
          onClose={onCloseTraceModal}
        />
      ) : null}
    </main>
  );
}
