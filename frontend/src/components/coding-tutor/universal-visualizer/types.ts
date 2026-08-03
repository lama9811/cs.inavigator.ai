export type ConceptType =
  | "array"
  | "tuple"
  | "set"
  | "linked-list"
  | "hash-map"
  | "binary-tree"
  | "graph"
  | "search"
  | "sort"
  | "conditional"
  | "stack"
  | "queue"
  | "two-pointers"
  | "sliding-window"
  | "binary-search"
  | "recursion"
  | "math"
  | "matrix"
  | "prefix-sum"
  | "intervals"
  | "heap"
  | "trie"
  | "union-find"
  | "dynamic-programming"
  | "bit-manipulation";

export type NodeType =
  | "array-cell"
  | "array-index"
  | "set-item"
  | "linked-node"
  | "hash-bucket"
  | "hash-entry"
  | "tree-node"
  | "graph-vertex"
  | "logic-node";

export type NodeState =
  | "default"
  | "active"
  | "visited"
  | "deleted"
  | "comparing"
  | "matched"
  | "queued"
  | "path"
  | "inactive";

export type EdgeType = "pointer" | "parent-child" | "graph-edge" | "branch";

export interface Node {
  id: string;
  x: number;
  y: number;
  value: string | number;
  type: NodeType;
  state?: NodeState;
  label?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface Edge {
  id?: string;
  from: string;
  to: string;
  type: EdgeType;
  state?: NodeState;
  label?: string;
}

export interface Highlight {
  nodeIds?: string[];
  edgeIds?: string[];
  lineNumbers?: number[];
}

export interface WorkflowStep {
  id: string;
  label: string;
  detail?: string;
  state?: NodeState;
}

export interface Step {
  id: string;
  concept: ConceptType;
  title: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
  highlights?: Highlight;
  code: string[];
  activeLine?: number;
  state?: Record<string, string | number | boolean>;
  workflow?: WorkflowStep[];
  activeWorkflowId?: string;
}

export interface ConceptConfig {
  id: ConceptType;
  label: string;
  description: string;
  generateSteps: () => Step[];
}

export interface GeneratorContext {
  title?: string;
  topic?: string;
  prompt?: string;
  exampleInput?: string;
  exampleOutput?: string;
  constraints?: string[];
  visualizer?: {
    concept?: string;
    title?: string;
    caption?: string;
    patternSketch?: string;
    input?: Record<string, unknown>;
    steps?: Array<Record<string, unknown>>;
  };
  useAuthored?: boolean;
}
