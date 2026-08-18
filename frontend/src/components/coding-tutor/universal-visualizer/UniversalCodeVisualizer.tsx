import { useEffect, useMemo, useRef, useState } from "react";
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
  const title = String(problem?.title || "").toLowerCase();
  const raw = `${visualConcept} ${topic} ${title}`.toLowerCase();
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
  if (/\bprefix sums?\b|running prefix|range sum|subarray sum|balance index|balanced prefix split/.test(raw)) return "prefix-sum";
  if (raw.includes("interval")) return "intervals";
  if (raw.includes("dynamic")) return "dynamic-programming";
  if (raw.includes("bit")) return "bit-manipulation";
  if (raw.includes("array-scan") || raw.includes("string-scan") || raw.includes("array") || raw.includes("string") || raw.includes("list")) return "array";
  if (raw.includes("search")) return "search";
  if (raw.includes("sort")) return "sort";
  return "array";
}

function contextFromProblem(problem: any): GeneratorContext {
  const examples = Array.isArray(problem?.examples) ? problem.examples : [];
  const example = examples[0] || null;
  return {
    title: problem?.title,
    topic: problem?.topic,
    prompt: problem?.prompt,
    exampleInput: example?.input,
    exampleOutput: example?.output,
    examples,
    constraints: Array.isArray(problem?.constraints) ? problem.constraints : [],
    visualizer: problem?.visualizer,
  };
}

function conceptLabel(concept: ConceptType): string {
  return CONCEPTS.find((item) => item.id === concept)?.label || "Concept";
}

function isStringVisualStep(step: Step): boolean {
  return step.nodes.some((node) => node.meta?.role === "string-cell");
}

function stringCurrentValue(step: Step): string {
  const activeNodes = step.nodes
    .filter((node) => node.meta?.role === "string-cell")
    .filter((node) => node.state === "active" || step.highlights?.nodeIds?.includes(node.id));
  if (activeNodes.length) return activeNodes.map((node) => String(node.value)).join(", ");
  return "none";
}

function StateStrip({ step }: { step: Step }) {
  if (step.concept === "conditional") return null;
  if (step.concept === "set") return null;
  if (step.concept === "hash-map") return null;
  if (step.concept === "matrix") return null;
  if (step.concept === "dynamic-programming") return null;
  if (step.concept === "graph") return null;
  if (step.concept === "binary-tree") return null;
  if (step.concept === "heap") return null;
  if (step.concept === "trie") return null;
  if (step.concept === "recursion") return null;
  if (step.concept === "stack") return null;
  if (step.concept === "queue") return null;
  if (step.concept === "linked-list") return null;
  if (step.concept === "bit-manipulation") return null;
  if (step.concept === "two-pointers") return null;
  if (step.concept === "sliding-window") return null;
  if (step.concept === "binary-search") return null;
  if (step.concept === "prefix-sum") return null;
  if (step.concept === "intervals") return null;
  if (step.state?.visual_family === "string-prefix-search") return null;
  if (isStringVisualStep(step)) {
    const hasReturned = step.state?.returned === true;
    const finalResult = hasReturned
      ? step.state?.final_result ?? step.state?.expected ?? step.state?.result ?? "none"
      : "none yet";
    return (
      <div className="ucv-state-strip" aria-label="Current string state">
        <div>
          <span>index</span>
          <strong>{String(step.state?.index ?? "0")}</strong>
        </div>
        <div>
          <span>current item</span>
          <strong>{stringCurrentValue(step)}</strong>
        </div>
        <div>
          <span>final result</span>
          <strong>{String(finalResult)}</strong>
        </div>
      </div>
    );
  }
  const hiddenKeys = new Set(["sample", "prompt_rule", "text", "input", "goal", "final_result"]);
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

function HashRuleCard({ step }: { step: Step }) {
  if (step.concept !== "hash-map") return null;
  const bucketCount = step.nodes.filter((node) => node.type === "hash-bucket").length || 1;
  const bucket = step.state?.bucket;
  const key = String(step.state?.key || step.state?.lookup || step.state?.need || step.state?.current || "key").replace(/\s*(?:->|:).*$/, "");
  const rule = String(
    step.state?.hashRule
      || step.state?.hash
      || (bucket !== undefined && bucket !== null && String(bucket).trim() !== "?"
        ? `demo hash(${key}) % ${bucketCount} = ${bucket}`
        : "hash(key) % bucket count"),
  );
  return (
    <div className="ucv-state-strip ucv-hash-rule-strip" aria-label="Hash rule reference">
      <div>
        <span>hash rule</span>
        <strong>{rule}</strong>
      </div>
    </div>
  );
}

function WorkflowRail({ step }: { step: Step }) {
  const items = step.workflow || [];
  const activeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [step.activeWorkflowId]);
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
            <div
              ref={state === "active" ? activeRef : null}
              className={`ucv-workflow-node ucv-workflow-node--${state}`}
            >
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
  const [activeCaseId, setActiveCaseId] = useState("");
  const [activeExampleIndex, setActiveExampleIndex] = useState(0);
  const baseContext = useMemo(() => contextFromProblem(activeProblem), [activeProblem]);
  const bitExampleOptions = useMemo(() => {
    if (concept !== "bit-manipulation") return [];
    return (baseContext.examples || [])
      .map((item, index) => ({ id: String(index), label: `Example ${index + 1}`, input: item.input || "", output: item.output || "" }))
      .filter((item) => item.input);
  }, [baseContext.examples, concept]);
  const selectedExample = bitExampleOptions[activeExampleIndex] || bitExampleOptions[0];
  const context = useMemo(() => ({
    ...baseContext,
    exampleInput: selectedExample?.input || baseContext.exampleInput,
    exampleOutput: selectedExample?.output || baseContext.exampleOutput,
  }), [baseContext, selectedExample]);
  const useAuthored = concept === initialConcept;
  const allSteps = useMemo(() => generateStepsForConcept(concept, { ...context, useAuthored }), [concept, context, useAuthored]);
  const hasConditionalSteps = allSteps.some((item) => item.concept === "conditional");
  const caseOptions = useMemo(() => {
    if (!hasConditionalSteps) return [];
    const seen = new Map<string, string>();
    allSteps.forEach((item) => {
      const id = typeof item.state?.case_id === "string" ? item.state.case_id : "";
      const label = typeof item.state?.case_label === "string" ? item.state.case_label : id;
      if (id && !seen.has(id)) seen.set(id, label);
    });
    return Array.from(seen, ([id, label]) => ({ id, label }));
  }, [allSteps, hasConditionalSteps]);
  const selectedCaseId = caseOptions.some((item) => item.id === activeCaseId) ? activeCaseId : caseOptions[0]?.id || "";
  const steps = useMemo(() => (
    selectedCaseId ? allSteps.filter((item) => item.state?.case_id === selectedCaseId) : allSteps
  ), [allSteps, selectedCaseId]);
  const step = steps[stepIndex] || steps[0];

  useEffect(() => {
    setConcept(initialConcept);
    setStepIndex(0);
    setPlaying(false);
    setActiveCaseId("");
    setActiveExampleIndex(0);
  }, [initialConcept, activeProblem?.id]);

  useEffect(() => {
    setStepIndex(0);
    setPlaying(false);
    setActiveCaseId("");
    setActiveExampleIndex(0);
  }, [concept]);

  useEffect(() => {
    if (activeExampleIndex >= bitExampleOptions.length) setActiveExampleIndex(0);
  }, [activeExampleIndex, bitExampleOptions.length]);

  useEffect(() => {
    if (stepIndex >= steps.length) setStepIndex(Math.max(0, steps.length - 1));
  }, [stepIndex, steps.length]);

  useEffect(() => {
    if (!playing || stepIndex >= steps.length - 1) {
      if (stepIndex >= steps.length - 1) setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setStepIndex((current) => Math.min(steps.length - 1, current + 1)), 1200 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, speed, stepIndex, steps.length]);

  if (!step) return null;
  const displayedConcept = step.concept || concept;

  const caseSwitcher = caseOptions.length > 1 ? (
    <div className="ucv-case-switcher" role="group" aria-label="Conditional example cases">
      {caseOptions.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`ucv-case-button ${selectedCaseId === item.id ? "is-active" : ""}`}
          onClick={() => {
            setActiveCaseId(item.id);
            setStepIndex(0);
            setPlaying(false);
          }}
          aria-pressed={selectedCaseId === item.id}
        >
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

  const exampleSwitcher = bitExampleOptions.length > 1 ? (
    <div className="ucv-case-switcher ucv-example-switcher" role="group" aria-label="Bit manipulation examples">
      {bitExampleOptions.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={`ucv-case-button ${activeExampleIndex === index ? "is-active" : ""}`}
          onClick={() => {
            setActiveExampleIndex(index);
            setStepIndex(0);
            setPlaying(false);
          }}
          aria-pressed={activeExampleIndex === index}
          title={`${item.input} -> ${item.output}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

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
            <div className="ucv-concept-pill" aria-label={`Visualizer concept: ${conceptLabel(displayedConcept)}`}>
              <span>Concept</span>
              <strong>{conceptLabel(displayedConcept)}</strong>
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
          {caseSwitcher}
          {exampleSwitcher}
          <WorkflowRail step={step} />
          <VisualizerCanvas step={step} />
          {mode === "panel" ? controls : null}
          {mode === "panel" ? <HashRuleCard step={step} /> : null}
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
      {mode === "modal" ? <HashRuleCard step={step} /> : null}
    </section>
  );
}
