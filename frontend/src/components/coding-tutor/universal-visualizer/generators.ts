import type { Edge, GeneratorContext, Node, Step } from "./types";
import { insertTreeValue, layoutArray, layoutCircularGraph, layoutConditional, layoutHashBuckets, layoutTree } from "./layouts";

function withNodeState(nodes: Node[], activeIds: string[], state: Node["state"] = "active"): Node[] {
  const active = new Set(activeIds);
  return nodes.map((node) => ({
    ...node,
    state: active.has(node.id) ? state : node.state || "default",
  }));
}

function withEdgeState(edges: Edge[], activeIds: string[], state: Edge["state"] = "active"): Edge[] {
  const active = new Set(activeIds);
  return edges.map((edge) => ({
    ...edge,
    state: active.has(edge.id || `${edge.from}-${edge.to}`) ? state : edge.state || "default",
  }));
}

function step(partial: Omit<Step, "id">, index: number): Step {
  return { ...partial, id: `${partial.concept}-${index}` };
}

function splitCodeLines(value: unknown, fallback: string[]): string[] {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.split("\n").map((line) => line.trimEnd()).filter(Boolean);
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function visibleState(state: Record<string, unknown> = {}): Record<string, string | number | boolean> {
  const hidden = new Set([
    "items",
    "values",
    "active",
    "table",
    "grid",
    "activeCells",
    "nodes",
    "edges",
    "stack",
    "queue",
    "call_stack",
    "active_call",
  ]);
  const entries = Object.entries(state)
    .filter(([key, value]) => !hidden.has(key) && value !== undefined && value !== "")
    .slice(0, 6)
    .map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : value]);
  return Object.fromEntries(entries) as Record<string, string | number | boolean>;
}

function parseToken(token: string): string | number {
  const cleaned = token.trim().replace(/^['"]|['"]$/g, "");
  const numeric = Number(cleaned);
  return cleaned !== "" && Number.isFinite(numeric) ? numeric : cleaned;
}

function parseFirstList(input?: string): Array<string | number> {
  const match = String(input || "").match(/\[([^\]]*)\]/);
  if (!match) return [];
  return match[1].split(",").map(parseToken).filter((value) => String(value).length > 0);
}

function parseAllNamedLists(input?: string): Record<string, Array<string | number>> {
  const lists: Record<string, Array<string | number>> = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\[([^\]]*)\]/g;
  let match = pattern.exec(String(input || ""));
  while (match) {
    lists[match[1]] = match[2].split(",").map(parseToken).filter((value) => String(value).length > 0);
    match = pattern.exec(String(input || ""));
  }
  return lists;
}

function parseScalarAssignments(input?: string): Record<string, string> {
  const result: Record<string, string> = {};
  String(input || "").split(",").forEach((part) => {
    const [key, ...rest] = part.split("=");
    if (!key || !rest.length) return;
    result[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  });
  return result;
}

function valuesForState(concept: string, state: Record<string, unknown>, context: GeneratorContext): Array<string | number> {
  const namedLists = parseAllNamedLists(context.exampleInput);
  const firstNamed = Object.values(namedLists)[0];
  if (firstNamed?.length) return firstNamed.slice(0, 12);

  const firstList = parseFirstList(context.exampleInput);
  if (firstList.length) return firstList.slice(0, 12);

  if (concept === "array" && context.exampleInput && !context.exampleInput.includes("=")) {
    return [...context.exampleInput].slice(0, 12).map((char) => char === " " ? "space" : char);
  }

  const authoredItems = Array.isArray(state.items) ? state.items : Array.isArray(state.values) ? state.values : [];
  if (authoredItems.length) return authoredItems.slice(0, 12).map((value) => value as string | number);
  return [2, 1, 5, 1, 3];
}

function activeIndexes(state: Record<string, unknown>, max: number, fallback: number): number[] {
  const active = Array.isArray(state.active) ? state.active : [];
  const indexes = active
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0 && value < max);
  return indexes.length ? indexes : [Math.min(Math.max(fallback, 0), Math.max(max - 1, 0))];
}

function authoredArrayVisual(concept: string, state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = valuesForState(concept, state, context);
  const active = activeIndexes(state, values.length, index);
  const pointerMap = state.pointers && typeof state.pointers === "object" ? state.pointers as Record<string, unknown> : {};
  const windowRange = Array.isArray(state.window) ? state.window.map(Number) : null;
  const nodes = layoutArray(values).map((node, nodeIndex) => {
    const pointerLabel = Object.entries(pointerMap)
      .filter(([, value]) => Number(value) === nodeIndex)
      .map(([key]) => key)
      .join("/");
    const inWindow = windowRange && nodeIndex >= Number(windowRange[0]) && nodeIndex <= Number(windowRange[1]);
    return {
      ...node,
      label: pointerLabel || node.label,
      state: active.includes(nodeIndex) || inWindow ? "active" as const : node.state,
    };
  });
  return { nodes, edges: [], highlights: active.map((item) => `item-${item}`) };
}

function buildTableVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const namedLists = parseAllNamedLists(context.exampleInput);
  const assignments = parseScalarAssignments(context.exampleInput);
  const keyList = namedLists.items || namedLists.names || namedLists.keys || parseFirstList(context.exampleInput);
  const valueList = namedLists.prices || namedLists.scores || namedLists.values || [];
  const target = assignments.target || String(state.lookup || keyList[Math.min(index, Math.max(keyList.length - 1, 0))] || "lookup");
  const rows = keyList.length
    ? keyList.map((key, rowIndex) => ({ key, value: valueList[rowIndex] ?? "seen" }))
    : (Array.isArray(state.table) ? state.table as Array<Record<string, unknown>> : []).map((row) => ({ key: row.key || "key", value: row.value || "value" }));
  const nodes: Node[] = [
    { id: "lookup", x: 170, y: 260, value: `lookup ${target}`, type: "logic-node", label: "target", state: "active" },
  ];
  const edges: Edge[] = [];
  const highlights = ["lookup"];
  const visibleRows = rows.slice(0, 5);
  const rowGap = visibleRows.length > 1 ? Math.min(92, 320 / (visibleRows.length - 1)) : 92;
  visibleRows.forEach((row, rowIndex) => {
    const y = visibleRows.length === 1 ? 260 : 110 + rowIndex * rowGap;
    const isActive = String(row.key) === target || rowIndex === Math.min(index, rows.length - 1);
    nodes.push(
      { id: `key-${rowIndex}`, x: 430, y, value: String(row.key), type: "array-cell", label: "key", state: isActive ? "comparing" : "default", meta: { role: "table-cell" } },
      { id: `value-${rowIndex}`, x: 650, y, value: String(row.value), type: "array-cell", label: "value", state: isActive ? "active" : "default", meta: { role: "table-cell" } },
    );
    edges.push({ id: `row-${rowIndex}`, from: `key-${rowIndex}`, to: `value-${rowIndex}`, type: "pointer", state: isActive ? "active" : "default" });
    if (isActive) highlights.push(`key-${rowIndex}`, `value-${rowIndex}`);
  });
  return { nodes, edges, highlights };
}

function relevantRule(context: GeneratorContext): string {
  const output = String(context.exampleOutput || "").toLowerCase();
  const constraints = context.constraints || [];
  const matching = constraints.find((item) => item.toLowerCase().includes("return") && output && item.toLowerCase().includes(output));
  if (matching) return matching.replace(/^return\s+/i, "").replace(/\.$/, "");
  const returnRule = constraints.find((item) => item.toLowerCase().includes("return"));
  if (returnRule) return returnRule.replace(/^return\s+/i, "").replace(/\.$/, "");
  return constraints.find((item) => !/integer|length|same|range|empty/i.test(item)) || "the condition from the prompt";
}

function authoredConditionalVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const input = context.exampleInput || String(state.sample || "sample input");
  const output = context.exampleOutput || String(state.goal || "result").replace(/^return shape:\s*/i, "");
  const rule = relevantRule(context);
  const phase = index <= 0 ? "input" : index === 1 ? "condition" : index === 2 ? "yes" : "result";
  const nodes: Node[] = [
    { id: "input", x: 130, y: 260, value: input, type: "logic-node", label: "input", state: phase === "input" ? "active" : "visited", meta: { role: "terminator" } },
    { id: "condition", x: 360, y: 260, value: rule, type: "logic-node", label: "condition", state: phase === "condition" ? "active" : "visited", meta: { role: "diamond" } },
    { id: "yes", x: 610, y: 150, value: "matches", type: "logic-node", label: "yes", state: phase === "yes" || phase === "result" ? "active" : "default" },
    { id: "no", x: 610, y: 370, value: "try next rule", type: "logic-node", label: "no", state: "inactive" },
    { id: "result", x: 800, y: 150, value: output, type: "logic-node", label: "return", state: phase === "result" ? "active" : "default", meta: { role: "terminator" } },
  ];
  const edges: Edge[] = [
    { id: "input-condition", from: "input", to: "condition", type: "branch", state: index >= 1 ? "active" : "default" },
    { id: "condition-yes", from: "condition", to: "yes", type: "branch", label: "yes", state: index >= 2 ? "active" : "default" },
    { id: "condition-no", from: "condition", to: "no", type: "branch", label: "no", state: "inactive" },
    { id: "yes-result", from: "yes", to: "result", type: "branch", state: index >= 3 ? "active" : "default" },
  ];
  return { nodes, edges, highlights: [phase] };
}

function authoredStackQueueVisual(concept: string, state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = (Array.isArray(state.stack) ? state.stack : Array.isArray(state.queue) ? state.queue : valuesForState(concept, state, context)).map((value) => value as string | number);
  const nodes = layoutArray(values.length ? values : ["empty"], { y: 260 }).map((node, nodeIndex) => ({
    ...node,
    label: concept === "queue" ? (nodeIndex === 0 ? "front" : nodeIndex === values.length - 1 ? "back" : String(nodeIndex)) : (nodeIndex === values.length - 1 ? "top" : String(nodeIndex)),
    state: nodeIndex === Math.min(index, Math.max(values.length - 1, 0)) ? "active" as const : node.state,
  }));
  return { nodes, edges: [], highlights: [`item-${Math.min(index, Math.max(nodes.length - 1, 0))}`] };
}

function authoredGridVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const grid = Array.isArray(state.grid) ? state.grid as unknown[][] : [[1, 2, 3], [4, 5, 6]];
  const activeCells = new Set((Array.isArray(state.activeCells) ? state.activeCells : [[0, Math.min(index, grid[0]?.length || 1)]]).map((cell) => Array.isArray(cell) ? cell.join("-") : String(cell)));
  const nodes: Node[] = [];
  grid.slice(0, 5).forEach((row, rowIndex) => {
    row.slice(0, 6).forEach((value, colIndex) => {
      const id = `cell-${rowIndex}-${colIndex}`;
      nodes.push({
        id,
        x: 300 + colIndex * 86,
        y: 145 + rowIndex * 82,
        value: value as string | number,
        type: "array-cell",
        label: `${rowIndex},${colIndex}`,
        state: activeCells.has(`${rowIndex}-${colIndex}`) ? "active" : "default",
      });
    });
  });
  return { nodes, edges: [], highlights: nodes.filter((node) => node.state === "active").map((node) => node.id) };
}

function authoredNodeVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const sourceNodes = Array.isArray(state.nodes) ? state.nodes as Array<Record<string, unknown>> : [];
  const sourceEdges = Array.isArray(state.edges) ? state.edges as Array<Record<string, unknown>> : [];
  if (!sourceNodes.length) {
    return context.visualizer?.concept === "graph" ? { ...layoutCircularGraph(["A", "B", "C", "D"], [["A", "B"], ["A", "C"], ["B", "D"]]), highlights: ["A"] } : { ...layoutTree([8, 4, 12, 2, 6].reduce((root, value) => insertTreeValue(root, value), null as ReturnType<typeof insertTreeValue> | null)), highlights: [] };
  }
  const nodes = sourceNodes.map((node, nodeIndex) => ({
    id: String(node.id || `node-${nodeIndex}`),
    x: Number(node.x || 60) * 2 + 40,
    y: Number(node.y || 60) * 1.8 + 40,
    value: String(node.label || node.value || node.id || nodeIndex),
    type: context.visualizer?.concept === "graph" ? "graph-vertex" as const : "tree-node" as const,
    state: node.active ? "active" as const : "default" as const,
  }));
  const edges = sourceEdges.map((edge, edgeIndex) => ({
    id: String(edge.id || `${edge.from}-${edge.to}-${edgeIndex}`),
    from: String(edge.from),
    to: String(edge.to),
    type: context.visualizer?.concept === "graph" ? "graph-edge" as const : "parent-child" as const,
    state: edge.active ? "active" as const : "default" as const,
  }));
  return { nodes, edges, highlights: nodes.filter((node) => node.state === "active").map((node) => node.id) };
}

function visualForAuthoredStep(concept: string, state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  if (concept === "conditional") return authoredConditionalVisual(state, context, index);
  if (String(context.topic || "").toLowerCase().includes("tuple") || /pair/i.test(context.title || "")) return buildTableVisual(state, context, index);
  if (concept === "hash-map") return buildTableVisual(state, context, index);
  if (concept === "stack" || concept === "queue") return authoredStackQueueVisual(concept, state, context, index);
  if (concept === "matrix" || concept === "dynamic-programming") return authoredGridVisual(state, context, index);
  if (concept === "binary-tree" || concept === "graph" || concept === "linked-list") return authoredNodeVisual(state, context, index);
  return authoredArrayVisual(concept, state, context, index);
}

function titleForAuthoredStep(rawTitle: unknown, context: GeneratorContext, index: number): string {
  const title = cleanText(rawTitle, "");
  if (!title || /make the key move|decide the next step|set up the sample/i.test(title)) {
    const labels = ["Load the example", "Make one visible move", "Predict the next state", "Return only what the prompt asks"];
    return `${labels[Math.min(index, labels.length - 1)]}: ${context.title || "Practice problem"}`;
  }
  return title;
}

function bodyForAuthoredStep(rawBody: unknown, context: GeneratorContext, index: number): string {
  const body = cleanText(rawBody, "");
  if (!body || /one pointer, cell, memory slot|apply the main|tiny version of the problem/i.test(body)) {
    const sample = context.exampleInput ? `Use the example input ${context.exampleInput}. ` : "";
    const output = context.exampleOutput ? `The example output is ${context.exampleOutput}, but the code path is still yours to build.` : "Focus on the next state change, not a memorized answer.";
    if (index === 0) return `${sample}Set up only the small state you need to trace the idea.`;
    if (index === 1) return "Move one pointer, branch, lookup, or stored value exactly one step.";
    if (index === 2) return "Pause and predict what the next state should be before revealing it.";
    return output;
  }
  return body;
}

function generateAuthoredVisualizerSteps(concept: string, context: GeneratorContext = {}): Step[] | null {
  const authoredSteps = context.visualizer?.steps;
  if (!context.useAuthored || !Array.isArray(authoredSteps) || !authoredSteps.length) return null;
  const baseState = (context.visualizer?.input || {}) as Record<string, unknown>;
  return authoredSteps.map((raw, index) => {
    const rawState = {
      ...baseState,
      ...((raw.state && typeof raw.state === "object") ? raw.state as Record<string, unknown> : {}),
    };
    const visual = visualForAuthoredStep(concept, rawState, context, index);
    const fallbackCode = splitCodeLines((context.visualizer as { patternSketch?: string } | undefined)?.patternSketch, [
      "read the example input",
      "make one state change",
      "predict the next state",
      "return only what the prompt asks",
    ]);
    const code = splitCodeLines(raw.code, fallbackCode);
    return step({
      concept: concept as Step["concept"],
      title: titleForAuthoredStep(raw.title, context, index),
      description: bodyForAuthoredStep(raw.body, context, index),
      nodes: visual.nodes,
      edges: visual.edges,
      highlights: { nodeIds: visual.highlights, edgeIds: visual.edges.filter((edge) => edge.state === "active").map((edge) => edge.id || `${edge.from}-${edge.to}`), lineNumbers: [Math.min(index + 1, code.length)] },
      code,
      activeLine: Math.min(index + 1, code.length),
      state: {
        example: context.exampleInput || String(rawState.sample || ""),
        expected: context.exampleOutput || "",
        ...visibleState(rawState),
      },
    }, index + 1);
  });
}

export function generateArraySwapSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "look at the first pair",
    "if the left value is bigger",
    "swap the two values",
    "keep moving through the list",
  ];
  const startValues = [8, 3, 6, 2, 5];
  const start = layoutArray(startValues);
  const comparing = withNodeState(start, ["item-0", "item-1"], "comparing");
  const swapped = layoutArray([3, 8, 6, 2, 5]).map((node) => (
    node.id === "item-0" || node.id === "item-1" ? { ...node, state: "active" as const } : node
  ));
  const nextPair = withNodeState(swapped, ["item-1", "item-2"], "comparing");

  return [
    step({
      concept: "array",
      title: context.title || "Array swap",
      description: "Start with the list. Each cell has a stable index, and values move between cells.",
      nodes: start,
      edges: [],
      highlights: { nodeIds: [], lineNumbers: [1] },
      code,
      activeLine: 1,
      state: { action: "start" },
    }, 1),
    step({
      concept: "array",
      title: "Compare neighbors",
      description: "Compare the first two values. The highlighted cells are the only ones being decided right now.",
      nodes: comparing,
      edges: [],
      highlights: { nodeIds: ["item-0", "item-1"], lineNumbers: [1, 2] },
      code,
      activeLine: 2,
      state: { comparing: "8 and 3" },
    }, 2),
    step({
      concept: "array",
      title: "Swap the values",
      description: "Because 8 is bigger than 3, the values trade places. The cells stay lined up; the values slide.",
      nodes: swapped,
      edges: [],
      highlights: { nodeIds: ["item-0", "item-1"], lineNumbers: [3] },
      code,
      activeLine: 3,
      state: { swapped: "8 with 3" },
    }, 3),
    step({
      concept: "array",
      title: "Move to the next pair",
      description: "After a swap, the scan moves one step over and compares the next pair.",
      nodes: nextPair,
      edges: [],
      highlights: { nodeIds: ["item-1", "item-2"], lineNumbers: [4] },
      code,
      activeLine: 4,
      state: { next: "compare 8 and 6" },
    }, 4),
  ];
}

export function generateTreeInsertSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "start at the root",
    "if the new value is smaller, go left",
    "if the new value is larger, go right",
    "insert at the empty child spot",
    "rebalance if the tree gets tilted",
  ];
  const beforeRoot = [30, 15, 45, 10, 22].reduce((root, value) => insertTreeValue(root, value), null as ReturnType<typeof insertTreeValue> | null);
  const before = layoutTree(beforeRoot);
  const search = {
    nodes: withNodeState(before.nodes, ["tree-30", "tree-15", "tree-22"], "comparing"),
    edges: withEdgeState(before.edges, ["tree-30-tree-15", "tree-15-tree-22"], "active"),
  };
  const insertedRoot = insertTreeValue(beforeRoot, 24);
  const inserted = layoutTree(insertedRoot);
  const activeInsert = {
    nodes: withNodeState(inserted.nodes, ["tree-24"], "active"),
    edges: withEdgeState(inserted.edges, ["tree-22-tree-24"], "active"),
  };
  const rotatedRoot = [22, 15, 30, 10, 24, 45].reduce((root, value) => insertTreeValue(root, value), null as ReturnType<typeof insertTreeValue> | null);
  const rotated = layoutTree(rotatedRoot);
  const activeRotate = {
    nodes: withNodeState(rotated.nodes, ["tree-22", "tree-30"], "visited"),
    edges: withEdgeState(rotated.edges, ["tree-22-tree-30", "tree-30-tree-24"], "active"),
  };

  return [
    step({
      concept: "binary-tree",
      title: context.title || "Binary tree insert",
      description: "Start at the root. Smaller values go left, larger values go right.",
      nodes: before.nodes,
      edges: before.edges,
      highlights: { nodeIds: ["tree-30"], lineNumbers: [1] },
      code,
      activeLine: 1,
      state: { root: 30 },
    }, 1),
    step({
      concept: "binary-tree",
      title: "Walk down the search path",
      description: "The new value follows comparisons from 30 to 15 to 22. Only that path matters.",
      nodes: search.nodes,
      edges: search.edges,
      highlights: { nodeIds: ["tree-30", "tree-15", "tree-22"], edgeIds: ["tree-30-tree-15", "tree-15-tree-22"], lineNumbers: [2, 3] },
      code,
      activeLine: 3,
      state: { inserting: 24 },
    }, 2),
    step({
      concept: "binary-tree",
      title: "Insert at the empty spot",
      description: "24 becomes the right child of 22. The new node drops into the tree and connects to its parent.",
      nodes: activeInsert.nodes,
      edges: activeInsert.edges,
      highlights: { nodeIds: ["tree-24"], edgeIds: ["tree-22-tree-24"], lineNumbers: [4] },
      code,
      activeLine: 4,
      state: { inserted: 24 },
    }, 3),
    step({
      concept: "binary-tree",
      title: "Rebalance the shape",
      description: "If a tree becomes too tilted, a rotation moves whole subtrees while keeping sorted order intact.",
      nodes: activeRotate.nodes,
      edges: activeRotate.edges,
      highlights: { nodeIds: ["tree-22", "tree-30"], lineNumbers: [5] },
      code,
      activeLine: 5,
      state: { rotation: "right-left shape becomes balanced" },
    }, 4),
  ];
}

export function generateHashMapCollisionSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "choose a bucket with the hash function",
    "look at the bucket",
    "if something is already there, follow the chain",
    "attach the new entry",
  ];
  const empty = layoutHashBuckets(5, {});
  const first = layoutHashBuckets(5, { 2: ["MSU"] });
  const collision = layoutHashBuckets(5, { 2: ["MSU", "Bears"] });
  const activeFirst = {
    nodes: withNodeState(first.nodes, ["bucket-2", "entry-2-0"], "active"),
    edges: withEdgeState(first.edges, ["entry-2-0-edge"], "active"),
  };
  const activeCollision = {
    nodes: withNodeState(collision.nodes, ["bucket-2", "entry-2-0", "entry-2-1"], "comparing"),
    edges: withEdgeState(collision.edges, ["entry-2-0-edge", "entry-2-1-edge"], "active"),
  };
  const chained = {
    nodes: withNodeState(collision.nodes, ["entry-2-1"], "active"),
    edges: withEdgeState(collision.edges, ["entry-2-1-edge"], "active"),
  };

  return [
    step({
      concept: "hash-map",
      title: context.title || "Hash map collision",
      description: "A hash function chooses which bucket should hold a key.",
      nodes: withNodeState(empty.nodes, ["bucket-2"], "active"),
      edges: empty.edges,
      highlights: { nodeIds: ["bucket-2"], lineNumbers: [1] },
      code,
      activeLine: 1,
      state: { hash: "MSU -> bucket 2" },
    }, 1),
    step({
      concept: "hash-map",
      title: "Insert the first entry",
      description: "The bucket is empty, so the entry slides into the first spot in that bucket.",
      nodes: activeFirst.nodes,
      edges: activeFirst.edges,
      highlights: { nodeIds: ["bucket-2", "entry-2-0"], lineNumbers: [2] },
      code,
      activeLine: 2,
      state: { bucket: 2 },
    }, 2),
    step({
      concept: "hash-map",
      title: "Collision detected",
      description: "A new key maps to the same bucket. That does not break the map; it means we inspect the chain.",
      nodes: activeCollision.nodes,
      edges: activeCollision.edges,
      highlights: { nodeIds: ["bucket-2", "entry-2-0", "entry-2-1"], lineNumbers: [3] },
      code,
      activeLine: 3,
      state: { hash: "Bears -> bucket 2" },
    }, 3),
    step({
      concept: "hash-map",
      title: "Chain the new entry",
      description: "The new entry attaches after the existing one. Lookups in this bucket will walk the linked list.",
      nodes: chained.nodes,
      edges: chained.edges,
      highlights: { nodeIds: ["entry-2-1"], edgeIds: ["entry-2-1-edge"], lineNumbers: [4] },
      code,
      activeLine: 4,
      state: { chain: "MSU -> Bears" },
    }, 4),
  ];
}

export function generateGraphTraversalSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "put the start node in the queue",
    "take the next node from the queue",
    "mark it visited",
    "add unvisited neighbors",
    "repeat until the queue is empty",
  ];
  const graph = layoutCircularGraph(["A", "B", "C", "D", "E"], [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["D", "E"]]);
  const phases = [
    { title: context.title || "Graph BFS", description: "Start from A. The queue holds places to visit next.", visited: [], active: ["A"], queued: ["A"], activeEdges: [], line: 1 },
    { title: "Visit A", description: "A is visited first, then its neighbors B and C join the queue.", visited: ["A"], active: ["A"], queued: ["B", "C"], activeEdges: ["A-B", "A-C"], line: 3 },
    { title: "Visit B", description: "B comes out of the queue before C, so BFS spreads level by level.", visited: ["A", "B"], active: ["B"], queued: ["C", "D"], activeEdges: ["B-D"], line: 4 },
    { title: "Trace the path", description: "When E is reached, the highlighted path shows how the search got there.", visited: ["A", "B", "D", "E"], active: ["E"], queued: [], activeEdges: ["A-B", "B-D", "D-E"], line: 5 },
  ];
  return phases.map((phase, index) => {
    const visited = new Set(phase.visited);
    const active = new Set(phase.active);
    const queued = new Set(phase.queued);
    return step({
      concept: "graph",
      title: phase.title,
      description: phase.description,
      nodes: graph.nodes.map((node) => ({
        ...node,
        state: active.has(node.id) ? "active" : visited.has(node.id) ? "visited" : queued.has(node.id) ? "queued" : "default",
      })),
      edges: withEdgeState(graph.edges, phase.activeEdges, index === phases.length - 1 ? "path" : "active"),
      highlights: { nodeIds: [...phase.active, ...phase.visited], edgeIds: phase.activeEdges, lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      state: { queue: phase.queued.join(", ") || "empty", visited: phase.visited.join(", ") || "none" },
    }, index + 1);
  });
}

export function generateConditionalSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "look at the input",
    "ask the condition",
    "if yes, follow the yes branch",
    "if no, follow the no branch",
    "return the chosen result",
  ];
  const base = layoutConditional();
  const input = context.exampleInput || "age = 20";
  const output = context.exampleOutput || "true";
  const condition = context.constraints?.[0] || "Does the input match the rule?";
  const relabeled = base.nodes.map((node) => {
    if (node.id === "input") return { ...node, value: input };
    if (node.id === "condition") return { ...node, value: condition };
    if (node.id === "yes") return { ...node, value: `return ${output}` };
    if (node.id === "result") return { ...node, value: output };
    return node;
  });
  const phases = [
    { title: context.title || "Conditional branch", description: "Start with the input and one question from the prompt.", active: ["input"], edges: [], line: 1 },
    { title: "Ask the condition", description: "The condition is the fork. It decides which path stays alive.", active: ["condition"], edges: ["input-condition"], line: 2 },
    { title: "Follow one branch", description: "For this sample, the yes path stays bright and the other path fades back.", active: ["yes"], edges: ["condition-yes"], line: 3 },
    { title: "Return the result", description: "The function returns the value from the chosen branch only.", active: ["result"], edges: ["yes-result"], line: 5 },
  ];
  return phases.map((phase, index) => step({
    concept: "conditional",
    title: phase.title,
    description: phase.description,
    nodes: withNodeState(relabeled, phase.active, "active"),
    edges: withEdgeState(base.edges, phase.edges, "active"),
    highlights: { nodeIds: phase.active, edgeIds: phase.edges, lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    state: { rule: condition, result: output },
  }, index + 1));
}

function makeLinearNodes(values: Array<string | number>, active: string[], state: Node["state"], type: Node["type"] = "array-cell"): Node[] {
  return withNodeState(layoutArray(values, { type }), active, state);
}

export function generateStackSteps(context: GeneratorContext = {}): Step[] {
  const code = ["start with an empty stack", "push new item on top", "peek at the top", "pop from the top"];
  const makeNodes = (values: string[], active: string[] = []) => withNodeState(values.map((value, index) => ({
    id: `stack-${index}`,
    x: 450,
    y: 390 - index * 88,
    value,
    type: "array-cell" as const,
    label: index === values.length - 1 ? "top" : "",
    state: "default" as const,
  })), active, "active");
  return [
    step({ concept: "stack", title: context.title || "Stack", description: "A stack uses the newest item first.", nodes: makeNodes(["lab"]), edges: [], highlights: { nodeIds: ["stack-0"], lineNumbers: [1] }, code, activeLine: 1, state: { top: "lab" } }, 1),
    step({ concept: "stack", title: "Push", description: "A new item lands on top of the stack.", nodes: makeNodes(["lab", "quiz"], ["stack-1"]), edges: [], highlights: { nodeIds: ["stack-1"], lineNumbers: [2] }, code, activeLine: 2, state: { top: "quiz" } }, 2),
    step({ concept: "stack", title: "Peek", description: "Peek reads the top item without removing it.", nodes: makeNodes(["lab", "quiz"], ["stack-1"]), edges: [], highlights: { nodeIds: ["stack-1"], lineNumbers: [3] }, code, activeLine: 3, state: { peek: "quiz" } }, 3),
    step({ concept: "stack", title: "Pop", description: "Pop removes the newest item, revealing the previous top.", nodes: makeNodes(["lab"], ["stack-0"]), edges: [], highlights: { nodeIds: ["stack-0"], lineNumbers: [4] }, code, activeLine: 4, state: { removed: "quiz", top: "lab" } }, 4),
  ];
}

export function generateQueueSteps(context: GeneratorContext = {}): Step[] {
  const code = ["start with the line", "add arrivals to the back", "serve from the front", "keep the order"];
  const first = layoutArray(["Ana", "Bo"], { y: 260, type: "array-cell" });
  const joined = layoutArray(["Ana", "Bo", "Cy"], { y: 260, type: "array-cell" });
  const served = layoutArray(["Bo", "Cy"], { y: 260, type: "array-cell" });
  return [
    step({ concept: "queue", title: context.title || "Queue", description: "The front leaves first. New arrivals join the back.", nodes: withNodeState(first, ["item-0"], "active"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [1] }, code, activeLine: 1, state: { front: "Ana", back: "Bo" } }, 1),
    step({ concept: "queue", title: "Join at the back", description: "Cy slides in behind everyone already waiting.", nodes: withNodeState(joined, ["item-2"], "active"), edges: [], highlights: { nodeIds: ["item-2"], lineNumbers: [2] }, code, activeLine: 2, state: { front: "Ana", back: "Cy" } }, 2),
    step({ concept: "queue", title: "Serve the front", description: "Ana leaves first because Ana has waited the longest.", nodes: withNodeState(served, ["item-0"], "active"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [3] }, code, activeLine: 3, state: { served: "Ana", front: "Bo" } }, 3),
  ];
}

export function generateLinkedListSteps(context: GeneratorContext = {}): Step[] {
  const code = ["start at head", "read current value", "follow next link", "stop at null"];
  const nodes: Node[] = [
    { id: "a", x: 220, y: 260, value: "A", type: "linked-node" },
    { id: "b", x: 450, y: 260, value: "B", type: "linked-node" },
    { id: "c", x: 680, y: 260, value: "C", type: "linked-node" },
  ];
  const edges: Edge[] = [{ from: "a", to: "b", type: "pointer" }, { from: "b", to: "c", type: "pointer" }];
  return ["a", "b", "c"].map((id, index) => step({
    concept: "linked-list",
    title: index === 0 ? (context.title || "Linked list traversal") : `Move to ${id.toUpperCase()}`,
    description: "The current pointer follows one next link at a time. The chain stays connected.",
    nodes: withNodeState(nodes, [id], "active"),
    edges: withEdgeState(edges, index > 0 ? [`${["a", "b"][index - 1]}-${id}`] : [], "active"),
    highlights: { nodeIds: [id], lineNumbers: [Math.min(index + 1, 4)] },
    code,
    activeLine: Math.min(index + 1, 4),
    state: { current: id.toUpperCase() },
  }, index + 1));
}

export function generateBinarySearchSteps(context: GeneratorContext = {}): Step[] {
  const code = ["set left and right", "check the middle", "throw away the impossible half", "return found or not found"];
  const values = [10, 20, 30, 40, 50, 60, 70];
  const phases = [
    { left: 0, mid: 3, right: 6, desc: "Check the middle of the whole sorted list.", line: 2 },
    { left: 0, mid: 1, right: 2, desc: "The target is smaller, so the right half fades out.", line: 3 },
    { left: 2, mid: 2, right: 2, desc: "The remaining range points at the answer.", line: 4 },
  ];
  return phases.map((phase, index) => {
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex < phase.left || nodeIndex > phase.right ? "inactive" as const : nodeIndex === phase.mid ? "active" as const : "default" as const,
      label: nodeIndex === phase.left ? "left" : nodeIndex === phase.mid ? "mid" : nodeIndex === phase.right ? "right" : String(nodeIndex),
    }));
    return step({ concept: "binary-search", title: context.title || "Binary search", description: phase.desc, nodes, edges: [], highlights: { nodeIds: [`item-${phase.mid}`], lineNumbers: [phase.line] }, code, activeLine: phase.line, state: { left: phase.left, mid: phase.mid, right: phase.right } }, index + 1);
  });
}

export function generateTwoPointerSteps(context: GeneratorContext = {}): Step[] {
  const code = ["put one pointer on each side", "compare the pair", "move one pointer", "keep the best match"];
  const values = [1, 4, 7, 10];
  const phases = [{ left: 0, right: 3, sum: 11 }, { left: 1, right: 3, sum: 14 }, { left: 1, right: 2, sum: 11 }];
  return phases.map((phase, index) => {
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex === phase.left || nodeIndex === phase.right ? "comparing" as const : "default" as const,
      label: nodeIndex === phase.left ? "left" : nodeIndex === phase.right ? "right" : String(nodeIndex),
    }));
    return step({ concept: "two-pointers", title: context.title || "Two pointers", description: `Compare ${values[phase.left]} and ${values[phase.right]}; their combined value is ${phase.sum}.`, nodes, edges: [], highlights: { nodeIds: [`item-${phase.left}`, `item-${phase.right}`], lineNumbers: [index < 2 ? 2 : 4] }, code, activeLine: index < 2 ? 2 : 4, state: { left: phase.left, right: phase.right, combined: phase.sum } }, index + 1);
  });
}

export function generateSlidingWindowSteps(context: GeneratorContext = {}): Step[] {
  const code = ["start a window", "add the next value", "remove from the left if needed", "update the best answer"];
  const values = [20, 30, 10, 40];
  const phases = [{ window: [0, 1], total: 50 }, { window: [0, 2], total: 60 }, { window: [1, 3], total: 80 }, { window: [1, 2], total: 40 }];
  return phases.map((phase, index) => {
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex >= phase.window[0] && nodeIndex <= phase.window[1] ? "active" as const : "default" as const,
    }));
    return step({ concept: "sliding-window", title: context.title || "Sliding window", description: "The window changes by adding on the right and sometimes removing from the left.", nodes, edges: [], highlights: { nodeIds: nodes.filter((node) => node.state === "active").map((node) => node.id), lineNumbers: [Math.min(index + 1, 4)] }, code, activeLine: Math.min(index + 1, 4), state: { window: `${phase.window[0]}-${phase.window[1]}`, total: phase.total } }, index + 1);
  });
}

export function generateRecursionSteps(context: GeneratorContext = {}): Step[] {
  const code = ["check the base case", "make the input smaller", "wait for the smaller answer", "combine and return"];
  const values = ["call(3)", "call(2)", "call(1)", "base"];
  return values.map((value, index) => step({
    concept: "recursion",
    title: index === values.length - 1 ? "Base case" : (context.title || "Recursion"),
    description: index === values.length - 1 ? "The base case stops the calls." : "Each call makes the problem smaller before answers come back up.",
    nodes: withNodeState(layoutArray(values.slice(0, index + 1), { y: 260 }), [`item-${index}`], "active"),
    edges: [],
    highlights: { nodeIds: [`item-${index}`], lineNumbers: [Math.min(index + 1, 4)] },
    code,
    activeLine: Math.min(index + 1, 4),
    state: { depth: index + 1 },
  }, index + 1));
}

export function generateMatrixSteps(context: GeneratorContext = {}): Step[] {
  const code = ["choose a row", "choose a column", "read the cell", "update the running answer"];
  const values = [1, 2, 3, 4, 5, 6];
  const nodes = values.map((value, index) => ({ id: `cell-${index}`, x: 350 + (index % 3) * 96, y: 180 + Math.floor(index / 3) * 96, value, type: "array-cell" as const, label: `${Math.floor(index / 3)},${index % 3}` }));
  return [0, 1, 4, 5].map((activeIndex, index) => step({ concept: "matrix", title: context.title || "Matrix scan", description: "Track row and column so each grid cell is visited on purpose.", nodes: withNodeState(nodes, [`cell-${activeIndex}`], "active"), edges: [], highlights: { nodeIds: [`cell-${activeIndex}`], lineNumbers: [Math.min(index + 1, 4)] }, code, activeLine: Math.min(index + 1, 4), state: { row: Math.floor(activeIndex / 3), column: activeIndex % 3 } }, index + 1));
}

export function generatePrefixSumSteps(context: GeneratorContext = {}): Step[] {
  const code = ["start running total at zero", "add current value", "save the new total", "answer ranges by subtracting old totals"];
  const values = [2, 4, 1, 3];
  let total = 0;
  return values.map((value, index) => {
    total += value;
    return step({ concept: "prefix-sum", title: context.title || "Prefix sum", description: `Add ${value}; the saved total becomes ${total}. Later ranges reuse this saved work.`, nodes: withNodeState(layoutArray(values), [`item-${index}`], "active"), edges: [], highlights: { nodeIds: [`item-${index}`], lineNumbers: [index < 3 ? index + 1 : 4] }, code, activeLine: index < 3 ? index + 1 : 4, state: { running_total: total } }, index + 1);
  });
}

export function generateIntervalsSteps(context: GeneratorContext = {}): Step[] {
  const code = ["sort by start time", "compare next start to saved end", "merge if they overlap", "start a new interval if separate"];
  const nodes: Node[] = [
    { id: "a", x: 240, y: 220, value: "1-4", type: "array-cell" },
    { id: "b", x: 430, y: 220, value: "3-6", type: "array-cell" },
    { id: "c", x: 620, y: 220, value: "8-9", type: "array-cell" },
  ];
  return [
    step({ concept: "intervals", title: context.title || "Intervals", description: "Start with the first interval as the saved range.", nodes: withNodeState(nodes, ["a"], "active"), edges: [], highlights: { nodeIds: ["a"], lineNumbers: [1] }, code, activeLine: 1, state: { saved: "1-4" } }, 1),
    step({ concept: "intervals", title: "Overlap", description: "3 starts before 4 ends, so the first two intervals touch the same time span.", nodes: withNodeState(nodes, ["a", "b"], "comparing"), edges: [], highlights: { nodeIds: ["a", "b"], lineNumbers: [2] }, code, activeLine: 2, state: { compare: "3 <= 4" } }, 2),
    step({ concept: "intervals", title: "Merge", description: "The saved range grows to cover both overlapping intervals.", nodes: withNodeState([{ ...nodes[0], value: "1-6", x: 335 }, nodes[2]], ["a"], "active"), edges: [], highlights: { nodeIds: ["a"], lineNumbers: [3] }, code, activeLine: 3, state: { saved: "1-6" } }, 3),
  ];
}

export function generateHeapSteps(context: GeneratorContext = {}): Step[] {
  const code = ["add the new value", "compare with parent", "swap upward while priority is higher", "top holds the priority item"];
  const root = [40, 25, 30, 10, 20].reduce((tree, value) => insertTreeValue(tree, value), null as ReturnType<typeof insertTreeValue> | null);
  const before = layoutTree(root);
  const after = layoutTree([50, 40, 30, 10, 25, 20].reduce((tree, value) => insertTreeValue(tree, value), null as ReturnType<typeof insertTreeValue> | null));
  return [
    step({ concept: "heap", title: context.title || "Heap", description: "A heap keeps the priority item easy to reach at the top.", nodes: before.nodes, edges: before.edges, highlights: { lineNumbers: [1] }, code, activeLine: 1, state: { top: 40 } }, 1),
    step({ concept: "heap", title: "Bubble up", description: "A higher-priority value moves upward by swapping with parents.", nodes: withNodeState(after.nodes, ["tree-50"], "active"), edges: after.edges, highlights: { nodeIds: ["tree-50"], lineNumbers: [3] }, code, activeLine: 3, state: { top: 50 } }, 2),
  ];
}

export function generateTrieSteps(context: GeneratorContext = {}): Step[] {
  const code = ["start at root", "follow one character", "create missing character node", "mark end of word"];
  const nodes: Node[] = [
    { id: "root", x: 450, y: 90, value: "root", type: "tree-node" },
    { id: "c", x: 330, y: 210, value: "c", type: "tree-node" },
    { id: "ca", x: 280, y: 330, value: "a", type: "tree-node" },
    { id: "co", x: 420, y: 330, value: "o", type: "tree-node" },
  ];
  const edges: Edge[] = [{ from: "root", to: "c", type: "parent-child" }, { from: "c", to: "ca", type: "parent-child" }, { from: "c", to: "co", type: "parent-child" }];
  return ["root", "c", "co"].map((active, index) => step({ concept: "trie", title: context.title || "Trie prefix path", description: "A trie turns characters into a path, so shared prefixes reuse the same nodes.", nodes: withNodeState(nodes, [active], "active"), edges: withEdgeState(edges, index > 0 ? [`${index === 1 ? "root" : "c"}-${active}`] : [], "active"), highlights: { nodeIds: [active], lineNumbers: [index + 1] }, code, activeLine: index + 1, state: { character: active === "root" ? "start" : active.at(-1) || active } }, index + 1));
}

export function generateUnionFindSteps(context: GeneratorContext = {}): Step[] {
  const code = ["each item starts alone", "find each leader", "if leaders differ, connect groups", "count final leaders"];
  const start = layoutCircularGraph(["A", "B", "C", "D"], []);
  const connected = layoutCircularGraph(["A", "B", "C", "D"], [["A", "B"], ["C", "D"]]);
  const merged = layoutCircularGraph(["A", "B", "C", "D"], [["A", "B"], ["B", "C"], ["C", "D"]]);
  return [
    step({ concept: "union-find", title: context.title || "Union find", description: "Every item begins as its own group.", nodes: start.nodes, edges: start.edges, highlights: { lineNumbers: [1] }, code, activeLine: 1, state: { groups: 4 } }, 1),
    step({ concept: "union-find", title: "Connect pairs", description: "Union links two separate leaders into one group.", nodes: withNodeState(connected.nodes, ["A", "B"], "active"), edges: withEdgeState(connected.edges, ["A-B"], "active"), highlights: { nodeIds: ["A", "B"], edgeIds: ["A-B"], lineNumbers: [3] }, code, activeLine: 3, state: { groups: 2 } }, 2),
    step({ concept: "union-find", title: "Merge groups", description: "Connecting B and C joins two groups into a larger one.", nodes: withNodeState(merged.nodes, ["B", "C"], "active"), edges: withEdgeState(merged.edges, ["B-C"], "active"), highlights: { nodeIds: ["B", "C"], edgeIds: ["B-C"], lineNumbers: [4] }, code, activeLine: 4, state: { groups: 1 } }, 3),
  ];
}

export function generateDynamicProgrammingSteps(context: GeneratorContext = {}): Step[] {
  const code = ["define what one cell means", "fill base cases", "use earlier cells", "save the best/count for this cell"];
  const nodes = Array.from({ length: 9 }, (_, index) => ({ id: `dp-${index}`, x: 330 + (index % 3) * 92, y: 150 + Math.floor(index / 3) * 92, value: index < 3 ? 1 : "", type: "array-cell" as const, label: `dp${index}` }));
  return [0, 1, 3, 4, 8].map((active, index) => step({ concept: "dynamic-programming", title: context.title || "Dynamic programming", description: "Each cell stores a small answer that later cells can reuse.", nodes: withNodeState(nodes.map((node, nodeIndex) => ({ ...node, value: nodeIndex <= active ? (nodeIndex + 1) : "" })), [`dp-${active}`], "active"), edges: [], highlights: { nodeIds: [`dp-${active}`], lineNumbers: [Math.min(index + 1, 4)] }, code, activeLine: Math.min(index + 1, 4), state: { saved_cells: active + 1 } }, index + 1));
}

export function generateBitSteps(context: GeneratorContext = {}): Step[] {
  const code = ["write the number as bits", "look at one bit", "update the count or mask", "move to the next bit"];
  const bits = [1, 0, 1, 1];
  let count = 0;
  return bits.map((bit, index) => {
    if (bit) count += 1;
    return step({ concept: "bit-manipulation", title: context.title || "Bit manipulation", description: `Inspect bit ${bit}. A 1 changes the count or mask; a 0 usually does not.`, nodes: withNodeState(layoutArray(bits), [`item-${index}`], bit ? "active" : "comparing"), edges: [], highlights: { nodeIds: [`item-${index}`], lineNumbers: [Math.min(index + 1, 4)] }, code, activeLine: Math.min(index + 1, 4), state: { ones_seen: count } }, index + 1);
  });
}

export function generateMathSteps(context: GeneratorContext = {}): Step[] {
  const code = ["read the numbers", "apply the formula", "apply limits or rounding", "return the result"];
  const nodes = layoutArray(["base", "+ fee", "- discount", "total"], { gap: 140 }).map((node) => ({
    ...node,
    meta: { role: "formula-cell" },
  }));
  return nodes.map((node, index) => step({ concept: "math", title: context.title || "Arithmetic state", description: "Math problems are easiest when each piece of the formula changes one state value.", nodes: withNodeState(nodes, [node.id], "active"), edges: [], highlights: { nodeIds: [node.id], lineNumbers: [Math.min(index + 1, 4)] }, code, activeLine: Math.min(index + 1, 4), state: { step: node.value } }, index + 1));
}

export function generateStepsForConcept(concept: string, context: GeneratorContext = {}): Step[] {
  const authoredSteps = generateAuthoredVisualizerSteps(concept, context);
  if (authoredSteps) return authoredSteps;

  switch (concept) {
    case "hash-map":
      return generateHashMapCollisionSteps(context);
    case "binary-tree":
    case "tree":
      return generateTreeInsertSteps(context);
    case "graph":
      return generateGraphTraversalSteps(context);
    case "conditional":
    case "decision-flow":
      return generateConditionalSteps(context);
    case "stack":
      return generateStackSteps(context);
    case "queue":
      return generateQueueSteps(context);
    case "linked-list":
      return generateLinkedListSteps(context);
    case "binary-search":
      return generateBinarySearchSteps(context);
    case "two-pointers":
      return generateTwoPointerSteps(context);
    case "sliding-window":
      return generateSlidingWindowSteps(context);
    case "recursion":
      return generateRecursionSteps(context);
    case "matrix":
      return generateMatrixSteps(context);
    case "prefix-sum":
      return generatePrefixSumSteps(context);
    case "intervals":
      return generateIntervalsSteps(context);
    case "heap":
      return generateHeapSteps(context);
    case "trie":
      return generateTrieSteps(context);
    case "union-find":
      return generateUnionFindSteps(context);
    case "dynamic-programming":
      return generateDynamicProgrammingSteps(context);
    case "bit-manipulation":
      return generateBitSteps(context);
    case "math":
      return generateMathSteps(context);
    case "array":
    case "sort":
    case "search":
    default:
      return generateArraySwapSteps(context);
  }
}
