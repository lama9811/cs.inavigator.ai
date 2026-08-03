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

export function StackVisualizer({ step }: { step: Step }) {
  const nodes = sortedStackNodes(step.nodes);
  const topId = nodes[nodes.length - 1]?.id;
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-stack-canvas">
      <div className="ucv-stack-shell" aria-label="Stack visualizer">
        <span className="ucv-stack-label ucv-stack-label--top">Top</span>
        <div className="ucv-stack-track">
          <AnimatePresence mode="popLayout">
            {nodes.map((node, index) => (
              <StatusBlock
                key={node.id}
                node={{ ...node, label: node.id === topId ? "top" : index === 0 ? "bottom" : "" }}
                step={step}
                className="ucv-stack-item"
              />
            ))}
          </AnimatePresence>
        </div>
        <span className="ucv-stack-base">Bottom of stack</span>
      </div>
    </Canvas>
  );
}

export function QueueVisualizer({ step }: { step: Step }) {
  const nodes = sortedByX(step.nodes);
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-queue-canvas">
      <div className="ucv-queue-shell" aria-label="Queue visualizer">
        <span className="ucv-flow-label">Front leaves first</span>
        <div className="ucv-queue-track">
          <AnimatePresence mode="popLayout">
            {nodes.map((node, index) => (
              <div key={node.id} className="ucv-queue-item-wrap">
                <StatusBlock
                  node={{ ...node, label: index === 0 ? "front" : index === nodes.length - 1 ? "rear" : visibleLabel(node, String(index)) }}
                  step={step}
                  className="ucv-queue-item"
                />
                {index < nodes.length - 1 ? <span className="ucv-inline-arrow" aria-hidden="true" /> : null}
              </div>
            ))}
          </AnimatePresence>
        </div>
        <span className="ucv-flow-label">New items join here</span>
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

function contiguousRange(step: Step, nodes: VisualNode[]): [number, number] | null {
  const active = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.state === "active" || node.state === "comparing" || isHighlighted(step, node.id))
    .map(({ index }) => index);
  if (!active.length) return null;
  return [Math.min(...active), Math.max(...active)];
}

function ArrayRow({ step, nodes }: { step: Step; nodes: VisualNode[] }) {
  const range = step.concept === "sliding-window" || step.concept === "binary-search" ? contiguousRange(step, nodes) : null;
  return (
    <div className="ucv-array-row" style={{ "--ucv-array-count": nodes.length } as CSSProperties}>
      {range ? (
        <motion.span
          className={`ucv-array-overlay ucv-array-overlay--${step.concept}`}
          layout
          style={{
            gridColumn: `${range[0] + 1} / ${range[1] + 2}`,
          }}
          aria-hidden="true"
        />
      ) : null}
      {nodes.map((node) => (
        <StatusBlock key={node.id} node={node} step={step} className="ucv-array-cell" />
      ))}
    </div>
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

function SetView({ step }: { step: Step }) {
  const nodes = sortedByX(step.nodes);
  return (
    <div className="ucv-set-shell" aria-label="Set visualizer">
      <div className="ucv-set-input">
        <span>incoming items</span>
        <div>
          {nodes.map((node) => (
            <StatusBlock key={node.id} node={node} step={step} className="ucv-set-token" />
          ))}
        </div>
      </div>
      <div className="ucv-set-memory">
        <span>unique set memory</span>
        <div>
          {[...new Map(nodes.filter((node) => node.state !== "inactive").map((node) => [String(node.value), node])).values()].map((node) => (
            <StatusBlock key={`memory-${node.id}`} node={{ ...node, label: "kept" }} step={step} className="ucv-set-kept" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ArrayVisualizer({ step }: { step: Step }) {
  if (step.concept === "prefix-sum") {
    return <Canvas concept={step.concept} className="ucv-structure-canvas"><PrefixSumRows step={step} /></Canvas>;
  }
  if (step.concept === "tuple") {
    return <Canvas concept={step.concept} className="ucv-structure-canvas"><TupleRows step={step} /></Canvas>;
  }
  if (step.concept === "set") {
    return <Canvas concept={step.concept} className="ucv-structure-canvas"><SetView step={step} /></Canvas>;
  }
  const nodes = sortedByX(step.nodes);
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-array-canvas">
      <ArrayRow step={step} nodes={nodes} />
      {step.concept === "binary-search" ? <div className="ucv-array-caption">Only the bright range can still contain the target.</div> : null}
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
  return (
    <motion.div
      layout
      className={`ucv-flow-node-card ucv-flow-node-card--${status} ${variant}`}
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: node.state === "inactive" ? 0.42 : 1, scale: status === "active" || status === "highlighted" ? 1.05 : 1 }}
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
  const markerEnd = edge.type === "parent-child" ? undefined : { type: MarkerType.ArrowClosed };
  return {
    id: edgeId(edge),
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    animated: active,
    label: edge.label,
    className: `ucv-flow-edge ${active ? "is-active" : ""} ${muted ? "is-muted" : ""}`,
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
}: {
  step: Step;
  nodes: FlowNode<FlowCardData>[];
  edges: FlowEdge[];
  className?: string;
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
  const targets = step.nodes.filter((node) => node.id === "target" || node.id === "hash");
  const buckets = sortedByX(step.nodes.filter((node) => node.type === "hash-bucket"));
  const entries = step.nodes.filter((node) => node.type === "hash-entry" || node.id.startsWith("entry-"));
  const bucketEntries = new Map<string, Node[]>();
  entries.forEach((entry, index) => {
    const bucketId = step.edges.find((edge) => edge.to === entry.id && edge.from.startsWith("bucket-"))?.from || "bucket-2";
    bucketEntries.set(bucketId, [...(bucketEntries.get(bucketId) || []), entry]);
    if (!step.edges.some((edge) => edge.to === entry.id)) {
      bucketEntries.set(`bucket-${index % Math.max(buckets.length, 1)}`, [...(bucketEntries.get(`bucket-${index % Math.max(buckets.length, 1)}`) || []), entry]);
    }
  });

  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-hash-canvas">
      <div className="ucv-hash-flow">
        {targets.map((node, index) => (
          <div className="ucv-hash-flow-item" key={node.id}>
            <StatusBlock node={node} step={step} className="ucv-hash-target" />
            {index < targets.length - 1 ? <span className="ucv-inline-arrow is-active" aria-hidden="true" /> : null}
          </div>
        ))}
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
                      <StatusBlock node={entry} step={step} className="ucv-hash-entry" />
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
    </Canvas>
  );
}

export function DPTableVisualizer({ step }: { step: Step }) {
  const cells = [...step.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  const coords = cells.map((node) => String(node.label || "").match(/(\d+),(\d+)/)).filter(Boolean) as RegExpMatchArray[];
  const rows = coords.length ? Math.max(...coords.map((match) => Number(match[1]))) + 1 : Math.ceil(Math.sqrt(cells.length));
  const cols = coords.length ? Math.max(...coords.map((match) => Number(match[2]))) + 1 : Math.ceil(cells.length / Math.max(rows, 1));
  return (
    <Canvas concept={step.concept} className="ucv-structure-canvas ucv-dp-canvas">
      <div className="ucv-dp-grid" style={{ "--ucv-dp-cols": cols } as CSSProperties}>
        {cells.slice(0, rows * cols).map((node) => (
          <StatusBlock key={node.id} node={node} step={step} className="ucv-dp-cell" />
        ))}
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
    start ? { id: "start", type: "visualNode", position: { x: 0, y: 130 }, data: { node: { ...start, label: "" }, step, variant: "ucv-flow-node-card--terminator" } } : null,
    input ? { id: "input", type: "visualNode", position: { x: 170, y: 130 }, data: { node: input, step, variant: "ucv-flow-node-card--input" } } : null,
    condition ? { id: "condition", type: "visualNode", position: { x: 360, y: 116 }, data: { node: condition, step, variant: "ucv-flow-node-card--diamond" } } : null,
    yes ? { id: "true", type: "visualNode", position: { x: 600, y: 30 }, data: { node: yes, step, variant: "ucv-flow-node-card--branch" } } : null,
    no ? { id: "false", type: "visualNode", position: { x: 600, y: 220 }, data: { node: no, step, variant: "ucv-flow-node-card--branch" } } : null,
    end ? { id: "end", type: "visualNode", position: { x: 820, y: 130 }, data: { node: { ...end, label: "" }, step, variant: "ucv-flow-node-card--terminator" } } : null,
  ].filter(Boolean) as FlowNode<FlowCardData>[];
  const trueEdge = { id: "condition-true", from: "condition", to: "true", type: "branch" as const, label: "true", state: isEdgeActive({ id: "condition-true", from: "condition", to: "true", type: "branch" }, step) ? "active" as const : undefined };
  const falseEdge = { id: "condition-false", from: "condition", to: "false", type: "branch" as const, label: "false", state: isEdgeActive({ id: "condition-false", from: "condition", to: "false", type: "branch" }, step) ? "active" as const : "inactive" as const };
  const edges = [
    { id: "start-input", from: "start", to: "input", type: "pointer" as const },
    { id: "input-condition", from: "input", to: "condition", type: "pointer" as const },
    trueEdge,
    falseEdge,
    { id: "true-end", from: "true", to: "end", type: "pointer" as const, state: trueEdge.state },
    { id: "false-end", from: "false", to: "end", type: "pointer" as const, state: falseEdge.state },
  ].map((edge) => flowEdgeFromStep(edge, step, "LR"));
  return <FlowScene step={step} nodes={nodes} edges={edges} className="ucv-condition-canvas" />;
}
