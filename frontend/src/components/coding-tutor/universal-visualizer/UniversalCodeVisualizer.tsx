import { AnimatePresence, motion } from "framer-motion";
import { memo, useEffect, useMemo, useState } from "react";
import { generateStepsForConcept } from "./generators";
import type { ConceptType, Edge, GeneratorContext, Node, Step } from "./types";
import "./UniversalCodeVisualizer.css";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 520;

const CONCEPTS: Array<{ id: ConceptType; label: string }> = [
  { id: "array", label: "Arrays / sorting" },
  { id: "two-pointers", label: "Two pointers" },
  { id: "sliding-window", label: "Sliding window" },
  { id: "binary-search", label: "Binary search" },
  { id: "hash-map", label: "Hash maps" },
  { id: "stack", label: "Stacks" },
  { id: "queue", label: "Queues" },
  { id: "linked-list", label: "Linked lists" },
  { id: "recursion", label: "Recursion" },
  { id: "binary-tree", label: "Binary trees" },
  { id: "graph", label: "Graphs" },
  { id: "conditional", label: "Conditionals" },
  { id: "math", label: "Math" },
  { id: "matrix", label: "Matrices" },
  { id: "prefix-sum", label: "Prefix sums" },
  { id: "intervals", label: "Intervals" },
  { id: "heap", label: "Heaps" },
  { id: "trie", label: "Tries" },
  { id: "union-find", label: "Union find" },
  { id: "dynamic-programming", label: "Dynamic programming" },
  { id: "bit-manipulation", label: "Bit manipulation" },
];

function conceptFromProblem(problem: any): ConceptType {
  const raw = `${problem?.visualizer?.concept || ""} ${problem?.topic || ""}`.toLowerCase();
  if (raw.includes("linked")) return "linked-list";
  if (raw.includes("two pointer")) return "two-pointers";
  if (raw.includes("sliding")) return "sliding-window";
  if (raw.includes("binary search")) return "binary-search";
  if (raw.includes("hash") || raw.includes("map") || raw.includes("set") || raw.includes("dictionary")) return "hash-map";
  if (raw.includes("stack")) return "stack";
  if (raw.includes("queue")) return "queue";
  if (raw.includes("recursion")) return "recursion";
  if (raw.includes("tree")) return "binary-tree";
  if (raw.includes("graph")) return "graph";
  if (raw.includes("condition") || raw.includes("decision")) return "conditional";
  if (raw.includes("math") || raw.includes("arithmetic")) return "math";
  if (raw.includes("matrix")) return "matrix";
  if (raw.includes("prefix")) return "prefix-sum";
  if (raw.includes("interval")) return "intervals";
  if (raw.includes("heap")) return "heap";
  if (raw.includes("trie")) return "trie";
  if (raw.includes("union") || raw.includes("disjoint")) return "union-find";
  if (raw.includes("dynamic")) return "dynamic-programming";
  if (raw.includes("bit")) return "bit-manipulation";
  if (raw.includes("array-scan") || raw.includes("string-scan") || raw.includes("array") || raw.includes("string") || raw.includes("list")) return "array";
  if (raw.includes("search")) return "search";
  if (raw.includes("sort")) return "sort";
  return "array";
}

function contextFromProblem(problem: any): GeneratorContext {
  const example = Array.isArray(problem?.examples) ? problem.examples[0] : null;
  return {
    title: problem?.title,
    topic: problem?.topic,
    prompt: problem?.prompt,
    exampleInput: example?.input,
    exampleOutput: example?.output,
    constraints: Array.isArray(problem?.constraints) ? problem.constraints : [],
    visualizer: problem?.visualizer,
  };
}

function conceptLabel(concept: ConceptType): string {
  return CONCEPTS.find((item) => item.id === concept)?.label || "Concept";
}

function edgePath(edge: Edge, nodes: Node[]): string {
  const from = nodes.find((node) => node.id === edge.from);
  const to = nodes.find((node) => node.id === edge.to);
  if (!from || !to) return "";
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const curve = edge.type === "parent-child" || Math.abs(dy) < 8 ? 0 : Math.min(54, Math.abs(dx + dy) * 0.08);
  const controlX = from.x + dx / 2;
  const controlY = from.y + dy / 2 - curve;
  return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
}

function nodeClass(node: Node, highlighted: boolean): string {
  return [
    "ucv-node",
    `ucv-node--${node.type}`,
    `ucv-node--${node.state || "default"}`,
    node.meta?.role ? `ucv-node-role--${node.meta.role}` : "",
    highlighted ? "ucv-node--highlighted" : "",
  ].filter(Boolean).join(" ");
}

const VisualNode = memo(function VisualNode({ node, highlighted }: { node: Node; highlighted: boolean }) {
  return (
    <motion.div
      layout
      className={nodeClass(node, highlighted)}
      data-role={node.meta?.role}
      initial={{ opacity: 0, scale: 0.55, x: "-50%", y: "-50%" }}
      animate={{
        opacity: node.state === "deleted" ? 0 : node.state === "inactive" ? 0.42 : 1,
        scale: node.state === "active" || highlighted ? 1.12 : node.state === "deleted" ? 0 : 1,
        left: `${(node.x / CANVAS_WIDTH) * 100}%`,
        top: `${(node.y / CANVAS_HEIGHT) * 100}%`,
      }}
      exit={{ opacity: 0, scale: 0, transition: { duration: 0.24 } }}
      transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.7 }}
    >
      <span>{node.label}</span>
      <strong>{node.value}</strong>
    </motion.div>
  );
});

function EdgeLayer({ edges, nodes, highlights }: { edges: Edge[]; nodes: Node[]; highlights: string[] }) {
  const highlighted = new Set(highlights);
  return (
    <svg className="ucv-edges" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} aria-hidden="true">
      <AnimatePresence>
        {edges.map((edge) => {
          const id = edge.id || `${edge.from}-${edge.to}`;
          const d = edgePath(edge, nodes);
          if (!d) return null;
          const isHot = highlighted.has(id) || edge.state === "active" || edge.state === "path";
          const from = nodes.find((node) => node.id === edge.from);
          const to = nodes.find((node) => node.id === edge.to);
          const labelX = from && to ? (from.x + to.x) / 2 : 0;
          const labelY = from && to ? (from.y + to.y) / 2 - 12 : 0;
          return (
            <g key={id}>
              <motion.path
                className={`ucv-edge ucv-edge--${edge.type} ${isHot ? "ucv-edge--active" : ""} ${edge.state === "inactive" ? "ucv-edge--inactive" : ""}`}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ d, pathLength: 1, opacity: edge.state === "inactive" ? 0.28 : 1 }}
                exit={{ opacity: 0, pathLength: 0 }}
                transition={{ duration: 0.48, ease: "easeInOut" }}
                fill="none"
              />
              {edge.label ? (
                <motion.text
                  className={`ucv-edge-label ${isHot ? "is-active" : ""}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: edge.state === "inactive" ? 0.35 : 1, x: labelX, y: labelY }}
                  transition={{ duration: 0.3 }}
                  textAnchor="middle"
                >
                  {edge.label}
                </motion.text>
              ) : null}
            </g>
          );
        })}
      </AnimatePresence>
    </svg>
  );
}

function StateStrip({ step }: { step: Step }) {
  const entries = Object.entries(step.state || {});
  if (!entries.length) return null;
  return (
    <div className="ucv-state-strip" aria-label="Current state">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span>{key.replace(/_/g, " ")}</span>
          <strong>{String(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function CodeView({ step }: { step: Step }) {
  const lines = step.code || [];
  const highlighted = new Set(step.highlights?.lineNumbers || (step.activeLine ? [step.activeLine] : []));
  return (
    <div className="ucv-code" aria-label="Pseudocode">
      <span>Pseudocode</span>
      <ol>
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          return (
            <li key={`${line}-${lineNumber}`} className={highlighted.has(lineNumber) ? "is-active" : ""}>
              <em>{lineNumber}</em>
              <code>{line}</code>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function VisualizerCanvas({ step }: { step: Step }) {
  const highlightedNodes = new Set(step.highlights?.nodeIds || []);
  return (
    <div className="ucv-canvas">
      <EdgeLayer edges={step.edges} nodes={step.nodes} highlights={step.highlights?.edgeIds || []} />
      <AnimatePresence>
        {step.nodes.map((node) => (
          <VisualNode key={node.id} node={node} highlighted={highlightedNodes.has(node.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface UniversalCodeVisualizerProps {
  activeProblem?: any;
  mode?: "panel" | "modal";
  onClose?: () => void;
}

export default function UniversalCodeVisualizer({ activeProblem, mode = "panel", onClose }: UniversalCodeVisualizerProps) {
  const initialConcept = conceptFromProblem(activeProblem);
  const isAuthoredProblem = Boolean(activeProblem?.visualizer?.concept);
  const [concept, setConcept] = useState<ConceptType>(initialConcept);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const context = useMemo(() => contextFromProblem(activeProblem), [activeProblem]);
  const useAuthored = concept === initialConcept;
  const steps = useMemo(() => generateStepsForConcept(concept, { ...context, useAuthored }), [concept, context, useAuthored]);
  const step = steps[stepIndex] || steps[0];

  useEffect(() => {
    setConcept(initialConcept);
    setStepIndex(0);
    setPlaying(false);
  }, [initialConcept, activeProblem?.id]);

  useEffect(() => {
    setStepIndex(0);
    setPlaying(false);
  }, [concept]);

  useEffect(() => {
    if (!playing || stepIndex >= steps.length - 1) {
      if (stepIndex >= steps.length - 1) setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setStepIndex((current) => Math.min(steps.length - 1, current + 1)), 1200 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, speed, stepIndex, steps.length]);

  if (!step) return null;

  return (
    <section className={`ucv-shell ucv-shell--${mode}`}>
      <header className="ucv-header">
        <div>
          <span>Universal visualizer</span>
          <h3 id={mode === "modal" ? "workspace-visualizer-title" : undefined}>{step.title}</h3>
          <p id={mode === "modal" ? "workspace-visualizer-description" : undefined}>{step.description}</p>
        </div>
        <div className="ucv-header-actions">
          {isAuthoredProblem ? (
            <div className="ucv-concept-pill" aria-label={`Visualizer concept: ${conceptLabel(concept)}`}>
              <span>Concept</span>
              <strong>{conceptLabel(concept)}</strong>
            </div>
          ) : (
            <label>
              Concept
              <select value={concept} onChange={(event) => setConcept(event.target.value as ConceptType)}>
                {CONCEPTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          )}
          {mode === "modal" && onClose ? (
            <button type="button" className="ucv-close" onClick={onClose} data-autofocus>
              Close
            </button>
          ) : null}
        </div>
      </header>

      <div className="ucv-main">
        <div className="ucv-stage">
          <VisualizerCanvas step={step} />
          <StateStrip step={step} />
        </div>
        <aside className="ucv-side">
          <div className="ucv-card">
            <span>What is happening</span>
            <h4>{step.title}</h4>
            <p>{step.description}</p>
          </div>
          <CodeView step={step} />
        </aside>
      </div>

      <footer className="ucv-controls" aria-label="Visualizer controls">
        <button type="button" onClick={() => setStepIndex(0)}>Reset</button>
        <button type="button" onClick={() => setPlaying((current) => !current)}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min="0"
          max={steps.length - 1}
          value={stepIndex}
          onChange={(event) => {
            setPlaying(false);
            setStepIndex(Number(event.target.value));
          }}
          aria-label="Timeline scrubber"
        />
        <span>{stepIndex + 1} / {steps.length}</span>
        <label>
          Speed
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
        </label>
      </footer>
    </section>
  );
}
