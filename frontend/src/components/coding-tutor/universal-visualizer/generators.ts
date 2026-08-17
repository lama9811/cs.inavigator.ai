import type { ConceptType, Edge, GeneratorContext, Node, Step, WorkflowStep } from "./types";
import { insertTreeValue, layoutArray, layoutCircularGraph, layoutHashBuckets, layoutTree } from "./layouts";

const WORKFLOW_LABELS: Record<ConceptType, string[]> = {
  array: ["Load", "Read item", "Compare/update", "Move", "Last item", "Check result", "Return"],
  tuple: ["Load lists", "Align index", "Read pair", "Build tuple", "Save", "Return"],
  set: ["Load items", "Check memory", "First keep", "Duplicate check", "Update set", "Return"],
  "linked-list": ["Head", "Read node", "Save next", "Move current", "Null check", "Return"],
  "hash-map": ["Choose key", "Hash bucket", "Check bucket", "Compare chain", "Insert/update", "Lookup result", "Return"],
  "binary-tree": ["Root", "Compare", "Follow", "Insert/visit", "Rebalance", "Check rule", "Finish"],
  graph: ["Start", "Visit", "Add neighbors", "Next node", "Skip repeat", "Trace path", "Finish"],
  search: ["Load", "Check item", "No match", "Move", "Match/stop", "Return"],
  sort: ["Load", "Compare pair", "Swap/move", "Next pair", "Repeat pass", "Return"],
  conditional: ["Input", "Question", "True path", "False path", "Chosen result", "Return"],
  stack: ["Read 3", "Push +", "Read 2", "Push *", "Read 2", "Apply *", "Apply +", "Return"],
  queue: ["Line starts", "Join back", "Front waits", "Serve front", "Next front", "Finish"],
  "two-pointers": ["Place pointers", "Compare pair", "Too small", "Move left", "Too large", "Final check", "Return"],
  "sliding-window": ["Start", "Grow", "Measure", "Update best", "Slide", "Repeat", "Stop", "Return"],
  "binary-search": ["Range", "Middle", "Compare", "Discard half", "New range", "New middle", "Final check", "Return"],
  recursion: ["Call", "Check base", "Smaller call", "Stack grows", "Base returns", "Unwind", "Combine", "Return"],
  math: ["Inputs", "First value", "Apply rule", "Adjust", "Check result", "Return"],
  matrix: ["Row start", "Column start", "Read cell", "Update", "Next cell", "Check bounds", "Return"],
  "prefix-sum": ["Start total", "Add value", "Save prefix", "Next value", "Finish prefix", "Read range", "Subtract", "Return"],
  intervals: ["Sort", "First range", "Compare next", "Merge", "Carry", "Separate", "Finish"],
  heap: ["Start heap", "Add item", "Compare parent", "Swap up", "Check again", "Top ready", "Finish"],
  trie: ["Root", "Read char", "Follow branch", "Create missing", "Word end", "Reuse prefix", "Lookup result"],
  "union-find": ["Own groups", "Find A", "Find B", "Union", "Find again", "Compress path", "Count"],
  "dynamic-programming": ["Goal", "Base case", "Read saved", "Build next", "Save cell", "Repeat", "Lookup", "Return"],
  "bit-manipulation": ["Write bits", "Inspect bit", "Update count", "Shift", "Inspect next", "Repeat", "Return"],
};

const CONCEPT_STEP_TARGETS: Partial<Record<ConceptType, number>> = {
  "dynamic-programming": 8,
  "binary-search": 8,
  "sliding-window": 8,
  "prefix-sum": 8,
  stack: 8,
  recursion: 8,
  "two-pointers": 7,
  "hash-map": 7,
  "linked-list": 7,
  matrix: 7,
  graph: 7,
  "binary-tree": 7,
  heap: 7,
  trie: 7,
  "union-find": 7,
  intervals: 7,
  "bit-manipulation": 7,
  array: 7,
  search: 7,
  sort: 7,
  math: 4,
};

function targetStepCount(concept: string): number {
  return CONCEPT_STEP_TARGETS[concept as ConceptType] || 6;
}

function workflowForConcept(concept: ConceptType, activeIndex: number): WorkflowStep[] {
  const labels = WORKFLOW_LABELS[concept] || WORKFLOW_LABELS.array;
  const boundedActive = Math.min(Math.max(activeIndex, 0), labels.length - 1);
  return labels.map((label, index) => ({
    id: `workflow-${index}`,
    label,
    state: index < boundedActive ? "visited" : index === boundedActive ? "active" : "default",
  }));
}

function isRotationProblem(context: GeneratorContext = {}): boolean {
  return /rotate/i.test(`${context.title || ""} ${context.prompt || ""} ${context.visualizer?.title || ""}`);
}

type VisualizerFamily =
  | "array-dedupe"
  | "array-dedupe-order"
  | "array-filter"
  | "array-comfort-count"
  | "array-every-other"
  | "array-find-index"
  | "array-merge-names"
  | "array-maximum-score"
  | "array-max-min"
  | "array-plant-care-days"
  | "array-rotate"
  | "array-running-total"
  | "array-search"
  | "array-smallest-positive"
  | "array-swap"
  | "array-sum-even"
  | "array-threshold-count"
  | "array-truthy-count"
  | "binary-search"
  | "bit-count"
  | "conditional-flow"
  | "dp-table"
  | "graph-traversal"
  | "graph-islands"
  | "hash-complement"
  | "hash-frequency"
  | "hash-grouping"
  | "hash-lookup"
  | "heap-priority"
  | "interval-merge"
  | "linked-list-traverse"
  | "math-count-digits"
  | "math-grade-points"
  | "math-last-digit"
  | "math-round-groups"
  | "matrix-traverse"
  | "prefix-range"
  | "queue-help-desk"
  | "queue-fifo"
  | "recursion-nested-list"
  | "recursion-stack"
  | "set-first-missing"
  | "set-membership"
  | "sliding-window"
  | "stack-brackets"
  | "stack-expression"
  | "stack-min"
  | "string-count-vowels"
  | "string-count-words"
  | "string-course-code"
  | "string-initials"
  | "string-normalize-emails"
  | "string-palindrome"
  | "string-prefix-search"
  | "string-reverse-words"
  | "string-run-compress"
  | "string-scan"
  | "trie-prefix"
  | "tuple-first-last"
  | "tuple-pair"
  | "tuple-score-at-index"
  | "tuple-swap"
  | "two-pointers"
  | "union-find";

function visualizerFamilyText(context: GeneratorContext = {}): string {
  return `${context.title || ""} ${context.topic || ""} ${context.prompt || ""} ${context.visualizer?.title || ""} ${context.visualizer?.caption || ""} ${context.visualizer?.concept || ""}`.toLowerCase();
}

export function detectVisualizerFamily(concept: string, context: GeneratorContext = {}): VisualizerFamily {
  const text = visualizerFamilyText(context);
  if (concept === "conditional" || concept === "decision-flow" || /\bconditionals?\b|if\/else|if else/.test(text)) return "conditional-flow";
  if (/maximum score/.test(text)) return "array-maximum-score";
  if (/sum even numbers/.test(text)) return "array-sum-even";
  if (/remove duplicates keep order/.test(text)) return "array-dedupe-order";
  if (/\bsmallest positive\b/.test(text) && !/missing/.test(text)) return "array-smallest-positive";
  if (/\brunning total\b/.test(text)) return "array-running-total";
  if (/\bfind index\b/.test(text)) return "array-find-index";
  if (/\bmerge names\b/.test(text)) return "array-merge-names";
  if (/temperature above threshold/.test(text)) return "array-threshold-count";
  if (/truthy attendance/.test(text)) return "array-truthy-count";
  if (/every other item/.test(text)) return "array-every-other";
  if (/temperature comfort count/.test(text)) return "array-comfort-count";
  if (/weekly plant care days/.test(text)) return "array-plant-care-days";
  if (/first missing positive|missing positive/.test(text)) return "set-first-missing";
  if (/count vowels?/.test(text)) return "string-count-vowels";
  if (/reverse words?/.test(text)) return "string-reverse-words";
  if (/count words?/.test(text)) return "string-count-words";
  if (/valid course code shape|course code/.test(text)) return "string-course-code";
  if (/\binitials?\b/.test(text)) return "string-initials";
  if (/compress runs|run length|repeated adjacent|character plus count/.test(text)) return "string-run-compress";
  if (/normalize email list|normalize emails?|email list/.test(text)) return "string-normalize-emails";
  if (/prefix search|starts with|matching prefix/.test(text)) return "string-prefix-search";
  if (/count islands|island|land.*water|water.*land/.test(text)) return "graph-islands";
  if (/last digit/.test(text)) return "math-last-digit";
  if (/count digits/.test(text)) return "math-count-digits";
  if (/grade points needed/.test(text)) return "math-grade-points";
  if (/round up lab groups/.test(text)) return "math-round-groups";
  if (/pair names with scores/.test(text)) return "tuple-pair";
  if (/student score pair/.test(text)) return "tuple-score-at-index";
  if (/first last pair/.test(text)) return "tuple-first-last";
  if (concept === "tuple") return isTupleSwapVisualizer(context) ? "tuple-swap" : "tuple-pair";
  if (concept === "set") return "set-membership";
  if (concept === "queue") return /help desk|ticket|support|serve|join/.test(text) ? "queue-help-desk" : "queue-fifo";
  if (concept === "linked-list") return "linked-list-traverse";
  if (concept === "binary-search") return "binary-search";
  if (concept === "two-pointers") return "two-pointers";
  if (concept === "sliding-window") return "sliding-window";
  if (concept === "recursion") return /nested|depth|flatten|list.*sum|sum.*list/.test(text) ? "recursion-nested-list" : "recursion-stack";
  if (concept === "matrix") return "matrix-traverse";
  if (concept === "prefix-sum") return "prefix-range";
  if (concept === "intervals") return "interval-merge";
  if (concept === "heap") return "heap-priority";
  if (concept === "trie") return "trie-prefix";
  if (concept === "union-find") return "union-find";
  if (concept === "dynamic-programming") return "dp-table";
  if (concept === "bit-manipulation") return "bit-count";
  if (concept === "binary-tree" || concept === "graph") return "graph-traversal";
  if (concept === "stack") {
    if (/bracket|parenth|valid|balanced/.test(text)) return "stack-brackets";
    if (/min stack|minimum stack|getmin|track.*min|stack.*minimum/.test(text)) return "stack-min";
    return "stack-expression";
  }
  if (concept === "hash-map") {
    if (/two sum|complement|pair.*target|target.*pair/.test(text)) return "hash-complement";
    if (/group|anagram|bucket by|categor/i.test(text)) return "hash-grouping";
    if (/count|frequency|frequent|favorite|most common|occurrence/.test(text)) return "hash-frequency";
    return "hash-lookup";
  }
  if (/palindrome/.test(text)) return "string-palindrome";
  if (/string|word|text|vowel|character|letter/.test(text)) return "string-scan";
  if (isRotationProblem(context)) return "array-rotate";
  if (/duplicate|unique|repeat/.test(text)) return "array-dedupe";
  if (/running total|prefix|cumulative/.test(text)) return "array-running-total";
  if (/find|index|search|smallest positive|missing/.test(text)) return "array-search";
  if (/maximum|minimum|max|min|largest|smallest|best/.test(text)) return "array-max-min";
  if (/even|odd|filter|above|below|comfortable|count/.test(text)) return "array-filter";
  return "array-swap";
}

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
  const workflow = partial.workflow || workflowForConcept(partial.concept, index - 1);
  const activeWorkflowId = partial.activeWorkflowId || workflow.find((item) => item.state === "active")?.id || workflow[0]?.id;
  const rawCode = partial.code || [];
  const code = expandPseudocodeLines(rawCode, partial.concept);
  const activeLine = rawCode.length < index ? Math.min(index, code.length) : partial.activeLine;
  const highlights = rawCode.length < index
    ? { ...(partial.highlights || {}), lineNumbers: [activeLine || index] }
    : partial.highlights;
  return { ...partial, code, activeLine, highlights, id: `${partial.concept}-${index}`, workflow, activeWorkflowId };
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
    "example",
    "sample",
    "text",
    "input",
    "prompt_rule",
    "goal",
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

function shortText(value: unknown, fallback = "the example"): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function rawVisualInput(context: GeneratorContext, state: Record<string, unknown> = {}): string {
  return String(context.exampleInput || state.example || state.text || state.input || state.sample || "").trim();
}

function visualSearchText(context: GeneratorContext): string {
  return `${context.title || ""} ${context.topic || ""} ${context.prompt || ""} ${context.visualizer?.concept || ""}`.toLowerCase();
}

function teachingSampleOverride(context: GeneratorContext, concept: string, state: Record<string, unknown> = {}): string {
  const title = visualSearchText(context);
  const family = detectVisualizerFamily(concept, context);
  const raw = rawVisualInput(context, state);
  const hasLongList = parseFirstList(raw).length > 6 || Object.values(parseAllNamedLists(raw)).some((items) => items.length > 6);
  const hasLongText = raw.length > 14 && !raw.includes("=") && !parseFirstList(raw).length;

  if (family === "array-maximum-score") return "scores=[72, 88, 91, 84]";
  if (family === "array-sum-even") return "values=[1, 2, 3, 4]";
  if (family === "array-dedupe-order") return "values=[3, 1, 3, 2]";
  if (family === "array-smallest-positive") return "values=[-2, 4, 0, 3]";
  if (family === "array-running-total") return "values=[2, 4, 1]";
  if (family === "array-find-index") return "values=[5, 7, 9], target=7";
  if (family === "array-merge-names") return "first=[Ada], second=[Grace, Katherine]";
  if (family === "array-threshold-count") return "readings=[70, 82, 81], threshold=80";
  if (family === "array-truthy-count") return "present=[true, false, true]";
  if (family === "array-every-other") return "values=[10, 20, 30, 40, 50]";
  if (family === "array-comfort-count") return "readings=[68, 72, 80], low=70, high=78";
  if (family === "array-plant-care-days") return "readings=[20, 55, 30], days=[Mon, Tue, Wed], threshold=35";
  if (family === "array-rotate") return "values=[1, 2, 3, 4], k=2";
  if (family === "array-dedupe") return "values=[3, 1, 3, 2]";
  if (family === "array-filter") return "values=[3, 8, 2, 6]";
  if (family === "array-search") return "values=[8, 3, 6], target=6";
  if (family === "array-max-min") return "values=[4, 9, 2]";
  if (family === "set-first-missing") return "values=[1, 2, 0]";
  if (family === "graph-islands") return "grid=[[1,1,0],[0,0,1],[1,0,1]]";
  if (family === "hash-frequency" || family === "hash-grouping") return "items=[A, B, A]";
  if (family === "hash-complement") return "nums=[2, 7], target=9";
  if (family === "string-count-vowels") return "Code";
  if (family === "string-reverse-words") return "red blue";
  if (family === "string-count-words") return "red blue";
  if (family === "string-course-code") return "COSC 352";
  if (family === "string-initials") return "Ada Lovelace";
  if (family === "string-run-compress") return "aaabbc";
  if (family === "string-normalize-emails") return "emails=[Ada@MSU.edu, ada@msu.edu, Bo@MSU.edu]";
  if (family === "string-prefix-search") return "words=[code, card, car], prefix=ca";
  if (family === "string-palindrome") return "level";
  if (family === "stack-min") return "commands=[push 3, push 1, push 2, min, pop, min]";
  if (family === "recursion-nested-list") return "value=[1,[2,[3]]]";
  if (family === "queue-help-desk") return "commands=[join Ana, join Bo, serve, serve, serve]";

  if (title.includes("vowel")) return "Code";
  if (title.includes("palindrome")) return "level";
  if (title.includes("reverse words")) return "red blue";
  if (title.includes("reverse only letters")) return "a-bC-d";
  if (title.includes("first repeated")) return "cocoa";
  if (title.includes("edit distance")) return "cat -> cut";

  switch (concept) {
    case "stack":
      return "expression=3+2*2";
    case "queue":
      return "commands=[join Ana, join Bo, join Cy, serve Ana]";
    case "hash-map":
      if (/two sum|complement/.test(title)) return "nums=[2, 7], target=9";
      if (/count|frequency|anagram/.test(title)) return "items=[A, B, A]";
      return "keys=[Ana, Bo], values=[90, 82], lookup=Ana";
    case "binary-search":
      return "values=[1, 3, 5], target=3";
    case "two-pointers":
      return "values=[1, 4, 6], target=7";
    case "sliding-window":
      return "values=[2, 4, 1], k=2";
    case "recursion":
      return "n=3";
    case "binary-tree":
      return "values=[4, 2, 6]";
    case "graph":
      return "edges=[A-B, A-C, B-D], start=A";
    case "matrix":
      return "grid=[[1,2],[3,4]]";
    case "prefix-sum":
      return "values=[2, 4, 1]";
    case "intervals":
      return "intervals=[[1,3],[2,5]]";
    case "heap":
      return "values=[30, 40, 50]";
    case "trie":
      return "words=[cat, car]";
    case "union-find":
      return "pairs=[A-B, B-C]";
    case "dynamic-programming":
      return "n=4";
    case "bit-manipulation":
      return "bits=1011";
    default:
      break;
  }

  if ((concept === "array" || concept === "set" || concept === "tuple" || concept === "search" || concept === "sort") && hasLongList) {
    return "values=[3, 1, 3, 2]";
  }
  if (hasLongText) return raw.replace(/\s+/g, "").slice(0, 6);
  return "";
}

function compactVisualInput(context: GeneratorContext, concept: string, state: Record<string, unknown> = {}): string {
  const override = teachingSampleOverride(context, concept, state);
  if (override) return override;
  const raw = rawVisualInput(context, state);
  if (!raw) return raw;
  const title = visualSearchText(context);
  const namedLists = parseAllNamedLists(raw);
  if (Object.keys(namedLists).length) {
    const compacted = raw.replace(/\[([^\]]*)\]/g, (match) => {
      const values = match.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
      return values.length > 6 ? `[${values.slice(0, 6).join(", ")}]` : match;
    });
    return compacted;
  }
  const firstList = parseFirstList(raw);
  if (firstList.length > 6) return `[${firstList.slice(0, 6).join(", ")}]`;
  if (firstList.length) return raw;
  if (title.includes("edit distance")) return "cat -> cut";
  if (title.includes("reverse only letters") && raw.length > 8 && !raw.includes("=")) return "a-bC-d";
  const visualConcept = String(context.visualizer?.concept || "").toLowerCase();
  const stringLike = concept === "array" || visualConcept.includes("string-scan") || title.includes("first repeated");
  if (stringLike && raw.length > 6 && !raw.includes("=")) {
    if (title.includes("vowel")) return "Code";
    if (title.includes("palindrome")) return "level";
    if (title.includes("repeat")) return "cocoa";
    if (title.includes("word") || title.includes("sentence")) return "red blue";
    return raw.replace(/\s+/g, "").slice(0, 6);
  }
  return raw;
}

function valuesFromVisualSample(sample: string): Array<string | number> {
  const namedLists = parseAllNamedLists(sample);
  const firstNamed = Object.values(namedLists)[0];
  if (firstNamed?.length) return firstNamed;
  const firstList = parseFirstList(sample);
  if (firstList.length) return firstList;
  if (sample && !sample.includes("=")) return [...sample].map((char) => char === " " ? "space" : char);
  return [];
}

function indexableTeachingValues(concept: string, sample: string): Array<string | number> {
  if (concept === "stack" || concept === "queue") {
    if (concept === "stack" && /expression\s*=\s*3\s*\+\s*2\s*\*\s*2/i.test(sample)) return [3, "+", 2, "*", 2];
    const commands = parseFirstList(sample).map(String);
    const values = commands
      .map((command) => command.match(/^(?:push|join)\s+(.+)$/i)?.[1])
      .filter(Boolean) as string[];
    if (values.length) return values;
  }
  return valuesFromVisualSample(sample);
}

function visualSampleExpected(context: GeneratorContext, concept: string, state: Record<string, unknown> = {}): string {
  const sample = compactVisualInput(context, concept, state);
  const raw = rawVisualInput(context, state);
  const title = `${context.title || ""} ${context.topic || ""} ${context.prompt || ""}`.toLowerCase();
  const family = detectVisualizerFamily(concept, context);
  const override = teachingSampleOverride(context, concept, state);
  if (override) {
    if (family === "array-maximum-score") return "91";
    if (family === "array-sum-even") return "6";
    if (family === "array-dedupe-order") return "[3, 1, 2]";
    if (family === "array-smallest-positive") return "3";
    if (family === "array-find-index") return "1";
    if (family === "array-merge-names") return "[Ada, Grace, Katherine]";
    if (family === "array-threshold-count") return "2";
    if (family === "array-truthy-count") return "2";
    if (family === "array-every-other") return "[10, 30, 50]";
    if (family === "array-comfort-count") return "1";
    if (family === "array-plant-care-days") return "[Mon, Wed]";
    if (family === "array-rotate") return "[3, 4, 1, 2]";
    if (family === "array-dedupe") return "[3, 1, 2]";
    if (family === "array-filter") return "8 and 6 pass";
    if (family === "array-running-total") return "[2, 6, 7]";
    if (family === "array-search") return "index 2";
    if (family === "array-max-min") return "9";
    if (family === "set-first-missing") return "3";
    if (family === "graph-islands") return "3";
    if (family === "hash-frequency") return "A appears twice";
    if (family === "hash-grouping") return "A group has 2";
    if (family === "hash-complement") return "indexes 0 and 1";
    if (family === "string-count-vowels") return "2";
    if (family === "string-reverse-words") return "blue red";
    if (family === "string-count-words") return "2";
    if (family === "string-course-code") return "true";
    if (family === "string-initials") return "AL";
    if (family === "string-run-compress") return "a3b2c1";
    if (family === "string-normalize-emails") return "[ada@msu.edu, bo@msu.edu]";
    if (family === "string-prefix-search") return "[card, car]";
    if (family === "string-palindrome") return "true";
    if (family === "stack-min") return "1";
    if (family === "recursion-nested-list") return "14";
    if (family === "queue-help-desk") return "[Ana, Bo, none]";
    if (concept === "stack") return "7";
    if (concept === "queue") return "served Ana";
    if (concept === "hash-map") {
      if (/two sum|complement/.test(title)) return "indexes 0 and 1";
      if (/count|frequency|anagram/.test(title)) return "A appears twice";
      return "Ana -> 90";
    }
    if (concept === "binary-search") return "index 1";
    if (concept === "two-pointers") return "1 + 6 = 7";
    if (concept === "sliding-window") return "best 6";
    if (concept === "recursion") return "3 calls then unwind";
    if (concept === "binary-tree") return "visit 4, 2, 6";
    if (concept === "graph") return "A, B, C, D";
    if (concept === "matrix") return "4 cells checked";
    if (concept === "prefix-sum") return "[2, 6, 7]";
    if (concept === "intervals") return "[1, 5]";
    if (concept === "heap") return "top 50";
    if (concept === "trie") return "ca prefix";
    if (concept === "union-find") return "one group";
    if (concept === "dynamic-programming") return "dp[4]";
    if (concept === "bit-manipulation") return "three 1 bits";
  }
  if (sample && sample !== raw) {
    const values = valuesFromVisualSample(sample);
    if (title.includes("vowel")) {
      return String([...sample.toLowerCase()].filter((char) => "aeiou".includes(char)).length);
    }
    if (title.includes("reverse words")) return sample.trim().split(/\s+/).reverse().join(" ");
    if (title.includes("reverse only letters")) return "d-Cb-a";
    if (title.includes("initials")) return sample.trim().split(/\s+/).map((word) => word[0]?.toUpperCase() || "").join("");
    if (title.includes("edit distance")) return "1";
    if (title.includes("palindrome")) return "true";
    if (/maximum|max|largest/.test(title) && values.every((value) => typeof value === "number")) {
      return String(Math.max(...(values as number[])));
    }
    if (/sum even/.test(title) && values.every((value) => typeof value === "number")) {
      return String((values as number[]).filter((value) => value % 2 === 0).reduce((sum, value) => sum + value, 0));
    }
    if (/count words/.test(title)) return String(sample.trim().split(/\s+/).filter(Boolean).length);
    if (/first repeated/.test(title)) {
      const seen = new Set<string>();
      const repeated = [...sample].find((char) => seen.has(char) || !seen.add(char));
      if (repeated) return repeated;
    }
  }
  return expectedText(context, state);
}

function normalizeVisualState(
  concept: string,
  context: GeneratorContext,
  state: Record<string, unknown> = {},
): Record<string, unknown> {
  const sample = compactVisualInput(context, concept, state);
  const normalized = { ...state };
  if (sample) {
    normalized.example = sample;
    normalized.sample = sample;
    if (typeof state.text === "string") normalized.text = sample;
    if (typeof state.input === "string") normalized.input = sample;
    if (concept === "stack") normalized.stack = indexableTeachingValues(concept, sample).slice(0, 5);
    if (concept === "queue") normalized.queue = indexableTeachingValues(concept, sample).slice(0, 3);
    if (concept === "hash-map") normalized.lookup = sample.includes("lookup=Ana") ? "Ana" : normalized.lookup;

    const title = visualSearchText(context);
    const shouldReplaceItems = concept === "array" || /string|word|character|letter|vowel|palindrome|sentence/.test(title);
    const sampleValues = valuesFromVisualSample(sample);
    if (shouldReplaceItems && sampleValues.length) {
      normalized.items = sampleValues.slice(0, 8);
      normalized.values = sampleValues.slice(0, 8);
      const active = Array.isArray(normalized.active) ? normalized.active : [0];
      normalized.active = active.map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < sampleValues.length);
      if (!Array.isArray(normalized.active) || !normalized.active.length) normalized.active = [0];
    }
  }
  return normalized;
}

function sanitizeAuthoredCopy(text: string, context: GeneratorContext, concept: string, state: Record<string, unknown> = {}): string {
  const sample = compactVisualInput(context, concept, state);
  const rawValues = [
    rawVisualInput(context, state),
    state.sample,
    state.text,
    state.input,
    context.exampleInput,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  let cleaned = text;
  rawValues.forEach((raw) => {
    if (sample && raw && raw !== sample) cleaned = cleaned.split(raw).join(sample);
  });
  const raw = rawVisualInput(context, state);
  const compactExpected = visualSampleExpected(context, concept, state);
  if (sample && sample !== raw && context.exampleOutput && compactExpected && compactExpected !== context.exampleOutput) {
    cleaned = cleaned.split(context.exampleOutput).join(compactExpected);
  }
  cleaned = cleaned
    .replace(/authored example input/gi, "teaching sample")
    .replace(/public example input/gi, "teaching sample")
    .replace(/public example result/gi, "teaching sample result");
  return cleaned;
}

function exampleText(context: GeneratorContext, state: Record<string, unknown> = {}): string {
  return shortText(compactVisualInput(context, "array", state) || state.sample, "the example");
}

function expectedText(context: GeneratorContext, state: Record<string, unknown> = {}): string {
  const goal = String(state.goal || "").replace(/^return shape:\s*/i, "").trim();
  return shortText(context.exampleOutput || goal, "the requested result");
}

function promptRuleText(context: GeneratorContext, state: Record<string, unknown> = {}): string {
  return shortText(state.prompt_rule || context.constraints?.[0] || context.prompt, "condition");
}

function visualPseudocodeForStep(
  concept: string,
  context: GeneratorContext,
  state: Record<string, unknown> = {},
): string[] {
  const sample = shortText(compactVisualInput(context, concept, state) || state.sample, "the example");
  const expected = visualSampleExpected(context, concept, state);
  const rule = promptRuleText(context, state);
  const sharedFinish = `return ${expected}`;
  const topic = `${concept} ${context.topic || ""}`.toLowerCase();

  if (concept === "conditional") {
    return [
      `read ${sample}`,
      `ask whether ${rule}`,
      "follow the true branch when the answer is yes",
      "follow the false branch when the answer is no",
      sharedFinish,
    ];
  }
  if (concept === "stack") {
    return [
      `read ${sample}`,
      "put numbers on the value stack",
      "put operators on the operator stack",
      "apply an operator when it is ready",
      "put the computed value back on the stack",
      sharedFinish,
    ];
  }
  if (concept === "queue") {
    return [
      `read ${sample}`,
      "add new arrivals to the back",
      "serve the item at the front",
      "keep the remaining order the same",
      sharedFinish,
    ];
  }
  if (concept === "linked-list") {
    return [
      "start at the head node",
      "read the current node value",
      "save the next link",
      "move current to the next node",
      "stop when there is no next node",
      sharedFinish,
    ];
  }
  if (concept === "hash-map") {
    return [
      `read ${sample}`,
      "build the lookup key",
      "check whether the key is already stored",
      "store or update the value for that key",
      sharedFinish,
    ];
  }
  if (concept === "set" || topic.includes("set")) {
    return [
      `read ${sample}`,
      "check each item",
      "if the item is new, keep it",
      "add the item to set memory",
      sharedFinish,
    ];
  }
  if (concept === "tuple" || topic.includes("tuple")) {
    return [
      `read ${sample}`,
      "line up matching indexes",
      "combine the related values into one pair",
      "save the pair in the result",
      sharedFinish,
    ];
  }
  if (concept === "binary-search") {
    return [
      "start with the full sorted range",
      "check the middle value",
      "discard the half that cannot contain the target",
      "repeat with the smaller range",
      sharedFinish,
    ];
  }
  if (concept === "two-pointers") {
    return [
      "place one pointer on each side",
      "compare the two pointed values",
      "move the left pointer when the pair is too small",
      "move the right pointer when the pair is too large",
      sharedFinish,
    ];
  }
  if (concept === "sliding-window") {
    return [
      "start with an empty window",
      "add the entering value",
      "remove the leaving value when the window slides",
      "save the best window seen so far",
      sharedFinish,
    ];
  }
  if (concept === "recursion") {
    return [
      "check whether this call can answer directly",
      "make a smaller recursive call",
      "wait for the smaller answer",
      "combine this call with the returned answer",
      "return the combined answer",
    ];
  }
  if (concept === "binary-tree") {
    return [
      "start at the root node",
      "read the current node value",
      "follow the left branch when needed",
      "follow the right branch when needed",
      sharedFinish,
    ];
  }
  if (concept === "graph") {
    return [
      "start with the first node in the frontier",
      "visit the next node",
      "mark it as visited",
      "add unvisited neighbors to the frontier",
      sharedFinish,
    ];
  }
  if (concept === "heap") {
    return [
      "add the new item at the bottom",
      "compare it with its parent",
      "swap upward if it outranks the parent",
      "stop when the heap rule is restored",
      sharedFinish,
    ];
  }
  if (concept === "trie") {
    return [
      "start at the root",
      "read the next character",
      "follow or create that character branch",
      "mark the last node as a word ending",
    ];
  }
  if (concept === "union-find") {
    return [
      "start with each item in its own group",
      "find the leader for the first item",
      "find the leader for the second item",
      "connect the groups when the leaders differ",
      sharedFinish,
    ];
  }
  if (concept === "dynamic-programming") {
    return [
      "save the base answer",
      "move to the next state",
      "reuse smaller saved answers",
      "save the best answer for this state",
      sharedFinish,
    ];
  }
  if (concept === "matrix") {
    return [
      "choose the current row",
      "choose the current column",
      "read the cell at that position",
      "update the answer with that cell",
      sharedFinish,
    ];
  }
  if (concept === "prefix-sum") {
    return [
      "start the running total at zero",
      "add the current value",
      "save the prefix total at this index",
      "subtract saved totals to answer the range",
      sharedFinish,
    ];
  }
  if (concept === "intervals") {
    return [
      "sort ranges by start time",
      "keep the first range as current",
      "compare the next range with current",
      "merge overlapping ranges",
      sharedFinish,
    ];
  }
  if (concept === "bit-manipulation") {
    return [
      "write the number as bits",
      "inspect the current bit",
      "update the count when the bit is one",
      "shift to the next bit",
      sharedFinish,
    ];
  }
  if (concept === "math") {
    return [
      `read ${sample}`,
      "apply the formula step by step",
      `adjust only if ${rule}`,
      sharedFinish,
    ];
  }
  return [
    `read ${sample}`,
    `use the rule: ${rule}`,
    "read the current item",
    "update the answer if this item changes it",
    sharedFinish,
  ];
}

function expandPseudocodeLines(lines: string[], concept: string): string[] {
  const target = targetStepCount(concept);
  if (lines.length >= target) return lines;
  const additions: Record<string, string[]> = {
    conditional: ["choose the branch that matched", "return the chosen value"],
    stack: ["read the next token", "update the stack", "apply the ready operation", "put the result back", "return the top value"],
    queue: ["read the front item", "keep the remaining order", "return the served item"],
    "hash-map": ["choose the bucket for this key", "compare the stored key", "move to the next stored entry", "store the updated value", "return the lookup result"],
    set: ["add the item to set memory", "return the kept values"],
    tuple: ["move to the next index", "return the saved pairs"],
    "linked-list": ["save the next link", "use the current value", "move to the saved next node", "stop when current is empty", "return the result"],
    recursion: ["add the smaller call to the stack", "return the base value", "combine the current call with the smaller answer", "return the combined answer"],
    "binary-search": ["keep the possible range", "check the new middle", "return the found index"],
    "two-pointers": ["add the pointed values", "move the correct pointer", "compare the new pair", "save the match or best value", "return the result"],
    "sliding-window": ["save the best window so far", "move the left edge", "return the best value"],
    "binary-tree": ["update the result with this node", "check the tree rule", "return the result"],
    graph: ["add unvisited neighbors to the frontier", "skip nodes already visited", "return the visited result"],
    matrix: ["read the current cell", "update the answer with that value", "move to the next cell", "check the grid bounds", "return the result"],
    "prefix-sum": ["save this prefix total", "subtract saved totals for the range", "return the range sum"],
    intervals: ["save the merged range", "move to the next interval", "return the merged ranges"],
    heap: ["move the value upward if needed", "check the parent rule", "return the top value"],
    trie: ["follow the character branch", "reuse the shared prefix", "return whether the word was found"],
    "union-find": ["connect one leader under the other", "find the compressed leader", "return the group count"],
    "dynamic-programming": ["read a smaller saved answer", "combine saved answers into a candidate", "save the answer for this state", "return the target answer"],
    "bit-manipulation": ["shift to the next bit", "inspect the next bit", "return the result"],
    math: ["check whether an adjustment is needed", "return the computed value"],
    array: ["update the answer with the current item", "return the answer"],
  };
  const expanded = [...lines];
  const fallback = additions[concept] || additions.array;
  let additionIndex = 0;
  while (expanded.length < target) {
    expanded.push(fallback[additionIndex % fallback.length] || "index += 1");
    additionIndex += 1;
  }
  return expanded;
}

function workflowFromLabels(labels: string[], activeIndex: number): WorkflowStep[] {
  const safeLabels = labels.length ? labels : ["Start", "Trace", "Check", "Finish"];
  const boundedActive = Math.min(Math.max(activeIndex, 0), safeLabels.length - 1);
  return safeLabels.map((label, index) => ({
    id: `workflow-${index}`,
    label: shortText(label, "Step"),
    state: index < boundedActive ? "visited" : index === boundedActive ? "active" : "default",
  }));
}

function authoredWorkflowLabels(rawSteps: Array<Record<string, unknown>>, concept: string): string[] {
  const fallback = WORKFLOW_LABELS[concept as ConceptType] || WORKFLOW_LABELS.array;
  const genericActions = new Set(["setup", "trace", "predict", "finish"]);
  const used = new Map<string, number>();
  return rawSteps.map((raw, index) => {
    const action = shortText(raw.action, "");
    let label = "";
    if (action && !genericActions.has(action.toLowerCase())) label = action.replace(/[-_]/g, " ");
    const title = shortText(raw.title, "");
    if (!label && title && !/set the sample|load the example|make one|predict|connect the visual|keep the answer/i.test(title)) label = title;
    const normalized = label.toLowerCase();
    const repeats = used.get(normalized) || 0;
    if (!label || repeats > 0) label = fallback[Math.min(index, fallback.length - 1)] || `Step ${index + 1}`;
    used.set(label.toLowerCase(), (used.get(label.toLowerCase()) || 0) + 1);
    return label;
  });
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
  const compactInput = compactVisualInput(context, concept, state);
  if (/count\s+words|word/i.test(`${context.title || ""} ${context.prompt || ""}`) && compactInput && !compactInput.includes("=")) {
    const words = compactInput.trim().split(/\s+/).filter(Boolean);
    if (words.length) return words.slice(0, 10);
  }

  const compactValues = valuesFromVisualSample(compactInput);
  const raw = rawVisualInput(context, state);
  if (compactValues.length && compactInput && compactInput !== raw) return compactValues.slice(0, 12);

  const authoredItems = Array.isArray(state.items) ? state.items : Array.isArray(state.values) ? state.values : [];
  if (authoredItems.length) return authoredItems.slice(0, 12).map((value) => value as string | number);

  if (compactValues.length) return compactValues.slice(0, 12);

  if (concept === "array" && compactInput && !compactInput.includes("=")) {
    return [...compactInput].slice(0, 12).map((char) => char === " " ? "space" : char);
  }

  return [2, 1, 5, 1, 3];
}

function activeIndexes(state: Record<string, unknown>, max: number, fallback: number): number[] {
  const active = Array.isArray(state.active) ? state.active : [];
  const indexes = active
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0 && value < max);
  return indexes.length ? indexes : [Math.min(Math.max(fallback, 0), Math.max(max - 1, 0))];
}

function linearNodes(
  values: Array<string | number>,
  active: number[] = [],
  options: { y?: number; startX?: number; maxWidth?: number; role?: string; type?: Node["type"]; labels?: string[] } = {},
): Node[] {
  const count = Math.max(values.length, 1);
  const maxWidth = options.maxWidth ?? 640;
  const gap = count <= 1 ? 0 : Math.min(98, Math.max(58, maxWidth / (count - 1)));
  const startX = options.startX ?? 450 - ((count - 1) * gap) / 2;
  const activeSet = new Set(active);
  return values.map((value, index) => ({
    id: `item-${index}`,
    x: startX + index * gap,
    y: options.y ?? 260,
    value,
    type: options.type ?? "array-cell",
    label: options.labels?.[index] ?? String(index),
    state: activeSet.has(index) ? "active" : "default",
    meta: options.role ? { role: options.role } : count > 7 ? { role: "compact-cell" } : undefined,
  }));
}

function namedValues(context: GeneratorContext, names: string[]): Array<string | number> {
  const lists = parseAllNamedLists(context.exampleInput);
  for (const name of names) {
    if (lists[name]?.length) return lists[name];
  }
  return [];
}

function exampleNumbers(context: GeneratorContext, names: string[] = ["nums", "values", "scores", "items"]): number[] {
  const fromNamed = namedValues(context, names).map(Number).filter(Number.isFinite);
  if (fromNamed.length) return fromNamed;
  return parseFirstList(context.exampleInput).map(Number).filter(Number.isFinite);
}

function relayoutLinkedNodes(sourceNodes: Array<Record<string, unknown>>, sourceEdges: Array<Record<string, unknown>>, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const ordered = sourceNodes.length ? sourceNodes : [
    { id: "N0", label: "10" },
    { id: "N1", label: "20" },
    { id: "N2", label: "30" },
  ];
  const activeIndex = Math.min(index, ordered.length - 1);
  const nodes = ordered.slice(0, 6).map((node, nodeIndex) => ({
    id: String(node.id || `N${nodeIndex}`),
    x: 145 + nodeIndex * 132,
    y: 260,
    value: String(node.label || node.value || nodeIndex),
    type: "linked-node" as const,
    label: nodeIndex === 0 ? "head" : "next",
    state: nodeIndex === activeIndex || node.active ? "active" as const : nodeIndex < activeIndex ? "visited" as const : "default" as const,
    meta: { role: "linked-node" },
  }));
  const edges = sourceEdges.length
    ? sourceEdges.slice(0, 6).map((edge, edgeIndex) => ({
      id: String(edge.id || `${edge.from}-${edge.to}`),
      from: String(edge.from),
      to: String(edge.to),
      type: "pointer" as const,
      state: edge.active || edgeIndex < activeIndex ? "active" as const : "default" as const,
    }))
    : nodes.slice(0, -1).map((node, nodeIndex) => ({
      id: `${node.id}-${nodes[nodeIndex + 1].id}`,
      from: node.id,
      to: nodes[nodeIndex + 1].id,
      type: "pointer" as const,
      state: nodeIndex < activeIndex ? "active" as const : "default" as const,
    }));
  if (nodes.length) {
    const last = nodes[nodes.length - 1];
    nodes.push({ id: "null", x: last.x + 132, y: 260, value: "null", type: "logic-node", label: "next", state: "inactive", meta: { role: "terminator" } });
    edges.push({ id: `${last.id}-null`, from: last.id, to: "null", type: "pointer", state: "inactive" });
  }
  return { nodes, edges, highlights: [nodes[activeIndex]?.id].filter(Boolean) };
}

function treeFromArray(values: Array<string | number>, activeIndex = 0, type: Node["type"] = "tree-node"): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const usable = values.slice(0, 15);
  function walk(itemIndex: number, depth: number, minX: number, maxX: number, parentId?: string) {
    const value = usable[itemIndex];
    if (value === undefined || value === -1 || value === "-1" || value === "null" || value === "None") return;
    const id = `tree-${itemIndex}`;
    const x = (minX + maxX) / 2;
    const y = 80 + depth * 105;
    nodes.push({
      id,
      x,
      y,
      value,
      type,
      label: itemIndex === 0 ? "root" : itemIndex % 2 ? "left" : "right",
      state: itemIndex === activeIndex ? "active" : itemIndex < activeIndex ? "visited" : "default",
    });
    if (parentId) edges.push({ id: `${parentId}-${id}`, from: parentId, to: id, type: "parent-child", state: itemIndex <= activeIndex ? "active" : "default" });
    walk(itemIndex * 2 + 1, depth + 1, minX, x - 34, id);
    walk(itemIndex * 2 + 2, depth + 1, x + 34, maxX, id);
  }
  walk(0, 0, 70, 830);
  return { nodes, edges, highlights: nodes.filter((node) => node.state === "active").map((node) => node.id) };
}

function treeFromEdges(sourceNodes: Array<Record<string, unknown>>, sourceEdges: Array<Record<string, unknown>>, activeFallback: number, type: Node["type"] = "tree-node"): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  if (!sourceNodes.length) return treeFromArray([1, 2, 3, -1, 4], activeFallback, type);
  const labels = new Map(sourceNodes.map((node, index) => [String(node.id || `N${index}`), String(node.label || node.value || node.id || index)]));
  const children = new Map<string, string[]>();
  const childIds = new Set<string>();
  sourceEdges.forEach((edge) => {
    const from = String(edge.from);
    const to = String(edge.to);
    childIds.add(to);
    children.set(from, [...(children.get(from) || []), to]);
  });
  const rootId = [...labels.keys()].find((id) => !childIds.has(id)) || [...labels.keys()][0];
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  function walk(id: string, depth: number, minX: number, maxX: number, parentId?: string) {
    const x = (minX + maxX) / 2;
    const y = 82 + depth * 108;
    const original = sourceNodes.find((node) => String(node.id) === id);
    nodes.push({
      id,
      x,
      y,
      value: labels.get(id) || id,
      type,
      label: id === rootId ? "root" : "",
      state: original?.active ? "active" : "default",
    });
    if (parentId) edges.push({ id: `${parentId}-${id}`, from: parentId, to: id, type: "parent-child", state: original?.active ? "active" : "default" });
    const kids = (children.get(id) || []).slice(0, 2);
    if (kids[0]) walk(kids[0], depth + 1, minX, x - 34, id);
    if (kids[1]) walk(kids[1], depth + 1, x + 34, maxX, id);
  }
  walk(rootId, 0, 70, 830);
  if (!nodes.some((node) => node.state === "active")) {
    const active = nodes[Math.min(activeFallback, nodes.length - 1)];
    if (active) active.state = "active";
  }
  return { nodes, edges, highlights: nodes.filter((node) => node.state === "active").map((node) => node.id) };
}

function graphVisual(state: Record<string, unknown>, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const sourceNodes = Array.isArray(state.nodes) ? state.nodes as Array<Record<string, unknown>> : [];
  const sourceEdges = Array.isArray(state.edges) ? state.edges as Array<Record<string, unknown>> : [];
  const labels = sourceNodes.length ? sourceNodes.map((node, nodeIndex) => String(node.id || node.label || nodeIndex)) : ["A", "B", "C", "D"];
  const links = sourceEdges.length
    ? sourceEdges.map((edge) => [String(edge.from), String(edge.to)] as [string, string])
    : [["A", "B"], ["A", "C"], ["B", "D"]] as Array<[string, string]>;
  const graph = layoutCircularGraph(labels.slice(0, 8), links);
  const activeIds = new Set(sourceNodes.filter((node) => node.active).map((node) => String(node.id)));
  if (!activeIds.size) activeIds.add(graph.nodes[Math.min(index, graph.nodes.length - 1)]?.id || graph.nodes[0]?.id || "A");
  return {
    nodes: graph.nodes.map((node) => ({ ...node, state: activeIds.has(node.id) ? "active" as const : index > 0 ? "visited" as const : "default" as const })),
    edges: graph.edges.map((edge) => ({ ...edge, state: sourceEdges.find((item) => String(item.from) === edge.from && String(item.to) === edge.to)?.active ? "active" as const : "default" as const })),
    highlights: [...activeIds],
  };
}

function authoredArrayVisual(concept: string, state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = valuesForState(concept, state, context);
  const active = activeIndexes(state, values.length, index);
  const pointerMap = state.pointers && typeof state.pointers === "object" ? state.pointers as Record<string, unknown> : {};
  const windowRange = Array.isArray(state.window) ? state.window.map(Number) : null;
  const nodes = linearNodes(values, [], { y: 235, role: values.length > 7 ? "compact-cell" : undefined }).map((node, nodeIndex) => {
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
  const activeIndex = active[0] ?? Math.min(index, Math.max(values.length - 1, 0));
  const activeValue = values[activeIndex] ?? "item";
  const trackerLabel = /count|total|sum/i.test(`${context.title || ""} ${context.prompt || ""}`) ? "tracker" : "result";
  nodes.push(
    {
      id: "active-read",
      x: 300,
      y: 375,
      value: String(activeValue),
      type: "logic-node",
      label: "current item",
      state: "active",
      meta: { role: "flow-step" },
    },
    {
      id: "tracked-result",
      x: 595,
      y: 375,
      value: String(state.answer || state.result || state.total || state.count || visualSampleExpected(context, concept, state)),
      type: "logic-node",
      label: trackerLabel,
      state: index >= 2 ? "active" : "default",
      meta: { role: "result" },
    },
  );
  const edges: Edge[] = [
    { id: `item-${activeIndex}-read`, from: `item-${activeIndex}`, to: "active-read", type: "pointer", state: "active" },
    { id: "read-result", from: "active-read", to: "tracked-result", type: "pointer", state: index >= 2 ? "active" : "default" },
  ];
  return { nodes, edges, highlights: [...active.map((item) => `item-${item}`), "active-read", ...(index >= 2 ? ["tracked-result"] : [])] };
}

function isStringVisualizer(concept: string, context: GeneratorContext): boolean {
  const text = `${context.visualizer?.concept || ""} ${context.topic || ""} ${context.title || ""} ${context.prompt || ""}`.toLowerCase();
  return concept === "array" && /string|word|sentence|letter|character|vowel|palindrome|initial|reverse/.test(text);
}

function authoredStringVisual(concept: string, state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = valuesForState(concept, state, context).slice(0, 8);
  const active = activeIndexes(state, values.length, index)[0] ?? 0;
  const sample = compactVisualInput(context, concept, state) || values.join("");
  const result = String(state.answer || state.result || state.total || state.count || visualSampleExpected(context, concept, state));
  const gap = values.length <= 1 ? 0 : Math.min(82, 560 / Math.max(values.length - 1, 1));
  const startX = 450 - ((Math.max(values.length, 1) - 1) * gap) / 2;
  const nodes: Node[] = [
    {
      id: "source-text",
      x: 450,
      y: 105,
      value: shortText(sample, "text"),
      type: "logic-node",
      label: "source text",
      state: "visited",
      meta: { role: "source-text" },
    },
    ...values.map((value, nodeIndex) => ({
      id: `char-${nodeIndex}`,
      x: startX + nodeIndex * gap,
      y: 250,
      value,
      type: "array-cell" as const,
      label: `index ${nodeIndex}`,
      state: nodeIndex === active ? "active" as const : nodeIndex < active ? "visited" as const : "default" as const,
      meta: { role: "string-cell" },
    })),
    {
      id: "scan-cursor",
      x: startX + active * gap,
      y: 365,
      value: String(values[active] ?? ""),
      type: "logic-node",
      label: "scan cursor",
      state: "active",
      meta: { role: "scan-cursor" },
    },
    {
      id: "string-result",
      x: 710,
      y: 365,
      value: result || "not yet",
      type: "logic-node",
      label: "result so far",
      state: index >= 3 ? "active" : "default",
      meta: { role: "result" },
    },
  ];
  const edges: Edge[] = [
    { id: `char-${active}-cursor`, from: `char-${active}`, to: "scan-cursor", type: "pointer", state: "active" },
    { id: "cursor-result", from: "scan-cursor", to: "string-result", type: "pointer", state: index >= 3 ? "active" : "default" },
  ];
  return {
    nodes,
    edges,
    highlights: [`char-${active}`, "scan-cursor", ...(index >= 3 ? ["string-result"] : [])],
  };
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

function rowsFromExampleOrState(state: Record<string, unknown>, context: GeneratorContext): Array<{ key: string | number; value: string | number }> {
  const namedLists = parseAllNamedLists(context.exampleInput);
  const keyList = namedLists.items || namedLists.names || namedLists.keys || parseFirstList(context.exampleInput);
  const valueList = namedLists.prices || namedLists.scores || namedLists.values || [];
  if (keyList.length) {
    return keyList.slice(0, 5).map((key, rowIndex) => ({ key, value: valueList[rowIndex] ?? "saved value" }));
  }
  if (Array.isArray(state.table)) {
    return (state.table as Array<Record<string, unknown>>)
      .slice(0, 5)
      .map((row, rowIndex) => ({ key: String(row.key || `key ${rowIndex + 1}`), value: String(row.value || "saved value") }));
  }
  return [
    { key: "milk", value: 4 },
    { key: "bread", value: 3 },
  ];
}

function authoredHashMapVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const assignments = parseScalarAssignments(context.exampleInput);
  const rows = rowsFromExampleOrState(state, context);
  const target = assignments.target || String(state.lookup || rows[1]?.key || rows[0]?.key || "key");
  const targetRow = rows.find((row) => String(row.key) === String(target)) || rows[0];
  const bucketCount = 4;
  const activeBucket = 2;
  const phase = index <= 0 ? "target" : index === 1 ? "bucket" : index === 2 ? "compare" : "value";
  const collisionRows = rows.length > 1 ? rows.slice(0, 2) : [targetRow];
  if (!collisionRows.some((row) => String(row.key) === String(targetRow.key))) {
    collisionRows[collisionRows.length - 1] = targetRow;
  }
  const targetEntryIndex = Math.max(0, collisionRows.findIndex((row) => String(row.key) === String(targetRow.key)));

  const nodes: Node[] = [
    { id: "target", x: 105, y: 270, value: String(target), type: "logic-node", label: "key to find", state: phase === "target" ? "active" : "visited", meta: { role: "flow-step" } },
    { id: "hash", x: 255, y: 270, value: "hash key", type: "logic-node", label: "choose bucket", state: phase === "bucket" ? "active" : index > 1 ? "visited" : "default", meta: { role: "flow-step" } },
  ];
  const edges: Edge[] = [
    { id: "target-hash", from: "target", to: "hash", type: "pointer", state: index >= 1 ? "active" : "default" },
  ];

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const id = `bucket-${bucket}`;
    nodes.push({
      id,
      x: 420 + bucket * 105,
      y: 130,
      value: bucket,
      type: "hash-bucket",
      label: "bucket",
      state: bucket === activeBucket ? (phase === "bucket" ? "active" : "visited") : "default",
    });
  }
  edges.push({ id: "hash-bucket-2", from: "hash", to: "bucket-2", type: "pointer", state: index >= 1 ? "active" : "default" });

  collisionRows.forEach((row, rowIndex) => {
    const keyId = `entry-${rowIndex}`;
    const valueId = `value-${rowIndex}`;
    const y = 285 + rowIndex * 88;
    const isTarget = String(row.key) === String(targetRow.key);
    const isActive = phase === "compare" ? isTarget : phase === "value" && isTarget;
    nodes.push(
      { id: keyId, x: 630, y, value: String(row.key), type: "hash-entry", label: rowIndex === 0 ? "head" : "next", state: isActive ? "comparing" : rowIndex === 0 && index >= 2 ? "visited" : "default" },
      { id: valueId, x: 790, y, value: String(row.value), type: "hash-entry", label: "value", state: phase === "value" && isTarget ? "active" : "default" },
    );
    edges.push(
      { id: rowIndex === 0 ? "bucket-entry-0" : `entry-${rowIndex - 1}-entry-${rowIndex}`, from: rowIndex === 0 ? "bucket-2" : `entry-${rowIndex - 1}`, to: keyId, type: "pointer", state: index >= 2 ? "active" : "default" },
      { id: `entry-${rowIndex}-value`, from: keyId, to: valueId, type: "pointer", state: phase === "value" && isTarget ? "active" : "default" },
    );
  });

  const highlights = phase === "target"
    ? ["target"]
    : phase === "bucket"
      ? ["hash", "bucket-2"]
      : phase === "compare"
        ? [`entry-${targetEntryIndex}`]
        : [`entry-${targetEntryIndex}`, `value-${targetEntryIndex}`];
  return { nodes, edges, highlights };
}

function relevantRule(context: GeneratorContext): string {
  const output = String(context.exampleOutput || "").toLowerCase();
  const title = String(context.title || "").toLowerCase();
  const example = String(context.exampleInput || "");
  if (title.includes("grade bucket")) {
    const score = Number(example.match(/-?\d+/)?.[0]);
    if (Number.isFinite(score)) {
      if (score >= 90) return "score >= 90";
      if (score >= 80) return "score >= 80";
      if (score >= 70) return "score >= 70";
      if (score >= 60) return "score >= 60";
      return "score < 60";
    }
  }
  const constraints = context.constraints || [];
  const matching = constraints.find((item) => item.toLowerCase().includes("return") && output && item.toLowerCase().includes(output));
  if (matching) return matching.replace(/^return\s+/i, "").replace(/\.$/, "");
  const returnRule = constraints.find((item) => item.toLowerCase().includes("return"));
  if (returnRule) return returnRule.replace(/^return\s+/i, "").replace(/\.$/, "");
  return constraints.find((item) => !/integer|length|same|range|empty/i.test(item)) || "the condition from the prompt";
}

function cleanedResult(value: unknown): string {
  return String(value || "")
    .replace(/^return\s+/i, "")
    .replace(/^return shape:\s*/i, "")
    .replace(/[.;]\s*$/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function compactFlowText(value: unknown, fallback: string): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text
    .replace(/^return\s+/i, "")
    .replace(/^if\s+/i, "")
    .replace(/\s+then\s+/i, " -> ")
    .replace(/\bis greater than or equal to\b/gi, ">=")
    .replace(/\bis less than or equal to\b/gi, "<=")
    .replace(/\bis greater than\b/gi, ">")
    .replace(/\bis less than\b/gi, "<")
    .replace(/\bequals\b/gi, "==");
}

function conditionalRules(context: GeneratorContext): Array<{ rule: string; result: string }> {
  const title = String(context.title || "").toLowerCase();
  if (title.includes("grade bucket")) {
    return [
      { rule: "score >= 90", result: "A" },
      { rule: "score >= 80", result: "B" },
      { rule: "score >= 70", result: "C" },
      { rule: "score >= 60", result: "D" },
      { rule: "otherwise", result: "F" },
    ];
  }

  const rules = (context.constraints || [])
    .map((constraint) => {
      const cleaned = constraint.replace(/\s+/g, " ").trim();
      const ifMatch = cleaned.match(/^if\s+(.+?),?\s+return\s+(.+)$/i);
      if (ifMatch) return { rule: ifMatch[1].trim(), result: cleanedResult(ifMatch[2]) };
      const returnMatch = cleaned.match(/^return\s+(.+?)\s+(?:if|when)\s+(.+)$/i);
      if (returnMatch) return { rule: returnMatch[2].trim(), result: cleanedResult(returnMatch[1]) };
      return null;
    })
    .filter(Boolean) as Array<{ rule: string; result: string }>;

  if (rules.length) return rules.slice(0, 6);
  return [{ rule: relevantRule(context), result: expectedText(context) }];
}

function expandConditionalSteps(
  rawSteps: Array<Record<string, unknown>>,
  baseState: Record<string, unknown>,
  context: GeneratorContext,
): Array<Record<string, unknown>> {
  const rules = conditionalRules(context);
  if (rules.length <= 1) return rawSteps;
  const expected = cleanedResult(context.exampleOutput || baseState.goal);
  const chosenIndex = Math.max(0, rules.findIndex((rule) => cleanedResult(rule.result).toLowerCase() === expected.toLowerCase()));
  const input = exampleText(context, baseState);
  return [
    {
      title: `Read the ${context.title || "conditional"} example`,
      body: `Start with the teaching sample ${input}. Test one branch at a time.`,
      action: "input",
      state: { ...baseState, condition_phase: "input" },
    },
    ...rules.map((rule, ruleIndex) => {
      const taken = ruleIndex === chosenIndex;
      return {
        title: `Check branch ${ruleIndex + 1}`,
        body: taken
          ? `Ask whether ${rule.rule}. This branch matches the example, so the other branches fade back.`
          : `Ask whether ${rule.rule}. This branch does not match the example, so keep moving to the next rule.`,
        action: taken ? "matched branch" : "skip branch",
        state: {
          ...baseState,
          condition_phase: "branch",
          rule: rule.rule,
          branch_result: rule.result,
          branch_taken: taken,
          branch_number: ruleIndex + 1,
          branches: rules.length,
        },
      };
    }),
    {
      title: "Return the chosen branch",
      body: `Only the matching branch supplies the result: ${expected || "the requested result"}.`,
      action: "result",
      state: { ...baseState, condition_phase: "end", rule: rules[chosenIndex]?.rule, branch_result: expected, branch_taken: true },
    },
  ];
}

function conditionInputLabel(context: GeneratorContext, state: Record<string, unknown>): string {
  const assignments = parseScalarAssignments(context.exampleInput);
  const pairs = Object.entries(assignments);
  if (pairs.length === 1) return `${pairs[0][0]} = ${pairs[0][1]}`;
  if (pairs.length > 1) return pairs.slice(0, 2).map(([key, value]) => `${key}=${value}`).join(", ");
  return context.exampleInput || String(state.sample || "sample");
}

function authoredConditionalVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const rawInput = conditionInputLabel(context, state);
  const input = compactFlowText(rawInput, "input");
  const output = cleanedResult(state.branch_result || context.exampleOutput || state.goal || "result");
  const rule = String(state.rule || relevantRule(context));
  const compactRule = compactFlowText(rule, "condition?");
  const compactOutput = compactFlowText(output, "result");
  const phase = String(state.condition_phase || (index <= 0 ? "input" : index === 1 ? "condition" : index === 2 ? "branch" : "end"));
  const branchTaken = state.branch_taken !== false;
  const branchLabel = branchTaken ? "true" : "false";
  const nodes: Node[] = [
    { id: "start", x: 68, y: 260, value: "Start", type: "logic-node", label: "", state: index >= 0 ? "visited" : "default", meta: { role: "terminator" } },
    { id: "input", x: 190, y: 260, value: input, type: "logic-node", label: "input", state: phase === "input" ? "active" : "visited", meta: { role: "flow-step", fullText: rawInput } },
    { id: "condition", x: 360, y: 260, value: compactRule.length > 18 ? "check rule" : compactRule, type: "logic-node", label: "condition", state: phase === "condition" || phase === "branch" ? "active" : "visited", meta: { role: "diamond", fullText: rule } },
    { id: "true", x: 570, y: 168, value: output ? `return ${compactOutput}` : "steps", type: "logic-node", label: "true", state: phase === "end" || (phase === "branch" && branchTaken) ? "active" : "default", meta: { role: "flow-step", fullText: output } },
    { id: "false", x: 570, y: 352, value: branchTaken ? "skip other branches" : "try next rule", type: "logic-node", label: "false", state: phase === "branch" && !branchTaken ? "active" : "inactive", meta: { role: "flow-step" } },
    { id: "end", x: 790, y: 260, value: "End", type: "logic-node", label: "", state: phase === "end" ? "active" : "default", meta: { role: "terminator" } },
  ];
  const edges: Edge[] = [
    { id: "start-input", from: "start", to: "input", type: "branch", state: "active" },
    { id: "input-condition", from: "input", to: "condition", type: "branch", state: index >= 1 ? "active" : "default" },
    { id: "condition-true", from: "condition", to: "true", type: "branch", label: "True", state: phase === "end" || (phase === "branch" && branchTaken) ? "active" : "default" },
    { id: "condition-false", from: "condition", to: "false", type: "branch", label: "False", state: phase === "branch" && !branchTaken ? "active" : "inactive" },
    { id: "true-end", from: "true", to: "end", type: "branch", state: phase === "end" ? "active" : "default" },
    { id: "false-end", from: "false", to: "end", type: "branch", state: phase === "branch" && !branchTaken ? "active" : "inactive" },
  ];
  return { nodes, edges, highlights: phase === "branch" ? ["condition", branchTaken ? "true" : "false"] : [phase] };
}

function authoredStackQueueVisual(concept: string, state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const fallback = namedValues(context, ["names", "items", "values"]);
  const values = (concept === "stack"
    ? (Array.isArray(state.stack) ? state.stack : fallback)
    : (Array.isArray(state.queue) ? state.queue : fallback)).map((value) => value as string | number);
  const visible = values.length ? values.slice(0, 6) : ["empty"];
  if (concept === "stack") {
    const bottomY = 392;
    const nodes = visible.map((value, nodeIndex) => {
      const isEmpty = value === "empty";
      const activeIndex = Math.min(index, visible.length - 1);
      return {
        id: `stack-${nodeIndex}`,
        x: 450,
        y: isEmpty ? 280 : bottomY - nodeIndex * 68,
        value,
        type: "array-cell" as const,
        label: isEmpty ? "stack" : nodeIndex === visible.length - 1 ? "top" : nodeIndex === 0 ? "bottom" : "",
        state: isEmpty || nodeIndex === activeIndex ? "active" as const : "default" as const,
        meta: { role: "stack-item" },
      };
    });
    return { nodes, edges: [], highlights: [nodes[Math.min(index, nodes.length - 1)]?.id || "stack-0"] };
  }

  const nodes = linearNodes(visible, [Math.min(index, visible.length - 1)], {
    y: 270,
    maxWidth: 620,
    role: "queue-item",
    labels: visible.map((_, nodeIndex) => nodeIndex === 0 ? "front" : nodeIndex === visible.length - 1 ? "rear" : String(nodeIndex)),
  });
  const edges = nodes.slice(0, -1).map((node, nodeIndex) => ({
    id: `${node.id}-${nodes[nodeIndex + 1].id}`,
    from: node.id,
    to: nodes[nodeIndex + 1].id,
    type: "pointer" as const,
    state: nodeIndex < index ? "active" as const : "default" as const,
  }));
  return { nodes, edges, highlights: [nodes[Math.min(index, nodes.length - 1)]?.id || "item-0"] };
}

function authoredTupleVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const lists = parseAllNamedLists(context.exampleInput);
  const names = lists.names || lists.items || lists.keys || ["Ada", "Grace"];
  const scores = lists.scores || lists.values || [95, 88];
  const active = Math.min(index, Math.max(0, Math.min(names.length, scores.length) - 1));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  names.slice(0, 4).forEach((name, rowIndex) => {
    const y = 140 + rowIndex * 82;
    nodes.push(
      { id: `tuple-name-${rowIndex}`, x: 275, y, value: name, type: "array-cell", label: `name ${rowIndex}`, state: rowIndex === active ? "active" : "default", meta: { role: "tuple-cell" } },
      { id: `tuple-score-${rowIndex}`, x: 455, y, value: scores[rowIndex] ?? "?", type: "array-cell", label: `score ${rowIndex}`, state: rowIndex === active ? "active" : "default", meta: { role: "tuple-cell" } },
      { id: `tuple-pair-${rowIndex}`, x: 675, y, value: `${name}:${scores[rowIndex] ?? "?"}`, type: "array-cell", label: "paired result", state: rowIndex === active && index > 0 ? "active" : "default", meta: { role: "tuple-pair" } },
    );
    edges.push(
      { id: `name-score-${rowIndex}`, from: `tuple-name-${rowIndex}`, to: `tuple-score-${rowIndex}`, type: "pointer", state: rowIndex === active ? "active" : "default" },
      { id: `score-pair-${rowIndex}`, from: `tuple-score-${rowIndex}`, to: `tuple-pair-${rowIndex}`, type: "pointer", state: rowIndex === active && index > 0 ? "active" : "default" },
    );
  });
  return { nodes, edges, highlights: [`tuple-name-${active}`, `tuple-score-${active}`, `tuple-pair-${active}`] };
}

function isTupleSwapVisualizer(context: GeneratorContext): boolean {
  return /swap|reverse\s+pair|pair\s+order|order\s+pair/i.test(`${context.title || ""} ${context.prompt || ""} ${context.topic || ""}`);
}

function authoredTupleSwapVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = valuesForState("tuple", state, context);
  const first = values[0] ?? "Ada";
  const second = values[1] ?? "Grace";
  const phase = Math.min(index, 5);
  const nodes: Node[] = [
    { id: "tuple-swap-original-0", x: 310, y: 165, value: first, type: "array-cell", label: "original first", state: phase <= 1 ? "active" : "visited", meta: { role: "tuple-cell" } },
    { id: "tuple-swap-original-1", x: 590, y: 165, value: second, type: "array-cell", label: "original second", state: phase <= 2 ? "active" : "visited", meta: { role: "tuple-cell" } },
    { id: "tuple-swap-new-0", x: 310, y: 345, value: second, type: "array-cell", label: "new first", state: phase >= 2 ? "active" : "default", meta: { role: "tuple-cell" } },
    { id: "tuple-swap-new-1", x: 590, y: 345, value: first, type: "array-cell", label: "new second", state: phase >= 3 ? "active" : "default", meta: { role: "tuple-cell" } },
    { id: "tuple-swap-result", x: 760, y: 345, value: `${second}, ${first}`, type: "logic-node", label: "swapped result", state: phase >= 4 ? "active" : "default", meta: { role: "result" } },
  ];
  const edges: Edge[] = [
    { id: "second-new-first", from: "tuple-swap-original-1", to: "tuple-swap-new-0", type: "pointer", state: phase >= 2 ? "active" : "default" },
    { id: "first-new-second", from: "tuple-swap-original-0", to: "tuple-swap-new-1", type: "pointer", state: phase >= 3 ? "active" : "default" },
    { id: "new-first-result", from: "tuple-swap-new-0", to: "tuple-swap-result", type: "pointer", state: phase >= 4 ? "active" : "default" },
    { id: "new-second-result", from: "tuple-swap-new-1", to: "tuple-swap-result", type: "pointer", state: phase >= 4 ? "active" : "default" },
  ];
  const highlights = phase >= 4
    ? ["tuple-swap-result", "tuple-swap-new-0", "tuple-swap-new-1"]
    : phase >= 3
      ? ["tuple-swap-original-0", "tuple-swap-new-1"]
      : phase >= 2
        ? ["tuple-swap-original-1", "tuple-swap-new-0"]
        : ["tuple-swap-original-0", "tuple-swap-original-1"];
  return { nodes, edges, highlights };
}

function authoredSetVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = valuesForState("set", state, context);
  const seen = new Set<string>();
  const nodes: Node[] = [];
  const visibleValues = values.slice(0, 8);
  visibleValues.forEach((value, nodeIndex) => {
    const key = String(value);
    const isDuplicate = seen.has(key);
    seen.add(key);
    nodes.push({
      id: `set-${nodeIndex}`,
      x: 130 + nodeIndex * Math.min(86, 560 / Math.max(visibleValues.length - 1, 1)),
      y: 190,
      value,
      type: "set-item",
      label: isDuplicate ? "duplicate" : "unique",
      state: nodeIndex === Math.min(index, values.length - 1) ? "active" : isDuplicate ? "inactive" : "visited",
    });
  });
  const activeIndex = Math.min(index, Math.max(visibleValues.length - 1, 0));
  const activeValue = visibleValues[activeIndex] ?? "item";
  const keptValues = [...new Set(visibleValues.slice(0, activeIndex + 1).map(String))];
  nodes.push(
    { id: "membership-check", x: 310, y: 340, value: String(activeValue), type: "logic-node", label: "membership check", state: "active", meta: { role: "flow-step" } },
    { id: "seen-memory", x: 520, y: 340, value: keptValues.join(", ") || "empty", type: "logic-node", label: "seen set", state: index >= 1 ? "active" : "default", meta: { role: "memory" } },
    { id: "set-result", x: 730, y: 340, value: keptValues.join(", ") || "none yet", type: "logic-node", label: "kept result", state: index >= 2 ? "active" : "default", meta: { role: "result" } },
  );
  const edges: Edge[] = [
    { id: `set-${activeIndex}-check`, from: `set-${activeIndex}`, to: "membership-check", type: "pointer", state: "active" },
    { id: "check-memory", from: "membership-check", to: "seen-memory", type: "pointer", state: index >= 1 ? "active" : "default" },
    { id: "memory-result", from: "seen-memory", to: "set-result", type: "pointer", state: index >= 2 ? "active" : "default" },
  ];
  return { nodes, edges, highlights: [`set-${activeIndex}`, "membership-check", "seen-memory", ...(index >= 2 ? ["set-result"] : [])] };
}

function authoredRecursionVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const assignments = parseScalarAssignments(context.exampleInput);
  const title = String(context.title || context.topic || "recursive call").toLowerCase();
  const seed = assignments.n || assignments.base || assignments.text || assignments.input || "3";
  const isText = /text|string|reverse|palindrome|char/.test(title) || Number.isNaN(Number(seed));
  const frames = isText
    ? ["code", "ode", "de", "e"].slice(0, 4)
    : [Number(seed) || 3, Math.max((Number(seed) || 3) - 1, 1), Math.max((Number(seed) || 3) - 2, 0), 0];
  const bounded = Math.min(index, 5);
  const growingCount = Math.min(Math.max(bounded + 1, 1), frames.length);
  const isUnwinding = bounded >= 3;
  const visibleFrames = frames.slice(0, growingCount);
  const nodes: Node[] = visibleFrames.map((value, frameIndex) => {
    const activeFrame = isUnwinding ? visibleFrames.length - 1 - Math.min(bounded - 3, visibleFrames.length - 1) : visibleFrames.length - 1;
    return {
      id: `call-${frameIndex}`,
      x: 310,
      y: 135 + frameIndex * 78,
      value: `${context.title || "solve"}(${value})`,
      type: "logic-node" as const,
      label: frameIndex === 0 ? "first call" : frameIndex === visibleFrames.length - 1 ? "current call" : "waiting",
      state: frameIndex === activeFrame ? "active" as const : frameIndex < activeFrame ? "visited" as const : "default" as const,
      meta: { role: "call-frame" },
    };
  });
  const edges: Edge[] = nodes.slice(0, -1).map((node, edgeIndex) => ({
    id: `${node.id}-${nodes[edgeIndex + 1].id}`,
    from: node.id,
    to: nodes[edgeIndex + 1].id,
    type: "pointer" as const,
    state: edgeIndex < bounded ? "active" as const : "default" as const,
  }));
  nodes.push(
    {
      id: "base-case",
      x: 625,
      y: 185,
      value: isUnwinding ? "base reached" : "not yet",
      type: "logic-node",
      label: "base case",
      state: bounded >= 2 ? "active" : "default",
      meta: { role: "diamond" },
    },
    {
      id: "return-chain",
      x: 625,
      y: 345,
      value: bounded >= 4 ? cleanedResult(context.exampleOutput || state.result || "answer") : "waiting",
      type: "logic-node",
      label: "return chain",
      state: bounded >= 4 ? "active" : "default",
      meta: { role: "result" },
    },
  );
  if (nodes[visibleFrames.length - 1]) {
    edges.push({ id: "call-base", from: nodes[visibleFrames.length - 1].id, to: "base-case", type: "branch", state: bounded >= 2 ? "active" : "default" });
  }
  edges.push({ id: "base-return", from: "base-case", to: "return-chain", type: "branch", state: bounded >= 4 ? "active" : "default" });
  return { nodes, edges, highlights: [nodes[Math.min(visibleFrames.length - 1, bounded)]?.id || "call-0", ...(bounded >= 2 ? ["base-case"] : []), ...(bounded >= 4 ? ["return-chain"] : [])] };
}

function authoredTwoPointerVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = valuesForState("two-pointers", state, context);
  const pointers = state.pointers && typeof state.pointers === "object" ? state.pointers as Record<string, unknown> : {};
  const left = Number(pointers.left ?? 0);
  const right = Number(pointers.right ?? Math.max(values.length - 1, 0));
  const active = activeIndexes({ active: [left, right] }, values.length, index);
  const nodes = linearNodes(values, active, {
    y: 290,
    maxWidth: 620,
    labels: values.map((_, nodeIndex) => nodeIndex === left ? "left" : nodeIndex === right ? "right" : String(nodeIndex)),
  });
  return { nodes, edges: [], highlights: active.map((item) => `item-${item}`) };
}

function authoredBinarySearchVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = valuesForState("binary-search", state, context);
  const pointerState = state.pointers && typeof state.pointers === "object" ? state.pointers as Record<string, unknown> : {};
  const left = Number(pointerState.left ?? 0);
  const right = Number(pointerState.right ?? Math.max(values.length - 1, 0));
  const mid = Number(pointerState.mid ?? Math.floor((left + right) / 2));
  const nodes = linearNodes(values, [], { y: 292, maxWidth: 640 }).map((node, nodeIndex) => ({
    ...node,
    label: nodeIndex === left ? "left" : nodeIndex === mid ? "mid" : nodeIndex === right ? "right" : String(nodeIndex),
    state: nodeIndex < left || nodeIndex > right ? "inactive" as const : nodeIndex === mid ? "active" as const : "default" as const,
    meta: { role: nodeIndex >= left && nodeIndex <= right ? "range-cell" : "compact-cell" },
  }));
  return { nodes, edges: [], highlights: [`item-${mid}`] };
}

function authoredSlidingWindowVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = valuesForState("sliding-window", state, context);
  const range = Array.isArray(state.window) ? state.window.map(Number) : [0, Math.min(2, values.length - 1)];
  const nodes = linearNodes(values, [], { y: 292, maxWidth: 640 }).map((node, nodeIndex) => ({
    ...node,
    label: nodeIndex === range[0] ? "left" : nodeIndex === range[1] ? "right" : String(nodeIndex),
    state: nodeIndex >= range[0] && nodeIndex <= range[1] ? "active" as const : "default" as const,
    meta: { role: nodeIndex >= range[0] && nodeIndex <= range[1] ? "window-cell" : "compact-cell" },
  }));
  return { nodes, edges: [], highlights: nodes.filter((node) => node.state === "active").map((node) => node.id) };
}

function authoredPrefixSumVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const values = exampleNumbers(context);
  const usable = values.length ? values.slice(0, 7) : valuesForState("prefix-sum", state, context).map(Number).filter(Number.isFinite);
  let total = 0;
  const active = Math.min(index, Math.max(usable.length - 1, 0));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  usable.forEach((value, nodeIndex) => {
    total += value;
    const x = 170 + nodeIndex * Math.min(94, 600 / Math.max(usable.length - 1, 1));
    nodes.push(
      { id: `num-${nodeIndex}`, x, y: 205, value, type: "array-cell", label: `num ${nodeIndex}`, state: nodeIndex === active ? "active" : "default", meta: { role: "compact-cell" } },
      { id: `prefix-${nodeIndex}`, x, y: 330, value: total, type: "array-cell", label: `sum ${nodeIndex}`, state: nodeIndex <= active ? "visited" : "default", meta: { role: "prefix-cell" } },
    );
    edges.push({ id: `num-prefix-${nodeIndex}`, from: `num-${nodeIndex}`, to: `prefix-${nodeIndex}`, type: "pointer", state: nodeIndex === active ? "active" : "default" });
  });
  return { nodes, edges, highlights: [`num-${active}`, `prefix-${active}`] };
}

function authoredIntervalVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const rawIntervals = Array.isArray(state.intervals) ? state.intervals as Array<Record<string, unknown>> : [];
  const intervals = rawIntervals.length ? rawIntervals : [
    { start: 9, end: 12, label: "A" },
    { start: 11, end: 13, label: "B" },
    { start: 14, end: 16, label: "C" },
  ];
  const starts = intervals.map((item) => Number(item.start)).filter(Number.isFinite);
  const ends = intervals.map((item) => Number(item.end)).filter(Number.isFinite);
  const min = Math.min(...starts, 0);
  const max = Math.max(...ends, min + 1);
  const span = Math.max(max - min, 1);
  const nodes = intervals.slice(0, 5).map((item, intervalIndex) => {
    const start = Number(item.start);
    const end = Number(item.end);
    const width = Math.max(88, ((end - start) / span) * 560);
    const center = 180 + ((start - min) / span) * 560 + width / 2;
    return {
      id: `interval-${intervalIndex}`,
      x: center,
      y: 150 + intervalIndex * 82,
      value: `${start}-${end}`,
      type: "array-cell" as const,
      label: String(item.label || `range ${intervalIndex + 1}`),
      state: intervalIndex <= Math.min(index, intervals.length - 1) ? "active" as const : "default" as const,
      meta: { role: "interval-bar", width },
    };
  });
  return { nodes, edges: [], highlights: [nodes[Math.min(index, nodes.length - 1)]?.id || "interval-0"] };
}

function authoredUnionFindVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const n = Number(parseScalarAssignments(context.exampleInput).n || 5);
  const labels = Array.from({ length: Math.min(Math.max(n, 4), 7) }, (_, itemIndex) => String(itemIndex));
  const activePairs = parseAllNamedLists(context.exampleInput).pairs || [];
  const graph = layoutCircularGraph(labels, []);
  const pairEdge: Edge[] = labels.slice(0, Math.min(index + 1, labels.length - 1)).map((label, pairIndex) => ({
    id: `${label}-${labels[pairIndex + 1]}`,
    from: label,
    to: labels[pairIndex + 1],
    type: "graph-edge" as const,
    state: "active" as const,
  }));
  return {
    nodes: graph.nodes.map((node, nodeIndex) => ({
      ...node,
      label: "item",
      state: nodeIndex <= Math.min(index + 1, labels.length - 1) ? "active" as const : "default" as const,
    })),
    edges: pairEdge.length ? pairEdge : activePairs.map((value, pairIndex) => ({ id: `union-${pairIndex}`, from: String(value), to: String(Number(value) + 1), type: "graph-edge" as const, state: "active" as const })),
    highlights: labels.slice(0, Math.min(index + 2, labels.length)),
  };
}

function authoredTrieVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const words = namedValues(context, ["words", "items"]).map(String);
  const word = words[0] || String(valuesForState("trie", state, context)[0] || "code");
  const chars = word.slice(0, 6).split("");
  const nodes: Node[] = [{ id: "root", x: 120, y: 260, value: "root", type: "tree-node", label: "", state: index === 0 ? "active" : "visited" }];
  const edges: Edge[] = [];
  chars.forEach((char, charIndex) => {
    const id = `char-${charIndex}`;
    nodes.push({
      id,
      x: 245 + charIndex * 105,
      y: 260 + (charIndex % 2 === 0 ? -70 : 70),
      value: char,
      type: "tree-node",
      label: charIndex === chars.length - 1 ? "word end" : `letter ${charIndex + 1}`,
      state: charIndex <= index - 1 ? "active" : "default",
    });
    edges.push({
      id: charIndex === 0 ? `root-${id}` : `char-${charIndex - 1}-${id}`,
      from: charIndex === 0 ? "root" : `char-${charIndex - 1}`,
      to: id,
      type: "parent-child",
      state: charIndex <= index - 1 ? "active" : "default",
    });
  });
  return { nodes, edges, highlights: [index === 0 ? "root" : `char-${Math.min(index - 1, chars.length - 1)}`] };
}

function parseMatrixInput(input?: string): unknown[][] {
  const text = String(input || "");
  const rows: unknown[][] = [];
  const pattern = /\[([^\[\]]+)\]/g;
  let match = pattern.exec(text);
  while (match) {
    const values = match[1].split(",").map(parseToken).filter((value) => String(value).length > 0);
    if (values.length) rows.push(values);
    match = pattern.exec(text);
  }
  return rows.length > 1 ? rows : [];
}

function authoredGridVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const parsedGrid = parseMatrixInput(context.exampleInput);
  const grid = Array.isArray(state.grid) ? state.grid as unknown[][] : parsedGrid.length ? parsedGrid : [[1, 2, 3], [4, 5, 6]];
  const activeCells = new Set((Array.isArray(state.activeCells) ? state.activeCells : [[0, Math.min(index, grid[0]?.length || 1)]]).map((cell) => Array.isArray(cell) ? cell.join("-") : String(cell)));
  const nodes: Node[] = [];
  const rowCount = Math.min(grid.length, 5);
  const colCount = Math.min(Math.max(...grid.map((row) => row.length)), 6);
  const startX = 450 - ((colCount - 1) * 86) / 2;
  const startY = 260 - ((rowCount - 1) * 82) / 2;
  grid.slice(0, rowCount).forEach((row, rowIndex) => {
    row.slice(0, colCount).forEach((value, colIndex) => {
      const id = `cell-${rowIndex}-${colIndex}`;
      nodes.push({
        id,
        x: startX + colIndex * 86,
        y: startY + rowIndex * 82,
        value: value as string | number,
        type: "array-cell",
        label: `${rowIndex},${colIndex}`,
        state: activeCells.has(`${rowIndex}-${colIndex}`) ? "active" : "default",
        meta: { role: "compact-cell" },
      });
    });
  });
  return { nodes, edges: [], highlights: nodes.filter((node) => node.state === "active").map((node) => node.id) };
}

function authoredNodeVisual(state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const sourceNodes = Array.isArray(state.nodes) ? state.nodes as Array<Record<string, unknown>> : [];
  const sourceEdges = Array.isArray(state.edges) ? state.edges as Array<Record<string, unknown>> : [];
  if (context.visualizer?.concept === "graph") return graphVisual(state, index);
  if (context.visualizer?.concept === "linked-list") return relayoutLinkedNodes(sourceNodes, sourceEdges, index);
  if (context.visualizer?.concept === "heap") return treeFromArray(valuesForState("heap", state, context), Math.min(index, 5), "tree-node");
  if (context.visualizer?.concept === "trie") return authoredTrieVisual(state, context, index);
  if (context.visualizer?.concept === "binary-tree") {
    const treeValues = namedValues(context, ["tree"]);
    if (treeValues.length) return treeFromArray(treeValues, Math.min(index, treeValues.length - 1));
    return treeFromEdges(sourceNodes, sourceEdges, index);
  }
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

function generatedVisualAt(steps: Step[], index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  const chosen = steps[Math.min(Math.max(index, 0), Math.max(steps.length - 1, 0))] || steps[0];
  return {
    nodes: chosen?.nodes || [],
    edges: chosen?.edges || [],
    highlights: chosen?.highlights?.nodeIds || [],
  };
}

function visualForAuthoredStep(concept: string, state: Record<string, unknown>, context: GeneratorContext, index: number): { nodes: Node[]; edges: Edge[]; highlights: string[] } {
  if (concept === "conditional") return authoredConditionalVisual(state, context, index);
  if ((concept === "tuple" || String(context.topic || "").toLowerCase().includes("tuple")) && isTupleSwapVisualizer(context)) return authoredTupleSwapVisual(state, context, index);
  if (concept === "tuple" || String(context.topic || "").toLowerCase().includes("tuple")) return authoredTupleVisual(state, context, index);
  if (concept === "set") return authoredSetVisual(state, context, index);
  if (concept === "union-find") return generatedVisualAt(generateUnionFindSteps(context), index);
  if (concept === "prefix-sum") return authoredPrefixSumVisual(state, context, index);
  if (concept === "intervals") return generatedVisualAt(generateIntervalsSteps(context), index);
  if (concept === "binary-search") return generatedVisualAt(generateBinarySearchSteps(context), index);
  if (concept === "two-pointers") return generatedVisualAt(generateTwoPointerSteps(context), index);
  if (concept === "sliding-window") return generatedVisualAt(generateSlidingWindowSteps(context), index);
  if (concept === "trie") return generatedVisualAt(generateTrieSteps(context), index);
  if (concept === "heap") return generatedVisualAt(generateHeapSteps(context), index);
  if (concept === "hash-map") return generatedVisualAt(generateHashMapCollisionSteps(context), index);
  if (concept === "stack") return generatedVisualAt(generateStackSteps(context), index);
  if (concept === "queue") return generatedVisualAt(generateQueueSteps(context), index);
  if (concept === "matrix") return authoredGridVisual(state, context, index);
  if (concept === "dynamic-programming") return generatedVisualAt(generateDynamicProgrammingSteps(context), index);
  if (concept === "recursion") return generatedVisualAt(generateRecursionSteps(context), index);
  if (concept === "binary-tree") return generatedVisualAt(generateTreeInsertSteps(context), index);
  if (concept === "graph") return generatedVisualAt(generateGraphTraversalSteps(context), index);
  if (concept === "linked-list") return authoredNodeVisual(state, context, index);
  if (isStringVisualizer(concept, context)) return authoredStringVisual(concept, state, context, index);
  return authoredArrayVisual(concept, state, context, index);
}

function titleForAuthoredStep(rawTitle: unknown, context: GeneratorContext, index: number): string {
  const title = cleanText(rawTitle, "");
  if (!title || /make the key move|decide the next step|set up the sample/i.test(title)) {
    const labels = ["Load the example", "Inspect the active state", "Apply one rule", "Move to the next state", "Check the stopping point", "Return only what the prompt asks"];
    return `${labels[Math.min(index, labels.length - 1)]}: ${context.title || "Practice problem"}`;
  }
  return title;
}

function bodyForAuthoredStep(rawBody: unknown, context: GeneratorContext, concept: string, state: Record<string, unknown>, index: number): string {
  const body = cleanText(rawBody, "");
  if (!body || /one pointer, cell, memory slot|apply the main|tiny version of the problem/i.test(body)) {
    const compactSample = compactVisualInput(context, concept, state) || context.exampleInput;
    const sample = compactSample ? `Use the teaching sample ${compactSample}. ` : "";
    const output = context.exampleOutput ? `The example output is ${context.exampleOutput}, but the code path is still yours to build.` : "Focus on the next state change, not a memorized answer.";
    if (index === 0) return `${sample}Set up only the small state you need to trace the idea.`;
    if (index === 1) return "Read the active item, pointer, branch, or memory slot before changing anything.";
    if (index === 2) return "Apply the rule to exactly one visible state change.";
    if (index === 3) return "Move forward and keep the updated state visible.";
    if (index === 4) return "Check whether the pattern should stop or repeat one more time.";
    return output;
  }
  return body;
}

function inferredSetupStep(
  rawSteps: Array<Record<string, unknown>>,
  context: GeneratorContext,
): Record<string, unknown> {
  const first = rawSteps[0] || {};
  const sample = exampleText(context, first.state as Record<string, unknown>);
  return {
    ...first,
    title: "Load the example",
    body: `Start with the teaching sample ${sample}. Name the small pieces of state before the first move.`,
    code: "values = input",
    cue: "What values, pointers, or memory slots exist before anything changes?",
    action: "load",
  };
}

function inferredFinalStep(
  rawSteps: Array<Record<string, unknown>>,
  context: GeneratorContext,
): Record<string, unknown> {
  const last = rawSteps[rawSteps.length - 1] || {};
  const expected = expectedText(context, last.state as Record<string, unknown>);
  return {
    ...last,
    title: "Check the final result",
    body: `End by checking the traced state against the expected result: ${expected}.`,
    changed: expected ? `result = ${expected}` : last.changed,
    why: "The last visual state should explain the output shape without revealing solution code.",
    code: "return result",
    cue: "Does the final state match the requested output shape?",
    action: "result",
  };
}

function stepText(raw: Record<string, unknown>): string {
  return `${String(raw.action || "")} ${String(raw.title || "")}`.toLowerCase();
}

function isSetupLike(raw: Record<string, unknown>): boolean {
  return /\b(setup|set up|start|load)\b/.test(stepText(raw));
}

function isFinishLike(raw: Record<string, unknown>): boolean {
  return /\b(finish|final|return|result|connect)\b/.test(stepText(raw));
}

function movedArrayState(
  source: Record<string, unknown>,
  slot: "first-repeat" | "second-repeat",
): Record<string, unknown> {
  const baseState = (source.state && typeof source.state === "object" ? source.state as Record<string, unknown> : source) || {};
  const items = Array.isArray(baseState.items)
    ? baseState.items
    : Array.isArray(baseState.values)
      ? baseState.values
      : [];
  const active = activeIndexes(baseState, Math.max(items.length, 1), 0)[0] || 0;
  const nextActive = items.length ? Math.min(active + (slot === "first-repeat" ? 0 : 1), items.length - 1) : active;
  const current = items[nextActive] ?? items[active] ?? baseState.current ?? "item";
  return {
    ...baseState,
    active: [nextActive],
    index: nextActive,
    current,
    answer: slot === "first-repeat"
      ? baseState.answer || baseState.result || "unchanged"
      : baseState.changed || baseState.answer || baseState.result || `updated with ${current}`,
  };
}

function movedWindowState(source: Record<string, unknown>, slot: "first-repeat" | "second-repeat"): Record<string, unknown> {
  const baseState = (source.state && typeof source.state === "object" ? source.state as Record<string, unknown> : source) || {};
  const window = Array.isArray(baseState.window) ? baseState.window.map(Number) : [0, 1];
  const nextWindow = slot === "first-repeat" ? window : [Math.min(window[0] + 1, window[1]), window[1] + 1];
  return { ...baseState, window: nextWindow, active: nextWindow, best: baseState.best || baseState.answer || "saved best" };
}

function bridgeStateForConcept(
  source: Record<string, unknown>,
  concept: string,
  slot: "first-repeat" | "second-repeat",
): Record<string, unknown> | undefined {
  if (["array", "search", "sort"].includes(concept)) return movedArrayState(source, slot);
  if (concept === "sliding-window") return movedWindowState(source, slot);
  return undefined;
}

function topicBridgeStep(
  source: Record<string, unknown>,
  concept: string,
  slot: "first-repeat" | "second-repeat",
): Record<string, unknown> {
  const topicCopy: Record<string, { title: string; body: string; code: string; action: string }> = {
    array: slot === "first-repeat"
      ? { title: "Inspect the active item", body: "Read the highlighted value before deciding whether it changes the answer.", code: "read the highlighted item", action: "inspect" }
      : { title: "Update and move", body: "Save the new state, then move the active index forward.", code: "save the change, then move forward", action: "update" },
    search: slot === "first-repeat"
      ? { title: "Check for a match", body: "Compare the active item with the target or condition.", code: "ask whether the item matches the target", action: "check" }
      : { title: "Move after no match", body: "If this item is not enough, advance to the next candidate.", code: "move to the next item", action: "move" },
    sort: slot === "first-repeat"
      ? { title: "Compare the pair", body: "Only the highlighted pair can swap during this step.", code: "ask whether the left value is greater", action: "compare" }
      : { title: "Place the value", body: "After the move, the value is closer to its sorted position.", code: "swap or keep", action: "place" },
    tuple: slot === "first-repeat"
      ? { title: "Align the index", body: "Use the same position in each collection so related values stay paired.", code: "read matching values at the same index", action: "align" }
      : { title: "Save the pair", body: "Package the related values together before moving to the next index.", code: "save the paired values", action: "pair" },
    matrix: slot === "first-repeat"
      ? { title: "Read row and column", body: "A matrix step needs both coordinates before reading the cell.", code: "read the cell at this row and column", action: "cell" }
      : { title: "Move to the next cell", body: "Advance column or row in a predictable order.", code: "advance row/column", action: "next cell" },
    math: slot === "first-repeat"
      ? { title: "Apply the rule", body: "Use the formula or comparison on the active number.", code: "apply the formula to this value", action: "formula" }
      : { title: "Check the computed result", body: "Compare the computed value with the expected output shape.", code: "return the computed value", action: "check result" },
    "prefix-sum": slot === "first-repeat"
      ? { title: "Add into running total", body: "The current value changes the saved prefix total.", code: "add the current value to the running total", action: "add" }
      : { title: "Save the prefix", body: "Store the total so a later range answer can reuse it.", code: "save the running total at this index", action: "save" },
    intervals: slot === "first-repeat"
      ? { title: "Compare boundaries", body: "The next start is compared with the saved end.", code: "ask whether the next range overlaps", action: "compare" }
      : { title: "Carry merged state", body: "Keep the merged range or start a separate one before moving on.", code: "merge or append", action: "carry" },
    heap: slot === "first-repeat"
      ? { title: "Compare with parent", body: "The inserted value checks whether it outranks its parent.", code: "compare child and parent", action: "compare" }
      : { title: "Bubble or stop", body: "Swap upward only while the heap rule is broken.", code: "swap with parent", action: "bubble" },
    trie: slot === "first-repeat"
      ? { title: "Follow character edge", body: "Each character chooses one branch from the current trie node.", code: "follow the branch for this character", action: "char" }
      : { title: "Mark word state", body: "At the last character, mark or check the word-ending node.", code: "mark this node as a word ending", action: "word" },
    "union-find": slot === "first-repeat"
      ? { title: "Find each leader", body: "Before connecting items, find the group leader for each one.", code: "find the leader for both items", action: "find" }
      : { title: "Union the groups", body: "If the leaders differ, connect one group under the other.", code: "connect one group under the other", action: "union" },
    "dynamic-programming": slot === "first-repeat"
      ? { title: "Read saved cells", body: "A DP cell gets its answer from smaller cells that were already solved.", code: "reuse earlier saved answers", action: "reuse" }
      : { title: "Fill the current cell", body: "Store this small answer so future cells can reuse it.", code: "save the answer for this state", action: "fill" },
    "bit-manipulation": slot === "first-repeat"
      ? { title: "Inspect one bit", body: "Only the highlighted bit decides whether the mask or count changes.", code: "read the current bit", action: "inspect bit" }
      : { title: "Shift to continue", body: "Move to the next bit after saving the current change.", code: "shift to the next bit", action: "shift" },
    conditional: slot === "first-repeat"
      ? { title: "Test the active branch", body: "Use the condition result to decide which branch stays active for this exact input.", code: "if condition is true or false", action: "branch" }
      : { title: "Ignore the other branch", body: "The branch that does not match is skipped, so it should not change the result.", code: "skip the unmatched branch", action: "skip" },
    stack: slot === "first-repeat"
      ? { title: "Check the top only", body: "Stack operations look at the newest item first; older items wait underneath.", code: "read the top item", action: "peek" }
      : { title: "Update after the operation", body: "After push or pop, the top pointer changes to the item now visible.", code: "update top", action: "update top" },
    queue: slot === "first-repeat"
      ? { title: "Check the front", body: "Queue operations serve the oldest item first, even after new items join the back.", code: "read the front item", action: "front" }
      : { title: "Preserve waiting order", body: "The remaining items keep their order after the front item leaves.", code: "remove the front and keep the rest in order", action: "order" },
    "hash-map": slot === "first-repeat"
      ? { title: "Look up before update", body: "Check the table for the key before changing what the table stores.", code: "ask whether this key is already stored", action: "lookup" }
      : { title: "Store for later", body: "After the update, future steps can use the stored key instead of scanning again.", code: "store the value for this key", action: "store" },
    set: slot === "first-repeat"
      ? { title: "Ask membership", body: "The set answers whether this value has already appeared.", code: "ask whether this item is in set memory", action: "check" }
      : { title: "Update memory", body: "Add the value only when the rule says it should be remembered.", code: "add this item to set memory", action: "remember" },
    "linked-list": slot === "first-repeat"
      ? { title: "Save the next link", body: "Before moving a node pointer, notice which next link keeps the chain connected.", code: "save the next link", action: "save next" }
      : { title: "Move current safely", body: "After the next link is known, current can move without losing the rest of the list.", code: "move to the saved next node", action: "move" },
    recursion: slot === "first-repeat"
      ? { title: "Make the smaller call", body: "The current call pauses while a smaller version of the problem runs.", code: "call the smaller version", action: "call" }
      : { title: "Unwind one answer", body: "When the smaller answer returns, this call combines only its own piece.", code: "return the combined answer", action: "unwind" },
    "binary-search": slot === "first-repeat"
      ? { title: "Compare the middle", body: "The middle value decides which half of the sorted range can be ignored.", code: "compare the middle value with the target", action: "compare" }
      : { title: "Shrink the range", body: "Move left or right so the next step searches only possible answers.", code: "keep only the possible half", action: "shrink" },
    "two-pointers": slot === "first-repeat"
      ? { title: "Evaluate the pair", body: "Use the two highlighted values together before moving either pointer.", code: "check left and right", action: "pair check" }
      : { title: "Move one pointer", body: "Only one pointer moves, based on what the comparison proved.", code: "left += 1 or right -= 1", action: "move" },
    "sliding-window": slot === "first-repeat"
      ? { title: "Add entering item", body: "The right edge brings one new value into the window.", code: "add the entering value", action: "enter" }
      : { title: "Remove leaving item", body: "The left edge removes one old value so the window size or rule stays valid.", code: "remove the leaving value", action: "leave" },
    "binary-tree": slot === "first-repeat"
      ? { title: "Choose a child link", body: "The current node comparison tells you whether to follow left or right.", code: "follow the matching child link", action: "follow" }
      : { title: "Use the visited node", body: "Once the target node or leaf is reached, update the result for this path.", code: "update result", action: "visit" },
    graph: slot === "first-repeat"
      ? { title: "Add neighbors", body: "Neighbors enter the frontier only if they have not already been visited.", code: "add unvisited neighbors to the frontier", action: "frontier" }
      : { title: "Skip repeats", body: "Visited memory prevents the same node from being processed again.", code: "skip neighbors already visited", action: "visited" },
  };
  const fallback = slot === "first-repeat"
    ? { title: "Trace the next state", body: "Move one pointer, lookup, branch, or stored value so the repeated pattern is visible.", code: "apply the next step", action: "trace" }
    : { title: "Update the tracked state", body: "Write down what changed before moving toward the final result.", code: "save the changed state", action: "update" };
  return {
    ...source,
    ...(topicCopy[concept] || fallback),
    ...(bridgeStateForConcept(source, concept, slot) ? { state: bridgeStateForConcept(source, concept, slot) } : {}),
    cue: "What changed from the previous visual state?",
  };
}

function deepenAuthoredSteps(
  rawSteps: Array<Record<string, unknown>>,
  concept: string,
  context: GeneratorContext,
): Array<Record<string, unknown>> {
  const target = targetStepCount(concept);
  if (rawSteps.length >= target) return rawSteps.slice(0, Math.max(target, rawSteps.length));
  const expanded = [...rawSteps];
  if (expanded.length < target && !isSetupLike(expanded[0] || {})) expanded.unshift(inferredSetupStep(rawSteps, context));
  if (expanded.length < target && !isFinishLike(expanded[expanded.length - 1] || {})) expanded.push(inferredFinalStep(rawSteps, context));
  while (expanded.length < target) {
    const insertBefore = expanded.findIndex((item, index) => index > 0 && isFinishLike(item));
    const targetIndex = insertBefore > 0 ? insertBefore : Math.max(1, expanded.length - 1);
    const source = expanded[Math.max(0, targetIndex - 1)] || rawSteps[0] || {};
    const bridgeSlot = expanded.length % 2 === 0 ? "first-repeat" : "second-repeat";
    expanded.splice(targetIndex, 0, topicBridgeStep(source, concept, bridgeSlot));
  }
  return expanded.slice(0, target);
}

function shouldUseGeneratedTrace(concept: string, rawSteps: Array<Record<string, unknown>>): boolean {
  const generatedConcepts = new Set([
    "array",
    "conditional",
    "stack",
    "queue",
    "hash-map",
    "set",
    "linked-list",
    "binary-search",
    "two-pointers",
    "sliding-window",
    "recursion",
    "binary-tree",
    "graph",
    "heap",
    "trie",
    "union-find",
    "dynamic-programming",
    "prefix-sum",
    "intervals",
    "bit-manipulation",
    "tuple",
    "math",
    "search",
    "sort",
  ]);
  if (!generatedConcepts.has(concept)) return false;
  if (rawSteps.length >= targetStepCount(concept)) return false;
  if (rawSteps.length < Math.min(targetStepCount(concept), 6)) return true;
  const genericText = rawSteps.map((step) => `${step.title || ""} ${step.body || ""} ${step.action || ""}`).join(" ").toLowerCase();
  return /load the example|set the sample|predict the next state|connect the visual|return only what the prompt asks|movement pattern/.test(genericText);
}

function generateAuthoredVisualizerSteps(concept: string, context: GeneratorContext = {}): Step[] | null {
  const rawAuthoredSteps = context.visualizer?.steps;
  if (!context.useAuthored || !Array.isArray(rawAuthoredSteps) || !rawAuthoredSteps.length) return null;
  const normalizedSteps = rawAuthoredSteps as Array<Record<string, unknown>>;
  if (shouldUseGeneratedTrace(concept, normalizedSteps)) return null;
  const expandedSteps = concept === "conditional"
    ? expandConditionalSteps(normalizedSteps, (context.visualizer?.input || {}) as Record<string, unknown>, context)
    : deepenAuthoredSteps(normalizedSteps, concept, context);
  const authoredSteps = deepenAuthoredSteps(expandedSteps, concept, context);
  const baseState = (context.visualizer?.input || {}) as Record<string, unknown>;
  const workflowLabels = authoredWorkflowLabels(authoredSteps, concept);
  return authoredSteps.map((raw, index) => {
    const rawState = {
      ...baseState,
      ...((raw.state && typeof raw.state === "object") ? raw.state as Record<string, unknown> : {}),
    };
    const displayState = normalizeVisualState(concept, context, rawState);
    const visual = visualForAuthoredStep(concept, displayState, context, index);
    const code = expandPseudocodeLines(visualPseudocodeForStep(concept, context, displayState), concept);
    const activeLine = Math.min(index + 1, code.length);
    const displayedExample = compactVisualInput(context, concept, displayState) || context.exampleInput || String(displayState.sample || "");
    const displayedExpected = visualSampleExpected(context, concept, displayState);
    const description = sanitizeAuthoredCopy(bodyForAuthoredStep(raw.body, context, concept, rawState, index), context, concept, rawState);
    return step({
      concept: concept as Step["concept"],
      title: titleForAuthoredStep(raw.title, context, index),
      description,
      nodes: visual.nodes,
      edges: visual.edges,
      highlights: { nodeIds: visual.highlights, edgeIds: visual.edges.filter((edge) => edge.state === "active").map((edge) => edge.id || `${edge.from}-${edge.to}`), lineNumbers: [activeLine] },
      code,
      activeLine,
      workflow: workflowFromLabels(workflowLabels, index),
      state: {
        ...visibleState(displayState),
        example: displayedExample,
        expected: displayedExpected,
        ...(concept === "conditional" ? { rule: relevantRule(context) } : {}),
      },
    }, index + 1);
  });
}

function arrayStateCard(
  id: string,
  label: string,
  value: string | number,
  x: number,
  y: number,
  state: Node["state"] = "default",
  role = "memory",
): Node {
  return { id, x, y, value, type: "logic-node", label, state, meta: { role } };
}

function arrayCells(
  values: Array<string | number | boolean>,
  activeIndexesValue: number[] = [],
  visitedThrough = -1,
  options: { y?: number; labels?: string[]; startX?: number; gap?: number } = {},
): Node[] {
  const displayValues = values.map((value) => typeof value === "boolean" ? String(value) : value);
  const activeSet = new Set(activeIndexesValue);
  return layoutArray(displayValues as Array<string | number>, {
    y: options.y ?? 230,
    startX: options.startX,
    gap: options.gap,
  }).map((node, nodeIndex) => ({
    ...node,
    label: options.labels?.[nodeIndex] ?? String(nodeIndex),
    state: activeSet.has(nodeIndex) ? "active" as const : nodeIndex <= visitedThrough ? "visited" as const : "default" as const,
  }));
}

function arrayStep(
  index: number,
  phase: {
    title: string;
    desc: string;
    code: string[];
    line: number;
    nodes: Node[];
    edges?: Edge[];
    activeIds?: string[];
    state: Record<string, string | number | boolean>;
  },
  workflowLabels: string[],
): Step {
  const activeIds = phase.activeIds || phase.nodes.filter((node) => node.state === "active" || node.state === "matched").map((node) => node.id);
  const activeCodeLine = phase.code[phase.line - 1] || "";
  const returned = phase.state.returned === true || /\breturn\b/i.test(activeCodeLine);
  return step({
    concept: "array",
    title: phase.title,
    description: phase.desc,
    nodes: phase.nodes,
    edges: phase.edges || [],
    highlights: {
      nodeIds: activeIds,
      edgeIds: (phase.edges || []).filter((edge) => edge.state === "active").map((edge) => edge.id || `${edge.from}-${edge.to}`),
      lineNumbers: [phase.line],
    },
    code: phase.code,
    activeLine: phase.line,
    workflow: workflowFromLabels(workflowLabels, index),
    state: { ...phase.state, returned },
  }, index + 1);
}

export function generateMaximumScoreSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Use the first score as the starting best", "For each score in the list", "If this score is greater than best", "Save this score as the new best", "Return the saved best score"];
  const values = [72, 88, 91, 84];
  const phases = [
    { i: 0, best: "empty", result: "not ready", title: context.title || "Maximum Score", desc: "Load the score list. No best score has been chosen yet.", line: 1 },
    { i: 0, best: "72", result: "not ready", title: "Start with 72", desc: "Use the first score as the starting best value.", line: 1 },
    { i: 1, best: "88", result: "not ready", title: "Update to 88", desc: "88 is greater than 72, so best changes to 88.", line: 4 },
    { i: 2, best: "91", result: "not ready", title: "Update to 91", desc: "91 is greater than 88, so best changes again.", line: 4 },
    { i: 3, best: "91", result: "not ready", title: "Keep 91", desc: "84 is not greater than 91, so best does not change.", line: 3 },
    { i: 3, best: "91", result: "not ready", title: "Finish scan", desc: "Every score has been compared with the saved best.", line: 2 },
    { i: 3, best: "91", result: "91", title: "Return 91", desc: "Return the largest score found in the list.", line: 5 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => arrayStep(index, {
    title: phase.title,
    desc: phase.desc,
    code,
    line: phase.line,
    nodes: [
      ...arrayCells(values, [phase.i], index > 0 ? phase.i : -1),
      arrayStateCard("best-card", "best", phase.best, 340, 385, phase.best !== "empty" ? "active" : "default"),
      arrayStateCard("result-card", "result", phase.result, 585, 385, phase.result === "91" ? "matched" : "default", "result"),
    ],
    activeIds: [`item-${phase.i}`, "best-card", ...(phase.result === "91" ? ["result-card"] : [])],
    state: { example: "[72, 88, 91, 84]", index: phase.i, best: phase.best, result: phase.result, final_result: "91" },
  }, labels));
}

export function generateSumEvenNumbersSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start the total at 0", "For each value in the list", "If the value is even", "Add the value to the total", "Return the total"];
  const values = [1, 2, 3, 4];
  const phases = [
    { i: 0, total: 0, result: "not ready", title: context.title || "Sum Even Numbers", desc: "Start with total at 0 before checking any values.", line: 1 },
    { i: 0, total: 0, result: "not ready", title: "Skip 1", desc: "1 is odd, so it is not added.", line: 3 },
    { i: 1, total: 2, result: "not ready", title: "Add 2", desc: "2 is even, so total changes from 0 to 2.", line: 4 },
    { i: 2, total: 2, result: "not ready", title: "Skip 3", desc: "3 is odd, so total stays 2.", line: 3 },
    { i: 3, total: 6, result: "not ready", title: "Add 4", desc: "4 is even, so total changes from 2 to 6.", line: 4 },
    { i: 3, total: 6, result: "not ready", title: "Finish scan", desc: "All numbers have been checked once.", line: 2 },
    { i: 3, total: 6, result: "6", title: "Return total", desc: "Return the sum of only the even values.", line: 5 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => arrayStep(index, {
    title: phase.title,
    desc: phase.desc,
    code,
    line: phase.line,
    nodes: [
      ...arrayCells(values, [phase.i], phase.i),
      arrayStateCard("total-card", "total", phase.total, 340, 385, "active"),
      arrayStateCard("result-card", "result", phase.result, 585, 385, phase.result === "6" ? "matched" : "default", "result"),
    ],
    activeIds: [`item-${phase.i}`, "total-card", ...(phase.result === "6" ? ["result-card"] : [])],
    state: { example: "[1, 2, 3, 4]", current: values[phase.i], total: phase.total, result: phase.result, final_result: "6" },
  }, labels));
}

export function generateArrayDedupeOrderSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start with an empty seen set", "Start with an empty result list", "For each value in the given values", "If the value has not been seen", "Add the value to the result list", "Add the value to the seen set", "Return the result list"];
  const values = [3, 1, 3, 2];
  const phases = [
    { i: 0, seen: "empty", result: "[]", title: context.title || "Remove Duplicates Keep Order", desc: "Start with empty set memory and an empty result list.", line: 1 },
    { i: 0, seen: "{3}", result: "[3]", title: "Keep 3", desc: "The first 3 is new, so it is kept and remembered.", line: 5 },
    { i: 1, seen: "{3, 1}", result: "[3, 1]", title: "Keep 1", desc: "1 has not appeared before, so append it.", line: 5 },
    { i: 2, seen: "{3, 1}", result: "[3, 1]", title: "Skip duplicate 3", desc: "The second 3 is already in seen, so result does not change.", line: 4 },
    { i: 3, seen: "{3, 1, 2}", result: "[3, 1, 2]", title: "Keep 2", desc: "2 is new, so it becomes the next kept value.", line: 5 },
    { i: 3, seen: "{3, 1, 2}", result: "[3, 1, 2]", title: "Finish scan", desc: "The list has been scanned without changing the original order.", line: 3 },
    { i: 3, seen: "{3, 1, 2}", result: "[3, 1, 2]", title: "Return kept order", desc: "Return only the first occurrence of each value.", line: 7 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => arrayStep(index, {
    title: phase.title,
    desc: phase.desc,
    code,
    line: phase.line,
    nodes: [
      ...arrayCells(values, [phase.i], phase.i),
      arrayStateCard("seen-card", "seen", phase.seen, 300, 385, "active"),
      arrayStateCard("result-card", "result", phase.result, 585, 385, phase.result === "[3, 1, 2]" ? "matched" : "default", "result"),
    ],
    activeIds: [`item-${phase.i}`, "seen-card", "result-card"],
    state: { example: "[3, 1, 3, 2]", seen: phase.seen, result: phase.result, final_result: "[3, 1, 2]" },
  }, labels));
}

export function generateSmallestPositiveSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start without a smallest positive value", "For each value in the list", "If the value is positive", "Keep the smaller positive value", "Return the smallest positive value"];
  const values = [-2, 4, 0, 3];
  const phases = [
    { i: 0, smallest: "empty", result: "not ready", title: context.title || "Smallest Positive", desc: "Start without a saved positive value.", line: 1 },
    { i: 0, smallest: "empty", result: "not ready", title: "Skip -2", desc: "-2 is not positive, so it cannot be the answer.", line: 3 },
    { i: 1, smallest: "4", result: "not ready", title: "Save 4", desc: "4 is the first positive value, so it becomes smallest.", line: 4 },
    { i: 2, smallest: "4", result: "not ready", title: "Skip 0", desc: "0 is not positive, so smallest stays 4.", line: 3 },
    { i: 3, smallest: "3", result: "not ready", title: "Update to 3", desc: "3 is positive and smaller than 4, so smallest changes.", line: 4 },
    { i: 3, smallest: "3", result: "not ready", title: "Finish scan", desc: "Every value has been tested against the positive rule.", line: 2 },
    { i: 3, smallest: "3", result: "3", title: "Return 3", desc: "Return the smallest positive value found.", line: 5 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => arrayStep(index, {
    title: phase.title,
    desc: phase.desc,
    code,
    line: phase.line,
    nodes: [
      ...arrayCells(values, [phase.i], phase.i),
      arrayStateCard("smallest-card", "smallest", phase.smallest, 340, 385, phase.smallest !== "empty" ? "active" : "default"),
      arrayStateCard("result-card", "result", phase.result, 585, 385, phase.result === "3" ? "matched" : "default", "result"),
    ],
    activeIds: [`item-${phase.i}`, "smallest-card", ...(phase.result === "3" ? ["result-card"] : [])],
    state: { example: "[-2, 4, 0, 3]", current: values[phase.i], smallest: phase.smallest, result: phase.result, final_result: "3" },
  }, labels));
}

export function generateFindIndexSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Remember the target value", "Check each index from left to right", "If the current value equals the target", "Return the current index", "Return -1 if no match is found"];
  const values = [5, 7, 9];
  const phases = [
    { i: 0, result: "not found yet", title: context.title || "Find Index", desc: "Start at index 0 and look for target 7.", line: 1 },
    { i: 0, result: "no match", title: "Check index 0", desc: "5 is not 7, so keep scanning.", line: 3 },
    { i: 1, result: "checking", title: "Move to index 1", desc: "The next cell is where the target appears.", line: 2 },
    { i: 1, result: "match", title: "Match 7", desc: "The current value equals the target.", line: 3 },
    { i: 1, result: "1", title: "Return index 1", desc: "Return the index where the target was found.", line: 4 },
    { i: 1, result: "1", title: "Stop early", desc: "The scan stops after the match; index 2 does not need to run.", line: 4 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => arrayStep(index, {
    title: phase.title,
    desc: phase.desc,
    code,
    line: phase.line,
    nodes: [
      ...arrayCells(values, [phase.i], phase.i - 1),
      arrayStateCard("target-card", "target", 7, 300, 385, "default"),
      arrayStateCard("result-card", "result", phase.result, 585, 385, phase.result === "1" ? "matched" : "default", "result"),
    ],
    activeIds: [`item-${phase.i}`, ...(phase.result === "1" || phase.result === "match" ? ["result-card"] : [])],
    state: { example: "[5, 7, 9], target=7", index: phase.i, current: values[phase.i], result: phase.result, final_result: "1" },
  }, labels));
}

export function generateMergeNamesSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start with an empty result list", "Copy each name from the first list", "Add each name from the second list", "Return the merged list"];
  const first = ["Ada"];
  const second = ["Grace", "Katherine"];
  const row = (items: string[], prefix: string, y: number, active: number[] = [], visited = -1) => arrayCells(items, active, visited, { y, startX: prefix === "first" ? 310 : 435, gap: 155 }).map((node) => ({
    ...node,
    id: `${prefix}-${node.id}`,
    label: prefix === "first" ? `first ${node.label}` : `second ${node.label}`,
  }));
  const phases = [
    { source: "first", active: 0, result: "[]", title: context.title || "Merge Names", desc: "Start with an empty result list.", line: 1 },
    { source: "first", active: 0, result: "[Ada]", title: "Copy Ada", desc: "Copy the only name from the first list into result.", line: 2 },
    { source: "second", active: 0, result: "[Ada]", title: "Read Grace", desc: "Now switch to the second list.", line: 3 },
    { source: "second", active: 0, result: "[Ada, Grace]", title: "Append Grace", desc: "Grace is appended after Ada.", line: 3 },
    { source: "second", active: 1, result: "[Ada, Grace]", title: "Read Katherine", desc: "Move to the last name in the second list.", line: 3 },
    { source: "second", active: 1, result: "[Ada, Grace, Katherine]", title: "Append Katherine", desc: "Append the final second-list name.", line: 3 },
    { source: "second", active: 1, result: "[Ada, Grace, Katherine]", title: "Return merged list", desc: "Return one list with first-list names followed by second-list names.", line: 4 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => {
    const activeFirst = phase.source === "first" ? [phase.active] : [];
    const activeSecond = phase.source === "second" ? [phase.active] : [];
    return arrayStep(index, {
      title: phase.title,
      desc: phase.desc,
      code,
      line: phase.line,
      nodes: [
        ...row(first, "first", 185, activeFirst, phase.source === "second" ? 0 : phase.active - 1),
        ...row(second, "second", 300, activeSecond, phase.source === "second" ? phase.active - 1 : -1),
        arrayStateCard("result-card", "result", phase.result, 470, 440, phase.result.includes("Katherine") ? "matched" : "active", "result"),
      ],
      activeIds: [
        ...(phase.source === "first" ? [`first-item-${phase.active}`] : [`second-item-${phase.active}`]),
        "result-card",
      ],
      state: { example: "first=[Ada], second=[Grace, Katherine]", result: phase.result, final_result: "[Ada, Grace, Katherine]" },
    }, labels);
  });
}

export function generateThresholdCountSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start the count at 0", "For each temperature reading", "If the reading is above the threshold", "Add 1 to the count", "Return the count"];
  const values = [70, 82, 81];
  const phases = [
    { i: 0, count: 0, result: "not ready", title: context.title || "Temperature Above Threshold", desc: "Use threshold 80 and start count at 0.", line: 1 },
    { i: 0, count: 0, result: "not ready", title: "Check 70", desc: "70 is not above 80, so count stays 0.", line: 3 },
    { i: 1, count: 1, result: "not ready", title: "Count 82", desc: "82 is above 80, so count changes to 1.", line: 4 },
    { i: 2, count: 2, result: "not ready", title: "Count 81", desc: "81 is also above 80, so count changes to 2.", line: 4 },
    { i: 2, count: 2, result: "not ready", title: "Finish readings", desc: "Each reading has been checked once.", line: 2 },
    { i: 2, count: 2, result: "2", title: "Return count", desc: "Return the number of readings above the threshold.", line: 5 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => arrayStep(index, {
    title: phase.title,
    desc: phase.desc,
    code,
    line: phase.line,
    nodes: [
      ...arrayCells(values, [phase.i], phase.i),
      arrayStateCard("threshold-card", "threshold", 80, 300, 385),
      arrayStateCard("count-card", "count", phase.count, 585, 385, "active"),
    ],
    activeIds: [`item-${phase.i}`, "count-card"],
    state: { example: "[70, 82, 81], threshold=80", current: values[phase.i], count: phase.count, result: phase.result, final_result: "2" },
  }, labels));
}

export function generateTruthyAttendanceSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start the count at 0", "For each attendance value", "If the value is true", "Add 1 to the count", "Return the count"];
  const values = [true, false, true];
  const phases = [
    { i: 0, count: 0, result: "not ready", title: context.title || "Truthy Attendance", desc: "Start count at 0 before reading attendance values.", line: 1 },
    { i: 0, count: 1, result: "not ready", title: "Count true", desc: "The first value is true, so count changes to 1.", line: 4 },
    { i: 1, count: 1, result: "not ready", title: "Skip false", desc: "False does not add to the attendance count.", line: 3 },
    { i: 2, count: 2, result: "not ready", title: "Count true again", desc: "The last value is true, so count changes to 2.", line: 4 },
    { i: 2, count: 2, result: "not ready", title: "Finish attendance", desc: "Every attendance value has been checked.", line: 2 },
    { i: 2, count: 2, result: "2", title: "Return 2", desc: "Return how many values were true.", line: 5 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => arrayStep(index, {
    title: phase.title,
    desc: phase.desc,
    code,
    line: phase.line,
    nodes: [
      ...arrayCells(values, [phase.i], phase.i),
      arrayStateCard("count-card", "count", phase.count, 450, 385, phase.result === "2" ? "matched" : "active", "result"),
    ],
    activeIds: [`item-${phase.i}`, "count-card"],
    state: { example: "[true, false, true]", current: String(values[phase.i]), count: phase.count, result: phase.result, final_result: "2" },
  }, labels));
}

export function generateEveryOtherItemSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start with an empty result list", "Start at index 0", "While the index is inside the list", "Add the current item to the result list", "Move ahead by two indexes", "Return the result list"];
  const values = [10, 20, 30, 40, 50];
  const phases = [
    { i: 0, result: "[]", title: context.title || "Every Other Item", desc: "Start at index 0 and prepare to jump by 2.", line: 2 },
    { i: 0, result: "[10]", title: "Take index 0", desc: "Keep the first item because index 0 is part of the every-other pattern.", line: 4 },
    { i: 2, result: "[10]", title: "Jump to index 2", desc: "Skip index 1 and move directly to index 2.", line: 5 },
    { i: 2, result: "[10, 30]", title: "Take index 2", desc: "Keep 30 as the next every-other item.", line: 4 },
    { i: 4, result: "[10, 30]", title: "Jump to index 4", desc: "Skip index 3 and move to the last valid every-other index.", line: 5 },
    { i: 4, result: "[10, 30, 50]", title: "Take index 4", desc: "Keep 50 as the last selected item.", line: 4 },
    { i: 4, result: "[10, 30, 50]", title: "Return result", desc: "Return the values from indexes 0, 2, and 4.", line: 6 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => arrayStep(index, {
    title: phase.title,
    desc: phase.desc,
    code,
    line: phase.line,
    nodes: [
      ...arrayCells(values, [phase.i], phase.i),
      arrayStateCard("result-card", "result", phase.result, 450, 385, phase.result === "[10, 30, 50]" ? "matched" : "active", "result"),
    ],
    activeIds: [`item-${phase.i}`, "result-card"],
    state: { example: "[10, 20, 30, 40, 50]", index: phase.i, result: phase.result, final_result: "[10, 30, 50]" },
  }, labels));
}

export function generateComfortCountSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start the count at 0", "For each temperature reading", "If the reading is inside the comfort range", "Add 1 to the count", "Return the count"];
  const values = [68, 72, 80];
  const phases = [
    { i: 0, count: 0, result: "not ready", title: context.title || "Temperature Comfort Count", desc: "Comfort means between 70 and 78 inclusive.", line: 1 },
    { i: 0, count: 0, result: "not ready", title: "Skip 68", desc: "68 is below 70, so it is not comfortable.", line: 3 },
    { i: 1, count: 1, result: "not ready", title: "Count 72", desc: "72 is inside the comfort range, so count changes to 1.", line: 4 },
    { i: 2, count: 1, result: "not ready", title: "Skip 80", desc: "80 is above 78, so count stays 1.", line: 3 },
    { i: 2, count: 1, result: "not ready", title: "Finish readings", desc: "Every temperature has been checked against both bounds.", line: 2 },
    { i: 2, count: 1, result: "1", title: "Return 1", desc: "Return the number of comfortable readings.", line: 5 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => arrayStep(index, {
    title: phase.title,
    desc: phase.desc,
    code,
    line: phase.line,
    nodes: [
      ...arrayCells(values, [phase.i], phase.i),
      arrayStateCard("range-card", "range", "70 to 78", 300, 385),
      arrayStateCard("count-card", "count", phase.count, 585, 385, phase.result === "1" ? "matched" : "active", "result"),
    ],
    activeIds: [`item-${phase.i}`, "count-card"],
    state: { example: "[68, 72, 80], low=70, high=78", current: values[phase.i], count: phase.count, result: phase.result, final_result: "1" },
  }, labels));
}

export function generatePlantCareDaysSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start with an empty care-days list", "Check each reading with its matching day", "If the reading is below the threshold", "Add the matching day to care days", "Return the care-days list"];
  const readings = [20, 55, 30];
  const days = ["Mon", "Tue", "Wed"];
  const phases = [
    { i: 0, result: "[]", title: context.title || "Weekly Plant Care Days", desc: "Align each reading with the day at the same index.", line: 1 },
    { i: 0, result: "[Mon]", title: "Keep Mon", desc: "20 is below 35, so Monday is a care day.", line: 4 },
    { i: 1, result: "[Mon]", title: "Read Tue", desc: "Move to Tuesday and check its reading.", line: 2 },
    { i: 1, result: "[Mon]", title: "Skip Tue", desc: "55 is not below 35, so Tuesday is not kept.", line: 3 },
    { i: 2, result: "[Mon]", title: "Read Wed", desc: "Move to Wednesday and check its reading.", line: 2 },
    { i: 2, result: "[Mon, Wed]", title: "Keep Wed", desc: "30 is below 35, so Wednesday is kept.", line: 4 },
    { i: 2, result: "[Mon, Wed]", title: "Return care days", desc: "Return only days whose matching reading is below the threshold.", line: 5 },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => {
    const dayNodes = arrayCells(days, [phase.i], phase.i, { y: 180, startX: 300, gap: 145 }).map((node) => ({ ...node, id: `day-${node.id}`, label: `day ${node.label}` }));
    const readingNodes = arrayCells(readings, [phase.i], phase.i, { y: 295, startX: 300, gap: 145 }).map((node) => ({ ...node, id: `reading-${node.id}`, label: `reading ${node.label}` }));
    return arrayStep(index, {
      title: phase.title,
      desc: phase.desc,
      code,
      line: phase.line,
      nodes: [
        ...dayNodes,
        ...readingNodes,
        arrayStateCard("threshold-card", "threshold", 35, 255, 445),
        arrayStateCard("result-card", "care days", phase.result, 560, 445, phase.result === "[Mon, Wed]" ? "matched" : "active", "result"),
      ],
      edges: [{ id: "day-reading", from: `day-item-${phase.i}`, to: `reading-item-${phase.i}`, type: "pointer", state: "active" }],
      activeIds: [`day-item-${phase.i}`, `reading-item-${phase.i}`, "result-card"],
      state: { example: "readings=[20, 55, 30], days=[Mon, Tue, Wed]", threshold: 35, result: phase.result, final_result: "[Mon, Wed]" },
    }, labels);
  });
}

export function generateArrayDedupeSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "Start with an empty seen set",
    "Start with an empty result list",
    "Read the current item",
    "If the item has not been seen",
    "Add it to result and remember it",
    "Move to the next index",
    "Return the result list",
  ];
  const values = [3, 1, 3, 2];
  const phases = [
    { index: 0, seen: "", result: "[]", title: context.title || "Remove duplicates", desc: "Start with an empty result and empty set memory.", line: 1 },
    { index: 0, seen: "3", result: "[3]", title: "Keep first 3", desc: "3 is new, so it is added to result and remembered.", line: 5 },
    { index: 1, seen: "3, 1", result: "[3, 1]", title: "Keep 1", desc: "1 has not appeared before, so it also joins the result.", line: 5 },
    { index: 2, seen: "3, 1", result: "[3, 1]", title: "Skip repeated 3", desc: "The set already contains 3, so the result does not change.", line: 4 },
    { index: 3, seen: "3, 1, 2", result: "[3, 1, 2]", title: "Keep 2", desc: "2 is new, so it becomes the last kept value.", line: 5 },
    { index: 3, seen: "3, 1, 2", result: "[3, 1, 2]", title: "Return unique order", desc: "The result keeps the first copy of each value in the original order.", line: 7 },
  ];
  return phases.map((phase, index) => step({
    concept: "array",
    title: phase.title,
    description: phase.desc,
    nodes: layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      label: nodeIndex === phase.index ? "current item" : String(nodeIndex),
      state: nodeIndex === phase.index ? "active" : nodeIndex < phase.index ? "visited" : "default",
    })),
    edges: [],
    highlights: { nodeIds: [`item-${phase.index}`], lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(phases.map((item) => item.title), index),
    state: { example: "[3, 1, 3, 2]", index: phase.index, current: values[phase.index], seen: phase.seen || "empty", result: phase.result, final_result: "[3, 1, 2]" },
  }, index + 1));
}

export function generateArrayFilterSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start with an empty result list", "Read the current item", "If the item passes the rule", "Add the item to the result list", "Move to the next index", "Return the result list"];
  const values = [3, 8, 2, 6];
  const phases = [
    { index: 0, result: "[]", title: context.title || "Filter values", desc: "Start with an empty result and one rule to test.", line: 1 },
    { index: 0, result: "[]", title: "Check 3", desc: "3 does not pass this teaching rule, so result stays empty.", line: 3 },
    { index: 1, result: "[8]", title: "Keep 8", desc: "8 passes the rule, so append it to the result.", line: 4 },
    { index: 2, result: "[8]", title: "Skip 2", desc: "2 fails the rule, so the scan moves on without changing result.", line: 3 },
    { index: 3, result: "[8, 6]", title: "Keep 6", desc: "6 passes and becomes the next saved value.", line: 4 },
    { index: 3, result: "[8, 6]", title: "Return filtered result", desc: "The final answer is the kept values, not the full input.", line: 6 },
  ];
  return phases.map((phase, index) => step({
    concept: "array",
    title: phase.title,
    description: phase.desc,
    nodes: layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      label: nodeIndex === phase.index ? "current item" : String(nodeIndex),
      state: nodeIndex === phase.index ? "active" : nodeIndex < phase.index ? "visited" : "default",
    })),
    edges: [],
    highlights: { nodeIds: [`item-${phase.index}`], lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(phases.map((item) => item.title), index),
    state: { example: "[3, 8, 2, 6]", index: phase.index, current: values[phase.index], result: phase.result, final_result: "[8, 6]" },
  }, index + 1));
}

export function generateArrayRunningTotalSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Start the total at 0", "Read the current item", "Add the item to the total", "Save the new total in the result list", "Move to the next index", "Return the result list"];
  const values = [2, 4, 1];
  const phases = [
    { index: 0, total: 0, result: "[]", title: context.title || "Running total", desc: "Start before reading the first value.", line: 1 },
    { index: 0, total: 2, result: "[2]", title: "Add 2", desc: "The total changes from 0 to 2, then saves the first prefix.", line: 3 },
    { index: 1, total: 6, result: "[2, 6]", title: "Add 4", desc: "Add the next value to the saved total instead of starting over.", line: 3 },
    { index: 2, total: 7, result: "[2, 6, 7]", title: "Add 1", desc: "The last value updates the total one more time.", line: 3 },
    { index: 2, total: 7, result: "[2, 6, 7]", title: "Save final prefix", desc: "Each position now stores the sum up to that position.", line: 4 },
    { index: 2, total: 7, result: "[2, 6, 7]", title: "Return totals", desc: "Return the list of saved totals.", line: 6 },
  ];
  return phases.map((phase, index) => step({
    concept: "array",
    title: phase.title,
    description: phase.desc,
    nodes: layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex === phase.index ? "active" : nodeIndex < phase.index ? "visited" : "default",
    })),
    edges: [],
    highlights: { nodeIds: [`item-${phase.index}`], lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(phases.map((item) => item.title), index),
    state: { example: "[2, 4, 1]", index: phase.index, current: values[phase.index], total: phase.total, result: phase.result, final_result: "[2, 6, 7]" },
  }, index + 1));
}

export function generateArraySearchSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Remember the target value", "Read the current item", "If the item matches the target", "Return the current index", "Move to the next index", "Return -1 if no match is found"];
  const values = [8, 3, 6];
  const phases = [
    { index: 0, title: context.title || "Find a value", desc: "Start at index 0 and look for the target 6.", line: 1, answer: "not found yet" },
    { index: 0, title: "Check 8", desc: "8 is not the target, so keep searching.", line: 3, answer: "no match" },
    { index: 1, title: "Move to index 1", desc: "The scan advances one cell after no match.", line: 5, answer: "no match" },
    { index: 1, title: "Check 3", desc: "3 is not the target either.", line: 3, answer: "no match" },
    { index: 2, title: "Check 6", desc: "6 matches the target, so the search can stop here.", line: 3, answer: "match at 2" },
    { index: 2, title: "Return index 2", desc: "The answer is the position where the target was found.", line: 4, answer: "2" },
  ];
  return phases.map((phase, index) => step({
    concept: "array",
    title: phase.title,
    description: phase.desc,
    nodes: layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex === phase.index ? "active" : nodeIndex < phase.index ? "visited" : "default",
    })),
    edges: [],
    highlights: { nodeIds: [`item-${phase.index}`], lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(phases.map((item) => item.title), index),
    state: { example: "[8, 3, 6], target=6", index: phase.index, current: values[phase.index], target: 6, result: phase.answer, final_result: "2" },
  }, index + 1));
}

export function generateArrayMaxMinSteps(context: GeneratorContext = {}): Step[] {
  const code = ["Use the first value as the starting best", "Read the current item", "If the item is better than best", "Save the item as the new best", "Move to the next index", "Return the saved best value"];
  const values = [4, 9, 2];
  const phases = [
    { index: 0, best: 4, title: context.title || "Track best value", desc: "Initialize best from the first value.", line: 1 },
    { index: 0, best: 4, title: "Compare 4", desc: "The first item equals best, so nothing changes.", line: 3 },
    { index: 1, best: 4, title: "Read 9", desc: "Move to the next item and compare it with the saved best.", line: 2 },
    { index: 1, best: 9, title: "Update best", desc: "9 is larger than 4, so best changes to 9.", line: 4 },
    { index: 2, best: 9, title: "Check 2", desc: "2 is not larger than 9, so the saved best stays put.", line: 3 },
    { index: 2, best: 9, title: "Return best", desc: "After every item has been checked, return the saved best value.", line: 6 },
  ];
  return phases.map((phase, index) => step({
    concept: "array",
    title: phase.title,
    description: phase.desc,
    nodes: layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex === phase.index ? "active" : nodeIndex < phase.index ? "visited" : "default",
    })),
    edges: [],
    highlights: { nodeIds: [`item-${phase.index}`], lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(phases.map((item) => item.title), index),
    state: { example: "[4, 9, 2]", index: phase.index, current: values[phase.index], best: phase.best, final_result: "9" },
  }, index + 1));
}

type StringVisualPhase = {
  active: number[];
  visited?: number[];
  title: string;
  desc: string;
  line: number;
  result: string;
  state?: Record<string, string | number | boolean>;
};

function stringTokenNodes(
  tokens: string[],
  phase: StringVisualPhase,
  tokenKind: "char" | "word" = "char",
): Node[] {
  const gap = tokenKind === "word" ? 150 : 76;
  const width = Math.max((tokens.length - 1) * gap, 0);
  const startX = 450 - width / 2;
  const active = new Set(phase.active);
  const visited = new Set(phase.visited || []);
  return tokens.map((token, index) => ({
    id: `char-${index}`,
    x: startX + index * gap,
    y: 250,
    value: token === " " ? "space" : token,
    type: "array-cell",
    label: tokenKind === "word" ? `word ${index}` : String(index),
    state: active.has(index) ? "active" as const : visited.has(index) ? "visited" as const : "default" as const,
    meta: { role: "string-cell", tokenKind },
  }));
}

function buildStringVisualSteps({
  context,
  sample,
  tokens,
  code,
  phases,
  tokenKind = "char",
  expected,
}: {
  context: GeneratorContext;
  sample: string;
  tokens: string[];
  code: string[];
  phases: StringVisualPhase[];
  tokenKind?: "char" | "word";
  expected: string;
}): Step[] {
  return phases.map((phase, index) => {
    const nodes = stringTokenNodes(tokens, phase, tokenKind);
    nodes.push({
      id: "string-result",
      x: 620,
      y: 385,
      value: phase.result || "not changed yet",
      type: "logic-node",
      label: index === phases.length - 1 ? "final result" : "result so far",
      state: index === phases.length - 1 ? "matched" : phase.result && phase.result !== "not changed yet" ? "active" : "default",
      meta: { role: "result" },
    });
    return step({
      concept: "array",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: phase.active.map((itemIndex) => `char-${itemIndex}`), lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: {
        example: sample,
        index: phase.active.join(", "),
        result: phase.result,
        expected,
        final_result: expected,
        returned: index === phases.length - 1,
        ...(phase.state || {}),
      },
    }, index + 1);
  });
}

export function generateStringScanSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("array", context);

  if (family === "string-reverse-words") {
    return buildStringVisualSteps({
      context,
      sample: "red blue",
      tokens: ["red", "blue"],
      tokenKind: "word",
      expected: "blue red",
      code: [
        "split the sentence into words",
        "read the last word first",
        "add it to the result sentence",
        "read the previous word",
        "add it after the first result word",
        "return the reversed sentence",
      ],
      phases: [
        { active: [0, 1], title: context.title || "Split words", desc: "The sentence becomes two word pieces: red and blue.", line: 1, result: "not changed yet", state: { words: "[red, blue]", result_sentence: "" } },
        { active: [1], visited: [1], title: "Read blue", desc: "Start from the last word because the output is reversed.", line: 2, result: "blue", state: { result_sentence: "blue" } },
        { active: [1], visited: [1], title: "Add blue", desc: "blue becomes the first word in the result.", line: 3, result: "blue", state: { result_sentence: "blue" } },
        { active: [0], visited: [1], title: "Read red", desc: "Move left to the remaining word.", line: 4, result: "blue", state: { result_sentence: "blue" } },
        { active: [0], visited: [0, 1], title: "Add red", desc: "Add red after blue.", line: 5, result: "blue red", state: { result_sentence: "blue red" } },
        { active: [0, 1], visited: [0, 1], title: "Return blue red", desc: "Every word has moved into reversed order.", line: 6, result: "blue red", state: { result_sentence: "blue red" } },
      ],
    });
  }

  if (family === "string-palindrome") {
    return buildStringVisualSteps({
      context,
      sample: "level",
      tokens: [..."level"],
      expected: "true",
      code: [
        "place one pointer at each end",
        "compare the two outside letters",
        "move both pointers inward after a match",
        "compare the next pair",
        "stop when the pointers meet",
        "return true because no mismatch was found",
      ],
      phases: [
        { active: [0, 4], title: context.title || "Compare l and l", desc: "The first and last letters match.", line: 2, result: "match", state: { left: 0, right: 4, status: "match" } },
        { active: [1, 3], visited: [0, 4], title: "Move inward", desc: "Both pointers move toward the middle.", line: 3, result: "match", state: { left: 1, right: 3, status: "match" } },
        { active: [1, 3], visited: [0, 1, 3, 4], title: "Compare e and e", desc: "The next pair also matches.", line: 4, result: "match", state: { left: 1, right: 3, status: "match" } },
        { active: [2], visited: [0, 1, 3, 4], title: "Reach middle", desc: "The middle v has no partner left to check.", line: 5, result: "still true", state: { left: 2, right: 2, status: "no mismatch" } },
        { active: [0, 1, 2, 3, 4], visited: [0, 1, 2, 3, 4], title: "Return true", desc: "No compared pair was different.", line: 6, result: "true", state: { status: "palindrome" } },
      ],
    });
  }

  if (family === "string-count-words") {
    return buildStringVisualSteps({
      context,
      sample: "red blue",
      tokens: ["red", "blue"],
      tokenKind: "word",
      expected: "2",
      code: [
        "start word count at zero",
        "read the next word",
        "if the word is not empty, increase count",
        "move to the next word",
        "stop after the last word",
        "return the word count",
      ],
      phases: [
        { active: [0], title: context.title || "Read red", desc: "red is a word, so the count increases.", line: 2, result: "count = 1", state: { count: 1 } },
        { active: [1], visited: [0], title: "Move to blue", desc: "The scan moves to the next word.", line: 4, result: "count = 1", state: { count: 1 } },
        { active: [1], visited: [0, 1], title: "Count blue", desc: "blue is another word, so the count becomes 2.", line: 3, result: "count = 2", state: { count: 2 } },
        { active: [1], visited: [0, 1], title: "Finish words", desc: "There are no more words to read.", line: 5, result: "count = 2", state: { count: 2 } },
        { active: [0, 1], visited: [0, 1], title: "Return 2", desc: "The sentence has two words.", line: 6, result: "2", state: { count: 2 } },
      ],
    });
  }

  if (family === "string-course-code") {
    return buildStringVisualSteps({
      context,
      sample: "COSC 352",
      tokens: [..."COSC 352"],
      expected: "true",
      code: [
        "read the department letters",
        "check that there are four uppercase letters",
        "skip the separating space",
        "read the course number",
        "check that there are three digits",
        "return whether the shape is valid",
      ],
      phases: [
        { active: [0, 1, 2, 3], title: context.title || "Read COSC", desc: "The first part should be four department letters.", line: 1, result: "letters found", state: { letters: "COSC", digits: "" } },
        { active: [0, 1, 2, 3], visited: [0, 1, 2, 3], title: "Letters valid", desc: "COSC has four uppercase letters.", line: 2, result: "letters ok", state: { letters: "COSC", digits: "", shape: "letters ok" } },
        { active: [4], visited: [0, 1, 2, 3], title: "Skip space", desc: "The space separates the subject from the number.", line: 3, result: "shape still ok", state: { letters: "COSC", digits: "", shape: "space ok" } },
        { active: [5, 6, 7], visited: [0, 1, 2, 3, 4], title: "Read 352", desc: "The last part should be the course number.", line: 4, result: "digits found", state: { letters: "COSC", digits: "352" } },
        { active: [5, 6, 7], visited: [0, 1, 2, 3, 4, 5, 6, 7], title: "Digits valid", desc: "352 has three digits.", line: 5, result: "shape valid", state: { letters: "COSC", digits: "352", shape: "valid" } },
        { active: [0, 1, 2, 3, 5, 6, 7], visited: [0, 1, 2, 3, 4, 5, 6, 7], title: "Return true", desc: "The code matches the expected course-code shape.", line: 6, result: "true", state: { shape: "valid" } },
      ],
    });
  }

  if (family === "string-initials") {
    return buildStringVisualSteps({
      context,
      sample: "Ada Lovelace",
      tokens: ["Ada", "Lovelace"],
      tokenKind: "word",
      expected: "AL",
      code: [
        "split the full name into words",
        "read the first name",
        "take its first letter",
        "read the last name",
        "take its first letter",
        "return the initials",
      ],
      phases: [
        { active: [0, 1], title: context.title || "Split name", desc: "The full name becomes first and last name parts.", line: 1, result: "not changed yet", state: { initials: "" } },
        { active: [0], title: "Read Ada", desc: "The first word is Ada.", line: 2, result: "not changed yet", state: { initials: "" } },
        { active: [0], visited: [0], title: "Take A", desc: "The first letter of Ada is A.", line: 3, result: "A", state: { initials: "A" } },
        { active: [1], visited: [0], title: "Read Lovelace", desc: "Move to the last name.", line: 4, result: "A", state: { initials: "A" } },
        { active: [1], visited: [0, 1], title: "Take L", desc: "The first letter of Lovelace is L.", line: 5, result: "AL", state: { initials: "AL" } },
        { active: [0, 1], visited: [0, 1], title: "Return AL", desc: "Join the first letters in order.", line: 6, result: "AL", state: { initials: "AL" } },
      ],
    });
  }

  if (family === "string-normalize-emails") {
    return buildStringVisualSteps({
      context,
      sample: "emails=[Ada@MSU.edu, ada@msu.edu, Bo@MSU.edu]",
      tokens: ["Ada@MSU.edu", "ada@msu.edu", "Bo@MSU.edu"],
      tokenKind: "word",
      expected: "[ada@msu.edu, bo@msu.edu]",
      code: [
        "start with an empty cleaned list",
        "read the next email",
        "make it lowercase",
        "if it is new, keep it",
        "skip duplicates",
        "return the cleaned list",
      ],
      phases: [
        { active: [0], title: context.title || "Read first email", desc: "Start with Ada@MSU.edu.", line: 2, result: "not changed yet", state: { cleaned: "[]" } },
        { active: [0], visited: [0], title: "Lowercase first email", desc: "Ada@MSU.edu becomes ada@msu.edu.", line: 3, result: "[ada@msu.edu]", state: { cleaned: "[ada@msu.edu]" } },
        { active: [1], visited: [0], title: "Read duplicate", desc: "The next email normalizes to the same value.", line: 2, result: "[ada@msu.edu]", state: { cleaned: "[ada@msu.edu]" } },
        { active: [1], visited: [0, 1], title: "Skip duplicate", desc: "ada@msu.edu is already in the cleaned list.", line: 5, result: "[ada@msu.edu]", state: { cleaned: "[ada@msu.edu]" } },
        { active: [2], visited: [0, 1], title: "Read Bo email", desc: "Bo@MSU.edu is a different address after lowercasing.", line: 2, result: "[ada@msu.edu]", state: { cleaned: "[ada@msu.edu]" } },
        { active: [2], visited: [0, 1, 2], title: "Keep bo email", desc: "bo@msu.edu is new, so it is added.", line: 4, result: "[ada@msu.edu, bo@msu.edu]", state: { cleaned: "[ada@msu.edu, bo@msu.edu]" } },
        { active: [0, 1, 2], visited: [0, 1, 2], title: "Return cleaned list", desc: "The result keeps one normalized copy of each email.", line: 6, result: "[ada@msu.edu, bo@msu.edu]" },
      ],
    });
  }

  if (family === "string-prefix-search") {
    return buildStringVisualSteps({
      context,
      sample: "words=[code, card, car], prefix=ca",
      tokens: ["code", "card", "car"],
      tokenKind: "word",
      expected: "[card, car]",
      code: [
        "read the prefix ca",
        "check the next word",
        "if the word starts with ca, keep it",
        "otherwise skip it",
        "move to the next word",
        "return matching words",
      ],
      phases: [
        { active: [0], title: context.title || "Check code", desc: "code starts with co, not ca.", line: 2, result: "[]", state: { prefix: "ca", matches: "[]" } },
        { active: [0], visited: [0], title: "Skip code", desc: "code does not match the prefix.", line: 4, result: "[]", state: { prefix: "ca", matches: "[]" } },
        { active: [1], visited: [0], title: "Check card", desc: "card starts with ca.", line: 2, result: "[]", state: { prefix: "ca", matches: "[]" } },
        { active: [1], visited: [0, 1], title: "Keep card", desc: "Add card to the matching words.", line: 3, result: "[card]", state: { prefix: "ca", matches: "[card]" } },
        { active: [2], visited: [0, 1], title: "Check car", desc: "car also starts with ca.", line: 2, result: "[card]", state: { prefix: "ca", matches: "[card]" } },
        { active: [2], visited: [0, 1, 2], title: "Keep car", desc: "Add car to the matching words.", line: 3, result: "[card, car]", state: { prefix: "ca", matches: "[card, car]" } },
        { active: [1, 2], visited: [0, 1, 2], title: "Return matches", desc: "Only the words with the prefix ca are returned.", line: 6, result: "[card, car]", state: { prefix: "ca", matches: "[card, car]" } },
      ],
    });
  }

  return buildStringVisualSteps({
    context,
    sample: "Code",
    tokens: [..."Code"],
    expected: "2",
    code: [
      "start vowel count at zero",
      "read the next character",
      "make the character lowercase",
      "if it is a vowel, increase count",
      "move to the next character",
      "return the vowel count",
    ],
    phases: [
      { active: [0], title: context.title || "Read C", desc: "C becomes c, and c is not a vowel.", line: 2, result: "count = 0", state: { count: 0, normalized: "c" } },
      { active: [1], visited: [0], title: "Read o", desc: "o is a vowel, so the count increases.", line: 4, result: "count = 1", state: { count: 1, normalized: "o" } },
      { active: [2], visited: [0, 1], title: "Read d", desc: "d is not a vowel, so the count stays the same.", line: 4, result: "count = 1", state: { count: 1, normalized: "d" } },
      { active: [3], visited: [0, 1, 2], title: "Read e", desc: "e is a vowel, so the count increases again.", line: 4, result: "count = 2", state: { count: 2, normalized: "e" } },
      { active: [3], visited: [0, 1, 2, 3], title: "Finish scan", desc: "The scan stops after the last character.", line: 5, result: "count = 2", state: { count: 2 } },
      { active: [0, 1, 2, 3], visited: [0, 1, 2, 3], title: "Return 2", desc: "Return the saved vowel count.", line: 6, result: "2", state: { count: 2 } },
    ],
  });
}

export function generateStringRunCompressSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "start with an empty compressed result",
    "start the first character run",
    "count how many times the run repeats",
    "if the next character matches, grow the run",
    "when the character changes, save the finished run",
    "return the compressed text",
  ];
  const chars = ["a", "a", "a", "b", "b", "c"];
  const phases = [
    { active: [0], run: [0], current: "a", count: 1, output: "", title: context.title || "Start the first run", desc: "The first a starts a run with count 1.", line: 2 },
    { active: [1], run: [0, 1], current: "a", count: 2, output: "", title: "Read another a", desc: "The next character matches current, so the same run grows to 2.", line: 4 },
    { active: [2], run: [0, 1, 2], current: "a", count: 3, output: "", title: "Grow a to 3", desc: "A third a still matches, so count becomes 3.", line: 4 },
    { active: [3], run: [3], current: "b", count: 1, output: "a3", title: "Emit a3", desc: "b starts a new run, so the finished a run is saved as a3.", line: 5 },
    { active: [4], run: [3, 4], current: "b", count: 2, output: "a3", title: "Grow b to 2", desc: "The second b matches the current run, so count becomes 2.", line: 4 },
    { active: [5], run: [5], current: "c", count: 1, output: "a3b2", title: "Emit b2", desc: "c starts a new run, so b2 is saved before counting c.", line: 5 },
    { active: [5], run: [5], current: "c", count: 1, output: "a3b2c1", title: "Return a3b2c1", desc: "The final c run is saved with count 1, then the pieces join together.", line: 6 },
  ];
  return phases.map((phase, index) => {
    const nodes = stringTokenNodes(chars, { ...phase, active: phase.active, visited: phase.run }, "char").map((node, nodeIndex) => ({
      ...node,
      label: phase.active.includes(nodeIndex) ? "current char" : String(nodeIndex),
      state: phase.active.includes(nodeIndex) ? "active" as const : phase.run.includes(nodeIndex) ? "visited" as const : "default" as const,
    }));
    nodes.push(
      { id: "run-card", x: 315, y: 345, value: `${phase.current} x ${phase.count}`, type: "logic-node", label: "current run", state: "active", meta: { role: "memory" } },
      { id: "output-card", x: 600, y: 345, value: phase.output || "empty", type: "logic-node", label: "compressed output", state: phase.output ? "matched" : "default", meta: { role: "result" } },
    );
    const edges: Edge[] = [
      { id: "char-run", from: `char-${phase.active[0]}`, to: "run-card", type: "pointer", state: "active" },
      { id: "run-output", from: "run-card", to: "output-card", type: "pointer", state: phase.output ? "active" : "default" },
    ];
    return step({
      concept: "array",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges,
      highlights: { nodeIds: [`char-${phase.active[0]}`, "run-card", ...(phase.output ? ["output-card"] : [])], edgeIds: edges.filter((edge) => edge.state === "active").map((edge) => edge.id || ""), lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: {
        example: "aaabbc",
        text: "aaabbc",
        index: phase.active.join(", "),
        current_run: `${phase.current} x ${phase.count}`,
        output: phase.output || "empty",
        expected: "a3b2c1",
        final_result: "a3b2c1",
        returned: index === phases.length - 1,
      },
    }, index + 1);
  });
}

export function generateArraySwapSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "left, right = 0, 1",
    "if values[left] > values[right]:",
    "values[left], values[right] = values[right], values[left]",
    "left += 1; right += 1",
  ];
  const startValues = [8, 3, 6, 2, 5];
  const start = layoutArray(startValues);
  const comparing = withNodeState(start, ["item-0", "item-1"], "comparing");
  const swapped = layoutArray([3, 8, 6, 2, 5]).map((node) => (
    node.id === "item-0" || node.id === "item-1" ? { ...node, state: "active" as const } : node
  ));
  const nextPair = withNodeState(swapped, ["item-1", "item-2"], "comparing");
  const secondSwap = layoutArray([3, 6, 8, 2, 5]).map((node) => (
    node.id === "item-1" || node.id === "item-2" ? { ...node, state: "active" as const } : node
  ));
  const afterMove = withNodeState(secondSwap, ["item-2", "item-3"], "comparing");

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
    step({
      concept: "array",
      title: "Repeat the same rule",
      description: "8 is still bigger than 6, so the same swap rule applies one more time.",
      nodes: secondSwap,
      edges: [],
      highlights: { nodeIds: ["item-1", "item-2"], lineNumbers: [2, 3] },
      code,
      activeLine: 3,
      state: { swapped: "8 with 6" },
    }, 5),
    step({
      concept: "array",
      title: "Keep scanning toward the result",
      description: "The important idea is not the first swap; it is repeating compare, update, and move until the pass is done.",
      nodes: afterMove,
      edges: [],
      highlights: { nodeIds: ["item-2", "item-3"], lineNumbers: [4] },
      code,
      activeLine: 4,
      state: { next: "compare 8 and 2" },
    }, 6),
    step({
      concept: "array",
      title: "Return the updated list",
      description: "The trace ends only after the list state matches the result the prompt asks for.",
      nodes: withNodeState(secondSwap, ["item-0", "item-1", "item-2"], "visited"),
      edges: [],
      highlights: { nodeIds: ["item-0", "item-1", "item-2"], lineNumbers: [4] },
      code: [...code, "return values"],
      activeLine: 5,
      state: { result: "[3, 6, 8, 2, 5]" },
    }, 7),
  ];
}

export function generateArrayRotationSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "Keep k inside the list length",
    "Find where the last k items begin",
    "Take the tail section",
    "Keep the head section",
    "Place the tail before the head",
    "Return the rotated list",
  ];
  const original = [1, 2, 3, 4];
  const rotated = [3, 4, 1, 2];
  const mark = (values: number[], activeIds: string[], state: "active" | "visited" | "comparing" = "active") => withNodeState(layoutArray(values), activeIds, state);
  const phases = [
    {
      values: original,
      active: ["item-0", "item-1", "item-2", "item-3"],
      title: context.title || "Rotate list right",
      desc: "Start with a small teaching list and k = 2 so the wraparound is visible.",
      line: 1,
      state: { list: "[1, 2, 3, 4]", k: 2 },
    },
    {
      values: original,
      active: ["item-0", "item-1", "item-2", "item-3"],
      title: "Normalize k",
      desc: "k stays 2 because rotating a length-4 list right by 2 is already inside the list length.",
      line: 1,
      state: { length: 4, k: 2 },
    },
    {
      values: original,
      active: ["item-2"],
      title: "Find the split point",
      desc: "The last k values will move to the front. Here the split happens before index 2.",
      line: 2,
      state: { split_index: 2 },
    },
    {
      values: original,
      active: ["item-2", "item-3"],
      title: "Take the tail",
      desc: "The tail [3, 4] is the part that wraps around to the front.",
      line: 3,
      state: { tail: "[3, 4]" },
    },
    {
      values: original,
      active: ["item-0", "item-1"],
      title: "Keep the head",
      desc: "The head [1, 2] keeps its order, but it moves behind the tail.",
      line: 4,
      state: { head: "[1, 2]" },
    },
    {
      values: [3, 4, 1, 2],
      active: ["item-0", "item-1"],
      title: "Tail moves first",
      desc: "The wrapped tail becomes the first part of the new list.",
      line: 5,
      state: { rotated_start: "[3, 4]" },
    },
    {
      values: rotated,
      active: ["item-2", "item-3"],
      title: "Head follows",
      desc: "Append the old head after the moved tail to finish the rotation.",
      line: 5,
      state: { rotated: "[3, 4, 1, 2]" },
    },
    {
      values: rotated,
      active: ["item-0", "item-1", "item-2", "item-3"],
      title: "Return rotated list",
      desc: "The result is the full rotated list, not just the piece that moved.",
      line: 6,
      state: { result: "[3, 4, 1, 2]" },
    },
  ];
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => step({
    concept: "array",
    title: phase.title,
    description: phase.desc,
    nodes: mark(phase.values, phase.active, index >= 4 ? "visited" : "active"),
    edges: [],
    highlights: { nodeIds: phase.active, lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(labels, index),
    state: { example: "[1, 2, 3, 4], k=2", ...phase.state, final_result: "[3, 4, 1, 2]" },
  }, index + 1));
}

export function generateTupleSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "read the name at this index",
    "read the matching score",
    "join them into one pair",
    "save the pair in the result",
    "move to the next index",
    "return all saved pairs",
  ];
  const phases = [
    { active: 0, title: "Line up index 0", desc: "Start with the first name and the first score because they belong together.", state: { example: "names=[Ada, Grace], scores=[95, 88]", result_so_far: "[]" } },
    { active: 0, title: "Read Ada and 95", desc: "Take one value from each collection at the same index.", state: { index: 0, name: "Ada", score: 95 } },
    { active: 0, title: "Save Ada:95", desc: "Package the matching values into one tuple-style result.", state: { result_so_far: "[Ada:95]" } },
    { active: 1, title: "Move to index 1", desc: "Move both lists together so the relationship stays aligned.", state: { index: 1, result_so_far: "[Ada:95]" } },
    { active: 1, title: "Save Grace:88", desc: "Build the next pair from the next matching name and score.", state: { result_so_far: "[Ada:95, Grace:88]" } },
    { active: 1, title: "Return both pairs", desc: "The final answer is the collection of saved pairs, not just one highlighted value.", state: { final_result: "[Ada:95, Grace:88]" } },
  ];
  return phases.map((phase, index) => {
    const active = phase.active;
    const visual = authoredTupleVisual({}, context, active);
    return step({
      concept: "tuple",
      title: phase.title,
      description: phase.desc,
      nodes: visual.nodes,
      edges: visual.edges,
      highlights: { nodeIds: visual.highlights, edgeIds: visual.edges.filter((edge) => edge.state === "active").map((edge) => edge.id || `${edge.from}-${edge.to}`), lineNumbers: [Math.min(index + 1, code.length)] },
      code,
      activeLine: Math.min(index + 1, code.length),
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: { pair_index: active, ...phase.state },
    }, index + 1);
  });
}

export function generateTupleSwapSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "read the first item",
    "read the second item",
    "put the old second item first",
    "put the old first item second",
    "build the swapped pair",
    "return the swapped pair",
  ];
  const phases = [
    { title: "Read original pair", desc: "Start with [lab, lecture] so the order change is visible.", line: 1, state: { original: "[lab, lecture]", final_result: "none yet" } },
    { title: "Hold lab", desc: "Save the first value before moving anything.", line: 1, state: { first: "lab", final_result: "none yet" } },
    { title: "Hold lecture", desc: "Save the second value too. The swap needs both values.", line: 2, state: { second: "lecture", final_result: "none yet" } },
    { title: "Move lecture first", desc: "The old second value becomes the new first value.", line: 3, state: { new_first: "lecture", final_result: "none yet" } },
    { title: "Move lab second", desc: "The old first value becomes the new second value.", line: 4, state: { new_second: "lab", result_so_far: "[lecture, lab]" } },
    { title: "Return swapped pair", desc: "The result has the same two values in the opposite order.", line: 6, state: { final_result: "[lecture, lab]" } },
  ];
  return phases.map((phase, index) => {
    const visual = authoredTupleSwapVisual({}, context, index);
    return step({
      concept: "tuple",
      title: phase.title,
      description: phase.desc,
      nodes: visual.nodes,
      edges: visual.edges,
      highlights: {
        nodeIds: visual.highlights,
        edgeIds: visual.edges.filter((edge) => edge.state === "active").map((edge) => edge.id || `${edge.from}-${edge.to}`),
        lineNumbers: [phase.line],
      },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateStudentScorePairSteps(): Step[] {
  const code = [
    "read the requested index",
    "move to that name",
    "read the score at the same index",
    "join the name and score",
    "return that one pair",
  ];
  const names = ["Ana", "Bo"];
  const scores = [90, 82];
  const active = 1;
  const labels = ["Read index", "Find name", "Find score", "Build pair", "Return pair"];
  const phases = [
    { title: "Read requested index", desc: "The prompt asks for index 1, so only that position should be returned.", activeNodes: ["tuple-index"], state: { example: "index=1", final_result: "none yet" } },
    { title: "Find Bo", desc: "Index 1 in the names list points to Bo.", activeNodes: ["tuple-name-1"], state: { index: 1, name: "Bo", final_result: "none yet" } },
    { title: "Find score 82", desc: "Use the same index in the scores list so the score still matches the name.", activeNodes: ["tuple-name-1", "tuple-score-1"], state: { index: 1, score: 82, final_result: "none yet" } },
    { title: "Build Bo:82", desc: "Join the two matching values into the requested pair.", activeNodes: ["tuple-pair-1"], state: { result_so_far: "Bo:82", final_result: "none yet" } },
    { title: "Return Bo:82", desc: "Only the requested index is returned, not every possible pair.", activeNodes: ["tuple-pair-1"], state: { final_result: "Bo:82" } },
  ];
  const nodes: Node[] = [
    { id: "tuple-index", x: 170, y: 250, value: "1", type: "logic-node", label: "requested index", state: "default", meta: { role: "memory" } },
    ...names.flatMap((name, index) => [
      { id: `tuple-name-${index}`, x: 380, y: 175 + index * 110, value: name, type: "array-cell" as const, label: `name ${index}`, state: index < active ? "visited" as const : "default" as const, meta: { role: "tuple-cell" } },
      { id: `tuple-score-${index}`, x: 575, y: 175 + index * 110, value: scores[index], type: "array-cell" as const, label: `score ${index}`, state: index < active ? "visited" as const : "default" as const, meta: { role: "tuple-cell" } },
      { id: `tuple-pair-${index}`, x: 780, y: 175 + index * 110, value: `${name}:${scores[index]}`, type: "array-cell" as const, label: index === active ? "returned pair" : "not returned", state: "default" as const, meta: { role: "tuple-pair" } },
    ]),
  ];
  const edges: Edge[] = [
    { id: "index-name", from: "tuple-index", to: "tuple-name-1", type: "pointer", state: "default" },
    { id: "name-score", from: "tuple-name-1", to: "tuple-score-1", type: "pointer", state: "default" },
    { id: "score-pair", from: "tuple-score-1", to: "tuple-pair-1", type: "pointer", state: "default" },
  ];
  return phases.map((phase, index) => step({
    concept: "tuple",
    title: phase.title,
    description: phase.desc,
    nodes: withNodeState(nodes, phase.activeNodes, "active"),
    edges: withEdgeState(edges, index >= 1 ? edges.slice(0, Math.min(index, edges.length)).map((edge) => edge.id || "") : [], "active"),
    highlights: { nodeIds: phase.activeNodes, edgeIds: index >= 1 ? edges.slice(0, Math.min(index, edges.length)).map((edge) => edge.id || "") : [], lineNumbers: [Math.min(index + 1, code.length)] },
    code,
    activeLine: Math.min(index + 1, code.length),
    workflow: workflowFromLabels(labels, index),
    state: phase.state,
  }, index + 1));
}

export function generateFirstLastPairSteps(): Step[] {
  const code = [
    "read the first item",
    "read the last item",
    "put first and last together",
    "return the pair",
  ];
  const values = ["pen", "notebook", "charger"];
  const labels = ["Read first", "Read last", "Build pair", "Return pair"];
  const phases = [
    { title: "Read pen", desc: "The first item is at the left edge of the list.", active: ["item-0"], pair: "none yet", result: "none yet" },
    { title: "Read charger", desc: "The last item is at the right edge of the list.", active: ["item-2"], pair: "none yet", result: "none yet" },
    { title: "Build first-last pair", desc: "Keep only the two edge values and leave the middle item out.", active: ["item-0", "item-2", "tuple-pair-result"], pair: "[pen, charger]", result: "none yet" },
    { title: "Return pair", desc: "The returned pair is the first item followed by the last item.", active: ["tuple-pair-result"], pair: "[pen, charger]", result: "[pen, charger]" },
  ];
  const baseNodes: Node[] = [
    ...linearNodes(values, [], { y: 210, maxWidth: 480, labels: ["first", "middle", "last"], role: "tuple-cell" }),
    { id: "tuple-pair-result", x: 450, y: 360, value: "[pen, charger]", type: "logic-node", label: "first-last pair", state: "default", meta: { role: "tuple-pair" } },
  ];
  const edges: Edge[] = [
    { id: "first-result", from: "item-0", to: "tuple-pair-result", type: "pointer", state: "default" },
    { id: "last-result", from: "item-2", to: "tuple-pair-result", type: "pointer", state: "default" },
  ];
  return phases.map((phase, index) => step({
    concept: "tuple",
    title: phase.title,
    description: phase.desc,
    nodes: withNodeState(baseNodes, phase.active, "active"),
    edges: withEdgeState(edges, index >= 2 ? ["first-result", "last-result"] : [], "active"),
    highlights: { nodeIds: phase.active, edgeIds: index >= 2 ? ["first-result", "last-result"] : [], lineNumbers: [Math.min(index + 1, code.length)] },
    code,
    activeLine: Math.min(index + 1, code.length),
    workflow: workflowFromLabels(labels, index),
    state: { example: "items=[pen, notebook, charger]", pair_so_far: phase.pair, final_result: phase.result },
  }, index + 1));
}

export function generateSetSteps(context: GeneratorContext = {}): Step[] {
  const code = ["read the current item", "ask whether set memory already has it", "if it is new, keep it in the result", "add new items to set memory", "move to the next item", "return the kept result"];
  const phases = [
    { active: 0, title: context.title || "Set membership", desc: "Start with the first value and an empty memory set." },
    { active: 1, title: "Check the next value", desc: "Ask whether this value has appeared before." },
    { active: 2, title: "Keep a new value", desc: "If the value is new, it can be added to the result and remembered." },
    { active: 1, title: "Spot a duplicate", desc: "When a value repeats, the set memory explains why it should not be counted twice." },
    { active: 3, title: "Update set memory", desc: "The set now represents everything the scan has already seen." },
    { active: 3, title: "Return the unique result", desc: "The final result comes from the values that survived the membership checks." },
  ];
  return phases.map((phase, index) => {
    const active = phase.active;
    const visual = authoredSetVisual({ active: [active] }, context, active);
    return step({
      concept: "set",
      title: phase.title,
      description: phase.desc,
      nodes: visual.nodes,
      edges: visual.edges,
      highlights: { nodeIds: visual.highlights, lineNumbers: [Math.min(index + 1, code.length)] },
      code,
      activeLine: Math.min(index + 1, code.length),
      state: { checking: active },
    }, index + 1);
  });
}

export function generateFirstMissingPositiveSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "start with empty positive-number memory",
    "read each value",
    "if the value is positive, remember it",
    "start checking at 1",
    "while the candidate is already remembered",
    "move to the next candidate",
    "return the first missing positive",
  ];
  const values = [1, 2, 0];
  const baseValues = layoutArray(values, { gap: 96 }).map((node) => ({ ...node, y: 135 }));
  const setNode = (id: string, value: string | number, x: number, y: number, label: string, state: Node["state"] = "default"): Node => ({
    id,
    value,
    x,
    y,
    label,
    type: "set-item",
    state,
    meta: { role: "memory" },
  });
  const logicNode = (id: string, value: string | number, x: number, y: number, label: string, state: Node["state"] = "default", role = "flow-step"): Node => ({
    id,
    value,
    x,
    y,
    label,
    type: "logic-node",
    state,
    meta: { role },
  });
  const buildNodes = (
    activeValueIds: string[],
    seen: number[],
    candidate: number | null,
    result: string,
    extraActive: string[] = [],
  ): Node[] => {
    const valueNodes = baseValues.map((node) => ({
      ...node,
      state: activeValueIds.includes(node.id) ? "active" as const : Number(node.value) > 0 && seen.includes(Number(node.value)) ? "visited" as const : node.value === 0 && activeValueIds.includes(node.id) ? "comparing" as const : "default" as const,
    }));
    const memoryNodes = seen.map((value, index) => setNode(`positive-${value}`, value, 455 + index * 105, 140, "stored positive", extraActive.includes(`positive-${value}`) ? "active" : "visited"));
    return [
      ...valueNodes,
      logicNode("filter-rule", "keep only > 0", 210, 295, "positive filter", extraActive.includes("filter-rule") ? "active" : "default"),
      logicNode("positive-memory", seen.length ? `{${seen.join(", ")}}` : "empty", 560, 295, "positive set", seen.length ? "visited" : "default", "memory"),
      ...(candidate !== null ? [logicNode("candidate-check", candidate, 360, 430, "candidate to test", extraActive.includes("candidate-check") ? "active" : "default")] : []),
      logicNode("result-node", result, 655, 430, "first missing", result === "not found yet" ? "default" : "matched", "result"),
      ...memoryNodes,
    ];
  };
  const edgesFor = (candidate: number | null, foundResult = false): Edge[] => [
    { id: "filter-memory", from: "filter-rule", to: "positive-memory", type: "pointer", state: "active" },
    ...(candidate !== null ? [{ id: "candidate-memory", from: "candidate-check", to: "positive-memory", type: "pointer", state: "active" as const }] : []),
    ...(foundResult ? [{ id: "candidate-result", from: "candidate-check", to: "result-node", type: "pointer", state: "active" as const }] : []),
  ];
  const phases = [
    { title: context.title || "Read the input", desc: "Use a compact sample: [1, 2, 0]. The answer should be 3.", nodes: buildNodes(["item-0", "item-1", "item-2"], [], null, "not found yet"), edges: [], line: 1, state: { positives: "empty", candidate: "" } },
    { title: "Store positive 1", desc: "1 is positive, so it goes into the set of numbers that exist.", nodes: buildNodes(["item-0"], [1], null, "not found yet", ["filter-rule", "positive-1"]), edges: edgesFor(null), line: 3, state: { positives: "{1}", candidate: "" } },
    { title: "Store positive 2", desc: "2 is positive too, so it is stored beside 1.", nodes: buildNodes(["item-1"], [1, 2], null, "not found yet", ["filter-rule", "positive-2"]), edges: edgesFor(null), line: 3, state: { positives: "{1, 2}", candidate: "" } },
    { title: "Ignore 0", desc: "0 cannot be the smallest positive answer, so it stays out of the set.", nodes: buildNodes(["item-2"], [1, 2], null, "not found yet", ["filter-rule"]), edges: edgesFor(null), line: 3, state: { positives: "{1, 2}", ignored: "0" } },
    { title: "Check candidate 1", desc: "Candidate 1 is already in the set, so it is not missing.", nodes: buildNodes([], [1, 2], 1, "not found yet", ["candidate-check", "positive-1"]), edges: edgesFor(1), line: 5, state: { candidate: 1, decision: "present" } },
    { title: "Check candidate 2", desc: "Candidate 2 is also present, so move to the next positive integer.", nodes: buildNodes([], [1, 2], 2, "not found yet", ["candidate-check", "positive-2"]), edges: edgesFor(2), line: 6, state: { candidate: 2, decision: "present" } },
    { title: "Check candidate 3", desc: "3 is not in the set. This is the first missing positive.", nodes: buildNodes([], [1, 2], 3, "3", ["candidate-check"]), edges: edgesFor(3, true), line: 5, state: { candidate: 3, decision: "missing" } },
    { title: "Return 3", desc: "Return the first positive number that did not appear in the input.", nodes: buildNodes([], [1, 2], 3, "3", ["candidate-check", "result-node"]), edges: edgesFor(3, true), line: 7, state: { result: "3" } },
  ];
  return phases.map((phase, index) => step({
    concept: "set",
    title: phase.title,
    description: phase.desc,
    nodes: phase.nodes,
    edges: phase.edges,
    highlights: { nodeIds: phase.nodes.filter((node) => node.state === "active" || node.state === "matched").map((node) => node.id), edgeIds: phase.edges.filter((edge) => edge.state === "active").map((edge) => edge.id || ""), lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(phases.map((item) => item.title), index),
    state: phase.state,
  }, index + 1));
}

export function generateTreeInsertSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "node = root",
    "if value < node.value: node = node.left",
    "if value > node.value: node = node.right",
    "node.child = new_node(value)",
    "root = rebalance(root)",
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
      title: "Choose the empty child",
      description: "After reaching 22, the comparison points to the empty right child where 24 belongs.",
      nodes: withNodeState(before.nodes, ["tree-22"], "active"),
      edges: withEdgeState(before.edges, ["tree-30-tree-15", "tree-15-tree-22"], "active"),
      highlights: { nodeIds: ["tree-22"], edgeIds: ["tree-30-tree-15", "tree-15-tree-22"], lineNumbers: [2, 3] },
      code,
      activeLine: 3,
      state: { parent: 22, empty_child: "right" },
    }, 3),
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
    }, 4),
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
    }, 5),
    step({
      concept: "binary-tree",
      title: "Check sorted order",
      description: "After the insert or rotation, every left child is still smaller and every right child is still larger.",
      nodes: withNodeState(rotated.nodes, ["tree-15", "tree-22", "tree-24"], "visited"),
      edges: activeRotate.edges,
      highlights: { nodeIds: ["tree-15", "tree-22", "tree-24"], lineNumbers: [5] },
      code,
      activeLine: 5,
      state: { invariant: "left < parent < right" },
    }, 6),
    step({
      concept: "binary-tree",
      title: "Finish with the new tree",
      description: "The tree now contains the new value and keeps the search rule that future operations rely on.",
      nodes: withNodeState(rotated.nodes, ["tree-24"], "active"),
      edges: rotated.edges,
      highlights: { nodeIds: ["tree-24"], lineNumbers: [5] },
      code,
      activeLine: 5,
      state: { inserted: 24, root: 22 },
    }, 7),
  ];
}

export function generateHashFrequencySteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "table = {}",
    "item = items[index]",
    "old_count = table.get(item, 0)",
    "table[item] = old_count + 1",
    "index += 1",
    "return table or best_count",
  ];
  const items = ["A", "B", "A"];
  const bucketStates = [
    {},
    { 2: ["A:1"] },
    { 2: ["A:1"], 3: ["B:1"] },
    { 2: ["A:2"], 3: ["B:1"] },
  ] as Array<Record<number, string[]>>;
  const phases = [
    { idx: 0, buckets: bucketStates[0], title: context.title || "Count with a hash map", desc: "Start with an empty table before reading the first item.", line: 1, result: "empty" },
    { idx: 0, buckets: bucketStates[1], title: "Store A once", desc: "A has no count yet, so store A:1.", line: 4, result: "A:1" },
    { idx: 1, buckets: bucketStates[2], title: "Store B once", desc: "B uses its own key, so it gets a separate count.", line: 4, result: "A:1, B:1" },
    { idx: 2, buckets: bucketStates[2], title: "Read A again", desc: "The table already has A, so read its old count before updating.", line: 3, result: "old A count is 1" },
    { idx: 2, buckets: bucketStates[3], title: "Update A to 2", desc: "The repeated A changes the stored count from 1 to 2.", line: 4, result: "A:2, B:1" },
    { idx: 2, buckets: bucketStates[3], title: "Use the count", desc: "Later code can read A's count directly from the table.", line: 3, result: "read A:2" },
    { idx: 2, buckets: bucketStates[3], title: "Return counted state", desc: "The useful result is the map state, or the best value derived from it.", line: 6, result: "A appears twice" },
  ];
  return phases.map((phase, index) => {
    const visual = layoutHashBuckets(5, phase.buckets);
    const key = items[phase.idx];
    const activeBucket = key === "B" ? "bucket-3" : "bucket-2";
    const activeEntry = key === "B" ? "entry-3-0" : "entry-2-0";
    return step({
      concept: "hash-map",
      title: phase.title,
      description: phase.desc,
      nodes: withNodeState(visual.nodes, [activeBucket, activeEntry], "active"),
      edges: visual.edges,
      highlights: { nodeIds: [activeBucket, activeEntry], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: { current: key, table: phase.result },
    }, index + 1);
  });
}

export function generateHashComplementSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "seen = {}",
    "num = nums[index]",
    "need = target - num",
    "if need in seen: return [seen[need], index]",
    "seen[num] = index",
    "return no_pair",
  ];
  const nums = [2, 7];
  const empty = layoutHashBuckets(5, {});
  const withTwo = layoutHashBuckets(5, { 2: ["2:0"] });
  const phases = [
    { idx: 0, visual: empty, active: ["bucket-2"], title: context.title || "Find a complement", desc: "Start with target 9 and an empty table of numbers already seen.", line: 1, state: { target: 9, seen: "empty" } },
    { idx: 0, visual: empty, active: ["bucket-2"], title: "Need 7", desc: "For num 2, the missing partner is 7. It is not stored yet.", line: 3, state: { num: 2, need: 7 } },
    { idx: 0, visual: withTwo, active: ["bucket-2", "entry-2-0"], title: "Store 2", desc: "Save 2 with index 0 so a later value can find it.", line: 5, state: { seen: "2 -> 0" } },
    { idx: 1, visual: withTwo, active: ["bucket-2", "entry-2-0"], title: "Need 2", desc: "For num 7, the missing partner is 2.", line: 3, state: { num: 7, need: 2 } },
    { idx: 1, visual: withTwo, active: ["entry-2-0"], title: "Find stored 2", desc: "2 is already in the table, so the pair is found without scanning again.", line: 4, state: { found: "2 at index 0" } },
    { idx: 1, visual: withTwo, active: ["entry-2-0"], title: "Pair with current index", desc: "The stored index 0 pairs with the current index 1.", line: 4, state: { pair: "0 and 1" } },
    { idx: 1, visual: withTwo, active: ["entry-2-0"], title: "Return both indexes", desc: "Return the stored index and the current index.", line: 4, state: { result: "[0, 1]" } },
  ];
  return phases.map((phase, index) => step({
    concept: "hash-map",
    title: phase.title,
    description: phase.desc,
    nodes: withNodeState(phase.visual.nodes, phase.active, "active"),
    edges: phase.visual.edges,
    highlights: { nodeIds: phase.active, lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(phases.map((item) => item.title), index),
    state: phase.state,
  }, index + 1));
}

export function generateGraphIslandsSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "islands = 0",
    "for each cell in grid:",
    "  if cell is land and not visited:",
    "    islands += 1",
    "    flood_fill(cell)",
    "return islands",
  ];
  const grid = [
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
  ];
  const makeNodes = (activeCells: string[], visitedCells: string[], count: number, result = "not returned yet"): Node[] => {
    const nodes: Node[] = [];
    grid.forEach((row, rowIndex) => {
      row.forEach((value, colIndex) => {
        const id = `cell-${rowIndex}-${colIndex}`;
        const isLand = value === 1;
        nodes.push({
          id,
          x: 290 + colIndex * 110,
          y: 125 + rowIndex * 96,
          value: isLand ? "land" : "water",
          type: "array-cell",
          label: `${rowIndex},${colIndex}`,
          state: activeCells.includes(id) ? "active" : visitedCells.includes(id) ? "visited" : isLand ? "default" : "inactive",
          meta: { role: isLand ? "land" : "water" },
        });
      });
    });
    nodes.push(
      { id: "frontier", x: 655, y: 165, value: activeCells.length ? activeCells.map((id) => id.replace("cell-", "").replace("-", ",")).join(" / ") : "empty", type: "logic-node", label: "flood-fill frontier", state: activeCells.length ? "active" : "default", meta: { role: "memory" } },
      { id: "count", x: 655, y: 290, value: count, type: "logic-node", label: "islands counted", state: count > 0 ? "matched" : "default", meta: { role: "result" } },
      { id: "result", x: 655, y: 415, value: result, type: "logic-node", label: "final answer", state: result === "not returned yet" ? "default" : "matched", meta: { role: "result" } },
    );
    return nodes;
  };
  const phases = [
    { active: ["cell-0-0"], visited: [], count: 0, result: "not returned yet", title: context.title || "Scan the grid", desc: "Use a small grid with land and water. The scan moves cell by cell.", line: 2, state: { cell: "0,0", islands: 0 } },
    { active: ["cell-0-0"], visited: ["cell-0-0"], count: 1, result: "not returned yet", title: "Start island 1", desc: "The first unvisited land cell starts a new island, so the count becomes 1.", line: 4, state: { islands: 1, started: "0,0" } },
    { active: ["cell-0-1"], visited: ["cell-0-0", "cell-0-1"], count: 1, result: "not returned yet", title: "Flood-fill neighbor", desc: "The land at 0,1 touches the first cell, so it belongs to the same island.", line: 5, state: { islands: 1, visited: "0,0 and 0,1" } },
    { active: ["cell-1-0", "cell-1-1"], visited: ["cell-0-0", "cell-0-1"], count: 1, result: "not returned yet", title: "Skip water", desc: "Water cells do not start islands and do not join the flood fill.", line: 3, state: { skipped: "water" } },
    { active: ["cell-1-2"], visited: ["cell-0-0", "cell-0-1", "cell-1-2"], count: 2, result: "not returned yet", title: "Start island 2", desc: "The land at 1,2 is not connected to island 1, so it starts island 2.", line: 4, state: { islands: 2, started: "1,2" } },
    { active: ["cell-2-2"], visited: ["cell-0-0", "cell-0-1", "cell-1-2", "cell-2-2"], count: 2, result: "not returned yet", title: "Join connected land", desc: "The land at 2,2 touches 1,2, so the count does not increase.", line: 5, state: { islands: 2, joined: "2,2" } },
    { active: ["cell-2-0"], visited: ["cell-0-0", "cell-0-1", "cell-1-2", "cell-2-2", "cell-2-0"], count: 3, result: "not returned yet", title: "Start island 3", desc: "The land at 2,0 is separate, so it adds one more island.", line: 4, state: { islands: 3, started: "2,0" } },
    { active: ["result"], visited: ["cell-0-0", "cell-0-1", "cell-1-2", "cell-2-2", "cell-2-0"], count: 3, result: "3", title: "Return 3 islands", desc: "The scan is done, and the saved island count is 3.", line: 6, state: { result: "3" } },
  ];
  return phases.map((phase, index) => {
    const nodes = makeNodes(phase.active, phase.visited, phase.count, phase.result);
    const edges: Edge[] = phase.active.includes("cell-0-1")
      ? [{ id: "island-1-link", from: "cell-0-0", to: "cell-0-1", type: "pointer", state: "active" }]
      : phase.active.includes("cell-2-2")
        ? [{ id: "island-2-link", from: "cell-1-2", to: "cell-2-2", type: "pointer", state: "active" }]
        : phase.active.includes("result")
          ? [{ id: "count-result", from: "count", to: "result", type: "pointer", state: "active" }]
          : [];
    return step({
      concept: "graph",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges,
      highlights: { nodeIds: [...phase.active, "count", ...(phase.result !== "not returned yet" ? ["result"] : [])], edgeIds: edges.map((edge) => edge.id || ""), lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateHashGroupingSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "start with empty groups",
    "build the group key for this item",
    "create a group if the key is new",
    "add the item to its matching group",
    "move to the next item",
    "return the grouped values",
  ];
  const buckets = [
    {},
    { 2: ["A:[A]"] },
    { 2: ["A:[A]"], 3: ["B:[B]"] },
    { 2: ["A:[A,A]"], 3: ["B:[B]"] },
  ] as Array<Record<number, string[]>>;
  const phases = [
    { idx: 0, bucket: buckets[0], key: "A", title: context.title || "Group by key", desc: "Start with an empty map of groups.", line: 1, result: "empty" },
    { idx: 0, bucket: buckets[1], key: "A", title: "Create group A", desc: "The first A creates a new group and joins it.", line: 4, result: "A: [A]" },
    { idx: 1, bucket: buckets[2], key: "B", title: "Create group B", desc: "B has a different key, so it gets a different group.", line: 4, result: "A: [A], B: [B]" },
    { idx: 2, bucket: buckets[2], key: "A", title: "Find existing group A", desc: "The second A reuses the group that already exists.", line: 2, result: "A group already exists" },
    { idx: 2, bucket: buckets[3], key: "A", title: "Append to group A", desc: "The group changes from one A to two A values.", line: 4, result: "A: [A, A], B: [B]" },
    { idx: 2, bucket: buckets[3], key: "A", title: "Keep separate groups", desc: "A and B remain separate keys even when one group grows.", line: 5, result: "two groups" },
    { idx: 2, bucket: buckets[3], key: "A", title: "Return grouped values", desc: "The result keeps each key connected to the list of matching values.", line: 6, result: "A group has 2" },
  ];
  return phases.map((phase, index) => {
    const visual = layoutHashBuckets(5, phase.bucket);
    const activeBucket = phase.key === "B" ? "bucket-3" : "bucket-2";
    const activeEntry = phase.key === "B" ? "entry-3-0" : "entry-2-0";
    return step({
      concept: "hash-map",
      title: phase.title,
      description: phase.desc,
      nodes: withNodeState(visual.nodes, [activeBucket, activeEntry], "active"),
      edges: visual.edges,
      highlights: { nodeIds: [activeBucket, activeEntry], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: { key: phase.key, groups: phase.result },
    }, index + 1);
  });
}

export function generateHashMapCollisionSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "bucket = hash(key)",
    "entry = table[bucket]",
    "while entry and entry.key != key:",
    "entry.next = new_entry(key, value)",
  ];
  const compactSample = compactVisualInput(context, "hash-map", context.visualizer?.input || {});
  const rows = rowsFromExampleOrState({}, {
    ...context,
    exampleInput: compactSample || context.exampleInput,
  });
  const firstKey = String(rows[0]?.key ?? "Ana");
  const secondKey = String(rows[1]?.key ?? "Bo");
  const empty = layoutHashBuckets(5, {});
  const first = layoutHashBuckets(5, { 2: [firstKey] });
  const collision = layoutHashBuckets(5, { 2: [firstKey, secondKey] });
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
      state: { hash: `${firstKey} -> bucket 2` },
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
      state: { hash: `${secondKey} -> bucket 2` },
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
      state: { chain: `${firstKey} -> ${secondKey}` },
    }, 4),
    step({
      concept: "hash-map",
      title: "Look up inside the chain",
      description: "A lookup jumps to bucket 2, then compares entries until the requested key is found.",
      nodes: withNodeState(collision.nodes, ["bucket-2", "entry-2-1"], "active"),
      edges: withEdgeState(collision.edges, ["entry-2-1-edge"], "active"),
      highlights: { nodeIds: ["bucket-2", "entry-2-1"], edgeIds: ["entry-2-1-edge"], lineNumbers: [3] },
      code,
      activeLine: 3,
      state: { lookup: `${secondKey} found in bucket 2` },
    }, 5),
    step({
      concept: "hash-map",
      title: "Read the matching value",
      description: "Once the key matches, the map reads the value stored with that key.",
      nodes: withNodeState(collision.nodes, ["entry-2-1"], "active"),
      edges: withEdgeState(collision.edges, ["entry-2-1-edge"], "active"),
      highlights: { nodeIds: ["entry-2-1"], edgeIds: ["entry-2-1-edge"], lineNumbers: [3] },
      code,
      activeLine: 3,
      state: { value: `value for ${secondKey}` },
    }, 6),
    step({
      concept: "hash-map",
      title: "Use the stored value",
      description: "The table is useful because later code can retrieve the value without scanning every entry.",
      nodes: withNodeState(collision.nodes, ["entry-2-1"], "visited"),
      edges: collision.edges,
      highlights: { nodeIds: ["entry-2-1"], lineNumbers: [4] },
      code,
      activeLine: 4,
      state: { result: `found ${secondKey}` },
    }, 7),
  ];
}

export function generateGraphTraversalSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "start with the first node in the frontier",
    "take the next node from the frontier",
    "mark that node as visited",
    "add unvisited neighbors to the frontier",
    "continue while the frontier has nodes",
  ];
  const graph = layoutCircularGraph(["A", "B", "C", "D", "E"], [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["D", "E"]]);
  const phases = [
    { title: context.title || "Graph BFS", description: "Start from A. The queue holds places to visit next.", visited: [], active: ["A"], queued: ["A"], activeEdges: [], line: 1 },
    { title: "Visit A", description: "A is visited first, then its neighbors B and C join the queue.", visited: ["A"], active: ["A"], queued: ["B", "C"], activeEdges: ["A-B", "A-C"], line: 3 },
    { title: "Take B from frontier", description: "B comes out of the queue before C, so BFS spreads level by level.", visited: ["A", "B"], active: ["B"], queued: ["C"], activeEdges: [], line: 2 },
    { title: "Add B's neighbor", description: "D is discovered from B and joins the back of the frontier.", visited: ["A", "B"], active: ["B"], queued: ["C", "D"], activeEdges: ["B-D"], line: 4 },
    { title: "Visit C next", description: "C was already waiting, so it gets its turn before nodes farther away.", visited: ["A", "B", "C"], active: ["C"], queued: ["D"], activeEdges: ["C-D"], line: 2 },
    { title: "Skip repeated D", description: "C also points toward D, but D is already waiting, so the search does not add it twice.", visited: ["A", "B", "C"], active: ["D"], queued: ["D"], activeEdges: ["B-D", "C-D"], line: 4 },
    { title: "Trace the path", description: "When D is reached, the highlighted path shows how the search got there.", visited: ["A", "B", "C", "D"], active: ["D"], queued: [], activeEdges: ["A-B", "B-D"], line: 5 },
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
  type ConditionalCase = {
    id: string;
    label: string;
    input: string;
    condition: string;
    trueResult: string;
    falseResult: string;
    chosenResult: string;
    branch: "true" | "false";
    code: string[];
    steps: Array<{
      title: string;
      description: string;
      active: string[];
      edges: string[];
      line: number;
      result?: string;
      skipped?: string[];
      skippedEdges?: string[];
      visited?: string[];
      visitedEdges?: string[];
    }>;
  };

  const titleText = `${context.title || ""} ${context.prompt || ""}`.toLowerCase();
  const makeCase = (item: Omit<ConditionalCase, "steps">): ConditionalCase => {
    const branchLabel = item.branch === "true" ? "true" : "false";
    const oppositeLabel = item.branch === "true" ? "false" : "true";
    const branchNode = item.branch;
    const oppositeNode = item.branch === "true" ? "false" : "true";
    const branchEdge = `condition-${item.branch}`;
    const resultEdge = `${item.branch}-end`;
    return {
      ...item,
      steps: [
        { title: `Read ${item.input.split("=")[0]?.trim() || "input"}`, description: `Start with ${item.input}.`, active: ["input"], edges: ["start-input"], line: 1, result: "none yet" },
        { title: "Ask the condition", description: `Check ${item.condition} before choosing a branch.`, active: ["condition"], edges: ["start-input", "input-condition"], line: 2, result: "none yet" },
        { title: `Follow ${branchLabel} branch`, description: `This case makes the ${branchLabel} path run.`, active: [branchNode], edges: ["start-input", "input-condition", branchEdge], line: item.branch === "true" ? 3 : 4, result: "none yet" },
        {
          title: `Skip ${oppositeLabel} branch`,
          description: `The ${oppositeLabel} path is crossed out for this input.`,
          active: [],
          edges: [],
          skipped: [oppositeNode],
          skippedEdges: [`condition-${oppositeNode}`, `${oppositeNode}-end`],
          visited: [branchNode],
          visitedEdges: ["start-input", "input-condition", branchEdge],
          line: item.branch === "true" ? 3 : 4,
          result: "none yet",
        },
        { title: `Choose ${item.chosenResult}`, description: `The active branch chooses ${item.chosenResult}.`, active: [branchNode, "end"], edges: ["start-input", "input-condition", branchEdge, resultEdge], line: item.branch === "true" ? 3 : 4, result: "none yet" },
        { title: `Return ${item.chosenResult}`, description: `Return ${item.chosenResult}; the skipped branch does not run.`, active: ["end"], edges: ["start-input", "input-condition", branchEdge, resultEdge], line: item.code.length, result: item.chosenResult },
      ],
    };
  };

  let cases: ConditionalCase[];
  if (/grade bucket/.test(titleText)) {
    cases = [
      makeCase({
        id: "grade-b",
        label: "84 gives B",
        input: "score = 84",
        condition: "score >= 80",
        trueResult: "return B",
        falseResult: "check score >= 70",
        chosenResult: "B",
        branch: "true",
        code: ["read score", "ask whether score is at least 80", "if yes, choose B", "otherwise check the next grade rule", "return the chosen grade"],
      }),
      makeCase({
        id: "grade-f",
        label: "58 gives F",
        input: "score = 58",
        condition: "score >= 60",
        trueResult: "return D",
        falseResult: "return F",
        chosenResult: "F",
        branch: "false",
        code: ["read score", "ask whether score is at least 60", "if yes, choose D", "otherwise choose F", "return the chosen grade"],
      }),
    ];
  } else if (/clamp score/.test(titleText)) {
    cases = [
      makeCase({
        id: "clamp-high",
        label: "118 becomes 100",
        input: "score = 118",
        condition: "score > 100",
        trueResult: "return 100",
        falseResult: "check lower bound",
        chosenResult: "100",
        branch: "true",
        code: ["read score", "ask whether score is above 100", "if yes, return 100", "otherwise check whether score is below 0", "return the clamped score"],
      }),
      makeCase({
        id: "clamp-in-range",
        label: "84 stays 84",
        input: "score = 84",
        condition: "score is outside 0 to 100",
        trueResult: "clamp to a boundary",
        falseResult: "return score",
        chosenResult: "84",
        branch: "false",
        code: ["read score", "ask whether score is outside 0 to 100", "if yes, clamp to a boundary", "otherwise keep the score", "return the clamped score"],
      }),
    ];
  } else if (/can vote/.test(titleText)) {
    cases = [
      makeCase({
        id: "vote-yes",
        label: "18 can vote",
        input: "age = 18",
        condition: "age >= 18",
        trueResult: "return true",
        falseResult: "return false",
        chosenResult: "true",
        branch: "true",
        code: ["read age", "ask whether age is at least 18", "if yes, return true", "otherwise return false", "return the answer"],
      }),
      makeCase({
        id: "vote-no",
        label: "16 cannot vote",
        input: "age = 16",
        condition: "age >= 18",
        trueResult: "return true",
        falseResult: "return false",
        chosenResult: "false",
        branch: "false",
        code: ["read age", "ask whether age is at least 18", "if yes, return true", "otherwise return false", "return the answer"],
      }),
    ];
  } else if (/plant watering/.test(titleText)) {
    cases = [
      makeCase({
        id: "plant-water",
        label: "Dry soil waters",
        input: "moisture = 28, sunny = false",
        condition: "moisture < 30",
        trueResult: "return water today",
        falseResult: "check sunny window",
        chosenResult: "water today",
        branch: "true",
        code: ["read moisture and sunlight", "ask whether soil is dry", "if yes, return water today", "otherwise check the sunny rule", "return the care message"],
      }),
      makeCase({
        id: "plant-wait",
        label: "Safe soil waits",
        input: "moisture = 50, sunny = false",
        condition: "moisture < 30",
        trueResult: "return water today",
        falseResult: "return check tomorrow",
        chosenResult: "check tomorrow",
        branch: "false",
        code: ["read moisture and sunlight", "ask whether soil is dry", "if yes, return water today", "otherwise return check tomorrow", "return the care message"],
      }),
    ];
  } else if (/late assignment/.test(titleText)) {
    cases = [
      makeCase({
        id: "late-normal",
        label: "Penalty stays positive",
        input: "score = 86, days = 3",
        condition: "86 - penalty >= 0",
        trueResult: "return 71",
        falseResult: "return 0",
        chosenResult: "71",
        branch: "true",
        code: ["read score and late days", "subtract the late penalty", "ask whether the adjusted score is at least 0", "if yes, return the adjusted score", "otherwise return 0", "return the final score"],
      }),
      makeCase({
        id: "late-zero",
        label: "Penalty clamps to 0",
        input: "score = 12, days = 4",
        condition: "12 - penalty >= 0",
        trueResult: "return adjusted score",
        falseResult: "return 0",
        chosenResult: "0",
        branch: "false",
        code: ["read score and late days", "subtract the late penalty", "ask whether the adjusted score is at least 0", "if yes, return the adjusted score", "otherwise return 0", "return the final score"],
      }),
    ];
  } else if (/parking ticket/.test(titleText)) {
    cases = [
      makeCase({
        id: "parking-ticketed",
        label: "Weekday ticket",
        input: "Tuesday, 10:00, 150 min, no permit",
        condition: "parking is free today",
        trueResult: "return 0",
        falseResult: "add ticket fees",
        chosenResult: "45",
        branch: "false",
        code: ["read day, hour, minutes, and permit", "ask whether parking is free", "if yes, return 0", "otherwise start with 20 dollars", "add long-parking and no-permit fees", "return the ticket total"],
      }),
      makeCase({
        id: "parking-free",
        label: "Weekend is free",
        input: "Sunday, 13:00, 180 min, no permit",
        condition: "parking is free today",
        trueResult: "return 0",
        falseResult: "add ticket fees",
        chosenResult: "0",
        branch: "true",
        code: ["read day, hour, minutes, and permit", "ask whether parking is free", "if yes, return 0", "otherwise start with 20 dollars", "add any needed fees", "return the ticket total"],
      }),
    ];
  } else {
    const input = context.exampleInput || "age = 20";
    const output = context.exampleOutput || "true";
    cases = [
      makeCase({
        id: "true-case",
        label: "True case",
        input,
        condition: context.constraints?.[0] || "condition is true",
        trueResult: `return ${output}`,
        falseResult: "return alternate result",
        chosenResult: output,
        branch: "true",
        code: ["read input", "ask the condition", "if yes, use the true result", "otherwise use the false result", "return the chosen result"],
      }),
      makeCase({
        id: "false-case",
        label: "False case",
        input: "alternate input",
        condition: context.constraints?.[0] || "condition is false",
        trueResult: `return ${output}`,
        falseResult: "return alternate result",
        chosenResult: "alternate result",
        branch: "false",
        code: ["read input", "ask the condition", "if yes, use the true result", "otherwise use the false result", "return the chosen result"],
      }),
    ];
  }

  const allEdges: Edge[] = [
    { id: "start-input", from: "start", to: "input", type: "pointer" },
    { id: "input-condition", from: "input", to: "condition", type: "pointer" },
    { id: "condition-true", from: "condition", to: "true", type: "branch", label: "true" },
    { id: "condition-false", from: "condition", to: "false", type: "branch", label: "false" },
    { id: "true-end", from: "true", to: "end", type: "pointer" },
    { id: "false-end", from: "false", to: "end", type: "pointer" },
  ];

  return cases.flatMap((item) => {
    const labels = item.steps.map((phase) => phase.title);
    return item.steps.map((phase, index) => {
      const inactiveBranch = item.branch === "true" ? "false" : "true";
      const skippedNodes = new Set(phase.skipped || []);
      const visitedNodes = new Set(phase.visited || []);
      const skippedEdges = new Set(phase.skippedEdges || []);
      const visitedEdges = new Set(phase.visitedEdges || []);
      const edgeBase = allEdges.map((edge) => {
        const id = edge.id || `${edge.from}-${edge.to}`;
        if (skippedEdges.has(id)) return { ...edge, state: "skipped" as const };
        if (visitedEdges.has(id)) return { ...edge, state: "visited" as const };
        return edge;
      });
      const nodes: Node[] = [
        { id: "start", x: 0, y: 140, value: "Start", type: "logic-node", state: phase.active.includes("start") ? "active" : "default", label: "start" },
        { id: "input", x: 165, y: 130, value: item.input, type: "logic-node", state: phase.active.includes("input") ? "active" : "default", label: "input", meta: { fullText: item.input } },
        { id: "condition", x: 380, y: 88, value: item.condition, type: "logic-node", state: phase.active.includes("condition") ? "active" : "default", label: "condition", meta: { fullText: item.condition } },
        { id: "true", x: 670, y: 30, value: item.trueResult, type: "logic-node", state: phase.active.includes("true") ? "active" : skippedNodes.has("true") ? "skipped" : visitedNodes.has("true") ? "visited" : inactiveBranch === "true" ? "inactive" : "default", label: "true branch", meta: { fullText: item.trueResult } },
        { id: "false", x: 670, y: 220, value: item.falseResult, type: "logic-node", state: phase.active.includes("false") ? "active" : skippedNodes.has("false") ? "skipped" : visitedNodes.has("false") ? "visited" : inactiveBranch === "false" ? "inactive" : "default", label: "false branch", meta: { fullText: item.falseResult } },
        { id: "end", x: 895, y: 140, value: phase.result === "none yet" ? "not returned yet" : item.chosenResult, type: "logic-node", state: phase.active.includes("end") ? "matched" : "default", label: "result", meta: { fullText: phase.result === "none yet" ? "none yet" : item.chosenResult } },
      ];
      const built = step({
        concept: "conditional",
        title: phase.title,
        description: phase.description,
        nodes,
        edges: withEdgeState(edgeBase, phase.edges, "active"),
        highlights: { nodeIds: phase.active, edgeIds: phase.edges, lineNumbers: [phase.line] },
        code: item.code,
        activeLine: phase.line,
        state: {
          case_id: item.id,
          case_label: item.label,
          branch: item.branch,
          input: item.input,
          rule: item.condition,
          chosen_result: phase.result || "none yet",
          final_result: index === item.steps.length - 1 ? item.chosenResult : "none yet",
        },
        workflow: workflowFromLabels(labels, index),
      }, index + 1);
      return { ...built, id: `${item.id}-${built.id}` };
    });
  });
}

function makeLinearNodes(values: Array<string | number>, active: string[], state: Node["state"], type: Node["type"] = "array-cell"): Node[] {
  return withNodeState(layoutArray(values, { type }), active, state);
}

export function generateStackSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "values = []",
    "ops = []",
    "if token is a number: values.push(token)",
    "if token is an operator: ops.push(token)",
    "right = values.pop(); left = values.pop()",
    "values.push(apply(left, op, right))",
    "return values[-1]",
  ];
  const sample = compactVisualInput(context, "stack", context.visualizer?.input || {}) || "expression=3+2*2";
  const teachingValues = indexableTeachingValues("stack", sample);
  const tokens = teachingValues.length >= 5 ? teachingValues.map(String).slice(0, 5) : ["3", "+", "2", "*", "2"];
  const [first, plus, second, times, third] = tokens;
  const makeNodes = (values: string[], ops: string[] = [], active: string[] = []) => {
    const valueNodes = values.map((value, index) => ({
      id: `value-${index}`,
      x: 330,
      y: 405 - index * 76,
      value,
      type: "array-cell" as const,
      label: index === values.length - 1 ? "value top" : "",
      state: "default" as const,
      meta: { role: "stack-item" },
    }));
    const opNodes = ops.map((value, index) => ({
      id: `op-${index}`,
      x: 570,
      y: 405 - index * 76,
      value,
      type: "array-cell" as const,
      label: index === ops.length - 1 ? "operator top" : "",
      state: "default" as const,
      meta: { role: "stack-item" },
    }));
    return withNodeState([...valueNodes, ...opNodes], active, "active");
  };
  return [
    step({ concept: "stack", title: context.title || "Read the first number", description: `Read ${first} from ${tokens.join(" ")} and push it onto the value stack.`, nodes: makeNodes([first], [], ["value-0"]), edges: [], highlights: { nodeIds: ["value-0"], lineNumbers: [3] }, code, activeLine: 3, state: { expression: tokens.join(" "), values: first, operators: "empty" } }, 1),
    step({ concept: "stack", title: `Push ${plus}`, description: `${plus} waits on the operator stack until there are enough values to apply it.`, nodes: makeNodes([first], [plus], ["op-0"]), edges: [], highlights: { nodeIds: ["op-0"], lineNumbers: [4] }, code, activeLine: 4, state: { values: first, operators: plus } }, 2),
    step({ concept: "stack", title: `Read ${second}`, description: `The next number ${second} joins the value stack above ${first}.`, nodes: makeNodes([first, second], [plus], ["value-1"]), edges: [], highlights: { nodeIds: ["value-1"], lineNumbers: [3] }, code, activeLine: 3, state: { values: `${first}, ${second}`, operators: plus } }, 3),
    step({ concept: "stack", title: `Push ${times}`, description: `${times} has higher priority than ${plus}, so it waits on top and will run first.`, nodes: makeNodes([first, second], [plus, times], ["op-1"]), edges: [], highlights: { nodeIds: ["op-1"], lineNumbers: [4] }, code, activeLine: 4, state: { values: `${first}, ${second}`, operators: `${plus}, ${times}` } }, 4),
    step({ concept: "stack", title: `Read ${third}`, description: `${third} completes the right side of ${second} ${times} ${third}.`, nodes: makeNodes([first, second, third], [plus, times], ["value-2"]), edges: [], highlights: { nodeIds: ["value-2"], lineNumbers: [3] }, code, activeLine: 3, state: { values: `${first}, ${second}, ${third}`, operators: `${plus}, ${times}` } }, 5),
    step({ concept: "stack", title: `Apply ${times}`, description: `Pop ${second} and ${third}, apply ${times}, then push 4 back onto the value stack.`, nodes: makeNodes([first, "4"], [plus], ["value-1"]), edges: [], highlights: { nodeIds: ["value-1"], lineNumbers: [5, 6] }, code, activeLine: 6, state: { changed: `${second} ${times} ${third} = 4`, values: `${first}, 4`, operators: plus } }, 6),
    step({ concept: "stack", title: `Apply ${plus}`, description: `Now ${plus} can combine ${first} and 4 into the final value.`, nodes: makeNodes(["7"], [], ["value-0"]), edges: [], highlights: { nodeIds: ["value-0"], lineNumbers: [5, 6] }, code, activeLine: 6, state: { changed: `${first} ${plus} 4 = 7`, values: "7", operators: "empty" } }, 7),
    step({ concept: "stack", title: "Return the result", description: "The only remaining value is the expression result, so return 7.", nodes: makeNodes(["7"], [], ["value-0"]), edges: [], highlights: { nodeIds: ["value-0"], lineNumbers: [7] }, code, activeLine: 7, state: { result: 7 } }, 8),
  ];
}

export function generateMinStackSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "values = []",
    "mins = []",
    "push(3)",
    "push(1)",
    "push(2)",
    "get_min()",
    "pop()",
    "return get_min()",
  ];
  const makeStackNodes = (values: number[], mins: number[], activeValue = -1, activeMin = -1, result = "not returned yet"): Node[] => {
    const valueNodes = values.map((value, index) => ({
      id: `value-${index}`,
      x: 330,
      y: 380 - index * 76,
      value,
      type: "stack-frame" as const,
      label: index === values.length - 1 ? "top" : "value stack",
      state: index === activeValue ? "active" as const : "default" as const,
      meta: { role: "stack" },
    }));
    const minNodes = mins.map((value, index) => ({
      id: `min-${index}`,
      x: 585,
      y: 380 - index * 76,
      value,
      type: "stack-frame" as const,
      label: index === mins.length - 1 ? "current min" : "min stack",
      state: index === activeMin ? "matched" as const : "default" as const,
      meta: { role: "memory" },
    }));
    return [
      { id: "value-label", x: 330, y: 120, value: "values", type: "logic-node", label: "main stack", state: "default", meta: { role: "memory" } },
      { id: "min-label", x: 585, y: 120, value: "minimums", type: "logic-node", label: "parallel stack", state: "default", meta: { role: "memory" } },
      ...valueNodes,
      ...minNodes,
      { id: "result", x: 455, y: 475, value: result, type: "logic-node", label: "returned min", state: result === "not returned yet" ? "default" : "matched", meta: { role: "result" } },
    ];
  };
  const edges: Edge[] = [
    { id: "value-min-rule", from: "value-label", to: "min-label", type: "pointer", state: "default" },
  ];
  const phases = [
    { title: context.title || "Min stack starts empty", desc: "A min stack keeps normal values and a second stack of the minimum after each push.", values: [] as number[], mins: [] as number[], valueActive: -1, minActive: -1, line: 1, result: "not returned yet", state: { values: "empty", mins: "empty" } },
    { title: "Push 3", desc: "3 enters the value stack. Because it is the only value, it is also the current minimum.", values: [3], mins: [3], valueActive: 0, minActive: 0, line: 3, result: "not returned yet", state: { top: 3, min: 3 } },
    { title: "Push 1", desc: "1 is smaller than 3, so the minimum stack records 1 as the new minimum.", values: [3, 1], mins: [3, 1], valueActive: 1, minActive: 1, line: 4, result: "not returned yet", state: { top: 1, min: 1 } },
    { title: "Push 2", desc: "2 goes on top, but the minimum is still 1. The min stack repeats 1 to stay aligned.", values: [3, 1, 2], mins: [3, 1, 1], valueActive: 2, minActive: 2, line: 5, result: "not returned yet", state: { top: 2, min: 1 } },
    { title: "Read current minimum", desc: "get_min reads the top of the minimum stack without removing any value.", values: [3, 1, 2], mins: [3, 1, 1], valueActive: -1, minActive: 2, line: 6, result: "1", state: { returned: 1 } },
    { title: "Pop top value", desc: "pop removes 2 from both stacks, so the value stack and min stack stay the same height.", values: [3, 1], mins: [3, 1], valueActive: 1, minActive: 1, line: 7, result: "not returned yet", state: { popped: 2, min: 1 } },
    { title: "Minimum stays 1", desc: "After removing 2, the top of the minimum stack is still 1.", values: [3, 1], mins: [3, 1], valueActive: -1, minActive: 1, line: 8, result: "1", state: { min: 1 } },
    { title: "Return 1", desc: "The final minimum is available in constant time from the top of the min stack.", values: [3, 1], mins: [3, 1], valueActive: -1, minActive: 1, line: 8, result: "1", state: { result: 1 } },
  ];
  return phases.map((phase, index) => step({
    concept: "stack",
    title: phase.title,
    description: phase.desc,
    nodes: makeStackNodes(phase.values, phase.mins, phase.valueActive, phase.minActive, phase.result),
    edges: withEdgeState(edges, index > 0 ? ["value-min-rule"] : [], "active"),
    highlights: {
      nodeIds: [
        ...(phase.valueActive >= 0 ? [`value-${phase.valueActive}`] : []),
        ...(phase.minActive >= 0 ? [`min-${phase.minActive}`] : []),
        ...(phase.result !== "not returned yet" ? ["result"] : []),
      ],
      edgeIds: index > 0 ? ["value-min-rule"] : [],
      lineNumbers: [phase.line],
    },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(phases.map((item) => item.title), index),
    state: phase.state,
  }, index + 1));
}

export function generateQueueSteps(context: GeneratorContext = {}): Step[] {
  const code = ["start with the waiting line", "add the new item at the back", "read the item at the front", "serve the front item", "the next item becomes front", "return the served order"];
  const sample = compactVisualInput(context, "queue", context.visualizer?.input || {});
  const teachingValues = indexableTeachingValues("queue", sample).map(String);
  const firstItem = teachingValues[0] || "Ana";
  const secondItem = teachingValues[1] || "Bo";
  const thirdItem = teachingValues[2] || "Cy";
  const first = layoutArray([firstItem, secondItem], { y: 260, type: "array-cell" });
  const joined = layoutArray([firstItem, secondItem, thirdItem], { y: 260, type: "array-cell" });
  const served = layoutArray([secondItem, thirdItem], { y: 260, type: "array-cell" });
  return [
    step({ concept: "queue", title: context.title || "Queue", description: "The front leaves first. New arrivals join the back.", nodes: withNodeState(first, ["item-0"], "active"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [1] }, code, activeLine: 1, state: { front: firstItem, back: secondItem } }, 1),
    step({ concept: "queue", title: "Join at the back", description: `${thirdItem} joins behind everyone already waiting.`, nodes: withNodeState(joined, ["item-2"], "active"), edges: [], highlights: { nodeIds: ["item-2"], lineNumbers: [2] }, code, activeLine: 2, state: { front: firstItem, back: thirdItem } }, 2),
    step({ concept: "queue", title: "Front does not move yet", description: `Adding ${thirdItem} does not affect ${firstItem}. The oldest item still owns the front.`, nodes: withNodeState(joined, ["item-0"], "visited"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [3] }, code, activeLine: 3, state: { front: firstItem, back: thirdItem } }, 3),
    step({ concept: "queue", title: "Serve the front", description: `${firstItem} leaves first because ${firstItem} has waited the longest.`, nodes: withNodeState(joined, ["item-0"], "active"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [4] }, code, activeLine: 4, state: { served: firstItem } }, 4),
    step({ concept: "queue", title: "Next front appears", description: `After ${firstItem} leaves, ${secondItem} becomes the front without changing the order of the remaining line.`, nodes: withNodeState(served, ["item-0"], "active"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [5] }, code, activeLine: 5, state: { front: secondItem, back: thirdItem } }, 5),
    step({ concept: "queue", title: "Finish in waiting order", description: "The queue rule is first-in, first-out: the order of service follows the order of arrival.", nodes: withNodeState(served, ["item-0", "item-1"], "visited"), edges: [], highlights: { nodeIds: ["item-0", "item-1"], lineNumbers: [6] }, code, activeLine: 6, state: { rule: "FIFO" } }, 6),
  ];
}

export function generateHelpDeskQueueSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "read each help-desk command",
    "if someone joins, add them to the back",
    "if serving and someone is waiting, remove the front",
    "if serving and nobody is waiting, record none",
    "return the service result",
  ];
  const commands = ["join Ana", "join Bo", "serve", "serve", "serve"];
  const phases = [
    {
      title: context.title || "Help Desk Queue",
      desc: "Read the command list from left to right. Nobody is waiting yet.",
      commandIndex: 0,
      queue: [] as string[],
      served: [] as string[],
      line: 1,
      action: "read first command",
      activeIds: ["cmd-0"],
    },
    {
      title: "Ana joins the back",
      desc: "'join Ana' adds Ana to the rear. Because the line was empty, Ana is also the front.",
      commandIndex: 0,
      queue: ["Ana"],
      served: [] as string[],
      line: 2,
      action: "enqueue",
      activeIds: ["cmd-0", "queue-0"],
    },
    {
      title: "Bo joins behind Ana",
      desc: "'join Bo' adds Bo to the rear. Ana still waits at the front.",
      commandIndex: 1,
      queue: ["Ana", "Bo"],
      served: [] as string[],
      line: 2,
      action: "enqueue",
      activeIds: ["cmd-1", "queue-1"],
    },
    {
      title: "Serve the front",
      desc: "The first serve removes Ana because Ana arrived first.",
      commandIndex: 2,
      queue: ["Bo"],
      served: ["Ana"],
      line: 3,
      action: "dequeue",
      activeIds: ["cmd-2", "served-0"],
    },
    {
      title: "Serve the next front",
      desc: "After Ana leaves, Bo becomes the front and is served next.",
      commandIndex: 3,
      queue: [] as string[],
      served: ["Ana", "Bo"],
      line: 3,
      action: "dequeue",
      activeIds: ["cmd-3", "served-1"],
    },
    {
      title: "Serve an empty queue",
      desc: "The last serve finds nobody waiting, so the result records none.",
      commandIndex: 4,
      queue: [] as string[],
      served: ["Ana", "Bo", "none"],
      line: 4,
      action: "empty serve",
      activeIds: ["cmd-4", "served-2", "empty-line"],
    },
    {
      title: "Return served order",
      desc: "The output follows the service events exactly: Ana, then Bo, then none.",
      commandIndex: 4,
      queue: [] as string[],
      served: ["Ana", "Bo", "none"],
      line: 5,
      action: "return",
      activeIds: ["served-0", "served-1", "served-2"],
    },
  ];

  function makeNodes(phase: typeof phases[number]): Node[] {
    const commandNodes: Node[] = commands.map((command, index) => ({
      id: `cmd-${index}`,
      x: 140 + index * 145,
      y: 130,
      value: command,
      label: index === phase.commandIndex ? "current command" : `command ${index + 1}`,
      type: "logic-node",
      state: index < phase.commandIndex ? "visited" : index === phase.commandIndex ? "active" : "default",
    }));

    const queueNodes: Node[] = phase.queue.length
      ? phase.queue.map((name, index) => ({
          id: `queue-${index}`,
          x: 330 + index * 170,
          y: 300,
          value: name,
          label: index === 0 ? "front" : index === phase.queue.length - 1 ? "rear" : `wait ${index + 1}`,
          type: "array-cell",
          state: "queued",
        }))
      : [{
          id: "empty-line",
          x: 420,
          y: 300,
          value: "empty",
          label: "waiting line",
          type: "logic-node",
          state: "inactive",
        }];

    const servedNodes: Node[] = phase.served.length
      ? phase.served.map((name, index) => ({
          id: `served-${index}`,
          x: 330 + index * 170,
          y: 470,
          value: name,
          label: index === 0 ? "served first" : index === 1 ? "served next" : "empty result",
          type: "logic-node",
          state: name === "none" ? "comparing" : "matched",
        }))
      : [{
          id: "served-empty",
          x: 420,
          y: 470,
          value: "none yet",
          label: "served output",
          type: "logic-node",
          state: "default",
        }];

    return [
      { id: "rule-card", x: 220, y: 40, value: "front leaves first", label: "queue rule", type: "logic-node", state: "default" },
      ...commandNodes,
      { id: "queue-label", x: 160, y: 300, value: "waiting line", label: "queue", type: "logic-node", state: "default" },
      ...queueNodes,
      { id: "served-label", x: 160, y: 470, value: "served order", label: "result", type: "logic-node", state: phase.served.length ? "matched" : "default" },
      ...servedNodes,
    ];
  }

  return phases.map((phase, index) => {
    const nodes = makeNodes(phase);
    const queueEdgeIds = phase.queue.length > 1 ? phase.queue.slice(1).map((_, itemIndex) => `queue-${itemIndex}-queue-${itemIndex + 1}`) : [];
    const servedEdgeIds = phase.served.length > 1 ? phase.served.slice(1).map((_, itemIndex) => `served-${itemIndex}-served-${itemIndex + 1}`) : [];
    const edges: Edge[] = [
      ...queueEdgeIds.map((id) => {
        const [from, to] = id.split("-queue-");
        return { id, from, to: `queue-${to}`, type: "pointer" as const, state: "queued" as const };
      }),
      ...servedEdgeIds.map((id) => {
        const [from, to] = id.split("-served-");
        return { id, from, to: `served-${to}`, type: "pointer" as const, state: "matched" as const };
      }),
    ];
    return step({
      concept: "queue",
      title: phase.title,
      description: phase.desc,
      nodes: withNodeState(nodes, phase.activeIds, "active"),
      edges,
      highlights: { nodeIds: phase.activeIds, edgeIds: [...queueEdgeIds, ...servedEdgeIds], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: {
        command: commands[phase.commandIndex],
        waiting: phase.queue.length ? phase.queue.join(", ") : "empty",
        served: phase.served.length ? phase.served.join(", ") : "none yet",
        action: phase.action,
      },
    }, index + 1);
  });
}

export function generateLinkedListSteps(context: GeneratorContext = {}): Step[] {
  const code = ["current = head", "value = current.value", "next_node = current.next", "current = next_node"];
  const nodes: Node[] = [
    { id: "a", x: 220, y: 260, value: "A", type: "linked-node" },
    { id: "b", x: 450, y: 260, value: "B", type: "linked-node" },
    { id: "c", x: 680, y: 260, value: "C", type: "linked-node" },
  ];
  const edges: Edge[] = [{ from: "a", to: "b", type: "pointer" }, { from: "b", to: "c", type: "pointer" }];
  const phases = [
    { id: "a", title: context.title || "Linked list traversal", desc: "Start at the head node. This is the only reliable entry point.", edge: "" },
    { id: "a", title: "Read current value", desc: "Read A before moving. The current pointer still sits on the head.", edge: "" },
    { id: "b", title: "Follow next link", desc: "The next arrow from A moves current to B.", edge: "a-b" },
    { id: "b", title: "Read B", desc: "At B, read the value and look for the next arrow before leaving.", edge: "a-b" },
    { id: "c", title: "Move to C", desc: "The pointer follows B's next link, keeping the chain intact.", edge: "b-c" },
    { id: "c", title: "Stop at null next", desc: "C has no next node, so traversal stops after using C's value.", edge: "b-c" },
  ];
  return phases.map((phase, index) => step({
    concept: "linked-list",
    title: phase.title,
    description: phase.desc,
    nodes: withNodeState(nodes, [phase.id], "active"),
    edges: withEdgeState(edges, phase.edge ? [phase.edge] : [], "active"),
    highlights: { nodeIds: [phase.id], edgeIds: phase.edge ? [phase.edge] : [], lineNumbers: [Math.min(index + 1, 4)] },
    code,
    activeLine: Math.min(index + 1, 4),
    state: { current: phase.id.toUpperCase(), next: phase.id === "c" ? "null" : phase.id === "a" ? "B" : "C" },
  }, index + 1));
}

export function generateBinarySearchSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "left = 0; right = len(values) - 1",
    "mid = (left + right) // 2",
    "if values[mid] < target: left = mid + 1",
    "if values[mid] > target: right = mid - 1",
    "if values[mid] == target: return mid",
    "return left",
  ];
  const values = [1, 3, 5, 7, 9, 11, 13];
  const phases = [
    { left: 0, mid: 3, right: 6, target: 5, result: "", desc: "Start with the full sorted range. Only sorted data lets us remove half at a time.", line: 1, title: context.title || "Binary search" },
    { left: 0, mid: 3, right: 6, target: 5, result: "", desc: "Check the middle value, 7, before moving either boundary.", line: 2, title: "Check middle" },
    { left: 0, mid: 3, right: 6, target: 5, result: "", desc: "Target 5 is smaller than 7, so indexes 3 through 6 cannot be the answer.", line: 4, title: "Discard right half" },
    { left: 0, mid: 1, right: 2, target: 5, result: "", desc: "The range shrinks to indexes 0 through 2.", line: 1, title: "Use new range" },
    { left: 0, mid: 1, right: 2, target: 5, result: "", desc: "The new middle value is 3.", line: 2, title: "Check new middle" },
    { left: 2, mid: 2, right: 2, target: 5, result: "", desc: "3 is too small, so move left to index 2. One candidate remains.", line: 3, title: "Discard left value" },
    { left: 2, mid: 2, right: 2, target: 5, result: "match at index 2", desc: "The remaining value is 5, which matches the target.", line: 5, title: "Final check" },
    { left: 2, mid: 2, right: 2, target: 5, result: "return index 2", desc: "Return index 2 because values[2] is the target.", line: 5, title: "Return index 2" },
  ];
  return phases.map((phase, index) => {
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex < phase.left || nodeIndex > phase.right ? "inactive" as const : nodeIndex === phase.mid ? "active" as const : "default" as const,
      label: nodeIndex === phase.left ? "left" : nodeIndex === phase.mid ? "mid" : nodeIndex === phase.right ? "right" : String(nodeIndex),
    }));
    nodes.push(
      { id: "target-card", x: 260, y: 430, value: phase.target, type: "logic-node", label: "target", state: "default", meta: { role: "memory" } },
      { id: "range-card", x: 480, y: 430, value: `${phase.left} to ${phase.right}`, type: "logic-node", label: "search range", state: "default", meta: { role: "memory" } },
      { id: "result-card", x: 700, y: 430, value: phase.result || "not returned yet", type: "logic-node", label: "result", state: phase.result ? "matched" : "default", meta: { role: "result" } },
    );
    return step({
      concept: "binary-search",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: phase.result ? [{ id: "match-result", from: `item-${phase.mid}`, to: "result-card", type: "pointer", state: "active" }] : [],
      highlights: { nodeIds: [`item-${phase.mid}`, ...(phase.result ? ["result-card"] : [])], edgeIds: phase.result ? ["match-result"] : [], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      state: { left: phase.left, mid: phase.mid, right: phase.right, target: phase.target, ...(phase.result ? { result: phase.result } : {}) },
    }, index + 1);
  });
}

export function generateTwoPointerSteps(context: GeneratorContext = {}): Step[] {
  const code = ["left = 0; right = len(values) - 1", "pair_value = values[left] + values[right]", "left += 1 or right -= 1", "best = update(best, pair_value)"];
  const values = [1, 4, 7, 10];
  const phases = [
    { left: 0, right: 3, sum: 11, title: context.title || "Two pointers", desc: "Start with one pointer on each side." },
    { left: 0, right: 3, sum: 11, title: "Compare the outer pair", desc: "The pair 1 and 10 is checked against the target rule." },
    { left: 1, right: 3, sum: 14, title: "Move the left pointer", desc: "If the sum is too small, moving left inward can make the sum larger." },
    { left: 1, right: 3, sum: 14, title: "Compare again", desc: "Now 4 and 10 are the only values being decided." },
    { left: 1, right: 2, sum: 11, title: "Move the right pointer", desc: "If the sum is too large, moving right inward can make the sum smaller." },
    { left: 1, right: 2, sum: 11, title: "Return the match or best state", desc: "The final pointer positions explain the answer without checking every pair." },
  ];
  return phases.map((phase, index) => {
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex === phase.left || nodeIndex === phase.right ? "comparing" as const : "default" as const,
      label: nodeIndex === phase.left ? "left" : nodeIndex === phase.right ? "right" : String(nodeIndex),
    }));
    return step({ concept: "two-pointers", title: phase.title, description: phase.desc, nodes, edges: [], highlights: { nodeIds: [`item-${phase.left}`, `item-${phase.right}`], lineNumbers: [Math.min(index + 1, code.length)] }, code, activeLine: Math.min(index + 1, code.length), state: { left: phase.left, right: phase.right, combined: phase.sum } }, index + 1);
  });
}

export function generateSlidingWindowSteps(context: GeneratorContext = {}): Step[] {
  const code = ["left = 0; total = 0; best = 0", "total += values[right]", "best = max(best, total)", "if window too large:", "  total -= values[left]", "  left += 1", "return best"];
  const values = [2, 4, 1, 5];
  const phases = [
    { window: [0, 0], total: 0, best: 0, line: 1, title: context.title || "Sliding window", desc: "Start with an empty total and both edges ready at the left." },
    { window: [0, 0], total: 2, best: 0, line: 2, title: "Add the right item", desc: "The right edge brings 2 into the window." },
    { window: [0, 1], total: 6, best: 0, line: 2, title: "Grow the window", desc: "Add 4 without recounting the previous value." },
    { window: [0, 1], total: 6, best: 6, line: 3, title: "Save the best", desc: "This window is better than the old best, so save 6." },
    { window: [0, 2], total: 7, best: 6, line: 2, title: "Grow once more", desc: "Add 1. Now the window must be checked against the rule." },
    { window: [1, 2], total: 5, best: 6, line: 5, title: "Remove the left item", desc: "Remove 2 from the left edge instead of recounting the whole window." },
    { window: [1, 3], total: 10, best: 10, line: 3, title: "Repeat and update", desc: "The same grow/check/update pattern finds a new best window." },
    { window: [1, 3], total: 10, best: 10, line: 7, title: "Return best", desc: "The answer comes from the best saved window, not just the last move." },
  ];
  return phases.map((phase, index) => {
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex >= phase.window[0] && nodeIndex <= phase.window[1] ? "active" as const : "default" as const,
    }));
    return step({ concept: "sliding-window", title: phase.title, description: phase.desc, nodes, edges: [], highlights: { nodeIds: nodes.filter((node) => node.state === "active").map((node) => node.id), lineNumbers: [phase.line] }, code, activeLine: phase.line, state: { window: `${phase.window[0]}-${phase.window[1]}`, total: phase.total, best: phase.best } }, index + 1);
  });
}

export function generateRecursionSteps(context: GeneratorContext = {}): Step[] {
  const code = ["if base_case: return base_value", "smaller = solve(n - 1)", "answer = combine(n, smaller)", "return answer"];
  const phases = [
    { title: context.title || "Recursion", desc: "Start with the first call. It owns the full problem.", line: 1 },
    { title: "Check for the base case", desc: "The input is not small enough to answer yet, so the function must call itself.", line: 1 },
    { title: "Make a smaller call", desc: "The first call pauses and asks a smaller version to run.", line: 2 },
    { title: "Stack grows", desc: "Each recursive call gets its own frame and waits for the next smaller answer.", line: 2 },
    { title: "Base case stops", desc: "The base case is the first call that can answer without another recursive call.", line: 1 },
    { title: "Return upward", desc: "The base answer returns to the waiting call above it.", line: 4 },
    { title: "Combine one layer", desc: "A waiting frame combines its piece with the smaller returned value.", line: 3 },
    { title: "Return the first answer", desc: "After every frame unwinds, the original call can return the final answer.", line: 4 },
  ];
  return phases.map((phase, index) => {
    const visual = authoredRecursionVisual({}, context, index);
    return step({
      concept: "recursion",
      title: phase.title,
      description: phase.desc,
      nodes: visual.nodes,
      edges: visual.edges,
      highlights: { nodeIds: visual.highlights, edgeIds: visual.edges.filter((edge) => edge.state === "active").map((edge) => edge.id || `${edge.from}-${edge.to}`), lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      state: { depth: Math.min(index + 1, 4) },
    }, index + 1);
  });
}

export function generateNestedRecursionSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "def depth_sum(value, depth):",
    "  if value is a number: return value * depth",
    "  total = 0",
    "  for child in value:",
    "    total += depth_sum(child, depth + 1)",
    "  return total",
  ];
  const frameNode = (id: string, x: number, y: number, label: string, value: string, state: Node["state"] = "default"): Node => ({
    id,
    x,
    y,
    label,
    value,
    type: "function-frame",
    state,
    meta: { role: "call-frame" },
  });
  const listNode = (id: string, x: number, y: number, label: string, value: string, state: Node["state"] = "default"): Node => ({
    id,
    x,
    y,
    label,
    value,
    type: "array-cell",
    state,
    meta: { role: "list-item" },
  });
  const build = (active: string[], returned: string[], total: string): { nodes: Node[]; edges: Edge[] } => {
    const nodes: Node[] = [
      listNode("root-list", 235, 95, "input", "[1,[2,[3]]]", active.includes("root-list") ? "active" : "visited"),
      listNode("one", 130, 215, "depth 1", "1", active.includes("one") ? "active" : returned.includes("one") ? "matched" : "default"),
      listNode("sub-list", 330, 215, "depth 2", "[2,[3]]", active.includes("sub-list") ? "active" : returned.includes("sub-list") ? "matched" : "default"),
      listNode("two", 265, 335, "depth 2", "2", active.includes("two") ? "active" : returned.includes("two") ? "matched" : "default"),
      listNode("deep-list", 455, 335, "depth 3", "[3]", active.includes("deep-list") ? "active" : returned.includes("deep-list") ? "matched" : "default"),
      listNode("three", 455, 455, "depth 3", "3", active.includes("three") ? "active" : returned.includes("three") ? "matched" : "default"),
      frameNode("frame-1", 705, 125, "call depth 1", "total = 0", active.includes("frame-1") ? "active" : "visited"),
      frameNode("frame-2", 705, 245, "call depth 2", returned.includes("frame-2") ? "returns 13" : "waiting", active.includes("frame-2") ? "active" : returned.includes("frame-2") ? "matched" : "default"),
      frameNode("frame-3", 705, 365, "call depth 3", returned.includes("frame-3") ? "returns 9" : "waiting", active.includes("frame-3") ? "active" : returned.includes("frame-3") ? "matched" : "default"),
      { id: "total", x: 705, y: 505, value: total, type: "logic-node", label: "running total", state: total === "14" ? "matched" : "active", meta: { role: "result" } },
    ];
    const edges: Edge[] = [
      { id: "root-one", from: "root-list", to: "one", type: "pointer", state: active.includes("one") || returned.includes("one") ? "active" : "default" },
      { id: "root-sub", from: "root-list", to: "sub-list", type: "pointer", state: active.includes("sub-list") || returned.includes("sub-list") ? "active" : "default" },
      { id: "sub-two", from: "sub-list", to: "two", type: "pointer", state: active.includes("two") || returned.includes("two") ? "active" : "default" },
      { id: "sub-deep", from: "sub-list", to: "deep-list", type: "pointer", state: active.includes("deep-list") || returned.includes("deep-list") ? "active" : "default" },
      { id: "deep-three", from: "deep-list", to: "three", type: "pointer", state: active.includes("three") || returned.includes("three") ? "active" : "default" },
      { id: "frames", from: "frame-1", to: "frame-2", type: "pointer", state: active.includes("frame-2") || returned.includes("frame-2") ? "active" : "default" },
      { id: "frames-deep", from: "frame-2", to: "frame-3", type: "pointer", state: active.includes("frame-3") || returned.includes("frame-3") ? "active" : "default" },
    ];
    return { nodes, edges };
  };
  const phases = [
    { title: context.title || "Read nested list", desc: "Start with a small nested list so every recursive call can be shown.", active: ["root-list", "frame-1"], returned: [] as string[], total: "0", line: 1, state: { input: "[1,[2,[3]]]", depth: 1 } },
    { title: "Use number 1", desc: "A number returns immediately: 1 at depth 1 contributes 1.", active: ["one", "frame-1"], returned: ["one"], total: "1", line: 2, state: { contribution: "1 x 1 = 1", total: 1 } },
    { title: "Enter nested list", desc: "The nested list creates a new function frame at depth 2.", active: ["sub-list", "frame-2"], returned: ["one"], total: "1", line: 5, state: { depth: 2 } },
    { title: "Use number 2", desc: "2 is inside depth 2, so it contributes 4.", active: ["two", "frame-2"], returned: ["one", "two"], total: "5", line: 2, state: { contribution: "2 x 2 = 4", total: 5 } },
    { title: "Enter deeper list", desc: "The [3] list creates a third frame because recursion found another list.", active: ["deep-list", "frame-3"], returned: ["one", "two"], total: "5", line: 5, state: { depth: 3 } },
    { title: "Use number 3", desc: "3 is at depth 3, so it contributes 9.", active: ["three", "frame-3"], returned: ["one", "two", "three"], total: "14", line: 2, state: { contribution: "3 x 3 = 9", total: 14 } },
    { title: "Return from inner frames", desc: "The depth-3 frame returns 9, then the depth-2 frame combines it with 4.", active: ["frame-2", "frame-3"], returned: ["one", "two", "three", "frame-3", "deep-list", "frame-2", "sub-list"], total: "14", line: 6, state: { returned: "4 + 9 = 13" } },
    { title: "Return total 14", desc: "The first frame combines 1 with 13 and returns 14.", active: ["total"], returned: ["one", "two", "three", "frame-3", "deep-list", "frame-2", "sub-list"], total: "14", line: 6, state: { result: 14 } },
  ];
  return phases.map((phase, index) => {
    const visual = build(phase.active, phase.returned, phase.total);
    const activeEdges = visual.edges.filter((edge) => edge.state === "active").map((edge) => edge.id || "");
    return step({
      concept: "recursion",
      title: phase.title,
      description: phase.desc,
      nodes: visual.nodes,
      edges: visual.edges,
      highlights: { nodeIds: phase.active, edgeIds: activeEdges, lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateMatrixSteps(context: GeneratorContext = {}): Step[] {
  const code = ["row = current_row", "col = current_col", "value = grid[row][col]", "answer = update(answer, value)", "row, col = next_cell(row, col)", "if row < rows and col < cols: continue", "return answer"];
  const values = [1, 2, 3, 4, 5, 6];
  const nodes = values.map((value, index) => ({ id: `cell-${index}`, x: 350 + (index % 3) * 96, y: 180 + Math.floor(index / 3) * 96, value, type: "array-cell" as const, label: `${Math.floor(index / 3)},${index % 3}` }));
  const phases = [
    { cell: 0, title: context.title || "Start at row 0", desc: "Use row and column together so the scan starts at one exact cell.", line: 1, state: { row: 0, column: 0 } },
    { cell: 0, title: "Set column 0", desc: "The column value completes the address grid[0][0].", line: 2, state: { row: 0, column: 0 } },
    { cell: 0, title: "Read cell 0,0", desc: "Read the value in the active cell before updating the answer.", line: 3, state: { value: 1 } },
    { cell: 0, title: "Update answer", desc: "Use the cell value to update the running answer.", line: 4, state: { answer: 1 } },
    { cell: 1, title: "Move to next cell", desc: "Advance the column so the scan does not read the same cell twice.", line: 5, state: { row: 0, column: 1 } },
    { cell: 5, title: "Check the edge", desc: "After the last cell, the bounds check tells the loop to stop.", line: 6, state: { row: 1, column: 2, bounds: "last valid cell" } },
    { cell: 5, title: "Return the answer", desc: "The final answer comes after every intended cell has been considered.", line: 7, state: { result: "answer" } },
  ];
  return phases.map((phase, index) => step({
    concept: "matrix",
    title: phase.title,
    description: phase.desc,
    nodes: withNodeState(nodes, [`cell-${phase.cell}`], index === phases.length - 1 ? "visited" : "active"),
    edges: [],
    highlights: { nodeIds: [`cell-${phase.cell}`], lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    state: phase.state,
  }, index + 1));
}

export function generatePrefixSumSteps(context: GeneratorContext = {}): Step[] {
  const code = ["running = 0", "running += value", "prefix[index] = running", "left_saved = prefix[left - 1]", "right_saved = prefix[right]", "range_sum = right_saved - left_saved", "return range_sum"];
  const values = exampleNumbers(context);
  const usable = values.length ? [...values] : [2, 4, 1, 3];
  while (usable.length < 4) usable.push([2, 4, 1, 3][usable.length]);
  const phases = [
    { active: 0, total: 0, title: context.title || "Prefix sum", desc: "Start with a running total of 0 before reading the list.", line: 1 },
    { active: 0, total: 2, title: "Add index 0", desc: "Add the first value. The running total now covers index 0.", line: 2 },
    { active: 0, total: 2, title: "Save prefix 0", desc: "Store that total so future range questions can reuse it.", line: 3 },
    { active: 1, total: 6, title: "Add index 1", desc: "Add the next value to the same running total.", line: 2 },
    { active: 2, total: 7, title: "Save more prefixes", desc: "Repeat add, then save. Each prefix cell records the sum up to that index.", line: 3 },
    { active: 3, total: 10, title: "Finish prefix table", desc: "Once the table is filled, range answers become lookups.", line: 3 },
    { active: 2, total: 10, title: "Read range endpoints", desc: "For a middle range, read the saved total at the right edge and before the left edge.", line: 4 },
    { active: 2, total: 5, title: "Subtract and return", desc: "Subtract the saved prefix before the range. The result is the range sum.", line: 6 },
  ];
  return phases.map((phase, index) => {
    const visual = authoredPrefixSumVisual({ items: usable }, context, phase.active);
    return step({ concept: "prefix-sum", title: phase.title, description: phase.desc, nodes: visual.nodes, edges: visual.edges, highlights: { nodeIds: visual.highlights, edgeIds: visual.edges.filter((edge) => edge.state === "active").map((edge) => edge.id || `${edge.from}-${edge.to}`), lineNumbers: [phase.line] }, code, activeLine: phase.line, state: { running_total: phase.total } }, index + 1);
  });
}

export function generateIntervalsSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "intervals.sort()",
    "previous = intervals[0]",
    "next = intervals[index]",
    "if next.start < previous.end: return false",
    "previous = next",
    "return true",
  ];
  const intervalNodes = (activeIds: string[], overlapIds: string[] = [], result = "not decided"): Node[] => [
    { id: "timeline", x: 455, y: 100, value: "9     10     11     12", type: "logic-node", label: "time line", state: "default", meta: { role: "memory" } },
    { id: "a", x: 275, y: 220, value: "9-10", type: "array-cell", label: "A", state: activeIds.includes("a") ? "active" : "visited", meta: { role: "interval" } },
    { id: "b", x: 445, y: 300, value: "10-11", type: "array-cell", label: "B", state: overlapIds.includes("b") ? "comparing" : activeIds.includes("b") ? "active" : "default", meta: { role: "interval" } },
    { id: "c", x: 470, y: 390, value: "10-12", type: "array-cell", label: "C", state: overlapIds.includes("c") ? "comparing" : activeIds.includes("c") ? "active" : "default", meta: { role: "interval" } },
    { id: "decision", x: 705, y: 300, value: result, type: "logic-node", label: "overlap check", state: result === "false" ? "matched" : activeIds.includes("decision") ? "active" : "default", meta: { role: "result" } },
  ];
  const phases = [
    { active: ["a", "b", "c"], overlap: [], title: context.title || "Sort time ranges", desc: "Use a compact schedule: A 9-10, B 10-11, C 10-12.", line: 1, result: "not decided", state: { sorted: "A, B, C" } },
    { active: ["a"], overlap: [], title: "Keep A as previous", desc: "A becomes the saved range to compare against the next class.", line: 2, result: "not decided", state: { previous: "A 9-10" } },
    { active: ["a", "b"], overlap: [], title: "Compare A with B", desc: "B starts at 10 and A ends at 10, so they touch but do not overlap.", line: 4, result: "no overlap", state: { check: "10 < 10 is false" } },
    { active: ["b"], overlap: [], title: "Carry B forward", desc: "Since B is safe with A, B becomes the previous range.", line: 5, result: "not decided", state: { previous: "B 10-11" } },
    { active: ["b", "c"], overlap: ["b", "c"], title: "Compare B with C", desc: "C starts at 10 before B ends at 11, so these two classes overlap.", line: 4, result: "overlap found", state: { check: "10 < 11 is true" } },
    { active: ["decision"], overlap: ["b", "c"], title: "Stop on conflict", desc: "One overlap is enough to make the study schedule invalid.", line: 4, result: "false", state: { conflict: "B overlaps C" } },
    { active: ["decision"], overlap: ["b", "c"], title: "Return false", desc: "Return false because the schedule has a time conflict.", line: 4, result: "false", state: { result: "false" } },
  ];
  return phases.map((phase, index) => {
    const nodes = intervalNodes(phase.active, phase.overlap, phase.result);
    const edges: Edge[] = phase.active.includes("decision") || phase.overlap.length
      ? [{ id: "conflict-result", from: "c", to: "decision", type: "pointer", state: "active" }]
      : [];
    return step({
      concept: "intervals",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges,
      highlights: { nodeIds: [...phase.active, ...phase.overlap, ...(phase.result === "false" ? ["decision"] : [])], edgeIds: edges.map((edge) => edge.id || ""), lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateHeapSteps(context: GeneratorContext = {}): Step[] {
  const code = ["add the value at the next open spot", "find its parent", "compare child priority with parent priority", "swap upward when the child outranks the parent", "keep checking from the new position", "repeat until the heap rule holds", "return the top value"];
  const values = [50, 40, 30, 10, 25, 20];
  const before = treeFromArray(values.slice(0, 5), 0);
  const inserted = treeFromArray(values, 5);
  const after = treeFromArray(values, 0);
  return [
    step({ concept: "heap", title: context.title || "Heap", description: "A heap keeps the priority item easy to reach at the top.", nodes: before.nodes, edges: before.edges, highlights: { lineNumbers: [1] }, code, activeLine: 1, state: { top: 40 } }, 1),
    step({ concept: "heap", title: "Add at the open spot", description: "The new value first lands in the next open tree position.", nodes: withNodeState(inserted.nodes, ["tree-5"], "active"), edges: inserted.edges, highlights: { nodeIds: ["tree-5"], lineNumbers: [1] }, code, activeLine: 1, state: { inserted: 50 } }, 2),
    step({ concept: "heap", title: "Compare with parent", description: "The new value checks whether it has higher priority than its parent.", nodes: withNodeState(inserted.nodes, ["tree-2", "tree-5"], "comparing"), edges: inserted.edges, highlights: { nodeIds: ["tree-2", "tree-5"], lineNumbers: [2] }, code, activeLine: 2, state: { parent: 30, child: 50 } }, 3),
    step({ concept: "heap", title: "Bubble up", description: "A higher-priority value moves upward by swapping with parents.", nodes: withNodeState(after.nodes, ["tree-0", "tree-2"], "active"), edges: after.edges, highlights: { nodeIds: ["tree-0", "tree-2"], lineNumbers: [3] }, code, activeLine: 3, state: { top: 50 } }, 4),
    step({ concept: "heap", title: "Check again", description: "After each swap, the item checks its new parent. This is what makes bubbling repeat safely.", nodes: withNodeState(after.nodes, ["tree-0"], "comparing"), edges: after.edges, highlights: { nodeIds: ["tree-0"], lineNumbers: [5, 6] }, code, activeLine: 6, state: { top: 50 } }, 5),
    step({ concept: "heap", title: "Check the top", description: "After bubbling, the highest-priority item is easy to read at the root.", nodes: withNodeState(after.nodes, ["tree-0"], "active"), edges: after.edges, highlights: { nodeIds: ["tree-0"], lineNumbers: [7] }, code, activeLine: 7, state: { top: 50 } }, 6),
    step({ concept: "heap", title: "Finish with heap order", description: "Every parent now keeps priority over its children, so later operations can trust the heap.", nodes: withNodeState(after.nodes, ["tree-0"], "visited"), edges: after.edges, highlights: { nodeIds: ["tree-0"], lineNumbers: [7] }, code, activeLine: 7, state: { invariant: "parent priority >= child priority" } }, 7),
  ];
}

export function generateTrieSteps(context: GeneratorContext = {}): Step[] {
  const code = ["node = root", "char = word[index]", "if char not in node.children:", "node = node.children[char]", "node.is_word = True", "repeat for next word", "return prefix match"];
  const nodes: Node[] = [
    { id: "root", x: 450, y: 90, value: "root", type: "tree-node" },
    { id: "c", x: 330, y: 210, value: "c", type: "tree-node" },
    { id: "ca", x: 280, y: 330, value: "a", type: "tree-node" },
    { id: "co", x: 420, y: 330, value: "o", type: "tree-node" },
  ];
  const edges: Edge[] = [{ from: "root", to: "c", type: "parent-child" }, { from: "c", to: "ca", type: "parent-child" }, { from: "c", to: "co", type: "parent-child" }];
  const phases = [
    { active: "root", title: context.title || "Trie prefix path", desc: "Start at the root before reading any character.", edge: "" },
    { active: "c", title: "Read c", desc: "The first character chooses the c branch.", edge: "root-c" },
    { active: "ca", title: "Follow a", desc: "A word beginning with ca follows the a child.", edge: "c-ca" },
    { active: "ca", title: "Mark one word ending", desc: "If ca is a complete word, this node stores that fact.", edge: "c-ca" },
    { active: "co", title: "Reuse shared prefix", desc: "A word beginning with co reuses the existing c node, then branches to o.", edge: "c-co" },
    { active: "c", title: "Search a prefix", desc: "A prefix lookup stops after the shared letters instead of needing a whole word.", edge: "root-c" },
    { active: "co", title: "Finish lookup", desc: "The final node tells whether the whole prefix or word exists.", edge: "c-co" },
  ];
  return phases.map((phase, index) => step({ concept: "trie", title: phase.title, description: phase.desc, nodes: withNodeState(nodes, [phase.active], "active"), edges: withEdgeState(edges, phase.edge ? [phase.edge] : [], "active"), highlights: { nodeIds: [phase.active], edgeIds: phase.edge ? [phase.edge] : [], lineNumbers: [Math.min(index + 1, code.length)] }, code, activeLine: Math.min(index + 1, code.length), state: { character: phase.active === "root" ? "start" : phase.active.at(-1) || phase.active } }, index + 1));
}

export function generateUnionFindSteps(context: GeneratorContext = {}): Step[] {
  const code = ["parent[item] = item", "root_a = find(a)", "root_b = find(b)", "if root_a != root_b: parent[root_a] = root_b", "root = find(item)", "parent[item] = root", "return count_roots(parent)"];
  const start = layoutCircularGraph(["A", "B", "C", "D"], []);
  const connected = layoutCircularGraph(["A", "B", "C", "D"], [["A", "B"], ["C", "D"]]);
  const merged = layoutCircularGraph(["A", "B", "C", "D"], [["A", "B"], ["B", "C"], ["C", "D"]]);
  return [
    step({ concept: "union-find", title: context.title || "Union find", description: "Every item begins as its own group.", nodes: start.nodes, edges: start.edges, highlights: { lineNumbers: [1] }, code, activeLine: 1, state: { groups: 4 } }, 1),
    step({ concept: "union-find", title: "Find A leader", description: "Find follows parent links until it reaches A's group leader.", nodes: withNodeState(start.nodes, ["A"], "active"), edges: start.edges, highlights: { nodeIds: ["A"], lineNumbers: [2] }, code, activeLine: 2, state: { leader_A: "A" } }, 2),
    step({ concept: "union-find", title: "Find B leader", description: "B has a different leader, so A and B can be connected.", nodes: withNodeState(start.nodes, ["B"], "active"), edges: start.edges, highlights: { nodeIds: ["B"], lineNumbers: [2] }, code, activeLine: 2, state: { leader_B: "B" } }, 3),
    step({ concept: "union-find", title: "Connect pairs", description: "Union links two separate leaders into one group.", nodes: withNodeState(connected.nodes, ["A", "B"], "active"), edges: withEdgeState(connected.edges, ["A-B"], "active"), highlights: { nodeIds: ["A", "B"], edgeIds: ["A-B"], lineNumbers: [3] }, code, activeLine: 3, state: { groups: 2 } }, 4),
    step({ concept: "union-find", title: "Merge groups", description: "Connecting B and C joins two groups into a larger one.", nodes: withNodeState(merged.nodes, ["B", "C"], "active"), edges: withEdgeState(merged.edges, ["B-C"], "active"), highlights: { nodeIds: ["B", "C"], edgeIds: ["B-C"], lineNumbers: [4] }, code, activeLine: 4, state: { groups: 1 } }, 5),
    step({ concept: "union-find", title: "Compress the path", description: "A later find can point an item directly at its leader, making the next lookup shorter.", nodes: withNodeState(merged.nodes, ["A", "B", "C"], "comparing"), edges: withEdgeState(merged.edges, ["A-B", "B-C"], "active"), highlights: { nodeIds: ["A", "B", "C"], edgeIds: ["A-B", "B-C"], lineNumbers: [5, 6] }, code, activeLine: 6, state: { compressed: "A -> leader" } }, 6),
    step({ concept: "union-find", title: "Count final leaders", description: "After unions, the answer comes from the remaining distinct leaders.", nodes: withNodeState(merged.nodes, ["A", "B", "C", "D"], "visited"), edges: merged.edges, highlights: { nodeIds: ["A", "B", "C", "D"], lineNumbers: [7] }, code, activeLine: 7, state: { groups: 1 } }, 7),
  ];
}

export function generateDynamicProgrammingSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "dp[0] = base_answer",
    "for state from 1 to target:",
    "  read smaller saved answers",
    "  candidate = combine(smaller answers)",
    "  dp[state] = best candidate",
    "return dp[target]",
  ];
  const baseNodes = Array.from({ length: 5 }, (_, index) => ({
    id: `dp-${index}`,
    x: 260 + index * 110,
    y: 230,
    value: "",
    type: "array-cell" as const,
    label: `dp[${index}]`,
  }));
  const phases = [
    {
      active: 4,
      filled: -1,
      title: context.title || "Dynamic programming goal",
      description: "We want dp[4]. Instead of solving it all at once, build smaller saved answers first.",
      line: 2,
      state: { target: "dp[4]", saved: "none yet" },
    },
    {
      active: 0,
      filled: 0,
      title: "Save the base case",
      description: "The smallest state is already known, so store it in dp[0].",
      line: 1,
      state: { saved: "dp[0]", value: 1 },
    },
    {
      active: 1,
      filled: 0,
      title: "Read a saved answer",
      description: "To fill dp[1], read dp[0] instead of recalculating the base case.",
      line: 3,
      state: { reading: "dp[0]", building: "dp[1]" },
    },
    {
      active: 1,
      filled: 1,
      title: "Save dp[1]",
      description: "After using the smaller answer, store the new answer so later states can reuse it.",
      line: 5,
      state: { saved: "dp[1]", value: 1 },
    },
    {
      active: 2,
      filled: 2,
      title: "Combine earlier cells",
      description: "dp[2] can use saved answers such as dp[1] and dp[0]. The table prevents repeated work.",
      line: 4,
      state: { reading: "dp[1], dp[0]", saved: "dp[2]" },
    },
    {
      active: 3,
      filled: 3,
      title: "Repeat the same rule",
      description: "Each new state follows the same rule: read earlier cells, choose the best answer, then save it.",
      line: 5,
      state: { saved: "dp[0] through dp[3]" },
    },
    {
      active: 4,
      filled: 4,
      title: "Fill the target cell",
      description: "Now dp[4] is filled from earlier saved answers, so the hard-looking answer is just a lookup.",
      line: 5,
      state: { saved: "dp[4]", value: "answer" },
    },
    {
      active: 4,
      filled: 4,
      title: "Return dp[4]",
      description: "The final result comes from the target cell, not from recomputing the whole problem.",
      line: 6,
      state: { result: "dp[4]" },
    },
  ];

  return phases.map((phase, index) => {
    const nodes = baseNodes.map((node, nodeIndex) => ({
      ...node,
      value: nodeIndex <= phase.filled ? (nodeIndex <= 1 ? 1 : nodeIndex + 1) : "",
      state: nodeIndex < phase.filled ? "visited" as const : node.state,
    }));
    return step({
      concept: "dynamic-programming",
      title: phase.title,
      description: phase.description,
      nodes: withNodeState(nodes, [`dp-${phase.active}`], "active"),
      edges: [],
      highlights: { nodeIds: [`dp-${phase.active}`], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      state: phase.state,
    }, index + 1);
  });
}

export function generateBitSteps(context: GeneratorContext = {}): Step[] {
  const code = ["bits = binary(number)", "bit = bits[index]", "if bit == 1: result += 1", "index += 1", "repeat for next bit", "return result"];
  const bits = [1, 0, 1, 1, 0, 1, 0];
  let count = 0;
  return bits.map((bit, index) => {
    if (bit) count += 1;
    return step({ concept: "bit-manipulation", title: context.title || "Bit manipulation", description: `Inspect bit ${bit}. A 1 changes the count or mask; a 0 usually does not.`, nodes: withNodeState(layoutArray(bits), [`item-${index}`], bit ? "active" : "comparing"), edges: [], highlights: { nodeIds: [`item-${index}`], lineNumbers: [Math.min(index + 1, 4)] }, code, activeLine: Math.min(index + 1, 4), state: { ones_seen: count } }, index + 1);
  });
}

function mathFlowNodes(items: Array<{ id: string; label: string; value: string | number }>): Node[] {
  const gap = Math.min(128, Math.max(96, 720 / Math.max(items.length, 1)));
  const totalWidth = Math.max(0, (items.length - 1) * gap);
  const startX = 450 - totalWidth / 2;
  return items.map((item, index) => ({
    id: item.id,
    x: startX + index * gap,
    y: 260,
    value: item.value,
    type: "logic-node",
    label: item.label,
    state: index === 0 ? "visited" : "default",
    meta: { role: "formula-cell" },
  }));
}

function buildMathFlowSteps({
  conceptTitle,
  code,
  nodes,
  phases,
}: {
  conceptTitle: string;
  code: string[];
  nodes: Node[];
  phases: Array<{
    title: string;
    description: string;
    active: string;
    line: number;
    state: Record<string, string | number>;
    visited?: string[];
  }>;
}): Step[] {
  const labels = phases.map((phase) => phase.title);
  return phases.map((phase, index) => step({
    concept: "math",
    title: phase.title,
    description: phase.description,
    nodes: withNodeState(nodes.map((node) => ({
      ...node,
      state: phase.visited?.includes(node.id) ? "visited" : node.state,
    })), [phase.active], "active"),
    edges: [],
    highlights: { nodeIds: [phase.active], lineNumbers: [phase.line] },
    code,
    activeLine: phase.line,
    workflow: workflowFromLabels(labels, index),
    state: { problem: conceptTitle, ...phase.state },
  }, index + 1));
}

export function generateLastDigitSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "read the number",
    "look at the ones place",
    "keep only that digit",
    "return the digit",
  ];
  const nodes = mathFlowNodes([
    { id: "math-number", label: "number", value: 384 },
    { id: "math-ones", label: "ones place", value: "last digit" },
    { id: "math-digit", label: "kept digit", value: 4 },
    { id: "math-result", label: "result", value: 4 },
  ]);
  return buildMathFlowSteps({
    conceptTitle: context.title || "Last Digit",
    code,
    nodes,
    phases: [
      { title: "Read 384", description: "Start with the full number before removing anything.", active: "math-number", line: 1, state: { example: "number=384", final_result: "none yet" } },
      { title: "Find ones place", description: "The digit at the far right is the ones-place digit.", active: "math-ones", line: 2, visited: ["math-number"], state: { ones_place: 4, final_result: "none yet" } },
      { title: "Keep 4", description: "Only the last digit is needed for the answer.", active: "math-digit", line: 3, visited: ["math-number", "math-ones"], state: { kept_digit: 4, final_result: "none yet" } },
      { title: "Return 4", description: "Return the digit that was kept from the ones place.", active: "math-result", line: 4, visited: ["math-number", "math-ones", "math-digit"], state: { final_result: 4 } },
    ],
  });
}

export function generateCountDigitsSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "start count at zero",
    "remove one digit from the right",
    "increase count",
    "repeat until no digits remain",
    "return count",
  ];
  const nodes = mathFlowNodes([
    { id: "math-start", label: "number", value: 5029 },
    { id: "math-one", label: "after 1 digit", value: 502 },
    { id: "math-two", label: "after 2 digits", value: 50 },
    { id: "math-three", label: "after 3 digits", value: 5 },
    { id: "math-four", label: "after 4 digits", value: 0 },
    { id: "math-result", label: "result", value: 4 },
  ]);
  return buildMathFlowSteps({
    conceptTitle: context.title || "Count Digits",
    code,
    nodes,
    phases: [
      { title: "Start count", description: "Begin with 5029 and count at 0.", active: "math-start", line: 1, state: { number_left: 5029, count: 0, final_result: "none yet" } },
      { title: "Remove 9", description: "One digit was removed, so the count becomes 1.", active: "math-one", line: 2, visited: ["math-start"], state: { number_left: 502, count: 1, final_result: "none yet" } },
      { title: "Remove 2", description: "A second digit was removed from the right.", active: "math-two", line: 3, visited: ["math-start", "math-one"], state: { number_left: 50, count: 2, final_result: "none yet" } },
      { title: "Remove 0", description: "A zero digit still counts as a digit.", active: "math-three", line: 3, visited: ["math-start", "math-one", "math-two"], state: { number_left: 5, count: 3, final_result: "none yet" } },
      { title: "Remove 5", description: "No digits remain after the fourth removal.", active: "math-four", line: 4, visited: ["math-start", "math-one", "math-two", "math-three"], state: { number_left: 0, count: 4, final_result: "none yet" } },
      { title: "Return 4", description: "The count tells how many digits were removed.", active: "math-result", line: 5, visited: ["math-start", "math-one", "math-two", "math-three", "math-four"], state: { final_result: 4 } },
    ],
  });
}

export function generateGradePointsNeededSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "read current points and target points",
    "subtract current from target",
    "if the target is already met, use zero",
    "return points still needed",
  ];
  const nodes = mathFlowNodes([
    { id: "math-current", label: "current", value: 72 },
    { id: "math-target", label: "target", value: 80 },
    { id: "math-difference", label: "target - current", value: "80 - 72" },
    { id: "math-needed", label: "needed", value: 8 },
    { id: "math-result", label: "result", value: 8 },
  ]);
  return buildMathFlowSteps({
    conceptTitle: context.title || "Grade Points Needed",
    code,
    nodes,
    phases: [
      { title: "Read points", description: "The student has 72 points and wants 80.", active: "math-current", line: 1, state: { current: 72, target: 80, final_result: "none yet" } },
      { title: "Read target", description: "The target is the score we compare against.", active: "math-target", line: 1, visited: ["math-current"], state: { current: 72, target: 80, final_result: "none yet" } },
      { title: "Subtract", description: "Find the gap between the target and the current score.", active: "math-difference", line: 2, visited: ["math-current", "math-target"], state: { gap: "80 - 72", final_result: "none yet" } },
      { title: "Keep 8", description: "The gap is positive, so 8 more points are needed.", active: "math-needed", line: 3, visited: ["math-current", "math-target", "math-difference"], state: { points_needed: 8, final_result: "none yet" } },
      { title: "Return 8", description: "Return the number of points still needed.", active: "math-result", line: 4, visited: ["math-current", "math-target", "math-difference", "math-needed"], state: { final_result: 8 } },
    ],
  });
}

export function generateRoundUpLabGroupsSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "read students and group size",
    "count full groups",
    "check leftover students",
    "if leftovers exist, add one group",
    "return total groups",
  ];
  const nodes = mathFlowNodes([
    { id: "math-students", label: "students", value: 23 },
    { id: "math-size", label: "group size", value: 5 },
    { id: "math-full", label: "full groups", value: 4 },
    { id: "math-leftover", label: "leftover", value: 3 },
    { id: "math-extra", label: "extra group", value: "+1" },
    { id: "math-result", label: "result", value: 5 },
  ]);
  return buildMathFlowSteps({
    conceptTitle: context.title || "Round Up Lab Groups",
    code,
    nodes,
    phases: [
      { title: "Read students", description: "There are 23 students to place into groups.", active: "math-students", line: 1, state: { students: 23, group_size: 5, final_result: "none yet" } },
      { title: "Read group size", description: "Each group can hold 5 students.", active: "math-size", line: 1, visited: ["math-students"], state: { students: 23, group_size: 5, final_result: "none yet" } },
      { title: "Make 4 full groups", description: "Four full groups hold 20 students.", active: "math-full", line: 2, visited: ["math-students", "math-size"], state: { full_groups: 4, students_placed: 20, final_result: "none yet" } },
      { title: "Find 3 leftovers", description: "Three students are still ungrouped after the full groups.", active: "math-leftover", line: 3, visited: ["math-students", "math-size", "math-full"], state: { leftover_students: 3, final_result: "none yet" } },
      { title: "Add one group", description: "Any leftover students need one more group.", active: "math-extra", line: 4, visited: ["math-students", "math-size", "math-full", "math-leftover"], state: { total_groups: 5, final_result: "none yet" } },
      { title: "Return 5", description: "Five groups are enough for all 23 students.", active: "math-result", line: 5, visited: ["math-students", "math-size", "math-full", "math-leftover", "math-extra"], state: { final_result: 5 } },
    ],
  });
}

export function generateMathSteps(context: GeneratorContext = {}): Step[] {
  const code = ["read the given numbers", "apply the first calculation", "apply the next calculation", "adjust if the rule requires it", "check the final value", "return the computed answer"];
  const nodes = layoutArray(["base", "+ fee", "- discount", "limit", "format", "total"], { gap: 110 }).map((node) => ({
    ...node,
    meta: { role: "formula-cell" },
  }));
  return nodes.map((node, index) => step({ concept: "math", title: context.title || "Arithmetic state", description: "Math problems are easiest when each piece of the formula changes one state value.", nodes: withNodeState(nodes, [node.id], "active"), edges: [], highlights: { nodeIds: [node.id], lineNumbers: [Math.min(index + 1, 4)] }, code, activeLine: Math.min(index + 1, 4), state: { step: node.value } }, index + 1));
}

export function generateStepsForConcept(concept: string, context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily(concept, context);
  if (family === "array-maximum-score") return generateMaximumScoreSteps(context);
  if (family === "array-sum-even") return generateSumEvenNumbersSteps(context);
  if (family === "array-dedupe-order") return generateArrayDedupeOrderSteps(context);
  if (family === "array-smallest-positive") return generateSmallestPositiveSteps(context);
  if (family === "array-find-index") return generateFindIndexSteps(context);
  if (family === "array-merge-names") return generateMergeNamesSteps(context);
  if (family === "array-threshold-count") return generateThresholdCountSteps(context);
  if (family === "array-truthy-count") return generateTruthyAttendanceSteps(context);
  if (family === "array-every-other") return generateEveryOtherItemSteps(context);
  if (family === "array-comfort-count") return generateComfortCountSteps(context);
  if (family === "array-plant-care-days") return generatePlantCareDaysSteps(context);
  if (family === "array-rotate") return generateArrayRotationSteps(context);
  if (family === "set-first-missing") return generateFirstMissingPositiveSteps(context);
  if (family === "string-run-compress") return generateStringRunCompressSteps(context);
  if (
    family === "string-count-vowels" ||
    family === "string-reverse-words" ||
    family === "string-count-words" ||
    family === "string-course-code" ||
    family === "string-initials" ||
    family === "string-normalize-emails" ||
    family === "string-prefix-search"
  ) return generateStringScanSteps(context);
  if (family === "graph-islands") return generateGraphIslandsSteps(context);
  if (family === "stack-min") return generateMinStackSteps(context);
  if (family === "recursion-nested-list") return generateNestedRecursionSteps(context);
  if (family === "queue-help-desk") return generateHelpDeskQueueSteps(context);
  if (family === "conditional-flow") return generateConditionalSteps(context);
  if (family === "math-last-digit") return generateLastDigitSteps(context);
  if (family === "math-count-digits") return generateCountDigitsSteps(context);
  if (family === "math-grade-points") return generateGradePointsNeededSteps(context);
  if (family === "math-round-groups") return generateRoundUpLabGroupsSteps(context);
  if (family === "tuple-pair") return generateTupleSteps(context);
  if (family === "tuple-swap") return generateTupleSwapSteps(context);
  if (family === "tuple-score-at-index") return generateStudentScorePairSteps(context);
  if (family === "tuple-first-last") return generateFirstLastPairSteps(context);
  const authoredSteps = generateAuthoredVisualizerSteps(concept, context);
  if (authoredSteps) return authoredSteps;

  switch (family) {
    case "array-dedupe":
      return generateArrayDedupeSteps(context);
    case "array-filter":
      return generateArrayFilterSteps(context);
    case "array-running-total":
      return generateArrayRunningTotalSteps(context);
    case "array-search":
      return generateArraySearchSteps(context);
    case "array-max-min":
      return generateArrayMaxMinSteps(context);
    case "string-palindrome":
    case "string-scan":
      return generateStringScanSteps(context);
    case "hash-frequency":
      return generateHashFrequencySteps(context);
    case "hash-grouping":
      return generateHashGroupingSteps(context);
    case "hash-complement":
      return generateHashComplementSteps(context);
    default:
      break;
  }

  switch (concept) {
    case "tuple":
      return generateTupleSteps(context);
    case "set":
      return generateSetSteps(context);
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
