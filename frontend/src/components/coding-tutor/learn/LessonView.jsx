import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaClock,
  FaArrowRight,
  FaArrowLeft,
  FaLightbulb,
  FaExclamationTriangle,
  FaTimesCircle,
  FaCheck,
  FaTimes,
  FaProjectDiagram,
  FaUndo,
  FaChevronLeft,
  FaChevronRight,
  FaPlay,
  FaPause,
  FaRedo,
} from "react-icons/fa";
import { markLessonRead } from "../concept-quiz/conceptQuizProgress";
import LessonPlayBar from "./LessonPlayBar";
import useFocusTrap from "../useFocusTrap";

// One lesson. Renders the authored block types (see backend/lessons.py) and ends with
// the handoff that gives Learn its purpose: "Practice this."
//
// Reading without doing doesn't stick. Every lesson exits into the quiz on the same
// topic, so Learn → Practice is one motion rather than two decisions.

const CALLOUT_ICON = {
  tip: FaLightbulb,
  warning: FaExclamationTriangle,
  mistake: FaTimesCircle,
};

const CALLOUT_DEFAULT_TITLE = {
  tip: "Tip",
  warning: "Watch out",
  mistake: "Common mistake",
};

// `inline code` → <code>. Authored prose uses backticks; anything else renders as-is.
// Deliberately NOT a markdown parser: lesson bodies are plain sentences, and pulling in
// a renderer would mean sanitizing HTML for content we already control.
function withInlineCode(text) {
  const codeParts = String(text || "").split(/(`[^`]+`)/g);
  return codeParts.flatMap((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return [<code key={`code-${i}`}>{part.slice(1, -1)}</code>];
    }
    return part.split(/(\*\*[^*]+\*\*)/g).map((piece, j) =>
      piece.startsWith("**") && piece.endsWith("**") && piece.length > 4 ? (
        <strong key={`strong-${i}-${j}`}>{piece.slice(2, -2)}</strong>
      ) : (
        piece
      )
    );
  });
}

const CODE_TOKEN_RE =
  /(\/\/.*|#.*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:def|class|return|if|else|elif|for|while|switch|case|default|break|continue|public|private|static|void|int|long|double|float|boolean|bool|String|const|let|var|function|new|import|from|include|using|namespace|std|this|self|in|range|print|System|out|println|console|log|true|false|null|None|True|False)\b|\b\d+(?:\.\d+)?\b)/g;

function codeTokenClass(token) {
  if (/^(\/\/|#|\/\*)/.test(token)) return "is-comment";
  if (/^["'`]/.test(token)) return "is-string";
  if (/^(true|false|null|None|True|False)$/.test(token)) return "is-literal";
  if (/^\d/.test(token)) return "is-number";
  return "is-keyword";
}

function highlightedCode(code) {
  const text = String(code || "");
  const pieces = [];
  let lastIndex = 0;

  text.replace(CODE_TOKEN_RE, (match, _token, offset) => {
    if (offset > lastIndex) pieces.push(text.slice(lastIndex, offset));
    pieces.push(
      <span key={`${offset}-${match}`} className={`lesson-code-token ${codeTokenClass(match)}`}>
        {match}
      </span>
    );
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < text.length) pieces.push(text.slice(lastIndex));
  return pieces;
}

function CodeText({ children }) {
  return <code>{highlightedCode(children)}</code>;
}

function traceEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (entry && typeof entry === "object") {
          return {
            name: entry.name || entry.key || entry.label || `Item ${index + 1}`,
            value: entry.value ?? entry.detail ?? entry.text ?? "",
          };
        }
        return { name: `Item ${index + 1}`, value: entry };
      })
      .filter((entry) => entry.value !== undefined && entry.value !== null && String(entry.value).trim() !== "");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([name, entryValue]) => ({ name, value: entryValue }))
      .filter((entry) => entry.value !== undefined && entry.value !== null && String(entry.value).trim() !== "");
  }
  return [{ name: "Value", value }];
}

function traceValueText(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entryValue]) => `${key}: ${entryValue}`)
      .join(", ");
  }
  return String(value || "");
}

function conceptKind(concept = "") {
  const value = String(concept).toLowerCase();
  if (value.includes("conditional") || value.includes("branch")) return "conditionals";
  if (value.includes("loop") || value.includes("iteration")) return "loops";
  if (value.includes("debug")) return "debugging";
  if (
    value.includes("comprehension") ||
    value.includes("stream") ||
    value.includes("async") ||
    value.includes("promise") ||
    value.includes("exception") ||
    value.includes("error-handling") ||
    value.includes("file") ||
    value.includes("inheritance") ||
    value.includes("interface") ||
    value.includes("generic") ||
    value.includes("ownership")
  ) return "process-flow";
  if (value.includes("pointer") || value.includes("reference")) return "pointers";
  if (value.includes("algorithm") || value.includes("state-trace") || value.includes("best-so-far")) return "state-trace";
  if (value.includes("stack")) return "stack";
  if (value.includes("queue")) return "queue";
  if (value.includes("linked")) return "linked-list";
  if (value.includes("list")) return "lists";
  if (value.includes("tree")) return "tree";
  if (value.includes("graph")) return "graph";
  if (value.includes("hash") || value.includes("map") || value.includes("set") || value.includes("object")) return "map";
  if (value.includes("function")) return "functions";
  if (value.includes("recursion")) return "call-stack";
  return "array";
}

function activeIndexes(active = []) {
  return new Set((active || []).map((value) => Number(value)));
}

function visibleNodeLabel(node) {
  return node?.label || node?.value || node?.id || "";
}

function VisualTokenRow({ items = [], active = [], pointers = {}, window = null, mode = "array" }) {
  const activeSet = activeIndexes(active);
  const pointerEntries = Object.entries(pointers || {});
  const windowStart = Array.isArray(window) ? window[0] : null;
  const windowEnd = Array.isArray(window) ? window[1] : null;

  return (
    <div className={`lesson-visual-row is-${mode}`} aria-label="Visualizer values">
      {items.map((item, index) => {
        const pointerLabels = pointerEntries
          .filter(([, value]) => value === index)
          .map(([label]) => label);
        const inWindow =
          Number.isInteger(windowStart) &&
          Number.isInteger(windowEnd) &&
          index >= windowStart &&
          index <= windowEnd;
        return (
          <div
            key={`${item}-${index}`}
            className={`lesson-visual-token ${activeSet.has(index) ? "is-active" : ""} ${
              inWindow ? "is-window" : ""
            } ${
              Number.isInteger(windowStart) &&
              Number.isInteger(windowEnd) &&
              !inWindow &&
              (mode === "binary-search" || mode === "sliding-window")
                ? "is-dimmed"
                : ""
            }`}
          >
            <small>{pointerLabels.length ? pointerLabels.join(" / ") : index}</small>
            <span>{item}</span>
          </div>
        );
      })}
    </div>
  );
}

function VisualStack({ items = [], active = [] }) {
  const activeSet = activeIndexes(active);
  return (
    <div className="lesson-visual-stack-shell" aria-label="Stack state">
      <span className="lesson-visual-structure-label">top</span>
      <div className="lesson-visual-stack">
        {items.length ? (
          items.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className={`lesson-visual-token ${activeSet.has(index) ? "is-active" : ""}`}
              style={{ zIndex: index + 1 }}
            >
              <small>{index === items.length - 1 ? "top" : index === 0 ? "bottom" : `level ${index}`}</small>
              <span>{item}</span>
            </div>
          ))
        ) : (
          <p className="lesson-visual-empty">empty stack</p>
        )}
      </div>
      <span className="lesson-visual-stack-base">bottom</span>
    </div>
  );
}

function VisualQueue({ items = [], active = [] }) {
  const activeSet = activeIndexes(active);
  return (
    <div className="lesson-visual-queue-shell" aria-label="Queue state">
      <span className="lesson-visual-structure-label">front leaves first</span>
      <div className="lesson-visual-queue">
        {items.length ? (
          items.map((item, index) => (
            <div key={`${item}-${index}`} className="lesson-visual-queue-item">
              <div className={`lesson-visual-token ${activeSet.has(index) ? "is-active" : ""}`}>
                <small>{index === 0 ? "front" : index === items.length - 1 ? "rear" : index}</small>
                <span>{item}</span>
              </div>
              {index < items.length - 1 ? <span className="lesson-visual-inline-arrow" aria-hidden="true" /> : null}
            </div>
          ))
        ) : (
          <p className="lesson-visual-empty">empty queue</p>
        )}
      </div>
      <span className="lesson-visual-structure-label">new items join at rear</span>
    </div>
  );
}

function VisualTable({ rows = [] }) {
  return (
    <div className="lesson-visual-table" aria-label="Table state">
      {rows.map((row, index) => (
        <div
          key={`${row.key}-${index}`}
          className={`lesson-visual-table-row ${row.active ? "is-active" : ""}`}
        >
          <span>{row.key}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function orderedLinkedNodes(nodes = [], edges = []) {
  if (!nodes.length) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const targets = new Set(edges.map((edge) => edge.to));
  const first =
    nodes.find((node) => String(node.note || "").toLowerCase().includes("head")) ||
    nodes.find((node) => !targets.has(node.id)) ||
    nodes[0];
  const order = [];
  const seen = new Set();
  let current = first;
  while (current && !seen.has(current.id)) {
    order.push(current);
    seen.add(current.id);
    const nextEdge = edges.find((edge) => edge.from === current.id && byId.has(edge.to));
    current = nextEdge ? byId.get(nextEdge.to) : null;
  }
  nodes.forEach((node) => {
    if (!seen.has(node.id)) order.push(node);
  });
  return order;
}

function VisualLinkedList({ nodes = [], edges = [] }) {
  const ordered = orderedLinkedNodes(nodes, edges);
  if (!ordered.length) return null;
  return (
    <div className="lesson-visual-linked" aria-label="Linked list state">
      <span className="lesson-visual-head-label">head</span>
      <div className="lesson-visual-linked-row">
        {ordered.map((node) => (
          <div className="lesson-visual-linked-item" key={node.id}>
            <div className={`lesson-visual-linked-node ${node.active ? "is-active" : ""}`}>
              <span className="lesson-visual-linked-value">{visibleNodeLabel(node)}</span>
              <span className="lesson-visual-linked-next">next</span>
            </div>
            <span
              className={`lesson-visual-inline-arrow ${
                edges.some((edge) => edge.from === node.id && edge.active) ? "is-active" : ""
              }`}
              aria-hidden="true"
            />
          </div>
        ))}
        <div className="lesson-visual-null-node">null</div>
      </div>
    </div>
  );
}

function normalizedNodePositions(nodes = []) {
  if (!nodes.length) return new Map();
  const xs = nodes.map((node) => Number(node.x) || 0);
  const ys = nodes.map((node) => Number(node.y) || 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  return new Map(
    nodes.map((node) => [
      node.id,
      {
        x: 14 + (((Number(node.x) || 0) - minX) / spanX) * 72,
        y: 18 + (((Number(node.y) || 0) - minY) / spanY) * 64,
      },
    ])
  );
}

function VisualNodes({ nodes = [], edges = [], kind = "tree" }) {
  if (!nodes.length) return null;
  const positions = normalizedNodePositions(nodes);
  return (
    <div className={`lesson-visual-node-canvas is-${kind}`} role="img" aria-label={`${kind} diagram`}>
      <svg className="lesson-visual-edge-layer" viewBox="0 0 100 100" aria-hidden="true">
        {edges.map((edge, index) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          return (
            <path
              key={`${edge.from}-${edge.to}-${index}`}
              d={`M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`}
              className={`lesson-visual-edge ${edge.active ? "is-active" : ""}`}
            />
          );
        })}
      </svg>
      {nodes.map((node) => (
        <div
          key={node.id}
          className={`lesson-visual-flow-node ${node.active ? "is-active" : ""}`}
          style={{
            left: `${positions.get(node.id)?.x || 50}%`,
            top: `${positions.get(node.id)?.y || 50}%`,
          }}
        >
          <strong>{visibleNodeLabel(node)}</strong>
          {node.note ? <small>{node.note}</small> : null}
        </div>
      ))}
    </div>
  );
}

function VisualKeyValueFlow({ state, kind = "map" }) {
  const rows = state.table || [];
  const flow = state.map_flow || state.object_flow || {};
  const activeId = String(state.active_step || flow.active || "store");
  const cards = [
    ["store", kind === "map" ? "Stored pairs" : "State", flow.store || flow.setup || "Keys hold values", "terminator"],
    ["action", "Action", flow.action || "Read, add, or update one entry", "input"],
    ["decision", "Check", flow.decision || "Does the key or value already exist?", "diamond"],
    ["result", "Result", flow.result || state.note || "Use the stored state", "terminator"],
  ];

  return (
    <div className={`lesson-visual-kv-flow is-${kind}`} aria-label={`${kind} visual state`}>
      <div className="lesson-visual-kv-steps">
        {cards.map(([id, label, detail, shape], index) => (
          <div className="lesson-visual-kv-step" key={id}>
            <VisualFlowCard
              id={id}
              label={label}
              detail={detail}
              active={activeId === id}
              shape={shape}
            />
            {index < cards.length - 1 ? (
              <span
                className={`lesson-visual-flow-arrow ucv-inline-arrow ${
                  cards.findIndex(([nextId]) => nextId === activeId) > index ? "is-active" : ""
                }`}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
      {rows.length ? (
        <div className="lesson-visual-kv-board">
          {rows.map((row, index) => (
            <div
              key={`${row.key}-${index}`}
              className={`lesson-visual-kv-card ${row.active ? "is-active" : ""}`}
            >
              <small>{row.key}</small>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VisualPointerFlow({ state }) {
  const flow = state.pointer_flow || {};
  const activeId = String(state.active_step || flow.active || "value");
  const cards = [
    ["value", "Value", flow.value || "score = 92", "terminator"],
    ["address", "Address", flow.address || "&score", "input"],
    ["pointer", "Pointer", flow.pointer || "ptr stores that address", "card"],
    ["dereference", "Dereference", flow.dereference || "*ptr reads the target", "input"],
    ["guard", "Guard", flow.guard || "check for nullptr before following", "terminator"],
  ];

  return (
    <div className="lesson-visual-pointer-flow" aria-label="Pointer reference trace">
      <div className="lesson-visual-pointer-track">
        {cards.map(([id, label, detail, shape], index) => (
          <div className="lesson-visual-pointer-step" key={id}>
            <VisualFlowCard
              id={id}
              label={label}
              detail={detail}
              active={activeId === id}
              shape={shape}
            />
            {index < cards.length - 1 ? (
              <span
                className={`lesson-visual-flow-arrow ucv-inline-arrow ${
                  cards.findIndex(([nextId]) => nextId === activeId) > index ? "is-active" : ""
                }`}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
      {state.table ? <VisualKeyValueFlow state={{ ...state, map_flow: flow }} kind="pointer-state" /> : null}
    </div>
  );
}

function VisualDebugTrace({ state }) {
  const trace = state.debug_trace || {};
  const activeId = String(state.active_step || trace.active || "before");
  const cards = [
    ["before", "Before", trace.before || "State still matches", "terminator"],
    ["expected", "Expected", trace.expected || "What should change", "input"],
    ["actual", "Actual", trace.actual || "What changed instead", "diamond"],
    ["fix", "Fix", trace.fix || "Correct the transition", "terminator"],
  ];

  return (
    <div className="lesson-visual-debug-flow" aria-label="Debug state trace">
      <div className="lesson-visual-debug-steps">
        {cards.map(([id, label, detail, shape], index) => (
          <div className="lesson-visual-debug-step" key={id}>
            <VisualFlowCard
              id={id}
              label={label}
              detail={detail}
              active={activeId === id}
              shape={shape}
            />
            {index < cards.length - 1 ? (
              <span
                className={`lesson-visual-flow-arrow ucv-inline-arrow ${
                  cards.findIndex(([nextId]) => nextId === activeId) > index ? "is-active" : ""
                }`}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
      {state.table ? <VisualTable rows={state.table} /> : null}
    </div>
  );
}

function VisualProcessFlow({ state }) {
  const flow = state.process_flow || {};
  const activeId = String(state.active_step || flow.active || "start");
  const cards = Array.isArray(flow.steps) && flow.steps.length
    ? flow.steps
    : [
        { id: "start", label: "Start", detail: flow.start || "Begin with the current state", shape: "terminator" },
        { id: "action", label: "Action", detail: flow.action || "Run the next step", shape: "input" },
        { id: "check", label: "Check", detail: flow.check || "Decide what path applies", shape: "diamond" },
        { id: "result", label: "Result", detail: flow.result || state.note || "Use the final state", shape: "terminator" },
      ];

  return (
    <div className="lesson-visual-process-flow" aria-label="Process flow trace">
      <div className="lesson-visual-process-track">
        {cards.map((card, index) => (
          <div className="lesson-visual-process-step" key={card.id || index}>
            <VisualFlowCard
              id={card.id || `step-${index}`}
              label={card.label || `Step ${index + 1}`}
              detail={card.detail || ""}
              active={activeId === card.id}
              shape={card.shape || "card"}
            />
            {index < cards.length - 1 ? (
              <span
                className={`lesson-visual-flow-arrow ucv-inline-arrow ${
                  cards.findIndex((item) => item.id === activeId) > index ? "is-active" : ""
                }`}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
      {Array.isArray(state.items) && state.items.length ? (
        <VisualListTrace state={state} />
      ) : null}
      {state.table ? <VisualTable rows={state.table} /> : null}
    </div>
  );
}

function VisualCallStack({ calls = [], activeCall = 0 }) {
  return (
    <div className="lesson-visual-call-stack" aria-label="Call stack state">
      {calls.map((call, index) => (
        <div
          key={`${call}-${index}`}
          className={`lesson-visual-token ${index === activeCall ? "is-active" : ""}`}
        >
          <small>{index === calls.length - 1 ? "current call" : `call ${index + 1}`}</small>
          <span>{call}</span>
        </div>
      ))}
    </div>
  );
}

function conditionalFlowValue(flow, key, fallback = "") {
  const value = flow?.[key];
  if (typeof value === "object" && value !== null) {
    return value.label || value.text || value.value || fallback;
  }
  return value || fallback;
}

function VisualFlowCard({ id, label, detail, active, shape = "card" }) {
  const semanticId = String(id || "").toLowerCase();
  const semanticLabel = String(label || "").toLowerCase();
  const isResult =
    semanticId.includes("result") ||
    semanticId.includes("output") ||
    semanticId === "done" ||
    semanticId === "end" ||
    semanticId === "return" ||
    semanticId === "resume" ||
    semanticLabel.includes("result") ||
    semanticLabel.includes("output") ||
    semanticLabel.includes("done") ||
    semanticLabel.includes("return");
  return (
    <div
      className={`lesson-visual-flow-symbol ucv-flow-node-card ucv-flow-node-card--${shape} is-${shape} ${isResult ? "is-result ucv-flow-node-card--result" : ""} ${active ? "is-active ucv-flow-node-card--active" : ""}`}
      data-flow-id={id}
    >
      <strong>{label}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function VisualConditionalFlow({ flow = {}, active = "", path = "" }) {
  const activeId = String(active || flow.active || "");
  const activePath = String(path || flow.path || "");
  const resultActive = activeId === "result" || activeId === "end";
  const trueActive = activeId === "true" || activeId === "true_branch" || (resultActive && activePath === "true");
  const falseActive = activeId === "false" || activeId === "false_branch" || (resultActive && activePath === "false");

  return (
    <div className="lesson-visual-conditional" aria-label="Conditional flowchart">
      <VisualFlowCard
        id="start"
        label="Start"
        detail={conditionalFlowValue(flow, "start", "Begin")}
        active={activeId === "start"}
        shape="terminator"
      />
      <span className="lesson-visual-flow-arrow ucv-inline-arrow" aria-hidden="true" />
      <VisualFlowCard
        id="input"
        label="Input"
        detail={conditionalFlowValue(flow, "input", "Use the starting value")}
        active={activeId === "input"}
        shape="input"
      />
      <span className="lesson-visual-flow-arrow ucv-inline-arrow" aria-hidden="true" />
      <VisualFlowCard
        id="condition"
        label="Condition"
        detail={conditionalFlowValue(flow, "condition", "Ask a true/false question")}
        active={activeId === "condition"}
        shape="diamond"
      />
      <div className="lesson-visual-branch-split">
        <div className={`lesson-visual-branch is-true ${trueActive ? "is-active" : ""}`}>
          <span className="lesson-visual-branch-label">{flow.true_label || "True"}</span>
          <span className="lesson-visual-flow-arrow ucv-inline-arrow" aria-hidden="true" />
          <VisualFlowCard
            id="true_branch"
            label="True branch"
            detail={conditionalFlowValue(flow, "true_branch", "Run this path")}
            active={trueActive}
            shape="branch"
          />
        </div>
        <div className={`lesson-visual-branch is-false ${falseActive ? "is-active" : ""}`}>
          <span className="lesson-visual-branch-label">{flow.false_label || "False"}</span>
          <span className="lesson-visual-flow-arrow ucv-inline-arrow" aria-hidden="true" />
          <VisualFlowCard
            id="false_branch"
            label="False branch"
            detail={conditionalFlowValue(flow, "false_branch", "Try the next path")}
            active={falseActive}
            shape="branch"
          />
        </div>
      </div>
      <span
        className={`lesson-visual-flow-arrow ucv-inline-arrow ${resultActive ? "is-active" : ""}`}
        aria-hidden="true"
      />
      <VisualFlowCard
        id="result"
        label="Result"
        detail={conditionalFlowValue(flow, "result", "Use the chosen answer")}
        active={resultActive}
        shape="terminator"
      />
    </div>
  );
}

function VisualLoopFlow({ flow = {}, active = "" }) {
  const activeId = String(active || flow.active || "setup");
  const order = [
    ["setup", "Setup", "Start values"],
    ["condition", "Condition", "Should the loop run?"],
    ["body", "Body", "Do the repeated work"],
    ["update", "Update", "Move to the next pass"],
    ["done", "Done", "Use the final result"],
  ];

  return (
    <div className="lesson-visual-loop-shell">
      <div className="lesson-visual-loop-flow" aria-label="Loop flowchart">
        {order.map(([id, label, fallback], index) => (
          <div className="lesson-visual-loop-step" key={id}>
            <VisualFlowCard
              id={id}
              label={label}
              detail={conditionalFlowValue(flow, id, fallback)}
              active={activeId === id}
              shape={id === "condition" ? "diamond" : id === "setup" || id === "done" ? "terminator" : "input"}
            />
            {index < order.length - 1 ? (
              <span
                className={`lesson-visual-flow-arrow ucv-inline-arrow ${
                  order.findIndex(([nextId]) => nextId === activeId) > index ? "is-active" : ""
                }`}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className={`lesson-visual-loop-back ${["condition", "body", "update"].includes(activeId) ? "is-active" : ""}`}>
        <span>after update, check the condition again</span>
      </div>
    </div>
  );
}

function VisualListTrace({ state }) {
  const items = state.items || state.array || state.values || [];
  const activeSet = activeIndexes(state.active);
  const pointerEntries = Object.entries(state.pointers || {});
  const listState = state.list_state || {};

  return (
    <div className="lesson-visual-list-trace" aria-label="List index trace">
      <div className="lesson-visual-list-meta">
        <VisualFlowCard
          id="list-action"
          label={listState.action || "List action"}
          detail={listState.detail || state.note || "Read or change one slot"}
          active
          shape="input"
        />
        <VisualFlowCard
          id="list-result"
          label={listState.name || "List"}
          detail={listState.result || `length ${items.length}`}
          active={String(state.active_step || "").includes("result")}
          shape="terminator"
        />
      </div>
      <div className="lesson-visual-list-track">
        {items.map((item, index) => {
          const pointerLabels = pointerEntries
            .filter(([, value]) => value === index)
            .map(([label]) => label);
          return (
            <div
              key={`${item}-${index}`}
              className={`lesson-visual-list-cell ${activeSet.has(index) ? "is-active" : ""}`}
            >
              <small>index {index}</small>
              <strong>{item}</strong>
              {pointerLabels.length ? (
                <span className="lesson-visual-list-pointer">{pointerLabels.join(" / ")}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VisualFunctionFlow({ state }) {
  const flow = state.function_flow || {};
  const activeId = String(state.active_step || flow.active || "caller");
  const cells = [
    ["caller", "Caller", flow.caller || "The line that asks for work", "terminator"],
    ["arguments", "Arguments", flow.arguments || "Values sent in", "input"],
    ["parameters", "Function frame", flow.parameters || "Parameters receive values", "card"],
    ["return", "Return", flow.return_value || "Send one answer back", "input"],
    ["resume", "Caller resumes", flow.resume || "Use the returned value", "terminator"],
  ];

  return (
    <div className="lesson-visual-function-flow" aria-label="Function call flow">
      <div className="lesson-visual-function-main">
        {cells.map(([id, label, detail, shape], index) => (
          <div className="lesson-visual-function-step" key={id}>
            <VisualFlowCard
              id={id}
              label={label}
              detail={detail}
              active={activeId === id}
              shape={shape}
            />
            {index < cells.length - 1 ? (
              <span
                className={`lesson-visual-flow-arrow ucv-inline-arrow ${
                  cells.findIndex(([nextId]) => nextId === activeId) > index ? "is-active" : ""
                }`}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
      {flow.locals ? (
        <div className={`lesson-visual-function-locals ${activeId === "parameters" ? "is-active" : ""}`}>
          <small>Local state</small>
          <strong>{flow.locals}</strong>
        </div>
      ) : null}
    </div>
  );
}

function VisualStateTrace({ state }) {
  const trace = state.state_trace || {};
  const activeId = String(state.active_step || trace.active || "input");
  const items = state.items || state.array || state.values || [];
  const cards = [
    ["input", "Input", trace.input || "A small example", "terminator"],
    ["current", "Active item", trace.current || "Look at one value", "input"],
    ["compare", "Compare", trace.comparison || "Ask whether state changes", "diamond"],
    ["state", "Tracked state", trace.tracked || "Keep or update memory", "card"],
    ["result", "Result", trace.result || "Use the final state", "terminator"],
  ];

  return (
    <div className="lesson-visual-state-trace" aria-label="Algorithm state trace">
      <div className="lesson-visual-state-flow">
        {cards.map(([id, label, detail, shape], index) => (
          <div className="lesson-visual-state-step" key={id}>
            <VisualFlowCard
              id={id}
              label={label}
              detail={detail}
              active={activeId === id}
              shape={shape}
            />
            {index < cards.length - 1 ? (
              <span
                className={`lesson-visual-flow-arrow ucv-inline-arrow ${
                  cards.findIndex(([nextId]) => nextId === activeId) > index ? "is-active" : ""
                }`}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
      {items.length ? (
        <VisualListTrace
          state={{
            ...state,
            list_state: {
              action: trace.decision || "Trace the next item",
              detail: trace.current || state.note,
              name: "Best so far",
              result: trace.tracked || state.note,
            },
          }}
        />
      ) : null}
    </div>
  );
}

function visualAnimationClass(step) {
  const animation = String(step?.animation || "").trim().toLowerCase();
  if (!animation) return "";
  return `anim-${animation.replace(/[^a-z0-9-]/g, "-")}`;
}

function VisualDiagram({ block, step }) {
  const initialState = block.initial_state || {};
  const stepState = step.state || {};
  const state = {
    ...initialState,
    ...stepState,
    condition_flow:
      initialState.condition_flow || stepState.condition_flow
        ? { ...(initialState.condition_flow || {}), ...(stepState.condition_flow || {}) }
        : undefined,
    loop_flow:
      initialState.loop_flow || stepState.loop_flow
        ? { ...(initialState.loop_flow || {}), ...(stepState.loop_flow || {}) }
        : undefined,
    list_state:
      initialState.list_state || stepState.list_state
        ? { ...(initialState.list_state || {}), ...(stepState.list_state || {}) }
        : undefined,
    function_flow:
      initialState.function_flow || stepState.function_flow
        ? { ...(initialState.function_flow || {}), ...(stepState.function_flow || {}) }
        : undefined,
    state_trace:
      initialState.state_trace || stepState.state_trace
        ? { ...(initialState.state_trace || {}), ...(stepState.state_trace || {}) }
        : undefined,
    map_flow:
      initialState.map_flow || stepState.map_flow
        ? { ...(initialState.map_flow || {}), ...(stepState.map_flow || {}) }
        : undefined,
    object_flow:
      initialState.object_flow || stepState.object_flow
        ? { ...(initialState.object_flow || {}), ...(stepState.object_flow || {}) }
        : undefined,
    pointer_flow:
      initialState.pointer_flow || stepState.pointer_flow
        ? { ...(initialState.pointer_flow || {}), ...(stepState.pointer_flow || {}) }
        : undefined,
    debug_trace:
      initialState.debug_trace || stepState.debug_trace
        ? { ...(initialState.debug_trace || {}), ...(stepState.debug_trace || {}) }
        : undefined,
    process_flow:
      initialState.process_flow || stepState.process_flow
        ? { ...(initialState.process_flow || {}), ...(stepState.process_flow || {}) }
        : undefined,
  };
  const mainItems = state.items || state.array || state.values || state.queue || [];
  const kind = conceptKind(block.concept);
  const rowMode = String(block.concept || "").toLowerCase();
  return (
    <div className={`lesson-visual-diagram is-${kind} ${visualAnimationClass(step)}`}>
      {kind === "conditionals" && state.condition_flow ? (
        <VisualConditionalFlow
          flow={state.condition_flow}
          active={state.active_step}
          path={state.path}
        />
      ) : null}
      {kind === "loops" && state.loop_flow ? (
        <VisualLoopFlow flow={state.loop_flow} active={state.active_step} />
      ) : null}
      {kind === "lists" ? <VisualListTrace state={state} /> : null}
      {kind === "functions" && state.function_flow ? <VisualFunctionFlow state={state} /> : null}
      {kind === "state-trace" ? <VisualStateTrace state={state} /> : null}
      {kind === "map" ? <VisualKeyValueFlow state={state} kind={rowMode.includes("object") ? "object" : rowMode.includes("set") ? "set" : "map"} /> : null}
      {kind === "pointers" ? <VisualPointerFlow state={state} /> : null}
      {kind === "debugging" ? <VisualDebugTrace state={state} /> : null}
      {kind === "process-flow" ? <VisualProcessFlow state={state} /> : null}
      {state.stack ? <VisualStack items={state.stack} active={state.active} /> : null}
      {state.queue ? <VisualQueue items={state.queue} active={state.active} /> : null}
      {!state.stack && !state.queue && !["lists", "state-trace", "map", "pointers", "debugging", "process-flow"].includes(kind) && mainItems.length ? (
        <VisualTokenRow
          items={mainItems}
          active={state.active}
          pointers={state.pointers}
          window={state.window}
          mode={rowMode}
        />
      ) : null}
      {kind !== "map" && kind !== "debugging" && kind !== "pointers" && state.table ? <VisualTable rows={state.table} /> : null}
      {state.nodes && kind === "linked-list" ? (
        <VisualLinkedList nodes={state.nodes} edges={state.edges || []} />
      ) : null}
      {state.nodes && kind !== "linked-list" ? (
        <VisualNodes nodes={state.nodes} edges={state.edges || []} kind={kind} />
      ) : null}
      {state.call_stack ? <VisualCallStack calls={state.call_stack} activeCall={state.active_call} /> : null}
      {state.note ? <p className="lesson-visual-state-note">{state.note}</p> : null}
    </div>
  );
}

function VisualTracePanel({ step }) {
  const variableGroups = [
    ["before", "State before", traceEntries(step.variables_before)],
    ["after", "State after", traceEntries(step.variables_after)],
  ].filter(([, , entries]) => entries.length);
  const detailCards = [
    ["code_focus", "Current operation", step.code_focus],
    ["input_value", "Input now", step.input_value],
    ["decision", "Decision", step.decision],
    ["output", "Output so far", step.output],
    ["why", "Why it matters", step.why],
  ].filter(([, , value]) => value !== undefined && value !== null && String(value).trim() !== "");
  const hasTrace = variableGroups.length || detailCards.length;

  if (!hasTrace) return null;

  return (
    <aside className="lesson-visual-trace-panel" aria-label="Execution trace details">
      {detailCards.map(([id, label, value]) => (
        <div className={`lesson-visual-trace-card is-${id}`} key={id}>
          <small>{label}</small>
          <span>{withInlineCode(traceValueText(value))}</span>
        </div>
      ))}
      {variableGroups.map(([id, label, entries]) => (
        <div className={`lesson-visual-trace-card is-${id} is-state`} key={id}>
          <small>{label}</small>
          <dl>
            {entries.map((entry) => (
              <div key={`${id}-${entry.name}`}>
                <dt>{entry.name}</dt>
                <dd>{withInlineCode(traceValueText(entry.value))}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </aside>
  );
}

function VisualBlock({ block }) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const steps = block.steps || [];
  const step = steps[stepIndex] || steps[0] || {};
  const canGoBack = stepIndex > 0;
  const canGoNext = stepIndex < steps.length - 1;
  const close = useCallback(() => {
    setIsPlaying(false);
    setOpen(false);
  }, []);
  const modalRef = useFocusTrap(open, { onEscape: close });
  const goToStep = useCallback((nextIndex) => {
    setStepIndex(Math.max(0, Math.min(steps.length - 1, nextIndex)));
    setReplayKey((current) => current + 1);
  }, [steps.length]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
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
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToStep, open, stepIndex, steps.length]);

  useEffect(() => {
    if (!open || !isPlaying) return undefined;
    if (!canGoNext) {
      setIsPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setStepIndex((current) => Math.min(steps.length - 1, current + 1));
      setReplayKey((current) => current + 1);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [canGoNext, isPlaying, open, stepIndex, steps.length]);

  return (
    <figure className="lesson-visual-block">
      <div>
        <figcaption>{block.title}</figcaption>
        {block.caption ? <p>{withInlineCode(block.caption)}</p> : null}
      </div>
      <button
        type="button"
        className="lesson-visual-open"
        onClick={() => {
          setStepIndex(0);
          setReplayKey(0);
          setIsPlaying(false);
          setOpen(true);
        }}
      >
        <FaProjectDiagram aria-hidden="true" />
        Visualize this
      </button>

      {open ? (
        <div className="lesson-visual-backdrop" role="presentation" onMouseDown={close}>
          <section
            ref={modalRef}
            className="lesson-visual-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lesson-visual-title"
            onMouseDown={(event) => event.stopPropagation()}
            tabIndex={-1}
          >
            <header className="lesson-visual-modal-head">
              <div>
                <span>Visualizer</span>
                <h3 id="lesson-visual-title">{block.title}</h3>
              </div>
              <button
                type="button"
                className="lesson-visual-close"
                onClick={close}
                data-autofocus
                aria-label="Close visualizer"
              >
                <FaTimes aria-hidden="true" />
              </button>
            </header>

            <div className="lesson-visual-progress-wrap">
              <span className="lesson-visual-progress-count">
                Step {stepIndex + 1} of {steps.length}
              </span>
              <div className="lesson-visual-progress" aria-label="Visualizer steps">
                {steps.map((visualStep, index) => (
                  <button
                    type="button"
                    key={`${visualStep.title}-${index}`}
                    className={index === stepIndex ? "is-active" : ""}
                    aria-label={`Go to step ${index + 1}: ${visualStep.title}`}
                    aria-current={index === stepIndex ? "step" : undefined}
                    onClick={() => {
                      setIsPlaying(false);
                      goToStep(index);
                    }}
                  >
                    <span>{index + 1}</span>
                    <strong>{visualStep.title}</strong>
                  </button>
                ))}
              </div>
            </div>

            <VisualDiagram key={`${stepIndex}-${replayKey}`} block={block} step={step} />
            <VisualTracePanel step={step} />

            <div className="lesson-visual-step-copy">
              {step.action_label ? (
                <span className="lesson-visual-action">{step.action_label}</span>
              ) : null}
              <h4>{step.title}</h4>
              <p>{withInlineCode(step.body)}</p>
              {step.what_changed ? (
                <p className="lesson-visual-change">
                  <strong>What changed:</strong> {withInlineCode(step.what_changed)}
                </p>
              ) : null}
            </div>

            <footer className="lesson-visual-controls">
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  goToStep(0);
                }}
              >
                <FaUndo aria-hidden="true" /> Reset
              </button>
              <div>
                <button type="button" onClick={() => setReplayKey((current) => current + 1)}>
                  <FaRedo aria-hidden="true" /> Replay
                </button>
                <button
                  type="button"
                  disabled={steps.length < 2 || (!canGoNext && !isPlaying)}
                  onClick={() => setIsPlaying((current) => !current)}
                >
                  {isPlaying ? (
                    <>
                      <FaPause aria-hidden="true" /> Pause
                    </>
                  ) : (
                    <>
                      <FaPlay aria-hidden="true" /> Play
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={!canGoBack}
                  onClick={() => {
                    setIsPlaying(false);
                    goToStep(stepIndex - 1);
                  }}
                >
                  <FaChevronLeft aria-hidden="true" /> Previous
                </button>
                <button
                  type="button"
                  disabled={!canGoNext}
                  onClick={() => {
                    setIsPlaying(false);
                    goToStep(stepIndex + 1);
                  }}
                >
                  Next <FaChevronRight aria-hidden="true" />
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </figure>
  );
}

function Block({ block, checkKey, picked, onCheckAnswered }) {
  if (block.kind === "text") {
    return (
      <>
        <p className="lesson-text">{withInlineCode(block.body)}</p>
        {block.caption ? (
          <p className="lesson-text lesson-text-caption">
            {withInlineCode(block.caption)}
          </p>
        ) : null}
      </>
    );
  }

  if (block.kind === "code") {
    return (
      <figure className="lesson-code">
        {block.caption ? (
          <figcaption>{withInlineCode(block.caption)}</figcaption>
        ) : null}
        <pre>
          <CodeText>{block.code}</CodeText>
        </pre>
        {block.output ? (
          <div className="lesson-output">
            <span className="lesson-output-label">Output</span>
            <pre>
              <code>{block.output}</code>
            </pre>
          </div>
        ) : null}
      </figure>
    );
  }

  if (block.kind === "callout") {
    const Icon = CALLOUT_ICON[block.tone] || FaLightbulb;
    const title = block.title || CALLOUT_DEFAULT_TITLE[block.tone] || "Note";
    return (
      <aside className={`lesson-callout is-${block.tone}`}>
        <span className="lesson-callout-head">
          <Icon aria-hidden="true" />
          {title}
        </span>
        <p>{withInlineCode(block.body)}</p>
      </aside>
    );
  }

  if (block.kind === "compare") {
    return (
      <figure className="lesson-compare">
        <div className="lesson-compare-grid">
          <div className="lesson-compare-col is-wrong">
            <span className="lesson-compare-label">{block.wrong_label}</span>
            <pre>
              <CodeText>{block.wrong}</CodeText>
            </pre>
          </div>
          <div className="lesson-compare-col is-right">
            <span className="lesson-compare-label">{block.right_label}</span>
            <pre>
              <CodeText>{block.right}</CodeText>
            </pre>
          </div>
        </div>
        {block.caption ? (
          <figcaption>{withInlineCode(block.caption)}</figcaption>
        ) : null}
        {block.body ? (
          <p className="lesson-compare-body">{withInlineCode(block.body)}</p>
        ) : null}
      </figure>
    );
  }

  if (block.kind === "list") {
    return (
      <div className="lesson-list-block">
        {block.title ? <h3>{block.title}</h3> : null}
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>
              <FaCheck aria-hidden="true" />
              <span>{withInlineCode(item)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.kind === "check") {
    return (
      <CheckBlock
        block={block}
        picked={picked}
        onPick={(choiceIndex) => onCheckAnswered(checkKey, choiceIndex)}
      />
    );
  }

  if (block.kind === "visual") {
    return <VisualBlock block={block} />;
  }

  return null;
}

// An inline "did that land?" question. Answered right here in the lesson, revealed
// immediately, and nothing is recorded anywhere.
//
// Deliberately not graded: Learn is the one place in the Coding Tutor that isn't a test,
// and scoring these would turn it into one. The point is that the student *does* something
// before being handed to Practice, and arrives there having already got two right.
//
// Answering is one-way on purpose. Once you've seen why, re-picking would only let you
// paper over a wrong guess, and the wrong guess is the part worth sitting with.
function CheckBlock({ block, picked, onPick }) {
  const answered = picked !== null;
  const correct = picked === block.answer_index;

  return (
    <div className={`lesson-check ${answered ? "is-answered" : ""}`}>
      <span className="lesson-check-kicker">Check yourself</span>
      <p className="lesson-check-prompt">{withInlineCode(block.prompt)}</p>

      {block.code ? (
        <pre className="lesson-check-code">
          <CodeText>{block.code}</CodeText>
        </pre>
      ) : null}

      <div className="lesson-check-choices" role="radiogroup">
        {block.choices.map((choice, i) => {
          const isAnswer = i === block.answer_index;
          const isPicked = i === picked;
          // After answering, always show which one was right, not merely whether the
          // student's pick was wrong. "Wrong, try again" teaches nothing.
          const state = !answered
            ? ""
            : isAnswer
              ? "is-correct"
              : isPicked
                ? "is-wrong"
                : "is-dimmed";
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={isPicked}
              disabled={answered}
              className={`lesson-check-choice ${state}`}
              onClick={() => onPick(i)}
            >
              <span className="lesson-check-marker">
                {answered && isAnswer ? (
                  <FaCheck aria-hidden="true" />
                ) : answered && isPicked ? (
                  <FaTimes aria-hidden="true" />
                ) : (
                  String.fromCharCode(65 + i)
                )}
              </span>
              <span>{choice}</span>
            </button>
          );
        })}
      </div>

      {answered ? (
        <div className={`lesson-check-why ${correct ? "is-correct" : "is-wrong"}`}>
          <span className="lesson-check-verdict">
            {correct ? "That's it." : "Not quite."}
          </span>{" "}
          {withInlineCode(block.why)}
        </div>
      ) : null}
    </div>
  );
}

export default function LessonView({
  apiBase,
  language,
  category,
  languageLabel,
  onPracticeActivity,
  onPractice,
  onBack,
}) {
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("");
  const [checkAnswers, setCheckAnswers] = useState({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setLesson(null);
    setCheckAnswers({});
    fetch(`${apiBase}/api/coding/learn/${language}/${category}`)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load this lesson.");
        return r.json();
      })
      .then((data) => {
        // `lesson: null` means "not authored yet" — a real, expected state, not an error.
        if (alive) {
          setLesson(data.lesson);
          setActiveSectionId(data.lesson?.sections?.[0]?.id || "");
        }
      })
      .catch((err) => {
        if (alive) setError(err.message || "Could not load this lesson.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiBase, language, category]);

  const sections = useMemo(() => {
    if (!lesson) return [];
    return Array.isArray(lesson.sections) && lesson.sections.length
      ? lesson.sections
      : [
          {
            id: "lesson",
            title: lesson.title,
            summary: lesson.summary,
            blocks: lesson.blocks || [],
          },
        ];
  }, [lesson]);
  const activeSection =
    sections.find((section) => section.id === activeSectionId) || sections[0] || null;
  const activeIndex = activeSection
    ? Math.max(0, sections.findIndex((section) => section.id === activeSection.id))
    : 0;
  const hasMultipleSections = sections.length > 1;
  const checkKeys = useMemo(() => (
    sections.flatMap((section) =>
      (section.blocks || [])
        .map((block, index) => (
          block.kind === "check" ? `${section.id}:${index}` : null
        ))
        .filter(Boolean)
    )
  ), [sections]);
  const sectionLesson = useMemo(() => {
    if (!lesson || !activeSection) return lesson;
    return {
      ...lesson,
      title: activeSection.title || lesson.title,
      summary: activeSection.summary || lesson.summary,
      blocks: activeSection.blocks || [],
    };
  }, [activeSection, lesson]);
  const goToSection = (index) => {
    const next = sections[index];
    if (next) setActiveSectionId(next.id);
  };
  const handleCheckAnswered = (checkKey, choiceIndex) => {
    if (!checkKey) return;
    setCheckAnswers((current) => (
      Object.prototype.hasOwnProperty.call(current, checkKey)
        ? current
        : { ...current, [checkKey]: choiceIndex }
    ));
  };

  useEffect(() => {
    if (!lesson || checkKeys.length === 0) return;
    const answeredCount = checkKeys.filter((key) =>
      Object.prototype.hasOwnProperty.call(checkAnswers, key)
    ).length;
    if (answeredCount === checkKeys.length) {
      if (markLessonRead(language, category)) {
        onPracticeActivity?.();
      }
    }
  }, [category, checkAnswers, checkKeys, language, lesson, onPracticeActivity]);

  if (loading) return <p className="cq-loading">Loading lesson…</p>;
  if (error) return <p className="cq-error">{error}</p>;

  if (!lesson) {
    return (
      <div className="lesson-empty">
        <h2>This lesson is being written</h2>
        <p>
          We haven't finished the {languageLabel} lesson for this topic yet. The
          practice questions for it may already be here.
        </p>
        <button type="button" className="lesson-practice-cta" onClick={onPractice}>
          Try the practice questions <FaArrowRight aria-hidden="true" />
        </button>
        <button type="button" className="learn-back-link" onClick={onBack}>
          <FaArrowLeft aria-hidden="true" /> Back to {languageLabel}
        </button>
      </div>
    );
  }

  return (
    <article className="lesson-view">
      <header className="lesson-head">
        <span className="lesson-kicker">{languageLabel}</span>
        <h1>{lesson.title}</h1>
        {lesson.summary ? (
          <p className="lesson-summary">{withInlineCode(lesson.summary)}</p>
        ) : null}
        {lesson.minutes ? (
          <span className="lesson-minutes">
            <FaClock aria-hidden="true" /> {lesson.minutes} min read
          </span>
        ) : null}
      </header>

      {/* Read-aloud. Free browser TTS — reads the prose, skips code and the checks. */}
      {hasMultipleSections ? (
        <nav className="lesson-section-nav" aria-label={`${lesson.title} lesson sections`}>
          {sections.map((section, i) => (
            <button
              key={section.id}
              type="button"
              className={`lesson-section-tab ${section.id === activeSection.id ? "is-active" : ""}`}
              onClick={() => setActiveSectionId(section.id)}
              aria-current={section.id === activeSection.id ? "step" : undefined}
            >
              <span>{i + 1}</span>
              {section.title}
            </button>
          ))}
        </nav>
      ) : null}

      <LessonPlayBar lesson={sectionLesson} />

      <div className="lesson-body">
        {hasMultipleSections ? (
          <div className="lesson-section-head">
            <span className="lesson-section-count">
              Part {activeIndex + 1} of {sections.length}
            </span>
            <h2>{activeSection.title}</h2>
            {activeSection.summary ? <p>{withInlineCode(activeSection.summary)}</p> : null}
          </div>
        ) : null}
        {(activeSection.blocks || []).map((block, i) => {
          const checkKey = `${activeSection.id}:${i}`;
          return (
            <Block
              key={i}
              block={block}
              checkKey={checkKey}
              picked={
                Object.prototype.hasOwnProperty.call(checkAnswers, checkKey)
                  ? checkAnswers[checkKey]
                  : null
              }
              onCheckAnswered={handleCheckAnswered}
            />
          );
        })}
      </div>

      {hasMultipleSections ? (
        <div className="lesson-section-controls" aria-label="Lesson section navigation">
          <button
            type="button"
            onClick={() => goToSection(activeIndex - 1)}
            disabled={activeIndex <= 0}
          >
            <FaArrowLeft aria-hidden="true" /> Previous part
          </button>
          {activeIndex >= sections.length - 1 ? (
            <button
              type="button"
              className="is-practice"
              onClick={onPractice}
            >
              Check {lesson.title} <FaArrowRight aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goToSection(activeIndex + 1)}
            >
              Next part <FaArrowRight aria-hidden="true" />
            </button>
          )}
        </div>
      ) : null}

      {/* The handoff. Reading without doing doesn't stick, so a lesson exits into
          the matching concept check instead of a broad library page. */}
      <footer className={`lesson-foot ${hasMultipleSections ? "is-sectioned" : ""}`}>
        <p>Next: answer a few questions on this topic.</p>
        <button type="button" className="lesson-practice-cta" onClick={onPractice}>
          Check {lesson.title} <FaArrowRight aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}
