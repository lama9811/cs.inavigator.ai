import type { ConceptType, Edge, GeneratorContext, Node, Step, WorkflowStep } from "./types";
import { insertTreeValue, layoutArray, layoutCircularGraph, layoutConditional, layoutHashBuckets, layoutTree } from "./layouts";

const WORKFLOW_LABELS: Record<ConceptType, string[]> = {
  array: ["Load", "Index 0", "Compare", "Update", "Move", "Return"],
  tuple: ["Load lists", "Align index", "Read pair", "Build tuple", "Save", "Return"],
  set: ["Load items", "Check memory", "First keep", "Duplicate check", "Update set", "Return"],
  "linked-list": ["Head", "Read node", "Save next", "Move current", "Null check", "Return"],
  "hash-map": ["Choose key", "Hash bucket", "Compare entry", "Insert/update", "Lookup result", "Return"],
  "binary-tree": ["Root", "Compare", "Follow", "Insert/visit", "Rebalance", "Check rule", "Finish"],
  graph: ["Start", "Visit", "Add neighbors", "Next node", "Skip repeat", "Trace path", "Finish"],
  search: ["Load", "Check item", "No match", "Move", "Match/stop", "Return"],
  sort: ["Load", "Compare pair", "Swap/move", "Next pair", "Repeat pass", "Return"],
  conditional: ["Input", "Question", "True path", "False path", "Chosen result", "Return"],
  stack: ["Empty", "Push first", "Push next", "Peek top", "Pop top", "Finish"],
  queue: ["Line starts", "Join back", "Front waits", "Serve front", "Next front", "Finish"],
  "two-pointers": ["Place pointers", "Compare pair", "Too small", "Move left", "Too large", "Return"],
  "sliding-window": ["Start", "Grow", "Measure", "Update best", "Slide", "Repeat", "Stop", "Return"],
  "binary-search": ["Range", "Middle", "Compare", "Discard half", "New range", "New middle", "Final check", "Return"],
  recursion: ["Call", "Check base", "Smaller call", "Stack grows", "Base returns", "Unwind", "Combine", "Return"],
  math: ["Inputs", "First value", "Apply rule", "Adjust", "Check result", "Return"],
  matrix: ["Row start", "Column start", "Read cell", "Update", "Next cell", "Return"],
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
  recursion: 8,
  graph: 7,
  "binary-tree": 7,
  heap: 7,
  trie: 7,
  "union-find": 7,
  intervals: 7,
  "bit-manipulation": 7,
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
  const raw = rawVisualInput(context, state);
  const hasLongList = parseFirstList(raw).length > 6 || Object.values(parseAllNamedLists(raw)).some((items) => items.length > 6);
  const hasLongText = raw.length > 14 && !raw.includes("=") && !parseFirstList(raw).length;

  if (title.includes("vowel")) return "Code";
  if (title.includes("palindrome")) return "level";
  if (title.includes("reverse words")) return "red blue";
  if (title.includes("reverse only letters")) return "a-bC-d";
  if (title.includes("first repeated")) return "cocoa";
  if (title.includes("edit distance")) return "cat -> cut";

  switch (concept) {
    case "stack":
      return "commands=[push 3, push +, pop +]";
    case "queue":
      return "commands=[join Ana, join Bo, serve Ana]";
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
  const override = teachingSampleOverride(context, concept, state);
  if (override) {
    if (concept === "stack") return "top 3";
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
    if (concept === "stack") normalized.stack = indexableTeachingValues(concept, sample).slice(0, 2);
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
      `input = ${sample}`,
      `condition = ${rule}`,
      "if condition:",
      "else:",
      sharedFinish,
    ];
  }
  if (concept === "stack") {
    return [
      `commands = ${sample}`,
      "if command == 'push': stack.append(item)",
      "if command == 'pop': item = stack.pop()",
      sharedFinish,
    ];
  }
  if (concept === "queue") {
    return [
      `commands = ${sample}`,
      "if command == 'join': queue.append(item)",
      "if command == 'serve': item = queue.pop(0)",
      sharedFinish,
    ];
  }
  if (concept === "linked-list") {
    return [
      "current = head",
      "value = current.value",
      "next_node = current.next",
      "current = next_node",
      "while current is not null:",
      sharedFinish,
    ];
  }
  if (concept === "hash-map") {
    return [
      `items = ${sample}`,
      "key = build_key(item)",
      "if key in table:",
      "table[key] = value",
      sharedFinish,
    ];
  }
  if (concept === "set" || topic.includes("set")) {
    return [
      `items = ${sample}`,
      "for item in items:",
      "if item not in seen:",
      "seen.add(item)",
      sharedFinish,
    ];
  }
  if (concept === "tuple" || topic.includes("tuple")) {
    return [
      `items = ${sample}`,
      "for index in range(length):",
      "pair = (left[index], right[index])",
      "pairs.append(pair)",
      sharedFinish,
    ];
  }
  if (concept === "binary-search") {
    return [
      "left = 0; right = len(items) - 1",
      "mid = (left + right) // 2",
      "if items[mid] < target: left = mid + 1",
      "if items[mid] > target: right = mid - 1",
      sharedFinish,
    ];
  }
  if (concept === "two-pointers") {
    return [
      "left = 0; right = len(items) - 1",
      "pair = (items[left], items[right])",
      "if pair is too small: left += 1",
      "if pair is too large: right -= 1",
      sharedFinish,
    ];
  }
  if (concept === "sliding-window") {
    return [
      "left = 0; right = 0",
      "window_total += entering",
      "window_total -= leaving",
      "best = max(best, window_total)",
      sharedFinish,
    ];
  }
  if (concept === "recursion") {
    return [
      "if base_case: return base_value",
      "smaller = solve(smaller_input)",
      "answer = combine(current_piece, smaller)",
      "return answer",
    ];
  }
  if (concept === "binary-tree") {
    return [
      "node = root",
      "value = node.value",
      "if go_left: node = node.left",
      "if go_right: node = node.right",
      sharedFinish,
    ];
  }
  if (concept === "graph") {
    return [
      "frontier = [start]",
      "node = frontier.pop(0)",
      "visited.add(node)",
      "frontier.extend(unvisited_neighbors)",
      sharedFinish,
    ];
  }
  if (concept === "heap") {
    return [
      "heap.append(item)",
      "parent = parent_index(child)",
      "if heap[child] outranks heap[parent]:",
      "swap(child, parent)",
      sharedFinish,
    ];
  }
  if (concept === "trie") {
    return [
      "node = root",
      "for char in word:",
      "node = node.children[char]",
      "node.is_word = true",
    ];
  }
  if (concept === "union-find") {
    return [
      "parent[item] = item",
      "root_a = find(a)",
      "root_b = find(b)",
      "if root_a != root_b: union(root_a, root_b)",
      sharedFinish,
    ];
  }
  if (concept === "dynamic-programming") {
    return [
      "dp[base] = base_answer",
      "for state in states:",
      "candidate = use(dp[smaller_state])",
      "dp[state] = best(candidate)",
      sharedFinish,
    ];
  }
  if (concept === "matrix") {
    return [
      "row = current_row",
      "col = current_col",
      "value = grid[row][col]",
      "answer = update(answer, value)",
      sharedFinish,
    ];
  }
  if (concept === "prefix-sum") {
    return [
      "running = 0",
      "running += value",
      "prefix[index] = running",
      "range_sum = prefix[right] - prefix[left]",
      sharedFinish,
    ];
  }
  if (concept === "intervals") {
    return [
      "intervals.sort()",
      "current = intervals[0]",
      "if next.start <= current.end:",
      "current.end = max(current.end, next.end)",
      sharedFinish,
    ];
  }
  if (concept === "bit-manipulation") {
    return [
      "bits = binary(number)",
      "bit = bits[index]",
      "if bit == 1: count += 1",
      "index += 1",
      sharedFinish,
    ];
  }
  if (concept === "math") {
    return [
      `values = ${sample}`,
      "total = apply_formula(values)",
      `if ${rule}: total = adjust(total)`,
      sharedFinish,
    ];
  }
  return [
    `input = ${sample}`,
    `rule = ${rule}`,
    "current = input[index]",
    "answer = update(answer, current)",
    sharedFinish,
  ];
}

function expandPseudocodeLines(lines: string[], concept: string): string[] {
  const target = targetStepCount(concept);
  if (lines.length >= target) return lines;
  const additions: Record<string, string[]> = {
    conditional: ["chosen = true_value if condition else false_value", "return chosen"],
    stack: ["top = stack[-1] if stack else None", "return top"],
    queue: ["front = queue[0] if queue else None", "return front"],
    "hash-map": ["table[key] = value", "return table[key]"],
    set: ["seen.add(item)", "return seen"],
    tuple: ["index += 1", "return pairs"],
    "linked-list": ["current = next_node", "return result"],
    recursion: ["call_stack.append(smaller_call)", "base_value returns", "answer = combine(current, smaller)", "return answer"],
    "binary-search": ["left, right = next_range", "mid = (left + right) // 2", "return found_index"],
    "two-pointers": ["left, right = next_pair", "return result"],
    "sliding-window": ["best = max(best, window_value)", "left += 1", "return best"],
    "binary-tree": ["result = update(result, node.value)", "check tree rule", "return result"],
    graph: ["if neighbor not in visited: frontier.append(neighbor)", "skip already visited", "return visited"],
    matrix: ["row, col = next_cell(row, col)", "return result"],
    "prefix-sum": ["prefix[index] = running", "range_sum = prefix[right] - prefix[left - 1]", "return range_sum"],
    intervals: ["merged = merge_or_append(merged, current)", "move to next interval", "return merged"],
    heap: ["heapify_up(heap, index)", "check parent rule", "return heap[0]"],
    trie: ["node = node.children[char]", "reuse shared prefix", "return node.is_word"],
    "union-find": ["parent[root_a] = root_b", "root = find(item)", "return count_roots(parent)"],
    "dynamic-programming": ["read dp[smaller_state]", "candidate = combine(saved_answers)", "dp[state] = answer", "return dp[target]"],
    "bit-manipulation": ["number >>= 1", "inspect next bit", "return result"],
    math: ["total = adjust(total)", "return total"],
    array: ["answer = update(answer, current)", "return answer"],
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
      ? { title: "Inspect the active item", body: "Read the highlighted value before deciding whether it changes the answer.", code: "item = values[index]", action: "inspect" }
      : { title: "Update and move", body: "Save the new state, then move the active index forward.", code: "answer = updated; index += 1", action: "update" },
    search: slot === "first-repeat"
      ? { title: "Check for a match", body: "Compare the active item with the target or condition.", code: "if item matches target", action: "check" }
      : { title: "Move after no match", body: "If this item is not enough, advance to the next candidate.", code: "index += 1", action: "move" },
    sort: slot === "first-repeat"
      ? { title: "Compare the pair", body: "Only the highlighted pair can swap during this step.", code: "if left > right", action: "compare" }
      : { title: "Place the value", body: "After the move, the value is closer to its sorted position.", code: "swap or keep", action: "place" },
    tuple: slot === "first-repeat"
      ? { title: "Align the index", body: "Use the same position in each collection so related values stay paired.", code: "left[i], right[i]", action: "align" }
      : { title: "Save the pair", body: "Package the related values together before moving to the next index.", code: "pairs.append((a, b))", action: "pair" },
    matrix: slot === "first-repeat"
      ? { title: "Read row and column", body: "A matrix step needs both coordinates before reading the cell.", code: "grid[row][col]", action: "cell" }
      : { title: "Move to the next cell", body: "Advance column or row in a predictable order.", code: "advance row/column", action: "next cell" },
    math: slot === "first-repeat"
      ? { title: "Apply the rule", body: "Use the formula or comparison on the active number.", code: "value = formula(value)", action: "formula" }
      : { title: "Check the computed result", body: "Compare the computed value with the expected output shape.", code: "return value", action: "check result" },
    "prefix-sum": slot === "first-repeat"
      ? { title: "Add into running total", body: "The current value changes the saved prefix total.", code: "running += value", action: "add" }
      : { title: "Save the prefix", body: "Store the total so a later range answer can reuse it.", code: "prefix[i] = running", action: "save" },
    intervals: slot === "first-repeat"
      ? { title: "Compare boundaries", body: "The next start is compared with the saved end.", code: "next.start <= current.end", action: "compare" }
      : { title: "Carry merged state", body: "Keep the merged range or start a separate one before moving on.", code: "merge or append", action: "carry" },
    heap: slot === "first-repeat"
      ? { title: "Compare with parent", body: "The inserted value checks whether it outranks its parent.", code: "compare child and parent", action: "compare" }
      : { title: "Bubble or stop", body: "Swap upward only while the heap rule is broken.", code: "swap with parent", action: "bubble" },
    trie: slot === "first-repeat"
      ? { title: "Follow character edge", body: "Each character chooses one branch from the current trie node.", code: "node = node[char]", action: "char" }
      : { title: "Mark word state", body: "At the last character, mark or check the word-ending node.", code: "node.is_word = true", action: "word" },
    "union-find": slot === "first-repeat"
      ? { title: "Find each leader", body: "Before connecting items, find the group leader for each one.", code: "find(a), find(b)", action: "find" }
      : { title: "Union the groups", body: "If the leaders differ, connect one group under the other.", code: "parent[root_a] = root_b", action: "union" },
    "dynamic-programming": slot === "first-repeat"
      ? { title: "Read saved cells", body: "A DP cell gets its answer from smaller cells that were already solved.", code: "use previous dp values", action: "reuse" }
      : { title: "Fill the current cell", body: "Store this small answer so future cells can reuse it.", code: "dp[i] = answer", action: "fill" },
    "bit-manipulation": slot === "first-repeat"
      ? { title: "Inspect one bit", body: "Only the highlighted bit decides whether the mask or count changes.", code: "bit = n & 1", action: "inspect bit" }
      : { title: "Shift to continue", body: "Move to the next bit after saving the current change.", code: "n >>= 1", action: "shift" },
    conditional: slot === "first-repeat"
      ? { title: "Test the active branch", body: "Use the condition result to decide which branch stays active for this exact input.", code: "if condition is true or false", action: "branch" }
      : { title: "Ignore the other branch", body: "The branch that does not match is skipped, so it should not change the result.", code: "skip the unmatched branch", action: "skip" },
    stack: slot === "first-repeat"
      ? { title: "Check the top only", body: "Stack operations look at the newest item first; older items wait underneath.", code: "top = stack[-1]", action: "peek" }
      : { title: "Update after the operation", body: "After push or pop, the top pointer changes to the item now visible.", code: "update top", action: "update top" },
    queue: slot === "first-repeat"
      ? { title: "Check the front", body: "Queue operations serve the oldest item first, even after new items join the back.", code: "front = queue[0]", action: "front" }
      : { title: "Preserve waiting order", body: "The remaining items keep their order after the front item leaves.", code: "queue = queue[1:]", action: "order" },
    "hash-map": slot === "first-repeat"
      ? { title: "Look up before update", body: "Check the table for the key before changing what the table stores.", code: "if key in table", action: "lookup" }
      : { title: "Store for later", body: "After the update, future steps can use the stored key instead of scanning again.", code: "table[key] = value", action: "store" },
    set: slot === "first-repeat"
      ? { title: "Ask membership", body: "The set answers whether this value has already appeared.", code: "item in seen", action: "check" }
      : { title: "Update memory", body: "Add the value only when the rule says it should be remembered.", code: "seen.add(item)", action: "remember" },
    "linked-list": slot === "first-repeat"
      ? { title: "Save the next link", body: "Before moving a node pointer, notice which next link keeps the chain connected.", code: "next_node = current.next", action: "save next" }
      : { title: "Move current safely", body: "After the next link is known, current can move without losing the rest of the list.", code: "current = next_node", action: "move" },
    recursion: slot === "first-repeat"
      ? { title: "Make the smaller call", body: "The current call pauses while a smaller version of the problem runs.", code: "answer = solve(smaller)", action: "call" }
      : { title: "Unwind one answer", body: "When the smaller answer returns, this call combines only its own piece.", code: "return combine(answer)", action: "unwind" },
    "binary-search": slot === "first-repeat"
      ? { title: "Compare the middle", body: "The middle value decides which half of the sorted range can be ignored.", code: "compare nums[mid]", action: "compare" }
      : { title: "Shrink the range", body: "Move left or right so the next step searches only possible answers.", code: "left/right = mid +/- 1", action: "shrink" },
    "two-pointers": slot === "first-repeat"
      ? { title: "Evaluate the pair", body: "Use the two highlighted values together before moving either pointer.", code: "check left and right", action: "pair check" }
      : { title: "Move one pointer", body: "Only one pointer moves, based on what the comparison proved.", code: "left += 1 or right -= 1", action: "move" },
    "sliding-window": slot === "first-repeat"
      ? { title: "Add entering item", body: "The right edge brings one new value into the window.", code: "total += entering", action: "enter" }
      : { title: "Remove leaving item", body: "The left edge removes one old value so the window size or rule stays valid.", code: "total -= leaving", action: "leave" },
    "binary-tree": slot === "first-repeat"
      ? { title: "Choose a child link", body: "The current node comparison tells you whether to follow left or right.", code: "node = node.left/right", action: "follow" }
      : { title: "Use the visited node", body: "Once the target node or leaf is reached, update the result for this path.", code: "update result", action: "visit" },
    graph: slot === "first-repeat"
      ? { title: "Add neighbors", body: "Neighbors enter the frontier only if they have not already been visited.", code: "queue.add(neighbor)", action: "frontier" }
      : { title: "Skip repeats", body: "Visited memory prevents the same node from being processed again.", code: "if neighbor not in visited", action: "visited" },
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

function generateAuthoredVisualizerSteps(concept: string, context: GeneratorContext = {}): Step[] | null {
  const rawAuthoredSteps = context.visualizer?.steps;
  if (!context.useAuthored || !Array.isArray(rawAuthoredSteps) || !rawAuthoredSteps.length) return null;
  const normalizedSteps = rawAuthoredSteps as Array<Record<string, unknown>>;
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
  ];
}

export function generateTupleSteps(context: GeneratorContext = {}): Step[] {
  const code = ["left_value = left[index]", "right_value = right[index]", "pair = (left_value, right_value)", "pairs.append(pair)", "index += 1", "return pairs"];
  const phases = [
    { active: 0, title: context.title || "Tuple pairs", desc: "Start by lining up index 0 in both collections." },
    { active: 0, title: "Read matching values", desc: "Take one value from each collection at the same index." },
    { active: 0, title: "Save the first pair", desc: "Package the matching values into one tuple-style result." },
    { active: 1, title: "Move to index 1", desc: "The index moves together in both collections so the relationship stays aligned." },
    { active: 1, title: "Build another pair", desc: "Repeat the same read-and-package rule for the next position." },
    { active: 2, title: "Return all pairs", desc: "The final answer is the collection of saved pairs, not just one highlighted value." },
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
      state: { pair_index: active },
    }, index + 1);
  });
}

export function generateSetSteps(context: GeneratorContext = {}): Step[] {
  const code = ["item = values[index]", "already_seen = item in seen", "if not already_seen: result.append(item)", "if not already_seen: seen.add(item)", "index += 1", "return result"];
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
      title: "Use the stored value",
      description: "The table is useful because later code can retrieve the value without scanning every entry.",
      nodes: withNodeState(collision.nodes, ["entry-2-1"], "visited"),
      edges: collision.edges,
      highlights: { nodeIds: ["entry-2-1"], lineNumbers: [4] },
      code,
      activeLine: 4,
      state: { result: `found ${secondKey}` },
    }, 6),
  ];
}

export function generateGraphTraversalSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "frontier = [start]",
    "node = frontier.pop(0)",
    "visited.add(node)",
    "frontier.extend(unvisited_neighbors)",
    "while frontier:",
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
  const code = [
    "input_value = input",
    "condition = test(input_value)",
    "if condition: result = yes_value",
    "else: result = no_value",
    "return result",
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
    { title: "Preview the true path", description: "If the condition is true, execution moves into the yes branch and skips the no branch.", active: ["yes"], edges: ["condition-yes"], line: 3 },
    { title: "Compare the false path", description: "If the condition is false, execution would move into the no branch instead.", active: ["no"], edges: ["condition-no"], line: 4 },
    { title: "Keep the chosen branch", description: "Only the branch that matches this sample contributes to the answer.", active: ["yes"], edges: ["condition-yes"], line: 3 },
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
  const code = ["stack = []", "stack.append(first)", "stack.append(next_item)", "top = stack[-1]", "removed = stack.pop()", "return stack[-1]"];
  const sample = compactVisualInput(context, "stack", context.visualizer?.input || {});
  const teachingValues = indexableTeachingValues("stack", sample);
  const first = String(teachingValues[0] ?? "lab");
  const second = String(teachingValues[1] ?? "quiz");
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
    step({ concept: "stack", title: context.title || "Stack", description: "Start empty so it is clear every later item enters from the same top end.", nodes: makeNodes([], []), edges: [], highlights: { nodeIds: [], lineNumbers: [1] }, code, activeLine: 1, state: { top: "empty" } }, 1),
    step({ concept: "stack", title: "Push first item", description: `The first pushed item, ${first}, becomes the top because nothing else is above it.`, nodes: makeNodes([first], ["stack-0"]), edges: [], highlights: { nodeIds: ["stack-0"], lineNumbers: [2] }, code, activeLine: 2, state: { top: first } }, 2),
    step({ concept: "stack", title: "Push next item", description: `A new item, ${second}, lands above the old top. The old item stays in the stack.`, nodes: makeNodes([first, second], ["stack-1"]), edges: [], highlights: { nodeIds: ["stack-1"], lineNumbers: [3] }, code, activeLine: 3, state: { top: second } }, 3),
    step({ concept: "stack", title: "Peek at the top", description: `Peek reads ${second} without removing it, so the stack shape does not change.`, nodes: makeNodes([first, second], ["stack-1"]), edges: [], highlights: { nodeIds: ["stack-1"], lineNumbers: [4] }, code, activeLine: 4, state: { peek: second, top: second } }, 4),
    step({ concept: "stack", title: "Pop the top", description: `Pop removes only the newest item, ${second}. Older items are still underneath.`, nodes: makeNodes([first], ["stack-0"]), edges: [], highlights: { nodeIds: ["stack-0"], lineNumbers: [5] }, code, activeLine: 5, state: { removed: second, top: first } }, 5),
    step({ concept: "stack", title: "Use the revealed top", description: `After the pop, ${first} is visible again. This is why stacks are last-in, first-out.`, nodes: makeNodes([first], ["stack-0"]), edges: [], highlights: { nodeIds: ["stack-0"], lineNumbers: [6] }, code, activeLine: 6, state: { top: first, rule: "LIFO" } }, 6),
  ];
}

export function generateQueueSteps(context: GeneratorContext = {}): Step[] {
  const code = ["queue = [first, second]", "queue.append(new_item)", "front = queue[0]", "served = queue.pop(0)", "front = queue[0]", "return served_order"];
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
  const code = ["left = 0; right = len(values) - 1", "mid = (left + right) // 2", "if values[mid] < target:", "  left = mid + 1", "if values[mid] > target:", "  right = mid - 1", "return mid"];
  const values = [1, 3, 5, 7, 9, 11, 13];
  const phases = [
    { left: 0, mid: 3, right: 6, target: 5, desc: "Start with the full sorted range. Only sorted data lets us remove half at a time.", line: 1, title: context.title || "Binary search" },
    { left: 0, mid: 3, right: 6, target: 5, desc: "Check the middle value, 7, before moving either boundary.", line: 2, title: "Check middle" },
    { left: 0, mid: 3, right: 6, target: 5, desc: "The target 5 is smaller than 7, so the answer cannot be to the right of mid.", line: 5, title: "Compare target" },
    { left: 0, mid: 1, right: 2, target: 5, desc: "Move the right boundary left. The discarded half fades out.", line: 6, title: "Discard right half" },
    { left: 0, mid: 1, right: 2, target: 5, desc: "Recompute mid inside the smaller range, then check 3.", line: 2, title: "Check new middle" },
    { left: 2, mid: 2, right: 2, target: 5, desc: "3 is too small, so move left past it. One candidate remains.", line: 4, title: "Discard left value" },
    { left: 2, mid: 2, right: 2, target: 5, desc: "The remaining value is 5, which matches the target.", line: 2, title: "Final check" },
    { left: 2, mid: 2, right: 2, target: 5, desc: "Return the index of the match.", line: 7, title: "Return found" },
  ];
  return phases.map((phase, index) => {
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex < phase.left || nodeIndex > phase.right ? "inactive" as const : nodeIndex === phase.mid ? "active" as const : "default" as const,
      label: nodeIndex === phase.left ? "left" : nodeIndex === phase.mid ? "mid" : nodeIndex === phase.right ? "right" : String(nodeIndex),
    }));
    return step({ concept: "binary-search", title: phase.title, description: phase.desc, nodes, edges: [], highlights: { nodeIds: [`item-${phase.mid}`], lineNumbers: [phase.line] }, code, activeLine: phase.line, state: { left: phase.left, mid: phase.mid, right: phase.right, target: phase.target } }, index + 1);
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

export function generateMatrixSteps(context: GeneratorContext = {}): Step[] {
  const code = ["row = current_row", "col = current_col", "value = grid[row][col]", "answer = update(answer, value)", "row, col = next_cell(row, col)", "return answer"];
  const values = [1, 2, 3, 4, 5, 6];
  const nodes = values.map((value, index) => ({ id: `cell-${index}`, x: 350 + (index % 3) * 96, y: 180 + Math.floor(index / 3) * 96, value, type: "array-cell" as const, label: `${Math.floor(index / 3)},${index % 3}` }));
  return [0, 1, 2, 3, 4, 5].map((activeIndex, index) => step({ concept: "matrix", title: index === 0 ? (context.title || "Matrix scan") : index === 5 ? "Finish the grid pass" : "Move through the grid", description: "Track row and column so each grid cell is visited on purpose.", nodes: withNodeState(nodes, [`cell-${activeIndex}`], index === 5 ? "visited" : "active"), edges: [], highlights: { nodeIds: [`cell-${activeIndex}`], lineNumbers: [Math.min(index + 1, code.length)] }, code, activeLine: Math.min(index + 1, code.length), state: { row: Math.floor(activeIndex / 3), column: activeIndex % 3 } }, index + 1));
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
  const code = ["intervals.sort()", "current = intervals[0]", "next = intervals[index]", "if next.start <= current.end:", "current.end = max(current.end, next.end)", "else: merged.append(current)", "return merged"];
  const phases = [
    { active: 0, title: context.title || "Intervals", desc: "Sort ranges by start time so comparisons happen left to right." },
    { active: 0, title: "Keep the first range", desc: "The first interval becomes the current saved block." },
    { active: 1, title: "Compare the next start", desc: "If the next start is before the saved end, the ranges overlap." },
    { active: 1, title: "Merge overlap", desc: "Overlapping bars become one longer busy block." },
    { active: 2, title: "Carry the merged block", desc: "Keep the merged interval as current before checking the next range." },
    { active: 2, title: "Check a separate range", desc: "If a range starts after the saved end, it begins a new block." },
    { active: 2, title: "Return merged ranges", desc: "The result is the list of carried blocks after every comparison." },
  ];
  return phases.map((phase, index) => {
    const active = phase.active;
    const visual = authoredIntervalVisual({}, context, active);
    return step({ concept: "intervals", title: phase.title, description: phase.desc, nodes: visual.nodes, edges: visual.edges, highlights: { nodeIds: visual.highlights, lineNumbers: [Math.min(index + 1, code.length)] }, code, activeLine: Math.min(index + 1, code.length), state: { active_range: active + 1 } }, index + 1);
  });
}

export function generateHeapSteps(context: GeneratorContext = {}): Step[] {
  const code = ["heap.append(value)", "parent = parent_index(child)", "if heap[child] > heap[parent]:", "swap(child, parent)", "child = parent", "repeat until heap rule holds", "return heap[0]"];
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

export function generateMathSteps(context: GeneratorContext = {}): Step[] {
  const code = ["values = input", "total = first_operation(values)", "total = second_operation(total)", "if limit: total = clamp(total)", "result = format(total)", "return result"];
  const nodes = layoutArray(["base", "+ fee", "- discount", "limit", "format", "total"], { gap: 110 }).map((node) => ({
    ...node,
    meta: { role: "formula-cell" },
  }));
  return nodes.map((node, index) => step({ concept: "math", title: context.title || "Arithmetic state", description: "Math problems are easiest when each piece of the formula changes one state value.", nodes: withNodeState(nodes, [node.id], "active"), edges: [], highlights: { nodeIds: [node.id], lineNumbers: [Math.min(index + 1, 4)] }, code, activeLine: Math.min(index + 1, 4), state: { step: node.value } }, index + 1));
}

export function generateStepsForConcept(concept: string, context: GeneratorContext = {}): Step[] {
  const authoredSteps = generateAuthoredVisualizerSteps(concept, context);
  if (authoredSteps) return authoredSteps;

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
