import dagre from "dagre";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CSSProperties, ReactNode } from "react";
import type { ConceptType, Edge, Node as VisualNode, Step } from "./types";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 520;

type VisualNodeProps = {
  node: VisualNode;
  className?: string;
  split?: boolean;
};

function nodeIndex(node: VisualNode): number {
  const match = String(node.id).match(/(-?\d+)$/);
  return match ? Number(match[1]) : 0;
}

function sortedByX(nodes: VisualNode[]): VisualNode[] {
  return [...nodes].sort((a, b) => a.x - b.x || nodeIndex(a) - nodeIndex(b));
}

function sortedStackNodes(nodes: VisualNode[]): VisualNode[] {
  return [...nodes].sort((a, b) => nodeIndex(a) - nodeIndex(b) || b.y - a.y);
}

function isHighlighted(step: Step, id: string): boolean {
  return Boolean(step.highlights?.nodeIds?.includes(id));
}

function nodeStatus(node: VisualNode, step: Step): string {
  return isHighlighted(step, node.id) ? "highlighted" : node.state || "default";
}

function visibleLabel(node: VisualNode, fallback = ""): string {
  const label = String(node.label || "").trim();
  if (!label || /^\d+$/.test(label)) return fallback;
  return label;
}

function StatusBlock({ node, step, className = "", split = false }: VisualNodeProps & { step: Step }) {
  return (
    <motion.div
      layout
      className={`ucv-visual-block ucv-visual-block--${nodeStatus(node, step)} ${className}`}
      data-state={nodeStatus(node, step)}
      initial={{ opacity: 0, scale: 0.88, y: -14 }}
      animate={{ opacity: node.state === "inactive" ? 0.38 : 1, scale: nodeStatus(node, step) === "highlighted" || node.state === "active" ? 1.04 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.78, y: -24 }}
      transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.8 }}
    >
      {split ? (
        <>
          <span className="ucv-visual-value">{node.value}</span>
          <span className="ucv-visual-next">next</span>
        </>
      ) : (
        <>
          {node.label ? <span>{node.label}</span> : null}
          <strong>{node.value}</strong>
        </>
      )}
    </motion.div>
  );
}

function Canvas({ concept, children, className = "" }: { concept: ConceptType; children: ReactNode; className?: string }) {
  return (
    <div className={`ucv-canvas ucv-canvas--${concept} ${className}`} data-structure={concept}>
      {children}
    </div>
  );
}

function edgeId(edge: Edge): string {
  return edge.id || `${edge.from}-${edge.to}`;
}

function edgeBetween(edges: Edge[], from: string, to: string): Edge | undefined {
  return edges.find((edge) => edge.from === from && edge.to === to);
}

function isEdgeActive(edge: Edge, step: Step): boolean {
  return edge.state === "active" || edge.state === "path" || Boolean(step.highlights?.edgeIds?.includes(edgeId(edge)));
}

const STACK_QUEUE_STATE_EXCLUDED = new Set([
  "answer",
  "commands",
  "example",
  "expression",
  "final_result",
  "outputs",
  "result",
  "returned",
  "rule",
  "target",
  "visual_family",
]);

function StackQueueStatePanel({ step, kind }: { step: Step; kind: "stack" | "queue" }) {
  const state = step.state || {};
  const example = formatArrayStateValue(state.example ?? state.commands ?? state.expression);
  const target = formatArrayStateValue(state.target ?? (kind === "stack" ? "track the top and height" : "front leaves first"));
  const resultSoFar = kind === "stack"
    ? formatArrayStateValue(state.result ?? state.outputs ?? state.max_height ?? state.top)
    : formatArrayStateValue(state.result ?? state.served ?? state.front ?? state.waiting);
  const variables = Object.entries(state).filter(([key, value]) => !STACK_QUEUE_STATE_EXCLUDED.has(key) && typeof value !== "undefined" && value !== "");
  return (
    <aside className={`ucv-array-state-panel ucv-${kind}-state-panel`} aria-label={`${kind} trace memory`}>
      {example ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">example</span>
          <strong className="ucv-array-state-panel-value">{example}</strong>
        </div>
      ) : null}
      <div className="ucv-array-state-panel-section">
        <span className="ucv-array-state-panel-label">target</span>
        <strong className="ucv-array-state-panel-value">{target}</strong>
      </div>
      {variables.length ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">variables</span>
          <div className="ucv-array-state-panel-list">
            {variables.map(([key, value]) => (
              <div className="ucv-array-state-panel-row" key={key}>
                <span>{arrayStateLabel(key)}</span>
                <strong>{formatArrayStateValue(value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {resultSoFar ? (
        <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
          <span className="ucv-array-state-panel-label">result so far</span>
          <strong className="ucv-array-state-panel-value">{resultSoFar}</strong>
        </div>
      ) : null}
    </aside>
  );
}

export function StackVisualizer({ step }: { step: Step }) {
  const nodes = sortedStackNodes(step.nodes).filter((node) => {
    const role = String(node.meta?.role || "");
    return role === "stack-item" || role === "stack" || node.id.startsWith("stack-") || node.id === "empty-stack";
  });
  const topId = nodes[nodes.length - 1]?.id;
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-stack-canvas">
      <div className="ucv-stack-layout" aria-label="Stack visualizer">
        <StackQueueStatePanel step={step} kind="stack" />
        <div className="ucv-stack-shell">
          <span className="ucv-stack-label ucv-stack-label--top">Top</span>
          <div className="ucv-stack-track">
            <AnimatePresence mode="popLayout">
              {nodes.map((node, index) => (
                <StatusBlock
                  key={node.id}
                  node={{ ...node, label: visibleLabel(node, node.id === topId ? "top" : index === 0 ? "bottom" : "") }}
                  step={step}
                  className="ucv-stack-item"
                />
              ))}
            </AnimatePresence>
          </div>
          <span className="ucv-stack-base">Bottom of stack</span>
        </div>
      </div>
    </Canvas>
  );
}

export function QueueVisualizer({ step }: { step: Step }) {
  const nodes = sortedByX(step.nodes).filter((node) => (
    node.id.startsWith("queue-")
    || node.id.startsWith("item-")
    || node.id.startsWith("served-")
    || node.id.startsWith("done-")
    || node.id === "empty-line"
    || node.id === "queue-empty"
  ));
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-queue-canvas">
      <div className="ucv-queue-layout" aria-label="Queue visualizer">
        <StackQueueStatePanel step={step} kind="queue" />
        <div className="ucv-queue-shell">
          <div className="ucv-queue-guide" aria-hidden="true">
            <span>dequeue from front</span>
            <span>enqueue at rear</span>
          </div>
          <div className="ucv-queue-track">
            <span className="ucv-queue-exit" aria-hidden="true" />
            <AnimatePresence mode="popLayout">
              {nodes.map((node, index) => (
                <div key={node.id} className="ucv-queue-item-wrap">
                  <StatusBlock
                    node={{ ...node, label: visibleLabel(node, index === 0 ? "front" : index === nodes.length - 1 ? "rear" : String(index)) }}
                    step={step}
                    className="ucv-queue-item"
                  />
                  {index < nodes.length - 1 ? <span className="ucv-queue-order-mark" aria-hidden="true" /> : null}
                </div>
              ))}
            </AnimatePresence>
            <span className="ucv-queue-entry" aria-hidden="true" />
          </div>
        </div>
      </div>
    </Canvas>
  );
}

export function LinkedListVisualizer({ step }: { step: Step }) {
  const nodes = sortedByX(step.nodes);
  const realNodes = nodes.filter((node) => String(node.value).toLowerCase() !== "null");
  const nullNode = nodes.find((node) => String(node.value).toLowerCase() === "null") || {
    id: "null",
    value: "null",
    type: "logic-node" as const,
    x: 0,
    y: 0,
    state: "inactive" as const,
    label: "next",
  };
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-linked-canvas">
      <div className="ucv-linked-shell" aria-label="Linked list visualizer">
        <span className="ucv-head-label">head</span>
        <div className="ucv-linked-row">
          {realNodes.map((node, index) => (
            <div className="ucv-linked-item" key={node.id}>
              <StatusBlock node={{ ...node, label: "" }} step={step} className="ucv-linked-node" split />
              <span
                className={`ucv-inline-arrow ${isEdgeActive(edgeBetween(step.edges, node.id, realNodes[index + 1]?.id || "null") || { from: node.id, to: "null", type: "pointer" }, step) ? "is-active" : ""}`}
                aria-hidden="true"
              />
            </div>
          ))}
          <StatusBlock node={nullNode} step={step} className="ucv-null-node" />
        </div>
      </div>
    </Canvas>
  );
}

function ArrayRow({ step, nodes }: { step: Step; nodes: VisualNode[] }) {
  return (
    <div className="ucv-array-row" style={{ "--ucv-array-count": nodes.length } as CSSProperties}>
      {nodes.map((node) => (
        <StatusBlock key={node.id} node={node} step={step} className="ucv-array-cell" />
      ))}
    </div>
  );
}

function isArrayRowNode(node: VisualNode): boolean {
  return node.type === "array-cell";
}

function stepExample(step: Step): string {
  const value = step.state?.example;
  return typeof value === "string" ? value : "";
}

function activeNodeIndex(step: Step, max: number): number {
  const active = sortedByX(step.nodes).findIndex((node) => node.state === "active" || node.state === "comparing" || isHighlighted(step, node.id));
  return Math.min(Math.max(active < 0 ? 0 : active, 0), Math.max(max - 1, 0));
}

function isStringLikeStep(step: Step): boolean {
  const text = `${step.title} ${step.description} ${stepExample(step)}`.toLowerCase();
  if (step.concept !== "array") return false;
  if (text.includes("[") || text.includes("nums=") || text.includes("scores=")) return false;
  return /string|word|character|letter|vowel|palindrome|sentence|email|prefix|course code|initial/.test(text);
}

function formatStringStateValue(value: string | number | boolean | undefined): string {
  if (typeof value === "undefined") return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function stringStateLabel(key: string): string {
  return key.replace(/_/g, " ");
}

const STRING_STATE_PANEL_EXCLUDED = new Set([
  "example",
  "expected",
  "final_result",
  "index",
  "moving_word",
  "output",
  "result",
  "result_active_index",
  "result_words",
  "returned",
  "text",
  "visual_family",
]);

function StringStatePanel({ step, example, resultNode }: { step: Step; example: string; resultNode?: VisualNode }) {
  const state = step.state || {};
  const variables = Object.entries(state).filter(([key, value]) => !STRING_STATE_PANEL_EXCLUDED.has(key) && typeof value !== "undefined" && value !== "");
  const resultSoFar = formatStringStateValue(state.result ?? state.output ?? resultNode?.value);
  if (!example && !variables.length && !resultSoFar) return null;
  return (
    <aside className="ucv-array-state-panel ucv-string-state-panel" aria-label="String trace memory">
      {example ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">example</span>
          <strong className="ucv-array-state-panel-value">{example}</strong>
        </div>
      ) : null}
      {variables.length ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">variables</span>
          <div className="ucv-array-state-panel-list">
            {variables.map(([key, value]) => (
              <div className="ucv-array-state-panel-row" key={key}>
                <span>{stringStateLabel(key)}</span>
                <strong>{formatStringStateValue(value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {resultSoFar ? (
        <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
          <span className="ucv-array-state-panel-label">result so far</span>
          <strong className="ucv-array-state-panel-value">{resultSoFar}</strong>
        </div>
      ) : null}
    </aside>
  );
}

function parseStringResultWords(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ReverseWordsVisualizer({
  step,
  visibleTokens,
  activeIndex,
}: {
  step: Step;
  visibleTokens: string[];
  activeIndex: number;
}) {
  const resultWords = parseStringResultWords(step.state?.result_words);
  const activeResultIndex = Number(step.state?.result_active_index ?? -1);
  const resultSlots = visibleTokens.map((_, index) => resultWords[index] || "");
  return (
    <div className="ucv-reverse-words-region" aria-label="Reverse words visualizer">
      <div className="ucv-reverse-row ucv-reverse-row--source" style={{ "--ucv-array-count": visibleTokens.length } as CSSProperties}>
        <span className="ucv-reverse-row-label">original words</span>
        {visibleTokens.map((token, index) => (
          <StatusBlock
            key={`source-${token}-${index}`}
            node={{
              id: `reverse-source-${index}`,
              x: index,
              y: 0,
              value: token,
              type: "array-cell",
              label: `word ${index}`,
              state: index === activeIndex ? "active" : index > activeIndex ? "visited" : "default",
            }}
            step={step}
            className="ucv-string-token ucv-reverse-word-token"
          />
        ))}
      </div>
      <div className="ucv-reverse-transfer" style={{ "--ucv-array-count": visibleTokens.length } as CSSProperties}>
        {visibleTokens.map((token, index) => {
          const targetIndex = visibleTokens.length - 1 - index;
          const isMoving = index === activeIndex && activeResultIndex === targetIndex;
          return (
            <span key={`move-${token}-${index}`} className={isMoving ? "is-moving" : ""}>
              {isMoving ? "moves down" : ""}
            </span>
          );
        })}
      </div>
      <div className="ucv-reverse-row ucv-reverse-row--result" style={{ "--ucv-array-count": visibleTokens.length } as CSSProperties}>
        <span className="ucv-reverse-row-label">reversed result</span>
        {resultSlots.map((token, index) => (
          <StatusBlock
            key={`result-${index}-${token || "empty"}`}
            node={{
              id: `reverse-result-${index}`,
              x: index,
              y: 0,
              value: token || "waiting",
              type: "array-cell",
              label: `slot ${index}`,
              state: token ? (index === activeResultIndex ? "matched" : "visited") : index === activeResultIndex ? "active" : "inactive",
            }}
            step={step}
            className="ucv-string-token ucv-reverse-result-token"
          />
        ))}
      </div>
    </div>
  );
}

function StringScanVisualizer({ step }: { step: Step }) {
  const example = stepExample(step);
  const charNodes = sortedByX(step.nodes).filter((node) => node.id.startsWith("char-") || node.meta?.role === "string-cell");
  const tokenKind = String(charNodes[0]?.meta?.tokenKind || "");
  const useWords = tokenKind === "word" || (/word|sentence/.test(`${step.title} ${step.description}`.toLowerCase()) && !/character|letter|vowel/.test(step.title.toLowerCase()));
  const tokens = (useWords ? example.split(/\s+/) : [...example]).filter(Boolean).slice(0, 14);
  const fallback = charNodes
    .map((node) => String(node.value))
    .slice(0, 14);
  const visibleTokens = fallback.length ? fallback : tokens;
  const activeCharIndex = charNodes.findIndex((node) => node.state === "active" || node.state === "comparing" || isHighlighted(step, node.id));
  const activeIndex = Math.min(Math.max(activeCharIndex < 0 ? activeNodeIndex(step, visibleTokens.length) : activeCharIndex, 0), Math.max(visibleTokens.length - 1, 0));
  const resultNode = step.nodes.find((node) => node.id === "string-result" || node.meta?.role === "result");
  const isReverseWords = step.state?.visual_family === "string-reverse-words";
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-string-canvas">
      <div className="ucv-string-visual-layout" aria-label="String scan visualizer">
        <StringStatePanel step={step} example={example || visibleTokens.join(useWords ? " " : "")} resultNode={resultNode} />
        <div className="ucv-string-main-region">
          {isReverseWords ? (
            <ReverseWordsVisualizer step={step} visibleTokens={visibleTokens} activeIndex={activeIndex} />
          ) : (
            <>
              <div className={`ucv-string-ribbon${useWords ? " ucv-string-ribbon--words" : ""}`} style={{ "--ucv-array-count": visibleTokens.length } as CSSProperties}>
                {visibleTokens.map((token, index) => (
                  <StatusBlock
                    key={`${token}-${index}`}
                    node={{
                      id: `string-${index}`,
                      x: index,
                      y: 0,
                      value: token === " " ? "space" : token,
                      type: "array-cell",
                      label: useWords ? `word ${index}` : String(index),
                      state: index === activeIndex ? "active" : index < activeIndex ? "visited" : "default",
                    }}
                    step={step}
                    className="ucv-string-token"
                  />
                ))}
              </div>
              <div className="ucv-string-cursor" style={{ "--ucv-cursor-index": activeIndex, "--ucv-token-count": Math.max(visibleTokens.length, 1) } as CSSProperties}>
                <span>scan cursor</span>
              </div>
            </>
          )}
        </div>
      </div>
    </Canvas>
  );
}

function BitVisualizer({ step }: { step: Step }) {
  const bits = sortedByX(step.nodes).map((node) => String(node.value)).filter((value) => /^[01]$/.test(value));
  const visibleBits = bits.length ? bits.slice(0, 12) : ["1", "0", "1", "1"];
  const activeIndex = activeNodeIndex(step, visibleBits.length);
  const places = visibleBits.map((_, index) => 2 ** (visibleBits.length - index - 1));
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-bit-canvas">
      <div className="ucv-bit-shell" aria-label="Bit manipulation visualizer">
        <div className="ucv-bit-register">
          {visibleBits.map((bit, index) => (
            <motion.div
              key={`bit-${index}`}
              layout
              className={`ucv-bit-cell ${index === activeIndex ? "is-active" : ""} ${bit === "1" ? "has-one" : ""}`}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
            >
              <span>{places[index]}</span>
              <strong>{bit}</strong>
            </motion.div>
          ))}
        </div>
        <div className="ucv-bit-caption">
          <span>{visibleBits[activeIndex] === "1" ? "1 changes the count or mask" : "0 usually leaves the count alone"}</span>
        </div>
      </div>
    </Canvas>
  );
}

export function MathVisualizer({ step }: { step: Step }) {
  const nodes = sortedByX(step.nodes);
  const lastNode = nodes[nodes.length - 1];
  const activeNode = nodes.find((node) => node.state === "active" || isHighlighted(step, node.id)) || nodes[0];
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-math-canvas">
      <div className="ucv-math-shell" aria-label="Math formula visualizer">
        <div className="ucv-math-flow" style={{ "--ucv-math-count": Math.max(nodes.length, 1) } as CSSProperties}>
          {nodes.map((node, index) => {
            const isResult = node.id === lastNode?.id || /total|result|answer/i.test(String(node.value));
            return (
              <div key={node.id} className="ucv-math-step">
                <StatusBlock
                  node={{ ...node, label: visibleLabel(node, isResult ? "result" : index === 0 ? "start" : "step") }}
                  step={step}
                  className={`ucv-math-card ${isResult ? "ucv-math-card--result" : ""}`}
                />
                {index < nodes.length - 1 ? <span className="ucv-math-operator" aria-hidden="true">then</span> : null}
              </div>
            );
          })}
        </div>
        <div className="ucv-math-ledger" aria-label="Current math state">
          <span>Current step</span>
          <strong>{activeNode?.value || "apply one formula piece"}</strong>
        </div>
      </div>
    </Canvas>
  );
}

function PrefixSumRows({ step }: { step: Step }) {
  const nums = sortedByX(step.nodes.filter((node) => node.id.startsWith("num-")));
  const prefixes = sortedByX(step.nodes.filter((node) => node.id.startsWith("prefix-")));
  const count = Math.max(nums.length, prefixes.length, 1);
  return (
    <div className="ucv-prefix-shell" style={{ "--ucv-array-count": count } as CSSProperties}>
      <span>Original values</span>
      <ArrayRow step={step} nodes={nums} />
      <span>Saved running totals</span>
      <ArrayRow step={step} nodes={prefixes} />
    </div>
  );
}

function TupleRows({ step }: { step: Step }) {
  if (step.nodes.some((node) => node.id.startsWith("tuple-swap-"))) {
    return <TupleSwapRows step={step} />;
  }
  if (step.nodes.some((node) => node.id === "tuple-pair-result") && step.nodes.some((node) => node.id.startsWith("item-"))) {
    return <TupleFirstLastRows step={step} />;
  }
  const names = step.nodes.filter((node) => node.id.includes("name"));
  const scores = step.nodes.filter((node) => node.id.includes("score"));
  const pairs = step.nodes.filter((node) => node.id.includes("pair"));
  const rows = Math.max(names.length, scores.length, pairs.length);
  return (
    <div className="ucv-tuple-shell" aria-label="Tuple and parallel list visualizer">
      {Array.from({ length: rows }, (_, index) => (
        <div className="ucv-tuple-row" key={`tuple-row-${index}`}>
          {names[index] ? <StatusBlock node={names[index]} step={step} className="ucv-tuple-cell" /> : null}
          <span className="ucv-inline-arrow" aria-hidden="true" />
          {scores[index] ? <StatusBlock node={scores[index]} step={step} className="ucv-tuple-cell" /> : null}
          <span className="ucv-inline-arrow" aria-hidden="true" />
          {pairs[index] ? <StatusBlock node={pairs[index]} step={step} className="ucv-tuple-result" /> : null}
        </div>
      ))}
    </div>
  );
}

function TupleFirstLastRows({ step }: { step: Step }) {
  const items = sortedByX(step.nodes.filter((node) => node.id.startsWith("item-")));
  const result = step.nodes.find((node) => node.id === "tuple-pair-result");
  const firstEdge = edgeBetween(step.edges, "item-0", "tuple-pair-result");
  const lastEdge = edgeBetween(step.edges, "item-2", "tuple-pair-result");
  const firstActive = Boolean(firstEdge && isEdgeActive(firstEdge, step));
  const lastActive = Boolean(lastEdge && isEdgeActive(lastEdge, step));
  return (
    <div className="ucv-tuple-first-last-shell" aria-label="First and last pair visualizer">
      <div className="ucv-tuple-first-last-items">
        <ArrayRow step={step} nodes={items} />
      </div>
      <div className="ucv-tuple-first-last-connectors" aria-hidden="true">
        <svg viewBox="0 0 560 96" preserveAspectRatio="none" role="presentation">
          <defs>
            <marker id="tuple-first-last-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <path
            className={firstActive ? "is-active" : ""}
            d="M 110 8 C 145 40, 215 66, 270 86"
            markerEnd="url(#tuple-first-last-arrow)"
          />
          <path
            className={lastActive ? "is-active" : ""}
            d="M 450 8 C 415 40, 345 66, 290 86"
            markerEnd="url(#tuple-first-last-arrow)"
          />
        </svg>
      </div>
      {result ? <StatusBlock node={result} step={step} className="ucv-tuple-result ucv-tuple-first-last-output" /> : null}
    </div>
  );
}

function TupleSwapRows({ step }: { step: Step }) {
  const first = step.nodes.find((node) => node.id === "tuple-swap-original-0");
  const second = step.nodes.find((node) => node.id === "tuple-swap-original-1");
  const newFirst = step.nodes.find((node) => node.id === "tuple-swap-new-0");
  const newSecond = step.nodes.find((node) => node.id === "tuple-swap-new-1");
  const result = step.nodes.find((node) => node.id === "tuple-swap-result");
  const secondToFirst = edgeBetween(step.edges, "tuple-swap-original-1", "tuple-swap-new-0");
  const firstToSecond = edgeBetween(step.edges, "tuple-swap-original-0", "tuple-swap-new-1");
  const secondToFirstActive = Boolean(secondToFirst && isEdgeActive(secondToFirst, step));
  const firstToSecondActive = Boolean(firstToSecond && isEdgeActive(firstToSecond, step));
  return (
    <div className="ucv-tuple-swap-shell" aria-label="Tuple swap visualizer">
      <div className="ucv-tuple-swap-row">
        {first ? <StatusBlock node={first} step={step} className="ucv-tuple-cell" /> : null}
        {second ? <StatusBlock node={second} step={step} className="ucv-tuple-cell" /> : null}
      </div>
      <div className="ucv-tuple-swap-arrows" aria-hidden="true">
        <svg viewBox="0 0 520 96" preserveAspectRatio="none" role="presentation">
          <defs>
            <marker id="tuple-swap-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <path
            className={secondToFirstActive ? "is-active" : ""}
            d="M 345 8 C 320 34, 200 58, 108 86"
            markerEnd="url(#tuple-swap-arrow)"
          />
          <path
            className={firstToSecondActive ? "is-active" : ""}
            d="M 175 8 C 205 36, 275 58, 292 86"
            markerEnd="url(#tuple-swap-arrow)"
          />
        </svg>
      </div>
      <div className="ucv-tuple-swap-row">
        {newFirst ? <StatusBlock node={newFirst} step={step} className="ucv-tuple-cell" /> : null}
        {newSecond ? <StatusBlock node={newSecond} step={step} className="ucv-tuple-cell" /> : null}
        {result ? <StatusBlock node={result} step={step} className="ucv-tuple-result" /> : null}
      </div>
    </div>
  );
}

function RecursionView({ step }: { step: Step }) {
  const calls = step.nodes.filter((node) => node.id.startsWith("call-")).sort((a, b) => a.y - b.y);
  const base = step.nodes.find((node) => node.id === "base-case");
  const result = step.nodes.find((node) => node.id === "return-chain");
  const state = step.state || {};
  const resultText = state.result ?? state.return_value ?? result?.value ?? "not returned yet";
  const returnBuilder = String(state.return_steps || "").split("|").filter(Boolean);
  const activeReturnIndex = Number(state.return_step_index ?? -1);
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-recursion-canvas">
      <div className="ucv-recursion-shell" aria-label="Recursion visualizer">
        <aside className="ucv-array-state-panel ucv-recursion-state-panel" aria-label="Recursion trace memory">
          <div className="ucv-array-state-panel-section">
            <span className="ucv-array-state-panel-label">example</span>
            <strong className="ucv-array-state-panel-value">{String(state.example || "countdown(2)")}</strong>
          </div>
          <div className="ucv-array-state-panel-section">
            <span className="ucv-array-state-panel-label">target</span>
            <strong className="ucv-array-state-panel-value">{String(state.target || "reach base, then return")}</strong>
          </div>
          <div className="ucv-array-state-panel-section">
            <span className="ucv-array-state-panel-label">variables</span>
            <div className="ucv-array-state-panel-list">
              <div className="ucv-array-state-panel-row">
                <span>phase</span>
                <strong>{String(state.phase || "call")}</strong>
              </div>
              <div className="ucv-array-state-panel-row">
                <span>current</span>
                <strong>{String(state.current_call || calls.find((node) => node.state === "active")?.value || "none")}</strong>
              </div>
              <div className="ucv-array-state-panel-row">
                <span>waiting</span>
                <strong>{String(state.waiting || "none")}</strong>
              </div>
              <div className="ucv-array-state-panel-row ucv-array-state-panel-row--wide">
                <span>action</span>
                <strong>{String(state.action || "follow the active call")}</strong>
              </div>
            </div>
          </div>
          <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
            <span className="ucv-array-state-panel-label">result so far</span>
            <strong className="ucv-array-state-panel-value">{String(resultText)}</strong>
          </div>
        </aside>
        <div className="ucv-recursion-stack">
          <span>call stack</span>
          <AnimatePresence mode="popLayout">
            {calls.map((node, index) => (
              <div key={node.id} className="ucv-recursion-frame-wrap">
                <StatusBlock node={{ ...node, label: visibleLabel(node, index === calls.length - 1 ? "current call" : "waiting") }} step={step} className="ucv-recursion-frame" />
                {index < calls.length - 1 ? <span className="ucv-recursion-down" aria-hidden="true" /> : null}
              </div>
            ))}
          </AnimatePresence>
        </div>
        <div className="ucv-recursion-side">
          {base ? <StatusBlock node={base} step={step} className="ucv-recursion-check" /> : null}
          <span className="ucv-recursion-down ucv-recursion-down--side" aria-hidden="true" />
          {result ? <StatusBlock node={result} step={step} className="ucv-recursion-result" /> : null}
          {returnBuilder.length ? (
            <div className="ucv-recursion-return-builder" aria-label="Return value builder">
              <span>return builder</span>
              {returnBuilder.map((item, index) => (
                <strong
                  key={item}
                  className={index === activeReturnIndex ? "is-active" : index < activeReturnIndex ? "is-done" : ""}
                >
                  {item}
                </strong>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Canvas>
  );
}

const SET_STATE_PANEL_EXCLUDED = new Set([
  "example",
  "expected",
  "final_result",
  "result",
  "returned",
  "visual_family",
]);

function SetStatePanel({ step, example }: { step: Step; example: string }) {
  const state = step.state || {};
  const variables = Object.entries(state).filter(([key, value]) => !SET_STATE_PANEL_EXCLUDED.has(key) && typeof value !== "undefined" && value !== "");
  const resultSoFar = formatArrayStateValue(state.result ?? state.answer ?? state.output);
  return (
    <aside className="ucv-array-state-panel ucv-set-state-panel" aria-label="Set trace memory">
      <div className="ucv-array-state-panel-section">
        <span className="ucv-array-state-panel-label">example</span>
        <strong className="ucv-array-state-panel-value">{example}</strong>
      </div>
      {variables.length ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">variables</span>
          <div className="ucv-array-state-panel-list">
            {variables.map(([key, value]) => (
              <div className="ucv-array-state-panel-row" key={key}>
                <span>{arrayStateLabel(key)}</span>
                <strong>{formatArrayStateValue(value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {resultSoFar ? (
        <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
          <span className="ucv-array-state-panel-label">result so far</span>
          <strong className="ucv-array-state-panel-value">{resultSoFar}</strong>
        </div>
      ) : null}
    </aside>
  );
}

function SetView({ step }: { step: Step }) {
  const nodes = sortedByX(step.nodes);
  const inputNodes = nodes.filter((node) => node.type === "array-cell" && node.meta?.role !== "memory");
  const memoryNodes = nodes.filter((node) => node.type === "set-item");
  const visibleMemory = memoryNodes.filter((node) => String(node.value).toLowerCase() !== "empty");
  const example = formatArrayStateValue(step.state?.example) || inputNodes.map((node) => String(node.value)).join(", ");
  return (
    <div className="ucv-set-shell" aria-label="Set visualizer">
      <SetStatePanel step={step} example={example} />
      <div className="ucv-set-main-region">
        <div className="ucv-set-input">
          <span>incoming items</span>
          <div>
            {inputNodes.map((node) => (
              <StatusBlock key={node.id} node={node} step={step} className="ucv-set-token" />
            ))}
          </div>
        </div>
        <div className="ucv-set-memory">
          <span>set memory</span>
          <div>
            {visibleMemory.length ? (
              visibleMemory.map((node) => (
                <StatusBlock key={node.id} node={{ ...node, label: visibleLabel(node, "kept") }} step={step} className="ucv-set-kept" />
              ))
            ) : (
              <StatusBlock
                node={{ id: "set-memory-empty", value: "empty", label: "memory", x: 0, y: 0, type: "set-item", state: "inactive" }}
                step={step}
                className="ucv-set-kept"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ArrayTraceState({ step, nodes }: { step: Step; nodes: VisualNode[] }) {
  if (!["array", "search", "sort", "binary-search", "two-pointers", "sliding-window"].includes(step.concept)) return null;
  if (step.concept === "binary-search") return null;
  if (step.concept === "two-pointers") return null;
  if (step.concept === "sliding-window") return null;
  const activeIndex = activeNodeIndex(step, nodes.length);
  const current = step.state?.current ?? nodes[activeIndex]?.value ?? "item";
  const hasReturned = step.state?.returned === true;
  const answer = hasReturned
    ? step.state?.final_result ?? step.state?.answer ?? step.state?.result ?? step.state?.swapped ?? step.state?.next ?? "none"
    : "none yet";
  if (step.concept === "binary-search") {
    return (
      <div className="ucv-array-trace-state" aria-label="Binary search trace state">
        <div>
          <span>target</span>
          <strong>{String(step.state?.target ?? "find value")}</strong>
        </div>
        <div>
          <span>search range</span>
          <strong>{String(step.state?.left ?? 0)} to {String(step.state?.right ?? nodes.length - 1)}</strong>
        </div>
        <div className="ucv-array-trace-result">
          <span>middle check</span>
          <strong>{String(step.state?.mid_value ?? nodes[activeIndex]?.value ?? "mid")}</strong>
        </div>
      </div>
    );
  }
  if (step.concept === "two-pointers") {
    return (
      <div className="ucv-array-trace-state" aria-label="Two pointer trace state">
        <div>
          <span>left pointer</span>
          <strong>{String(step.state?.left_value ?? nodes[Number(step.state?.left ?? 0)]?.value ?? "left")}</strong>
        </div>
        <div>
          <span>right pointer</span>
          <strong>{String(step.state?.right_value ?? nodes[Number(step.state?.right ?? nodes.length - 1)]?.value ?? "right")}</strong>
        </div>
        <div className="ucv-array-trace-result">
          <span>pair result</span>
          <strong>{String(step.state?.combined ?? step.state?.answer ?? "checking pair")}</strong>
        </div>
      </div>
    );
  }
  if (step.concept === "sliding-window") {
    return (
      <div className="ucv-array-trace-state" aria-label="Sliding window trace state">
        <div>
          <span>window</span>
          <strong>{String(step.state?.left ?? step.state?.window_start ?? 0)} to {String(step.state?.right ?? step.state?.window_end ?? 0)}</strong>
        </div>
        <div>
          <span>window value</span>
          <strong>{String(step.state?.window_value ?? step.state?.total ?? "current total")}</strong>
        </div>
        <div className="ucv-array-trace-result">
          <span>best so far</span>
          <strong>{String(step.state?.best ?? step.state?.answer ?? "not chosen yet")}</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="ucv-array-trace-state" aria-label="List trace state">
      <div>
        <span>index</span>
        <strong>{step.state?.index ?? activeIndex}</strong>
      </div>
      <div>
        <span>current item</span>
        <strong>{String(current)}</strong>
      </div>
      <div className="ucv-array-trace-result">
        <span>final result</span>
        <strong>{String(answer)}</strong>
      </div>
    </div>
  );
}

function formatArrayStateValue(value: string | number | boolean | undefined): string {
  if (typeof value === "undefined") return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function arrayStateLabel(key: string): string {
  return key.replace(/_/g, " ");
}

const ARRAY_STATE_PANEL_EXCLUDED = new Set([
  "answer",
  "current",
  "example",
  "final_result",
  "index",
  "result",
  "returned",
]);

function shouldShowArrayStatePanel(step: Step): boolean {
  return step.concept === "array" || step.concept === "search" || step.concept === "sort" || step.concept === "two-pointers" || step.concept === "sliding-window" || step.concept === "binary-search";
}

function ArrayStatePanel({ step }: { step: Step }) {
  const state = step.state || {};
  const variables = Object.entries(state).filter(([key, value]) => !ARRAY_STATE_PANEL_EXCLUDED.has(key) && typeof value !== "undefined" && value !== "");
  const resultSoFar = formatArrayStateValue(state.result ?? state.answer ?? state.rotated ?? state.rotated_start ?? state.swapped ?? state.next);
  const example = formatArrayStateValue(state.example);
  if (!example && !variables.length && !resultSoFar) return null;
  return (
    <aside className="ucv-array-state-panel" aria-label="Array trace memory">
      {example ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">example</span>
          <strong className="ucv-array-state-panel-value">{example}</strong>
        </div>
      ) : null}
      {variables.length ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">variables</span>
          <div className="ucv-array-state-panel-list">
            {variables.map(([key, value]) => (
              <div className="ucv-array-state-panel-row" key={key}>
                <span>{arrayStateLabel(key)}</span>
                <strong>{formatArrayStateValue(value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {resultSoFar ? (
        <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
          <span className="ucv-array-state-panel-label">result so far</span>
          <strong className="ucv-array-state-panel-value">{resultSoFar}</strong>
        </div>
      ) : null}
    </aside>
  );
}

const TWO_POINTER_STATE_EXCLUDED = new Set([
  "answer",
  "example",
  "final_result",
  "left",
  "left_value",
  "result",
  "returned",
  "right",
  "right_value",
  "target",
  "visual_family",
]);

const BINARY_SEARCH_STATE_EXCLUDED = new Set([
  "answer",
  "example",
  "final_result",
  "left",
  "mid",
  "mid_value",
  "candidate_index",
  "result",
  "returned",
  "right",
  "target",
  "visual_family",
]);

function BinarySearchStatePanel({ step }: { step: Step }) {
  const state = step.state || {};
  const variables = Object.entries(state).filter(([key, value]) => !BINARY_SEARCH_STATE_EXCLUDED.has(key) && typeof value !== "undefined" && value !== "");
  const example = formatArrayStateValue(state.example);
  const target = formatArrayStateValue(state.target ?? "find the requested boundary");
  const resultSoFar = formatArrayStateValue(state.result ?? state.answer ?? state.final_result);
  return (
    <aside className="ucv-array-state-panel ucv-binary-search-state-panel" aria-label="Binary search trace memory">
      {example ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">example</span>
          <strong className="ucv-array-state-panel-value">{example}</strong>
        </div>
      ) : null}
      <div className="ucv-array-state-panel-section">
        <span className="ucv-array-state-panel-label">target</span>
        <strong className="ucv-array-state-panel-value">{target}</strong>
      </div>
      <div className="ucv-array-state-panel-section">
        <span className="ucv-array-state-panel-label">range</span>
        <div className="ucv-array-state-panel-list">
          <div className="ucv-array-state-panel-row">
            <span>left</span>
            <strong>{formatArrayStateValue(state.left)}</strong>
          </div>
          <div className="ucv-array-state-panel-row">
            <span>mid</span>
            <strong>{formatArrayStateValue(state.mid_value ?? state.mid)}</strong>
          </div>
          <div className="ucv-array-state-panel-row">
            <span>right</span>
            <strong>{formatArrayStateValue(state.right)}</strong>
          </div>
        </div>
      </div>
      {variables.length ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">variables</span>
          <div className="ucv-array-state-panel-list">
            {variables.map(([key, value]) => (
              <div className="ucv-array-state-panel-row" key={key}>
                <span>{arrayStateLabel(key)}</span>
                <strong>{formatArrayStateValue(value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {resultSoFar ? (
        <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
          <span className="ucv-array-state-panel-label">result so far</span>
          <strong className="ucv-array-state-panel-value">{resultSoFar}</strong>
        </div>
      ) : null}
    </aside>
  );
}

function TwoPointerStatePanel({ step }: { step: Step }) {
  const state = step.state || {};
  const variables = Object.entries(state).filter(([key, value]) => !TWO_POINTER_STATE_EXCLUDED.has(key) && typeof value !== "undefined" && value !== "");
  const example = formatArrayStateValue(state.example);
  const target = formatArrayStateValue(state.target ?? "use both pointers");
  const resultSoFar = formatArrayStateValue(state.result ?? state.answer ?? state.final_result);
  return (
    <aside className="ucv-array-state-panel ucv-two-pointer-state-panel" aria-label="Two pointer trace memory">
      {example ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">example</span>
          <strong className="ucv-array-state-panel-value">{example}</strong>
        </div>
      ) : null}
      <div className="ucv-array-state-panel-section">
        <span className="ucv-array-state-panel-label">target</span>
        <strong className="ucv-array-state-panel-value">{target}</strong>
      </div>
      <div className="ucv-array-state-panel-section">
        <span className="ucv-array-state-panel-label">pointers</span>
        <div className="ucv-array-state-panel-list">
          <div className="ucv-array-state-panel-row">
            <span>left</span>
            <strong>{formatArrayStateValue(state.left_value ?? state.left)}</strong>
          </div>
          <div className="ucv-array-state-panel-row">
            <span>right</span>
            <strong>{formatArrayStateValue(state.right_value ?? state.right)}</strong>
          </div>
        </div>
      </div>
      {variables.length ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">variables</span>
          <div className="ucv-array-state-panel-list">
            {variables.map(([key, value]) => (
              <div className="ucv-array-state-panel-row" key={key}>
                <span>{arrayStateLabel(key)}</span>
                <strong>{formatArrayStateValue(value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {resultSoFar ? (
        <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
          <span className="ucv-array-state-panel-label">result so far</span>
          <strong className="ucv-array-state-panel-value">{resultSoFar}</strong>
        </div>
      ) : null}
    </aside>
  );
}

const SLIDING_WINDOW_STATE_EXCLUDED = new Set([
  "answer",
  "example",
  "final_result",
  "result",
  "returned",
  "target",
  "visual_family",
  "window",
  "window_end",
  "window_start",
]);

function SlidingWindowStatePanel({ step }: { step: Step }) {
  const state = step.state || {};
  const variables = Object.entries(state).filter(([key, value]) => !SLIDING_WINDOW_STATE_EXCLUDED.has(key) && typeof value !== "undefined" && value !== "");
  const example = formatArrayStateValue(state.example);
  const target = formatArrayStateValue(state.target ?? "track a moving window");
  const windowValue = formatArrayStateValue(state.window ?? `${state.window_start ?? 0}-${state.window_end ?? 0}`);
  const resultSoFar = formatArrayStateValue(state.result ?? state.answer ?? state.final_result ?? state.best);
  return (
    <aside className="ucv-array-state-panel ucv-sliding-window-state-panel" aria-label="Sliding window trace memory">
      {example ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">example</span>
          <strong className="ucv-array-state-panel-value">{example}</strong>
        </div>
      ) : null}
      <div className="ucv-array-state-panel-section">
        <span className="ucv-array-state-panel-label">target</span>
        <strong className="ucv-array-state-panel-value">{target}</strong>
      </div>
      <div className="ucv-array-state-panel-section">
        <span className="ucv-array-state-panel-label">window</span>
        <strong className="ucv-array-state-panel-value">{windowValue}</strong>
      </div>
      {variables.length ? (
        <div className="ucv-array-state-panel-section">
          <span className="ucv-array-state-panel-label">variables</span>
          <div className="ucv-array-state-panel-list">
            {variables.map(([key, value]) => (
              <div className="ucv-array-state-panel-row" key={key}>
                <span>{arrayStateLabel(key)}</span>
                <strong>{formatArrayStateValue(value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {resultSoFar ? (
        <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
          <span className="ucv-array-state-panel-label">result so far</span>
          <strong className="ucv-array-state-panel-value">{resultSoFar}</strong>
        </div>
      ) : null}
    </aside>
  );
}

export function ArrayVisualizer({ step }: { step: Step }) {
  if (step.concept === "bit-manipulation") {
    return <BitVisualizer step={step} />;
  }
  if (isStringLikeStep(step)) {
    return <StringScanVisualizer step={step} />;
  }
  if (step.concept === "prefix-sum") {
    return <Canvas concept={step.concept} className="ucv-structure-canvas"><PrefixSumRows step={step} /></Canvas>;
  }
  if (step.concept === "tuple") {
    return <Canvas concept={step.concept} className="ucv-structure-canvas"><TupleRows step={step} /></Canvas>;
  }
  if (step.concept === "set") {
    return <Canvas concept={step.concept} className="ucv-structure-canvas"><SetView step={step} /></Canvas>;
  }
  if (step.concept === "recursion") {
    return <RecursionView step={step} />;
  }
  const nodes = sortedByX(step.nodes).filter(isArrayRowNode);
  const showStatePanel = shouldShowArrayStatePanel(step);
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-array-canvas">
      {step.concept === "two-pointers" ? <div className="ucv-pointer-guide"><span>left moves forward</span><span>right moves backward</span></div> : null}
      {step.concept === "sliding-window" ? <div className="ucv-pointer-guide"><span>left edge</span><span>right edge</span></div> : null}
      {showStatePanel ? (
        <div className="ucv-array-visual-layout">
          {step.concept === "binary-search" ? <BinarySearchStatePanel step={step} /> : step.concept === "two-pointers" ? <TwoPointerStatePanel step={step} /> : step.concept === "sliding-window" ? <SlidingWindowStatePanel step={step} /> : <ArrayStatePanel step={step} />}
          <div className="ucv-array-main-region">
            <ArrayRow step={step} nodes={nodes} />
            <ArrayTraceState step={step} nodes={nodes} />
          </div>
        </div>
      ) : (
        <>
          <ArrayRow step={step} nodes={nodes} />
          <ArrayTraceState step={step} nodes={nodes} />
        </>
      )}
      {step.concept === "binary-search" ? <div className="ucv-array-caption">Highlighted values are being checked or saved; dimmed values are outside the current search range.</div> : null}
      {step.concept === "sliding-window" ? <div className="ucv-array-caption">The window moves as one visible block.</div> : null}
    </Canvas>
  );
}

type PositionedNode = VisualNode & { fx: number; fy: number };

function layoutWithDagre(nodes: VisualNode[], edges: Edge[], rankdir: "TB" | "LR", nodeWidth = 132, nodeHeight = 86): PositionedNode[] {
  if (!nodes.length) return [];
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir, nodesep: 56, ranksep: 92, marginx: 40, marginy: 40 });
  nodes.forEach((node) => graph.setNode(node.id, { width: nodeWidth, height: nodeHeight }));
  edges.forEach((edge) => {
    if (nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to)) {
      graph.setEdge(edge.from, edge.to);
    }
  });
  dagre.layout(graph);
  const graphWidth = Number(graph.graph().width || CANVAS_WIDTH);
  const graphHeight = Number(graph.graph().height || CANVAS_HEIGHT);
  const scale = Math.min(1, (CANVAS_WIDTH - 120) / Math.max(graphWidth, 1), (CANVAS_HEIGHT - 90) / Math.max(graphHeight, 1));
  const offsetX = (CANVAS_WIDTH - graphWidth * scale) / 2;
  const offsetY = (CANVAS_HEIGHT - graphHeight * scale) / 2;
  return nodes.map((node) => {
    const position = graph.node(node.id) || { x: node.x, y: node.y };
    return {
      ...node,
      fx: offsetX + position.x * scale,
      fy: offsetY + position.y * scale,
    };
  });
}

type FlowCardData = {
  node: VisualNode;
  step: Step;
  variant?: string;
};

function FlowNodeCard({ data }: { data: FlowCardData }) {
  const { node, step, variant = "" } = data;
  const status = nodeStatus(node, step);
  const muted = node.state === "inactive" || node.state === "skipped";
  return (
    <motion.div
      layout
      className={`ucv-flow-node-card ucv-flow-node-card--${status} ${variant}`}
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: muted ? 0.62 : 1, scale: status === "active" || status === "highlighted" ? 1.05 : 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      <Handle className="ucv-flow-handle" type="target" position={Position.Top} id="top-target" />
      <Handle className="ucv-flow-handle" type="target" position={Position.Left} id="left-target" />
      <Handle className="ucv-flow-handle" type="source" position={Position.Bottom} id="bottom-source" />
      <Handle className="ucv-flow-handle" type="source" position={Position.Right} id="right-source" />
      {node.label ? <span>{node.label}</span> : null}
      <strong>{node.value}</strong>
    </motion.div>
  );
}

const nodeTypes = { visualNode: FlowNodeCard };

function flowEdgeFromStep(edge: Edge, step: Step, rankdir: "TB" | "LR"): FlowEdge {
  const active = isEdgeActive(edge, step);
  const muted = edge.state === "inactive";
  const skipped = edge.state === "skipped";
  const markerEnd = edge.type === "parent-child" ? undefined : { type: MarkerType.ArrowClosed };
  return {
    id: edgeId(edge),
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    animated: active,
    label: edge.label,
    className: `ucv-flow-edge ${active ? "is-active" : ""} ${muted ? "is-muted" : ""} ${skipped ? "is-skipped" : ""}`,
    markerEnd,
    sourceHandle: rankdir === "TB" ? "bottom-source" : "right-source",
    targetHandle: rankdir === "TB" ? "top-target" : "left-target",
  };
}

function FlowScene({
  step,
  nodes,
  edges,
  className = "",
  children,
}: {
  step: Step;
  nodes: FlowNode<FlowCardData>[];
  edges: FlowEdge[];
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Canvas concept={step.concept} className={`ucv-react-flow-canvas ${className}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.35, maxZoom: 1.2 }}
        minZoom={0.25}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(148, 163, 184, 0.18)" gap={42} size={1} />
      </ReactFlow>
      {children}
    </Canvas>
  );
}

function NetworkScene({ step, rankdir, className = "" }: { step: Step; rankdir: "TB" | "LR"; className?: string }) {
  const positioned = useMemo(() => layoutWithDagre(step.nodes, step.edges, rankdir), [step.nodes, step.edges, rankdir]);
  const flowNodes = positioned.map((node) => ({
    id: node.id,
    type: "visualNode",
    position: { x: node.fx - 66, y: node.fy - 43 },
    data: {
      node,
      step,
      variant: `ucv-flow-node-card--${step.concept}`,
    },
  }));
  const visibleNodeIds = new Set(step.nodes.map((node) => node.id));
  const flowEdges = step.edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .map((edge) => flowEdgeFromStep(edge, step, rankdir));
  return <FlowScene step={step} nodes={flowNodes} edges={flowEdges} className={`ucv-network-canvas ${className}`} />;
}

export function TreeVisualizer({ step }: { step: Step }) {
  return <NetworkScene step={step} rankdir="TB" className="ucv-tree-canvas" />;
}

export function GraphVisualizer({ step }: { step: Step }) {
  const rankdir = step.concept === "union-find" ? "TB" : "LR";
  return <NetworkScene step={step} rankdir={rankdir} className="ucv-graph-canvas" />;
}

export function HashTableVisualizer({ step }: { step: Step }) {
  const buckets = sortedByX(step.nodes.filter((node) => node.type === "hash-bucket"));
  const entries = step.nodes.filter((node) => node.type === "hash-entry" || node.id.startsWith("entry-"));
  const activeBucket = buckets.find((bucket) => bucket.state === "active" || bucket.state === "visited" || isHighlighted(step, bucket.id)) || buckets[0];
  const activeEntry = entries.find((entry) => entry.state === "active" || entry.state === "comparing" || isHighlighted(step, entry.id)) || entries[0];
  const exampleText = step.state?.example ?? step.state?.sample;
  const keyText = String(step.state?.key || step.state?.lookup || step.state?.need || step.state?.current || activeEntry?.value || "key").replace(/\s*(?:->|:).*$/, "");
  const targetValue = step.state?.target ?? step.state?.lookup;
  const hasTarget = targetValue !== undefined && targetValue !== null && String(targetValue).trim() !== "";
  const targetText = hasTarget ? String(targetValue) : "";
  const bucketText = String(step.state?.bucket || activeBucket?.value || "?");
  const resultText = String(step.state?.result || step.state?.found || step.state?.pair || step.state?.price || step.state?.total || step.state?.groups || step.state?.table || step.state?.seen || "not found yet");
  const currentText = step.state?.num ?? step.state?.current;
  const needText = step.state?.need;
  const bucketEntries = new Map<string, VisualNode[]>();
  entries.forEach((entry, index) => {
    const bucketId = step.edges.find((edge) => edge.to === entry.id && edge.from.startsWith("bucket-"))?.from || "bucket-2";
    bucketEntries.set(bucketId, [...(bucketEntries.get(bucketId) || []), entry]);
    if (!step.edges.some((edge) => edge.to === entry.id)) {
      bucketEntries.set(`bucket-${index % Math.max(buckets.length, 1)}`, [...(bucketEntries.get(`bucket-${index % Math.max(buckets.length, 1)}`) || []), entry]);
    }
  });

  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-hash-canvas">
      <div className="ucv-hash-layout" aria-label="Hash map visualizer">
        <aside className="ucv-array-state-panel ucv-hash-state-panel" aria-label="Hash map trace memory">
          {exampleText ? (
            <div className="ucv-array-state-panel-section">
              <span className="ucv-array-state-panel-label">example</span>
              <strong className="ucv-array-state-panel-value">{String(exampleText)}</strong>
            </div>
          ) : null}
          <div className="ucv-array-state-panel-section">
            <span className="ucv-array-state-panel-label">key</span>
            <strong className="ucv-array-state-panel-value">{keyText}</strong>
          </div>
          {hasTarget ? (
            <div className="ucv-array-state-panel-section">
              <span className="ucv-array-state-panel-label">target</span>
              <strong className="ucv-array-state-panel-value">{targetText}</strong>
            </div>
          ) : null}
          <div className="ucv-array-state-panel-section">
            <span className="ucv-array-state-panel-label">variables</span>
            <div className="ucv-array-state-panel-list">
              {currentText !== undefined && currentText !== null ? (
                <div className="ucv-array-state-panel-row">
                  <span>current</span>
                  <strong>{String(currentText)}</strong>
                </div>
              ) : null}
              {needText !== undefined && needText !== null ? (
                <div className="ucv-array-state-panel-row">
                  <span>need</span>
                  <strong>{String(needText)}</strong>
                </div>
              ) : null}
              <div className="ucv-array-state-panel-row">
                <span>bucket</span>
                <strong>{bucketText}</strong>
              </div>
              <div className="ucv-array-state-panel-row">
                <span>chain</span>
                <strong>{activeEntry ? String(activeEntry.value) : "empty"}</strong>
              </div>
            </div>
          </div>
          <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
            <span className="ucv-array-state-panel-label">result so far</span>
            <strong className="ucv-array-state-panel-value">{resultText}</strong>
          </div>
        </aside>
        <div className="ucv-hash-main-region">
          <div className="ucv-hash-focus">
            <span>hash chooses</span>
            <strong>bucket {bucketText}</strong>
          </div>
          <div className="ucv-bucket-row">
            {buckets.map((bucket) => {
              const chain = bucketEntries.get(bucket.id) || [];
              return (
                <div key={bucket.id} className="ucv-bucket-column">
                  <StatusBlock node={bucket} step={step} className="ucv-bucket-box" />
                  {chain.length ? (
                    <div className="ucv-bucket-chain">
                      {chain.map((entry, index) => (
                        <div key={entry.id} className="ucv-chain-link">
                          <StatusBlock
                            node={{ ...entry, label: index === 0 ? "first entry" : "next entry" }}
                            step={step}
                            className="ucv-hash-entry"
                          />
                          {index < chain.length - 1 ? <span className="ucv-chain-arrow" aria-hidden="true" /> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="ucv-empty-bucket">empty</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Canvas>
  );
}

export function DPTableVisualizer({ step }: { step: Step }) {
  const cells = [...step.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  const labelCoords = cells.map((node) => String(node.label || node.id).match(/(?:cell-|dp-)?(\d+)[,-](\d+)/));
  const flatRows = Math.ceil(Math.sqrt(cells.length || 1));
  const flatCols = Math.ceil((cells.length || 1) / Math.max(flatRows, 1));
  const positioned = cells.map((node, index) => {
    const match = labelCoords[index];
    const row = match ? Number(match[1]) : Math.floor(index / flatCols);
    const col = match ? Number(match[2]) : index % flatCols;
    return { node, row, col };
  });
  const rows = positioned.length ? Math.max(...positioned.map((item) => item.row)) + 1 : 1;
  const cols = positioned.length ? Math.max(...positioned.map((item) => item.col)) + 1 : 1;
  const active = positioned.find(({ node }) => node.state === "active" || isHighlighted(step, node.id)) || positioned[0];
  const gridLookup = new Map(positioned.map((item) => [`${item.row}-${item.col}`, item.node]));
  const isMatrix = step.concept === "matrix";
  const matrixExample = step.state?.example ?? step.state?.sample;
  const matrixTarget = step.state?.target ?? step.state?.goal ?? "visit every cell once";
  const activeValue = active?.node?.value ?? "none";
  const matrixResult = step.state?.result ?? step.state?.answer ?? step.state?.total ?? step.state?.count ?? step.state?.sum ?? "not done";
  const matrixAction = step.state?.action ?? step.description;
  const matrixProgress = step.state?.progress ?? (active ? `${active.row + 1} of ${rows} rows` : "start");
  const gridContent = (
    <div
      className="ucv-dp-grid"
      style={{ "--ucv-dp-cols": cols } as CSSProperties}
      aria-label={step.concept === "dynamic-programming" ? "Dynamic programming table" : "Matrix grid"}
    >
      <span className="ucv-dp-axis ucv-dp-axis--corner">row/col</span>
      {Array.from({ length: cols }, (_, col) => (
        <span key={`col-${col}`} className={`ucv-dp-axis ${active?.col === col ? "is-active" : ""}`}>col {col}</span>
      ))}
      {Array.from({ length: rows }, (_, row) => (
        Array.from({ length: cols + 1 }, (_, colSlot) => {
          if (colSlot === 0) {
            return <span key={`row-${row}`} className={`ucv-dp-axis ${active?.row === row ? "is-active" : ""}`}>row {row}</span>;
          }
          const col = colSlot - 1;
          const node = gridLookup.get(`${row}-${col}`);
          return node ? (
            <StatusBlock
              key={node.id}
              node={{ ...node, label: step.concept === "dynamic-programming" ? `state ${row},${col}` : `${row},${col}` }}
              step={step}
              className="ucv-dp-cell"
            />
          ) : (
            <span key={`empty-${row}-${col}`} className="ucv-dp-empty" aria-hidden="true" />
          );
        })
      ))}
    </div>
  );
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-dp-canvas">
      <div className={`ucv-matrix-shell ${step.concept === "dynamic-programming" ? "ucv-matrix-shell--dp" : ""}`}>
        {isMatrix ? (
          <div className="ucv-matrix-layout">
            <aside className="ucv-array-state-panel ucv-matrix-state-panel" aria-label="Matrix trace memory">
              {matrixExample ? (
                <div className="ucv-array-state-panel-section">
                  <span className="ucv-array-state-panel-label">example</span>
                  <strong className="ucv-array-state-panel-value">{String(matrixExample)}</strong>
                </div>
              ) : null}
              <div className="ucv-array-state-panel-section">
                <span className="ucv-array-state-panel-label">target</span>
                <strong className="ucv-array-state-panel-value">{String(matrixTarget)}</strong>
              </div>
              <div className="ucv-array-state-panel-section">
                <span className="ucv-array-state-panel-label">current cell</span>
                <strong className="ucv-array-state-panel-value">{active ? `row ${active.row}, col ${active.col}` : "choose a cell"}</strong>
              </div>
              <div className="ucv-array-state-panel-section">
                <span className="ucv-array-state-panel-label">variables</span>
                <div className="ucv-array-state-panel-list">
                  <div className="ucv-array-state-panel-row">
                    <span>row</span>
                    <strong>{active?.row ?? "?"}</strong>
                  </div>
                  <div className="ucv-array-state-panel-row">
                    <span>col</span>
                    <strong>{active?.col ?? "?"}</strong>
                  </div>
                  <div className="ucv-array-state-panel-row">
                    <span>value</span>
                    <strong>{String(activeValue)}</strong>
                  </div>
                </div>
              </div>
              <div className="ucv-array-state-panel-section">
                <span className="ucv-array-state-panel-label">progress</span>
                <strong className="ucv-array-state-panel-value">{String(matrixProgress)}</strong>
              </div>
              <div className="ucv-array-state-panel-section ucv-array-state-panel-section--result">
                <span className="ucv-array-state-panel-label">result so far</span>
                <strong className="ucv-array-state-panel-value">{String(matrixResult)}</strong>
              </div>
            </aside>
            <div className="ucv-matrix-main-region">
              {gridContent}
              <div className="ucv-dp-insight">
                <span>why this cell</span>
                <strong>{active ? `grid[${active.row}][${active.col}] = ${String(activeValue)}` : "choose a cell"}</strong>
                <p>{String(matrixAction)}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {gridContent}
            <div className="ucv-dp-insight">
              <span>saved state</span>
              <strong>
                {active ? `row ${active.row}, col ${active.col}` : "choose a cell"}
              </strong>
              <p>Fill one cell, then reuse saved cells instead of recalculating.</p>
            </div>
          </>
        )}
      </div>
    </Canvas>
  );
}

export function IntervalVisualizer({ step }: { step: Step }) {
  const intervals = [...step.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-interval-canvas">
      <div className="ucv-interval-axis" aria-hidden="true" />
      <div className="ucv-interval-list">
        {intervals.map((node) => {
          const width = typeof node.meta?.width === "number" ? Number(node.meta.width) : 160;
          const left = Math.max(0, Math.min(72, ((node.x - width / 2) / CANVAS_WIDTH) * 100));
          return (
            <motion.div
              key={node.id}
              layout
              className={`ucv-interval-bar ucv-interval-bar--${nodeStatus(node, step)}`}
              style={{ width: `${Math.min(82, (width / CANVAS_WIDTH) * 100)}%`, marginLeft: `${left}%` }}
              initial={{ opacity: 0, scaleX: 0.7 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ type: "spring", stiffness: 240, damping: 25 }}
            >
              <span>{node.label}</span>
              <strong>{node.value}</strong>
            </motion.div>
          );
        })}
      </div>
    </Canvas>
  );
}

export function ConditionalFlowVisualizer({ step }: { step: Step }) {
  const byId = new Map(step.nodes.map((node) => [node.id, node]));
  const start = byId.get("start") || step.nodes[0];
  const input = byId.get("input") || step.nodes[1];
  const condition = byId.get("condition") || step.nodes[2];
  const yes = byId.get("true") || byId.get("yes") || step.nodes[3];
  const no = byId.get("false") || byId.get("no") || step.nodes[4];
  const end = byId.get("end") || byId.get("result") || step.nodes[5];
  const nodes = [
    start ? { id: "start", type: "visualNode", position: { x: 0, y: 138 }, data: { node: { ...start, label: "" }, step, variant: "ucv-flow-node-card--terminator" } } : null,
    input ? { id: "input", type: "visualNode", position: { x: 165, y: 128 }, data: { node: input, step, variant: "ucv-flow-node-card--input" } } : null,
    condition ? { id: "condition", type: "visualNode", position: { x: 380, y: 84 }, data: { node: condition, step, variant: "ucv-flow-node-card--diamond" } } : null,
    yes ? { id: "true", type: "visualNode", position: { x: 670, y: 20 }, data: { node: yes, step, variant: "ucv-flow-node-card--branch" } } : null,
    no ? { id: "false", type: "visualNode", position: { x: 670, y: 218 }, data: { node: no, step, variant: "ucv-flow-node-card--branch" } } : null,
    end ? { id: "end", type: "visualNode", position: { x: 895, y: 138 }, data: { node: { ...end, label: "" }, step, variant: "ucv-flow-node-card--terminator" } } : null,
  ].filter(Boolean) as FlowNode<FlowCardData>[];
  const edgeState = (id: string, fallback?: Edge["state"]) => step.edges.find((edge) => edge.id === id)?.state || fallback;
  const trueEdge = { id: "condition-true", from: "condition", to: "true", type: "branch" as const, label: "true", state: edgeState("condition-true") };
  const falseEdge = { id: "condition-false", from: "condition", to: "false", type: "branch" as const, label: "false", state: edgeState("condition-false", "inactive") };
  const edges = [
    { id: "start-input", from: "start", to: "input", type: "pointer" as const, state: edgeState("start-input") },
    { id: "input-condition", from: "input", to: "condition", type: "pointer" as const, state: edgeState("input-condition") },
    trueEdge,
    falseEdge,
    { id: "true-end", from: "true", to: "end", type: "pointer" as const, state: edgeState("true-end", trueEdge.state) },
    { id: "false-end", from: "false", to: "end", type: "pointer" as const, state: edgeState("false-end", falseEdge.state) },
  ].map((edge) => flowEdgeFromStep(edge, step, "LR"));
  const ruleText = String(condition?.meta?.fullText || condition?.value || "");
  const inputText = String(input?.meta?.fullText || input?.value || "");
  const resultText = String(step.state?.chosen_result || end?.meta?.fullText || end?.value || yes?.meta?.fullText || yes?.value || "");
  return (
    <FlowScene step={step} nodes={nodes} edges={edges} className="ucv-condition-canvas">
      <div className="ucv-condition-callout" aria-label="Full conditional rule">
        <div>
          <span>Input</span>
          <strong>{inputText}</strong>
        </div>
        <div>
          <span>Rule being checked</span>
          <strong>{ruleText}</strong>
        </div>
        <div>
          <span>Chosen result</span>
          <strong>{resultText}</strong>
        </div>
      </div>
    </FlowScene>
  );
}
