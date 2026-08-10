import { useEffect, useMemo, useState } from "react";
import { FaExternalLinkAlt, FaPause, FaPlay, FaRedoAlt, FaStepBackward, FaStepForward, FaTimes } from "react-icons/fa";
import { generateStepsForConcept } from "./generators";
import {
  ArrayVisualizer,
  ConditionalFlowVisualizer,
  DPTableVisualizer,
  GraphVisualizer,
  HashTableVisualizer,
  IntervalVisualizer,
  LinkedListVisualizer,
  MathVisualizer,
  QueueVisualizer,
  StackVisualizer,
  TreeVisualizer,
} from "./StructureVisualizers";
import type { ConceptType, GeneratorContext, Step } from "./types";
import "./UniversalCodeVisualizer.css";

const CONCEPTS: Array<{ id: ConceptType; label: string }> = [
  { id: "array", label: "Arrays / sorting" },
  { id: "tuple", label: "Tuples / pairs" },
  { id: "set", label: "Sets" },
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
  const topic = String(problem?.topic || "").toLowerCase();
  const visualConcept = String(problem?.visualizer?.concept || "").toLowerCase();
  const raw = `${visualConcept} ${topic}`.toLowerCase();
  if (raw.includes("linked")) return "linked-list";
  if (raw.includes("two pointer")) return "two-pointers";
  if (raw.includes("sliding")) return "sliding-window";
  if (raw.includes("binary search")) return "binary-search";
  if (raw.includes("heap")) return "heap";
  if (raw.includes("trie")) return "trie";
  if (raw.includes("union") || raw.includes("disjoint")) return "union-find";
  if (topic.includes("tuple") || visualConcept.includes("tuple")) return "tuple";
  if (topic.includes("set") || visualConcept === "set") return "set";
  if (raw.includes("hash") || raw.includes("map") || raw.includes("dictionary")) return "hash-map";
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

function StateStrip({ step }: { step: Step }) {
  if (step.concept === "conditional") return null;
  const hiddenKeys = new Set(["sample", "prompt_rule", "text", "input", "goal"]);
  const entries = Object.entries(step.state || {}).filter(([key]) => !hiddenKeys.has(key));
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

function WorkflowRail({ step }: { step: Step }) {
  const items = step.workflow || [];
  if (!items.length) return null;
  return (
    <div className="ucv-workflow" aria-label="Visualizer workflow">
      {items.map((item, index) => {
        const state = item.state || (item.id === step.activeWorkflowId ? "active" : "default");
        const connectorState = index < items.length - 1
          ? items[index + 1]?.state || (items[index + 1]?.id === step.activeWorkflowId ? "active" : state)
          : state;
        return (
          <div key={item.id} className="ucv-workflow-step">
            <div className={`ucv-workflow-node ucv-workflow-node--${state}`}>
              <span className="ucv-workflow-dot" aria-hidden="true">{index + 1}</span>
              <span className="ucv-workflow-label">{item.label}</span>
            </div>
            {index < items.length - 1 ? (
              <span className={`ucv-workflow-line ucv-workflow-line--${connectorState}`} aria-hidden="true" />
            ) : null}
          </div>
        );
      })}
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
  if (step.concept === "stack") return <StackVisualizer step={step} />;
  if (step.concept === "queue") return <QueueVisualizer step={step} />;
  if (step.concept === "linked-list") return <LinkedListVisualizer step={step} />;
  if (step.concept === "binary-tree" || step.concept === "heap" || step.concept === "trie") return <TreeVisualizer step={step} />;
  if (step.concept === "graph" || step.concept === "union-find") return <GraphVisualizer step={step} />;
  if (step.concept === "hash-map") return <HashTableVisualizer step={step} />;
  if (step.concept === "math") return <MathVisualizer step={step} />;
  if (step.concept === "matrix" || step.concept === "dynamic-programming") return <DPTableVisualizer step={step} />;
  if (step.concept === "intervals") return <IntervalVisualizer step={step} />;
  if (step.concept === "conditional") return <ConditionalFlowVisualizer step={step} />;
  return <ArrayVisualizer step={step} />;
}

interface UniversalCodeVisualizerProps {
  activeProblem?: any;
  mode?: "panel" | "modal";
  onClose?: () => void;
  onOpenInWorkspace?: () => void;
}

export default function UniversalCodeVisualizer({ activeProblem, mode = "panel", onClose, onOpenInWorkspace }: UniversalCodeVisualizerProps) {
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

  const controls = (
    <footer className="ucv-controls" aria-label="Visualizer controls">
      <div className="ucv-playbar" role="group" aria-label="Step playback">
        {mode === "modal" && onOpenInWorkspace ? (
          <button type="button" className="ucv-control-button ucv-control-button--workspace" onClick={onOpenInWorkspace}>
            <FaExternalLinkAlt aria-hidden="true" />
            <span>Open in Workspace</span>
          </button>
        ) : null}
        <button type="button" className="ucv-control-button" onClick={() => setStepIndex(0)}>
          <FaRedoAlt aria-hidden="true" />
          <span>Reset</span>
        </button>
        <button
          type="button"
          className="ucv-control-button"
          onClick={() => {
            setPlaying(false);
            setStepIndex((current) => Math.max(0, current - 1));
          }}
          disabled={stepIndex <= 0}
        >
          <FaStepBackward aria-hidden="true" />
          <span>Previous</span>
        </button>
        <button
          type="button"
          className="ucv-control-button ucv-control-button--play"
          onClick={() => setPlaying((current) => !current)}
        >
          {playing ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
          <span>{playing ? "Pause" : "Play"}</span>
        </button>
        <button
          type="button"
          className="ucv-control-button"
          onClick={() => {
            setPlaying(false);
            setStepIndex((current) => Math.min(steps.length - 1, current + 1));
          }}
          disabled={stepIndex >= steps.length - 1}
        >
          <span>Next</span>
          <FaStepForward aria-hidden="true" />
        </button>
        <span className="ucv-step-count" aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
          {stepIndex + 1} / {steps.length}
        </span>
        <div className="ucv-speed-control" role="group" aria-label="Playback speed">
          <span>Speed</span>
          <div className="ucv-speed-options">
            {[0.75, 1, 1.5, 2].map((option) => (
              <button
                key={option}
                type="button"
                className={`ucv-speed-option ${speed === option ? "is-active" : ""}`}
                onClick={() => setSpeed(option)}
                aria-pressed={speed === option}
                title={`Play at ${option}x speed`}
              >
                {option}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );

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
            <button
              type="button"
              className="ucv-close"
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
              data-autofocus
              aria-label="Close visualizer"
            >
              <FaTimes aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="ucv-main">
        <div className="ucv-stage">
          <WorkflowRail step={step} />
          <VisualizerCanvas step={step} />
          {mode === "panel" ? controls : null}
          <StateStrip step={step} />
        </div>
        <aside className="ucv-side">
          <div className="ucv-card">
            <span>Current step</span>
            <h4>{step.title}</h4>
            <p>{step.description}</p>
          </div>
          <CodeView step={step} />
        </aside>
      </div>

      {mode === "modal" ? controls : null}
    </section>
  );
}
