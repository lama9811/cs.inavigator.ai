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
import { FaFastBackward, FaFastForward, FaPause, FaPlay, FaStepBackward, FaStepForward, FaTimes } from "react-icons/fa";
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
const TERMINAL_MOBILE_MIN_H = 104;
const TERMINAL_MAX_H = 560;
const TERMINAL_DEFAULT_H = 240;
const TERMINAL_H_KEY = "csnav.terminalHeight";

function terminalResizeBounds(availableHeight = window.innerHeight) {
  const isMobile = typeof window !== "undefined" && window.matchMedia?.("(max-width: 860px)")?.matches;
  const minHeight = isMobile ? TERMINAL_MOBILE_MIN_H : TERMINAL_MIN_H;
  const editorFloor = isMobile ? 260 : 180;
  const mobileMaxRatio = isMobile ? 0.52 : 1;
  return {
    minHeight,
    maxHeight: Math.min(
      TERMINAL_MAX_H,
      Math.max(minHeight, availableHeight - editorFloor),
      Math.max(minHeight, Math.floor(availableHeight * mobileMaxRatio)),
    ),
  };
}

function readStoredTerminalHeight() {
  try {
    const raw = window.localStorage.getItem(TERMINAL_H_KEY);
    const value = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(value)) {
      const bounds = terminalResizeBounds();
      return Math.min(bounds.maxHeight, Math.max(bounds.minHeight, value));
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

function hasTraceV2(traceResult) {
  return traceResult?.trace_v2?.schema_version === "trace_v2" && Array.isArray(traceResult.trace_v2.steps);
}

function traceLineNo(step) {
  return step?.current_line ?? step?.line_no ?? null;
}

function exceptionDisplay(exception) {
  if (!exception) return "an exception";
  if (typeof exception === "string") return exception;
  const type = exception.type || "Error";
  const message = exception.message ? `: ${exception.message}` : "";
  return `${type}${message}`;
}

function v2ScalarDisplay(binding) {
  if (!binding) return "";
  if (binding.display != null) return String(binding.display);
  if (binding.value != null) return String(binding.value);
  return "";
}

function v2ObjectSummary(object) {
  if (!object) return "object";
  if (Number.isFinite(object.length)) {
    return `[${object.length} item${object.length === 1 ? "" : "s"}]`;
  }
  if (object.class_name) return object.class_name;
  return object.type || "object";
}

const TRACE_LANGUAGE_LABELS = {
  python: "Python",
  javascript: "JavaScript",
  java: "Java",
  cpp: "C++",
};

function normalizeTraceLanguage(language = "") {
  const value = String(language || "").toLowerCase();
  if (value === "c++" || value === "cpp") return "cpp";
  if (value === "js" || value === "javascript") return "javascript";
  if (value === "py" || value === "python") return "python";
  if (value === "java") return "java";
  return value;
}

function traceLanguageLabel(language = "") {
  const normalized = normalizeTraceLanguage(language);
  return TRACE_LANGUAGE_LABELS[normalized] || language || "Code";
}

function stripLineComment(line = "", language = "Python") {
  const source = String(line || "");
  const normalized = normalizeTraceLanguage(language);
  const lineComment =
    normalized === "javascript" || normalized === "java" || normalized === "cpp" ? "//" : "#";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (lineComment === "#" && char === "#") {
      return source.slice(0, index).trimEnd();
    }
    if (lineComment === "//" && char === "/" && source[index + 1] === "/") {
      return source.slice(0, index).trimEnd();
    }
  }
  return source.trimEnd();
}

function TraceV2Value({ binding, objects = {} }) {
  if (!binding) return <code className="code-trace-value">unknown</code>;
  if (binding.kind === "reference") {
    const object = objects[binding.object_id];
    return (
      <code className={`code-trace-value code-trace-value-ref code-trace-value-${object?.type || binding.type || "object"}`}>
        {v2ObjectSummary(object)}
      </code>
    );
  }
  return <code className={`code-trace-value code-trace-value-${binding.type || "scalar"}`}>{v2ScalarDisplay(binding)}</code>;
}

function TraceV2ObjectCell({ value, objects = {}, objectLabels = new Map() }) {
  if (!value) return <strong>?</strong>;
  if (value.kind === "reference") {
    const object = objects[value.object_id];
    return <strong>{objectLabels.get(value.object_id)?.[0] || v2ObjectSummary(object) || "stored value"}</strong>;
  }
  return <strong>{v2ScalarDisplay(value)}</strong>;
}

function buildTraceObjectLabels(frames = [], objects = {}) {
  const labels = new Map();

  const addLabel = (objectId, label) => {
    if (!objectId || !label) return;
    const existing = labels.get(objectId) || [];
    if (!existing.includes(label)) labels.set(objectId, [...existing, label]);
  };

  frames.forEach((frame) => {
    Object.entries(frame.bindings || {}).forEach(([name, binding]) => {
      if (binding?.kind === "reference") addLabel(binding.object_id, name);
    });
  });

  Object.entries(objects || {}).forEach(([objectId, object]) => {
    const primaryName = labels.get(objectId)?.[0];
    if (!primaryName || !Array.isArray(object?.entries)) return;
    object.entries.forEach((entry) => {
      if (entry?.value?.kind !== "reference") return;
      addLabel(entry.value.object_id, `${primaryName}[${v2ScalarDisplay(entry.key)}]`);
    });
  });

  return labels;
}

function friendlyTraceObjectType(object) {
  if (!object?.type) return "stored value";
  if (object.type === "dict") return "dictionary";
  if (object.type === "tuple") return "tuple";
  if (object.type === "set") return "set";
  if (object.type === "list") return "list";
  return object.class_name || object.type;
}

function isTraceCollectionBinding(binding, objects = {}) {
  if (binding?.kind !== "reference") return false;
  const object = objects[binding.object_id];
  return ["dict", "list", "set", "tuple"].includes(object?.type);
}

function TraceV2ObjectCard({ object, isChanged, label, objects = {}, objectLabels = new Map() }) {
  const entries = Array.isArray(object?.entries) ? object.entries : [];
  const items = Array.isArray(object?.items) ? object.items : [];
  const attributes = object?.attributes && typeof object.attributes === "object" ? Object.entries(object.attributes) : [];
  const typeLabel = friendlyTraceObjectType(object);
  const title = label || `${typeLabel} value`;
  const showSlots = items.length || entries.length || attributes.length;

  return (
    <article className={`code-trace-v2-object ${isChanged ? "is-changed" : ""}`}>
      <div className="code-trace-object-head">
        <span>{typeLabel}</span>
        <strong>{title}</strong>
      </div>
      <div className="code-trace-object-meta">
        <span>{v2ObjectSummary(object)}</span>
        <span>{isChanged ? "changed" : "stored"}</span>
      </div>
      {showSlots && items.length ? (
        <div className="code-trace-list-slots">
          {items.slice(0, 12).map((item, index) => (
            <span key={`${object.object_id}-${index}`}>
              <em>{index}</em>
              <TraceV2ObjectCell value={item} objects={objects} objectLabels={objectLabels} />
            </span>
          ))}
          {object.truncated ? <span className="is-more">more</span> : null}
        </div>
      ) : null}
      {showSlots && entries.length ? (
        <div className="code-trace-object-pairs">
          {entries.slice(0, 10).map((entry, index) => (
            <span key={`${object.object_id}-entry-${index}`}>
              <em>{v2ScalarDisplay(entry.key)}</em>
              <TraceV2ObjectCell value={entry.value} objects={objects} objectLabels={objectLabels} />
            </span>
          ))}
          {object.truncated ? <span className="is-more">more</span> : null}
        </div>
      ) : null}
      {showSlots && attributes.length ? (
        <div className="code-trace-object-pairs">
          {attributes.slice(0, 10).map(([key, value]) => (
            <span key={`${object.object_id}-attr-${key}`}>
              <em>{key}</em>
              <TraceV2ObjectCell value={value} objects={objects} objectLabels={objectLabels} />
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
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

function traceErrorInfo(traceResult, activeStep, languageLabel = "Python") {
  const exceptionText = typeof activeStep?.exception === "object" && activeStep.exception
    ? `${activeStep.exception.type || "Error"}: ${activeStep.exception.message || ""}`
    : activeStep?.exception;
  const raw = String(exceptionText || traceResult?.stderr || "").trim();
  if (!raw) return null;
  const syntaxLine = raw.match(/syntax error:?\s*([^()]*?)\s*\(line\s+(\d+)\)/i);
  const pythonLine = raw.match(/\bline\s+(\d+)\b/i);
  const exceptionName = raw.match(/\b([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception))\b/);
  const isSyntax = /syntax error/i.test(raw);
  const exceptionLine = typeof activeStep?.exception === "object" ? Number(activeStep.exception.line) : null;
  const lineNo = traceLineNo(activeStep) || exceptionLine || Number(syntaxLine?.[2] || pythonLine?.[1]) || null;
  const label = isSyntax ? "Syntax error" : activeStep?.exception ? "Runtime error" : "Trace error";
  const cleanLine = activeStep?.line ? stripLineComment(activeStep.line, languageLabel).trim() : "";
  const exceptionType = exceptionName?.[1] || (typeof activeStep?.exception === "object" ? activeStep.exception.type : "");
  const exceptionMessage = typeof activeStep?.exception === "object" ? activeStep.exception.message || "" : raw;
  let cause = "";
  const missingName = exceptionType === "NameError"
    ? exceptionMessage.match(/name ['"]([^'"]+)['"] is not defined/i)?.[1]
    : "";
  if (missingName) {
    cause = `${cleanLine || "This line"} uses ${missingName}, but that name has not been created in this scope. Check for a typo or use the variable name that already exists.`;
  } else if (exceptionType === "TypeError" && cleanLine) {
    cause = `${cleanLine} uses a value in a way its type does not support. Check the value stored in each variable on this line.`;
  } else if (exceptionType === "IndexError" && cleanLine) {
    cause = `${cleanLine} tries to read a position that is outside the list or string. Check the index and the collection length.`;
  } else if (exceptionType === "KeyError" && cleanLine) {
    cause = `${cleanLine} tries to read a key that is not in the dictionary or map yet. Check whether the key exists before reading it.`;
  } else if (exceptionType && cleanLine) {
    cause = `${cleanLine} is the line that triggered this ${exceptionType}. Check the variables used on that line first.`;
  }
  const message = syntaxLine?.[1]?.trim()
    ? `${languageLabel} could not read the code: ${syntaxLine[1].trim()}.`
    : exceptionName
      ? `${exceptionName[1]}: ${exceptionMessage || "the program stopped while tracing."}`
      : raw.replace(/^Runner security check blocked this code:\s*/i, "");
  const location = lineNo
    ? `You would see this at line ${lineNo}${activeStep?.line ? `: ${activeStep.line.trim()}` : "."}`
    : "This happened before the trace could step through your function.";
  return { label, message, location, raw, cause };
}

function CodeTraceModal({
  traceResult,
  code = "",
  selectedLanguage = "Python",
  isTracing,
  onTraceCode,
  onClose,
}) {
  const isTraceV2 = hasTraceV2(traceResult);
  const trace = useMemo(() => {
    if (hasTraceV2(traceResult)) return traceResult.trace_v2.steps;
    return Array.isArray(traceResult?.trace) ? traceResult.trace : [];
  }, [traceResult]);
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const lineRefs = useRef(new Map());
  const activeStep = trace[stepIndex] || null;
  const previousStep = stepIndex > 0 ? trace[stepIndex - 1] : null;
  const activeFrames = useMemo(
    () => (Array.isArray(activeStep?.frames) ? activeStep.frames : []),
    [activeStep?.frames]
  );
  const activeObjects = useMemo(
    () => (activeStep?.objects && typeof activeStep.objects === "object" ? activeStep.objects : {}),
    [activeStep?.objects]
  );
  const activeCallStack = useMemo(
    () => (
      activeFrames.length
        ? activeFrames.map((frame) => frame.function).filter(Boolean)
        : Array.isArray(activeStep?.call_stack) ? activeStep.call_stack : []
    ),
    [activeFrames, activeStep?.call_stack]
  );
  const hasTraceError = traceResult?.status === "error" || Boolean(traceResult?.stderr);
  const codeLines = useMemo(() => {
    const sourceLines = String(code || "").replace(/\r\n/g, "\n").split("\n");
    if (sourceLines.length && (sourceLines.length > 1 || sourceLines[0])) {
      return sourceLines.map((line, index) => [index + 1, line]);
    }
    const byLine = new Map();
    trace.forEach((step) => {
      const lineNo = traceLineNo(step);
      if (lineNo && step.line && !byLine.has(lineNo)) {
        byLine.set(lineNo, step.line);
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
  const traceMeta = traceResult?.trace_v2 || {};
  const traceLanguage = traceLanguageLabel(traceMeta.language || traceMeta.requested_language || selectedLanguage);
  const traceCapability = traceMeta.capability || "practice_and_freeform";
  const traceMode = traceMeta.trace_mode || "";
  const hasTraceSteps = trace.length > 0;
  const activeErrorInfo = traceErrorInfo(traceResult, activeStep, traceLanguage);
  const canGoBack = stepIndex > 0;
  const canGoNext = stepIndex < trace.length - 1;
  const screenOutput = activeStep?.stdout || (!canGoNext ? traceResult?.stdout : "");
  const operationInsight = useMemo(
    () => describeTraceOperation(activeStep?.line, activeLocals, previousStep?.line),
    [activeStep?.line, activeLocals, previousStep?.line]
  );
  const activeExplanation = useMemo(() => {
    if (!activeStep) return `Run a trace to step through your ${traceLanguage} code.`;
    if (activeErrorInfo) {
      return activeErrorInfo.label === "Syntax error"
        ? `${traceLanguage} could not start the trace because the code has a syntax error.`
        : "The trace stopped at the error line. Read the error card below first.";
    }
    if (isTraceV2 && activeStep.student_message) return activeStep.student_message;
    if (isTraceV2 && activeStep.operation_summary) return activeStep.operation_summary;
    if (activeStep.event === "return") {
      return `The function is returning ${formatTraceDisplayValue(activeStep.return_value).inline}.`;
    }
    if (activeStep.event === "exception") {
      return activeStep.exception ? `${traceLanguage} stopped on line ${traceLineNo(activeStep) || activeStep.exception?.line || "?"} because ${exceptionDisplay(activeStep.exception)}.` : `${traceLanguage} raised an exception on this step.`;
    }
    if (operationInsight) return operationInsight;
    return `${traceLanguage} is about to run line ${traceLineNo(activeStep)}. Check the variables before and after this line.`;
  }, [activeErrorInfo, activeStep, isTraceV2, operationInsight, traceLanguage]);
  const changedBindings = useMemo(() => {
    const names = new Set();
    (activeStep?.binding_changes || []).forEach((change) => names.add(`${change.frame}:${change.name}`));
    return names;
  }, [activeStep?.binding_changes]);
  const changedObjects = useMemo(() => {
    const ids = new Set();
    (activeStep?.object_changes || []).forEach((change) => {
      if (change.change === "mutated") ids.add(change.object_id);
    });
    return ids;
  }, [activeStep?.object_changes]);
  const currentFrameIndex = useMemo(() => {
    if (!activeFrames.length) return -1;
    const matchingIndex = activeFrames.findIndex((frame) => frame.function === activeStep?.function);
    return matchingIndex >= 0 ? matchingIndex : activeFrames.length - 1;
  }, [activeFrames, activeStep?.function]);
  const currentFrame = currentFrameIndex >= 0 ? activeFrames[currentFrameIndex] : null;
  const hiddenFrames = currentFrameIndex >= 0
    ? activeFrames.filter((_, index) => index !== currentFrameIndex)
    : [];
  const objectLabels = useMemo(
    () => buildTraceObjectLabels(activeFrames, activeObjects),
    [activeFrames, activeObjects]
  );
  const activeObjectList = useMemo(
    () => Object.values(activeObjects).map((object) => ({
      object,
      label: objectLabels.get(object.object_id)?.[0] || "",
    })),
    [activeObjects, objectLabels]
  );
  const showMoreTraceDetails = activeCallStack.length > 1 || hiddenFrames.length > 0 || activeObjectList.length > 0;
  const currentLineNo = traceLineNo(activeStep);
  const currentLineDisplay = stripLineComment(activeStep?.line, traceLanguage).trim() || activeStep?.line?.trim() || "";
  const lineCardLabel = activeStep?.phase === "after_previous_line" ? "Next line" : activeStep?.event === "return" ? "Return line" : activeStep?.event === "exception" ? "Error line" : "Current line";
  const currentFrameBindings = useMemo(
    () => Object.entries(currentFrame?.bindings || {}),
    [currentFrame]
  );
  const currentFrameLocalNames = useMemo(
    () => Object.fromEntries(currentFrameBindings.map(([name]) => [name, true])),
    [currentFrameBindings]
  );
  const currentLineBindingNames = useMemo(
    () => new Set(extractLineVariableNames(currentLineDisplay || activeStep?.line || "", currentFrameLocalNames)),
    [activeStep?.line, currentFrameLocalNames, currentLineDisplay]
  );
  const visibleCurrentFrameBindings = useMemo(
    () => currentFrameBindings.filter(([name, binding]) => {
      const changeKey = `${currentFrame?.function || ""}:${name}`;
      const isChanged = changedBindings.has(changeKey);
      const isUsedOnCurrentLine = currentLineBindingNames.has(name);
      const isCollection = isTraceCollectionBinding(binding, activeObjects);
      return !isCollection || isChanged || isUsedOnCurrentLine;
    }),
    [activeObjects, changedBindings, currentFrame?.function, currentFrameBindings, currentLineBindingNames]
  );
  const hiddenCurrentCollectionCount = Math.max(0, currentFrameBindings.length - visibleCurrentFrameBindings.length);
  const modalRef = useFocusTrap(true, { onEscape: onClose });
  const traceTitle = hasTraceSteps
    ? `${traceLanguage} execution trace`
    : traceCapability === "practice_only" || traceMode === "freeform_unavailable"
      ? `${traceLanguage} Practice trace only right now`
      : `${traceLanguage} trace unavailable`;
  const traceDescription = hasTraceSteps
    ? `Steps through the ${traceLanguage} code currently in your editor and shows what changes as it runs.`
    : traceCapability === "practice_only" || traceMode === "freeform_unavailable"
      ? `${traceLanguage} tracing currently works from authored Practice problems, where CS Navigator knows which function and test case to run.`
      : traceResult?.message || traceResult?.stderr || `${traceLanguage} tracing is not available for this run.`;

  const goToStep = useCallback((nextIndex) => {
    if (!trace.length) return;
    setStepIndex(Math.max(0, Math.min(trace.length - 1, nextIndex)));
  }, [trace.length]);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(false);
  }, [traceResult]);

  useEffect(() => {
    if (!currentLineNo) return;
    const lineElement = lineRefs.current.get(currentLineNo);
    lineElement?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [currentLineNo, stepIndex]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    if (!canGoNext) {
      setIsPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => goToStep(stepIndex + 1), Math.max(250, Math.round(900 / playbackSpeed)));
    return () => window.clearTimeout(timer);
  }, [canGoNext, goToStep, isPlaying, playbackSpeed, stepIndex]);

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
              <h3 id="code-trace-title">{traceTitle}</h3>
              <p id="code-trace-description">
                {traceDescription}
              </p>
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

          {!trace.length || isTracing ? (
            <div className="code-trace-actions">
              <button type="button" onClick={onTraceCode} disabled={isTracing}>
                {isTracing ? "Tracing..." : "Start trace"}
              </button>
            </div>
          ) : null}

          {trace.length ? (
            <>
              <div className="code-trace-stage">
                <section className="code-trace-code-window" aria-label="Executed code">
                  <div>
                    <span>Step {stepIndex + 1} of {trace.length}</span>
                    <strong>{activeStep?.function}</strong>
                    <code>line {currentLineNo}</code>
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
                        className={lineNo === currentLineNo ? "is-active" : ""}
                      >
                        <em>{lineNo}</em>
                        <code>{line || " "}</code>
                      </span>
                    ))}
                  </pre>
                </section>

                <aside className="code-trace-state-panel" aria-label="Current trace state">
                  <div>
                    <span>Current step</span>
                    <h4>{activeExplanation}</h4>
                  </div>
                  {activeStep?.line ? (
                    <div className="code-trace-current-line">
                      <span>{lineCardLabel}</span>
                      <code>{currentLineDisplay}</code>
                    </div>
                  ) : null}
                  {activeErrorInfo ? (
                    <div className="code-trace-error-card">
                      <span>{activeErrorInfo.label}</span>
                      <strong>{activeErrorInfo.message}</strong>
                      {activeErrorInfo.cause ? <p>{activeErrorInfo.cause}</p> : null}
                      <p>{activeErrorInfo.location}</p>
                    </div>
                  ) : null}
                  {activeStep?.return_value != null ? (
                    <div className="code-trace-result-box">
                      <span>Returned value</span>
                      <strong>
                        {isTraceV2 ? <TraceV2Value binding={activeStep.return_value} objects={activeObjects} /> : <TraceValue value={activeStep.return_value} />}
                      </strong>
                    </div>
                  ) : null}
                  {screenOutput ? (
                    <div className="code-trace-output-box">
                      <span>{canGoNext ? "Screen output so far" : "Final screen output"}</span>
                      <pre>{screenOutput}</pre>
                    </div>
                  ) : null}
                  <div className="code-trace-variable-updates" aria-label="Variable updates for this trace step">
                    <span>{isTraceV2 ? "Variables used now" : "Variable updates"}</span>
                    {isTraceV2 ? (
                      currentFrame ? (
                        <div className="code-trace-v2-graph">
                          <section className="code-trace-v2-frames" aria-label="Current variables">
                            <article className="code-trace-v2-frame is-current">
                              <div className="code-trace-frame-head">
                                <span>Current function</span>
                                <strong>{currentFrame.function}</strong>
                              </div>
                              <div className="code-trace-frame-locals">
                                {visibleCurrentFrameBindings.length ? visibleCurrentFrameBindings.map(([name, binding]) => {
                                  const changeKey = `${currentFrame.function}:${name}`;
                                  const isChanged = changedBindings.has(changeKey);
                                  return (
                                    <div
                                      key={`${currentFrame.frame_id}-${name}`}
                                      className={`code-trace-frame-local ${isChanged ? "is-changed" : "is-same"} ${binding?.kind === "reference" ? "is-reference" : "is-scalar"}`}
                                    >
                                      <strong>{name}</strong>
                                      <span>{isChanged ? "changed" : "stored"}</span>
                                      <TraceV2Value binding={binding} objects={activeObjects} />
                                    </div>
                                  );
                                }) : (
                                  <p className="code-trace-no-declared-vars">
                                    {currentFrameBindings.length
                                      ? "Stored lists and dictionaries are under More trace details."
                                      : "No variables captured in this frame yet."}
                                  </p>
                                )}
                                {hiddenCurrentCollectionCount ? (
                                  <p className="code-trace-no-declared-vars">
                                    {hiddenCurrentCollectionCount} stored collection{hiddenCurrentCollectionCount === 1 ? "" : "s"} tucked under More trace details.
                                  </p>
                                ) : null}
                              </div>
                            </article>
                          </section>
                          {showMoreTraceDetails ? (
                            <details className="code-trace-more-details">
                              <summary>More trace details</summary>
                              {activeCallStack.length > 1 ? (
                                <div className="code-trace-call-stack">
                                  <span>Function path</span>
                                  <ol>
                                    {activeCallStack.map((name, index) => (
                                      <li key={`${name}-${index}`} className={index === activeCallStack.length - 1 ? "is-current" : ""}>
                                        {name}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              ) : null}
                              {hiddenFrames.length ? (
                                <section className="code-trace-v2-frames" aria-label="Waiting function variables">
                                  {hiddenFrames.map((frame, frameIndex) => (
                                    <article
                                      key={`${frame.frame_id}-${frameIndex}`}
                                      className="code-trace-v2-frame"
                                    >
                                      <div className="code-trace-frame-head">
                                        <span>Waiting function</span>
                                        <strong>{frame.function}</strong>
                                      </div>
                                      <div className="code-trace-frame-locals">
                                        {Object.entries(frame.bindings || {}).length ? Object.entries(frame.bindings || {}).map(([name, binding]) => (
                                          <div
                                            key={`${frame.frame_id}-${name}`}
                                            className={`code-trace-frame-local is-same ${binding?.kind === "reference" ? "is-reference" : "is-scalar"}`}
                                          >
                                            <strong>{name}</strong>
                                            <span>stored</span>
                                            <TraceV2Value binding={binding} objects={activeObjects} />
                                          </div>
                                        )) : (
                                          <p className="code-trace-no-declared-vars">No variables captured in this frame yet.</p>
                                        )}
                                      </div>
                                    </article>
                                  ))}
                                </section>
                              ) : null}
                              {activeObjectList.length ? (
                                <section className="code-trace-v2-heap" aria-label="Lists and objects">
                                  <div className="code-trace-frame-head">
                                    <span>Lists and objects</span>
                                    <strong>{activeObjectList.length}</strong>
                                  </div>
                                  <div className="code-trace-v2-object-grid">
                                    {activeObjectList.map(({ object, label }) => (
                                      <TraceV2ObjectCard
                                        key={object.object_id}
                                        object={object}
                                        label={label}
                                        objects={activeObjects}
                                        objectLabels={objectLabels}
                                        isChanged={changedObjects.has(object.object_id)}
                                      />
                                    ))}
                                  </div>
                                </section>
                              ) : null}
                            </details>
                          ) : null}
                        </div>
                      ) : (
                        <p className="code-trace-no-declared-vars">No frame data captured for this step.</p>
                      )
                    ) : variableStore.length ? (
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
                <div className="code-trace-footer-status">
                  <strong>Step {stepIndex + 1} of {trace.length}</strong>
                </div>
                <div className="code-trace-footer-actions">
                  <button
                    type="button"
                    className="code-trace-icon-button"
                    disabled={!canGoBack}
                    onClick={() => { setIsPlaying(false); goToStep(0); }}
                    aria-label="Go to first step"
                    title="First step"
                  >
                    <FaFastBackward aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="code-trace-icon-button"
                    disabled={!canGoBack}
                    onClick={() => { setIsPlaying(false); goToStep(stepIndex - 1); }}
                    aria-label="Go to previous step"
                    title="Previous step"
                  >
                    <FaStepBackward aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="code-trace-icon-button code-trace-play-toggle"
                    disabled={!canGoNext && !isPlaying}
                    onClick={() => setIsPlaying((current) => !current)}
                    aria-label={isPlaying ? "Pause trace" : "Play trace"}
                    title={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="code-trace-icon-button"
                    disabled={!canGoNext}
                    onClick={() => { setIsPlaying(false); goToStep(stepIndex + 1); }}
                    aria-label="Go to next step"
                    title="Next step"
                  >
                    <FaStepForward aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="code-trace-icon-button"
                    disabled={!canGoNext}
                    onClick={() => { setIsPlaying(false); goToStep(trace.length - 1); }}
                    aria-label="Go to last step"
                    title="Last step"
                  >
                    <FaFastForward aria-hidden="true" />
                  </button>
                </div>
                <label className="code-trace-speed-control">
                  <span>Speed</span>
                  <select
                    value={playbackSpeed}
                    onChange={(event) => setPlaybackSpeed(Number(event.target.value))}
                    aria-label="Trace playback speed"
                  >
                    <option value={0.75}>0.75x</option>
                    <option value={1}>1x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2x</option>
                  </select>
                </label>
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
  guideToggle = null,
}) {
  const [caret, setCaret] = useState({ line: 1, col: 1, chars: 0 });
  const [terminalHeight, setTerminalHeight] = useState(readStoredTerminalHeight);
  const [isTerminalDragging, setIsTerminalDragging] = useState(false);
  const stackRef = useRef(null);
  const dragState = useRef(null);
  const canTraceLanguage = useMemo(
    () => selectedLanguage === "Python" || selectedLanguage === "JavaScript" || selectedLanguage === "Java" || selectedLanguage === "C++",
    [selectedLanguage],
  );

  const clampTerminalHeight = useCallback((height) => {
    const stack = stackRef.current;
    const available = stack ? stack.getBoundingClientRect().height : window.innerHeight;
    const bounds = terminalResizeBounds(available);
    return Math.min(bounds.maxHeight, Math.max(bounds.minHeight, height));
  }, []);

  // Drag-to-resize the docked terminal. We resize from the divider: dragging up
  // grows the terminal, dragging down shrinks it. Height is clamped + persisted.
  const onDividerPointerDown = useCallback((event) => {
    event.preventDefault();
    const stack = stackRef.current;
    const available = stack ? stack.getBoundingClientRect().height : window.innerHeight;
    const stackBottom = stack?.getBoundingClientRect().bottom ?? null;
    const bounds = terminalResizeBounds(available);
    dragState.current = {
      startY: event.clientY,
      startHeight: clampTerminalHeight(terminalHeight),
      stackBottom,
      // Never let the terminal eat the whole stack — leave room for the editor.
      minForStack: bounds.minHeight,
      maxForStack: bounds.maxHeight,
    };
    setIsTerminalDragging(true);
    document.body.classList.add("ct-terminal-resizing");
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
  }, [clampTerminalHeight, terminalHeight]);

  const onDividerPointerMove = useCallback((event) => {
    const state = dragState.current;
    if (!state) return;
    const pointerBasedHeight = state.stackBottom ? state.stackBottom - event.clientY : NaN;
    const deltaBasedHeight = state.startHeight + (state.startY - event.clientY);
    const rawHeight = Number.isFinite(pointerBasedHeight) ? pointerBasedHeight : deltaBasedHeight;
    const next = Math.min(state.maxForStack, Math.max(state.minForStack, rawHeight));
    setTerminalHeight(next);
  }, []);

  const endDrag = useCallback(() => {
    if (!dragState.current) return;
    dragState.current = null;
    setIsTerminalDragging(false);
    document.body.classList.remove("ct-terminal-resizing");
    setTerminalHeight((value) => {
      const next = clampTerminalHeight(value);
      try {
        window.localStorage.setItem(TERMINAL_H_KEY, String(Math.round(next)));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }, [clampTerminalHeight]);

  // Keyboard resize on the divider for accessibility (Up/Down arrows).
  const onDividerKeyDown = useCallback((event) => {
    const step = event.shiftKey ? 48 : 16;
    const stack = stackRef.current;
    const available = stack ? stack.getBoundingClientRect().height : window.innerHeight;
    const bounds = terminalResizeBounds(available);
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setTerminalHeight((v) => Math.min(bounds.maxHeight, v + step));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setTerminalHeight((v) => Math.max(bounds.minHeight, v - step));
    }
  }, []);

  useEffect(() => {
    return () => document.body.classList.remove("ct-terminal-resizing");
  }, []);

  useEffect(() => {
    if (!isTerminalDragging) return undefined;
    const handleMove = (event) => {
      event.preventDefault();
      onDividerPointerMove(event);
    };
    const handleEnd = () => endDrag();
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [endDrag, isTerminalDragging, onDividerPointerMove]);

  useEffect(() => {
    const onResize = () => setTerminalHeight((height) => clampTerminalHeight(height));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampTerminalHeight]);

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
              disabled={!canTraceLanguage || isTracingCode}
              title={canTraceLanguage ? "Trace your actual code step by step" : "Code tracing is available for Python, JavaScript, Java, and C++"}
            >
              {isTracingCode ? "Tracing..." : "Trace My Code"}
            </button>
            {!canTraceLanguage ? (
              <span className="code-trace-language-note" role="status">
                Trace supports Python, JavaScript, Java, and C++
              </span>
            ) : null}
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
  const displayedTerminalHeight = clampTerminalHeight(terminalHeight);

  return (
    <main className="coding-editor-center">
      <div className="coding-pane-header">
        <div><span className="coding-kicker">Workspace</span><h2>{activeProblem?.title || "Code Editor"}</h2></div>
        {guideToggle ? (
          <button
            type="button"
            className="workspace-mobile-guide-toggle"
            onClick={guideToggle.onToggle}
            aria-expanded={guideToggle.isOpen}
            aria-controls="workspace-problem-guide-drawer"
          >
            {guideToggle.isOpen ? "Hide guide" : "Guide"}
          </button>
        ) : null}
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
      <div
        className={`editor-terminal-stack ${showTerminal ? "terminal-docked" : ""} ${isTerminalDragging ? "is-resizing-terminal" : ""}`}
        ref={stackRef}
      >
        <div className={`workspace-tab-body workspace-tab-body--${workspaceTab.toLowerCase()}`}>{renderTab()}</div>
        {showTerminal && (
          <>
            <div
              className="editor-terminal-divider"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize terminal"
              aria-valuemin={TERMINAL_MOBILE_MIN_H}
              aria-valuemax={TERMINAL_MAX_H}
              aria-valuenow={Math.round(displayedTerminalHeight)}
              aria-valuetext={`Terminal height ${Math.round(displayedTerminalHeight)} pixels`}
              tabIndex={0}
              onPointerDown={onDividerPointerDown}
              onPointerMove={onDividerPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onDividerKeyDown}
            >
              <span className="editor-terminal-divider-grip" aria-hidden="true" />
            </div>
            <div className="coding-dock-terminal" style={{ height: `${displayedTerminalHeight}px` }}>
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
        <WorkspaceVisualizerModal
          activeProblem={activeProblem}
          onClose={onCloseVisualizer}
          onOpenInWorkspace={() => {
            onCloseVisualizer();
            onTabChange("Visualize");
          }}
        />
      ) : null}
      {traceModalOpen ? (
        <CodeTraceModal
          traceResult={traceResult}
          code={code}
          selectedLanguage={selectedLanguage}
          isTracing={isTracingCode}
          onTraceCode={onTraceCode}
          onClose={onCloseTraceModal}
        />
      ) : null}
    </main>
  );
}
