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
  recursion: 9,
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
  | "binary-search-exact"
  | "binary-search-first-at-least"
  | "binary-search-first-bad"
  | "binary-search-first-one"
  | "binary-search-first-passing"
  | "binary-search-insert-position"
  | "binary-search-last-at-most"
  | "binary-search-median-two-lists"
  | "bit-alternating"
  | "bit-count"
  | "bit-count-small"
  | "bit-different-count"
  | "bit-lowest-bit"
  | "bit-max-pair-xor"
  | "bit-odd-last"
  | "bit-power-two"
  | "bit-turn-off-lowest"
  | "bit-xor-all"
  | "conditional-flow"
  | "dp-blocked-stairs"
  | "dp-best-non-adjacent"
  | "dp-climb-stairs"
  | "dp-coin-change"
  | "dp-decode-ways"
  | "dp-edit-distance"
  | "dp-lis"
  | "dp-max-subarray-deletion"
  | "dp-maximal-square"
  | "dp-min-cost-stairs"
  | "dp-non-adjacent-points"
  | "dp-one-three-steps"
  | "dp-study-plan-cost"
  | "dp-study-plan-ways"
  | "graph-alien-order"
  | "graph-campus-reachable"
  | "graph-clone"
  | "graph-course-chain"
  | "dp-table"
  | "graph-neighbor-count"
  | "graph-shortest-grid"
  | "graph-topological-order"
  | "graph-traversal"
  | "graph-word-ladder"
  | "graph-islands"
  | "hash-complement"
  | "hash-frequency"
  | "hash-grouping"
  | "hash-lookup"
  | "heap-highest-priority-name"
  | "heap-priority"
  | "heap-running-median"
  | "heap-smallest-two"
  | "heap-top-k-scores"
  | "heap-top-priority-assignments"
  | "heap-top-three"
  | "heap-kth-largest-stream"
  | "heap-lowest-priority-assignment"
  | "interval-merge"
  | "interval-busy-minutes"
  | "interval-count-overlap"
  | "interval-gap"
  | "interval-insert"
  | "interval-meeting-rooms"
  | "interval-overlap"
  | "interval-schedule-valid"
  | "linked-list-cycle"
  | "linked-list-kth"
  | "linked-list-length"
  | "linked-list-merge-index"
  | "linked-list-middle"
  | "linked-list-reverse-values"
  | "linked-list-tail"
  | "linked-list-traverse"
  | "math-count-digits"
  | "math-grade-points"
  | "math-last-digit"
  | "math-round-groups"
  | "matrix-traverse"
  | "prefix-balance-index"
  | "prefix-balanced-split"
  | "prefix-index-total"
  | "prefix-range"
  | "prefix-range-queries"
  | "prefix-running-totals"
  | "prefix-single-range"
  | "prefix-subarray-count"
  | "prefix-subarray-k"
  | "prefix-subarray-longest"
  | "queue-help-desk"
  | "queue-line-commands"
  | "queue-serve-count"
  | "queue-ticket-rounds"
  | "queue-window-count"
  | "queue-fifo"
  | "recursion-countdown-list"
  | "recursion-digit-sum"
  | "recursion-factorial"
  | "recursion-list-count"
  | "recursion-list-sum"
  | "recursion-nested-list"
  | "recursion-power"
  | "recursion-reverse-text"
  | "recursion-stack"
  | "set-first-missing"
  | "set-first-repeat"
  | "set-intersection"
  | "set-unique-count"
  | "set-membership"
  | "sliding-window-average"
  | "sliding-window-calm-two-day"
  | "sliding-window-longest-under-limit"
  | "sliding-window-longest-unique"
  | "sliding-window-max-sum"
  | "sliding-window-min-study"
  | "sliding-window-short-blocks"
  | "sliding-window-three-day"
  | "sliding-window"
  | "stack-adjacent-pairs"
  | "stack-brackets"
  | "stack-commands"
  | "stack-expression"
  | "stack-min"
  | "stack-monotonic"
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
  | "trie-all-share-prefix"
  | "trie-any-has-prefix"
  | "trie-any-prefix"
  | "trie-autocomplete-first"
  | "trie-count-prefix-matches"
  | "trie-first-word-prefix"
  | "trie-longest-common-prefix"
  | "trie-longest-prefix-word"
  | "trie-prefix"
  | "trie-prefix-counts"
  | "trie-prefix-match-count"
  | "tuple-first-last"
  | "tuple-pair"
  | "tuple-score-at-index"
  | "tuple-swap"
  | "tree-contains"
  | "tree-height"
  | "tree-lca"
  | "tree-leaf-count"
  | "tree-level-sums"
  | "tree-node-count"
  | "tree-path-sum-count"
  | "tree-right-side-view"
  | "tree-serialize"
  | "two-pointer-closest"
  | "two-pointer-count-ends"
  | "two-pointer-edge-pairs"
  | "two-pointer-merge"
  | "two-pointer-pair-sum"
  | "two-pointer-remove-pair"
  | "two-pointer-reverse-letters"
  | "two-pointer-symmetric"
  | "two-pointers"
  | "union-find";

function visualizerFamilyText(context: GeneratorContext = {}): string {
  return `${context.title || ""} ${context.topic || ""} ${context.prompt || ""} ${context.visualizer?.title || ""} ${context.visualizer?.caption || ""} ${context.visualizer?.concept || ""}`.toLowerCase();
}

export function detectVisualizerFamily(concept: string, context: GeneratorContext = {}): VisualizerFamily {
  const text = visualizerFamilyText(context);
  const isTrieConcept = concept === "trie" || concept === "tries" || /\btries?\b/.test(text);
  if (concept === "conditional" || concept === "decision-flow" || /\bconditionals?\b|if\/else|if else/.test(text)) return "conditional-flow";
  if (concept === "prefix-sum") {
    if (/running prefix totals/.test(text)) return "prefix-running-totals";
    if (/single range sum/.test(text)) return "prefix-single-range";
    if (/prefix sum at index/.test(text)) return "prefix-index-total";
    if (/one range sum/.test(text)) return "prefix-single-range";
    if (/range sum queries/.test(text)) return "prefix-range-queries";
    if (/prefix balance index/.test(text)) return "prefix-balance-index";
    if (/balanced prefix split/.test(text)) return "prefix-balanced-split";
    if (/subarray sum equals k/.test(text)) return "prefix-subarray-k";
    if (/longest subarray sum k/.test(text)) return "prefix-subarray-longest";
    if (/subarray sum count/.test(text)) return "prefix-subarray-count";
    return "prefix-range";
  }
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
  if (/first repeated character|first repeated/.test(text)) return "set-first-repeat";
  if (/shared study topics|intersection|shared/.test(text) && concept === "set") return "set-intersection";
  if (/unique count|unique parking zones|unique/.test(text) && concept === "set") return "set-unique-count";
  if (/count vowels?/.test(text)) return "string-count-vowels";
  if (/reverse words?/.test(text)) return "string-reverse-words";
  if (/count words?/.test(text)) return "string-count-words";
  if (/valid course code shape|course code/.test(text)) return "string-course-code";
  if (/\binitials?\b/.test(text)) return "string-initials";
  if (/compress runs|run length|repeated adjacent|character plus count/.test(text)) return "string-run-compress";
  if (/normalize email list|normalize emails?|email list/.test(text)) return "string-normalize-emails";
  if (isTrieConcept) {
    if (/all words share prefix/.test(text)) return "trie-all-share-prefix";
    if (/any word has prefix/.test(text)) return "trie-any-has-prefix";
    if (/any word with prefix/.test(text)) return "trie-any-prefix";
    if (/count prefix matches/.test(text)) return "trie-count-prefix-matches";
    if (/prefix match count/.test(text)) return "trie-prefix-match-count";
    if (/first word with prefix/.test(text)) return "trie-first-word-prefix";
    if (/longest common prefix/.test(text)) return "trie-longest-common-prefix";
    if (/first autocomplete matches/.test(text)) return "trie-autocomplete-first";
    if (/longest prefix word/.test(text)) return "trie-longest-prefix-word";
    if (/trie prefix counts/.test(text)) return "trie-prefix-counts";
    return "trie-prefix";
  }
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
  if (concept === "queue") {
    if (/help session finish order|tickets/.test(text)) return "queue-ticket-rounds";
    if (/recent queue counts|rate limiter|window/.test(text)) return "queue-window-count";
    if (/serve first students|queue front after serves|servecount/.test(text)) return "queue-serve-count";
    if (/help desk|ticket|support/.test(text)) return "queue-help-desk";
    if (/dining line after commands|front after line commands|commands|join|serve/.test(text)) return "queue-line-commands";
    return "queue-fifo";
  }
  if (concept === "linked-list") {
    if (/merge index|merge point|share one nextindexes/.test(text)) return "linked-list-merge-index";
    if (/has cycle|cycle/.test(text)) return "linked-list-cycle";
    if (/reverse linked list values|reverse.*values/.test(text)) return "linked-list-reverse-values";
    if (/middle value|middle/.test(text)) return "linked-list-middle";
    if (/value after k links|k links/.test(text)) return "linked-list-kth";
    if (/tail value|tail/.test(text)) return "linked-list-tail";
    if (/linked list length|length/.test(text)) return "linked-list-length";
    return "linked-list-traverse";
  }
  if (concept === "binary-search") {
    if (/first score at least/.test(text)) return "binary-search-first-at-least";
    if (/first one index/.test(text)) return "binary-search-first-one";
    if (/first passing score value/.test(text)) return "binary-search-first-passing";
    if (/median of two sorted lists/.test(text)) return "binary-search-median-two-lists";
    if (/insert position/.test(text)) return "binary-search-insert-position";
    if (/binary search exact/.test(text)) return "binary-search-exact";
    if (/first bad version/.test(text)) return "binary-search-first-bad";
    if (/last score at most/.test(text)) return "binary-search-last-at-most";
    return "binary-search";
  }
  if (concept === "two-pointers") {
    if (/edge pair matches/.test(text)) return "two-pointer-edge-pairs";
    if (/symmetric roster|palindrome|roster/.test(text)) return "two-pointer-symmetric";
    if (/count matching ends/.test(text)) return "two-pointer-count-ends";
    if (/merge sorted lists/.test(text)) return "two-pointer-merge";
    if (/closest pair sum/.test(text)) return "two-pointer-closest";
    if (/pair sum sorted/.test(text)) return "two-pointer-pair-sum";
    if (/reverse only letters/.test(text)) return "two-pointer-reverse-letters";
    if (/remove one target pair/.test(text)) return "two-pointer-remove-pair";
    return "two-pointers";
  }
  if (concept === "sliding-window") {
    if (/count short study blocks/.test(text)) return "sliding-window-short-blocks";
    if (/three day study totals/.test(text)) return "sliding-window-three-day";
    if (/any calm two day stretch/.test(text)) return "sliding-window-calm-two-day";
    if (/longest unique window/.test(text)) return "sliding-window-longest-unique";
    if (/window average/.test(text)) return "sliding-window-average";
    if (/maximum window sum/.test(text)) return "sliding-window-max-sum";
    if (/minimum study window/.test(text)) return "sliding-window-min-study";
    if (/longest study stretch under limit/.test(text)) return "sliding-window-longest-under-limit";
    return "sliding-window";
  }
  if (concept === "recursion") {
    if (/countdown/.test(text)) return "recursion-countdown-list";
    if (/factorial/.test(text)) return "recursion-factorial";
    if (/recursive list count|list count/.test(text)) return "recursion-list-count";
    if (/recursive list sum|list sum/.test(text)) return "recursion-list-sum";
    if (/nested list depth sum|nested|depth|flatten/.test(text)) return "recursion-nested-list";
    if (/digit sum/.test(text)) return "recursion-digit-sum";
    if (/power|exponent/.test(text)) return "recursion-power";
    if (/reverse text|reverse.*text/.test(text)) return "recursion-reverse-text";
    return "recursion-stack";
  }
  if (concept === "matrix") return "matrix-traverse";
  if (concept === "intervals") {
    if (/two intervals overlap/.test(text)) return "interval-overlap";
    if (/gap between ranges/.test(text)) return "interval-gap";
    if (/valid study schedule/.test(text)) return "interval-schedule-valid";
    if (/merge overlapping intervals/.test(text)) return "interval-merge";
    if (/count overlapping intervals/.test(text)) return "interval-count-overlap";
    if (/insert one interval/.test(text)) return "interval-insert";
    if (/minimum meeting rooms/.test(text)) return "interval-meeting-rooms";
    if (/total busy minutes/.test(text)) return "interval-busy-minutes";
    return "interval-merge";
  }
  if (concept === "heap") {
    if (/highest priority name/.test(text)) return "heap-highest-priority-name";
    if (/top three scores/.test(text)) return "heap-top-three";
    if (/smallest two scores/.test(text)) return "heap-smallest-two";
    if (/top priority assignments/.test(text)) return "heap-top-priority-assignments";
    if (/lowest priority assignment/.test(text)) return "heap-lowest-priority-assignment";
    if (/kth largest stream/.test(text)) return "heap-kth-largest-stream";
    if (/top k scores/.test(text)) return "heap-top-k-scores";
    if (/running median/.test(text)) return "heap-running-median";
    return "heap-priority";
  }
  if (concept === "union-find") return "union-find";
  if (concept === "dynamic-programming") {
    if (/climb small staircase|climb.*stair/.test(text)) return "dp-climb-stairs";
    if (/tiny minimum stair cost/.test(text)) return "dp-min-cost-stairs";
    if (/ways with one or three steps/.test(text)) return "dp-one-three-steps";
    if (/best non adjacent total/.test(text)) return "dp-best-non-adjacent";
    if (/non adjacent points/.test(text)) return "dp-non-adjacent-points";
    if (/longest increasing subsequence/.test(text)) return "dp-lis";
    if (/edit distance/.test(text)) return "dp-edit-distance";
    if (/decode ways/.test(text)) return "dp-decode-ways";
    if (/maximum subarray with one deletion/.test(text)) return "dp-max-subarray-deletion";
    if (/maximal square/.test(text)) return "dp-maximal-square";
    if (/minimum study plan cost/.test(text)) return "dp-study-plan-cost";
    if (/study plan ways/.test(text)) return "dp-study-plan-ways";
    if (/coin change ways/.test(text)) return "dp-coin-change";
    if (/blocked stair ways/.test(text)) return "dp-blocked-stairs";
    return "dp-table";
  }
  if (concept === "bit-manipulation") {
    if (/maximum pair xor|pair xor/.test(text)) return "bit-max-pair-xor";
    if (/different bit count|positions are different/.test(text)) return "bit-different-count";
    if (/xor every number|xor of every/.test(text)) return "bit-xor-all";
    if (/alternating bits|bits alternate/.test(text)) return "bit-alternating";
    if (/turn off lowest set bit|turning off the lowest 1/.test(text)) return "bit-turn-off-lowest";
    if (/odd from last bit|odd by checking the last bit/.test(text)) return "bit-odd-last";
    if (/lowest bit value|lowest bit of/.test(text)) return "bit-lowest-bit";
    if (/power of two/.test(text)) return "bit-power-two";
    if (/count set bits small/.test(text)) return "bit-count-small";
    return "bit-count";
  }
  if (concept === "graph") {
    if (/neighbor count/.test(text)) return "graph-neighbor-count";
    if (/course prerequisite chain/.test(text)) return "graph-course-chain";
    if (/count islands|island|land.*water|water.*land/.test(text)) return "graph-islands";
    if (/campus stop reachable/.test(text)) return "graph-campus-reachable";
    if (/shortest path/.test(text)) return "graph-shortest-grid";
    if (/course plan topological order|topological/.test(text)) return "graph-topological-order";
    if (/word ladder/.test(text)) return "graph-word-ladder";
    if (/clone graph/.test(text)) return "graph-clone";
    if (/alien dictionary/.test(text)) return "graph-alien-order";
    return "graph-traversal";
  }
  if (concept === "binary-tree" || concept === "tree") {
    if (/tree node count/.test(text)) return "tree-node-count";
    if (/tree height levels/.test(text)) return "tree-height";
    if (/tree leaf count/.test(text)) return "tree-leaf-count";
    if (/tree contains value/.test(text)) return "tree-contains";
    if (/serialize binary tree/.test(text)) return "tree-serialize";
    if (/tree level sums/.test(text)) return "tree-level-sums";
    if (/tree right side view/.test(text)) return "tree-right-side-view";
    if (/lowest common ancestor|lca/.test(text)) return "tree-lca";
    if (/tree path sum count/.test(text)) return "tree-path-sum-count";
    return "graph-traversal";
  }
  if (concept === "stack") {
    if (/bracket|parenth|valid|balanced/.test(text)) return "stack-brackets";
    if (/min stack|minimum stack|getmin|track.*min|stack.*minimum/.test(text)) return "stack-min";
    if (/temperature|next warmer|warmer/.test(text)) return "stack-monotonic";
    if (/adjacent equal|remove adjacent|pairs/.test(text)) return "stack-adjacent-pairs";
    if (/plate|undo|latest action|top after|commands|push|pop/.test(text)) return "stack-commands";
    return "stack-expression";
  }
  if (concept === "hash-map") {
    if (/two sum|complement|pair.*target|target.*pair/.test(text)) return "hash-complement";
    if (/group|anagram|bucket by|categor/i.test(text)) return "hash-grouping";
    if (/count|frequency|frequent|favorite|most common|occurrence|top k/.test(text)) return "hash-frequency";
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
  if (family === "heap-highest-priority-name") return "names=[Ada, Bo, Cy], priorities=[4, 9, 9]";
  if (family === "heap-top-three") return "scores=[5, 9, 7, 2]";
  if (family === "heap-smallest-two") return "scores=[8, 3, 5]";
  if (family === "heap-top-priority-assignments") return "names=[lab, quiz, project], priorities=[2, 5, 5], k=2";
  if (family === "heap-lowest-priority-assignment") return "names=[lab, quiz, essay], priorities=[3, 1, 1]";
  if (family === "heap-kth-largest-stream") return "k=3, stream=[4, 5, 8, 2]";
  if (family === "heap-top-k-scores") return "scores=[88, 91, 72, 91, 84], k=3";
  if (family === "heap-running-median") return "scores=[80, 90, 70, 100]";
  if (family === "trie-any-prefix") return "words=[cat, car, dog], prefix=ca";
  if (family === "trie-count-prefix-matches") return "words=[sun, sum, cat], prefix=su";
  if (family === "trie-all-share-prefix") return "words=[cat, car, camp], prefix=ca";
  if (family === "trie-first-word-prefix") return "words=[dog, cat, car], prefix=ca";
  if (family === "trie-prefix-match-count") return "words=[code, coding, course], prefix=cod";
  if (family === "trie-longest-common-prefix") return "words=[cab, car, cat]";
  if (family === "trie-autocomplete-first") return "words=[car, cat, cab, dog], prefix=ca, k=2";
  if (family === "trie-longest-prefix-word") return "words=[cart, car, care], prefix=car";
  if (family === "trie-prefix-counts") return "insert cat, car, dog; count ca";
  if (family === "trie-any-has-prefix") return "words=[cat, car, dog], prefix=ca";
  if (family === "string-count-vowels") return "Code";
  if (family === "string-reverse-words") return "red blue";
  if (family === "string-count-words") return "red blue";
  if (family === "string-course-code") return "COSC 352";
  if (family === "string-initials") return "Ada Lovelace";
  if (family === "string-run-compress") return "aaabbc";
  if (family === "string-normalize-emails") return "emails=[Ada@MSU.edu, ada@msu.edu, Bo@MSU.edu]";
  if (family === "string-prefix-search") return "words=[code, card, car], prefix=ca";
  if (family === "string-palindrome") return "level";
  if (family === "stack-brackets") return "{[()]}";
  if (family === "stack-min") return "commands=[push 3, push 1, min, pop, top]";
  if (family === "stack-monotonic") return "temperatures=[70,72,71,75]";
  if (family === "stack-adjacent-pairs") return "text=abbaca";
  if (family === "stack-commands") {
    if (/max plate|height/.test(title)) return "commands=[push, push, pop, push]";
    if (/undo/.test(title)) return "actions=[open, type, undo]";
    return "commands=[push tray, push cup, pop]";
  }
  if (family === "recursion-countdown-list") return "n=2";
  if (family === "recursion-factorial") return "n=3";
  if (family === "recursion-list-count") return "nums=[5,6]";
  if (family === "recursion-list-sum") return "nums=[2,5]";
  if (family === "recursion-nested-list") return "value=[1,[2,[3]]]";
  if (family === "recursion-digit-sum") return "number=34";
  if (family === "recursion-power") return "base=2, exponent=2";
  if (family === "recursion-reverse-text") return "text='go'";
  if (family === "dp-climb-stairs") return "n=4";
  if (family === "dp-min-cost-stairs") return "costs=[2,5,1]";
  if (family === "dp-one-three-steps") return "n=4";
  if (family === "dp-best-non-adjacent") return "points=[4,1,7]";
  if (family === "dp-non-adjacent-points") return "points=[3,2,7,10]";
  if (family === "dp-study-plan-ways") return "days=4";
  if (family === "dp-lis") return "nums=[2,5,3,7]";
  if (family === "dp-edit-distance") return "cat -> cut";
  if (family === "dp-decode-ways") return "digits=226";
  if (family === "dp-max-subarray-deletion") return "values=[1,-2,0,3]";
  if (family === "dp-maximal-square") return "grid=[[1,1],[1,1]]";
  if (family === "dp-study-plan-cost") return "costs=[10,15,20]";
  if (family === "dp-coin-change") return "coins=[1,2], amount=4";
  if (family === "dp-blocked-stairs") return "openSteps=[1,1,0,1]";
  if (family === "graph-neighbor-count") return "edges=[A-B, A-C, B-D], node=A";
  if (family === "graph-course-chain") return "pairs=[COSC350->COSC220, COSC220->COSC112], course=COSC350, prereq=COSC112";
  if (family === "graph-campus-reachable") return "connections=[library-union, union-gym], start=library, target=gym";
  if (family === "graph-shortest-grid") return "grid=S..|.#.|..T";
  if (family === "graph-topological-order") return "prereqs=[B before C, A before B]";
  if (family === "graph-word-ladder") return "hit -> hot -> dot -> dog";
  if (family === "graph-clone") return "node 1 connected to 2 and 3";
  if (family === "graph-alien-order") return "words=[ba, bc, ac]";
  if (family === "tree-node-count") return "tree=[1,2,3,-1,4]";
  if (family === "tree-height") return "tree=[1,2,3,-1,4]";
  if (family === "tree-leaf-count") return "tree=[1,2,3,-1,4]";
  if (family === "tree-contains") return "tree=[5,3,8,-1,4], target=4";
  if (family === "tree-serialize") return "tree=[1,2,3]";
  if (family === "tree-level-sums") return "tree=[3,9,20,15,7]";
  if (family === "tree-right-side-view") return "tree=[1,2,3,5,4]";
  if (family === "tree-lca") return "tree=[3,5,1,6,2], a=6, b=2";
  if (family === "tree-path-sum-count") return "tree=[5,4,8,11,13], target=20";
  if (family === "queue-help-desk") return "commands=[join Ana, join Bo, serve, serve, serve]";
  if (family === "queue-serve-count") return "names=[Ana, Bo, Cy], serveCount=2";
  if (family === "queue-line-commands") {
    if (/front after/.test(title)) return "commands=[join Ana, join Bo, serve]";
    return "commands=[join Ana, join Bo, serve, join Cy]";
  }
  if (family === "queue-window-count") {
    if (/rate limiter/.test(title)) return "k=2, window=10, times=[1,2,11]";
    return "times=[1,2,8,12], window=5";
  }
  if (family === "queue-ticket-rounds") return "names=[Ana, Bo, Cy], tickets=[1,2,1]";

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
      if (title.includes("first score at least")) return "scores=[60,70,70,85], target=70";
      if (title.includes("first one index")) return "flags=[0,0,1,1]";
      if (title.includes("first passing score value")) return "scores=[55,61,70], passingScore=60";
      if (title.includes("median of two sorted lists")) return "left=[1,3], right=[2]";
      if (title.includes("insert position")) return "values=[1,3,5,6], target=2";
      if (title.includes("binary search exact")) return "values=[2,4,6,8], target=6";
      if (title.includes("first bad version")) return "versions=[0,0,1,1]";
      if (title.includes("last score at most")) return "scores=[50,60,60,70], target=60";
      return "values=[1, 3, 5], target=3";
    case "two-pointers":
      if (title.includes("edge pair matches")) return "words=[lab, quiz, lab]";
      if (title.includes("symmetric roster")) return "names=[Ana, Bo, Ana]";
      if (title.includes("count matching ends")) return "values=[1, 2, 2, 1]";
      if (title.includes("merge sorted lists")) return "left=[1,3,5], right=[2,4]";
      if (title.includes("pair sum sorted")) return "values=[1, 2, 4, 7], target=9";
      if (title.includes("reverse only letters")) return "a-bC-d";
      if (title.includes("closest pair sum")) return "values=[1, 4, 7, 10], target=12";
      if (title.includes("remove one target pair")) return "values=[1, 2, 4, 5], target=6";
      return "values=[1, 4, 6], target=7";
    case "sliding-window":
      if (title.includes("count short study blocks")) return "minutes=[20,30,45], limit=60";
      if (title.includes("three day study totals")) return "minutes=[30,45,25,20]";
      if (title.includes("any calm two day stretch")) return "minutes=[40,25,50], limit=70";
      if (title.includes("longest unique window")) return "abcabcbb";
      if (title.includes("window average")) return "values=[1,2,3,4], k=2";
      if (title.includes("maximum window sum")) return "values=[2,1,5,1,3], k=3";
      if (title.includes("minimum study window")) return "minutes=[10,20,30,40], target=70";
      if (title.includes("longest study stretch under limit")) return "minutes=[20,30,10,40], limit=60";
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
      if (title.includes("running prefix totals")) return "nums=[2,4,1]";
      if (title.includes("single range sum")) return "nums=[2,4,1,5], left=1, right=3";
      if (title.includes("prefix sum at index")) return "nums=[2,4,1], index=1";
      if (title.includes("one range sum")) return "nums=[2,4,1,3], left=1, right=2";
      if (title.includes("range sum queries")) return "nums=[2,4,1,3], queries=[[0,1],[1,3]]";
      if (title.includes("prefix balance index")) return "nums=[2,3,1,1,4]";
      if (title.includes("balanced prefix split")) return "nums=[1,2,3]";
      if (title.includes("subarray sum equals k")) return "values=[1,1,1], k=2";
      if (title.includes("longest subarray sum k")) return "nums=[1,-1,5,-2,3], k=3";
      if (title.includes("subarray sum count")) return "nums=[1,2,1,2], target=3";
      return "values=[2, 4, 1]";
    case "intervals":
      if (title.includes("two intervals overlap")) return "a=[1,4], b=[3,6]";
      if (title.includes("gap between ranges")) return "a=[1,3], b=[6,8]";
      if (title.includes("valid study schedule")) return "intervals=[[9,10],[10,11],[10,12]]";
      if (title.includes("merge overlapping intervals")) return "intervals=[[1,3],[2,6],[8,10]]";
      if (title.includes("count overlapping intervals")) return "intervals=[[9,11],[10,12],[13,15]], time=10";
      if (title.includes("insert one interval")) return "intervals=[[1,3],[6,8]], newInterval=[2,7]";
      if (title.includes("minimum meeting rooms")) return "intervals=[[0,30],[5,10],[15,20]]";
      if (title.includes("total busy minutes")) return "intervals=[[9,12],[11,13],[14,16]]";
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
    if (family === "trie-any-prefix") return "true";
    if (family === "trie-count-prefix-matches") return "2";
    if (family === "trie-all-share-prefix") return "true";
    if (family === "trie-first-word-prefix") return "cat";
    if (family === "trie-prefix-match-count") return "2";
    if (family === "trie-longest-common-prefix") return "ca";
    if (family === "trie-autocomplete-first") return "[cab, car]";
    if (family === "trie-longest-prefix-word") return "care";
    if (family === "trie-prefix-counts") return "2";
    if (family === "trie-any-has-prefix") return "true";
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
  if ((concept === "stack" || concept === "queue") && lines.length > 0) return lines;
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
  const nodes: Node[] = [];
  const rowCount = Math.min(grid.length, 5);
  const colCount = Math.min(Math.max(...grid.map((row) => row.length)), 6);
  const rowState = Number(state.row ?? state.currentRow);
  const colState = Number(state.column ?? state.col ?? state.currentCol);
  const fallbackCellIndex = Math.min(index, Math.max(rowCount * colCount - 1, 0));
  const fallbackCell = [Math.floor(fallbackCellIndex / Math.max(colCount, 1)), fallbackCellIndex % Math.max(colCount, 1)];
  const activeCells = new Set((Array.isArray(state.activeCells)
    ? state.activeCells
    : Number.isFinite(rowState) && Number.isFinite(colState)
      ? [[rowState, colState]]
      : [fallbackCell]).map((cell) => Array.isArray(cell) ? cell.join("-") : String(cell)));
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
  if (concept === "binary-search") return true;
  if (concept === "two-pointers") return true;
  if (concept === "sliding-window") return true;
  if (concept === "prefix-sum") return true;
  if (concept === "intervals") return true;
  if (concept === "heap") return true;
  if (concept === "trie") return true;
  if (concept === "linked-list") return true;
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
        { active: [0, 1], title: context.title || "Split words", desc: "The sentence becomes two word pieces: red and blue.", line: 1, result: "not changed yet", state: { visual_family: "string-reverse-words", words: "[red, blue]", result_words: "", result_active_index: -1 } },
        { active: [1], visited: [1], title: "Read blue", desc: "Start from the last word because the output is reversed.", line: 2, result: "not changed yet", state: { visual_family: "string-reverse-words", result_words: "", result_active_index: 0, moving_word: "blue" } },
        { active: [1], visited: [1], title: "Place blue", desc: "blue becomes the first word in the result.", line: 3, result: "blue", state: { visual_family: "string-reverse-words", result_words: "blue", result_active_index: 0, moving_word: "blue" } },
        { active: [0], visited: [1], title: "Read red", desc: "Move left to the remaining word.", line: 4, result: "blue", state: { visual_family: "string-reverse-words", result_words: "blue", result_active_index: 1, moving_word: "red" } },
        { active: [0], visited: [0, 1], title: "Place red", desc: "Add red after blue.", line: 5, result: "blue red", state: { visual_family: "string-reverse-words", result_words: "blue|red", result_active_index: 1, moving_word: "red" } },
        { active: [0, 1], visited: [0, 1], title: "Return blue red", desc: "Every word has moved into reversed order.", line: 6, result: "blue red", state: { visual_family: "string-reverse-words", result_words: "blue|red", result_active_index: 1, moving_word: "done" } },
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
      state: {
        example: "grid=[[1,1,0],[0,0,1],[1,0,1]]",
        target: "count separate land groups",
        ...phase.state,
      },
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
    { title: context.title || "Read the input", desc: "Use a compact sample: [1, 2, 0]. The answer should be 3.", nodes: buildNodes(["item-0", "item-1", "item-2"], [], null, "not found yet"), edges: [], line: 1, state: { example: "[1, 2, 0]", positives: "empty", candidate: "none", result: "not final" } },
    { title: "Store positive 1", desc: "1 is positive, so it goes into the set of numbers that exist.", nodes: buildNodes(["item-0"], [1], null, "not found yet", ["filter-rule", "positive-1"]), edges: edgesFor(null), line: 3, state: { example: "[1, 2, 0]", positives: "{1}", candidate: "none", result: "not final" } },
    { title: "Store positive 2", desc: "2 is positive too, so it is stored beside 1.", nodes: buildNodes(["item-1"], [1, 2], null, "not found yet", ["filter-rule", "positive-2"]), edges: edgesFor(null), line: 3, state: { example: "[1, 2, 0]", positives: "{1, 2}", candidate: "none", result: "not final" } },
    { title: "Ignore 0", desc: "0 cannot be the smallest positive answer, so it stays out of the set.", nodes: buildNodes(["item-2"], [1, 2], null, "not found yet", ["filter-rule"]), edges: edgesFor(null), line: 3, state: { example: "[1, 2, 0]", positives: "{1, 2}", ignored: "0", result: "not final" } },
    { title: "Check candidate 1", desc: "Candidate 1 is already in the set, so it is not missing.", nodes: buildNodes([], [1, 2], 1, "not found yet", ["candidate-check", "positive-1"]), edges: edgesFor(1), line: 5, state: { example: "[1, 2, 0]", positives: "{1, 2}", candidate: 1, decision: "present", result: "not final" } },
    { title: "Check candidate 2", desc: "Candidate 2 is also present, so move to the next positive integer.", nodes: buildNodes([], [1, 2], 2, "not found yet", ["candidate-check", "positive-2"]), edges: edgesFor(2), line: 6, state: { example: "[1, 2, 0]", positives: "{1, 2}", candidate: 2, decision: "present", result: "not final" } },
    { title: "Check candidate 3", desc: "3 is not in the set. This is the first missing positive.", nodes: buildNodes([], [1, 2], 3, "3", ["candidate-check"]), edges: edgesFor(3, true), line: 5, state: { example: "[1, 2, 0]", positives: "{1, 2}", candidate: 3, decision: "missing", result: "3" } },
    { title: "Return 3", desc: "Return the first positive number that did not appear in the input.", nodes: buildNodes([], [1, 2], 3, "3", ["candidate-check", "result-node"]), edges: edgesFor(3, true), line: 7, state: { example: "[1, 2, 0]", result: "3" } },
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

function setMemoryNode(id: string, value: string | number, x: number, y: number, label: string, state: Node["state"] = "default"): Node {
  return { id, value, x, y, label, type: "set-item", state, meta: { role: "memory" } };
}

export function generateFirstRepeatedSetSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "seen = empty set",
    "for each character from left to right",
    "if character is already in seen, return it",
    "otherwise add character to seen",
    "return none if the scan ends",
  ];
  const letters = ["c", "o", "c", "o", "a"];
  const baseLetters = layoutArray(letters, { y: 130, gap: 82 });
  const makeNodes = (activeLetter: number, seen: string[], result = "not found yet", activeSeen = ""): Node[] => [
    ...baseLetters.map((node, index) => ({
      ...node,
      state: index < activeLetter ? "visited" as const : index === activeLetter ? "active" as const : "default" as const,
    })),
    { id: "seen-label", x: 150, y: 320, value: "seen", label: "set memory", type: "logic-node", state: "default" },
    ...(seen.length
      ? seen.map((letter, index) => setMemoryNode(`seen-${letter}`, letter, 300 + index * 92, 320, "remembered", letter === activeSeen ? "active" : "visited"))
      : [setMemoryNode("seen-empty", "empty", 340, 320, "set memory", "inactive")]),
    { id: "result", x: 590, y: 465, value: result, label: "first repeat", type: "logic-node", state: result === "not found yet" ? "default" : "matched", meta: { role: "result" } },
  ];
  const phases = [
    { title: context.title || "First Repeated Character", desc: "Use a short sample, cocoa, so the set-memory move stays easy to follow.", idx: 0, seen: [] as string[], line: 1, state: { example: "cocoa", seen: "empty", result: "not found yet" } },
    { title: "Remember c", desc: "c has not appeared before, so add it to the set.", idx: 0, seen: ["c"], activeSeen: "c", line: 4, state: { example: "cocoa", checking: "c", seen: "{c}", result: "not found yet" } },
    { title: "Remember o", desc: "o is new too. The set now remembers c and o.", idx: 1, seen: ["c", "o"], activeSeen: "o", line: 4, state: { example: "cocoa", checking: "o", seen: "{c, o}", result: "not found yet" } },
    { title: "Find repeated c", desc: "The next c is already in the set, so it is the first repeated character.", idx: 2, seen: ["c", "o"], activeSeen: "c", line: 3, result: "c", state: { example: "cocoa", checking: "c", seen: "{c, o}", decision: "already seen", result: "c" } },
    { title: "Return c", desc: "Return immediately when the first repeated character is found.", idx: 2, seen: ["c", "o"], activeSeen: "c", line: 3, result: "c", state: { example: "cocoa", result: "c" } },
  ];
  return phases.map((phase, index) => {
    const nodes = makeNodes(phase.idx, phase.seen, phase.result || "not found yet", phase.activeSeen || "");
    const edgeIds = phase.activeSeen ? [`letter-seen-${phase.activeSeen}`] : [];
    const edges: Edge[] = edgeIds.map((id) => ({ id, from: `item-${phase.idx}`, to: `seen-${phase.activeSeen}`, type: "pointer", state: "active" }));
    return step({
      concept: "set",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges,
      highlights: { nodeIds: nodes.filter((node) => node.state === "active" || node.state === "matched").map((node) => node.id), edgeIds, lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateUniqueCountSetSteps(context: GeneratorContext = {}): Step[] {
  const code = ["unique = empty set", "for each value", "add value to unique", "duplicates do not increase set size", "return size of unique"];
  const values = /parking|zones/i.test(context.title || "") ? ["A", "A", "B", "C"] : [4, 4, 2, 7, 2];
  const baseValues = layoutArray(values, { y: 135, gap: 96 });
  const phases = [
    { title: context.title || "Unique Count", idx: 0, seen: [] as Array<string | number>, desc: "Start with an empty set before reading the first value.", line: 1, state: { example: `[${values.join(", ")}]`, unique: "empty", count: 0, result: "not final" } },
    { title: `Add ${values[0]}`, idx: 0, seen: [values[0]], desc: `${values[0]} is new, so the set size becomes 1.`, line: 3, state: { example: `[${values.join(", ")}]`, checking: String(values[0]), unique: `{${values[0]}}`, count: 1, result: "not final" } },
    { title: `Skip duplicate ${values[1]}`, idx: 1, seen: [values[0]], desc: `${values[1]} is already in the set, so the count does not change.`, line: 4, state: { example: `[${values.join(", ")}]`, checking: String(values[1]), duplicate: String(values[1]), count: 1, result: "not final" } },
    { title: `Add ${values[2]}`, idx: 2, seen: [values[0], values[2]], desc: `${values[2]} is new, so it increases the unique count.`, line: 3, state: { example: `[${values.join(", ")}]`, checking: String(values[2]), unique: `{${values[0]}, ${values[2]}}`, count: 2, result: "not final" } },
    { title: `Add ${values[3]}`, idx: 3, seen: [values[0], values[2], values[3]], desc: `${values[3]} is another new value, so the set size becomes 3.`, line: 3, state: { example: `[${values.join(", ")}]`, checking: String(values[3]), count: 3, result: "not final" } },
    { title: "Return unique count", idx: 4, seen: [values[0], values[2], values[3]], desc: "Return the set size, not the length of the original list.", line: 5, state: { example: `[${values.join(", ")}]`, result: 3 } },
  ];
  return phases.map((phase, index) => {
    const nodes: Node[] = [
      ...baseValues.map((node, itemIndex) => ({ ...node, state: itemIndex === phase.idx ? "active" as const : itemIndex < phase.idx ? "visited" as const : "default" as const })),
      ...phase.seen.map((value, seenIndex) => setMemoryNode(`seen-${seenIndex}`, value, 320 + seenIndex * 120, 340, "unique set", "visited")),
      { id: "count", x: 620, y: 460, value: Number(phase.state.count ?? phase.state.result ?? 0), label: "set size", type: "logic-node", state: "matched", meta: { role: "result" } },
    ];
    return step({
      concept: "set",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: [`item-${phase.idx}`, "count"], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateSetIntersectionSteps(context: GeneratorContext = {}): Step[] {
  const code = ["memory = set(second list)", "for each topic in first list", "if topic is in memory and not already output", "append topic to shared", "return shared"];
  const first = ["loops", "sets", "loops"];
  const secondSet = ["sets", "arrays"];
  const firstNodes = layoutArray(first, { y: 130, gap: 118 });
  const phases = [
    { title: context.title || "Shared Study Topics", idx: 0, shared: [] as string[], desc: "Store the second list as set memory: sets and arrays.", line: 1, activeMemory: "", state: { example: "first=[loops,sets,loops], second=[sets,arrays]", memory: "{sets, arrays}", shared: "empty", result: "not final" } },
    { title: "Check loops", idx: 0, shared: [] as string[], desc: "loops is not in the second set, so it is not shared.", line: 3, activeMemory: "", state: { example: "first=[loops,sets,loops], second=[sets,arrays]", checking: "loops", decision: "not shared", result: "not final" } },
    { title: "Check sets", idx: 1, shared: [] as string[], desc: "sets is in the second set, so it belongs in the shared output.", line: 3, activeMemory: "sets", state: { example: "first=[loops,sets,loops], second=[sets,arrays]", checking: "sets", decision: "shared", result: "not final" } },
    { title: "Append sets once", idx: 1, shared: ["sets"], desc: "Add sets to the result. A result set prevents adding the same shared topic twice.", line: 4, activeMemory: "sets", state: { example: "first=[loops,sets,loops], second=[sets,arrays]", shared: "[sets]", result: "[sets]" } },
    { title: "Skip repeated loops", idx: 2, shared: ["sets"], desc: "The last loops is still not in memory, so the output stays unchanged.", line: 3, activeMemory: "", state: { example: "first=[loops,sets,loops], second=[sets,arrays]", checking: "loops", shared: "[sets]", result: "[sets]" } },
    { title: "Return shared topics", idx: 1, shared: ["sets"], desc: "Only topics found in both collections are returned.", line: 5, activeMemory: "sets", state: { example: "first=[loops,sets,loops], second=[sets,arrays]", result: "[sets]" } },
  ];
  return phases.map((phase, index) => {
    const nodes: Node[] = [
      ...firstNodes.map((node, itemIndex) => ({ ...node, label: "first list", state: itemIndex === phase.idx ? "active" as const : itemIndex < phase.idx ? "visited" as const : "default" as const })),
      ...secondSet.map((topic, memoryIndex) => setMemoryNode(`memory-${topic}`, topic, 380 + memoryIndex * 145, 320, "second-set memory", topic === phase.activeMemory ? "active" : "visited")),
      { id: "shared", x: 535, y: 465, value: phase.shared.length ? `[${phase.shared.join(", ")}]` : "empty", label: "shared output", type: "logic-node", state: phase.shared.length ? "matched" : "default", meta: { role: "result" } },
    ];
    const edges = phase.activeMemory ? [{ id: "membership-check", from: `item-${phase.idx}`, to: `memory-${phase.activeMemory}`, type: "pointer" as const, state: "active" as const }] : [];
    return step({
      concept: "set",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges,
      highlights: { nodeIds: [`item-${phase.idx}`, ...(phase.activeMemory ? [`memory-${phase.activeMemory}`] : []), "shared"], edgeIds: edges.map((edge) => edge.id || ""), lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateTreeInsertSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("binary-tree", context);
  if (family !== "graph-traversal") return generateTreePracticeSteps(context, family);
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

function generateTreePracticeSteps(context: GeneratorContext, family: VisualizerFamily): Step[] {
  type TreePhase = {
    title: string;
    desc: string;
    active: string[];
    visited?: string[];
    path?: string[];
    skipped?: string[];
    edges?: string[];
    pathEdges?: string[];
    line: number;
    state: Record<string, string | number | boolean>;
  };
  type TreeConfig = {
    values: Array<string | number>;
    example: string;
    target: string;
    code: string[];
    phases: TreePhase[];
  };
  const countCode = ["start at the root", "visit one real node", "update the count if this node qualifies", "move to the left child", "move to the right child", "combine what the children found", "keep the saved result visible", "return the requested count"];
  const levelCode = ["start with the root level", "read every node in this level", "combine this level's values", "store this level's result", "move to the next level", "repeat while levels remain", "keep the saved list visible", "return the list"];
  const configs: Partial<Record<VisualizerFamily, TreeConfig>> = {
    "tree-node-count": {
      values: [1, 2, 3, -1, 4],
      example: "tree=[1,2,3,-1,4]",
      target: "count real nodes",
      code: countCode,
      phases: [
        { title: context.title || "Tree Node Count", desc: "Start at the root. Missing slots do not count as nodes.", active: ["tree-0"], line: 1, state: { current: 1, count: 0 } },
        { title: "Count root", desc: "Node 1 is real, so the count becomes 1.", active: ["tree-0"], visited: ["tree-0"], line: 3, state: { current: 1, count: 1 } },
        { title: "Count left child", desc: "Node 2 is real, so it adds one.", active: ["tree-1"], visited: ["tree-0", "tree-1"], edges: ["tree-0-tree-1"], line: 4, state: { current: 2, count: 2 } },
        { title: "Skip missing child", desc: "The missing left child under 2 adds nothing.", active: ["tree-1"], visited: ["tree-0", "tree-1"], line: 4, state: { skipped: "missing child", count: 2 } },
        { title: "Count node 4", desc: "Node 4 is real, so it adds one.", active: ["tree-4"], visited: ["tree-0", "tree-1", "tree-4"], edges: ["tree-1-tree-4"], line: 5, state: { current: 4, count: 3 } },
        { title: "Count right child", desc: "Node 3 is also real.", active: ["tree-2"], visited: ["tree-0", "tree-1", "tree-4", "tree-2"], edges: ["tree-0-tree-2"], line: 5, state: { current: 3, count: 4 } },
        { title: "All nodes checked", desc: "The real nodes are 1, 2, 4, and 3.", active: ["tree-0"], visited: ["tree-0", "tree-1", "tree-4", "tree-2"], line: 7, state: { counted_nodes: "1, 2, 4, 3", result: 4 } },
        { title: "Return 4", desc: "Return the saved node count.", active: ["tree-0"], visited: ["tree-0", "tree-1", "tree-4", "tree-2"], line: 8, state: { final_result: 4 } },
      ],
    },
    "tree-height": {
      values: [1, 2, 3, -1, 4],
      example: "tree=[1,2,3,-1,4]",
      target: "count height levels",
      code: ["start at the root level", "height starts at zero", "finish one real level", "add one to height", "send children to the next level", "repeat until no level remains", "keep the deepest level visible", "return the height"],
      phases: [
        { title: context.title || "Tree Height Levels", desc: "Height is the number of levels that contain real nodes.", active: ["tree-0"], line: 1, state: { level: 1, height: 0 } },
        { title: "Finish level 1", desc: "The root level exists.", active: ["tree-0"], visited: ["tree-0"], line: 4, state: { level: 1, height: 1 } },
        { title: "Move to level 2", desc: "Nodes 2 and 3 are on the second level.", active: ["tree-1", "tree-2"], visited: ["tree-0"], edges: ["tree-0-tree-1", "tree-0-tree-2"], line: 5, state: { level: 2, nodes: "2, 3", height: 1 } },
        { title: "Finish level 2", desc: "Because this level has real nodes, height becomes 2.", active: ["tree-1", "tree-2"], visited: ["tree-0", "tree-1", "tree-2"], line: 4, state: { level: 2, height: 2 } },
        { title: "Move to level 3", desc: "Node 4 creates one deeper level.", active: ["tree-4"], visited: ["tree-0", "tree-1", "tree-2"], edges: ["tree-1-tree-4"], line: 5, state: { level: 3, nodes: "4", height: 2 } },
        { title: "Finish level 3", desc: "The deepest real level is now counted.", active: ["tree-4"], visited: ["tree-0", "tree-1", "tree-2", "tree-4"], line: 6, state: { level: 3, height: 3 } },
        { title: "Next level is empty", desc: "No real children remain below node 4.", active: ["tree-4"], visited: ["tree-0", "tree-1", "tree-2", "tree-4"], line: 7, state: { next_level: "empty", result: 3 } },
        { title: "Return 3", desc: "Return the number of real levels.", active: ["tree-0"], visited: ["tree-0", "tree-1", "tree-2", "tree-4"], line: 8, state: { final_result: 3 } },
      ],
    },
    "tree-leaf-count": {
      values: [1, 2, 3, -1, 4],
      example: "tree=[1,2,3,-1,4]",
      target: "count nodes with no children",
      code: countCode,
      phases: [
        { title: context.title || "Tree Leaf Count", desc: "A leaf is a real node with no real children.", active: ["tree-0"], line: 1, state: { current: 1, leaves: 0 } },
        { title: "Root has children", desc: "Node 1 is not a leaf because it has children.", active: ["tree-0"], visited: ["tree-0"], edges: ["tree-0-tree-1", "tree-0-tree-2"], line: 3, state: { current: 1, decision: "not a leaf", leaves: 0 } },
        { title: "Node 2 has child 4", desc: "Node 2 is not a leaf either.", active: ["tree-1"], visited: ["tree-0", "tree-1"], edges: ["tree-1-tree-4"], line: 4, state: { current: 2, decision: "not a leaf", leaves: 0 } },
        { title: "Count node 4", desc: "Node 4 has no children, so it is a leaf.", active: ["tree-4"], visited: ["tree-0", "tree-1", "tree-4"], line: 3, state: { current: 4, leaves: 1 } },
        { title: "Check node 3", desc: "Move to the other child of the root.", active: ["tree-2"], visited: ["tree-0", "tree-1", "tree-4"], edges: ["tree-0-tree-2"], line: 5, state: { current: 3, leaves: 1 } },
        { title: "Count node 3", desc: "Node 3 has no children, so it is also a leaf.", active: ["tree-2"], visited: ["tree-0", "tree-1", "tree-4", "tree-2"], line: 3, state: { current: 3, leaves: 2 } },
        { title: "Leaves found", desc: "The leaves are 4 and 3.", active: ["tree-4", "tree-2"], visited: ["tree-0", "tree-1", "tree-4", "tree-2"], line: 7, state: { leaf_nodes: "4, 3", result: 2 } },
        { title: "Return 2", desc: "Return the leaf count.", active: ["tree-4", "tree-2"], visited: ["tree-0", "tree-1", "tree-4", "tree-2"], line: 8, state: { final_result: 2 } },
      ],
    },
    "tree-contains": {
      values: [5, 3, 8, -1, 4],
      example: "tree=[5,3,8,-1,4], target=4",
      target: "find whether 4 exists",
      code: ["start at the root", "compare current node with target", "move to a child that could contain it", "skip missing branches", "mark found when values match", "remember visited nodes", "stop when found or empty", "return the boolean result"],
      phases: [
        { title: context.title || "Tree Contains Value", desc: "Look for target 4 starting at the root.", active: ["tree-0"], line: 1, state: { current: 5, target_value: 4, result: "not final" } },
        { title: "5 is not 4", desc: "The root does not match, so keep searching.", active: ["tree-0"], visited: ["tree-0"], line: 2, state: { current: 5, decision: "keep searching" } },
        { title: "Try node 3", desc: "Move to the left child.", active: ["tree-1"], visited: ["tree-0"], edges: ["tree-0-tree-1"], line: 3, state: { current: 3 } },
        { title: "3 is not 4", desc: "Node 3 does not match.", active: ["tree-1"], visited: ["tree-0", "tree-1"], line: 2, state: { current: 3, decision: "keep searching" } },
        { title: "Move to node 4", desc: "Node 4 is the next real child on this path.", active: ["tree-4"], visited: ["tree-0", "tree-1"], edges: ["tree-1-tree-4"], line: 3, state: { current: 4 } },
        { title: "Found target", desc: "The current node matches the target.", active: ["tree-4"], path: ["tree-0", "tree-1", "tree-4"], pathEdges: ["tree-0-tree-1", "tree-1-tree-4"], line: 5, state: { current: 4, result: "true" } },
        { title: "Skip other side", desc: "Once 4 is found, the other branch is not needed.", active: ["tree-4"], path: ["tree-0", "tree-1", "tree-4"], skipped: ["tree-2"], line: 7, state: { skipped: "right branch", result: "true" } },
        { title: "Return true", desc: "Return the boolean result.", active: ["tree-4"], path: ["tree-0", "tree-1", "tree-4"], skipped: ["tree-2"], line: 8, state: { final_result: "true" } },
      ],
    },
    "tree-serialize": {
      values: [1, 2, 3],
      example: "tree=[1,2,3]",
      target: "write preorder with missing markers",
      code: ["start at the root", "write the current node value", "serialize the left child", "write a marker for a missing child", "serialize the right child", "return to the parent after each child", "keep the output in order", "return the serialized text"],
      phases: [
        { title: context.title || "Serialize Binary Tree", desc: "Preorder writes a node before its children.", active: ["tree-0"], line: 1, state: { current: 1, output: "empty" } },
        { title: "Write 1", desc: "The first token is the root value.", active: ["tree-0"], visited: ["tree-0"], line: 2, state: { current: 1, output: "1" } },
        { title: "Write left child 2", desc: "Then serialize the left child.", active: ["tree-1"], visited: ["tree-0", "tree-1"], edges: ["tree-0-tree-1"], line: 3, state: { current: 2, output: "1,2" } },
        { title: "Mark missing children", desc: "Node 2's missing children are written as markers.", active: ["tree-1"], visited: ["tree-0", "tree-1"], line: 4, state: { markers: "two #", output: "1,2,#,#" } },
        { title: "Write right child 3", desc: "Return to root, then serialize the right child.", active: ["tree-2"], visited: ["tree-0", "tree-1", "tree-2"], edges: ["tree-0-tree-2"], line: 5, state: { current: 3, output: "1,2,#,#,3" } },
        { title: "Mark final missing children", desc: "Node 3 also has missing children markers.", active: ["tree-2"], visited: ["tree-0", "tree-1", "tree-2"], line: 4, state: { markers: "two #", output: "1,2,#,#,3,#,#" } },
        { title: "Shape is encoded", desc: "Values plus markers preserve both values and structure.", active: ["tree-0"], visited: ["tree-0", "tree-1", "tree-2"], line: 7, state: { result: "1,2,#,#,3,#,#" } },
        { title: "Return text", desc: "Return the serialized text.", active: ["tree-0"], visited: ["tree-0", "tree-1", "tree-2"], line: 8, state: { final_result: "1,2,#,#,3,#,#" } },
      ],
    },
    "tree-level-sums": {
      values: [3, 9, 20, -1, -1, 15, 7],
      example: "tree=[3,9,20,-1,-1,15,7]",
      target: "sum each level",
      code: levelCode,
      phases: [
        { title: context.title || "Tree Level Sums", desc: "Process one horizontal level at a time.", active: ["tree-0"], line: 1, state: { level: 0, result: "[]" } },
        { title: "Store level 0", desc: "The root level sums to 3.", active: ["tree-0"], visited: ["tree-0"], line: 4, state: { level: 0, level_sum: 3, result: "[3]" } },
        { title: "Move to level 1", desc: "Nodes 9 and 20 share level 1.", active: ["tree-1", "tree-2"], visited: ["tree-0"], edges: ["tree-0-tree-1", "tree-0-tree-2"], line: 5, state: { level: 1, nodes: "9, 20" } },
        { title: "Add 9", desc: "Start the level sum with 9.", active: ["tree-1"], visited: ["tree-0", "tree-1"], line: 2, state: { level: 1, level_sum: 9 } },
        { title: "Add 20", desc: "Add 20 to finish level 1.", active: ["tree-2"], visited: ["tree-0", "tree-1", "tree-2"], line: 3, state: { level: 1, level_sum: 29, result: "[3, 29]" } },
        { title: "Move to level 2", desc: "Nodes 15 and 7 are below 20.", active: ["tree-5", "tree-6"], visited: ["tree-0", "tree-1", "tree-2"], edges: ["tree-2-tree-5", "tree-2-tree-6"], line: 5, state: { level: 2, nodes: "15, 7" } },
        { title: "Store level 2", desc: "15 plus 7 gives 22.", active: ["tree-5", "tree-6"], visited: ["tree-0", "tree-1", "tree-2", "tree-5", "tree-6"], line: 7, state: { level_sum: 22, result: "[3, 29, 22]" } },
        { title: "Return sums", desc: "Return the saved level sums.", active: ["tree-0"], visited: ["tree-0", "tree-1", "tree-2", "tree-5", "tree-6"], line: 8, state: { final_result: "[3, 29, 22]" } },
      ],
    },
    "tree-right-side-view": {
      values: [1, 2, 3, -1, 5, -1, 4],
      example: "tree=[1,2,3,-1,5,-1,4]",
      target: "visible nodes from the right",
      code: ["start with the root level", "scan one level at a time", "remember the rightmost real node", "add that node to the view", "move to the next level", "dim nodes hidden from the right", "repeat until no levels remain", "return the visible list"],
      phases: [
        { title: context.title || "Tree Right Side View", desc: "Only the rightmost real node on each level is visible.", active: ["tree-0"], line: 1, state: { level: 0, view: "[]" } },
        { title: "Root is visible", desc: "The root is the right-side view for level 0.", active: ["tree-0"], visited: ["tree-0"], line: 4, state: { visible: 1, view: "[1]" } },
        { title: "Check level 1", desc: "Level 1 has nodes 2 and 3.", active: ["tree-1", "tree-2"], visited: ["tree-0"], line: 2, state: { level: 1, candidates: "2, 3" } },
        { title: "Choose 3", desc: "Node 3 is farther right, so it is visible.", active: ["tree-2"], visited: ["tree-0", "tree-2"], skipped: ["tree-1"], line: 3, state: { visible: 3, hidden: 2, view: "[1, 3]" } },
        { title: "Check level 2", desc: "Level 2 has nodes 5 and 4.", active: ["tree-4", "tree-6"], visited: ["tree-0", "tree-2"], line: 5, state: { level: 2, candidates: "5, 4" } },
        { title: "Choose 4", desc: "Node 4 is visible from the right.", active: ["tree-6"], visited: ["tree-0", "tree-2", "tree-6"], skipped: ["tree-1", "tree-4"], line: 6, state: { visible: 4, hidden: 5, view: "[1, 3, 4]" } },
        { title: "All levels scanned", desc: "The hidden nodes are dimmed; the view list is ready.", active: ["tree-0"], visited: ["tree-0", "tree-2", "tree-6"], skipped: ["tree-1", "tree-4"], line: 7, state: { result: "[1, 3, 4]" } },
        { title: "Return view", desc: "Return the visible nodes from top to bottom.", active: ["tree-0"], visited: ["tree-0", "tree-2", "tree-6"], skipped: ["tree-1", "tree-4"], line: 8, state: { final_result: "[1, 3, 4]" } },
      ],
    },
    "tree-lca": {
      values: [3, 5, 1, 6, 2, 0, 8],
      example: "tree=[3,5,1,6,2,0,8], a=6, b=2",
      target: "lowest shared ancestor",
      code: ["start at the root", "search for the first target", "remember that target path", "search for the second target", "remember that target path", "compare paths from the root", "keep the deepest shared node", "return that node value"],
      phases: [
        { title: context.title || "Lowest Common Ancestor Value", desc: "Find the deepest node that sits above both targets.", active: ["tree-0"], line: 1, state: { targets: "6 and 2", ancestor: "not final" } },
        { title: "Path to 6", desc: "The first target path is 3 to 5 to 6.", active: ["tree-3"], path: ["tree-0", "tree-1", "tree-3"], pathEdges: ["tree-0-tree-1", "tree-1-tree-3"], line: 3, state: { path_to_6: "3 -> 5 -> 6" } },
        { title: "Back to node 5", desc: "Node 5 is shared so far.", active: ["tree-1"], path: ["tree-0", "tree-1"], pathEdges: ["tree-0-tree-1"], line: 3, state: { shared_so_far: "3 -> 5" } },
        { title: "Path to 2", desc: "The second target path is 3 to 5 to 2.", active: ["tree-4"], path: ["tree-0", "tree-1", "tree-4"], pathEdges: ["tree-0-tree-1", "tree-1-tree-4"], line: 5, state: { path_to_2: "3 -> 5 -> 2" } },
        { title: "Compare paths", desc: "Both paths include 3 and 5.", active: ["tree-0", "tree-1"], path: ["tree-0", "tree-1"], pathEdges: ["tree-0-tree-1"], line: 6, state: { shared_nodes: "3, 5" } },
        { title: "Choose deepest shared", desc: "5 is lower than 3 and still above both targets.", active: ["tree-1"], path: ["tree-1", "tree-3", "tree-4"], pathEdges: ["tree-1-tree-3", "tree-1-tree-4"], line: 7, state: { ancestor: 5 } },
        { title: "Dim unrelated side", desc: "The right subtree is not part of either target path.", active: ["tree-1"], path: ["tree-1", "tree-3", "tree-4"], skipped: ["tree-2", "tree-5", "tree-6"], line: 7, state: { skipped: "right subtree", result: 5 } },
        { title: "Return 5", desc: "Return the lowest shared ancestor value.", active: ["tree-1"], path: ["tree-1", "tree-3", "tree-4"], skipped: ["tree-2", "tree-5", "tree-6"], line: 8, state: { final_result: 5 } },
      ],
    },
    "tree-path-sum-count": {
      values: [5, 4, 8, 11, 13],
      example: "tree=[5,4,8,11,13], target=20",
      target: "count root-to-leaf paths that hit target",
      code: ["start at the root", "carry the current path state", "move down one child", "update the path state", "check the leaf or target rule", "back up to try another branch", "save only matching paths", "return the saved result"],
      phases: [
        { title: context.title || "Tree Path Sum Count", desc: "Carry the running sum as the path moves downward.", active: ["tree-0"], line: 1, state: { current: 5, target_sum: 20, running_sum: 5, matches: 0 } },
        { title: "Go to 4", desc: "Add node 4 to the current path.", active: ["tree-1"], visited: ["tree-0", "tree-1"], edges: ["tree-0-tree-1"], line: 3, state: { path: "5 -> 4", running_sum: 9, matches: 0 } },
        { title: "Go to 11", desc: "Add node 11 to the same path.", active: ["tree-3"], visited: ["tree-0", "tree-1", "tree-3"], edges: ["tree-1-tree-3"], line: 4, state: { path: "5 -> 4 -> 11", running_sum: 20 } },
        { title: "Leaf matches", desc: "This root-to-leaf path reaches the target sum.", active: ["tree-3"], path: ["tree-0", "tree-1", "tree-3"], pathEdges: ["tree-0-tree-1", "tree-1-tree-3"], line: 5, state: { matching_path: "5 -> 4 -> 11", matches: 1 } },
        { title: "Back up", desc: "After counting that path, try the right side.", active: ["tree-2"], visited: ["tree-0", "tree-1", "tree-3", "tree-2"], edges: ["tree-0-tree-2"], line: 6, state: { path: "5 -> 8", running_sum: 13, matches: 1 } },
        { title: "Try 13", desc: "The right branch path becomes 5 to 8 to 13.", active: ["tree-4"], visited: ["tree-0", "tree-1", "tree-3", "tree-2", "tree-4"], edges: ["tree-2-tree-4"], line: 4, state: { path: "5 -> 8 -> 13", running_sum: 26 } },
        { title: "Do not count 26", desc: "This leaf does not match the target, so the count stays 1.", active: ["tree-4"], visited: ["tree-0", "tree-1", "tree-3", "tree-2"], skipped: ["tree-4"], line: 7, state: { skipped_sum: 26, matches: 1 } },
        { title: "Return 1", desc: "Return how many root-to-leaf paths matched the target.", active: ["tree-3"], path: ["tree-0", "tree-1", "tree-3"], skipped: ["tree-4"], pathEdges: ["tree-0-tree-1", "tree-1-tree-3"], line: 8, state: { final_result: 1 } },
      ],
    },
  };
  const config = configs[family] || configs["tree-node-count"]!;
  const base = treeFromArray(config.values, 0);
  return config.phases.map((phase, index) => {
    const active = new Set(phase.active);
    const visited = new Set(phase.visited || []);
    const path = new Set(phase.path || []);
    const skipped = new Set(phase.skipped || []);
    const pathEdges = new Set(phase.pathEdges || []);
    const nodes = base.nodes.map((node) => ({
      ...node,
      state: active.has(node.id)
        ? "active" as const
        : path.has(node.id)
          ? "path" as const
          : visited.has(node.id)
            ? "visited" as const
            : skipped.has(node.id)
              ? "skipped" as const
              : "default" as const,
    }));
    const baseEdges = base.edges.map((edge) => {
      const id = edge.id || `${edge.from}-${edge.to}`;
      return { ...edge, state: pathEdges.has(id) ? "path" as const : "default" as const };
    });
    const activeEdges = phase.edges || phase.pathEdges || [];
    return step({
      concept: "binary-tree",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: withEdgeState(baseEdges, activeEdges, phase.pathEdges?.length ? "path" : "active"),
      highlights: { nodeIds: [...phase.active, ...(phase.path || [])], edgeIds: activeEdges, lineNumbers: [phase.line] },
      code: config.code,
      activeLine: phase.line,
      workflow: workflowFromLabels(config.phases.map((item) => item.title), index),
      state: {
        example: config.example,
        target: config.target,
        ...phase.state,
      },
    }, index + 1);
  });
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
      state: { example: "items=[A, B, A]", target: "count each item", current: key, table: phase.result },
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
    { idx: 0, visual: empty, active: ["bucket-2"], title: context.title || "Find a complement", desc: "We need two numbers that add to target 9. The table starts empty.", line: 1, state: { target: 9, key: "none yet", bucket: "?", seen: "empty", hashRule: "wait for a key" } },
    { idx: 0, visual: empty, active: ["bucket-2"], title: "Read 2, need 7", desc: "For current number 2, the missing partner is 7 because 9 - 2 = 7.", line: 3, state: { target: 9, key: "need 7", num: 2, need: 7, bucket: 2, result: "7 not found", hashRule: "7 % 5 = 2" } },
    { idx: 0, visual: withTwo, active: ["bucket-2", "entry-2-0"], title: "Store 2 at index 0", desc: "7 was not found, so save the current number 2 with its index for a later match.", line: 5, state: { target: 9, key: "num 2", num: 2, bucket: 2, seen: "2 -> 0", hashRule: "2 % 5 = 2" } },
    { idx: 1, visual: withTwo, active: ["bucket-2"], title: "Read 7, need 2", desc: "Move to the next number. For current number 7, the missing partner is 2 because 9 - 7 = 2.", line: 3, state: { target: 9, key: "need 2", num: 7, need: 2, bucket: 2, result: "checking for 2", hashRule: "2 % 5 = 2" } },
    { idx: 1, visual: withTwo, active: ["bucket-2", "entry-2-0"], title: "Jump to bucket 2", desc: "Hashing the needed value 2 points to bucket 2, so only this bucket's chain is checked.", line: 4, state: { target: 9, key: "need 2", num: 7, need: 2, bucket: 2, found: "checking 2:0", hashRule: "2 % 5 = 2" } },
    { idx: 1, visual: withTwo, active: ["entry-2-0"], title: "Find stored 2", desc: "The entry 2:0 means value 2 was seen earlier at index 0.", line: 4, state: { target: 9, key: "need 2", num: 7, need: 2, bucket: 2, found: "2 at index 0", hashRule: "2 % 5 = 2" } },
    { idx: 1, visual: withTwo, active: ["entry-2-0"], title: "Pair old index with current", desc: "The stored index 0 pairs with the current index 1, so the answer indexes are ready.", line: 4, state: { target: 9, key: "2 + 7", num: 7, need: 2, bucket: 2, pair: "[0, 1]", hashRule: "2 % 5 = 2" } },
    { idx: 1, visual: withTwo, active: ["bucket-2", "entry-2-0"], title: "Return [0, 1]", desc: "Return [0, 1] because nums[0] + nums[1] is 2 + 7, which equals target 9.", line: 4, state: { target: 9, key: "2 + 7", num: 7, need: 2, bucket: 2, result: "[0, 1]", hashRule: "2 % 5 = 2" } },
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
    state: { example: "nums=[2, 7], target=9", ...phase.state },
  }, index + 1));
}

export function generateHashLookupSteps(context: GeneratorContext = {}): Step[] {
  const text = visualizerFamilyText(context);
  const isCreditTotal = /course credit total|selected/.test(text);
  const isRecentUnique = /most recent unique/.test(text);
  const code = isRecentUnique
    ? ["counts = {}", "for each event: counts[event] += 1", "scan events from the end", "return first event with count 1"]
    : isCreditTotal
      ? ["credits_by_course = {}", "store each course with its credits", "for each selected course", "add credits_by_course[course]", "return total"]
      : ["prices_by_item = {}", "store each item with its price", "look up the target key", "return the stored value"];
  const buckets = isRecentUnique
    ? [
        {} as Record<number, string[]>,
        { 2: ["login:2"], 3: ["sync:1"], 4: ["chat:1"] },
      ]
    : isCreditTotal
      ? [
          {} as Record<number, string[]>,
          { 1: ["COSC101:3"] },
          { 1: ["COSC101:3"], 3: ["MATH113:4"] },
        ]
      : [
          {} as Record<number, string[]>,
          { 2: ["milk:4"] },
          { 2: ["milk:4"], 3: ["bread:3"] },
        ];
  const phases = isRecentUnique
    ? [
        { title: context.title || "Most Recent Unique", desc: "The target is the newest event whose count is exactly one.", bucket: buckets[0], active: ["bucket-2"], line: 1, state: { target: "most recent unique", counts: "empty" } },
        { title: "Count login", desc: "login appears more than once, so its saved count grows instead of becoming an answer.", bucket: { 2: ["login:2"] }, active: ["entry-2-0"], line: 2, state: { target: "most recent unique", key: "login", counts: "login:2" } },
        { title: "Count sync", desc: "sync gets its own key and a count of one.", bucket: { 2: ["login:2"], 3: ["sync:1"] }, active: ["entry-3-0"], line: 2, state: { target: "most recent unique", key: "sync", counts: "login:2, sync:1" } },
        { title: "Count chat", desc: "chat is also stored with count one before the backward scan starts.", bucket: buckets[1], active: ["entry-4-0"], line: 2, state: { target: "most recent unique", key: "chat", counts: "login:2, sync:1, chat:1" } },
        { title: "Start from the newest event", desc: "Look at chat first because the prompt asks for the most recent unique event.", bucket: buckets[1], active: ["bucket-4"], line: 3, state: { target: "most recent unique", lookup: "chat" } },
        { title: "Read chat count", desc: "The hash map jumps to chat's bucket and reads the saved count.", bucket: buckets[1], active: ["entry-4-0"], line: 3, state: { target: "most recent unique", lookup: "chat", count: 1 } },
        { title: "Return chat", desc: "chat has count 1, so it is the first answer found when scanning backward.", bucket: buckets[1], active: ["entry-4-0"], line: 4, state: { target: "most recent unique", result: "chat" } },
      ]
    : isCreditTotal
      ? [
          { title: context.title || "Course Credit Total", desc: "The target is the selected course whose credit value must be added.", bucket: buckets[0], active: ["bucket-1"], line: 1, state: { target: "COSC101", total: 0 } },
          { title: "Store COSC101 credits", desc: "COSC101 maps to 3 credits, so later selected courses can look it up directly.", bucket: buckets[1], active: ["entry-1-0"], line: 2, state: { target: "COSC101", stored: "COSC101 -> 3" } },
          { title: "Store MATH113 credits", desc: "MATH113 gets its own key and value in the same map.", bucket: buckets[2], active: ["entry-3-0"], line: 2, state: { target: "COSC101", stored: "MATH113 -> 4" } },
          { title: "Choose selected COSC101", desc: "Now the selected course becomes the lookup key.", bucket: buckets[2], active: ["bucket-1"], line: 3, state: { target: "COSC101", selected: "COSC101" } },
          { title: "Read COSC101 credits", desc: "The map jumps to COSC101's bucket and reads the stored credit value.", bucket: buckets[2], active: ["entry-1-0"], line: 3, state: { target: "COSC101", lookup: "COSC101", credits: 3 } },
          { title: "Add to total", desc: "Add 3 credits to the running total.", bucket: buckets[2], active: ["entry-1-0"], line: 4, state: { target: "COSC101", total: 3 } },
          { title: "Return 3", desc: "The selected courses total 3 credits.", bucket: buckets[2], active: ["entry-1-0"], line: 5, state: { target: "COSC101", result: 3 } },
        ]
      : [
          { title: context.title || "Grocery Price Lookup", desc: "Use item names as keys and prices as values.", bucket: buckets[0], active: ["bucket-2"], line: 1, state: { target: "bread" } },
          { title: "Store milk", desc: "milk maps to price 4.", bucket: buckets[1], active: ["entry-2-0"], line: 2, state: { target: "bread", stored: "milk -> 4" } },
          { title: "Store bread", desc: "bread maps to price 3.", bucket: buckets[2], active: ["entry-3-0"], line: 2, state: { target: "bread", stored: "bread -> 3" } },
          { title: "Choose target bread", desc: "The lookup key is bread, so the table does not need to scan every item.", bucket: buckets[2], active: ["bucket-3"], line: 3, state: { target: "bread", lookup: "bread" } },
          { title: "Jump to bread's bucket", desc: "Hashing bread chooses bucket 3, where bread's entry is stored.", bucket: buckets[2], active: ["bucket-3"], line: 3, state: { target: "bread", lookup: "bread", bucket: 3 } },
          { title: "Read bread price", desc: "The key in the bucket matches bread, so read the value beside it.", bucket: buckets[2], active: ["entry-3-0"], line: 3, state: { target: "bread", lookup: "bread", price: 3 } },
          { title: "Return 3", desc: "Return the value stored under the target key.", bucket: buckets[2], active: ["entry-3-0"], line: 4, state: { target: "bread", result: 3 } },
        ];
  return phases.map((phase, index) => {
    const visual = layoutHashBuckets(5, phase.bucket);
    return step({
      concept: "hash-map",
      title: phase.title,
      description: phase.desc,
      nodes: withNodeState(visual.nodes, phase.active, "active"),
      edges: visual.edges,
      highlights: { nodeIds: phase.active, lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: {
        example: isRecentUnique
          ? "events=[login, sync, login, chat]"
          : isCreditTotal
            ? "courses=[COSC101, MATH113], selected=COSC101"
            : "items=[milk, bread], target=bread",
        ...phase.state,
      },
    }, index + 1);
  });
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
      state: { example: "items=[A, B, A]", target: "group matching keys", key: phase.key, groups: phase.result },
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
  const family = detectVisualizerFamily("graph", context);
  type GraphPhase = {
    title: string;
    description: string;
    visited: string[];
    active: string[];
    queued?: string[];
    skipped?: string[];
    activeEdges: string[];
    skippedEdges?: string[];
    line: number;
    state: Record<string, string | number | boolean>;
    edgeState?: Edge["state"];
  };
  type GraphConfig = {
    labels: string[];
    links: Array<[string, string]>;
    example: string;
    target: string;
    code: string[];
    phases: GraphPhase[];
  };
  const configs: Partial<Record<VisualizerFamily, GraphConfig>> = {
    "graph-neighbor-count": {
      labels: ["A", "B", "C", "D"],
      links: [["A", "B"], ["A", "C"], ["B", "D"]],
      example: "edges=[A-B, A-C, B-D], node=A",
      target: "count A's direct neighbors",
      code: ["read the graph edges", "choose the target node", "inspect each edge touching the target", "add one for each direct neighbor", "skip edges that do not touch the target", "save the neighbor count", "finish scanning edges", "return the count"],
      phases: [
        { title: context.title || "Neighbor Count", description: "Start with A and the three visible edges.", visited: [], active: ["A"], queued: [], activeEdges: [], line: 1, state: { current: "A", count: 0, action: "read graph" } },
        { title: "Choose node A", description: "Only edges touching A should count.", visited: [], active: ["A"], queued: ["B", "C"], activeEdges: [], line: 2, state: { current: "A", looking_for: "direct neighbors", count: 0 } },
        { title: "A connects to B", description: "The A-B edge touches A, so B is one neighbor.", visited: ["A"], active: ["B"], queued: ["C"], activeEdges: ["A-B"], line: 4, state: { edge: "A-B", neighbor: "B", count: 1 } },
        { title: "A connects to C", description: "The A-C edge also touches A.", visited: ["A", "B"], active: ["C"], queued: [], activeEdges: ["A-C"], line: 4, state: { edge: "A-C", neighbor: "C", count: 2 } },
        { title: "B-D does not touch A", description: "This edge is in the graph, but it is not a direct neighbor edge for A.", visited: ["A", "B", "C"], active: [], skipped: ["D"], queued: [], activeEdges: [], skippedEdges: ["B-D"], line: 5, state: { edge: "B-D", decision: "skip D", count: 2 } },
        { title: "Save count 2", description: "A has exactly B and C as direct neighbors. D is ruled out because only B connects to it.", visited: ["A", "B", "C"], active: ["A"], skipped: ["D"], queued: [], activeEdges: ["A-B", "A-C"], skippedEdges: ["B-D"], line: 6, state: { neighbors: "B, C", skipped: "D", result: 2 } },
        { title: "No more edges", description: "All edges have been checked once; only A's direct edges stayed bright.", visited: ["A", "B", "C"], active: ["A"], skipped: ["D"], queued: [], activeEdges: ["A-B", "A-C"], skippedEdges: ["B-D"], line: 7, state: { scanned: "all edges", skipped: "D", result: 2 } },
        { title: "Return 2", description: "Return the direct-neighbor count for A: B and C.", visited: ["A", "B", "C"], active: ["A"], skipped: ["D"], queued: [], activeEdges: ["A-B", "A-C"], skippedEdges: ["B-D"], line: 8, edgeState: "path", state: { neighbors: "B, C", skipped: "D", final_result: 2 } },
      ],
    },
    "graph-course-chain": {
      labels: ["COSC350", "COSC220", "COSC112"],
      links: [["COSC350", "COSC220"], ["COSC220", "COSC112"]],
      example: "COSC350 -> COSC220 -> COSC112",
      target: "is COSC112 required before COSC350?",
      code: ["start from the course", "put the course in the frontier", "visit the next prerequisite node", "if it is the target prerequisite, save true", "otherwise add that course's prerequisites", "repeat while nodes remain", "save false if target is never reached", "return the boolean result"],
      phases: [
        { title: context.title || "Course Prerequisite Chain", description: "Start from COSC350 and walk backward through prerequisites.", visited: [], active: ["COSC350"], queued: ["COSC350"], activeEdges: [], line: 1, state: { current: "COSC350", target_prereq: "COSC112", result: "not decided" } },
        { title: "Frontier has COSC350", description: "The search begins with the requested course.", visited: [], active: ["COSC350"], queued: ["COSC350"], activeEdges: [], line: 2, state: { frontier: "COSC350" } },
        { title: "Read COSC220", description: "COSC350 requires COSC220, so add it to the search.", visited: ["COSC350"], active: ["COSC220"], queued: ["COSC220"], activeEdges: ["COSC350-COSC220"], line: 5, state: { current: "COSC220", frontier: "COSC220" } },
        { title: "COSC220 is not target", description: "Keep searching because COSC220 is not COSC112.", visited: ["COSC350", "COSC220"], active: ["COSC220"], queued: [], activeEdges: [], line: 4, state: { current: "COSC220", decision: "keep going" } },
        { title: "Read COSC112", description: "COSC220 requires COSC112.", visited: ["COSC350", "COSC220"], active: ["COSC112"], queued: ["COSC112"], activeEdges: ["COSC220-COSC112"], line: 5, state: { current: "COSC112", frontier: "COSC112" } },
        { title: "Target reached", description: "The target prerequisite is found in the chain.", visited: ["COSC350", "COSC220", "COSC112"], active: ["COSC112"], activeEdges: ["COSC220-COSC112"], line: 4, state: { decision: "found target", result: "true" } },
        { title: "Path proves it", description: "The highlighted path shows why the answer is true.", visited: ["COSC350", "COSC220", "COSC112"], active: ["COSC112"], activeEdges: ["COSC350-COSC220", "COSC220-COSC112"], line: 6, edgeState: "path", state: { path: "COSC350 -> COSC220 -> COSC112", result: "true" } },
        { title: "Return true", description: "Return the boolean result.", visited: ["COSC350", "COSC220", "COSC112"], active: ["COSC112"], activeEdges: ["COSC350-COSC220", "COSC220-COSC112"], line: 8, edgeState: "path", state: { final_result: "true" } },
      ],
    },
    "graph-campus-reachable": {
      labels: ["library", "union", "gym"],
      links: [["library", "union"], ["union", "gym"]],
      example: "library -> union -> gym",
      target: "can we reach gym?",
      code: ["start at the first stop", "put start in the frontier", "visit a stop", "if stop is target, save true", "add unvisited neighboring stops", "repeat until target or empty frontier", "save false if no route exists", "return the boolean result"],
      phases: [
        { title: context.title || "Campus Stop Reachable", description: "The route starts at library and wants gym.", visited: [], active: ["library"], queued: ["library"], activeEdges: [], line: 1, state: { current: "library", target_stop: "gym" } },
        { title: "Visit library", description: "library is not the target, so inspect neighbors.", visited: ["library"], active: ["library"], queued: [], activeEdges: [], line: 3, state: { current: "library", decision: "not target" } },
        { title: "Add union", description: "union is connected to library, so it joins the frontier.", visited: ["library"], active: ["union"], queued: ["union"], activeEdges: ["library-union"], line: 5, state: { frontier: "union" } },
        { title: "Visit union", description: "union is a middle stop, not the target.", visited: ["library", "union"], active: ["union"], queued: [], activeEdges: [], line: 3, state: { current: "union", decision: "not target" } },
        { title: "Add gym", description: "gym is connected to union.", visited: ["library", "union"], active: ["gym"], queued: ["gym"], activeEdges: ["union-gym"], line: 5, state: { frontier: "gym" } },
        { title: "Target found", description: "The next stop is gym, so the route exists.", visited: ["library", "union", "gym"], active: ["gym"], activeEdges: ["union-gym"], line: 4, state: { current: "gym", result: "true" } },
        { title: "Path is visible", description: "The highlighted route explains the true answer.", visited: ["library", "union", "gym"], active: ["gym"], activeEdges: ["library-union", "union-gym"], line: 6, edgeState: "path", state: { path: "library -> union -> gym", result: "true" } },
        { title: "Return true", description: "Return the boolean reachability result.", visited: ["library", "union", "gym"], active: ["gym"], activeEdges: ["library-union", "union-gym"], line: 8, edgeState: "path", state: { final_result: "true" } },
      ],
    },
    "graph-shortest-grid": {
      labels: ["S", "1", "2", "3", "T"],
      links: [["S", "1"], ["1", "2"], ["2", "3"], ["3", "T"]],
      example: "grid=S..|.#.|..T",
      target: "shortest move count from S to T",
      code: ["start BFS at S with distance 0", "take the next cell from the frontier", "if it is T, save its distance", "add open unvisited neighbors with distance + 1", "skip walls and visited cells", "repeat level by level", "trace the shortest path", "return the distance"],
      phases: [
        { title: context.title || "Shortest Path in Campus Grid", description: "BFS starts at S because it finds shortest paths level by level.", visited: [], active: ["S"], queued: ["S"], activeEdges: [], line: 1, state: { current: "S", distance: 0 } },
        { title: "Expand S", description: "Open neighbors one move away join the frontier.", visited: ["S"], active: ["1"], queued: ["1"], activeEdges: ["S-1"], line: 4, state: { frontier: "distance 1", distance: 1 } },
        { title: "Take distance 1", description: "BFS handles all closer cells before farther cells.", visited: ["S", "1"], active: ["1"], queued: [], activeEdges: [], line: 2, state: { current: "1", distance: 1 } },
        { title: "Add distance 2", description: "The next open cell is two moves from S.", visited: ["S", "1"], active: ["2"], queued: ["2"], activeEdges: ["1-2"], line: 4, state: { frontier: "distance 2" } },
        { title: "Add distance 3", description: "Continue through open cells and skip walls.", visited: ["S", "1", "2"], active: ["3"], queued: ["3"], activeEdges: ["2-3"], line: 5, state: { skipped: "wall", distance: 3 } },
        { title: "Reach target", description: "T is discovered from the distance-3 cell.", visited: ["S", "1", "2", "3"], active: ["T"], queued: ["T"], activeEdges: ["3-T"], line: 3, state: { current: "T", distance: 4, result: 4 } },
        { title: "Trace shortest path", description: "The path has four edges, so the shortest move count is 4.", visited: ["S", "1", "2", "3", "T"], active: ["T"], activeEdges: ["S-1", "1-2", "2-3", "3-T"], line: 7, edgeState: "path", state: { path: "S -> 1 -> 2 -> 3 -> T", result: 4 } },
        { title: "Return 4", description: "Return the saved distance when T is reached.", visited: ["S", "1", "2", "3", "T"], active: ["T"], activeEdges: ["S-1", "1-2", "2-3", "3-T"], line: 8, edgeState: "path", state: { final_result: 4 } },
      ],
    },
    "graph-topological-order": {
      labels: ["A", "B", "C"],
      links: [["A", "B"], ["B", "C"]],
      example: "A before B before C",
      target: "return a valid course order",
      code: ["build prerequisite arrows", "count how many prerequisites each course has", "start with courses that have zero prerequisites", "remove one ready course", "lower counts for its outgoing neighbors", "add newly ready courses", "repeat until all courses are ordered", "return the order"],
      phases: [
        { title: context.title || "Course Plan Topological Order", description: "Arrows point from prerequisite to course.", visited: [], active: ["A", "B", "C"], queued: [], activeEdges: ["A-B", "B-C"], line: 1, state: { order: "empty", ready: "none yet" } },
        { title: "Count prerequisites", description: "A has none, B waits for A, and C waits for B.", visited: [], active: ["A"], queued: ["A"], activeEdges: [], line: 2, state: { ready: "A", counts: "A:0 B:1 C:1" } },
        { title: "Place A", description: "A is ready, so put it first in the order.", visited: ["A"], active: ["A"], queued: [], activeEdges: [], line: 4, state: { order: "A", ready: "none" } },
        { title: "Unlock B", description: "Removing A lowers B's prerequisite count to 0.", visited: ["A"], active: ["B"], queued: ["B"], activeEdges: ["A-B"], line: 5, state: { ready: "B", counts: "B:0" } },
        { title: "Place B", description: "B is now safe to take after A.", visited: ["A", "B"], active: ["B"], queued: [], activeEdges: [], line: 4, state: { order: "A, B" } },
        { title: "Unlock C", description: "Removing B lowers C's prerequisite count to 0.", visited: ["A", "B"], active: ["C"], queued: ["C"], activeEdges: ["B-C"], line: 6, state: { ready: "C", counts: "C:0" } },
        { title: "Place C", description: "All prerequisites before C are already in the order.", visited: ["A", "B", "C"], active: ["C"], activeEdges: [], line: 7, state: { order: "A, B, C", result: "[A, B, C]" } },
        { title: "Return order", description: "Return a valid topological ordering.", visited: ["A", "B", "C"], active: ["C"], activeEdges: ["A-B", "B-C"], line: 8, edgeState: "path", state: { final_result: "[A, B, C]" } },
      ],
    },
    "graph-word-ladder": {
      labels: ["hit", "hot", "dot", "dog"],
      links: [["hit", "hot"], ["hot", "dot"], ["dot", "dog"]],
      example: "hit -> hot -> dot -> dog",
      target: "count shortest word steps",
      code: ["start BFS from the first word", "change one letter to find neighbors", "add unseen valid words to the frontier", "store each word's distance", "stop when the target word appears", "trace the word chain", "count words in the chain", "return the step count"],
      phases: [
        { title: context.title || "Word Ladder Steps", description: "Start at hit with distance 1.", visited: [], active: ["hit"], queued: ["hit"], activeEdges: [], line: 1, state: { current: "hit", distance: 1 } },
        { title: "Change one letter", description: "hot differs by one letter and is in the word list.", visited: ["hit"], active: ["hot"], queued: ["hot"], activeEdges: ["hit-hot"], line: 2, state: { neighbor: "hot", distance: 2 } },
        { title: "Visit hot", description: "BFS visits hot before deeper words.", visited: ["hit", "hot"], active: ["hot"], queued: [], activeEdges: [], line: 4, state: { current: "hot", distance: 2 } },
        { title: "Add dot", description: "dot is a valid one-letter change from hot.", visited: ["hit", "hot"], active: ["dot"], queued: ["dot"], activeEdges: ["hot-dot"], line: 3, state: { neighbor: "dot", distance: 3 } },
        { title: "Add dog", description: "dog is one letter away from dot.", visited: ["hit", "hot", "dot"], active: ["dog"], queued: ["dog"], activeEdges: ["dot-dog"], line: 3, state: { neighbor: "dog", distance: 4 } },
        { title: "Target appears", description: "The target word is reached, so stop the BFS.", visited: ["hit", "hot", "dot", "dog"], active: ["dog"], activeEdges: ["dot-dog"], line: 5, state: { current: "dog", result: 4 } },
        { title: "Trace ladder", description: "The highlighted chain shows the shortest transformation.", visited: ["hit", "hot", "dot", "dog"], active: ["dog"], activeEdges: ["hit-hot", "hot-dot", "dot-dog"], line: 6, edgeState: "path", state: { path: "hit -> hot -> dot -> dog", result: 4 } },
        { title: "Return 4", description: "Return the compact ladder length.", visited: ["hit", "hot", "dot", "dog"], active: ["dog"], activeEdges: ["hit-hot", "hot-dot", "dot-dog"], line: 8, edgeState: "path", state: { final_result: 4 } },
      ],
    },
    "graph-clone": {
      labels: ["1", "2", "3", "1'", "2'", "3'"],
      links: [["1", "2"], ["1", "3"], ["1'", "2'"], ["1'", "3'"]],
      example: "node 1 connected to 2 and 3",
      target: "copy graph shape",
      code: ["visit an original node", "create its clone if missing", "remember original to clone", "visit each original neighbor", "create missing neighbor clones", "connect clone to cloned neighbors", "repeat until originals are copied", "return the cloned start node"],
      phases: [
        { title: context.title || "Clone Graph", description: "Original nodes 1, 2, and 3 are on the left; clone nodes appear as they are created.", visited: [], active: ["1"], queued: [], activeEdges: ["1-2", "1-3"], line: 1, state: { current: "1", cloned: "none" } },
        { title: "Create clone 1'", description: "The first original gets a matching clone.", visited: ["1"], active: ["1'"], queued: [], activeEdges: [], line: 2, state: { map: "1 -> 1'", cloned: "1'" } },
        { title: "Remember the clone", description: "Store the original-to-clone mapping so repeats use the same copy.", visited: ["1"], active: ["1", "1'"], queued: [], activeEdges: [], line: 3, state: { map: "1 -> 1'" } },
        { title: "Visit neighbor 2", description: "Neighbor 2 needs its own clone before the edge can be copied.", visited: ["1"], active: ["2", "2'"], queued: ["3"], activeEdges: ["1-2"], line: 4, state: { current: "2", cloned: "2'" } },
        { title: "Connect 1' to 2'", description: "Copy the original 1-2 edge into the clone graph.", visited: ["1", "2"], active: ["1'", "2'"], queued: ["3"], activeEdges: ["1'-2'"], line: 6, state: { copied_edge: "1' -> 2'" } },
        { title: "Visit neighbor 3", description: "Create the clone for 3 and copy the second edge.", visited: ["1", "2"], active: ["3", "3'"], queued: [], activeEdges: ["1-3"], line: 5, state: { current: "3", cloned: "3'" } },
        { title: "Connect 1' to 3'", description: "The clone now has the same two neighbors as the original.", visited: ["1", "2", "3"], active: ["1'", "3'"], activeEdges: ["1'-2'", "1'-3'"], line: 7, state: { cloned_shape: "1' connected to 2' and 3'", result: "clone ready" } },
        { title: "Return clone 1'", description: "Return the cloned starting node.", visited: ["1", "2", "3", "1'", "2'", "3'"], active: ["1'"], activeEdges: ["1'-2'", "1'-3'"], line: 8, edgeState: "path", state: { final_result: "new graph with same shape" } },
      ],
    },
    "graph-alien-order": {
      labels: ["b", "a", "c"],
      links: [["b", "a"], ["a", "c"]],
      example: "words=[ba, bc, ac]",
      target: "infer letter order",
      code: ["compare neighboring words", "find the first different letter", "draw an ordering edge", "count incoming edges for each letter", "start with letters that have no incoming edges", "remove ready letters and unlock neighbors", "append letters to the order", "return the inferred order"],
      phases: [
        { title: context.title || "Alien Dictionary Order", description: "Compare words to discover letter rules.", visited: [], active: ["b", "a", "c"], queued: [], activeEdges: [], line: 1, state: { words: "ba, bc, ac", order: "empty" } },
        { title: "ba before bc", description: "The first different letters are a and c, so a comes before c.", visited: [], active: ["a", "c"], queued: [], activeEdges: ["a-c"], line: 3, state: { rule: "a before c" } },
        { title: "bc before ac", description: "The first different letters are b and a, so b comes before a.", visited: [], active: ["b", "a"], queued: [], activeEdges: ["b-a"], line: 3, state: { rule: "b before a" } },
        { title: "Count incoming edges", description: "b has no incoming edges, so it is ready first.", visited: [], active: ["b"], queued: ["b"], activeEdges: [], line: 4, state: { ready: "b", incoming: "b:0 a:1 c:1" } },
        { title: "Append b", description: "Removing b unlocks a.", visited: ["b"], active: ["a"], queued: ["a"], activeEdges: ["b-a"], line: 6, state: { order: "b", ready: "a" } },
        { title: "Append a", description: "Removing a unlocks c.", visited: ["b", "a"], active: ["c"], queued: ["c"], activeEdges: ["a-c"], line: 6, state: { order: "b, a", ready: "c" } },
        { title: "Append c", description: "All letters are now ordered.", visited: ["b", "a", "c"], active: ["c"], activeEdges: [], line: 7, state: { order: "b, a, c", result: "bac" } },
        { title: "Return bac", description: "Return the inferred letter order for the compact sample.", visited: ["b", "a", "c"], active: ["c"], activeEdges: ["b-a", "a-c"], line: 8, edgeState: "path", state: { final_result: "bac" } },
      ],
    },
  };
  const config = configs[family] || configs["graph-campus-reachable"]!;
  const graph = layoutCircularGraph(config.labels, config.links);
  const phases = config.phases;
  return phases.map((phase, index) => {
    const visited = new Set(phase.visited);
    const active = new Set(phase.active);
    const queued = new Set(phase.queued || []);
    const skipped = new Set(phase.skipped || []);
    const skippedEdges = new Set(phase.skippedEdges || []);
    const baseEdges = graph.edges.map((edge) => (skippedEdges.has(edge.id || `${edge.from}-${edge.to}`) ? { ...edge, state: "skipped" as const } : edge));
    return step({
      concept: "graph",
      title: phase.title,
      description: phase.description,
      nodes: graph.nodes.map((node) => ({
        ...node,
        state: active.has(node.id) ? "active" : visited.has(node.id) ? "visited" : queued.has(node.id) ? "queued" : skipped.has(node.id) ? "skipped" : "default",
      })),
      edges: withEdgeState(baseEdges, phase.activeEdges, phase.edgeState || (index === phases.length - 1 ? "path" : "active")),
      highlights: { nodeIds: [...phase.active, ...phase.visited], edgeIds: phase.activeEdges, lineNumbers: [phase.line] },
      code: config.code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: {
        example: config.example,
        target: config.target,
        frontier: (phase.queued || []).join(", ") || "empty",
        visited: phase.visited.join(", ") || "none",
        ...phase.state,
      },
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

export function generateBalancedBracketSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "read brackets from left to right",
    "opening brackets wait on the stack",
    "a closing bracket must match the current top",
    "when it matches, remove that opening bracket",
    "a mismatch would return false",
    "after the scan, an empty stack means true",
    "return the boolean result",
    "stop",
  ];
  const phases = [
    { title: context.title || "Balanced Brackets", symbol: "{", stack: ["{"], active: 0, line: 2, desc: "The first symbol opens a group, so it waits on the stack.", state: { action: "push {", top: "{", result: "not decided" } },
    { title: "Push [", symbol: "[", stack: ["{", "["], active: 1, line: 2, desc: "[ opens inside {, so it is placed on top.", state: { action: "push [", top: "[", result: "not decided" } },
    { title: "Push (", symbol: "(", stack: ["{", "[", "("], active: 2, line: 2, desc: "( opens inside [, so it becomes the newest item.", state: { action: "push (", top: "(", result: "not decided" } },
    { title: "Match ) with (", symbol: ")", stack: ["{", "["], active: 1, line: 3, desc: ") must match the top opening bracket. The top is (, so that pair closes.", state: { action: "match ) with (", top: "[", removed_pair: "()", result: "not decided" } },
    { title: "Match ] with [", symbol: "]", stack: ["{"], active: 0, line: 3, desc: "] now checks the next top. It matches [, so that pair closes.", state: { action: "match ] with [", top: "{", removed_pair: "[]", result: "not decided" } },
    { title: "Match } with {", symbol: "}", stack: [] as string[], active: -1, line: 3, desc: "} checks the final opening bracket. It matches {, leaving the stack empty.", state: { action: "match } with {", top: "empty", removed_pair: "{}", result: "not decided" } },
    { title: "Stack is empty", symbol: "end", stack: [] as string[], active: -1, line: 6, desc: "Every opening bracket found its matching closing bracket.", state: { action: "scan complete", top: "empty", stack_state: "empty", result: "true" } },
    { title: "Return true", symbol: "return", stack: [] as string[], active: -1, line: 7, desc: "Return true because no mismatch happened and no opening bracket is left waiting.", state: { action: "return boolean", result: "true" } },
  ];
  return phases.map((phase, index) => {
    const nodes = phase.stack.length
      ? phase.stack.map((value, stackIndex) => ({
          id: `stack-${stackIndex}`,
          x: 455,
          y: 405 - stackIndex * 76,
          value,
          label: stackIndex === phase.stack.length - 1 ? "top" : "",
          type: "array-cell" as const,
          state: stackIndex === phase.active ? "active" as const : "default" as const,
          meta: { role: "stack-item" },
        }))
      : [{ id: "empty-stack", x: 455, y: 405, value: "empty", label: "stack", type: "logic-node" as const, state: "inactive" as const, meta: { role: "stack-item" } }];
    return step({
      concept: "stack",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: [phase.stack.length ? `stack-${Math.max(0, phase.active)}` : "empty-stack"], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: { example: "{[()]}", target: "return true if balanced", symbol: phase.symbol, ...phase.state },
    }, index + 1);
  });
}

export function generateMinStackSteps(context: GeneratorContext = {}): Step[] {
  const code = [
    "start with an empty value stack",
    "keep a matching stack of minimums",
    "push 3 onto both stacks",
    "push 1 and update the minimum",
    "min reads the current minimum",
    "pop removes the top from both stacks",
    "top reads the current top value",
    "return the recorded outputs",
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
    { title: context.title || "Min Stack Operations", desc: "Trace the exact sample commands: push 3, push 1, min, pop, top.", values: [] as number[], mins: [] as number[], valueActive: -1, minActive: -1, line: 1, result: "not returned yet", state: { example: "push 3, push 1, min, pop, top", target: "outputs for min and top", values: "empty", mins: "empty", outputs: "empty" } },
    { title: "Push 3", desc: "3 enters the value stack. Because it is the only value, it is also the current minimum.", values: [3], mins: [3], valueActive: 0, minActive: 0, line: 3, result: "not returned yet", state: { example: "push 3, push 1, min, pop, top", target: "outputs for min and top", command: "push 3", top: 3, min: 3, outputs: "empty" } },
    { title: "Push 1", desc: "1 is smaller than 3, so the minimum stack records 1 as the new minimum.", values: [3, 1], mins: [3, 1], valueActive: 1, minActive: 1, line: 4, result: "not returned yet", state: { example: "push 3, push 1, min, pop, top", target: "outputs for min and top", command: "push 1", top: 1, min: 1, outputs: "empty" } },
    { title: "Read min", desc: "The min command reads the top of the minimum stack and records 1.", values: [3, 1], mins: [3, 1], valueActive: -1, minActive: 1, line: 5, result: "[1]", state: { example: "push 3, push 1, min, pop, top", target: "outputs for min and top", command: "min", min: 1, outputs: "[1]" } },
    { title: "Pop 1", desc: "pop removes the top value and the aligned minimum entry, so both stacks shrink together.", values: [3], mins: [3], valueActive: 0, minActive: 0, line: 6, result: "[1]", state: { example: "push 3, push 1, min, pop, top", target: "outputs for min and top", command: "pop", popped: 1, top: 3, min: 3, outputs: "[1]" } },
    { title: "Read top", desc: "After popping 1, the top command reads 3 and records it as the second output.", values: [3], mins: [3], valueActive: 0, minActive: -1, line: 7, result: "[1, 3]", state: { example: "push 3, push 1, min, pop, top", target: "outputs for min and top", command: "top", top: 3, outputs: "[1, 3]" } },
    { title: "Outputs are ready", desc: "Only min and top commands produce outputs, so the saved output list is [1, 3].", values: [3], mins: [3], valueActive: -1, minActive: -1, line: 8, result: "[1, 3]", state: { example: "push 3, push 1, min, pop, top", target: "outputs for min and top", outputs: "[1, 3]" } },
    { title: "Return [1, 3]", desc: "Return the recorded outputs in command order: min gave 1, then top gave 3.", values: [3], mins: [3], valueActive: -1, minActive: -1, line: 8, result: "[1, 3]", state: { example: "push 3, push 1, min, pop, top", target: "outputs for min and top", result: "[1, 3]" } },
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

export function generateCommandStackSteps(context: GeneratorContext = {}): Step[] {
  const text = visualizerFamilyText(context);
  const isUndo = /undo/.test(text);
  const isHeight = /height|max plate/.test(text);
  const code = isUndo
    ? ["start with an empty stack", "push each normal action", "when action is undo, remove the latest action", "return remaining actions"]
    : isHeight
      ? ["start with an empty plate stack", "push adds one plate to the top", "after each push, update current height", "pop removes the top plate if present", "keep the largest height seen", "return the largest height"]
      : ["start with an empty stack", "read each command", "push adds one item to the top", "pop removes the top item if present", "return the requested stack state"];
  const phases = isUndo
    ? [
        { title: context.title || "Undo Latest Action", desc: "Start with an empty action stack.", stack: [] as string[], line: 1, state: { example: "open, type, undo", target: "actions left after undo", top: "empty", height: 0 } },
        { title: "Push open", desc: "open is a normal action, so it goes on the stack.", stack: ["open"], active: 0, line: 2, state: { example: "open, type, undo", target: "actions left after undo", action: "push open", top: "open", height: 1 } },
        { title: "Push type", desc: "type is now the latest action at the top.", stack: ["open", "type"], active: 1, line: 2, state: { example: "open, type, undo", target: "actions left after undo", action: "push type", top: "type", height: 2 } },
        { title: "Undo removes type", desc: "undo pops the newest action only, leaving open in place.", stack: ["open"], active: 0, line: 3, state: { example: "open, type, undo", target: "actions left after undo", action: "undo", popped: "type", top: "open", height: 1 } },
        { title: "Return remaining actions", desc: "The stack now contains the actions that were not undone.", stack: ["open"], active: 0, line: 4, state: { example: "open, type, undo", target: "actions left after undo", result: "[open]" } },
      ]
    : isHeight
      ? [
          { title: context.title || "Max Plate Stack Height", desc: "Start with no plates. The current height and best height are both 0.", stack: [] as string[], line: 1, state: { example: "push, push, pop, push", target: "largest height reached", command: "start", height: 0, max_height: 0 } },
          { title: "Push tray", desc: "A push adds one item to the top, so the current height becomes 1.", stack: ["tray"], active: 0, line: 2, state: { example: "push, push, pop, push", target: "largest height reached", command: "push tray", top: "tray", height: 1, max_height: 1 } },
          { title: "Push cup", desc: "The second push places cup above tray. Height 2 is the largest height seen so far.", stack: ["tray", "cup"], active: 1, line: 3, state: { example: "push, push, pop, push", target: "largest height reached", command: "push cup", top: "cup", height: 2, max_height: 2 } },
          { title: "Pop cup", desc: "A pop removes only the top item. The current height drops, but the best height stays 2.", stack: ["tray"], active: 0, line: 4, state: { example: "push, push, pop, push", target: "largest height reached", command: "pop", popped: "cup", top: "tray", height: 1, max_height: 2 } },
          { title: "Push bowl", desc: "Another push raises the current height back to 2. The maximum is still 2.", stack: ["tray", "bowl"], active: 1, line: 3, state: { example: "push, push, pop, push", target: "largest height reached", command: "push bowl", top: "bowl", height: 2, max_height: 2 } },
          { title: "Return max height", desc: "Return the largest height reached at any point, not the item on top.", stack: ["tray", "bowl"], active: 1, line: 6, state: { example: "push, push, pop, push", target: "largest height reached", height: 2, max_height: 2, result: 2 } },
        ]
      : [
          { title: context.title || "Stack Top After Plates", desc: "Start with an empty stack of items.", stack: [] as string[], line: 1, state: { example: "push tray, push cup, pop", target: "final top item", top: "empty", height: 0 } },
          { title: "Push tray", desc: "tray goes on the bottom because the stack was empty.", stack: ["tray"], active: 0, line: 3, state: { example: "push tray, push cup, pop", target: "final top item", command: "push tray", top: "tray", height: 1 } },
          { title: "Push cup", desc: "cup is placed above tray and becomes the top.", stack: ["tray", "cup"], active: 1, line: 3, state: { example: "push tray, push cup, pop", target: "final top item", command: "push cup", top: "cup", height: 2 } },
          { title: "Pop cup", desc: "pop removes only the top item, so tray is uncovered.", stack: ["tray"], active: 0, line: 4, state: { example: "push tray, push cup, pop", target: "final top item", command: "pop", popped: "cup", top: "tray", height: 1 } },
          { title: "Return tray", desc: "The remaining top item is tray.", stack: ["tray"], active: 0, line: 5, state: { example: "push tray, push cup, pop", target: "final top item", result: "tray" } },
        ];
  return phases.map((phase, index) => {
    const nodes: Node[] = phase.stack.length
      ? phase.stack.map((value, stackIndex) => ({
          id: `stack-${stackIndex}`,
          x: 455,
          y: 405 - stackIndex * 78,
          value,
          label: stackIndex === phase.stack.length - 1 ? "top" : "below top",
          type: "array-cell",
          state: stackIndex === phase.active ? "active" as const : "default" as const,
          meta: { role: "stack-item" },
        }))
      : [{ id: "empty-stack", x: 455, y: 405, value: "empty", label: "stack", type: "logic-node", state: "inactive", meta: { role: "memory" } }];
    nodes.push({ id: "top-card", x: 650, y: 250, value: String(phase.state.top || phase.state.result || "empty"), label: "visible top", type: "logic-node", state: "matched", meta: { role: "result" } });
    return step({
      concept: "stack",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: phase.stack.length ? [{ id: "top-pointer", from: `stack-${phase.stack.length - 1}`, to: "top-card", type: "pointer", state: "active" }] : [],
      highlights: { nodeIds: [phase.stack.length ? `stack-${phase.active ?? phase.stack.length - 1}` : "empty-stack", "top-card"], edgeIds: phase.stack.length ? ["top-pointer"] : [], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateAdjacentPairStackSteps(context: GeneratorContext = {}): Step[] {
  const code = ["stack = []", "for each character", "if top equals character, pop top", "otherwise push character", "return stack joined as text"];
  const phases = [
    { title: context.title || "Remove Adjacent Equal Pairs", char: "a", stack: ["a"], desc: "a starts the stack because there is no top to compare yet.", line: 4, state: { text: "abbaca", stack: "a" } },
    { title: "Push b", char: "b", stack: ["a", "b"], desc: "b does not match top a, so push b.", line: 4, state: { top: "b", stack: "ab" } },
    { title: "Pair b with top b", char: "b", stack: ["a"], desc: "The next b matches the top b, so pop the pair away.", line: 3, state: { removed_pair: "bb", stack: "a" } },
    { title: "Pair a with top a", char: "a", stack: [], desc: "The next a matches the remaining top a, so that pair is removed too.", line: 3, state: { removed_pair: "aa", stack: "empty" } },
    { title: "Push c then a", char: "a", stack: ["c", "a"], desc: "c and a do not form adjacent equal pairs, so both remain.", line: 4, state: { stack: "ca" } },
    { title: "Return ca", char: "", stack: ["c", "a"], desc: "Joining the remaining stack gives the final text ca.", line: 5, state: { result: "ca" } },
  ];
  return phases.map((phase, index) => {
    const nodes = phase.stack.length
      ? phase.stack.map((value, stackIndex) => ({ id: `stack-${stackIndex}`, x: 430, y: 405 - stackIndex * 78, value, label: stackIndex === phase.stack.length - 1 ? "top" : "", type: "array-cell" as const, state: stackIndex === phase.stack.length - 1 ? "active" as const : "default" as const }))
      : [{ id: "empty-stack", x: 430, y: 405, value: "empty", label: "stack", type: "logic-node" as const, state: "inactive" as const }];
    nodes.push({ id: "result", x: 650, y: 310, value: String(phase.state.result || phase.state.stack), label: "current output", type: "logic-node", state: "matched" });
    return step({
      concept: "stack",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: [phase.stack.length ? `stack-${phase.stack.length - 1}` : "empty-stack", "result"], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateMonotonicStackSteps(context: GeneratorContext = {}): Step[] {
  const code = ["answers = [0, 0, 0, 0]", "stack keeps indexes waiting for warmer day", "while current temp is warmer than stack top", "pop index and save wait", "push current index", "return answers"];
  const temps = [70, 72, 71, 75];
  const answerRows = ["[0,0,0,0]", "[1,0,0,0]", "[1,0,0,0]", "[1,2,1,0]", "[1,2,1,0]"];
  const phases = [
    { title: context.title || "Daily Temperature Waits", idx: 0, stack: [0], answer: answerRows[0], desc: "Day 0 waits on the stack because no warmer future day is known yet.", line: 5, state: { stack: "day 0", waits: answerRows[0] } },
    { title: "72 warms day 0", idx: 1, stack: [], answer: answerRows[1], desc: "72 is warmer than 70, so day 0 waited 1 day.", line: 4, state: { updated_day: 0, wait: 1 } },
    { title: "Day 1 waits", idx: 1, stack: [1], answer: answerRows[1], desc: "After resolving day 0, day 1 waits for something warmer than 72.", line: 5, state: { stack: "day 1", waits: answerRows[1] } },
    { title: "Day 2 waits behind day 1", idx: 2, stack: [1, 2], answer: answerRows[2], desc: "71 is not warmer than 72, so day 2 waits on top of day 1.", line: 5, state: { stack: "day 1, day 2" } },
    { title: "75 resolves day 2 and day 1", idx: 3, stack: [], answer: answerRows[3], desc: "75 is warmer than both waiting days, so fill waits for day 2 and day 1.", line: 4, state: { waits: answerRows[3] } },
    { title: "Return waits", idx: 3, stack: [3], answer: answerRows[4], desc: "Day 3 has no warmer future day, so its wait stays 0.", line: 6, state: { result: "[1,2,1,0]" } },
  ];
  return phases.map((phase, index) => {
    const tempNodes = layoutArray(temps, { y: 135, gap: 96 }).map((node, itemIndex) => ({ ...node, state: itemIndex === phase.idx ? "active" as const : itemIndex < phase.idx ? "visited" as const : "default" as const }));
    const stackNodes = phase.stack.length
      ? phase.stack.map((day, stackIndex) => ({ id: `wait-${day}`, x: 350 + stackIndex * 120, y: 330, value: `day ${day}`, label: `temp ${temps[day]}`, type: "logic-node" as const, state: "queued" as const }))
      : [{ id: "wait-empty", x: 410, y: 330, value: "empty", label: "waiting stack", type: "logic-node" as const, state: "inactive" as const }];
    const nodes: Node[] = [...tempNodes, ...stackNodes, { id: "answers", x: 565, y: 470, value: phase.answer, label: "wait answers", type: "logic-node", state: "matched" }];
    return step({
      concept: "stack",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: [`item-${phase.idx}`, "answers"], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
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
    step({ concept: "queue", title: context.title || "Queue", description: "The front leaves first. New arrivals join the back.", nodes: withNodeState(first, ["item-0"], "active"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [1] }, code, activeLine: 1, state: { example: `${firstItem}, ${secondItem}; ${thirdItem} joins`, target: "serve oldest first", front: firstItem, back: secondItem } }, 1),
    step({ concept: "queue", title: "Join at the back", description: `${thirdItem} joins behind everyone already waiting.`, nodes: withNodeState(joined, ["item-2"], "active"), edges: [], highlights: { nodeIds: ["item-2"], lineNumbers: [2] }, code, activeLine: 2, state: { example: `${firstItem}, ${secondItem}; ${thirdItem} joins`, target: "serve oldest first", action: "enqueue", front: firstItem, back: thirdItem } }, 2),
    step({ concept: "queue", title: "Front does not move yet", description: `Adding ${thirdItem} does not affect ${firstItem}. The oldest item still owns the front.`, nodes: withNodeState(joined, ["item-0"], "visited"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [3] }, code, activeLine: 3, state: { example: `${firstItem}, ${secondItem}; ${thirdItem} joins`, target: "serve oldest first", front: firstItem, back: thirdItem } }, 3),
    step({ concept: "queue", title: "Serve the front", description: `${firstItem} leaves first because ${firstItem} has waited the longest.`, nodes: withNodeState(joined, ["item-0"], "active"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [4] }, code, activeLine: 4, state: { example: `${firstItem}, ${secondItem}; ${thirdItem} joins`, target: "serve oldest first", action: "dequeue", served: firstItem } }, 4),
    step({ concept: "queue", title: "Next front appears", description: `After ${firstItem} leaves, ${secondItem} becomes the front without changing the order of the remaining line.`, nodes: withNodeState(served, ["item-0"], "active"), edges: [], highlights: { nodeIds: ["item-0"], lineNumbers: [5] }, code, activeLine: 5, state: { example: `${firstItem}, ${secondItem}; ${thirdItem} joins`, target: "serve oldest first", front: secondItem, back: thirdItem } }, 5),
    step({ concept: "queue", title: "Finish in waiting order", description: "The queue rule is first-in, first-out: the order of service follows the order of arrival.", nodes: withNodeState(served, ["item-0", "item-1"], "visited"), edges: [], highlights: { nodeIds: ["item-0", "item-1"], lineNumbers: [6] }, code, activeLine: 6, state: { example: `${firstItem}, ${secondItem}; ${thirdItem} joins`, target: "serve oldest first", rule: "FIFO", result: `${secondItem}, ${thirdItem} remain` } }, 6),
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
        example: "join Ana, join Bo, serve, serve, serve",
        target: "served order",
        command: commands[phase.commandIndex],
        waiting: phase.queue.length ? phase.queue.join(", ") : "empty",
        served: phase.served.length ? phase.served.join(", ") : "none yet",
        action: phase.action,
      },
    }, index + 1);
  });
}

export function generateServeCountQueueSteps(context: GeneratorContext = {}): Step[] {
  const isFrontOnly = /front/i.test(context.title || "");
  const code = isFrontOnly
    ? ["count how many students are served", "move the front forward after each serve", "if someone remains, that person is the front", "otherwise return none"]
    : ["start with an empty served list", "repeat until the serve count is used", "move the front name into served", "return the served names"];
  const names = ["Ana", "Bo", "Cy"];
  const phases = isFrontOnly
    ? [
        { title: context.title || "Queue Front After Serves", queue: names, served: [] as string[], active: 0, desc: "The line starts in arrival order: Ana, Bo, Cy.", line: 1, state: { example: "Ana, Bo, Cy; serve 2", target: "front after serving", front: "Ana", serveCount: 2 } },
        { title: "Serve Ana", queue: ["Bo", "Cy"], served: ["Ana"], active: 0, desc: "One serve removes the front, so Bo moves forward.", line: 1, state: { example: "Ana, Bo, Cy; serve 2", target: "front after serving", served_count: 1, front: "Bo" } },
        { title: "Serve Bo", queue: ["Cy"], served: ["Ana", "Bo"], active: 0, desc: "The second serve removes Bo.", line: 1, state: { example: "Ana, Bo, Cy; serve 2", target: "front after serving", served_count: 2, front: "Cy" } },
        { title: "Return Cy", queue: ["Cy"], served: ["Ana", "Bo"], active: 0, desc: "After two serves, Cy is at the front.", line: 3, state: { example: "Ana, Bo, Cy; serve 2", target: "front after serving", result: "Cy" } },
      ]
    : [
        { title: context.title || "Serve First Students", queue: names, served: [] as string[], active: 0, desc: "The queue starts with Ana at the front.", line: 1, state: { example: "Ana, Bo, Cy; serve 2", target: "names served", serveCount: 2, served: "none yet" } },
        { title: "Serve Ana", queue: ["Bo", "Cy"], served: ["Ana"], active: 0, desc: "Ana leaves first because she is at the front.", line: 3, state: { example: "Ana, Bo, Cy; serve 2", target: "names served", served: "[Ana]" } },
        { title: "Serve Bo", queue: ["Cy"], served: ["Ana", "Bo"], active: 0, desc: "Bo becomes front after Ana leaves, then Bo is served.", line: 3, state: { example: "Ana, Bo, Cy; serve 2", target: "names served", served: "[Ana, Bo]" } },
        { title: "Stop after two serves", queue: ["Cy"], served: ["Ana", "Bo"], active: 0, desc: "serveCount is 2, so Cy remains waiting.", line: 2, state: { example: "Ana, Bo, Cy; serve 2", target: "names served", remaining: "[Cy]" } },
        { title: "Return served students", queue: ["Cy"], served: ["Ana", "Bo"], active: 0, desc: "Return exactly the names that were served.", line: 4, state: { example: "Ana, Bo, Cy; serve 2", target: "names served", result: "[Ana, Bo]" } },
      ];
  return phases.map((phase, index) => {
    const queueNodes = phase.queue.map((name, itemIndex) => ({ id: `queue-${itemIndex}`, x: 300 + itemIndex * 150, y: 270, value: name, label: itemIndex === 0 ? "front" : "waiting", type: "array-cell" as const, state: itemIndex === phase.active ? "active" as const : "queued" as const }));
    const servedNodes = phase.served.map((name, itemIndex) => ({ id: `served-${itemIndex}`, x: 330 + itemIndex * 145, y: 450, value: name, label: "served", type: "logic-node" as const, state: "matched" as const }));
    const nodes: Node[] = [...queueNodes, ...servedNodes, { id: "result-card", x: 650, y: 450, value: String(phase.state.result || phase.state.served || phase.state.front || "waiting"), label: "tracked result", type: "logic-node", state: "matched" }];
    return step({
      concept: "queue",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: ["queue-0", "result-card"], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateLineCommandQueueSteps(context: GeneratorContext = {}): Step[] {
  const isFrontAfter = /front/i.test(context.title || "");
  const code = ["start with an empty queue", "read each command", "join adds to the back", "serve removes from the front", "return the requested queue state"];
  const example = isFrontAfter ? "join Ana, join Bo, serve" : "join Ana, join Bo, serve, join Cy";
  const target = isFrontAfter ? "front name" : "remaining line";
  const phases = [
    { title: context.title || "Dining Line After Commands", command: "join Ana", queue: ["Ana"], served: [] as string[], desc: "Ana joins an empty line and becomes the front.", line: 3, state: { example, target, command: "join Ana", front: "Ana", back: "Ana" } },
    { title: "Bo joins the back", command: "join Bo", queue: ["Ana", "Bo"], served: [] as string[], desc: "Bo joins behind Ana. The front stays Ana.", line: 3, state: { example, target, command: "join Bo", front: "Ana", back: "Bo" } },
    { title: "Serve Ana", command: "serve", queue: ["Bo"], served: ["Ana"], desc: "serve removes the oldest waiting student: Ana.", line: 4, state: { example, target, command: "serve", served: "Ana", front: "Bo" } },
    ...(isFrontAfter
      ? [{ title: "Return Bo", command: "return", queue: ["Bo"], served: ["Ana"], desc: "Bo is now the front of the line.", line: 5, state: { example, target, result: "Bo" } }]
      : [
          { title: "Cy joins behind Bo", command: "join Cy", queue: ["Bo", "Cy"], served: ["Ana"], desc: "Cy joins the back after Bo.", line: 3, state: { example, target, command: "join Cy", front: "Bo", back: "Cy" } },
          { title: "Return remaining line", command: "return", queue: ["Bo", "Cy"], served: ["Ana"], desc: "The remaining queue is Bo followed by Cy.", line: 5, state: { example, target, result: "[Bo, Cy]" } },
        ]),
  ];
  return phases.map((phase, index) => {
    const nodes: Node[] = [
      { id: "command", x: 190, y: 140, value: phase.command, label: "current command", type: "logic-node", state: "active" },
      ...phase.queue.map((name, itemIndex) => ({ id: `queue-${itemIndex}`, x: 330 + itemIndex * 160, y: 300, value: name, label: itemIndex === 0 ? "front" : "back", type: "array-cell" as const, state: "queued" as const })),
      { id: "served", x: 420, y: 465, value: phase.served.length ? phase.served.join(", ") : "none yet", label: "served", type: "logic-node", state: phase.served.length ? "matched" : "default" },
    ];
    return step({
      concept: "queue",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: ["command", "queue-0"], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateQueueWindowSteps(context: GeneratorContext = {}): Step[] {
  const isRateLimiter = /rate limiter/i.test(context.title || "");
  const code = isRateLimiter
    ? ["queue keeps accepted times inside the window", "remove times older than current - window", "allow if queue size is below k", "append accepted time", "return decisions"]
    : ["queue keeps recent times", "remove times outside the window", "append current time", "save current queue size", "return counts"];
  const phases = isRateLimiter
    ? [
        { title: context.title || "Rate Limiter", time: 1, queue: [1], desc: "At time 1, the recent accepted queue is empty, so allow it.", line: 4, state: { example: "k=2, window=10, times=[1,2,11]", target: "allowed decisions", time: 1, decision: "true", queue: "[1]", result: "[true]" } },
        { title: "Allow time 2", time: 2, queue: [1, 2], desc: "Both 1 and 2 are within the window, and capacity k=2 allows the second request.", line: 4, state: { example: "k=2, window=10, times=[1,2,11]", target: "allowed decisions", time: 2, decision: "true", queue: "[1, 2]", result: "[true,true]" } },
        { title: "Drop expired time 1", time: 11, queue: [2], desc: "At time 11, time 1 is outside the 10-second window, so it leaves the queue.", line: 2, state: { example: "k=2, window=10, times=[1,2,11]", target: "allowed decisions", time: 11, removed: 1, queue: "[2]", result: "[true,true]" } },
        { title: "Allow time 11", time: 11, queue: [2, 11], desc: "After removing expired times, there is room to accept 11.", line: 4, state: { example: "k=2, window=10, times=[1,2,11]", target: "allowed decisions", time: 11, decision: "true", result: "[true,true,true]" } },
      ]
    : [
        { title: context.title || "Recent Queue Counts", time: 1, queue: [1], desc: "Only time 1 is recent, so the count is 1.", line: 3, state: { example: "times=[1,2,8,12], window=5", target: "count after each time", time: 1, count: 1, result: "[1]" } },
        { title: "Add time 2", time: 2, queue: [1, 2], desc: "Times 1 and 2 are both within the window.", line: 3, state: { example: "times=[1,2,8,12], window=5", target: "count after each time", time: 2, count: 2, result: "[1,2]" } },
        { title: "Drop old times before 8", time: 8, queue: [8], desc: "At time 8, earlier times are outside the 5-unit window.", line: 2, state: { example: "times=[1,2,8,12], window=5", target: "count after each time", time: 8, removed: "1 and 2", count: 1, result: "[1,2,1]" } },
        { title: "Add time 12", time: 12, queue: [8, 12], desc: "8 and 12 both fit in the current recent window.", line: 3, state: { example: "times=[1,2,8,12], window=5", target: "count after each time", time: 12, count: 2, result: "[1,2,1,2]" } },
        { title: "Return counts", time: 12, queue: [8, 12], desc: "The saved counts are [1, 2, 1, 2].", line: 4, state: { example: "times=[1,2,8,12], window=5", target: "count after each time", result: "[1,2,1,2]" } },
      ];
  return phases.map((phase, index) => {
    const nodes: Node[] = [
      { id: "time", x: 190, y: 150, value: phase.time, label: "current time", type: "logic-node", state: "active" },
      ...phase.queue.map((time, itemIndex) => ({ id: `queue-${itemIndex}`, x: 330 + itemIndex * 150, y: 315, value: time, label: itemIndex === 0 ? "oldest recent" : "newer", type: "array-cell" as const, state: "queued" as const })),
      { id: "result", x: 620, y: 470, value: String(phase.state.result || phase.state.count || phase.state.decision), label: "saved output", type: "logic-node", state: "matched" },
    ];
    return step({
      concept: "queue",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: ["time", "result"], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateTicketRoundQueueSteps(context: GeneratorContext = {}): Step[] {
  const code = ["start with people and ticket counts", "serve the front person once", "if tickets remain, rejoin the back", "if tickets reach zero, save finish order", "return finish order"];
  const phases = [
    { title: context.title || "Help Session Finish Order", queue: ["Ana:1", "Bo:2", "Cy:1"], done: [] as string[], desc: "Each student starts in line with their remaining ticket count.", line: 1, state: { example: "Ana:1, Bo:2, Cy:1", target: "finish order", waiting: "Ana:1, Bo:2, Cy:1", finished_order: "empty" } },
    { title: "Ana finishes", queue: ["Bo:2", "Cy:1"], done: ["Ana"], desc: "Ana uses her only ticket, so she leaves the queue and joins finish order.", line: 4, state: { example: "Ana:1, Bo:2, Cy:1", target: "finish order", action: "serve Ana", finished: "Ana", result: "[Ana]" } },
    { title: "Bo still needs one", queue: ["Cy:1", "Bo:1"], done: ["Ana"], desc: "Bo uses one ticket but still has one left, so he returns to the back.", line: 3, state: { example: "Ana:1, Bo:2, Cy:1", target: "finish order", action: "serve Bo", requeued: "Bo:1", result: "[Ana]" } },
    { title: "Cy finishes", queue: ["Bo:1"], done: ["Ana", "Cy"], desc: "Cy uses her only ticket and finishes before Bo.", line: 4, state: { example: "Ana:1, Bo:2, Cy:1", target: "finish order", action: "serve Cy", finished: "Cy", result: "[Ana, Cy]" } },
    { title: "Bo finishes", queue: [] as string[], done: ["Ana", "Cy", "Bo"], desc: "Bo uses his last ticket and finishes last.", line: 4, state: { example: "Ana:1, Bo:2, Cy:1", target: "finish order", action: "serve Bo", finished: "Bo", result: "[Ana, Cy, Bo]" } },
    { title: "Return finish order", queue: [] as string[], done: ["Ana", "Cy", "Bo"], desc: "The finish order is Ana, Cy, then Bo.", line: 5, state: { example: "Ana:1, Bo:2, Cy:1", target: "finish order", result: "[Ana, Cy, Bo]" } },
  ];
  return phases.map((phase, index) => {
    const queueNodes = phase.queue.length
      ? phase.queue.map((value, itemIndex) => ({ id: `queue-${itemIndex}`, x: 280 + itemIndex * 165, y: 280, value, label: itemIndex === 0 ? "front" : "waiting", type: "array-cell" as const, state: "queued" as const }))
      : [{ id: "queue-empty", x: 420, y: 280, value: "empty", label: "queue", type: "logic-node" as const, state: "inactive" as const }];
    const doneNodes = phase.done.map((name, itemIndex) => ({ id: `done-${itemIndex}`, x: 310 + itemIndex * 145, y: 455, value: name, label: "finished", type: "logic-node" as const, state: "matched" as const }));
    const nodes: Node[] = [...queueNodes, ...doneNodes];
    return step({
      concept: "queue",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: [phase.queue.length ? "queue-0" : "queue-empty", ...(phase.done.length ? [`done-${phase.done.length - 1}`] : [])], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });
}

export function generateLinkedListSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("linked-list", context);
  type LinkedPhase = {
    id: string;
    title: string;
    desc: string;
    edge?: string;
    visited?: string[];
    inactive?: string[];
    line: number;
    state: Record<string, string | number | boolean>;
  };
  type LinkedConfig = {
    values: Array<string | number>;
    example: string;
    target: string;
    result: string;
    code: string[];
    phases: LinkedPhase[];
  };
  const edgeFor = (from: string, to: string) => `${from}-${to}`;
  const baseCode = ["start at the head index", "look at the current node", "save what the prompt asks for", "follow the current next index", "check for the end marker", "return only the tracked result"];
  const configs: Partial<Record<VisualizerFamily, LinkedConfig>> = {
    "linked-list-traverse": {
      values: [10, 20, 30],
      example: "values=[10,20,30], nextIndexes=[1,2,-1], head=0",
      target: "return values in link order",
      result: "[10,20,30]",
      code: baseCode,
      phases: [
        { id: "n0", line: 1, title: context.title || "Follow Linked List Values", desc: "Start at the head index. A linked list must be followed by links, not by guessing indexes.", state: { current: 10, next: 20, result: "[]" } },
        { id: "n0", line: 2, title: "Read 10", desc: "Read the current node value before moving away from it.", state: { current: 10, saved_value: 10, result: "[10]" } },
        { id: "n1", edge: edgeFor("n0", "n1"), visited: ["n0"], line: 4, title: "Follow next to 20", desc: "The saved next link moves current from 10 to 20.", state: { current: 20, next: 30, result: "[10]" } },
        { id: "n1", visited: ["n0"], line: 2, title: "Read 20", desc: "Use the value at the current node, then look at its next link.", state: { current: 20, saved_value: 20, result: "[10,20]" } },
        { id: "n2", edge: edgeFor("n1", "n2"), visited: ["n0", "n1"], line: 4, title: "Follow next to 30", desc: "The next link from 20 reaches the final node.", state: { current: 30, next: "null", result: "[10,20]" } },
        { id: "n2", visited: ["n0", "n1"], line: 2, title: "Read 30", desc: "30 is still a real node, so it belongs in the output.", state: { current: 30, saved_value: 30, result: "[10,20,30]" } },
        { id: "n2", visited: ["n0", "n1", "n2"], line: 6, title: "Return values", desc: "The next link is null, so traversal is complete.", state: { current: "null", final_result: "[10,20,30]" } },
      ],
    },
    "linked-list-length": {
      values: ["A", "B", "C"],
      example: "nextIndexes=[1,2,-1], head=0",
      target: "count real nodes",
      result: "3",
      code: ["start count at zero", "visit the current node", "increase count once", "move to next", "stop at null", "return count"],
      phases: [
        { id: "n0", line: 1, title: context.title || "Linked List Length", desc: "Start at the head with count 0.", state: { current: "node 0", count: 0, result: "not final" } },
        { id: "n0", line: 3, title: "Count node 0", desc: "The head is a real node, so it adds one.", state: { current: "node 0", count: 1 } },
        { id: "n1", edge: edgeFor("n0", "n1"), visited: ["n0"], line: 4, title: "Move to node 1", desc: "Follow next instead of jumping by index.", state: { current: "node 1", count: 1 } },
        { id: "n1", visited: ["n0"], line: 3, title: "Count node 1", desc: "Node 1 is real, so count becomes 2.", state: { current: "node 1", count: 2 } },
        { id: "n2", edge: edgeFor("n1", "n2"), visited: ["n0", "n1"], line: 4, title: "Move to node 2", desc: "The next link reaches the final node.", state: { current: "node 2", count: 2 } },
        { id: "n2", visited: ["n0", "n1"], line: 3, title: "Count node 2", desc: "Node 2 is the third real node.", state: { current: "node 2", count: 3 } },
        { id: "n2", visited: ["n0", "n1", "n2"], line: 6, title: "Return 3", desc: "The next link is null, so the final length is 3.", state: { current: "null", final_result: "3" } },
      ],
    },
    "linked-list-tail": {
      values: [7, 8, 9],
      example: "values=[7,8,9], nextIndexes=[1,2,-1], head=0",
      target: "return tail value",
      result: "9",
      code: ["start at the head index", "keep the current value as a candidate", "inspect the next index", "move while another node exists", "stop at the end marker", "return the tracked candidate"],
      phases: [
        { id: "n0", line: 1, title: context.title || "Tail Value By Links", desc: "The tail is not known until a node has no next link.", state: { current: 7, candidate_tail: 7 } },
        { id: "n0", line: 2, title: "7 is only a candidate", desc: "7 has a next link, so it cannot be the tail yet.", state: { current: 7, next: 8, candidate_tail: 7 } },
        { id: "n1", edge: edgeFor("n0", "n1"), visited: ["n0"], line: 3, title: "Move to 8", desc: "Follow the next link to keep checking.", state: { current: 8, candidate_tail: 8 } },
        { id: "n1", visited: ["n0"], line: 2, title: "8 also has next", desc: "8 points to 9, so keep moving.", state: { current: 8, next: 9, candidate_tail: 8 } },
        { id: "n2", edge: edgeFor("n1", "n2"), visited: ["n0", "n1"], line: 3, title: "Move to 9", desc: "The current node becomes 9.", state: { current: 9, candidate_tail: 9 } },
        { id: "n2", visited: ["n0", "n1"], line: 4, title: "9 points to null", desc: "A null next link proves 9 is the tail.", state: { current: 9, next: "null", result: 9 } },
        { id: "n2", visited: ["n0", "n1", "n2"], line: 5, title: "Return 9", desc: "Return the value from the last real node.", state: { final_result: "9" } },
      ],
    },
    "linked-list-middle": {
      values: [5, 6, 7, 8],
      example: "values=[5,6,7,8], nextIndexes=[1,2,3,-1], head=0",
      target: "return middle value",
      result: "7",
      code: ["place both markers at head", "advance the slower marker once", "advance the faster marker farther", "repeat while the faster marker can continue", "use the slower marker's final node", "return the requested value"],
      phases: [
        { id: "n0", line: 1, title: context.title || "Linked List Middle Value", desc: "Both pointers start at the head.", state: { slow: 5, fast: 5, result: "not final" } },
        { id: "n1", edge: edgeFor("n0", "n1"), visited: ["n0"], line: 2, title: "Slow moves to 6", desc: "Slow moves one link.", state: { slow: 6, fast: 5 } },
        { id: "n2", edge: edgeFor("n1", "n2"), visited: ["n0"], line: 3, title: "Fast moves to 7", desc: "Fast moves two links total, so it gets ahead.", state: { slow: 6, fast: 7 } },
        { id: "n2", visited: ["n0", "n1"], line: 2, title: "Slow moves to 7", desc: "On the second round, slow advances one more node.", state: { slow: 7, fast: 7 } },
        { id: "n3", edge: edgeFor("n2", "n3"), visited: ["n0", "n1", "n2"], line: 3, title: "Fast reaches end", desc: "Fast moves beyond the list, so slow is now at the middle choice.", state: { slow: 7, fast: "null" } },
        { id: "n2", visited: ["n0", "n1"], inactive: ["n3"], line: 5, title: "Slow marks middle", desc: "When fast can no longer move, slow's value is the answer.", state: { middle: 7, result: 7 } },
        { id: "n2", visited: ["n0", "n1", "n2"], inactive: ["n3"], line: 6, title: "Return 7", desc: "Return the value where slow stopped.", state: { final_result: "7" } },
      ],
    },
    "linked-list-cycle": {
      values: ["A", "B", "C"],
      example: "nextIndexes=[1,2,1], head=0",
      target: "detect repeated node",
      result: "true",
      code: ["start at the head index", "remember each index you visit", "follow the current next index", "watch for an index already seen", "return the boolean the prompt asks for"],
      phases: [
        { id: "n0", line: 1, title: context.title || "Linked List Has Cycle", desc: "Start at the head with empty visited memory.", state: { current: "node 0", visited: "none", result: "not final" } },
        { id: "n0", line: 2, title: "Remember node 0", desc: "Node 0 has now been seen once.", state: { current: "node 0", visited: "0" } },
        { id: "n1", edge: edgeFor("n0", "n1"), visited: ["n0"], line: 3, title: "Move to node 1", desc: "Follow node 0's next link.", state: { current: "node 1", visited: "0" } },
        { id: "n1", visited: ["n0"], line: 2, title: "Remember node 1", desc: "Node 1 is now in visited memory.", state: { current: "node 1", visited: "0, 1" } },
        { id: "n2", edge: edgeFor("n1", "n2"), visited: ["n0", "n1"], line: 3, title: "Move to node 2", desc: "Node 2 is reached by following links.", state: { current: "node 2", visited: "0, 1" } },
        { id: "n1", edge: edgeFor("n2", "n1"), visited: ["n0", "n1", "n2"], line: 4, title: "Next returns to node 1", desc: "Node 2 points back to node 1, which was already visited.", state: { current: "node 1 again", repeated: "node 1", result: "true" } },
        { id: "n1", visited: ["n0", "n1", "n2"], line: 5, title: "Return true", desc: "Reaching a seen node means traversal would loop forever.", state: { final_result: "true" } },
      ],
    },
    "linked-list-reverse-values": {
      values: [4, 5, 6],
      example: "values=[4,5,6], nextIndexes=[1,2,-1], head=0",
      target: "return values in reverse",
      result: "[6,5,4]",
      code: ["walk from head by links", "place each visited value before older ones", "follow the current next index", "stop at the end marker", "return the collected values"],
      phases: [
        { id: "n0", line: 1, title: context.title || "Reverse Linked List Values", desc: "Start at the head value 4.", state: { current: 4, result: "[]" } },
        { id: "n0", line: 2, title: "Put 4 at front", desc: "Saving at the front prepares reverse order.", state: { current: 4, result: "[4]" } },
        { id: "n1", edge: edgeFor("n0", "n1"), visited: ["n0"], line: 3, title: "Move to 5", desc: "Follow next to the second node.", state: { current: 5, result: "[4]" } },
        { id: "n1", visited: ["n0"], line: 2, title: "Put 5 before 4", desc: "The newest visited value goes to the front.", state: { current: 5, result: "[5,4]" } },
        { id: "n2", edge: edgeFor("n1", "n2"), visited: ["n0", "n1"], line: 3, title: "Move to 6", desc: "Follow the final next link.", state: { current: 6, result: "[5,4]" } },
        { id: "n2", visited: ["n0", "n1"], line: 2, title: "Put 6 before 5", desc: "6 becomes the first value in the reversed result.", state: { current: 6, result: "[6,5,4]" } },
        { id: "n2", visited: ["n0", "n1", "n2"], line: 5, title: "Return reversed values", desc: "Null next means the reversed output is complete.", state: { final_result: "[6,5,4]" } },
      ],
    },
    "linked-list-kth": {
      values: [4, 5, 6],
      example: "values=[4,5,6], nextIndexes=[1,2,-1], head=0, k=2",
      target: "value after 2 links",
      result: "6",
      code: ["start at the head index", "track how many links have been followed", "follow one next index at a time", "stop when the requested link count is reached", "handle an early end marker", "return the current value"],
      phases: [
        { id: "n0", line: 1, title: context.title || "Value After K Links", desc: "Start at head before following any links.", state: { current: 4, links_followed: 0, k: 2 } },
        { id: "n1", edge: edgeFor("n0", "n1"), visited: ["n0"], line: 3, title: "Follow first link", desc: "One link moves current from 4 to 5.", state: { current: 5, links_followed: 1, k: 2 } },
        { id: "n1", visited: ["n0"], line: 2, title: "Need one more link", desc: "The count is 1, but k is 2.", state: { current: 5, links_followed: 1, remaining: 1 } },
        { id: "n2", edge: edgeFor("n1", "n2"), visited: ["n0", "n1"], line: 3, title: "Follow second link", desc: "The second link moves current to 6.", state: { current: 6, links_followed: 2, k: 2 } },
        { id: "n2", visited: ["n0", "n1"], line: 4, title: "Stop after k links", desc: "The link count now equals k, so do not move again.", state: { current: 6, links_followed: 2 } },
        { id: "n2", visited: ["n0", "n1"], line: 5, title: "Current value is 6", desc: "The requested node is the current node after exactly two links.", state: { result: 6 } },
        { id: "n2", visited: ["n0", "n1", "n2"], line: 5, title: "Return 6", desc: "Return the current value, not the index.", state: { final_result: "6" } },
      ],
    },
    "linked-list-merge-index": {
      values: ["A0", "B1", "M2", "T3"],
      example: "nextIndexes=[2,2,3,-1], headA=0, headB=1",
      target: "first shared node index",
      result: "2",
      code: ["walk from the first head", "remember indexes on that path", "restart from the second head", "compare each second-path index with memory", "stop at the first shared index", "return the prompt's merge result"],
      phases: [
        { id: "n0", line: 1, title: context.title || "Linked List Merge Index", desc: "Start by walking list A from headA.", state: { current_list: "A", current_index: 0, seen_A: "none" } },
        { id: "n0", line: 1, title: "Remember A index 0", desc: "Index 0 belongs to list A's path.", state: { current_list: "A", current_index: 0, seen_A: "0" } },
        { id: "n2", edge: edgeFor("n0", "n2"), visited: ["n0"], line: 1, title: "A reaches index 2", desc: "Following A's next link reaches the shared node candidate.", state: { current_list: "A", current_index: 2, seen_A: "0, 2" } },
        { id: "n3", edge: edgeFor("n2", "n3"), visited: ["n0", "n2"], line: 1, title: "Finish A path", desc: "A continues through index 3, then ends.", state: { current_list: "A", seen_A: "0, 2, 3" } },
        { id: "n1", line: 2, title: "Restart at B head", desc: "Now walk list B and compare each index with A's memory.", state: { current_list: "B", current_index: 1, seen_A: "0, 2, 3" } },
        { id: "n2", edge: edgeFor("n1", "n2"), visited: ["n0", "n1"], line: 4, title: "B reaches seen index 2", desc: "Index 2 was already on A's path, so this is the first merge point.", state: { current_list: "B", current_index: 2, result: 2 } },
        { id: "n2", visited: ["n0", "n1", "n2"], inactive: ["n3"], line: 5, title: "Return index 2", desc: "Return the shared index, not the node value.", state: { final_result: "2" } },
      ],
    },
  };
  const config = configs[family] || configs["linked-list-traverse"]!;
  const nodes: Node[] = config.values.map((value, index) => ({
    id: `n${index}`,
    x: 180 + index * 190,
    y: 260,
    value,
    type: "linked-node",
  }));
  const edgePairs = family === "linked-list-cycle"
    ? [["n0", "n1"], ["n1", "n2"], ["n2", "n1"]]
    : family === "linked-list-merge-index"
      ? [["n0", "n2"], ["n1", "n2"], ["n2", "n3"]]
      : nodes.slice(1).map((node, index) => [`n${index}`, node.id]);
  const edges: Edge[] = edgePairs.map(([from, to]) => ({ id: edgeFor(from, to), from, to, type: "pointer" }));
  return config.phases.map((phase, index) => {
    let phaseNodes = withNodeState(nodes, phase.visited || [], "visited");
    if (phase.inactive?.length) phaseNodes = withNodeState(phaseNodes, phase.inactive, "inactive");
    phaseNodes = withNodeState(phaseNodes, [phase.id], "active");
    const activeEdges = phase.edge ? [phase.edge] : [];
    return step({
      concept: "linked-list",
      title: phase.title,
      description: phase.desc,
      nodes: phaseNodes,
      edges: withEdgeState(edges, activeEdges, "active"),
      highlights: { nodeIds: [phase.id], edgeIds: activeEdges, lineNumbers: [phase.line] },
      code: config.code,
      activeLine: phase.line,
      workflow: workflowFromLabels(config.phases.map((item) => item.title), index),
      state: { example: config.example, target: config.target, visual_family: family, result: index === config.phases.length - 1 ? config.result : "not final", ...phase.state },
    }, index + 1);
  });
}

export function generateBinarySearchSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("binary-search", context);
  type BinaryPhase = {
    left: number;
    mid: number;
    right: number;
    title: string;
    desc: string;
    line: number;
    state: Record<string, string | number | boolean>;
  };
  const build = (
    values: Array<string | number>,
    phases: BinaryPhase[],
    code: string[],
    labels: string[] = [],
  ): Step[] => phases.map((phase, index) => {
    const candidateIndex = typeof phase.state.candidate_index === "number" ? phase.state.candidate_index : null;
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex === phase.mid
        ? "active" as const
        : nodeIndex === candidateIndex
          ? "matched" as const
          : nodeIndex < phase.left || nodeIndex > phase.right
            ? "inactive" as const
            : "default" as const,
      label: nodeIndex === phase.left && nodeIndex === phase.right
        ? "left/mid/right"
        : nodeIndex === phase.left && nodeIndex === phase.mid
          ? "left/mid"
          : nodeIndex === phase.mid && nodeIndex === phase.right
            ? "mid/right"
            : nodeIndex === phase.left
              ? "left"
              : nodeIndex === phase.mid
                ? "mid"
                : nodeIndex === phase.right
                  ? "right"
                  : labels[nodeIndex] || String(nodeIndex),
    }));
    return step({
      concept: "binary-search",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: [`item-${phase.mid}`], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: {
        left: phase.left,
        mid: phase.mid,
        right: phase.right,
        mid_value: values[phase.mid] ?? "none",
        ...phase.state,
      },
    }, index + 1);
  });

  if (family === "binary-search-first-at-least") {
    const values = [60, 70, 70, 85];
    const code = ["keep a possible sorted range", "check the middle score", "if score is high enough, save index and search left", "if score is too low, search right", "repeat with the smaller range", "stop when the range is empty", "return the saved first index", "finish"];
    return build(values, [
      { left: 0, mid: 1, right: 3, line: 1, title: context.title || "First Score At Least", desc: "The whole sorted score list can still contain the first score at least 70.", state: { example: "scores=[60,70,70,85], target=70", target: "first index with score >= 70", candidate: "none", result: "none yet" } },
      { left: 0, mid: 1, right: 3, line: 2, title: "Check score 70", desc: "Index 1 is high enough, but it might not be the first high-enough score.", state: { example: "scores=[60,70,70,85], target=70", target: "first index with score >= 70", decision: "high enough", candidate: 1, candidate_index: 1 } },
      { left: 0, mid: 1, right: 0, line: 3, title: "Save 1 and search left", desc: "Keep index 1 as the best answer so far, then look left for an earlier valid score.", state: { example: "scores=[60,70,70,85], target=70", target: "first index with score >= 70", candidate: 1, candidate_index: 1, action: "right moves left" } },
      { left: 0, mid: 0, right: 0, line: 5, title: "New range is index 0", desc: "Only score 60 remains to test before index 1 can be trusted.", state: { example: "scores=[60,70,70,85], target=70", target: "first index with score >= 70", candidate: 1, candidate_index: 1 } },
      { left: 0, mid: 0, right: 0, line: 2, title: "Check score 60", desc: "60 is too low, so it cannot be the answer.", state: { example: "scores=[60,70,70,85], target=70", target: "first index with score >= 70", decision: "too low", candidate: 1, candidate_index: 1 } },
      { left: 1, mid: 0, right: 0, line: 4, title: "Range becomes empty", desc: "Move left past right because the last unchecked value was too small.", state: { example: "scores=[60,70,70,85], target=70", target: "first index with score >= 70", candidate: 1, candidate_index: 1, action: "stop" } },
      { left: 1, mid: 1, right: 0, line: 7, title: "Return index 1", desc: "Index 1 is the earliest score that reaches 70.", state: { example: "scores=[60,70,70,85], target=70", target: "first index with score >= 70", result: 1, candidate_index: 1 } },
      { left: 1, mid: 1, right: 0, line: 8, title: "Trace complete", desc: "This boundary search returns a saved candidate, not just the first match seen.", state: { example: "scores=[60,70,70,85], target=70", target: "first index with score >= 70", final_result: 1, candidate_index: 1 } },
    ], code);
  }

  if (family === "binary-search-first-one" || family === "binary-search-first-bad") {
    const values = [0, 0, 1, 1];
    const firstBad = family === "binary-search-first-bad";
    const example = firstBad ? "versions=[0,0,1,1]" : "flags=[0,0,1,1]";
    const target = firstBad ? "first bad version index" : "first index containing 1";
    const code = ["keep a possible sorted range", "check the middle flag", "if middle is 1, save it and search left", "if middle is 0, search right", "repeat until the range is empty", "return saved index or -1", "finish", "done"];
    return build(values, [
      { left: 0, mid: 1, right: 3, line: 1, title: context.title || (firstBad ? "First Bad Version" : "First One Index"), desc: "The list is sorted, so all zeros come before the first 1.", state: { example, target, candidate: "none", result: "none yet" } },
      { left: 0, mid: 1, right: 3, line: 2, title: "Check middle 0", desc: "A 0 means the first 1 must be to the right.", state: { example, target, decision: "0 means move right", candidate: "none" } },
      { left: 2, mid: 2, right: 3, line: 4, title: "Search right half", desc: "Indexes 0 and 1 are ruled out because they are good/zero values.", state: { example, target, candidate: "none", action: "left moves to 2" } },
      { left: 2, mid: 2, right: 3, line: 2, title: "Check middle 1", desc: "Index 2 is a valid answer, but there might be an earlier 1 inside the current range.", state: { example, target, decision: "found 1", candidate: 2 } },
      { left: 2, mid: 2, right: 1, line: 3, title: "Save 2 and search left", desc: "Keep 2, then move right leftward to prove no earlier 1 remains.", state: { example, target, candidate: 2, action: "right moves left" } },
      { left: 2, mid: 2, right: 1, line: 5, title: "Range is empty", desc: "Left is now past right, so the saved candidate is final.", state: { example, target, candidate: 2, decision: "stop" } },
      { left: 2, mid: 2, right: 1, line: 6, title: "Return 2", desc: firstBad ? "Version 2 is the first bad version." : "Index 2 is the first position containing 1.", state: { example, target, result: 2 } },
      { left: 2, mid: 2, right: 1, line: 8, title: "Trace complete", desc: "The answer is a boundary index, so saving the candidate matters.", state: { example, target, final_result: 2 } },
    ], code);
  }

  if (family === "binary-search-first-passing") {
    const values = [55, 61, 70];
    const code = ["keep a possible score range", "check the middle score", "if score passes, save the value and search left", "if score fails, search right", "stop when no candidates remain", "return saved score or -1", "finish", "done"];
    return build(values, [
      { left: 0, mid: 1, right: 2, line: 1, title: context.title || "First Passing Score Value", desc: "The goal is the score value, not the index.", state: { example: "scores=[55,61,70], passingScore=60", target: "first score >= 60", candidate: "none", result: "none yet" } },
      { left: 0, mid: 1, right: 2, line: 2, title: "Check 61", desc: "61 passes, so save the value before searching left.", state: { example: "scores=[55,61,70], passingScore=60", target: "first score >= 60", decision: "passes", candidate: 61 } },
      { left: 0, mid: 0, right: 0, line: 3, title: "Search left for earlier pass", desc: "A smaller passing score could still exist before index 1.", state: { example: "scores=[55,61,70], passingScore=60", target: "first score >= 60", candidate: 61 } },
      { left: 0, mid: 0, right: 0, line: 2, title: "Check 55", desc: "55 does not pass, so it cannot replace the saved value.", state: { example: "scores=[55,61,70], passingScore=60", target: "first score >= 60", decision: "fails", candidate: 61 } },
      { left: 1, mid: 0, right: 0, line: 4, title: "Range becomes empty", desc: "After ruling out 55, no unchecked score remains to the left.", state: { example: "scores=[55,61,70], passingScore=60", target: "first score >= 60", candidate: 61 } },
      { left: 1, mid: 1, right: 0, line: 5, title: "Keep saved score", desc: "The saved passing score is still 61.", state: { example: "scores=[55,61,70], passingScore=60", target: "first score >= 60", candidate: 61 } },
      { left: 1, mid: 1, right: 0, line: 6, title: "Return 61", desc: "Return the score value 61, not its index.", state: { example: "scores=[55,61,70], passingScore=60", target: "first score >= 60", result: 61 } },
      { left: 1, mid: 1, right: 0, line: 8, title: "Trace complete", desc: "The boundary search returns the first value that satisfies the passing rule.", state: { example: "scores=[55,61,70], passingScore=60", target: "first score >= 60", final_result: 61 } },
    ], code);
  }

  if (family === "binary-search-insert-position") {
    const values = [1, 3, 5, 6];
    const code = ["keep the possible insert range", "check the middle value", "if middle is too small, move left rightward", "if middle is big enough, move right leftward", "repeat until left passes right", "left is the insert position", "return left", "finish"];
    return build(values, [
      { left: 0, mid: 1, right: 3, line: 1, title: context.title || "Binary Search Insert Position", desc: "The insert position for target 2 must be somewhere in this sorted list.", state: { example: "values=[1,3,5,6], target=2", target: "index where 2 belongs", result: "none yet" } },
      { left: 0, mid: 1, right: 3, line: 2, title: "Check 3", desc: "3 is bigger than 2, so the insert spot is at index 1 or earlier.", state: { example: "values=[1,3,5,6], target=2", target: "index where 2 belongs", decision: "too high" } },
      { left: 0, mid: 0, right: 0, line: 4, title: "Search left side", desc: "Move right to index 0 and keep the earlier half.", state: { example: "values=[1,3,5,6], target=2", target: "index where 2 belongs", action: "right moves to 0" } },
      { left: 0, mid: 0, right: 0, line: 2, title: "Check 1", desc: "1 is smaller than 2, so the insert spot must be after it.", state: { example: "values=[1,3,5,6], target=2", target: "index where 2 belongs", decision: "too low" } },
      { left: 1, mid: 0, right: 0, line: 3, title: "Left becomes 1", desc: "Left moves to the first position where 2 could fit.", state: { example: "values=[1,3,5,6], target=2", target: "index where 2 belongs", insert_position: 1 } },
      { left: 1, mid: 1, right: 0, line: 5, title: "Range is empty", desc: "Left has crossed right, so binary search is done.", state: { example: "values=[1,3,5,6], target=2", target: "index where 2 belongs", insert_position: 1 } },
      { left: 1, mid: 1, right: 0, line: 7, title: "Return 1", desc: "Target 2 belongs before 3 at index 1.", state: { example: "values=[1,3,5,6], target=2", target: "index where 2 belongs", result: 1 } },
      { left: 1, mid: 1, right: 0, line: 8, title: "Trace complete", desc: "Insert-position search returns left after the range closes.", state: { example: "values=[1,3,5,6], target=2", target: "index where 2 belongs", final_result: 1 } },
    ], code);
  }

  if (family === "binary-search-exact") {
    const values = [2, 4, 6, 8];
    const code = ["keep the possible sorted range", "check the middle value", "if middle is too small, search right", "if middle is too large, search left", "if middle equals target, return its index", "if range empties, return -1", "finish", "done"];
    return build(values, [
      { left: 0, mid: 1, right: 3, line: 1, title: context.title || "Binary Search Exact", desc: "Exact search returns the index only when the target is actually found.", state: { example: "values=[2,4,6,8], target=6", target: "find value 6", result: "none yet" } },
      { left: 0, mid: 1, right: 3, line: 2, title: "Check 4", desc: "4 is less than 6, so the answer cannot be at index 1 or left of it.", state: { example: "values=[2,4,6,8], target=6", target: "find value 6", decision: "too low" } },
      { left: 2, mid: 2, right: 3, line: 3, title: "Search right half", desc: "Move left to index 2.", state: { example: "values=[2,4,6,8], target=6", target: "find value 6", action: "left moves to 2" } },
      { left: 2, mid: 2, right: 3, line: 2, title: "Check 6", desc: "The middle value is now the target.", state: { example: "values=[2,4,6,8], target=6", target: "find value 6", decision: "match" } },
      { left: 2, mid: 2, right: 3, line: 5, title: "Return immediately", desc: "Exact search can stop as soon as values[mid] equals the target.", state: { example: "values=[2,4,6,8], target=6", target: "find value 6", result: 2 } },
      { left: 2, mid: 2, right: 3, line: 7, title: "No boundary scan", desc: "Unlike first/last searches, exact search does not need to prove an earlier duplicate.", state: { example: "values=[2,4,6,8], target=6", target: "find value 6", result: 2 } },
      { left: 2, mid: 2, right: 3, line: 7, title: "Answer is index 2", desc: "Index 2 holds value 6.", state: { example: "values=[2,4,6,8], target=6", target: "find value 6", result: 2 } },
      { left: 2, mid: 2, right: 3, line: 8, title: "Trace complete", desc: "The compact example returns 2.", state: { example: "values=[2,4,6,8], target=6", target: "find value 6", final_result: 2 } },
    ], code);
  }

  if (family === "binary-search-last-at-most") {
    const values = [50, 60, 60, 70];
    const code = ["keep a possible sorted range", "check the middle score", "if score is at most target, save index and search right", "if score is too high, search left", "repeat until the range is empty", "return saved last index", "finish", "done"];
    return build(values, [
      { left: 0, mid: 1, right: 3, line: 1, title: context.title || "Last Score At Most", desc: "The answer is the last index whose score is at most 60.", state: { example: "scores=[50,60,60,70], target=60", target: "last index with score <= 60", candidate: "none", result: "none yet" } },
      { left: 0, mid: 1, right: 3, line: 2, title: "Check first 60", desc: "Index 1 qualifies, but a later qualifying score may exist.", state: { example: "scores=[50,60,60,70], target=60", target: "last index with score <= 60", decision: "qualifies", candidate: 1 } },
      { left: 2, mid: 2, right: 3, line: 3, title: "Save 1 and search right", desc: "To find the last qualifying index, move left to the right side.", state: { example: "scores=[50,60,60,70], target=60", target: "last index with score <= 60", candidate: 1 } },
      { left: 2, mid: 2, right: 3, line: 2, title: "Check second 60", desc: "Index 2 also qualifies and is farther right.", state: { example: "scores=[50,60,60,70], target=60", target: "last index with score <= 60", decision: "qualifies", candidate: 2 } },
      { left: 3, mid: 3, right: 3, line: 3, title: "Search right again", desc: "Move rightward once more to make sure no later score also qualifies.", state: { example: "scores=[50,60,60,70], target=60", target: "last index with score <= 60", candidate: 2 } },
      { left: 3, mid: 3, right: 3, line: 2, title: "Check 70", desc: "70 is too high, so the last valid index stays 2.", state: { example: "scores=[50,60,60,70], target=60", target: "last index with score <= 60", decision: "too high", candidate: 2 } },
      { left: 3, mid: 3, right: 2, line: 6, title: "Return 2", desc: "The saved candidate is the last score at most 60.", state: { example: "scores=[50,60,60,70], target=60", target: "last index with score <= 60", result: 2 } },
      { left: 3, mid: 2, right: 2, line: 8, title: "Trace complete", desc: "This boundary search intentionally continues after the first matching 60.", state: { example: "scores=[50,60,60,70], target=60", target: "last index with score <= 60", final_result: 2 } },
    ], code);
  }

  if (family === "binary-search-median-two-lists") {
    const values = ["cut 0", "cut 1", "cut 2"];
    const labels = ["too far left", "balanced", "too far right"];
    const code = ["binary search the smaller list's cut", "pair that cut with the matching cut in the other list", "compare left-side max with right-side min", "if left side is too big, move cut left", "if right side is too big, move cut right", "when both sides fit, read the middle value", "return the median", "finish"];
    return build(values, [
      { left: 0, mid: 1, right: 2, line: 1, title: context.title || "Median of Two Sorted Lists", desc: "Binary search chooses a partition cut in the shorter list, not a target value.", state: { example: "left=[1,3], right=[2]", target: "median of merged order", partition: "left cut 1", result: "none yet" } },
      { left: 0, mid: 1, right: 2, line: 2, title: "Pair the cuts", desc: "Cutting left after 1 pairs with cutting right after 2, making left side [1,2].", state: { example: "left=[1,3], right=[2]", target: "median of merged order", left_side: "[1,2]", right_side: "[3]" } },
      { left: 0, mid: 1, right: 2, line: 3, title: "Check partition order", desc: "The biggest value on the left side is 2, and the smallest on the right is 3, so the cut is valid.", state: { example: "left=[1,3], right=[2]", target: "median of merged order", decision: "partition fits" } },
      { left: 0, mid: 1, right: 2, line: 6, title: "Read middle value", desc: "The combined length is odd, so the median is the largest value on the left side.", state: { example: "left=[1,3], right=[2]", target: "median of merged order", middle_value: 2 } },
      { left: 0, mid: 1, right: 2, line: 6, title: "Median is 2", desc: "The partition proves the merged order would be [1, 2, 3] without building it.", state: { example: "left=[1,3], right=[2]", target: "median of merged order", result: 2 } },
      { left: 0, mid: 1, right: 2, line: 7, title: "Return 2", desc: "Return the median value.", state: { example: "left=[1,3], right=[2]", target: "median of merged order", result: 2 } },
      { left: 0, mid: 1, right: 2, line: 8, title: "Trace complete", desc: "This tracer shows the partition idea instead of a normal exact lookup.", state: { example: "left=[1,3], right=[2]", target: "median of merged order", final_result: 2 } },
      { left: 0, mid: 1, right: 2, line: 8, title: "No merge needed", desc: "The final answer comes from the valid cut, not from scanning both lists.", state: { example: "left=[1,3], right=[2]", target: "median of merged order", final_result: 2 } },
    ], code, labels);
  }

  const values = [1, 3, 5];
  const code = ["keep the possible sorted range", "check the middle value", "move left or right based on the comparison", "repeat with the smaller range", "return the requested result", "finish", "done", "complete"];
  return build(values, [
    { left: 0, mid: 1, right: 2, line: 1, title: context.title || "Binary search", desc: "Start with the full sorted range.", state: { example: "values=[1, 3, 5], target=3", target: "find 3", result: "none yet" } },
    { left: 0, mid: 1, right: 2, line: 2, title: "Check middle", desc: "The middle value is 3.", state: { example: "values=[1, 3, 5], target=3", target: "find 3", decision: "match" } },
    { left: 0, mid: 1, right: 2, line: 5, title: "Return match", desc: "The target was found at the middle index.", state: { example: "values=[1, 3, 5], target=3", target: "find 3", result: 1 } },
    { left: 0, mid: 1, right: 2, line: 8, title: "Trace complete", desc: "The compact example returns the found index.", state: { example: "values=[1, 3, 5], target=3", target: "find 3", final_result: 1 } },
  ], code);
}

export function generateTwoPointerSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("two-pointers", context);
  type PointerPhase = {
    left: number;
    right: number;
    title: string;
    desc: string;
    line: number;
    state: Record<string, string | number | boolean>;
  };
  const build = (
    values: Array<string | number>,
    phases: PointerPhase[],
    code: string[],
    labels: string[] = [],
  ): Step[] => phases.map((phase, index) => {
    const activeIds = [`item-${phase.left}`, `item-${phase.right}`].filter((id) => !id.endsWith("--1"));
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex === phase.left || nodeIndex === phase.right ? "comparing" as const : "default" as const,
      label: nodeIndex === phase.left ? "left" : nodeIndex === phase.right ? "right" : labels[nodeIndex] || String(nodeIndex),
    }));
    return step({
      concept: "two-pointers",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: activeIds, lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: {
        left: phase.left,
        right: phase.right,
        left_value: values[phase.left] ?? "done",
        right_value: values[phase.right] ?? "done",
        ...phase.state,
      },
    }, index + 1);
  });

  if (family === "two-pointer-edge-pairs") {
    const values = ["lab", "quiz", "lab"];
    const code = [
      "place one pointer at each edge",
      "compare the two edge words",
      "if they match, add one to the count",
      "move both pointers inward",
      "stop when no outside pair remains",
      "return the match count",
      "finish",
    ];
    return build(values, [
      { left: 0, right: 2, line: 1, title: context.title || "Edge Pair Matches", desc: "Start with the first and last words because the prompt asks for outside-in pairs.", state: { example: "words=[lab, quiz, lab]", target: "count matching edge pairs", count: 0, action: "start at edges", result: "none yet" } },
      { left: 0, right: 2, line: 2, title: "Compare lab and lab", desc: "The outside words match, so this pair should count.", state: { example: "words=[lab, quiz, lab]", target: "count matching edge pairs", pair: "lab == lab", count: 0, action: "compare pair" } },
      { left: 0, right: 2, line: 3, title: "Count the match", desc: "Add one because the active edge pair is equal.", state: { example: "words=[lab, quiz, lab]", target: "count matching edge pairs", pair: "lab == lab", count: 1, result: 1 } },
      { left: 1, right: 1, line: 4, title: "Move inward", desc: "Both pointers move toward the middle after one outside pair is handled.", state: { example: "words=[lab, quiz, lab]", target: "count matching edge pairs", count: 1, action: "left and right meet" } },
      { left: 1, right: 1, line: 5, title: "No pair remains", desc: "The middle word has no partner across from it, so it does not create another pair.", state: { example: "words=[lab, quiz, lab]", target: "count matching edge pairs", count: 1, action: "stop scanning" } },
      { left: 1, right: 1, line: 6, title: "Return 1", desc: "Only one outside-in pair matched.", state: { example: "words=[lab, quiz, lab]", target: "count matching edge pairs", result: 1 } },
      { left: 1, right: 1, line: 7, title: "Trace complete", desc: "The visual stops with the same count the compact example asks for.", state: { example: "words=[lab, quiz, lab]", target: "count matching edge pairs", final_result: 1 } },
    ], code);
  }

  if (family === "two-pointer-symmetric") {
    const values = ["Ana", "Bo", "Ana"];
    const code = [
      "place pointers on the first and last names",
      "compare the active names",
      "a mismatch would return false",
      "move both pointers inward after a match",
      "stop when the pointers meet or cross",
      "return true if no mismatch happened",
      "finish",
    ];
    return build(values, [
      { left: 0, right: 2, line: 1, title: context.title || "Symmetric Roster Check", desc: "A symmetric roster must match from the outside toward the center.", state: { example: "names=[Ana, Bo, Ana]", target: "return true when symmetric", status: "checking", result: "none yet" } },
      { left: 0, right: 2, line: 2, title: "Compare Ana and Ana", desc: "The first and last names match, so the roster can keep going.", state: { example: "names=[Ana, Bo, Ana]", target: "return true when symmetric", pair: "Ana == Ana", status: "match" } },
      { left: 0, right: 2, line: 3, title: "No mismatch", desc: "Because this pair matched, the false path is skipped.", state: { example: "names=[Ana, Bo, Ana]", target: "return true when symmetric", decision: "keep checking" } },
      { left: 1, right: 1, line: 4, title: "Move to the middle", desc: "Both pointers move inward. Now they meet on Bo.", state: { example: "names=[Ana, Bo, Ana]", target: "return true when symmetric", status: "middle reached" } },
      { left: 1, right: 1, line: 5, title: "All pairs checked", desc: "A single middle item does not need a pair, so the scan is complete.", state: { example: "names=[Ana, Bo, Ana]", target: "return true when symmetric", status: "no mismatch" } },
      { left: 1, right: 1, line: 6, title: "Return true", desc: "Every outside pair matched before the pointers met.", state: { example: "names=[Ana, Bo, Ana]", target: "return true when symmetric", result: "true" } },
      { left: 1, right: 1, line: 7, title: "Trace complete", desc: "The compact roster reads the same forward and backward.", state: { example: "names=[Ana, Bo, Ana]", target: "return true when symmetric", final_result: "true" } },
    ], code);
  }

  if (family === "two-pointer-count-ends") {
    const values = [1, 2, 2, 1];
    const code = [
      "place pointers on both ends",
      "compare the active values",
      "add one when the values match",
      "move both pointers inward",
      "compare the next outside pair",
      "stop when pointers cross",
      "return the count",
    ];
    return build(values, [
      { left: 0, right: 3, line: 1, title: context.title || "Count Matching Ends", desc: "Start with the values at both ends of the list.", state: { example: "values=[1, 2, 2, 1]", target: "count equal end pairs", count: 0, result: "none yet" } },
      { left: 0, right: 3, line: 2, title: "Compare 1 and 1", desc: "The outside values match.", state: { example: "values=[1, 2, 2, 1]", target: "count equal end pairs", pair: "1 == 1", count: 0 } },
      { left: 0, right: 3, line: 3, title: "Count first pair", desc: "Save one match before moving the pointers.", state: { example: "values=[1, 2, 2, 1]", target: "count equal end pairs", count: 1, result: 1 } },
      { left: 1, right: 2, line: 4, title: "Move inward", desc: "Now the active pair is the next outside pair: 2 and 2.", state: { example: "values=[1, 2, 2, 1]", target: "count equal end pairs", count: 1 } },
      { left: 1, right: 2, line: 5, title: "Compare 2 and 2", desc: "The second active pair also matches.", state: { example: "values=[1, 2, 2, 1]", target: "count equal end pairs", pair: "2 == 2", count: 2, result: 2 } },
      { left: 2, right: 1, line: 6, title: "Pointers crossed", desc: "After moving inward again, there are no more pairs to check.", state: { example: "values=[1, 2, 2, 1]", target: "count equal end pairs", count: 2, action: "stop" } },
      { left: 2, right: 1, line: 7, title: "Return 2", desc: "Two outside-in pairs were equal.", state: { example: "values=[1, 2, 2, 1]", target: "count equal end pairs", result: 2 } },
    ], code);
  }

  if (family === "two-pointer-merge") {
    const values = ["1", "3", "5", "2", "4"];
    const labels = ["L0", "L1", "L2", "R0", "R1"];
    const code = [
      "point to the first unused value in each sorted list",
      "compare the two active values",
      "copy the smaller value to the result",
      "move only the pointer that supplied the value",
      "repeat until one list is empty",
      "copy the leftovers in order",
      "return the merged list",
    ];
    return build(values, [
      { left: 0, right: 3, line: 1, title: context.title || "Merge Sorted Lists", desc: "Use one pointer for each sorted list: left list starts at 1, right list starts at 2.", state: { example: "left=[1,3,5], right=[2,4]", target: "merged sorted list", result: "[]" } },
      { left: 0, right: 3, line: 2, title: "Compare 1 and 2", desc: "1 is smaller, so it is the next value in the merged result.", state: { example: "left=[1,3,5], right=[2,4]", target: "merged sorted list", compare: "1 vs 2", result: "[]" } },
      { left: 0, right: 3, line: 3, title: "Copy 1", desc: "Add 1 to the result, then advance only the left-list pointer.", state: { example: "left=[1,3,5], right=[2,4]", target: "merged sorted list", copied: 1, result: "[1]" } },
      { left: 1, right: 3, line: 4, title: "Left pointer moves", desc: "The right pointer stays on 2 because 2 has not been copied yet.", state: { example: "left=[1,3,5], right=[2,4]", target: "merged sorted list", compare: "3 vs 2", result: "[1]" } },
      { left: 1, right: 3, line: 3, title: "Copy 2", desc: "2 is smaller than 3, so copy from the right list this time.", state: { example: "left=[1,3,5], right=[2,4]", target: "merged sorted list", copied: 2, result: "[1,2]" } },
      { left: 1, right: 4, line: 5, title: "Repeat the pattern", desc: "Continue comparing current values; the next copied values are 3 and 4.", state: { example: "left=[1,3,5], right=[2,4]", target: "merged sorted list", result: "[1,2,3,4]" } },
      { left: 2, right: 4, line: 6, title: "Copy leftover 5", desc: "The right list is used up, so the remaining left value keeps its order.", state: { example: "left=[1,3,5], right=[2,4]", target: "merged sorted list", copied: 5, result: "[1,2,3,4,5]" } },
      { left: 2, right: 4, line: 7, title: "Return merged list", desc: "The result contains every value from both sorted lists.", state: { example: "left=[1,3,5], right=[2,4]", target: "merged sorted list", result: "[1,2,3,4,5]" } },
    ], code, labels);
  }

  if (family === "two-pointer-pair-sum") {
    const values = [1, 2, 4, 7];
    const code = [
      "start with the smallest and largest values",
      "add the active pair",
      "if the sum is too small, move left inward",
      "if the sum is too large, move right inward",
      "if the sum equals target, save true",
      "stop when a match is found",
      "return the boolean result",
    ];
    return build(values, [
      { left: 0, right: 3, line: 1, title: context.title || "Pair Sum Sorted", desc: "Sorted order lets the smallest and largest values decide which pointer should move.", state: { example: "values=[1, 2, 4, 7], target=9", target: 9, sum: 8, result: "none yet" } },
      { left: 0, right: 3, line: 2, title: "Add 1 + 7", desc: "The first pair totals 8.", state: { example: "values=[1, 2, 4, 7], target=9", target: 9, sum: 8, decision: "too small" } },
      { left: 1, right: 3, line: 3, title: "Move left inward", desc: "A larger left value can increase the sum toward target 9.", state: { example: "values=[1, 2, 4, 7], target=9", target: 9, sum: 9, action: "left moves" } },
      { left: 1, right: 3, line: 2, title: "Add 2 + 7", desc: "The active pair now totals 9.", state: { example: "values=[1, 2, 4, 7], target=9", target: 9, sum: 9, decision: "match" } },
      { left: 1, right: 3, line: 5, title: "Save true", desc: "The pair uses two different positions and matches the target.", state: { example: "values=[1, 2, 4, 7], target=9", target: 9, pair: "2 + 7", result: "true" } },
      { left: 1, right: 3, line: 6, title: "Stop early", desc: "Once true is known, no later pair can change the boolean answer.", state: { example: "values=[1, 2, 4, 7], target=9", target: 9, action: "match found", result: "true" } },
      { left: 1, right: 3, line: 7, title: "Return true", desc: "Return true because 2 and 7 add to 9.", state: { example: "values=[1, 2, 4, 7], target=9", target: 9, result: "true" } },
    ], code);
  }

  if (family === "two-pointer-reverse-letters") {
    const values = ["a", "-", "b", "C", "-", "d"];
    const code = [
      "place pointers at both ends of the text",
      "skip a pointer when it sees punctuation",
      "when both pointers see letters, swap them",
      "move both pointers inward after a swap",
      "repeat until pointers meet or cross",
      "keep punctuation in its original slot",
      "return the rebuilt text",
    ];
    return build(values, [
      { left: 0, right: 5, line: 1, title: context.title || "Reverse Only Letters", desc: "The pointers start on the outside characters. Punctuation must stay where it is.", state: { example: "a-bC-d", target: "reverse letters only", result: "a-bC-d" } },
      { left: 0, right: 5, line: 3, title: "Swap a and d", desc: "Both sides are letters, so swap them.", state: { example: "a-bC-d", target: "reverse letters only", swap: "a with d", result: "d-bC-a" } },
      { left: 1, right: 4, line: 4, title: "Move inward", desc: "After the swap, both pointers move toward the middle.", state: { example: "a-bC-d", target: "reverse letters only", action: "check punctuation", result: "d-bC-a" } },
      { left: 1, right: 4, line: 2, title: "Skip punctuation", desc: "Both active slots are hyphens, so the pointers skip past them without moving the hyphens.", state: { example: "a-bC-d", target: "reverse letters only", skipped: "hyphens", result: "d-bC-a" } },
      { left: 2, right: 3, line: 3, title: "Swap b and C", desc: "The next two active characters are letters, so they swap.", state: { example: "a-bC-d", target: "reverse letters only", swap: "b with C", result: "d-Cb-a" } },
      { left: 3, right: 2, line: 5, title: "Pointers crossed", desc: "The letter reversal is done while punctuation stayed in the same slots.", state: { example: "a-bC-d", target: "reverse letters only", action: "stop", result: "d-Cb-a" } },
      { left: 3, right: 2, line: 7, title: "Return d-Cb-a", desc: "Return the rebuilt compact string after only letters moved.", state: { example: "a-bC-d", target: "reverse letters only", result: "d-Cb-a" } },
    ], code);
  }

  if (family === "two-pointer-closest") {
    const values = [1, 4, 7, 10];
    const code = [
      "start with the smallest and largest values",
      "add the active pair",
      "compare its distance from the target",
      "save the closest pair so far",
      "move the pointer that can improve the sum",
      "repeat until the pointers meet",
      "return the saved closest pair",
    ];
    return build(values, [
      { left: 0, right: 3, line: 1, title: context.title || "Closest Pair Sum Sorted", desc: "Start with the outside pair in the sorted list.", state: { example: "values=[1, 4, 7, 10], target=12", target: 12, sum: 11, best_pair: "none", result: "none yet" } },
      { left: 0, right: 3, line: 2, title: "Add 1 + 10", desc: "The first pair totals 11.", state: { example: "values=[1, 4, 7, 10], target=12", target: 12, sum: 11, gap: 1 } },
      { left: 0, right: 3, line: 4, title: "Save [1, 10]", desc: "A gap of 1 is the best seen so far.", state: { example: "values=[1, 4, 7, 10], target=12", target: 12, best_pair: "[1, 10]", gap: 1, result: "[1, 10]" } },
      { left: 1, right: 3, line: 5, title: "Move left inward", desc: "The sum was below 12, so moving left to 4 may get closer.", state: { example: "values=[1, 4, 7, 10], target=12", target: 12, action: "left moves" } },
      { left: 1, right: 3, line: 3, title: "Check 4 + 10", desc: "This pair totals 14, which is 2 away from target.", state: { example: "values=[1, 4, 7, 10], target=12", target: 12, sum: 14, gap: 2, best_pair: "[1, 10]" } },
      { left: 1, right: 2, line: 6, title: "Check final pair", desc: "Move right inward and compare 4 + 7. It ties the old gap, so the first best pair stays saved.", state: { example: "values=[1, 4, 7, 10], target=12", target: 12, sum: 11, gap: 1, best_pair: "[1, 10]" } },
      { left: 1, right: 2, line: 7, title: "Return [1, 10]", desc: "The saved closest pair is returned.", state: { example: "values=[1, 4, 7, 10], target=12", target: 12, result: "[1, 10]" } },
    ], code);
  }

  if (family === "two-pointer-remove-pair") {
    const values = [1, 2, 4, 5];
    const code = [
      "start with the smallest and largest values",
      "add the active pair",
      "move left when the sum is too small",
      "move right when the sum is too large",
      "when the sum matches, remove both active values",
      "keep the remaining values in order",
      "return the remaining list",
    ];
    return build(values, [
      { left: 0, right: 3, line: 1, title: context.title || "Remove One Target Pair", desc: "The smallest and largest values are checked first because the list is sorted.", state: { example: "values=[1, 2, 4, 5], target=6", target: 6, result: "[1,2,4,5]" } },
      { left: 0, right: 3, line: 2, title: "Add 1 + 5", desc: "The active pair totals 6.", state: { example: "values=[1, 2, 4, 5], target=6", target: 6, sum: 6, decision: "match" } },
      { left: 0, right: 3, line: 5, title: "Remove the pair", desc: "Because 1 + 5 hits the target, remove those two active values.", state: { example: "values=[1, 2, 4, 5], target=6", target: 6, removed: "1 and 5", result: "[2,4]" } },
      { left: 1, right: 2, line: 6, title: "Keep middle values", desc: "The values between the removed pair stay in their original order.", state: { example: "values=[1, 2, 4, 5], target=6", target: 6, kept: "2, 4", result: "[2,4]" } },
      { left: 1, right: 2, line: 6, title: "No second removal", desc: "The prompt asks for the first target pair found, so the trace does not keep removing pairs.", state: { example: "values=[1, 2, 4, 5], target=6", target: 6, action: "stop after first pair", result: "[2,4]" } },
      { left: 1, right: 2, line: 7, title: "Return remaining list", desc: "Return only the numbers left after removing the matching pair.", state: { example: "values=[1, 2, 4, 5], target=6", target: 6, result: "[2,4]" } },
      { left: 1, right: 2, line: 7, title: "Trace complete", desc: "The compact example ends with [2, 4].", state: { example: "values=[1, 2, 4, 5], target=6", target: 6, final_result: "[2,4]" } },
    ], code);
  }

  const values = [1, 4, 6];
  const code = [
    "place one pointer at each needed side",
    "compare the two active values",
    "move the pointer chosen by the rule",
    "compare the new active pair",
    "save the match or best state",
    "stop when the pointers meet or cross",
    "return the result",
  ];
  return build(values, [
    { left: 0, right: 2, line: 1, title: context.title || "Two pointers", desc: "Start with one pointer on each side.", state: { example: "values=[1, 4, 6], target=7", target: 7, result: "none yet" } },
    { left: 0, right: 2, line: 2, title: "Compare 1 and 6", desc: "The active values are checked together before either pointer moves.", state: { example: "values=[1, 4, 6], target=7", target: 7, sum: 7, result: "match" } },
    { left: 0, right: 2, line: 5, title: "Save match", desc: "The active pair matches the target rule.", state: { example: "values=[1, 4, 6], target=7", target: 7, pair: "1 + 6", result: "match" } },
    { left: 0, right: 2, line: 7, title: "Return result", desc: "Return the problem's requested result from the saved state.", state: { example: "values=[1, 4, 6], target=7", target: 7, result: "match" } },
  ], code);
}

export function generateSlidingWindowSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("sliding-window", context);
  type WindowPhase = {
    window: [number, number];
    line: number;
    title: string;
    desc: string;
    state: Record<string, string | number | boolean>;
  };
  const build = (
    values: Array<string | number>,
    phases: WindowPhase[],
    code: string[],
  ): Step[] => phases.map((phase, index) => {
    const nodes = layoutArray(values).map((node, nodeIndex) => ({
      ...node,
      state: nodeIndex >= phase.window[0] && nodeIndex <= phase.window[1] ? "active" as const : "default" as const,
    }));
    const activeIds = nodes.filter((node) => node.state === "active").map((node) => node.id);
    return step({
      concept: "sliding-window",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: activeIds, lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: { window: `${phase.window[0]}-${phase.window[1]}`, window_start: phase.window[0], window_end: phase.window[1], ...phase.state },
    }, index + 1);
  });

  if (family === "sliding-window-short-blocks") {
    const values = [20, 30, 45];
    const code = ["choose the first two-session window", "add the two active sessions", "if total fits the limit, count it", "slide the window one step right", "reuse the old total instead of restarting", "check the new window", "return the count", "finish"];
    return build(values, [
      { window: [0, 1], line: 1, title: context.title || "Count Short Study Blocks", desc: "Start with the first two neighboring study sessions.", state: { example: "minutes=[20,30,45], limit=60", target: "count two-session windows within limit", limit: 60, total: 50, count: 0 } },
      { window: [0, 1], line: 2, title: "Add 20 + 30", desc: "The first window totals 50 minutes.", state: { example: "minutes=[20,30,45], limit=60", target: "count two-session windows within limit", total: 50, limit: 60, count: 0 } },
      { window: [0, 1], line: 3, title: "Count first window", desc: "50 is within the limit, so the count becomes 1.", state: { example: "minutes=[20,30,45], limit=60", target: "count two-session windows within limit", total: 50, count: 1, result: 1 } },
      { window: [1, 2], line: 4, title: "Slide right", desc: "The window drops 20 and includes 45.", state: { example: "minutes=[20,30,45], limit=60", target: "count two-session windows within limit", leaving: 20, entering: 45, count: 1 } },
      { window: [1, 2], line: 5, title: "Reuse total", desc: "Update the total from 50 to 75 instead of adding from scratch.", state: { example: "minutes=[20,30,45], limit=60", target: "count two-session windows within limit", total: 75, count: 1 } },
      { window: [1, 2], line: 6, title: "Check 75", desc: "75 is over the limit, so the count does not change.", state: { example: "minutes=[20,30,45], limit=60", target: "count two-session windows within limit", total: 75, decision: "too high", count: 1 } },
      { window: [1, 2], line: 7, title: "Return 1", desc: "Only one two-session window fits within 60 minutes.", state: { example: "minutes=[20,30,45], limit=60", target: "count two-session windows within limit", result: 1 } },
      { window: [1, 2], line: 8, title: "Trace complete", desc: "The compact trace ends with the same count the prompt asks for.", state: { example: "minutes=[20,30,45], limit=60", target: "count two-session windows within limit", final_result: 1 } },
    ], code);
  }

  if (family === "sliding-window-three-day") {
    const values = [30, 45, 25, 20];
    const code = ["choose the first three-day window", "add the active days", "save that total", "slide one day right", "subtract the day that left", "add the day that entered", "save the next total", "return all totals"];
    return build(values, [
      { window: [0, 2], line: 1, title: context.title || "Three Day Study Totals", desc: "The first fixed-size window covers days 0 through 2.", state: { example: "minutes=[30,45,25,20]", target: "totals for every three-day stretch", total: 100, result: "[]" } },
      { window: [0, 2], line: 2, title: "Add first three days", desc: "30 + 45 + 25 gives the first three-day total.", state: { example: "minutes=[30,45,25,20]", target: "totals for every three-day stretch", total: 100 } },
      { window: [0, 2], line: 3, title: "Save 100", desc: "The first window total is stored in the result list.", state: { example: "minutes=[30,45,25,20]", target: "totals for every three-day stretch", total: 100, result: "[100]" } },
      { window: [1, 3], line: 4, title: "Slide to days 1-3", desc: "The window moves one day right.", state: { example: "minutes=[30,45,25,20]", target: "totals for every three-day stretch", leaving: 30, entering: 20, result: "[100]" } },
      { window: [1, 3], line: 5, title: "Subtract 30", desc: "Remove the day that left the window.", state: { example: "minutes=[30,45,25,20]", target: "totals for every three-day stretch", total: 70, result: "[100]" } },
      { window: [1, 3], line: 6, title: "Add 20", desc: "Add the day that entered to get the new total.", state: { example: "minutes=[30,45,25,20]", target: "totals for every three-day stretch", total: 90, result: "[100]" } },
      { window: [1, 3], line: 7, title: "Save 90", desc: "The second three-day total is stored.", state: { example: "minutes=[30,45,25,20]", target: "totals for every three-day stretch", total: 90, result: "[100,90]" } },
      { window: [1, 3], line: 8, title: "Return totals", desc: "Return both three-day totals in order.", state: { example: "minutes=[30,45,25,20]", target: "totals for every three-day stretch", result: "[100,90]" } },
    ], code);
  }

  if (family === "sliding-window-calm-two-day") {
    const values = [40, 25, 50];
    const code = ["choose the first two-day window", "add the active days", "if total is within limit, save true", "otherwise slide right", "check the next two-day window", "stop once true is known", "return the boolean result", "finish"];
    return build(values, [
      { window: [0, 1], line: 1, title: context.title || "Any Calm Two Day Stretch", desc: "Start with the first neighboring pair.", state: { example: "minutes=[40,25,50], limit=70", target: "return true if any two-day total fits", limit: 70, total: 65, result: "none yet" } },
      { window: [0, 1], line: 2, title: "Add 40 + 25", desc: "The first two-day window totals 65.", state: { example: "minutes=[40,25,50], limit=70", target: "return true if any two-day total fits", total: 65, limit: 70 } },
      { window: [0, 1], line: 3, title: "65 fits", desc: "65 is at or below 70, so the answer is true.", state: { example: "minutes=[40,25,50], limit=70", target: "return true if any two-day total fits", decision: "fits", result: "true" } },
      { window: [0, 1], line: 6, title: "Stop early", desc: "A true answer cannot be made false by later windows.", state: { example: "minutes=[40,25,50], limit=70", target: "return true if any two-day total fits", action: "true found", result: "true" } },
      { window: [1, 2], line: 4, title: "Next window skipped", desc: "The window [25, 50] exists, but it is not needed after true is known.", state: { example: "minutes=[40,25,50], limit=70", target: "return true if any two-day total fits", skipped: "25 + 50", result: "true" } },
      { window: [0, 1], line: 6, title: "Keep boolean true", desc: "The saved boolean answer remains true.", state: { example: "minutes=[40,25,50], limit=70", target: "return true if any two-day total fits", result: "true" } },
      { window: [0, 1], line: 7, title: "Return true", desc: "Return a real boolean value, not the word as plain text.", state: { example: "minutes=[40,25,50], limit=70", target: "return true if any two-day total fits", result: "true" } },
      { window: [0, 1], line: 8, title: "Trace complete", desc: "The compact example has at least one calm two-day stretch.", state: { example: "minutes=[40,25,50], limit=70", target: "return true if any two-day total fits", final_result: "true" } },
    ], code);
  }

  if (family === "sliding-window-longest-unique") {
    const values = ["a", "b", "c", "a", "b", "c", "b", "b"];
    const code = ["start with an empty seen window", "expand right while characters are new", "save the longest length", "when a repeat appears, move left", "remove old characters until repeat is gone", "continue expanding", "return the best length", "finish"];
    return build(values, [
      { window: [0, 0], line: 1, title: context.title || "Longest Unique Window", desc: "Begin the window at the first character.", state: { example: "abcabcbb", target: "longest substring with no repeats", seen: "a", best: 1 } },
      { window: [0, 1], line: 2, title: "Expand to b", desc: "b is not in the window, so it can join.", state: { example: "abcabcbb", target: "longest substring with no repeats", seen: "a,b", best: 2 } },
      { window: [0, 2], line: 3, title: "Save abc", desc: "abc has three unique characters, so best becomes 3.", state: { example: "abcabcbb", target: "longest substring with no repeats", seen: "a,b,c", best: 3, result: 3 } },
      { window: [0, 3], line: 4, title: "Repeat a appears", desc: "The right edge sees another a, which breaks the unique rule.", state: { example: "abcabcbb", target: "longest substring with no repeats", repeat: "a", best: 3 } },
      { window: [1, 3], line: 5, title: "Move left past old a", desc: "Remove the earlier a so the current window can be unique again.", state: { example: "abcabcbb", target: "longest substring with no repeats", seen: "b,c,a", best: 3 } },
      { window: [2, 4], line: 6, title: "Continue pattern", desc: "The same expand-and-shrink rule keeps the window unique.", state: { example: "abcabcbb", target: "longest substring with no repeats", window_text: "cab", best: 3 } },
      { window: [2, 4], line: 7, title: "Return 3", desc: "No later unique window beats length 3.", state: { example: "abcabcbb", target: "longest substring with no repeats", best: 3, result: 3 } },
      { window: [2, 4], line: 8, title: "Trace complete", desc: "The longest unique substring length is 3.", state: { example: "abcabcbb", target: "longest substring with no repeats", final_result: 3 } },
    ], code);
  }

  if (family === "sliding-window-average") {
    const values = [1, 2, 3, 4];
    const code = ["choose the first size-k window", "add the active values", "divide by k and save average", "slide one step right", "subtract leaving value", "add entering value", "save the next average", "return all averages"];
    return build(values, [
      { window: [0, 1], line: 1, title: context.title || "Window Average", desc: "For k = 2, the first window covers values 1 and 2.", state: { example: "values=[1,2,3,4], k=2", target: "average for every size-2 window", k: 2, total: 3, result: "[]" } },
      { window: [0, 1], line: 2, title: "Add 1 + 2", desc: "The first window total is 3.", state: { example: "values=[1,2,3,4], k=2", target: "average for every size-2 window", total: 3 } },
      { window: [0, 1], line: 3, title: "Save 1.5", desc: "3 divided by k=2 gives 1.5.", state: { example: "values=[1,2,3,4], k=2", target: "average for every size-2 window", average: 1.5, result: "[1.5]" } },
      { window: [1, 2], line: 4, title: "Slide to 2 and 3", desc: "The window drops 1 and includes 3.", state: { example: "values=[1,2,3,4], k=2", target: "average for every size-2 window", leaving: 1, entering: 3, result: "[1.5]" } },
      { window: [1, 2], line: 6, title: "Save 2.5", desc: "The updated total is 5, so the average is 2.5.", state: { example: "values=[1,2,3,4], k=2", target: "average for every size-2 window", total: 5, average: 2.5, result: "[1.5,2.5]" } },
      { window: [2, 3], line: 4, title: "Slide to 3 and 4", desc: "Move one step again without recalculating from scratch.", state: { example: "values=[1,2,3,4], k=2", target: "average for every size-2 window", leaving: 2, entering: 4, result: "[1.5,2.5]" } },
      { window: [2, 3], line: 7, title: "Save 3.5", desc: "The last window average is 3.5.", state: { example: "values=[1,2,3,4], k=2", target: "average for every size-2 window", average: 3.5, result: "[1.5,2.5,3.5]" } },
      { window: [2, 3], line: 8, title: "Return averages", desc: "Return the averages in window order.", state: { example: "values=[1,2,3,4], k=2", target: "average for every size-2 window", result: "[1.5,2.5,3.5]" } },
    ], code);
  }

  if (family === "sliding-window-max-sum") {
    const values = [2, 1, 5, 1, 3];
    const code = ["choose the first size-k window", "add the active values", "save the first sum as best", "slide one step right", "update total by leaving and entering values", "if total is larger, update best", "repeat for remaining windows", "return best sum"];
    return build(values, [
      { window: [0, 2], line: 1, title: context.title || "Maximum Window Sum", desc: "For k = 3, start with 2, 1, and 5.", state: { example: "values=[2,1,5,1,3], k=3", target: "largest size-3 window sum", k: 3, total: 8, best: 0 } },
      { window: [0, 2], line: 2, title: "Add first window", desc: "2 + 1 + 5 totals 8.", state: { example: "values=[2,1,5,1,3], k=3", target: "largest size-3 window sum", total: 8 } },
      { window: [0, 2], line: 3, title: "Best starts at 8", desc: "The first complete window becomes the best so far.", state: { example: "values=[2,1,5,1,3], k=3", target: "largest size-3 window sum", total: 8, best: 8, result: 8 } },
      { window: [1, 3], line: 4, title: "Slide to 1,5,1", desc: "Drop 2 and include the next 1.", state: { example: "values=[2,1,5,1,3], k=3", target: "largest size-3 window sum", leaving: 2, entering: 1, best: 8 } },
      { window: [1, 3], line: 5, title: "Total becomes 7", desc: "The new window total is lower, so best stays 8.", state: { example: "values=[2,1,5,1,3], k=3", target: "largest size-3 window sum", total: 7, best: 8 } },
      { window: [2, 4], line: 4, title: "Slide to 5,1,3", desc: "Drop 1 and include 3 for the final window.", state: { example: "values=[2,1,5,1,3], k=3", target: "largest size-3 window sum", leaving: 1, entering: 3, best: 8 } },
      { window: [2, 4], line: 6, title: "Update best to 9", desc: "5 + 1 + 3 totals 9, which beats the old best.", state: { example: "values=[2,1,5,1,3], k=3", target: "largest size-3 window sum", total: 9, best: 9, result: 9 } },
      { window: [2, 4], line: 8, title: "Return 9", desc: "The largest size-3 window sum is 9.", state: { example: "values=[2,1,5,1,3], k=3", target: "largest size-3 window sum", result: 9 } },
    ], code);
  }

  if (family === "sliding-window-min-study") {
    const values = [10, 20, 30, 40];
    const code = ["expand right until total reaches target", "add each entering session", "when total is enough, save window length", "shrink from the left to try shorter", "keep the shortest length seen", "continue until right reaches the end", "return shortest length or 0", "finish"];
    return build(values, [
      { window: [0, 0], line: 1, title: context.title || "Minimum Study Window", desc: "Start growing a window until it can reach target 70.", state: { example: "minutes=[10,20,30,40], target=70", target: 70, total: 10, best_length: "none" } },
      { window: [0, 1], line: 2, title: "Grow to 30", desc: "Add 20. The total is still below target.", state: { example: "minutes=[10,20,30,40], target=70", target: 70, total: 30, best_length: "none" } },
      { window: [0, 2], line: 2, title: "Grow to 60", desc: "Add 30. Still not enough.", state: { example: "minutes=[10,20,30,40], target=70", target: 70, total: 60, best_length: "none" } },
      { window: [0, 3], line: 3, title: "Reach 100", desc: "Add 40. Now the window reaches the target, so save length 4.", state: { example: "minutes=[10,20,30,40], target=70", target: 70, total: 100, best_length: 4, result: 4 } },
      { window: [1, 3], line: 4, title: "Shrink from left", desc: "Remove 10 and keep checking because the total is still at least 70.", state: { example: "minutes=[10,20,30,40], target=70", target: 70, total: 90, best_length: 3, result: 3 } },
      { window: [2, 3], line: 5, title: "Shrink again", desc: "Remove 20. The window [30, 40] still reaches 70, so length 2 is best.", state: { example: "minutes=[10,20,30,40], target=70", target: 70, total: 70, best_length: 2, result: 2 } },
      { window: [3, 3], line: 6, title: "Too short after shrink", desc: "Removing 30 leaves only 40, which is below target, so stop shrinking.", state: { example: "minutes=[10,20,30,40], target=70", target: 70, total: 40, best_length: 2 } },
      { window: [2, 3], line: 7, title: "Return 2", desc: "The shortest window that reaches 70 has length 2.", state: { example: "minutes=[10,20,30,40], target=70", target: 70, result: 2 } },
    ], code);
  }

  if (family === "sliding-window-longest-under-limit") {
    const values = [20, 30, 10, 40];
    const code = ["expand right to grow the study stretch", "add the entering minutes", "if total is within limit, update best length", "if total is too high, remove from the left", "slide left until the limit fits again", "continue growing", "return the longest saved length", "finish"];
    return build(values, [
      { window: [0, 0], line: 1, title: context.title || "Longest Study Stretch Under Limit", desc: "Start with the first study session and grow while the total fits.", state: { example: "minutes=[20,30,10,40], limit=60", target: "longest stretch with total at most limit", limit: 60, total: 20, best: 1 } },
      { window: [0, 1], line: 2, title: "Add 30", desc: "20 + 30 totals 50, still within the limit.", state: { example: "minutes=[20,30,10,40], limit=60", target: "longest stretch with total at most limit", total: 50, best: 2 } },
      { window: [0, 2], line: 3, title: "Add 10 and save 3", desc: "The total becomes 60, so a length-3 stretch fits exactly.", state: { example: "minutes=[20,30,10,40], limit=60", target: "longest stretch with total at most limit", total: 60, best: 3, result: 3 } },
      { window: [0, 3], line: 2, title: "Add 40", desc: "Growing to include 40 makes the total 100, which is too high.", state: { example: "minutes=[20,30,10,40], limit=60", target: "longest stretch with total at most limit", total: 100, decision: "too high", best: 3 } },
      { window: [1, 3], line: 4, title: "Remove 20", desc: "Slide the left edge forward to lower the total.", state: { example: "minutes=[20,30,10,40], limit=60", target: "longest stretch with total at most limit", leaving: 20, total: 80, best: 3 } },
      { window: [2, 3], line: 5, title: "Remove 30", desc: "The total is now 50, so the window fits again.", state: { example: "minutes=[20,30,10,40], limit=60", target: "longest stretch with total at most limit", leaving: 30, total: 50, best: 3 } },
      { window: [2, 3], line: 6, title: "Best stays 3", desc: "The current fitting stretch has length 2, so it does not beat 3.", state: { example: "minutes=[20,30,10,40], limit=60", target: "longest stretch with total at most limit", total: 50, best: 3 } },
      { window: [0, 2], line: 7, title: "Return 3", desc: "The longest stretch under the limit is the first three sessions.", state: { example: "minutes=[20,30,10,40], limit=60", target: "longest stretch with total at most limit", result: 3 } },
    ], code);
  }

  const values = [2, 4, 1, 5];
  const code = ["start with an empty window", "add the right item", "measure the current window", "update the best answer", "slide left when the rule says to", "repeat the same window rule", "return the best value", "finish"];
  return build(values, [
    { window: [0, 0], line: 1, title: context.title || "Sliding window", desc: "Start with both edges at the first value.", state: { example: "values=[2,4,1,5]", target: "track a moving window", total: 2, best: 0 } },
    { window: [0, 0], line: 2, title: "Add 2", desc: "The right edge brings one value into the window.", state: { example: "values=[2,4,1,5]", target: "track a moving window", total: 2, best: 0 } },
    { window: [0, 1], line: 3, title: "Grow to 2,4", desc: "The window expands without restarting the count.", state: { example: "values=[2,4,1,5]", target: "track a moving window", total: 6, best: 6 } },
    { window: [0, 1], line: 4, title: "Save best", desc: "The current window becomes the best seen so far.", state: { example: "values=[2,4,1,5]", target: "track a moving window", total: 6, best: 6, result: 6 } },
    { window: [1, 2], line: 5, title: "Slide left", desc: "The left edge moves so the next window reuses the prior state.", state: { example: "values=[2,4,1,5]", target: "track a moving window", total: 5, best: 6 } },
    { window: [1, 3], line: 6, title: "Repeat", desc: "Grow and check again with the same rule.", state: { example: "values=[2,4,1,5]", target: "track a moving window", total: 10, best: 10 } },
    { window: [1, 3], line: 7, title: "Return best", desc: "Return the saved best value.", state: { example: "values=[2,4,1,5]", target: "track a moving window", result: 10 } },
    { window: [1, 3], line: 8, title: "Trace complete", desc: "The sliding-window pattern is ready to apply to the full prompt.", state: { example: "values=[2,4,1,5]", target: "track a moving window", final_result: 10 } },
  ], code);
}

export function generateRecursionSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("recursion", context);
  if (family === "recursion-nested-list") return generateNestedRecursionSteps(context);
  const configs: Partial<Record<VisualizerFamily, {
    example: string;
    target: string;
    calls: string[];
    baseText: string;
    returnValues: string[];
    returnSteps: string[];
    code: string[];
    ownValue: string[];
    smallerValue: string[];
    finalResult: string;
  }>> = {
    "recursion-countdown-list": {
      example: "countdown(2)",
      target: "return [2, 1, 0]",
      calls: ["countdown(2)", "countdown(1)", "countdown(0)"],
      baseText: "n == 0",
      returnValues: ["[0]", "[1, 0]", "[2, 1, 0]"],
      returnSteps: ["base gives [0]", "1 + [0] gives [1, 0]", "2 + [1, 0] gives [2, 1, 0]"],
      code: ["start a countdown call with n", "base case: when n is 0, return the base list", "ask a smaller countdown call for help", "answer = [n] + smaller", "send the answer back up", "pause the current call on the stack", "return the base value", "combine the current call with the smaller answer", "return the combined answer"],
      ownValue: ["2", "1"],
      smallerValue: ["[1, 0]", "[0]"],
      finalResult: "[2, 1, 0]",
    },
    "recursion-factorial": {
      example: "factorial(3)",
      target: "return 6",
      calls: ["factorial(3)", "factorial(2)", "factorial(1)"],
      baseText: "n == 1",
      returnValues: ["1", "2", "6"],
      returnSteps: ["base gives 1", "2 x 1 gives 2", "3 x 2 gives 6"],
      code: ["start a factorial call with n", "base case: when n is 1, return 1", "ask a smaller factorial call for help", "answer = n * smaller", "send the answer back up", "pause the current call on the stack", "return the base value", "multiply the current n by the smaller answer", "return the combined answer"],
      ownValue: ["3", "2"],
      smallerValue: ["2", "1"],
      finalResult: "6",
    },
    "recursion-list-count": {
      example: "count([5,6])",
      target: "return 2",
      calls: ["count([5,6])", "count([6])", "count([])"],
      baseText: "list empty",
      returnValues: ["0", "1", "2"],
      returnSteps: ["empty list gives 0", "count [6] gives 1", "count [5,6] gives 2"],
      code: ["start a count call with the list", "base case: when the list is empty, return 0", "ask for the count of the rest", "answer = 1 + smaller", "send the answer back up", "pause the current call on the stack", "return the base value", "add one item to the smaller count", "return the combined answer"],
      ownValue: ["5", "6"],
      smallerValue: ["1", "0"],
      finalResult: "2",
    },
    "recursion-list-sum": {
      example: "sum([2,5])",
      target: "return 7",
      calls: ["sum([2,5])", "sum([5])", "sum([])"],
      baseText: "list empty",
      returnValues: ["0", "5", "7"],
      returnSteps: ["empty list gives 0", "5 + 0 gives 5", "2 + 5 gives 7"],
      code: ["start a sum call with the list", "base case: when the list is empty, return 0", "ask for the sum of the rest", "answer = first + smaller", "send the answer back up", "pause the current call on the stack", "return the base value", "add the current first value to the smaller sum", "return the combined answer"],
      ownValue: ["2", "5"],
      smallerValue: ["5", "0"],
      finalResult: "7",
    },
    "recursion-digit-sum": {
      example: "digit_sum(34)",
      target: "return 7",
      calls: ["digit_sum(34)", "digit_sum(3)", "digit_sum(0)"],
      baseText: "number == 0",
      returnValues: ["0", "3", "7"],
      returnSteps: ["base gives 0", "3 + 0 gives 3", "4 + 3 gives 7"],
      code: ["start a digit-sum call with the number", "base case: when the number is 0, return 0", "ask for the digit sum of the number without its last digit", "answer = last digit + smaller", "send the answer back up", "pause the current call on the stack", "return the base value", "add the current last digit to the smaller sum", "return the combined answer"],
      ownValue: ["4", "3"],
      smallerValue: ["3", "0"],
      finalResult: "7",
    },
    "recursion-power": {
      example: "power(2,2)",
      target: "return 4",
      calls: ["power(2,2)", "power(2,1)", "power(2,0)"],
      baseText: "exponent == 0",
      returnValues: ["1", "2", "4"],
      returnSteps: ["base gives 1", "2 x 1 gives 2", "2 x 2 gives 4"],
      code: ["start a power call with base and exponent", "base case: when exponent is 0, return 1", "ask for power with one smaller exponent", "answer = base * smaller", "send the answer back up", "pause the current call on the stack", "return the base value", "multiply by the base as the calls return", "return the combined answer"],
      ownValue: ["2", "2"],
      smallerValue: ["2", "1"],
      finalResult: "4",
    },
    "recursion-reverse-text": {
      example: "reverse('go')",
      target: "return 'og'",
      calls: ["reverse(go)", "reverse(o)", "reverse()"],
      baseText: "text empty",
      returnValues: ["''", "'o'", "'og'"],
      returnSteps: ["empty text gives ''", "'' + o gives 'o'", "'o' + g gives 'og'"],
      code: ["start a reverse call with the text", "base case: when text is empty, return empty text", "ask for the reverse of the rest", "answer = smaller + first character", "send the answer back up", "pause the current call on the stack", "return the base value", "place the current first character after the smaller answer", "return the combined answer"],
      ownValue: ["g", "o"],
      smallerValue: ["'o'", "''"],
      finalResult: "'og'",
    },
  };
  const config = configs[family] || configs["recursion-countdown-list"]!;
  const code = config.code;
  const returnSteps = config.returnSteps.join("|");
  const callFrame = (id: string, y: number, label: string, value: string, state: Node["state"] = "default"): Node => ({
    id,
    x: 360,
    y,
    value,
    type: "logic-node",
    label,
    state,
    meta: { role: "call-frame" },
  });
  const build = (visibleCalls: number, activeIndex: number, baseState: Node["state"], resultValue: string, resultState: Node["state"]): { nodes: Node[]; edges: Edge[]; highlights: string[] } => {
    const isDone = activeIndex < 0;
    const callState = (index: number): Node["state"] => {
      if (isDone || index > activeIndex) return "visited";
      if (index === activeIndex) return "active";
      return "visited";
    };
    const callLabel = (index: number): string => {
      if (isDone) return "returned";
      if (index === activeIndex) return "current call";
      if (index < activeIndex) return "waiting";
      return "returned";
    };
    const allCalls = config.calls.map((value, callIndex) => (
      callFrame(`call-${callIndex}`, 115 + callIndex * 90, callLabel(callIndex), value, callState(callIndex))
    )).slice(0, visibleCalls);
    const nodes: Node[] = [
      ...allCalls,
      { id: "base-case", x: 650, y: 175, value: baseState === "active" || baseState === "visited" ? config.baseText : "not yet", type: "logic-node", label: "base case", state: baseState, meta: { role: "base-case" } },
      { id: "return-chain", x: 650, y: 335, value: resultValue, type: "logic-node", label: "return value", state: resultState, meta: { role: "result" } },
    ];
    const edges: Edge[] = allCalls.slice(0, -1).map((node, edgeIndex) => ({
      id: `${node.id}-${allCalls[edgeIndex + 1].id}`,
      from: node.id,
      to: allCalls[edgeIndex + 1].id,
      type: "pointer",
      state: edgeIndex < visibleCalls - 1 ? "active" : "default",
    }));
    if (allCalls.length) edges.push({ id: "call-base", from: allCalls[allCalls.length - 1].id, to: "base-case", type: "branch", state: baseState === "active" || baseState === "visited" ? "active" : "default" });
    edges.push({ id: "base-return", from: "base-case", to: "return-chain", type: "branch", state: resultState === "active" || resultState === "matched" ? "active" : "default" });
    const activeCallId = activeIndex >= 0 ? allCalls[Math.max(0, Math.min(activeIndex, allCalls.length - 1))]?.id : "";
    const highlights = [
      ...(activeCallId ? [activeCallId] : []),
      ...(baseState === "active" ? ["base-case"] : []),
      ...(resultState === "active" || resultState === "matched" ? ["return-chain"] : []),
    ];
    return { nodes, edges, highlights };
  };
  const phases = [
    { visible: 1, active: 0, base: "default" as const, ret: "not returned yet", retState: "default" as const, title: context.title || `Call ${config.calls[0]}`, desc: `Use a tiny example: ${config.example}. The first call must decide whether it can answer now.`, line: 1, state: { phase: "call", current_call: config.calls[0], waiting: "none", action: "start first call", return_value: "not returned yet", return_step_index: -1 } },
    { visible: 1, active: 0, base: "default" as const, ret: "not returned yet", retState: "default" as const, title: "Check first call", desc: `The first call is not at ${config.baseText}, so it asks a smaller call for help.`, line: 2, state: { phase: "base check", current_call: config.calls[0], waiting: "none", action: "not base case", return_value: "not returned yet", return_step_index: -1 } },
    { visible: 2, active: 1, base: "default" as const, ret: "not returned yet", retState: "default" as const, title: `Call ${config.calls[1]}`, desc: `${config.calls[0]} pauses and waits while ${config.calls[1]} starts.`, line: 3, state: { phase: "smaller call", current_call: config.calls[1], waiting: config.calls[0], action: "push smaller call", return_value: "not returned yet", return_step_index: -1 } },
    { visible: 2, active: 1, base: "default" as const, ret: "not returned yet", retState: "default" as const, title: "Check smaller call", desc: `This call is still not at ${config.baseText}, so it asks for one more smaller answer.`, line: 2, state: { phase: "base check", current_call: config.calls[1], waiting: config.calls[0], action: "ask again", return_value: "not returned yet", return_step_index: -1 } },
    { visible: 3, active: 2, base: "active" as const, ret: "not returned yet", retState: "default" as const, title: `Reach ${config.calls[2]}`, desc: `Now the active call matches the base case: ${config.baseText}. Recursion stops going deeper.`, line: 2, state: { phase: "base case", current_call: config.calls[2], waiting: "2 calls waiting", action: "base case found", return_value: "not returned yet", return_step_index: -1 } },
    { visible: 3, active: 2, base: "visited" as const, ret: config.returnValues[0], retState: "active" as const, title: "Return base value", desc: `The base call returns ${config.returnValues[0]}. Now the answer starts moving back up the stack.`, line: 7, state: { phase: "return", current_call: config.calls[2], waiting: "2 calls waiting", action: `send ${config.returnValues[0]} back up`, return_value: config.returnValues[0], return_step_index: 0 } },
    { visible: 3, active: 1, base: "visited" as const, ret: config.returnValues[1], retState: "active" as const, title: `Unwind to ${config.calls[1]}`, desc: `${config.calls[1]} receives ${config.smallerValue[1]}, combines its own ${config.ownValue[1]}, and returns ${config.returnValues[1]}.`, line: 8, state: { phase: "unwind", current_call: config.calls[1], waiting: config.calls[0], action: `${config.ownValue[1]} with ${config.smallerValue[1]}`, return_value: config.returnValues[1], return_step_index: 1 } },
    { visible: 3, active: 0, base: "visited" as const, ret: config.returnValues[2], retState: "active" as const, title: `Unwind to ${config.calls[0]}`, desc: `${config.calls[0]} receives ${config.smallerValue[0]}, combines its own ${config.ownValue[0]}, and returns ${config.returnValues[2]}.`, line: 8, state: { phase: "unwind", current_call: config.calls[0], waiting: "none", action: `${config.ownValue[0]} with ${config.smallerValue[0]}`, return_value: config.returnValues[2], return_step_index: 2 } },
    { visible: 3, active: -1, base: "visited" as const, ret: config.returnValues[2], retState: "matched" as const, title: "Finish recursion", desc: "The first call has returned, so the recursive trace is complete.", line: 9, state: { phase: "done", current_call: "none", waiting: "none", action: "all frames returned", result: config.finalResult, return_step_index: 2 } },
  ];
  return phases.map((phase, index) => {
    const visual = build(phase.visible, phase.active, phase.base, phase.ret, phase.retState);
    return step({
      concept: "recursion",
      title: phase.title,
      description: phase.desc,
      nodes: visual.nodes,
      edges: visual.edges,
      highlights: { nodeIds: visual.highlights, edgeIds: visual.edges.filter((edge) => edge.state === "active").map((edge) => edge.id || `${edge.from}-${edge.to}`), lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: { example: config.example, target: config.target, return_steps: returnSteps, ...phase.state },
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
  const code = ["rows = number of grid rows", "cols = number of grid columns", "for each row from top to bottom", "for each col from left to right", "value = grid[row][col]", "answer = update(answer, value)", "move to the next cell", "return answer"];
  const values = [1, 2, 3, 4, 5, 6];
  const nodes = values.map((value, index) => ({ id: `cell-${index}`, x: 350 + (index % 3) * 96, y: 180 + Math.floor(index / 3) * 96, value, type: "array-cell" as const, label: `${Math.floor(index / 3)},${index % 3}` }));
  const phases = [
    { cell: 0, title: context.title || "Read matrix shape", desc: "Start with a tiny 2 by 3 grid. A matrix scan needs both a row loop and a column loop.", line: 1, state: { example: "grid=[[1,2,3],[4,5,6]]", target: "visit every cell once", row: 0, column: 0, action: "Rows choose which horizontal strip to scan; columns choose the cell inside that row.", progress: "0 of 6 cells", answer: "empty" } },
    { cell: 0, title: "Start row 0", desc: "The outer loop chooses row 0. Nothing moves across columns until this row is selected.", line: 3, state: { example: "grid=[[1,2,3],[4,5,6]]", target: "visit every cell once", row: 0, column: 0, action: "Pick the row first so the inner loop knows which row it belongs to.", progress: "row 0 started", answer: "empty" } },
    { cell: 0, title: "Read cell 0,0", desc: "The inner loop chooses column 0, so the active address is grid[0][0].", line: 5, state: { example: "grid=[[1,2,3],[4,5,6]]", target: "visit every cell once", row: 0, column: 0, value: 1, action: "Read grid[0][0] before changing the running answer.", progress: "1 of 6 cells", answer: 1 } },
    { cell: 1, title: "Move to cell 0,1", desc: "Column advances inside the same row. The row stays 0 while the column changes.", line: 7, state: { example: "grid=[[1,2,3],[4,5,6]]", target: "visit every cell once", row: 0, column: 1, value: 2, action: "Move across the row one column at a time.", progress: "2 of 6 cells", answer: "updated with 2" } },
    { cell: 2, title: "Finish row 0", desc: "Column 2 is the last cell in row 0, so the next move will leave this row.", line: 6, state: { example: "grid=[[1,2,3],[4,5,6]]", target: "visit every cell once", row: 0, column: 2, value: 3, action: "Use the last value in row 0, then prepare to reset the column.", progress: "3 of 6 cells", answer: "row 0 done" } },
    { cell: 3, title: "Drop to row 1", desc: "The row increases to 1 and the column resets to 0. That is the nested-loop turn.", line: 3, state: { example: "grid=[[1,2,3],[4,5,6]]", target: "visit every cell once", row: 1, column: 0, value: 4, action: "When a row ends, move down one row and restart at column 0.", progress: "4 of 6 cells", answer: "row 1 started" } },
    { cell: 4, title: "Continue across row 1", desc: "The scan repeats the same left-to-right pattern on the new row.", line: 5, state: { example: "grid=[[1,2,3],[4,5,6]]", target: "visit every cell once", row: 1, column: 1, value: 5, action: "The same cell rule applies: read grid[row][col], then update.", progress: "5 of 6 cells", answer: "updated with 5" } },
    { cell: 5, title: "Return after last cell", desc: "After grid[1][2], every cell in the 2 by 3 matrix has been visited exactly once.", line: 8, state: { example: "grid=[[1,2,3],[4,5,6]]", target: "visit every cell once", row: 1, column: 2, value: 6, action: "The scan stops after the final row and final column are handled.", progress: "6 of 6 cells", result: "answer" } },
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
  const family = detectVisualizerFamily("prefix-sum", context);
  type PrefixPhase = {
    active: number;
    prefixActive?: number;
    prefixValues: Array<string | number>;
    title: string;
    desc: string;
    line: number;
    state: Record<string, string | number | boolean>;
  };
  const build = (
    values: Array<string | number>,
    phases: PrefixPhase[],
    code: string[],
    prefixLabel = "sum",
  ): Step[] => phases.map((phase, index) => {
    const stepNodes: Node[] = [];
    values.forEach((value, nodeIndex) => {
      const x = 170 + nodeIndex * Math.min(94, 600 / Math.max(values.length - 1, 1));
      stepNodes.push({
        id: `num-${nodeIndex}`,
        x,
        y: 205,
        value,
        type: "array-cell",
        label: `num ${nodeIndex}`,
        state: nodeIndex === phase.active ? "active" : nodeIndex < phase.active ? "visited" : "default",
        meta: { role: "compact-cell" },
      });
      stepNodes.push({
        id: `prefix-${nodeIndex}`,
        x,
        y: 330,
        value: phase.prefixValues[nodeIndex] ?? "",
        type: "array-cell",
        label: `${prefixLabel} ${nodeIndex}`,
        state: nodeIndex === (phase.prefixActive ?? phase.active) ? "active" : phase.prefixValues[nodeIndex] === "" ? "inactive" : "visited",
        meta: { role: "prefix-cell" },
      });
    });
    const highlights = [`num-${phase.active}`, `prefix-${phase.prefixActive ?? phase.active}`].filter((id) => stepNodes.some((node) => node.id === id));
    return step({
      concept: "prefix-sum",
      title: phase.title,
      description: phase.desc,
      nodes: stepNodes,
      edges: [],
      highlights: { nodeIds: highlights, lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: phase.state,
    }, index + 1);
  });

  if (family === "prefix-running-totals") {
    const values = [2, 4, 1];
    const code = ["start the running total at 0", "add the current number", "save that total in the same index", "move to the next number", "repeat add and save", "read the finished saved totals", "return the saved list", "finish"];
    return build(values, [
      { active: 0, prefixValues: ["", "", ""], line: 1, title: context.title || "Running Prefix Totals", desc: "Start before any values are added.", state: { example: "nums=[2,4,1]", target: "running total after each number", running_total: 0, result: "[]" } },
      { active: 0, prefixValues: [2, "", ""], line: 2, title: "Add 2", desc: "The first running total is just the first value.", state: { example: "nums=[2,4,1]", target: "running total after each number", current: 2, running_total: 2, result: "[2]" } },
      { active: 1, prefixValues: [2, "", ""], line: 4, title: "Move to 4", desc: "Keep the saved total 2 and read the next value.", state: { example: "nums=[2,4,1]", target: "running total after each number", current: 4, running_total: 2, result: "[2]" } },
      { active: 1, prefixValues: [2, 6, ""], line: 3, title: "Save 6", desc: "2 + 4 gives the prefix total through index 1.", state: { example: "nums=[2,4,1]", target: "running total after each number", running_total: 6, result: "[2,6]" } },
      { active: 2, prefixValues: [2, 6, ""], line: 4, title: "Move to 1", desc: "The running total carries forward to the last value.", state: { example: "nums=[2,4,1]", target: "running total after each number", current: 1, running_total: 6, result: "[2,6]" } },
      { active: 2, prefixValues: [2, 6, 7], line: 5, title: "Save 7", desc: "6 + 1 gives the final saved prefix total.", state: { example: "nums=[2,4,1]", target: "running total after each number", running_total: 7, result: "[2,6,7]" } },
      { active: 2, prefixValues: [2, 6, 7], line: 7, title: "Return saved list", desc: "The answer is every running total in order.", state: { example: "nums=[2,4,1]", target: "running total after each number", result: "[2,6,7]" } },
      { active: 2, prefixValues: [2, 6, 7], line: 8, title: "Trace complete", desc: "Each output cell matches the sum from index 0 through that position.", state: { example: "nums=[2,4,1]", target: "running total after each number", final_result: "[2,6,7]" } },
    ], code);
  }

  if (family === "prefix-single-range") {
    const isOneRange = /one range sum/i.test(context.title || "");
    const values = isOneRange ? [2, 4, 1, 3] : [2, 4, 1, 5];
    const example = isOneRange ? "nums=[2,4,1,3], left=1, right=2" : "nums=[2,4,1,5], left=1, right=3";
    const rightTotal = isOneRange ? 7 : 12;
    const answer = isOneRange ? 5 : 10;
    const code = ["build saved prefix totals", "read the total at the right edge", "read the total before the left edge", "subtract the before-left total", "the difference is the inclusive range", "save the range sum", "return the range sum", "finish"];
    return build(values, [
      { active: 0, prefixValues: [2, "", "", ""], line: 1, title: context.title || "Range Sum", desc: "Prefix totals let a range answer use two saved numbers.", state: { example, target: "inclusive range sum", running_total: 2, result: "none yet" } },
      { active: 1, prefixValues: [2, 6, "", ""], line: 1, title: "Save through index 1", desc: "The saved total at index 1 is 6.", state: { example, target: "inclusive range sum", running_total: 6 } },
      { active: 2, prefixValues: [2, 6, 7, ""], line: 1, title: "Save through index 2", desc: "Continue filling the saved prefix totals.", state: { example, target: "inclusive range sum", running_total: 7 } },
      { active: 3, prefixValues: isOneRange ? [2, 6, 7, 10] : [2, 6, 7, 12], line: 1, title: "Finish prefix totals", desc: "Now the right edge and before-left totals are both available.", state: { example, target: "inclusive range sum", running_total: isOneRange ? 10 : 12 } },
      { active: isOneRange ? 2 : 3, prefixActive: isOneRange ? 2 : 3, prefixValues: isOneRange ? [2, 6, 7, 10] : [2, 6, 7, 12], line: 2, title: "Read right edge total", desc: `The saved total at the right edge is ${rightTotal}.`, state: { example, target: "inclusive range sum", right_saved: rightTotal } },
      { active: 0, prefixActive: 0, prefixValues: isOneRange ? [2, 6, 7, 10] : [2, 6, 7, 12], line: 3, title: "Read before-left total", desc: "The range starts at index 1, so subtract the prefix total at index 0.", state: { example, target: "inclusive range sum", before_left: 2, right_saved: rightTotal } },
      { active: isOneRange ? 2 : 3, prefixActive: isOneRange ? 2 : 3, prefixValues: isOneRange ? [2, 6, 7, 10] : [2, 6, 7, 12], line: 6, title: `Range sum is ${answer}`, desc: `${rightTotal} minus 2 gives ${answer}.`, state: { example, target: "inclusive range sum", calculation: `${rightTotal} - 2`, result: answer } },
      { active: isOneRange ? 2 : 3, prefixActive: isOneRange ? 2 : 3, prefixValues: isOneRange ? [2, 6, 7, 10] : [2, 6, 7, 12], line: 7, title: `Return ${answer}`, desc: "Return the inclusive range sum.", state: { example, target: "inclusive range sum", final_result: answer } },
    ], code);
  }

  if (family === "prefix-index-total") {
    const values = [2, 4, 1];
    const code = ["build saved prefix totals", "stop at the requested index", "read that saved total", "that total covers index 0 through index", "return the saved total", "finish", "done", "complete"];
    return build(values, [
      { active: 0, prefixValues: [2, "", ""], line: 1, title: context.title || "Prefix Sum At Index", desc: "Start saving totals from the beginning.", state: { example: "nums=[2,4,1], index=1", target: "sum from index 0 through index 1", running_total: 2 } },
      { active: 1, prefixValues: [2, "", ""], line: 2, title: "Stop at index 1", desc: "The requested index is 1, so the answer will come from prefix cell 1.", state: { example: "nums=[2,4,1], index=1", target: "sum from index 0 through index 1", requested_index: 1 } },
      { active: 1, prefixValues: [2, 6, ""], line: 3, title: "Save 6", desc: "2 + 4 is the sum through index 1.", state: { example: "nums=[2,4,1], index=1", target: "sum from index 0 through index 1", running_total: 6, result: 6 } },
      { active: 1, prefixValues: [2, 6, ""], line: 4, title: "Read saved total", desc: "No range subtraction is needed because the range starts at 0.", state: { example: "nums=[2,4,1], index=1", target: "sum from index 0 through index 1", saved_total: 6 } },
      { active: 2, prefixValues: [2, 6, 7], line: 4, title: "Later totals are not needed", desc: "The visual can show the next prefix, but the requested answer already came from index 1.", state: { example: "nums=[2,4,1], index=1", target: "sum from index 0 through index 1", saved_total: 6 } },
      { active: 1, prefixValues: [2, 6, 7], line: 5, title: "Return 6", desc: "The saved prefix at index 1 is the output.", state: { example: "nums=[2,4,1], index=1", target: "sum from index 0 through index 1", result: 6 } },
      { active: 1, prefixValues: [2, 6, 7], line: 6, title: "Trace complete", desc: "Prefix-at-index is a direct lookup after totals are saved.", state: { example: "nums=[2,4,1], index=1", target: "sum from index 0 through index 1", final_result: 6 } },
      { active: 1, prefixValues: [2, 6, 7], line: 8, title: "Done", desc: "The compact example returns 6.", state: { example: "nums=[2,4,1], index=1", target: "sum from index 0 through index 1", final_result: 6 } },
    ], code);
  }

  if (family === "prefix-range-queries") {
    const values = [2, 4, 1, 3];
    const prefix = [2, 6, 7, 10];
    const code = ["build prefix totals once", "read the next query", "right total minus before-left total gives one answer", "save that answer", "reuse the same prefix totals for the next query", "save the next answer", "return all query answers", "finish"];
    return build(values, [
      { active: 0, prefixValues: [2, "", "", ""], line: 1, title: context.title || "Range Sum Queries", desc: "Build prefix totals once so multiple queries can reuse them.", state: { example: "nums=[2,4,1,3], queries=[[0,1],[1,3]]", target: "answer each inclusive query", running_total: 2, result: "[]" } },
      { active: 3, prefixValues: prefix, line: 1, title: "Finish saved totals", desc: "The completed prefix totals are [2, 6, 7, 10].", state: { example: "nums=[2,4,1,3], queries=[[0,1],[1,3]]", target: "answer each inclusive query", prefix_totals: "[2,6,7,10]" } },
      { active: 1, prefixActive: 1, prefixValues: prefix, line: 2, title: "Query [0,1]", desc: "A range starting at 0 uses the right-edge total directly.", state: { example: "nums=[2,4,1,3], queries=[[0,1],[1,3]]", target: "answer each inclusive query", query: "[0,1]", right_saved: 6 } },
      { active: 1, prefixActive: 1, prefixValues: prefix, line: 4, title: "Save 6", desc: "The first query result is 6.", state: { example: "nums=[2,4,1,3], queries=[[0,1],[1,3]]", target: "answer each inclusive query", result: "[6]" } },
      { active: 3, prefixActive: 3, prefixValues: prefix, line: 5, title: "Query [1,3]", desc: "The second query reuses the same saved prefix table.", state: { example: "nums=[2,4,1,3], queries=[[0,1],[1,3]]", target: "answer each inclusive query", query: "[1,3]", right_saved: 10 } },
      { active: 0, prefixActive: 0, prefixValues: prefix, line: 3, title: "Subtract before left", desc: "Subtract prefix[0] = 2 because the query starts at index 1.", state: { example: "nums=[2,4,1,3], queries=[[0,1],[1,3]]", target: "answer each inclusive query", calculation: "10 - 2", result: "[6]" } },
      { active: 3, prefixActive: 3, prefixValues: prefix, line: 6, title: "Save 8", desc: "The second query sum is 8.", state: { example: "nums=[2,4,1,3], queries=[[0,1],[1,3]]", target: "answer each inclusive query", result: "[6,8]" } },
      { active: 3, prefixActive: 3, prefixValues: prefix, line: 7, title: "Return [6,8]", desc: "Return the answers in the same order as the queries.", state: { example: "nums=[2,4,1,3], queries=[[0,1],[1,3]]", target: "answer each inclusive query", final_result: "[6,8]" } },
    ], code);
  }

  if (family === "prefix-balance-index" || family === "prefix-balanced-split") {
    const balanceIndex = family === "prefix-balance-index";
    const values = balanceIndex ? [2, 3, 1, 1, 4] : [1, 2, 3];
    const example = balanceIndex ? "nums=[2,3,1,1,4]" : "nums=[1,2,3]";
    const target = balanceIndex ? "first index with equal before/after sums" : "count equal left/right splits";
    const code = balanceIndex
      ? ["find the total sum", "walk each index", "left sum is what came before", "right sum is total minus left and current", "compare left and right", "return the first balance index", "return -1 if none", "finish"]
      : ["find the total sum", "move the split after each index", "left sum grows by current value", "right sum is total minus left", "count when both sides match", "continue through valid splits", "return the count", "finish"];
    return build(values, balanceIndex ? [
      { active: 0, prefixValues: [2, "", "", "", ""], line: 1, title: context.title || "Prefix Balance Index", desc: "First find the total so each index can compare left and right sides.", state: { example, target, total_sum: 11, result: "none yet" } },
      { active: 0, prefixValues: [2, "", "", "", ""], line: 2, title: "Check index 0", desc: "Left side is 0; right side is 9, so this is not balanced.", state: { example, target, left_sum: 0, right_sum: 9, decision: "not equal" } },
      { active: 1, prefixValues: [2, 5, "", "", ""], line: 3, title: "Move to index 1", desc: "Left side now includes the value before index 1.", state: { example, target, left_sum: 2, right_sum: 6, decision: "not equal" } },
      { active: 2, prefixValues: [2, 5, 6, "", ""], line: 4, title: "Check index 2", desc: "Before index 2 the left sum is 5; after index 2 the right sum is 5.", state: { example, target, left_sum: 5, right_sum: 5, decision: "match" } },
      { active: 2, prefixValues: [2, 5, 6, "", ""], line: 5, title: "Save index 2", desc: "This is the first balance index, so no later index can be earlier.", state: { example, target, result: 2 } },
      { active: 2, prefixValues: [2, 5, 6, 7, 11], line: 6, title: "Return first match", desc: "Return index 2 immediately.", state: { example, target, result: 2 } },
      { active: 2, prefixValues: [2, 5, 6, 7, 11], line: 8, title: "Trace complete", desc: "The answer is the first place where both sides are equal.", state: { example, target, final_result: 2 } },
      { active: 2, prefixValues: [2, 5, 6, 7, 11], line: 8, title: "Done", desc: "The compact example returns 2.", state: { example, target, final_result: 2 } },
    ] : [
      { active: 0, prefixValues: [1, "", ""], line: 1, title: context.title || "Balanced Prefix Split", desc: "First know the total sum, then test splits between items.", state: { example, target, total_sum: 6, count: 0 } },
      { active: 0, prefixValues: [1, "", ""], line: 2, title: "Split after index 0", desc: "Left is 1 and right is 5, so the split does not count.", state: { example, target, left_sum: 1, right_sum: 5, count: 0 } },
      { active: 1, prefixValues: [1, 3, ""], line: 3, title: "Move split after index 1", desc: "Add the next value to the left side before comparing again.", state: { example, target, left_sum: 3, right_sum: 3, count: 0 } },
      { active: 1, prefixValues: [1, 3, ""], line: 5, title: "Balanced split found", desc: "Left and right are both 3, so this split counts.", state: { example, target, left_sum: 3, right_sum: 3, count: 1, result: 1 } },
      { active: 2, prefixValues: [1, 3, 6], line: 6, title: "Do not split after last", desc: "A valid split needs values on both sides, so the last position is not tested.", state: { example, target, count: 1 } },
      { active: 1, prefixValues: [1, 3, 6], line: 6, title: "Keep count 1", desc: "Only one valid split position had equal left and right totals.", state: { example, target, count: 1 } },
      { active: 1, prefixValues: [1, 3, 6], line: 7, title: "Return 1", desc: "Return the number of balanced split positions.", state: { example, target, result: 1 } },
      { active: 1, prefixValues: [1, 3, 6], line: 8, title: "Trace complete", desc: "The compact example has one equal split.", state: { example, target, final_result: 1 } },
    ], code);
  }

  if (family === "prefix-subarray-k" || family === "prefix-subarray-count" || family === "prefix-subarray-longest") {
    const longest = family === "prefix-subarray-longest";
    const countVariant = family === "prefix-subarray-count";
    const values = longest ? [1, -1, 5, -2, 3] : countVariant ? [1, 2, 1, 2] : [1, 1, 1];
    const example = longest ? "nums=[1,-1,5,-2,3], k=3" : countVariant ? "nums=[1,2,1,2], target=3" : "values=[1,1,1], k=2";
    const target = longest ? "longest subarray sum equal to k" : "count subarrays that sum to target";
    const code = longest
      ? ["keep the earliest index for each prefix total", "add the current value to prefix", "look for prefix minus k", "if found, measure the subarray length", "keep the longest length", "save this prefix only if first seen", "return the longest length", "finish"]
      : ["keep counts of earlier prefix totals", "add the current value to prefix", "look for prefix minus target", "add that count to the answer", "store the current prefix total", "repeat for each value", "return the count", "finish"];
    return build(values, longest ? [
      { active: 0, prefixValues: [1, "", "", "", ""], line: 1, title: context.title || "Longest Subarray Sum K", desc: "Save where each prefix total first appeared.", state: { example, target, prefix_total: 0, earliest: "0 at before start", best_length: 0 } },
      { active: 0, prefixValues: [1, "", "", "", ""], line: 2, title: "Prefix becomes 1", desc: "No earlier prefix makes a sum of 3 yet.", state: { example, target, prefix_total: 1, need: -2, best_length: 0 } },
      { active: 1, prefixValues: [1, 0, "", "", ""], line: 6, title: "Prefix returns to 0", desc: "Keep the earliest 0 from before the list, because earlier makes longer ranges.", state: { example, target, prefix_total: 0, earliest: "0 already saved" } },
      { active: 2, prefixValues: [1, 0, 5, "", ""], line: 3, title: "Prefix becomes 5", desc: "5 minus k=3 needs prefix 2, which has not appeared.", state: { example, target, prefix_total: 5, need: 2, best_length: 0 } },
      { active: 3, prefixValues: [1, 0, 5, 3, ""], line: 4, title: "Prefix becomes 3", desc: "3 minus 3 needs prefix 0, found before the list, so length is 4.", state: { example, target, prefix_total: 3, need: 0, length: 4, best_length: 4 } },
      { active: 4, prefixValues: [1, 0, 5, 3, 6], line: 5, title: "Check last value", desc: "The last prefix also has a matching earlier prefix, but the length is shorter.", state: { example, target, prefix_total: 6, need: 3, length: 1, best_length: 4 } },
      { active: 3, prefixValues: [1, 0, 5, 3, 6], line: 7, title: "Return 4", desc: "The longest matching subarray is from index 0 through 3.", state: { example, target, result: 4 } },
      { active: 3, prefixValues: [1, 0, 5, 3, 6], line: 8, title: "Trace complete", desc: "Prefix sums work with negative numbers because they compare saved totals, not a sliding window.", state: { example, target, final_result: 4 } },
    ] : [
      { active: 0, prefixValues: [values[0], "", "", ""].slice(0, values.length), line: 1, title: context.title || "Subarray Sum Count", desc: "Start with prefix total 0 saved once before reading values.", state: { example, target, prefix_total: 0, saved_counts: "{0:1}", count: 0 } },
      { active: 0, prefixValues: [values[0], "", "", ""].slice(0, values.length), line: 2, title: "Read first value", desc: "Update the prefix total with the first number.", state: { example, target, prefix_total: values[0], need: countVariant ? -2 : -1, count: 0 } },
      { active: 1, prefixValues: countVariant ? [1, 3, "", ""] : [1, 2, ""], line: 3, title: "Find a matching earlier prefix", desc: countVariant ? "Prefix 3 needs earlier prefix 0, so [1,2] counts." : "Prefix 2 needs earlier prefix 0, so the first two values count.", state: { example, target, prefix_total: countVariant ? 3 : 2, need: 0, count: 1 } },
      { active: 1, prefixValues: countVariant ? [1, 3, "", ""] : [1, 2, ""], line: 5, title: "Store current prefix", desc: "Save the current prefix total so later subarrays can end after this point.", state: { example, target, saved_counts: countVariant ? "{0:1,1:1,3:1}" : "{0:1,1:1,2:1}", count: 1 } },
      { active: 2, prefixValues: countVariant ? [1, 3, 4, ""] : [1, 2, 3], line: 4, title: "Next ending position", desc: countVariant ? "Prefix 4 needs earlier prefix 1, so [2,1] counts." : "Prefix 3 needs earlier prefix 1, so the last two values count.", state: { example, target, prefix_total: countVariant ? 4 : 3, need: 1, count: 2 } },
      { active: countVariant ? 3 : 2, prefixValues: countVariant ? [1, 3, 4, 6] : [1, 2, 3], line: 6, title: countVariant ? "Check final value" : "Finish scan", desc: countVariant ? "Prefix 6 needs earlier prefix 3, so [1,2] at the end counts." : "All ending positions have been checked.", state: { example, target, prefix_total: countVariant ? 6 : 3, need: countVariant ? 3 : 1, count: countVariant ? 3 : 2 } },
      { active: countVariant ? 3 : 2, prefixValues: countVariant ? [1, 3, 4, 6] : [1, 2, 3], line: 7, title: `Return ${countVariant ? 3 : 2}`, desc: "Return the number of matching contiguous subarrays.", state: { example, target, result: countVariant ? 3 : 2 } },
      { active: countVariant ? 3 : 2, prefixValues: countVariant ? [1, 3, 4, 6] : [1, 2, 3], line: 8, title: "Trace complete", desc: "Each count came from comparing the current prefix against earlier saved prefixes.", state: { example, target, final_result: countVariant ? 3 : 2 } },
    ], code);
  }

  const values = [2, 4, 1];
  const code = ["build saved prefix totals", "read needed saved totals", "subtract when the range starts after zero", "return the requested answer", "finish", "done", "complete", "end"];
  return build(values, [
    { active: 0, prefixValues: [2, "", ""], line: 1, title: context.title || "Prefix sum", desc: "Start by saving the first running total.", state: { example: "values=[2,4,1]", target: "reuse prefix totals", running_total: 2 } },
    { active: 1, prefixValues: [2, 6, ""], line: 1, title: "Save next total", desc: "Each prefix cell stores the sum so far.", state: { example: "values=[2,4,1]", target: "reuse prefix totals", running_total: 6 } },
    { active: 2, prefixValues: [2, 6, 7], line: 4, title: "Return saved result", desc: "The saved totals now answer prefix questions directly.", state: { example: "values=[2,4,1]", target: "reuse prefix totals", result: "[2,6,7]" } },
    { active: 2, prefixValues: [2, 6, 7], line: 8, title: "Trace complete", desc: "The compact prefix table is complete.", state: { example: "values=[2,4,1]", target: "reuse prefix totals", final_result: "[2,6,7]" } },
  ], code);
}

export function generateIntervalsSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("intervals", context);
  type IntervalItem = { id: string; label: string; start: number; end: number };
  type IntervalPhase = { active: string[]; compare?: string[]; visited?: string[]; title: string; desc: string; line: number; state: Record<string, string | number | boolean> };
  const make = (items: IntervalItem[], phases: IntervalPhase[], code: string[], axisStart: number, axisEnd: number) => phases.map((phase, index) => {
    const nodes: Node[] = items.map((item, itemIndex) => ({
      id: item.id,
      x: 160 + itemIndex * 100,
      y: 180 + itemIndex * 70,
      value: `${item.start}-${item.end}`,
      type: "array-cell",
      label: item.label,
      state: phase.compare?.includes(item.id) ? "comparing" : phase.active.includes(item.id) ? "active" : phase.visited?.includes(item.id) ? "visited" : "default",
      meta: { role: "interval-bar", start: item.start, end: item.end },
    }));
    return step({
      concept: "intervals",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: [...phase.active, ...(phase.compare || [])], lineNumbers: [phase.line] },
      code,
      activeLine: phase.line,
      workflow: workflowFromLabels(phases.map((item) => item.title), index),
      state: { axis_start: axisStart, axis_end: axisEnd, ...phase.state },
    }, index + 1);
  });
  const title = context.title || "Intervals";

  if (family === "interval-overlap") {
    const example = "a=[1,4], b=[3,6]";
    const target = "return true if closed intervals overlap";
    const code = ["read the two intervals", "find the later start", "find the earlier end", "if later start <= earlier end, they overlap", "save the boolean result", "return true or false", "finish"];
    return make([{ id: "a", label: "a", start: 1, end: 4 }, { id: "b", label: "b", start: 3, end: 6 }], [
      { active: ["a", "b"], title, desc: "Use the actual sample: a covers 1-4 and b covers 3-6.", line: 1, state: { example, target, action: "read both ranges", result: "not decided" } },
      { active: ["a"], compare: ["b"], title: "Later start is 3", desc: "The overlap can only begin at the later start.", line: 2, state: { example, target, later_start: 3 } },
      { active: ["a"], compare: ["b"], title: "Earlier end is 4", desc: "The overlap must end by the earlier end.", line: 3, state: { example, target, earlier_end: 4 } },
      { active: ["a", "b"], compare: ["a", "b"], title: "Shared section exists", desc: "Since 3 <= 4, both ranges cover part of the same timeline.", line: 4, state: { example, target, check: "3 <= 4", decision: "overlap from 3 to 4" } },
      { active: ["a", "b"], compare: ["a", "b"], title: "Save true", desc: "Closed intervals that cross or touch count as overlapping.", line: 5, state: { example, target, result: "true" } },
      { active: ["a", "b"], title: "Return true", desc: "Return the boolean value, not the word as text.", line: 6, state: { example, target, result: "true" } },
      { active: ["a", "b"], visited: ["a", "b"], title: "Trace complete", desc: "The compact example matches the practice prompt output.", line: 7, state: { example, target, final_result: "true" } },
    ], code, 1, 6);
  }

  if (family === "interval-gap") {
    const example = "a=[1,3], b=[6,8]";
    const target = "return the gap between ranges";
    const code = ["read both ranges", "put the earlier range first", "read the earlier end", "read the later start", "subtract earlier end from later start", "save the gap", "return the gap"];
    return make([{ id: "a", label: "a", start: 1, end: 3 }, { id: "b", label: "b", start: 6, end: 8 }], [
      { active: ["a", "b"], title, desc: "Two separated bars make the empty gap visible.", line: 1, state: { example, target, result: "not decided" } },
      { active: ["a"], visited: ["b"], title: "a comes first", desc: "a starts at 1, so use its end as the left edge of the gap.", line: 2, state: { example, target, first_range: "a" } },
      { active: ["a"], title: "Read end 3", desc: "The first range ends at 3.", line: 3, state: { example, target, earlier_end: 3 } },
      { active: ["b"], title: "Read start 6", desc: "The next range starts at 6.", line: 4, state: { example, target, later_start: 6 } },
      { active: ["a", "b"], compare: ["a", "b"], title: "Measure gap", desc: "6 - 3 gives the space between the bars.", line: 5, state: { example, target, calculation: "6 - 3", decision: "gap is 3" } },
      { active: ["a", "b"], title: "Save 3", desc: "The gap value is ready to return.", line: 6, state: { example, target, result: 3 } },
      { active: ["a", "b"], visited: ["a", "b"], title: "Return 3", desc: "Return the numeric gap.", line: 7, state: { example, target, final_result: 3 } },
    ], code, 1, 8);
  }

  if (family === "interval-schedule-valid") {
    const example = "intervals=[[9,10],[10,11],[10,12]]";
    const target = "return false if any classes overlap";
    const code = ["sort by start time", "keep the previous class", "compare the next class", "a conflict happens when next start < previous end", "carry safe class forward", "stop on the first conflict", "return the boolean result"];
    return make([{ id: "a", label: "A", start: 9, end: 10 }, { id: "b", label: "B", start: 10, end: 11 }, { id: "c", label: "C", start: 10, end: 12 }], [
      { active: ["a", "b", "c"], title, desc: "Sort the classes by start time before comparing neighbors.", line: 1, state: { example, target, sorted: "A, B, C", result: "not decided" } },
      { active: ["a"], title: "Keep A", desc: "A is the previous class for the first comparison.", line: 2, state: { example, target, previous: "A 9-10" } },
      { active: ["a"], compare: ["b"], title: "A and B are safe", desc: "B starts at 10 exactly when A ends, so there is no conflict.", line: 4, state: { example, target, check: "10 < 10 is false", decision: "safe" } },
      { active: ["b"], visited: ["a"], title: "Carry B forward", desc: "B becomes the previous class.", line: 5, state: { example, target, previous: "B 10-11" } },
      { active: ["b"], compare: ["c"], title: "B and C conflict", desc: "C starts at 10 before B ends at 11.", line: 4, state: { example, target, check: "10 < 11 is true", decision: "conflict" } },
      { active: ["b", "c"], compare: ["b", "c"], title: "Save false", desc: "One conflict is enough to reject the schedule.", line: 6, state: { example, target, conflict: "B overlaps C", result: "false" } },
      { active: ["b", "c"], visited: ["a"], title: "Return false", desc: "Return the boolean result.", line: 7, state: { example, target, final_result: "false" } },
    ], code, 9, 12);
  }

  if (family === "interval-count-overlap") {
    const example = "intervals=[[9,11],[10,12],[13,15]], time=10";
    const target = "count intervals containing time 10";
    const code = ["read target time", "check one interval", "start must be <= time", "time must be <= end", "count the interval when both are true", "skip misses", "return the count"];
    return make([{ id: "a", label: "A", start: 9, end: 11 }, { id: "b", label: "B", start: 10, end: 12 }, { id: "c", label: "C", start: 13, end: 15 }], [
      { active: ["a"], title, desc: "Count intervals that include the target time 10.", line: 1, state: { example, target, time: 10, count: 0 } },
      { active: ["a"], compare: ["a"], title: "A contains 10", desc: "9 <= 10 and 10 <= 11, so A counts.", line: 5, state: { example, target, check: "9 <= 10 <= 11", count: 1 } },
      { active: ["b"], title: "Move to B", desc: "Check the next interval against the same target time.", line: 2, state: { example, target, time: 10, count: 1 } },
      { active: ["b"], compare: ["b"], title: "B contains 10", desc: "10 sits on B's left endpoint, and closed intervals include endpoints.", line: 5, state: { example, target, check: "10 <= 10 <= 12", count: 2 } },
      { active: ["c"], title: "Move to C", desc: "Keep the count while scanning the last interval.", line: 2, state: { example, target, count: 2 } },
      { active: ["c"], title: "C misses 10", desc: "C starts at 13, after the target time.", line: 6, state: { example, target, check: "13 <= 10 is false", count: 2 } },
      { active: ["a", "b"], visited: ["c"], title: "Return 2", desc: "Two intervals contain the target time.", line: 7, state: { example, target, final_result: 2 } },
    ], code, 9, 15);
  }

  if (family === "interval-meeting-rooms") {
    const example = "intervals=[[0,30],[5,10],[15,20]]";
    const target = "return minimum rooms needed";
    const code = ["sort starts and ends", "start the next meeting", "need a new room if it starts before earliest end", "reuse a room after a meeting ends", "update max rooms", "continue through meetings", "return max rooms"];
    return make([{ id: "a", label: "A", start: 0, end: 30 }, { id: "b", label: "B", start: 5, end: 10 }, { id: "c", label: "C", start: 15, end: 20 }], [
      { active: ["a"], title, desc: "A begins first and uses one room.", line: 2, state: { example, target, rooms_now: 1, max_rooms: 1 } },
      { active: ["a"], compare: ["b"], title: "B overlaps A", desc: "B starts at 5 before A ends at 30, so it needs another room.", line: 3, state: { example, target, check: "5 < 30", rooms_now: 2 } },
      { active: ["b"], title: "Max becomes 2", desc: "Two simultaneous meetings is the highest seen so far.", line: 5, state: { example, target, rooms_now: 2, max_rooms: 2 } },
      { active: ["b"], visited: ["b"], title: "B ends", desc: "B ends at 10 before C starts, freeing one room.", line: 4, state: { example, target, freed_room: "B ended at 10", rooms_now: 1 } },
      { active: ["a"], compare: ["c"], title: "C overlaps A", desc: "C starts at 15 while A is still running.", line: 3, state: { example, target, check: "15 < 30", rooms_now: 2 } },
      { active: ["c"], title: "Max stays 2", desc: "C reuses the room B freed, so the maximum does not grow.", line: 6, state: { example, target, rooms_now: 2, max_rooms: 2 } },
      { active: ["a", "b", "c"], visited: ["a", "b", "c"], title: "Return 2", desc: "At most two meetings overlap at once.", line: 7, state: { example, target, final_result: 2 } },
    ], code, 0, 30);
  }

  const insert = family === "interval-insert";
  const busy = family === "interval-busy-minutes";
  const example = busy ? "intervals=[[9,12],[11,13],[14,16]]" : insert ? "intervals=[[1,3],[6,8]], newInterval=[2,7]" : "intervals=[[1,3],[2,6],[8,10]]";
  const target = busy ? "return total covered minutes" : insert ? "return intervals after inserting and merging" : "return merged intervals";
  const items = busy
    ? [{ id: "a", label: "A", start: 9, end: 12 }, { id: "b", label: "B", start: 11, end: 13 }, { id: "c", label: "C", start: 14, end: 16 }]
    : insert
      ? [{ id: "a", label: "A", start: 1, end: 3 }, { id: "new", label: "new", start: 2, end: 7 }, { id: "b", label: "B", start: 6, end: 8 }]
      : [{ id: "a", label: "A", start: 1, end: 3 }, { id: "b", label: "B", start: 2, end: 6 }, { id: "c", label: "C", start: 8, end: 10 }];
  const code = busy
    ? ["sort intervals", "start the current busy block", "merge overlapping busy time", "close separate blocks", "add block lengths", "return total busy minutes", "finish"]
    : ["sort intervals", "start the current merged range", "compare next start with current end", "merge overlapping ranges", "store separate ranges", "return merged ranges", "finish"];
  return make(items, [
    { active: items.map((item) => item.id), title: context.title || (busy ? "Total Busy Minutes" : insert ? "Insert One Interval" : "Merge Overlapping Intervals"), desc: "Put the ranges on one timeline so overlap and gaps are visible.", line: 1, state: { example, target, sorted: items.map((item) => item.label).join(", "), result: "not decided" } },
    { active: ["a"], title: "Start current block", desc: "The first interval becomes the saved block.", line: 2, state: { example, target, current: `${items[0].start}-${items[0].end}` } },
    { active: ["a"], compare: [insert ? "new" : "b"], title: "Next range overlaps", desc: "The next range starts before the saved block ends, so extend the block.", line: 3, state: { example, target, decision: "merge", check: insert ? "2 <= 3" : busy ? "11 <= 12" : "2 <= 3" } },
    { active: ["a", insert ? "new" : "b"], compare: ["a", insert ? "new" : "b"], title: "Extend block", desc: busy ? "A and B become one busy block from 9-13." : insert ? "A plus the inserted interval becomes 1-7." : "A and B merge into 1-6.", line: 4, state: { example, target, current: busy ? "9-13" : insert ? "1-7" : "1-6" } },
    { active: [insert ? "b" : "c"], title: busy ? "Close first block" : insert ? "Merge B too" : "Store separate C", desc: busy ? "C starts after 13, so close 9-13 before starting 14-16." : insert ? "B starts before 1-7 ends, so the block extends again." : "C starts after 1-6 ends, so it stays separate.", line: 5, state: { example, target, current: busy ? "14-16" : insert ? "1-8" : "8-10", result: busy ? "4 minutes so far" : insert ? "[[1,8]]" : "[[1,6]]" } },
    { active: [insert ? "b" : "c"], visited: ["a", insert ? "new" : "b"], title: busy ? "Add final block" : "Save final list", desc: busy ? "4 minutes plus 2 minutes gives 6 total busy minutes." : insert ? "All ranges collapse into one interval." : "The separate range is appended to the answer.", line: 6, state: { example, target, result: busy ? 6 : insert ? "[[1,8]]" : "[[1,6],[8,10]]" } },
    { active: items.map((item) => item.id), visited: items.map((item) => item.id), title: busy ? "Return 6" : "Return result", desc: busy ? "Return the total covered length after merging overlap." : "Return only the merged interval list.", line: 7, state: { example, target, final_result: busy ? 6 : insert ? "[[1,8]]" : "[[1,6],[8,10]]" } },
  ], code, busy ? 9 : 1, busy ? 16 : 10);
}

export function generateHeapSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("heap", context);
  type HeapPhase = {
    values: Array<string | number>;
    ids?: string[];
    active: number[];
    visited?: number[];
    comparing?: number[];
    discarded?: number[];
    line: number;
    title: string;
    description: string;
    state: Record<string, string | number | boolean>;
  };
  type HeapConfig = {
    example: string;
    target: string;
    code: string[];
    phases: HeapPhase[];
  };
  function heapTreeFromArray(phase: HeapPhase): { nodes: Node[]; edges: Edge[] } {
    const visual = treeFromArray(phase.values, phase.active[0] ?? 0, "tree-node");
    const remapped = visual.nodes.map((node) => {
      const index = Number(node.id.replace("tree-", ""));
      return { ...node, id: phase.ids?.[index] || node.id, meta: { ...node.meta, heapIndex: index } };
    });
    const idAt = (treeId: string) => {
      const index = Number(treeId.replace("tree-", ""));
      return phase.ids?.[index] || treeId;
    };
    return {
      nodes: remapped,
      edges: visual.edges.map((edge) => ({
        ...edge,
        id: `${idAt(edge.from)}-${idAt(edge.to)}`,
        from: idAt(edge.from),
        to: idAt(edge.to),
      })),
    };
  }
  const phaseIds = (phase: HeapPhase, indexes: number[] = []) => indexes.map((item) => phase.ids?.[item] || `tree-${item}`);
  const configs: Partial<Record<VisualizerFamily, HeapConfig>> = {
    "heap-highest-priority-name": {
      example: "names=[Ada, Bo, Cy], priorities=[4, 9, 9]",
      target: "return highest priority name",
      code: ["pair each name with its priority", "insert the next item as a child", "compare child with parent", "swap the better item upward", "use alphabetical order to break ties", "read the root candidate", "return the chosen name", "finish"],
      phases: [
        { values: ["Ada:4"], ids: ["ada"], active: [0], line: 1, title: context.title || "Highest Priority Name", description: "Ada is the first paired item, so Ada starts at the root.", state: { candidate: "Ada:4", rule: "higher priority wins", result: "not final" } },
        { values: ["Ada:4", "Bo:9"], ids: ["ada", "bo"], active: [1], line: 2, title: "Insert Bo", description: "A new heap item enters at the next open child position.", state: { incoming: "Bo:9", top: "Ada:4", result: "not final" } },
        { values: ["Ada:4", "Bo:9"], ids: ["ada", "bo"], active: [1], comparing: [0, 1], line: 3, title: "Compare with parent", description: "Bo has priority 9, which outranks Ada's 4.", state: { compared: "Bo beats Ada", action: "swap needed" } },
        { values: ["Bo:9", "Ada:4"], ids: ["bo", "ada"], active: [0], visited: [1], line: 4, title: "Swap Bo up", description: "Bo moves into the root slot and Ada moves down to Bo's old child slot.", state: { top: "Bo:9", action: "Bo swaps with Ada" } },
        { values: ["Bo:9", "Ada:4", "Cy:9"], ids: ["bo", "ada", "cy"], active: [2], comparing: [0, 2], line: 5, title: "Tie with Cy", description: "Cy also has priority 9, so the tie rule compares names.", state: { compared: "Bo vs Cy", tie_rule: "alphabetically first" } },
        { values: ["Bo:9", "Ada:4", "Cy:9"], ids: ["bo", "ada", "cy"], active: [0], visited: [2], line: 5, title: "Bo stays on top", description: "Bo comes before Cy alphabetically, so there is no swap.", state: { top: "Bo:9", decision: "keep Bo" } },
        { values: ["Bo:9", "Ada:4", "Cy:9"], ids: ["bo", "ada", "cy"], active: [0], line: 6, title: "Read root", description: "After the heap rule has been applied, the root is the answer candidate.", state: { top: "Bo:9", result: "Bo" } },
        { values: ["Bo:9", "Ada:4", "Cy:9"], ids: ["bo", "ada", "cy"], active: [0], visited: [0, 1, 2], line: 7, title: "Return Bo", description: "Return the name stored at the highest-priority root.", state: { final_result: "Bo", rule: "priority, then name" } },
      ],
    },
    "heap-top-three": {
      example: "scores=[5, 9, 7, 2]",
      target: "return top three scores",
      code: ["build a max-priority heap", "read the largest root", "remove the root into the result", "move the next best value upward", "repeat until three scores are saved", "stop when enough values are saved", "return scores in removal order", "finish"],
      phases: [
        { values: [9, 5, 7, 2], ids: ["score9", "score5", "score7", "score2"], active: [0], line: 1, title: context.title || "Top Three Scores", description: "A max-heap keeps the largest score at the root.", state: { remaining_heap: "[9, 5, 7, 2]", result: "[]" } },
        { values: [9, 5, 7, 2], ids: ["score9", "score5", "score7", "score2"], active: [0], line: 2, title: "Root is 9", description: "The first root is the largest score.", state: { root: 9, result: "[]" } },
        { values: [5, 2, 7], ids: ["score5", "score2", "score7"], active: [0, 2], comparing: [0, 2], line: 3, title: "Remove 9", description: "9 leaves into the result. The last item fills the root before the heap is restored.", state: { removed: 9, result: "[9]" } },
        { values: [7, 2, 5], ids: ["score7", "score2", "score5"], active: [0], visited: [2], line: 4, title: "Swap 7 up", description: "7 is larger than 5, so 7 moves to the root for the next removal.", state: { action: "7 swaps with 5", result: "[9]" } },
        { values: [5, 2], ids: ["score5", "score2"], active: [0], line: 5, title: "Save 7", description: "The next root is appended after 9.", state: { removed: 7, result: "[9, 7]" } },
        { values: [5, 2], ids: ["score5", "score2"], active: [0], line: 6, title: "Need one more", description: "Only two scores are saved, so the heap continues.", state: { count: "2 of 3", result: "[9, 7]" } },
        { values: [2], ids: ["score2"], active: [0], line: 5, title: "Save 5", description: "One more removal completes the top-three list. The 2 remains in the heap but is not part of the answer.", state: { removed: 5, remainder: 2, result: "[9, 7, 5]" } },
        { values: [2], ids: ["score2"], active: [], discarded: [0], line: 7, title: "Return descending scores", description: "The leftover 2 is muted because the prompt only asks for three scores.", state: { remainder: 2, final_result: "[9, 7, 5]" } },
      ],
    },
    "heap-smallest-two": {
      example: "scores=[8, 3, 5]",
      target: "return two smallest scores",
      code: ["build a min-priority heap", "read the smallest root", "remove the root into the result", "restore the heap rule", "repeat until two scores are saved", "stop after two removals", "return scores in removal order"],
      phases: [
        { values: [3, 8, 5], active: [0], line: 1, title: context.title || "Smallest Two Scores", description: "A min-heap keeps the smallest score at the root.", state: { remaining_heap: "[3, 8, 5]", result: "[]" } },
        { values: [3, 8, 5], active: [0], line: 2, title: "Root is 3", description: "The first root is the smallest score.", state: { root: 3, result: "[]" } },
        { values: [5, 8], active: [0], visited: [1], line: 3, title: "Save 3", description: "Remove the smallest score and restore the heap.", state: { removed: 3, result: "[3]" } },
        { values: [5, 8], active: [0, 1], comparing: [0, 1], line: 4, title: "Next smallest rises", description: "5 becomes the next root because it is smaller than 8.", state: { root: 5, result: "[3]" } },
        { values: [8], active: [0], line: 5, title: "Save 5", description: "The second removal completes the answer.", state: { removed: 5, result: "[3, 5]" } },
        { values: [8], active: [], discarded: [0], line: 6, title: "Stop after two", description: "The prompt asks for two values, so the remaining 8 is not returned.", state: { remaining: 8, result: "[3, 5]" } },
        { values: [8], active: [], discarded: [0], line: 7, title: "Return ascending scores", description: "A min-heap removal order gives the smallest values first.", state: { final_result: "[3, 5]" } },
      ],
    },
    "heap-top-priority-assignments": {
      example: "names=[lab, quiz, project], priorities=[2, 5, 5], k=2",
      target: "return top k assignment names",
      code: ["pair each assignment with priority", "order higher priority first", "break tied priorities by name", "read the best root", "save one selected name", "repeat until k names are saved", "return the selected names"],
      phases: [
        { values: ["project:5", "lab:2", "quiz:5"], active: [0, 2], comparing: [0, 2], line: 1, title: context.title || "Top Priority Assignments", description: "Each heap item carries both the name and the priority.", state: { k: 2, candidate: "project:5", result: "[]" } },
        { values: ["project:5", "lab:2", "quiz:5"], active: [0, 2], line: 3, title: "Tie goes alphabetical", description: "Project and quiz both have priority 5, and project comes first alphabetically.", state: { tie_rule: "alphabetical", top: "project:5" } },
        { values: ["quiz:5", "lab:2"], active: [0], visited: [1], line: 5, title: "Save project", description: "The top assignment is removed into the answer.", state: { selected: "project", result: "[project]" } },
        { values: ["quiz:5", "lab:2"], active: [0, 1], comparing: [0, 1], line: 6, title: "Restore for next pick", description: "Quiz now outranks lab, so quiz becomes the next root.", state: { top: "quiz:5", result: "[project]" } },
        { values: ["lab:2"], active: [0], line: 5, title: "Save quiz", description: "The second selected name completes k=2.", state: { selected: "quiz", result: "[project, quiz]" } },
        { values: ["lab:2"], active: [], discarded: [0], line: 6, title: "Stop at k", description: "Lab remains in the heap, but the prompt only asks for two assignments.", state: { k: 2, remaining: "lab", result: "[project, quiz]" } },
        { values: ["lab:2"], active: [], discarded: [0], line: 7, title: "Return names only", description: "Return assignment names, not their priority numbers.", state: { final_result: "[project, quiz]" } },
      ],
    },
    "heap-lowest-priority-assignment": {
      example: "names=[lab, quiz, essay], priorities=[3, 1, 1]",
      target: "return lowest priority assignment",
      code: ["pair each assignment with priority", "keep the lowest priority at the root", "compare priority values", "break ties alphabetically", "read the root candidate", "return the assignment name", "finish"],
      phases: [
        { values: ["lab:3"], active: [0], line: 1, title: context.title || "Lowest Priority Assignment", description: "Start by pairing each assignment with its priority.", state: { candidate: "lab:3", rule: "lower priority wins" } },
        { values: ["quiz:1", "lab:3"], active: [0], comparing: [0, 1], line: 3, title: "Quiz moves up", description: "Priority 1 is lower than 3, so quiz becomes the root.", state: { candidate: "quiz:1", result: "not final" } },
        { values: ["essay:1", "lab:3", "quiz:1"], active: [0, 2], comparing: [0, 2], line: 4, title: "Essay ties quiz", description: "Essay and quiz both have priority 1, so compare names.", state: { compared: "essay vs quiz", tie_rule: "alphabetical" } },
        { values: ["essay:1", "lab:3", "quiz:1"], active: [0], visited: [2], line: 4, title: "Essay wins tie", description: "Essay comes before quiz alphabetically, so it stays at the min-heap root.", state: { top: "essay:1", decision: "keep essay" } },
        { values: ["essay:1", "lab:3", "quiz:1"], active: [0], line: 5, title: "Read root", description: "The root is now the lowest-priority assignment.", state: { top: "essay:1", result: "essay" } },
        { values: ["essay:1", "lab:3", "quiz:1"], active: [0], line: 6, title: "Return essay", description: "Return the assignment name, not the priority pair.", state: { final_result: "essay" } },
        { values: ["essay:1", "lab:3", "quiz:1"], active: [0], visited: [0, 1, 2], line: 7, title: "Heap rule explains the choice", description: "The root keeps the best candidate according to the prompt's priority and tie rules.", state: { final_result: "essay", rule: "priority, then name" } },
      ],
    },
    "heap-kth-largest-stream": {
      example: "k=3, stream=[4, 5, 8, 2]",
      target: "return kth largest after each insert",
      code: ["read the next stream value", "keep a small heap of only k values", "output null before k values arrive", "when size exceeds k, remove the smallest saved value", "the root is the kth largest", "append that root to the output", "return all stream outputs"],
      phases: [
        { values: [4], active: [0], line: 1, title: context.title || "Kth Largest Stream", description: "After 4 arrives, fewer than k values have been seen.", state: { k: 3, incoming: 4, kept: "[4]", result: "[null]" } },
        { values: [4, 5], active: [1], line: 3, title: "Still waiting for k", description: "After 5 arrives, there are still only two saved values.", state: { incoming: 5, kept: "[4, 5]", result: "[null, null]" } },
        { values: [4, 5, 8], active: [0], line: 5, title: "Third value gives a root", description: "Now the heap has k values. The smallest kept value is the kth largest overall.", state: { incoming: 8, root: 4, result: "[null, null, 4]" } },
        { values: [2, 4, 8, 5], active: [0], line: 1, title: "Read 2", description: "The next stream value enters the temporary heap.", state: { incoming: 2, kept: "[2, 4, 8, 5]" } },
        { values: [4, 5, 8], active: [0], visited: [1], line: 4, title: "Remove smallest", description: "Size is now above k, so remove 2 and keep the three largest values.", state: { removed: 2, kept: "[4, 5, 8]" } },
        { values: [4, 5, 8], active: [0], line: 5, title: "Root is kth largest", description: "The root 4 is the smallest among the kept top three values.", state: { root: 4, result: "[null, null, 4, 4]" } },
        { values: [4, 5, 8, 2], active: [0], visited: [0, 1, 2], discarded: [3], line: 7, title: "Return stream outputs", description: "2 was discarded because it cannot be in the top three kept values.", state: { final_result: "[null, null, 4, 4]" } },
      ],
    },
    "heap-top-k-scores": {
      example: "scores=[88, 91, 72, 91, 84], k=3",
      target: "return k highest scores",
      code: ["build access to the largest scores", "read the largest candidate", "save the candidate in the answer", "keep duplicate scores as separate entries", "repeat until k scores are saved", "stop after k saves", "return scores from high to low"],
      phases: [
        { values: [91, 91, 88, 72, 84], active: [0, 1], line: 1, title: context.title || "Top K Scores", description: "A max view keeps the highest scores easy to remove.", state: { k: 3, result: "[]" } },
        { values: [91, 91, 88, 72, 84], active: [0], line: 2, title: "First top score", description: "The first root is 91.", state: { candidate: 91, result: "[]" } },
        { values: [91, 88, 84, 72], active: [0], line: 3, title: "Save first 91", description: "Remove one 91 and keep scanning for the next top score.", state: { saved: 91, result: "[91]" } },
        { values: [91, 88, 84, 72], active: [0], line: 4, title: "Duplicate still counts", description: "The second 91 remains as its own score and can also be returned.", state: { candidate: 91, result: "[91]" } },
        { values: [88, 84, 72], active: [0], line: 5, title: "Save second 91", description: "The duplicate 91 is saved as the second top score.", state: { saved: 91, result: "[91, 91]" } },
        { values: [84, 72], active: [0], line: 5, title: "Save 88", description: "The third saved value completes k=3.", state: { saved: 88, result: "[91, 91, 88]" } },
        { values: [84, 72], active: [], discarded: [0, 1], line: 7, title: "Return top k", description: "84 and 72 stay muted because the prompt only asks for the top three scores.", state: { final_result: "[91, 91, 88]" } },
      ],
    },
    "heap-running-median": {
      example: "scores=[80, 90, 70, 100]",
      target: "return lower median after each score",
      code: ["read the next score", "put smaller half on the left heap", "put larger half on the right heap", "rebalance so left has the median", "read the left root as lower median", "append that median to the result", "return all medians"],
      phases: [
        { values: [80], active: [0], line: 1, title: context.title || "Running Median Scores", description: "The first score starts the smaller-half heap.", state: { incoming: 80, left_heap: "[80]", right_heap: "[]", result: "[80]" } },
        { values: [80, 90], active: [0, 1], comparing: [0, 1], line: 3, title: "90 goes right", description: "90 is larger than 80, so it belongs on the larger side.", state: { incoming: 90, left_heap: "[80]", right_heap: "[90]" } },
        { values: [80, 90], active: [0], line: 5, title: "Lower median stays 80", description: "With two scores, the lower median is the top of the smaller half.", state: { median: 80, result: "[80, 80]" } },
        { values: [80, 70, 90], active: [1], comparing: [0, 1], line: 2, title: "70 goes left", description: "70 belongs with the smaller half.", state: { incoming: 70, left_heap: "[80, 70]", right_heap: "[90]" } },
        { values: [80, 70, 90], active: [0], line: 4, title: "Left holds the median", description: "The left heap may have one extra value, so its root is still the lower median.", state: { median: 80, result: "[80, 80, 80]" } },
        { values: [80, 70, 90, 100], active: [3], line: 3, title: "100 goes right", description: "100 joins the larger side, keeping the heaps balanced.", state: { incoming: 100, left_heap: "[80, 70]", right_heap: "[90, 100]" } },
        { values: [80, 70, 90, 100], active: [0], visited: [0, 1, 2, 3], line: 7, title: "Return medians", description: "Each output is the lower median after that insertion.", state: { final_result: "[80, 80, 80, 80]" } },
      ],
    },
  };
  const config = configs[family] || configs["heap-top-three"]!;
  return config.phases.map((phase, index) => {
    const visual = heapTreeFromArray(phase);
    let nodes = visual.nodes;
    if (phase.discarded?.length) nodes = withNodeState(nodes, phaseIds(phase, phase.discarded), "skipped");
    if (phase.visited?.length) nodes = withNodeState(nodes, phaseIds(phase, phase.visited), "visited");
    if (phase.comparing?.length) nodes = withNodeState(nodes, phaseIds(phase, phase.comparing), "comparing");
    if (phase.active.length) nodes = withNodeState(nodes, phaseIds(phase, phase.active), "active");
    const activeIds = phaseIds(phase, phase.active);
    const comparingIds = phaseIds(phase, phase.comparing || []);
    return step({
      concept: "heap",
      title: phase.title,
      description: phase.description,
      nodes,
      edges: visual.edges,
      highlights: { nodeIds: [...activeIds, ...comparingIds], lineNumbers: [phase.line] },
      code: config.code,
      activeLine: phase.line,
      state: { example: config.example, target: config.target, visual_family: family, ...phase.state },
    }, index + 1);
  });
}

export function generateTrieSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("trie", context);
  type TriePhase = {
    active: string;
    visited?: string[];
    inactive?: string[];
    edge?: string;
    edges?: string[];
    line: number;
    title: string;
    description: string;
    state: Record<string, string | number | boolean>;
  };
  type TrieConfig = {
    words: string[];
    example: string;
    target: string;
    result: string;
    code: string[];
    phases: TriePhase[];
  };
  const idForPrefix = (prefix: string) => prefix || "root";
  const edgeFor = (prefix: string) => {
    if (!prefix) return "";
    const parent = prefix.slice(0, -1);
    return `${idForPrefix(parent)}-${idForPrefix(prefix)}`;
  };
  const baseCode = [
    "start at the trie root",
    "read the next character",
    "follow the matching branch",
    "stop if the branch is missing",
    "check the prefix node",
    "use only words below that node",
    "return the requested result",
  ];
  const configs: Partial<Record<VisualizerFamily, TrieConfig>> = {
    "trie-any-prefix": {
      words: ["cat", "car", "dog"],
      example: "words=[cat, car, dog], prefix=ca",
      target: "does any word start with ca?",
      result: "true",
      code: baseCode,
      phases: [
        { active: "root", line: 1, title: context.title || "Any Word With Prefix", description: "Start at the root before checking the requested prefix.", state: { prefix: "ca", current: "root", result: "not final" } },
        { active: "c", edge: edgeFor("c"), visited: ["root"], line: 2, title: "Read c", description: "The first prefix character chooses the c branch.", state: { character: "c", current: "c", result: "not final" } },
        { active: "ca", edge: edgeFor("ca"), visited: ["root", "c"], line: 3, title: "Read a", description: "The a branch exists, so the prefix path is still alive.", state: { character: "a", current: "ca", result: "not final" } },
        { active: "ca", visited: ["root", "c"], inactive: ["dog"], line: 5, title: "Prefix node is alive", description: "The lookup does not need to scan dog because dog is outside the ca branch.", state: { prefix_node: "ca", skipped_branch: "dog", result: "not final" } },
        { active: "cat", edge: edgeFor("cat"), visited: ["root", "c", "ca"], inactive: ["dog"], line: 6, title: "Find cat below ca", description: "cat is a complete word below the prefix node.", state: { found_word: "cat", result: "true" } },
        { active: "car", edge: edgeFor("car"), visited: ["cat"], inactive: ["dog"], line: 6, title: "Another match exists", description: "car also starts with ca, but the boolean answer is already true.", state: { extra_match: "car", result: "true" } },
        { active: "ca", visited: ["cat", "car"], inactive: ["dog"], line: 7, title: "Return true", description: "Because at least one stored word starts with ca, the result is true.", state: { final_result: "true" } },
      ],
    },
    "trie-count-prefix-matches": {
      words: ["sun", "sum", "cat"],
      example: "words=[sun, sum, cat], prefix=su",
      target: "count words below su",
      result: "2",
      code: baseCode,
      phases: [
        { active: "root", line: 1, title: context.title || "Count Prefix Matches", description: "Start from the root and follow the prefix characters.", state: { prefix: "su", count: 0, result: "not final" } },
        { active: "s", edge: edgeFor("s"), visited: ["root"], line: 2, title: "Follow s", description: "Only words under s can still match su.", state: { character: "s", count: 0 } },
        { active: "su", edge: edgeFor("su"), visited: ["root", "s"], line: 3, title: "Follow u", description: "The prefix node is su, so counting starts here.", state: { current: "su", count: 0 } },
        { active: "sun", edge: edgeFor("sun"), visited: ["su"], inactive: ["cat"], line: 6, title: "Count sun", description: "sun is a complete word below su, so it adds one.", state: { matched: "sun", count: 1 } },
        { active: "sum", edge: edgeFor("sum"), visited: ["sun"], inactive: ["cat"], line: 6, title: "Count sum", description: "sum is also below su, so the count becomes two.", state: { matched: "sum", count: 2, result: "2" } },
        { active: "cat", inactive: ["cat"], line: 6, title: "Leave cat out", description: "cat starts on a different branch, so it is not counted for su.", state: { skipped_branch: "cat", count: 2, result: "2" } },
        { active: "su", visited: ["sun", "sum"], inactive: ["cat"], line: 7, title: "Return count", description: "cat is outside the su branch, so the final count stays 2.", state: { skipped_branch: "cat", final_result: "2" } },
      ],
    },
    "trie-all-share-prefix": {
      words: ["cat", "car", "camp"],
      example: "words=[cat, car, camp], prefix=ca",
      target: "does every word start with ca?",
      result: "true",
      code: ["start at the root", "test one word path at a time", "follow the prefix characters", "stop early if any word misses", "mark this word as passing", "repeat for each word", "return whether all passed"],
      phases: [
        { active: "ca", edge: edgeFor("ca"), visited: ["root", "c"], line: 1, title: context.title || "All Words Share Prefix", description: "The shared ca path is the rule every word must satisfy.", state: { prefix: "ca", passed: 0 } },
        { active: "cat", edge: edgeFor("cat"), visited: ["ca"], line: 3, title: "cat follows ca", description: "The first word reaches the prefix node before it continues to t.", state: { current_word: "cat", prefix_ok: "yes", passed: 0 } },
        { active: "cat", edge: edgeFor("cat"), visited: ["ca"], line: 2, title: "Check cat", description: "cat passes because its path begins c then a.", state: { current_word: "cat", passed: 1 } },
        { active: "car", edge: edgeFor("car"), visited: ["cat"], line: 3, title: "car follows ca", description: "The second word reaches the same ca node before it branches to r.", state: { current_word: "car", prefix_ok: "yes", passed: 1 } },
        { active: "car", edge: edgeFor("car"), visited: ["cat"], line: 5, title: "Check car", description: "car also stays under the ca prefix node.", state: { current_word: "car", passed: 2 } },
        { active: "camp", edge: edgeFor("camp"), visited: ["cat", "car"], line: 6, title: "Check camp", description: "camp shares ca too, so no word has failed.", state: { current_word: "camp", passed: 3, result: "true" } },
        { active: "ca", visited: ["cat", "car", "camp"], line: 7, title: "Return true", description: "Every listed word started with ca.", state: { final_result: "true" } },
      ],
    },
    "trie-first-word-prefix": {
      words: ["dog", "cat", "car"],
      example: "words=[dog, cat, car], prefix=ca",
      target: "return the first matching word",
      result: "cat",
      code: ["read words in list order", "walk the prefix path for the current word", "skip the word if the path misses", "stop at the first matching word", "return that word", "return none if nothing matched"],
      phases: [
        { active: "dog", edge: edgeFor("d"), line: 1, title: context.title || "First Word With Prefix", description: "List order matters here, so dog is checked first.", state: { index: 0, current_word: "dog", result: "not final" } },
        { active: "d", edge: edgeFor("d"), visited: ["root"], line: 2, title: "dog starts with d", description: "The first character already disagrees with ca.", state: { index: 0, current_word: "dog", needed: "c", saw: "d" } },
        { active: "dog", inactive: ["dog"], line: 3, title: "Skip dog", description: "dog does not start with ca, so it cannot be the first match.", state: { index: 0, skipped: "dog", result: "not final" } },
        { active: "ca", edge: edgeFor("ca"), visited: ["c"], inactive: ["dog"], line: 2, title: "Check cat", description: "The next word follows c then a, so it matches the prefix.", state: { index: 1, current_word: "cat" } },
        { active: "cat", edge: edgeFor("cat"), visited: ["ca"], inactive: ["dog"], line: 4, title: "Stop at cat", description: "cat is the first list-order word with the prefix.", state: { first_match: "cat", result: "cat" } },
        { active: "car", inactive: ["dog", "car"], line: 4, title: "Do not replace with car", description: "car matches too, but it appears after cat in the original list.", state: { later_match: "car", kept: "cat", result: "cat" } },
        { active: "cat", inactive: ["dog", "car"], line: 5, title: "Return cat", description: "car also matches, but it comes later and is not the first match.", state: { skipped_later: "car", final_result: "cat" } },
      ],
    },
    "trie-prefix-match-count": {
      words: ["code", "coding", "course"],
      example: "words=[code, coding, course], prefix=cod",
      target: "count words below cod",
      result: "2",
      code: baseCode,
      phases: [
        { active: "root", line: 1, title: context.title || "Prefix Match Count", description: "Start at the root before walking cod.", state: { prefix: "cod", count: 0 } },
        { active: "c", edge: edgeFor("c"), visited: ["root"], line: 2, title: "Follow c", description: "All sample words begin with c.", state: { current: "c", count: 0 } },
        { active: "co", edge: edgeFor("co"), visited: ["c"], line: 3, title: "Follow o", description: "The o branch is still shared.", state: { current: "co", count: 0 } },
        { active: "cod", edge: edgeFor("cod"), visited: ["co"], line: 5, title: "Reach cod", description: "Now only words below cod should be counted.", state: { current: "cod", count: 0 } },
        { active: "code", edge: edgeFor("code"), visited: ["cod"], inactive: ["cou"], line: 6, title: "Count code", description: "code is below cod, so it adds one match.", state: { matched: "code", count: 1 } },
        { active: "coding", edge: edgeFor("coding"), visited: ["code"], inactive: ["cou"], line: 6, title: "Count coding", description: "coding is also below cod, so the count becomes two.", state: { matched: "coding", count: 2, result: "2" } },
        { active: "cod", visited: ["code", "coding"], inactive: ["course"], line: 7, title: "Return 2", description: "course is under cou, not cod, so it is left out.", state: { skipped_branch: "course", final_result: "2" } },
      ],
    },
    "trie-longest-common-prefix": {
      words: ["cab", "car", "cat"],
      example: "words=[cab, car, cat]",
      target: "longest prefix shared by every word",
      result: "ca",
      code: ["start at the root", "move only while every word shares the next character", "add that character to the shared prefix", "stop when paths split or a word ends", "return the shared prefix"],
      phases: [
        { active: "root", line: 1, title: context.title || "Longest Common Prefix", description: "Begin at the shared trie root before accepting any character.", state: { shared_prefix: "", result: "not final" } },
        { active: "c", edge: edgeFor("c"), visited: ["root"], line: 2, title: "All share c", description: "Every word follows the c branch, so c can join the shared prefix.", state: { shared_prefix: "c", result: "not final" } },
        { active: "ca", edge: edgeFor("ca"), visited: ["root", "c"], line: 3, title: "Add a", description: "Every word also follows the a branch, so ca is shared.", state: { shared_prefix: "ca" } },
        { active: "cab", edge: edgeFor("cab"), visited: ["root", "c", "ca"], line: 4, title: "Try b", description: "cab continues with b, but that character is only a candidate until every word agrees.", state: { candidate_next: "b", shared_prefix: "ca" } },
        { active: "car", edge: edgeFor("car"), visited: ["root", "c", "ca"], inactive: ["cab"], line: 4, title: "car splits to r", description: "car uses r after ca, so b cannot be part of the shared prefix.", state: { split: "b vs r", shared_prefix: "ca" } },
        { active: "cat", edge: edgeFor("cat"), visited: ["root", "c", "ca"], inactive: ["cab", "car"], line: 4, title: "cat splits to t", description: "cat uses t after ca, confirming the common part stops at ca.", state: { split: "b/r/t", shared_prefix: "ca" } },
        { active: "ca", edges: [edgeFor("c"), edgeFor("ca")], visited: ["root", "c"], inactive: ["cab", "car", "cat"], line: 5, title: "Return ca", description: "The highlighted root-to-ca path is the longest path every word shares.", state: { final_result: "ca" } },
      ],
    },
    "trie-autocomplete-first": {
      words: ["cab", "car", "cat", "dog"],
      example: "words=[car, cat, cab, dog], prefix=ca, k=2",
      target: "first 2 sorted matches",
      result: "[cab, car]",
      code: ["walk to the prefix node", "explore matching words in sorted order", "save each complete word", "stop after k matches", "ignore words outside the prefix", "return the saved matches"],
      phases: [
        { active: "ca", edge: edgeFor("ca"), visited: ["root", "c"], line: 1, title: context.title || "First Autocomplete Matches", description: "Autocomplete first walks to the requested prefix node.", state: { prefix: "ca", k: 2, matches: "none" } },
        { active: "cab", edge: edgeFor("cab"), visited: ["ca"], inactive: ["dog"], line: 2, title: "Explore sorted branch b", description: "The b child comes before r and t, so cab is the first sorted match.", state: { branch: "b", saved: "none", remaining_slots: 2 } },
        { active: "cab", edge: edgeFor("cab"), visited: ["ca"], inactive: ["dog"], line: 2, title: "Take cab first", description: "Sorted autocomplete checks cab before car and cat.", state: { saved: "[cab]", remaining_slots: 1 } },
        { active: "car", edge: edgeFor("car"), visited: ["cab"], inactive: ["dog"], line: 2, title: "Move to r branch", description: "After cab, sorted order moves to car.", state: { branch: "r", saved: "[cab]", remaining_slots: 1 } },
        { active: "car", edge: edgeFor("car"), visited: ["cab"], inactive: ["dog"], line: 3, title: "Take car second", description: "car fills the second requested autocomplete slot.", state: { saved: "[cab, car]", remaining_slots: 0, result: "[cab, car]" } },
        { active: "cat", inactive: ["cat", "dog"], line: 4, title: "Stop before cat", description: "cat also matches ca, but k is already full.", state: { held_back: "cat", result: "[cab, car]" } },
        { active: "ca", visited: ["cab", "car"], inactive: ["cat", "dog"], line: 6, title: "Return matches", description: "Return the first two sorted words from the ca subtree.", state: { final_result: "[cab, car]" } },
      ],
    },
    "trie-longest-prefix-word": {
      words: ["cart", "car", "care"],
      example: "words=[cart, car, care], prefix=car",
      target: "longest word that starts with car",
      result: "care",
      code: ["walk to the prefix node", "scan complete words below it", "keep the longest match", "break ties alphabetically", "return the kept word"],
      phases: [
        { active: "root", line: 1, title: context.title || "Longest Prefix Word", description: "Start at the root before walking the requested prefix.", state: { prefix: "car", best: "none", current: "root" } },
        { active: "c", edge: edgeFor("c"), visited: ["root"], line: 1, title: "Follow c", description: "The prefix path starts by taking the c branch.", state: { prefix_path: "c", best: "none" } },
        { active: "ca", edge: edgeFor("ca"), visited: ["root", "c"], line: 1, title: "Follow a", description: "The lookup keeps walking the requested prefix.", state: { prefix_path: "ca", best: "none" } },
        { active: "car", edge: edgeFor("car"), visited: ["root", "c", "ca"], line: 1, title: "Reach car", description: "car is both a complete word and the prefix node where longer candidates branch.", state: { prefix_path: "car", candidate: "car", best: "car" } },
        { active: "cart", edge: edgeFor("cart"), visited: ["root", "c", "ca", "car"], line: 3, title: "Compare cart", description: "cart is below the car prefix and is longer than car.", state: { candidate: "cart", best: "cart" } },
        { active: "care", edge: edgeFor("care"), visited: ["root", "c", "ca", "car"], inactive: ["cart"], line: 4, title: "Tie with care", description: "care ties cart's length, and alphabetical order keeps care.", state: { candidate: "care", previous_best: "cart", best: "care", result: "care" } },
        { active: "care", edges: [edgeFor("c"), edgeFor("ca"), edgeFor("car"), edgeFor("care")], visited: ["root", "c", "ca", "car"], inactive: ["cart"], line: 5, title: "Return care", description: "The highlighted path shows the chosen word from root through the requested prefix.", state: { final_result: "care" } },
      ],
    },
    "trie-prefix-counts": {
      words: ["cat", "car", "dog"],
      example: "insert cat, car, dog; count ca",
      target: "return stored count for ca",
      result: "2",
      code: ["insert each word character by character", "increase the pass count on visited prefix nodes", "walk the query prefix", "read the count saved at that node", "return the count"],
      phases: [
        { active: "c", edge: edgeFor("c"), visited: ["root"], line: 1, title: context.title || "Trie Prefix Counts", description: "Inserting cat and car both passes through c.", state: { inserted: "cat, car", count_at_c: 2 } },
        { active: "ca", edge: edgeFor("ca"), visited: ["c"], line: 2, title: "Store ca count", description: "Two inserted words pass through ca, so ca stores count 2.", state: { prefix: "ca", count_at_ca: 2 } },
        { active: "cat", edge: edgeFor("cat"), visited: ["ca"], line: 2, title: "cat contributes once", description: "cat is one of the words counted at ca.", state: { contributing_word: "cat", count_at_ca: 2 } },
        { active: "car", edge: edgeFor("car"), visited: ["ca"], line: 2, title: "car contributes once", description: "car is the second word counted at ca.", state: { contributing_word: "car", count_at_ca: 2 } },
        { active: "d", edge: edgeFor("d"), inactive: ["d", "do", "dog"], line: 2, title: "Dog uses another branch", description: "dog updates the d path, not the ca count.", state: { skipped_branch: "dog", count_at_ca: 2 } },
        { active: "ca", edge: edgeFor("ca"), visited: ["root", "c"], inactive: ["dog"], line: 3, title: "Query ca", description: "The query walks directly back to the ca node.", state: { query: "ca", count_at_ca: 2 } },
        { active: "ca", visited: ["cat", "car"], inactive: ["dog"], line: 5, title: "Return 2", description: "The saved prefix count gives the answer without recounting all words.", state: { final_result: "2" } },
      ],
    },
    "trie-any-has-prefix": {
      words: ["cat", "car", "dog"],
      example: "words=[cat, car, dog], prefix=ca",
      target: "true if at least one word starts with ca",
      result: "true",
      code: baseCode,
      phases: [
        { active: "root", line: 1, title: context.title || "Any Word Has Prefix", description: "Start at the root and test whether ca has a live path.", state: { prefix: "ca", result: "not final" } },
        { active: "c", edge: edgeFor("c"), visited: ["root"], line: 2, title: "Follow c", description: "The c branch exists, so a match is still possible.", state: { current: "c" } },
        { active: "ca", edge: edgeFor("ca"), visited: ["c"], line: 3, title: "Follow a", description: "The ca node exists and has words below it.", state: { current: "ca", result: "true" } },
        { active: "cat", edge: edgeFor("cat"), visited: ["ca"], inactive: ["dog"], line: 6, title: "See cat below ca", description: "cat proves the prefix has at least one stored word.", state: { matching_word: "cat", result: "true" } },
        { active: "car", edge: edgeFor("car"), visited: ["cat"], inactive: ["dog"], line: 6, title: "car also matches", description: "car is another match, but one match was enough for the boolean.", state: { matching_branch: "cat, car", result: "true" } },
        { active: "dog", inactive: ["dog"], line: 6, title: "Dog is outside", description: "dog starts on a different branch and does not affect the ca answer.", state: { skipped_branch: "dog", result: "true" } },
        { active: "ca", inactive: ["dog"], line: 7, title: "Return true", description: "The prefix path exists with stored words beneath it.", state: { final_result: "true" } },
      ],
    },
  };
  const config = configs[family] || configs["trie-any-prefix"]!;
  const nodeMap = new Map<string, Node>();
  const edges: Edge[] = [];
  nodeMap.set("root", { id: "root", x: 0, y: 0, value: "root", type: "tree-node", label: "root" });
  config.words.forEach((word) => {
    let prefix = "";
    word.split("").forEach((char, index) => {
      const next = `${prefix}${char}`;
      const id = idForPrefix(next);
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          x: 0,
          y: 0,
          value: index === word.length - 1 ? word : char,
          type: "tree-node",
          label: index === word.length - 1 ? "word" : next,
          meta: index === word.length - 1 ? { terminal: true } : undefined,
        });
      } else if (index === word.length - 1) {
        nodeMap.set(id, { ...nodeMap.get(id)!, label: "word", value: word, meta: { ...(nodeMap.get(id)!.meta || {}), terminal: true } });
      }
      const parent = idForPrefix(prefix);
      const edgeId = `${parent}-${id}`;
      if (!edges.some((edge) => edge.id === edgeId)) {
        edges.push({ id: edgeId, from: parent, to: id, type: "parent-child" });
      }
      prefix = next;
    });
  });
  const parentsWithChildren = new Set(edges.map((edge) => edge.from));
  const baseNodes = Array.from(nodeMap.values()).map((node) => {
    if (node.meta?.terminal && parentsWithChildren.has(node.id)) {
      return { ...node, label: "prefix word", meta: { ...node.meta, terminal: false } };
    }
    return node;
  });
  return config.phases.map((phase, index) => {
    let nodes = withNodeState(baseNodes, phase.visited || [], "visited");
    if (phase.inactive?.length) nodes = withNodeState(nodes, phase.inactive, "inactive");
    if (phase.edges?.length) nodes = withNodeState(nodes, [...(phase.visited || []), phase.active], "path");
    nodes = withNodeState(nodes, [phase.active], "active");
    const activeEdgeIds = phase.edges || (phase.edge ? [phase.edge] : []);
    return step({
      concept: "trie",
      title: phase.title,
      description: phase.description,
      nodes,
      edges: withEdgeState(edges, activeEdgeIds, "active"),
      highlights: { nodeIds: [phase.active], edgeIds: activeEdgeIds, lineNumbers: [phase.line] },
      code: config.code,
      activeLine: phase.line,
      state: { example: config.example, target: config.target, visual_family: family, result: index === config.phases.length - 1 ? config.result : "not final", ...phase.state },
    }, index + 1);
  });
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
  const family = detectVisualizerFamily("dynamic-programming", context);
  type DPPhase = {
    active: number;
    filled: Array<string | number>;
    deps?: number[];
    line: number;
    title: string;
    description: string;
    state: Record<string, string | number | boolean>;
  };
  type DPConfig = {
    labels: string[];
    example: string;
    target: string;
    code: string[];
    phases: DPPhase[];
  };
  const configs: Partial<Record<VisualizerFamily, DPConfig>> = {
    "dp-climb-stairs": {
      labels: ["ways 0", "ways 1", "ways 2", "ways 3", "ways 4"],
      example: "n=4",
      target: "count ways to reach step 4",
      code: ["name the target step", "save ways for step 0 and step 1", "read the previous two saved steps", "answer = one step back + two steps back", "save ways for this step", "repeat until the target step", "read the target state", "return the saved answer"],
      phases: [
        { active: 4, filled: ["", "", "", "", ""], line: 1, title: context.title || "Climb Small Staircase", description: "The answer is stored at the target step, but smaller steps must be saved first.", state: { current_state: "ways 4", rule_label: "goal", rule: "build from smaller stair counts", action: "target is step 4" } },
        { active: 0, filled: [1, 1, "", "", ""], line: 2, title: "Save base steps", description: "There is 1 way to stand at step 0 and 1 way to reach step 1.", state: { current_state: "ways 0 and ways 1", saved: "1, 1", action: "base states are ready" } },
        { active: 2, deps: [1, 0], filled: [1, 1, "", "", ""], line: 3, title: "Build step 2", description: "Step 2 can come from step 1 or step 0.", state: { current_state: "ways 2", read_from: "ways 1, ways 0", rule: "1 + 1", action: "combine previous two states" } },
        { active: 2, filled: [1, 1, 2, "", ""], line: 5, title: "Save ways 2", description: "Save 2 so later steps can reuse it.", state: { current_state: "ways 2", saved: 2, result: 2, action: "store ways[2]" } },
        { active: 3, deps: [2, 1], filled: [1, 1, 2, 3, ""], line: 4, title: "Save ways 3", description: "Use the two saved states behind step 3.", state: { current_state: "ways 3", read_from: "ways 2, ways 1", rule: "2 + 1 = 3", result: 3 } },
        { active: 4, deps: [3, 2], filled: [1, 1, 2, 3, ""], line: 3, title: "Build target step", description: "The target step reads the two saved answers directly before saving.", state: { current_state: "ways 4", read_from: "ways 3, ways 2", rule: "3 + 2", action: "no recalculation needed" } },
        { active: 4, filled: [1, 1, 2, 3, 5], line: 5, title: "Save ways 4", description: "Step 4 has 5 possible paths.", state: { current_state: "ways 4", saved: 5, result: 5 } },
        { active: 4, filled: [1, 1, 2, 3, 5], line: 8, title: "Return 5", description: "Return the saved value at the target state.", state: { current_state: "ways 4", final_result: 5 } },
      ],
    },
    "dp-min-cost-stairs": {
      labels: ["cost 0", "cost 1", "cost 2", "top"],
      example: "costs=[2,5,1]",
      target: "minimum cost to reach top",
      code: ["save the cost of the first two places", "for each next place, read the two ways to arrive", "choose the cheaper previous cost", "add the current cost if this is a paid step", "save the best cost here", "repeat to the top", "compare the final two positions", "return the cheaper total"],
      phases: [
        { active: 0, filled: [2, "", "", ""], line: 1, title: context.title || "Tiny Minimum Stair Cost", description: "Start by saving the cost of landing on the first step.", state: { current_state: "cost 0", paid: 2, result: 2 } },
        { active: 1, filled: [2, 5, "", ""], line: 1, title: "Save second step", description: "The second step can also be a starting point.", state: { current_state: "cost 1", paid: 5, result: 5 } },
        { active: 2, deps: [1, 0], filled: [2, 5, "", ""], line: 2, title: "Read ways to step 2", description: "Step 2 can be reached from step 1 or step 0.", state: { current_state: "cost 2", read_from: "cost 1, cost 0", rule: "choose cheaper previous" } },
        { active: 2, deps: [1, 0], filled: [2, 5, "", ""], line: 3, title: "Choose cost 0", description: "2 is cheaper than 5, so use it before adding this step's cost.", state: { current_state: "cost 2", chosen: 2, decision: "cost 0" } },
        { active: 2, filled: [2, 5, 3, ""], line: 5, title: "Save cost 2", description: "Add step cost 1 to the cheaper previous total: 2 + 1 = 3.", state: { current_state: "cost 2", saved: 3, result: 3 } },
        { active: 3, deps: [2, 1], filled: [2, 5, 3, ""], line: 7, title: "Compare final positions", description: "The top can be reached from the last two saved positions.", state: { current_state: "top", read_from: "cost 2, cost 1", rule: "min(3, 5)" } },
        { active: 3, filled: [2, 5, 3, 3], line: 8, title: "Save top cost", description: "The cheaper total to reach the top is 3.", state: { current_state: "top", saved: 3, result: 3 } },
        { active: 3, filled: [2, 5, 3, 3], line: 8, title: "Return 3", description: "Return the saved minimum top cost.", state: { current_state: "top", final_result: 3 } },
      ],
    },
    "dp-one-three-steps": {
      labels: ["ways 0", "ways 1", "ways 2", "ways 3", "ways 4"],
      example: "n=4",
      target: "use jumps of 1 or 3",
      code: ["save the starting step", "read the one-step-back state", "also read the three-step-back state when it exists", "answer = allowed saved ways added together", "save ways for this step", "repeat to n", "read ways at n", "return the saved answer"],
      phases: [
        { active: 0, filled: [1, "", "", "", ""], line: 1, title: context.title || "Ways With One Or Three Steps", description: "There is one way to be at the ground before taking steps.", state: { current_state: "ways 0", saved: 1 } },
        { active: 1, deps: [0], filled: [1, 1, "", "", ""], line: 2, title: "Reach step 1", description: "Only a 1-step jump can reach step 1.", state: { current_state: "ways 1", read_from: "ways 0", result: 1 } },
        { active: 2, deps: [1], filled: [1, 1, 1, "", ""], line: 2, title: "Reach step 2", description: "Again only the one-step-back state is valid.", state: { current_state: "ways 2", read_from: "ways 1", result: 1 } },
        { active: 3, deps: [2, 0], filled: [1, 1, 1, "", ""], line: 3, title: "Step 3 has two sources", description: "Step 3 can come from step 2 or from step 0 using a 3-step jump.", state: { current_state: "ways 3", read_from: "ways 2, ways 0", rule: "1 + 1" } },
        { active: 3, filled: [1, 1, 1, 2, ""], line: 5, title: "Save ways 3", description: "Store 2 ways for step 3.", state: { current_state: "ways 3", result: 2 } },
        { active: 4, deps: [3, 1], filled: [1, 1, 1, 2, ""], line: 3, title: "Build step 4", description: "Step 4 reads step 3 and step 1.", state: { current_state: "ways 4", read_from: "ways 3, ways 1", rule: "2 + 1" } },
        { active: 4, filled: [1, 1, 1, 2, 3], line: 5, title: "Save ways 4", description: "The target state stores 3.", state: { current_state: "ways 4", result: 3 } },
        { active: 4, filled: [1, 1, 1, 2, 3], line: 8, title: "Return 3", description: "Return the saved answer for n = 4.", state: { current_state: "ways 4", final_result: 3 } },
      ],
    },
    "dp-best-non-adjacent": {
      labels: ["item 0", "item 1", "item 2"],
      example: "points=[4,1,7]",
      target: "best total without adjacent items",
      code: ["save the best before any item", "for each item, compare take vs skip", "take means add current points to the best two back", "skip means keep the previous best", "save the larger choice", "repeat to the last item", "read the last saved best", "return the best total"],
      phases: [
        { active: 0, filled: [4, "", ""], line: 1, title: context.title || "Best Non Adjacent Total", description: "The first item can be taken, so the best starts at 4.", state: { current_state: "item 0", take: 4, skip: 0, result: 4 } },
        { active: 1, deps: [0], filled: [4, "", ""], line: 2, title: "Check item 1", description: "Item 1 is adjacent to item 0, so compare taking 1 with skipping it.", state: { current_state: "item 1", take: 1, skip: 4 } },
        { active: 1, filled: [4, 4, ""], line: 5, title: "Save best 4", description: "Skipping item 1 keeps the better total.", state: { current_state: "item 1", decision: "skip", result: 4 } },
        { active: 2, deps: [0, 1], filled: [4, 4, ""], line: 3, title: "Check item 2", description: "Taking 7 can combine with the best before item 1.", state: { current_state: "item 2", read_from: "item 0 and item 1", take: 11, skip: 4 } },
        { active: 2, filled: [4, 4, 11], line: 5, title: "Save best 11", description: "4 + 7 beats skipping, so save 11.", state: { current_state: "item 2", decision: "take", result: 11 } },
        { active: 2, filled: [4, 4, 11], line: 6, title: "Last item reached", description: "Every item has a saved best total.", state: { current_state: "item 2", saved: "4, 4, 11" } },
        { active: 2, filled: [4, 4, 11], line: 7, title: "Read final best", description: "The last saved state is the whole-list answer.", state: { current_state: "item 2", result: 11 } },
        { active: 2, filled: [4, 4, 11], line: 8, title: "Return 11", description: "Return the best non-adjacent total.", state: { current_state: "item 2", final_result: 11 } },
      ],
    },
    "dp-study-plan-ways": {
      labels: ["day 0", "day 1", "day 2", "day 3", "day 4"],
      example: "days=4",
      target: "count study plans through day 4",
      code: ["save the empty plan", "save one-day plans", "read the last two saved days", "answer = yesterday + two days back", "save plans for this day", "repeat to the target day", "read the target day", "return the count"],
      phases: [
        { active: 0, filled: [1, "", "", "", ""], line: 1, title: context.title || "Study Plan Ways", description: "Start with one empty plan before any days are scheduled.", state: { current_state: "day 0", saved: 1 } },
        { active: 1, filled: [1, 1, "", "", ""], line: 2, title: "Save day 1", description: "There is one simple plan for one day.", state: { current_state: "day 1", result: 1 } },
        { active: 2, deps: [1, 0], filled: [1, 1, "", "", ""], line: 3, title: "Build day 2", description: "Day 2 reuses day 1 and day 0.", state: { current_state: "day 2", read_from: "day 1, day 0", rule: "1 + 1" } },
        { active: 2, filled: [1, 1, 2, "", ""], line: 5, title: "Save day 2", description: "Store 2 plans for day 2.", state: { current_state: "day 2", result: 2 } },
        { active: 3, deps: [2, 1], filled: [1, 1, 2, 3, ""], line: 4, title: "Save day 3", description: "Day 3 uses the same two-saved-states rule.", state: { current_state: "day 3", rule: "2 + 1 = 3", result: 3 } },
        { active: 4, deps: [3, 2], filled: [1, 1, 2, 3, ""], line: 3, title: "Build day 4", description: "The target reads day 3 and day 2.", state: { current_state: "day 4", read_from: "day 3, day 2", rule: "3 + 2" } },
        { active: 4, filled: [1, 1, 2, 3, 5], line: 5, title: "Save day 4", description: "Day 4 stores 5 plans.", state: { current_state: "day 4", result: 5 } },
        { active: 4, filled: [1, 1, 2, 3, 5], line: 8, title: "Return 5", description: "Return the saved count for the target day.", state: { current_state: "day 4", final_result: 5 } },
      ],
    },
    "dp-non-adjacent-points": {
      labels: ["item 0", "item 1", "item 2", "item 3"],
      example: "points=[3,2,7,10]",
      target: "best total without adjacent picks",
      code: ["start with no adjacent picks chosen", "compare taking the current item with skipping it", "take uses current points plus the best two back", "skip keeps the previous best", "save the larger choice", "repeat across the list", "read the last saved best", "return the best total"],
      phases: [
        { active: 0, filled: [3, "", "", ""], line: 1, title: context.title || "Non Adjacent Points", description: "The first saved best is 3.", state: { current_state: "item 0", result: 3 } },
        { active: 1, deps: [0], filled: [3, "", "", ""], line: 2, title: "Compare item 1", description: "Taking 2 loses to keeping 3.", state: { current_state: "item 1", take: 2, skip: 3 } },
        { active: 1, filled: [3, 3, "", ""], line: 5, title: "Save 3", description: "The best through item 1 is still 3.", state: { current_state: "item 1", result: 3 } },
        { active: 2, deps: [0, 1], filled: [3, 3, "", ""], line: 3, title: "Compare item 2", description: "Taking 7 can pair with item 0's saved best.", state: { current_state: "item 2", take: 10, skip: 3 } },
        { active: 2, filled: [3, 3, 10, ""], line: 5, title: "Save 10", description: "3 + 7 is the best through item 2.", state: { current_state: "item 2", result: 10 } },
        { active: 3, deps: [1, 2], filled: [3, 3, 10, ""], line: 3, title: "Compare item 3", description: "Taking 10 combines with best through item 1.", state: { current_state: "item 3", take: 13, skip: 10 } },
        { active: 3, filled: [3, 3, 10, 13], line: 5, title: "Save 13", description: "13 is the best through the whole list.", state: { current_state: "item 3", result: 13 } },
        { active: 3, filled: [3, 3, 10, 13], line: 8, title: "Return 13", description: "Return the last saved best total.", state: { current_state: "item 3", final_result: 13 } },
      ],
    },
    "dp-lis": {
      labels: ["2", "5", "3", "7"],
      example: "nums=[2,5,3,7]",
      target: "longest increasing subsequence length",
      code: ["each number starts with length 1", "look left for smaller numbers", "read saved lengths from smaller previous values", "candidate = saved length + 1", "save the best length ending here", "repeat for each number", "read the largest saved length", "return that length"],
      phases: [
        { active: 0, filled: [1, "", "", ""], line: 1, title: context.title || "Longest Increasing Subsequence Length", description: "A single number is an increasing subsequence of length 1.", state: { current_state: "ending at 2", result: 1 } },
        { active: 1, deps: [0], filled: [1, "", "", ""], line: 3, title: "5 can follow 2", description: "Since 2 < 5, read the saved length at 2.", state: { current_state: "ending at 5", read_from: "2", rule: "1 + 1" } },
        { active: 1, filled: [1, 2, "", ""], line: 5, title: "Save length 2", description: "The best sequence ending at 5 has length 2.", state: { current_state: "ending at 5", result: 2 } },
        { active: 2, deps: [0], filled: [1, 2, "", ""], line: 3, title: "3 can follow 2", description: "3 cannot follow 5, but it can follow 2.", state: { current_state: "ending at 3", read_from: "2", rule: "1 + 1" } },
        { active: 2, filled: [1, 2, 2, ""], line: 5, title: "Save length 2", description: "The best sequence ending at 3 has length 2.", state: { current_state: "ending at 3", result: 2 } },
        { active: 3, deps: [1, 2], filled: [1, 2, 2, ""], line: 3, title: "7 reads earlier bests", description: "7 can follow 5 or 3, so read the best saved lengths before it.", state: { current_state: "ending at 7", read_from: "5 and 3", rule: "max(2, 2) + 1" } },
        { active: 3, filled: [1, 2, 2, 3], line: 5, title: "Save length 3", description: "The best increasing subsequence in this compact example has length 3.", state: { current_state: "ending at 7", result: 3 } },
        { active: 3, filled: [1, 2, 2, 3], line: 8, title: "Return 3", description: "Return the largest saved length.", state: { current_state: "best saved length", final_result: 3 } },
      ],
    },
    "dp-edit-distance": {
      labels: ["", "c", "a", "t", "cut"],
      example: "cat -> cut",
      target: "minimum edits from cat to cut",
      code: ["base states handle empty text", "compare the current characters", "if characters match, reuse the diagonal saved state", "otherwise read replace, insert, and delete states", "save one plus the cheapest edit", "move to the next character pair", "read the final state", "return the edit count"],
      phases: [
        { active: 0, filled: [0, "", "", "", ""], line: 1, title: context.title || "Edit Distance", description: "Empty-to-empty costs 0 edits.", state: { current_state: "empty prefix", result: 0 } },
        { active: 1, deps: [0], filled: [0, 0, "", "", ""], line: 3, title: "c matches c", description: "Matching characters reuse the diagonal saved state.", state: { current_state: "c -> c", rule: "reuse 0", result: 0 } },
        { active: 2, deps: [1], filled: [0, 0, 0, "", ""], line: 3, title: "a matches a", description: "Another match keeps the edit count at 0.", state: { current_state: "ca -> ca", rule: "reuse 0", result: 0 } },
        { active: 3, deps: [2], filled: [0, 0, 0, "", ""], line: 2, title: "t versus u", description: "The last characters differ, so an edit is needed.", state: { current_state: "cat -> cau", decision: "different characters" } },
        { active: 3, deps: [2], filled: [0, 0, 0, 1, ""], line: 5, title: "Save one replace", description: "Replacing t with u costs 1 edit.", state: { current_state: "cat -> cau", rule: "0 + 1", result: 1 } },
        { active: 4, deps: [3], filled: [0, 0, 0, 1, ""], line: 6, title: "Finish target prefix", description: "The compact trace reaches the target word shape.", state: { current_state: "cat -> cut", read_from: "saved edit states", result: 1 } },
        { active: 4, filled: [0, 0, 0, 1, 1], line: 7, title: "Read final state", description: "The final saved state holds the edit count.", state: { current_state: "cat -> cut", result: 1 } },
        { active: 4, filled: [0, 0, 0, 1, 1], line: 8, title: "Return 1", description: "Return the minimum edit count for the compact example.", state: { current_state: "final state", final_result: 1 } },
      ],
    },
    "dp-decode-ways": {
      labels: ["pos 0", "pos 1", "pos 2", "pos 3"],
      example: "digits=226",
      target: "count valid decodings",
      code: ["save one way before reading digits", "read the one-digit choice", "read the two-digit choice when valid", "add the saved counts for valid choices", "save ways at this position", "repeat through all digits", "read the final position", "return the count"],
      phases: [
        { active: 0, filled: [1, "", "", ""], line: 1, title: context.title || "Decode Ways", description: "Before reading digits, there is one empty decoding.", state: { current_state: "pos 0", result: 1 } },
        { active: 1, deps: [0], filled: [1, 1, "", ""], line: 2, title: "Decode 2", description: "The first digit is valid by itself.", state: { current_state: "pos 1", one_digit: "2", result: 1 } },
        { active: 2, deps: [1, 0], filled: [1, 1, "", ""], line: 3, title: "Decode 22", description: "The second 2 works alone, and 22 also works together.", state: { current_state: "pos 2", one_digit: "2", two_digit: "22" } },
        { active: 2, filled: [1, 1, 2, ""], line: 5, title: "Save 2 ways", description: "Add the one-digit and two-digit saved counts.", state: { current_state: "pos 2", result: 2 } },
        { active: 3, deps: [2, 1], filled: [1, 1, 2, ""], line: 3, title: "Decode 226", description: "6 is valid alone and 26 is valid as a pair.", state: { current_state: "pos 3", one_digit: "6", two_digit: "26" } },
        { active: 3, filled: [1, 1, 2, 3], line: 5, title: "Save 3 ways", description: "The final position stores 3 decodings.", state: { current_state: "pos 3", result: 3 } },
        { active: 3, filled: [1, 1, 2, 3], line: 7, title: "Read final position", description: "The answer is already saved at the end.", state: { current_state: "pos 3", result: 3 } },
        { active: 3, filled: [1, 1, 2, 3], line: 8, title: "Return 3", description: "Return the number of valid decodings.", state: { current_state: "pos 3", final_result: 3 } },
      ],
    },
    "dp-max-subarray-deletion": {
      labels: ["1", "-2", "0", "3"],
      example: "values=[1,-2,0,3]",
      target: "max subarray sum with one deletion",
      code: ["track best ending here without deletion", "track best ending here after one deletion", "read previous saved states", "choose extend, start over, or delete current value", "save both states for this index", "update the global best", "repeat through the list", "return the best sum"],
      phases: [
        { active: 0, filled: ["keep 1", "", "", ""], line: 1, title: context.title || "Maximum Subarray With One Deletion", description: "At value 1, the best kept subarray is 1.", state: { current_state: "index 0", keep: 1, delete_used: "none", result: 1 } },
        { active: 1, deps: [0], filled: ["keep 1", "", "", ""], line: 3, title: "Read previous states", description: "At -2, decide whether to keep it or spend the deletion.", state: { current_state: "index 1", value: -2, read_from: "index 0" } },
        { active: 1, filled: ["keep 1", "drop -2", "", ""], line: 4, title: "Delete -2", description: "Deleting -2 keeps the better total 1.", state: { current_state: "index 1", keep: -1, delete_used: 1, result: 1 } },
        { active: 2, deps: [1], filled: ["keep 1", "drop -2", "keep 0", ""], line: 5, title: "Save at 0", description: "Adding 0 keeps the best deletion-used state at 1.", state: { current_state: "index 2", keep: 0, delete_used: 1, result: 1 } },
        { active: 3, deps: [2], filled: ["keep 1", "drop -2", "keep 0", ""], line: 3, title: "Read before 3", description: "The previous deletion-used state can extend with 3.", state: { current_state: "index 3", read_from: "index 2", rule: "1 + 3" } },
        { active: 3, filled: ["keep 1", "drop -2", "keep 0", "best 4"], line: 6, title: "Update best to 4", description: "Using the deletion on -2 gives subarray 1, 0, 3 for total 4.", state: { current_state: "index 3", result: 4 } },
        { active: 3, filled: ["keep 1", "drop -2", "keep 0", "best 4"], line: 7, title: "End of list", description: "All states have been processed.", state: { current_state: "index 3", best: 4 } },
        { active: 3, filled: ["keep 1", "drop -2", "keep 0", "best 4"], line: 8, title: "Return 4", description: "Return the best saved subarray sum.", state: { current_state: "global best", final_result: 4 } },
      ],
    },
    "dp-maximal-square": {
      labels: ["0,0", "0,1", "1,0", "1,1"],
      example: "grid=[[1,1],[1,1]]",
      target: "largest square area",
      code: ["read each grid cell", "a 1 can extend a square", "read top, left, and diagonal saved sizes", "new size = 1 + smallest neighbor", "save square size at this cell", "track the largest size", "square area is size times size", "return the largest area"],
      phases: [
        { active: 0, filled: [1, "", "", ""], line: 2, title: context.title || "Maximal Square", description: "A 1 in the corner forms a square of size 1.", state: { current_state: "cell 0,0", result: 1 } },
        { active: 1, deps: [0], filled: [1, 1, "", ""], line: 5, title: "Save top row", description: "Top-row cells can only make size-1 squares.", state: { current_state: "cell 0,1", result: 1 } },
        { active: 2, deps: [0], filled: [1, 1, 1, ""], line: 5, title: "Save left column", description: "Left-column cells also stay size 1.", state: { current_state: "cell 1,0", result: 1 } },
        { active: 3, deps: [0, 1, 2], filled: [1, 1, 1, ""], line: 3, title: "Read three neighbors", description: "The bottom-right cell can extend only if top, left, and diagonal all support it.", state: { current_state: "cell 1,1", read_from: "top, left, diagonal" } },
        { active: 3, deps: [0, 1, 2], filled: [1, 1, 1, ""], line: 4, title: "Smallest neighbor is 1", description: "1 plus the smallest neighbor gives square size 2.", state: { current_state: "cell 1,1", rule: "1 + min(1,1,1)" } },
        { active: 3, filled: [1, 1, 1, 2], line: 6, title: "Track largest size 2", description: "The largest square side is now 2.", state: { current_state: "cell 1,1", best_size: 2 } },
        { active: 3, filled: [1, 1, 1, 2], line: 7, title: "Area is 4", description: "A side length of 2 makes area 4.", state: { current_state: "area", result: 4 } },
        { active: 3, filled: [1, 1, 1, 2], line: 8, title: "Return 4", description: "Return the largest square area.", state: { current_state: "largest area", final_result: 4 } },
      ],
    },
    "dp-study-plan-cost": {
      labels: ["cost 0", "cost 1", "cost 2", "top"],
      example: "costs=[10,15,20]",
      target: "minimum study plan cost",
      code: ["save the first two costs", "read the two previous saved costs", "choose the cheaper previous path", "add the current cost", "save the best cost here", "repeat to the top", "compare the final two saved costs", "return the cheaper total"],
      phases: [
        { active: 0, filled: [10, "", "", ""], line: 1, title: context.title || "Minimum Study Plan Cost", description: "Save the cost if the plan starts at the first session.", state: { current_state: "cost 0", result: 10 } },
        { active: 1, filled: [10, 15, "", ""], line: 1, title: "Save cost 1", description: "The second session can also be a starting state.", state: { current_state: "cost 1", result: 15 } },
        { active: 2, deps: [1, 0], filled: [10, 15, "", ""], line: 2, title: "Read previous costs", description: "To reach cost 2, read cost 1 and cost 0.", state: { current_state: "cost 2", read_from: "cost 1, cost 0" } },
        { active: 2, deps: [0], filled: [10, 15, "", ""], line: 3, title: "Choose cheaper path", description: "10 is cheaper than 15.", state: { current_state: "cost 2", chosen: 10 } },
        { active: 2, filled: [10, 15, 30, ""], line: 5, title: "Save cost 2", description: "10 + 20 gives 30 for the last paid session.", state: { current_state: "cost 2", result: 30 } },
        { active: 3, deps: [2, 1], filled: [10, 15, 30, ""], line: 7, title: "Compare paths to top", description: "The top can come from cost 2 or cost 1.", state: { current_state: "top", read_from: "cost 2, cost 1", rule: "min(30,15)" } },
        { active: 3, filled: [10, 15, 30, 15], line: 8, title: "Save top 15", description: "The cheaper way to finish is 15.", state: { current_state: "top", result: 15 } },
        { active: 3, filled: [10, 15, 30, 15], line: 8, title: "Return 15", description: "Return the minimum saved cost.", state: { current_state: "top", final_result: 15 } },
      ],
    },
    "dp-coin-change": {
      labels: ["amt 0", "amt 1", "amt 2", "amt 3", "amt 4"],
      example: "coins=[1,2], amount=4",
      target: "count combinations for amount 4",
      code: ["save one way to make amount 0", "process one coin value at a time", "for each amount, read amount minus coin", "add that saved count into the current amount", "save the updated count", "repeat through the target amount", "read target amount", "return the count"],
      phases: [
        { active: 0, filled: [1, 0, 0, 0, 0], line: 1, title: context.title || "Coin Change Ways Small", description: "Amount 0 starts with one empty combination.", state: { current_state: "amount 0", result: 1 } },
        { active: 1, deps: [0], filled: [1, 1, 0, 0, 0], line: 4, title: "Use coin 1", description: "Coin 1 adds one way to make amount 1.", state: { current_state: "amount 1", coin: 1, read_from: "amount 0", result: 1 } },
        { active: 2, deps: [1], filled: [1, 1, 1, 0, 0], line: 5, title: "Continue coin 1", description: "Using only coin 1 gives one way for amount 2.", state: { current_state: "amount 2", coin: 1, result: 1 } },
        { active: 2, deps: [0], filled: [1, 1, 2, 0, 0], line: 3, title: "Use coin 2", description: "Coin 2 can also make amount 2 by reading amount 0.", state: { current_state: "amount 2", coin: 2, read_from: "amount 0", result: 2 } },
        { active: 3, deps: [1], filled: [1, 1, 2, 2, 0], line: 4, title: "Update amount 3", description: "Amount 3 gains combinations from amount 1.", state: { current_state: "amount 3", coin: 2, result: 2 } },
        { active: 4, deps: [2], filled: [1, 1, 2, 2, 3], line: 5, title: "Update amount 4", description: "Amount 4 gains combinations from amount 2.", state: { current_state: "amount 4", coin: 2, read_from: "amount 2", result: 3 } },
        { active: 4, filled: [1, 1, 2, 2, 3], line: 7, title: "Read target amount", description: "The target amount cell now stores all combinations.", state: { current_state: "amount 4", result: 3 } },
        { active: 4, filled: [1, 1, 2, 2, 3], line: 8, title: "Return 3", description: "Return the saved count for amount 4.", state: { current_state: "amount 4", final_result: 3 } },
      ],
    },
    "dp-blocked-stairs": {
      labels: ["step 0", "step 1", "step 2", "step 3"],
      example: "openSteps=[1,1,0,1]",
      target: "ways to reach last open step",
      code: ["start from the first open step", "if a step is blocked, save 0", "otherwise read one and two steps back", "answer = saved ways from reachable previous steps", "save ways for this step", "repeat to the final step", "read the final saved state", "return the count"],
      phases: [
        { active: 0, filled: [1, "", "", ""], line: 1, title: context.title || "Blocked Stair Ways", description: "Step 0 is open, so it starts with one way.", state: { current_state: "step 0", open: "yes", result: 1 } },
        { active: 1, deps: [0], filled: [1, 1, "", ""], line: 3, title: "Step 1 is open", description: "Step 1 can be reached from step 0.", state: { current_state: "step 1", read_from: "step 0", result: 1 } },
        { active: 2, filled: [1, 1, "", ""], line: 2, title: "Step 2 is blocked", description: "A blocked step saves 0 ways no matter what came before.", state: { current_state: "step 2", open: "no", decision: "blocked" } },
        { active: 2, filled: [1, 1, 0, ""], line: 5, title: "Save 0", description: "No path may land on step 2.", state: { current_state: "step 2", result: 0 } },
        { active: 3, deps: [2, 1], filled: [1, 1, 0, ""], line: 3, title: "Final step is open", description: "The final step reads step 2 and step 1.", state: { current_state: "step 3", read_from: "step 2, step 1" } },
        { active: 3, filled: [1, 1, 0, 1], line: 5, title: "Save 1", description: "Only the path from step 1 counts because step 2 is blocked.", state: { current_state: "step 3", result: 1 } },
        { active: 3, filled: [1, 1, 0, 1], line: 7, title: "Read final state", description: "The last step stores the answer.", state: { current_state: "step 3", result: 1 } },
        { active: 3, filled: [1, 1, 0, 1], line: 8, title: "Return 1", description: "Return the count for this compact blocked-stair example.", state: { current_state: "step 3", final_result: 1 } },
      ],
    },
  };
  const config = configs[family] || configs["dp-climb-stairs"]!;
  const labels = config.phases.map((phase) => phase.title);
  return config.phases.map((phase, index) => {
    const gap = Math.min(120, Math.max(78, 680 / Math.max(config.labels.length, 1)));
    const totalWidth = Math.max(0, (config.labels.length - 1) * gap);
    const startX = 470 - totalWidth / 2;
    const nodes: Node[] = config.labels.map((label, nodeIndex) => ({
      id: `dp-${nodeIndex}`,
      x: startX + nodeIndex * gap,
      y: 245,
      value: phase.filled[nodeIndex] ?? "",
      type: "array-cell",
      label,
      state: nodeIndex < phase.filled.length && phase.filled[nodeIndex] !== "" ? "visited" : "default",
      meta: { role: "dp-state" },
    }));
    const deps = phase.deps || [];
    const edges: Edge[] = deps.map((dep) => ({
      id: `dp-${dep}->dp-${phase.active}`,
      from: `dp-${dep}`,
      to: `dp-${phase.active}`,
      type: "pointer",
      state: "active",
    }));
    return step({
      concept: "dynamic-programming",
      title: phase.title,
      description: phase.description,
      nodes: withNodeState(nodes, [`dp-${phase.active}`], "active"),
      edges,
      highlights: { nodeIds: [`dp-${phase.active}`, ...deps.map((dep) => `dp-${dep}`)], edgeIds: edges.map((edge) => edge.id || ""), lineNumbers: [phase.line] },
      code: config.code,
      activeLine: phase.line,
      workflow: workflowFromLabels(labels, index),
      state: { example: config.example, target: config.target, ...phase.state },
    }, index + 1);
  });
}

export function generateBitSteps(context: GeneratorContext = {}): Step[] {
  const family = detectVisualizerFamily("bit-manipulation", context);
  type BitPhase = {
    bits: string;
    active: number;
    title: string;
    desc: string;
    line: number;
    state: Record<string, string | number | boolean>;
    inactive?: number[];
  };
  type BitConfig = {
    example: string;
    target: string;
    result: string;
    code: string[];
    phases: BitPhase[];
  };
  const bitCode = [
    "write the number as bits",
    "focus on the bit or pair being tested",
    "update only the tracked state",
    "move to the next needed bit",
    "stop when the prompt rule is decided",
    "return only the requested value",
  ];
  const powerTwoUsesSecondExample = /\bn\s*=\s*18\b/.test(String(context.exampleInput || ""));
  const powerTwoBits = powerTwoUsesSecondExample ? "10010" : "10000";
  const powerTwoNumber = powerTwoUsesSecondExample ? 18 : 16;
  const powerTwoResult = powerTwoUsesSecondExample ? "false" : "true";
  const configs: Partial<Record<VisualizerFamily, BitConfig>> = {
    "bit-count": {
      example: "n=13, bits=1101",
      target: "count 1 bits",
      result: "3",
      code: bitCode,
      phases: [
        { bits: "1101", active: 0, line: 1, title: context.title || "Count Set Bits", desc: "Write 13 as bits so each flag can be inspected.", state: { number: 13, bits: "1101", count: 0 } },
        { bits: "1101", active: 0, line: 2, title: "Inspect left 1", desc: "The first visible bit is on, so the count changes.", state: { current_bit: 1, count: 1 } },
        { bits: "1101", active: 1, line: 2, title: "Inspect next 1", desc: "This bit is also on.", state: { current_bit: 1, count: 2 } },
        { bits: "1101", active: 2, line: 2, title: "Inspect 0", desc: "A 0 is off, so the count stays the same.", state: { current_bit: 0, count: 2 } },
        { bits: "1101", active: 3, line: 2, title: "Inspect last 1", desc: "The last bit is on.", state: { current_bit: 1, count: 3 } },
        { bits: "1101", active: 3, line: 5, title: "All bits checked", desc: "Every visible bit has been read once.", state: { checked: "4 bits", count: 3 } },
        { bits: "1101", active: 3, line: 6, title: "Return count", desc: "Return the tracked count of on bits.", state: { final_result: "3" } },
      ],
    },
    "bit-count-small": {
      example: "n=13, bits=1101",
      target: "count 1 bits",
      result: "3",
      code: bitCode,
      phases: [
        { bits: "1101", active: 0, line: 1, title: context.title || "Count Set Bits Small", desc: "Use the same small number from the prompt.", state: { number: 13, bits: "1101", count: 0 } },
        { bits: "1101", active: 0, line: 2, title: "First bit is on", desc: "An on bit increases the running count.", state: { current_bit: 1, count: 1 } },
        { bits: "1101", active: 1, line: 2, title: "Second bit is on", desc: "The second on bit is counted separately.", state: { current_bit: 1, count: 2 } },
        { bits: "1101", active: 2, line: 2, title: "Zero is skipped", desc: "An off bit does not change the count.", state: { current_bit: 0, count: 2 } },
        { bits: "1101", active: 3, line: 2, title: "Last bit is on", desc: "The final bit adds one more.", state: { current_bit: 1, count: 3 } },
        { bits: "1101", active: 3, line: 5, title: "No bits left", desc: "The scan has reached the end of the bit string.", state: { count: 3, checked: "done" } },
        { bits: "1101", active: 3, line: 6, title: "Return count", desc: "Return the count, not the original number.", state: { final_result: "3" } },
      ],
    },
    "bit-power-two": {
      example: `n=${powerTwoNumber}, bits=${powerTwoBits}`,
      target: "exactly one 1 bit",
      result: powerTwoResult,
      code: bitCode,
      phases: powerTwoUsesSecondExample ? [
        { bits: powerTwoBits, active: 0, line: 1, title: context.title || "Power Of Two Check", desc: "Write the positive number in binary.", state: { number: powerTwoNumber, ones_seen: 0, result: "not final" } },
        { bits: powerTwoBits, active: 0, line: 2, title: "Find first on bit", desc: "The first bit is on, so remember that one has appeared.", state: { current_bit: 1, ones_seen: 1 } },
        { bits: powerTwoBits, active: 1, line: 2, title: "Read an off bit", desc: "A 0 does not add another on bit.", state: { current_bit: 0, ones_seen: 1 } },
        { bits: powerTwoBits, active: 2, line: 2, title: "Read another off bit", desc: "Still only one on bit so far.", state: { current_bit: 0, ones_seen: 1 } },
        { bits: powerTwoBits, active: 3, line: 2, title: "Find second on bit", desc: "A second 1 means this is not exactly one on bit.", state: { current_bit: 1, ones_seen: 2, result: "false" } },
        { bits: powerTwoBits, active: 4, line: 5, title: "Decision is false", desc: "The remaining bit cannot remove the second on bit already found.", state: { current_bit: 0, ones_seen: 2, result: "false" } },
        { bits: powerTwoBits, active: 3, line: 6, title: "Return boolean", desc: "Return whether exactly one bit was on.", state: { final_result: "false" } },
      ] : [
        { bits: powerTwoBits, active: 0, line: 1, title: context.title || "Power Of Two Check", desc: "Write the positive number in binary.", state: { number: powerTwoNumber, ones_seen: 0, result: "not final" } },
        { bits: powerTwoBits, active: 0, line: 2, title: "Find one on bit", desc: "The first bit is on, so remember that one has appeared.", state: { current_bit: 1, ones_seen: 1 } },
        { bits: powerTwoBits, active: 1, line: 2, title: "Next bit is off", desc: "An off bit does not add another on bit.", state: { current_bit: 0, ones_seen: 1 } },
        { bits: powerTwoBits, active: 2, line: 2, title: "Still only one", desc: "The scan keeps checking for a second on bit.", state: { current_bit: 0, ones_seen: 1 } },
        { bits: powerTwoBits, active: 3, line: 2, title: "No extra 1 yet", desc: "Another off bit keeps the condition possible.", state: { current_bit: 0, ones_seen: 1 } },
        { bits: powerTwoBits, active: 4, line: 5, title: "Check complete", desc: "The final bit is also off, so only one on bit was found.", state: { current_bit: 0, ones_seen: 1, result: "true" } },
        { bits: powerTwoBits, active: 0, line: 6, title: "Return boolean", desc: "Return whether exactly one bit was on.", state: { final_result: "true" } },
      ],
    },
    "bit-odd-last": {
      example: "n=7, bits=111",
      target: "use the last bit",
      result: "true",
      code: ["write the number as bits", "move attention to the last bit", "read whether the last bit is on", "return the boolean requested by the prompt"],
      phases: [
        { bits: "111", active: 0, line: 1, title: context.title || "Odd From Last Bit", desc: "Use a tiny odd number so the last bit is easy to see.", state: { number: 7, result: "not final" } },
        { bits: "111", active: 2, line: 2, title: "Jump to last bit", desc: "Odd/even only depends on the rightmost bit.", state: { focus: "rightmost bit" } },
        { bits: "111", active: 2, line: 3, title: "Last bit is 1", desc: "A rightmost 1 means the value is odd.", state: { last_bit: 1, result: "true" } },
        { bits: "111", active: 2, line: 3, title: "No other bits needed", desc: "The higher bits do not change odd/even.", state: { ignored_bits: "left side", result: "true" }, inactive: [0, 1] },
        { bits: "111", active: 2, line: 4, title: "Return boolean", desc: "Return the actual boolean value.", state: { final_result: "true" } },
        { bits: "111", active: 2, line: 4, title: "Keep result stable", desc: "Nothing else needs to be scanned.", state: { final_result: "true" }, inactive: [0, 1] },
        { bits: "111", active: 2, line: 4, title: "Done", desc: "The last-bit check is complete.", state: { final_result: "true" }, inactive: [0, 1] },
      ],
    },
    "bit-lowest-bit": {
      example: "n=6, bits=110",
      target: "return lowest bit",
      result: "0",
      code: ["write the number as bits", "look at the rightmost place", "keep that bit value", "return 0 or 1"],
      phases: [
        { bits: "110", active: 0, line: 1, title: context.title || "Lowest Bit Value", desc: "Write 6 in binary.", state: { number: 6, result: "not final" } },
        { bits: "110", active: 2, line: 2, title: "Focus rightmost", desc: "The lowest bit is the rightmost binary place.", state: { focus: "rightmost bit" } },
        { bits: "110", active: 2, line: 3, title: "Read 0", desc: "The rightmost bit is off.", state: { lowest_bit: 0, result: 0 } },
        { bits: "110", active: 0, line: 3, title: "Higher bits ignored", desc: "The other bits are not the lowest bit.", state: { lowest_bit: 0 }, inactive: [0, 1] },
        { bits: "110", active: 2, line: 4, title: "Return 0", desc: "Return the bit value itself.", state: { final_result: "0" } },
        { bits: "110", active: 2, line: 4, title: "Check shape", desc: "The prompt wants 0 or 1.", state: { final_result: "0" } },
        { bits: "110", active: 2, line: 4, title: "Done", desc: "The lowest-bit read is complete.", state: { final_result: "0" } },
      ],
    },
    "bit-turn-off-lowest": {
      example: "n=12, bits=1100",
      target: "turn off lowest 1",
      result: "8",
      code: ["write the number as bits", "find the lowest on bit", "turn only that bit off", "keep higher bits as they are", "return the new value"],
      phases: [
        { bits: "1100", active: 3, line: 1, title: context.title || "Turn Off Lowest Set Bit", desc: "Start at the low end of 12's bits.", state: { number: 12, bits: "1100", result: "not final" } },
        { bits: "1100", active: 3, line: 2, title: "Lowest bit is 0", desc: "A 0 is already off, so keep looking left.", state: { current_bit: 0 } },
        { bits: "1100", active: 2, line: 2, title: "Next bit is 0", desc: "This bit is also off.", state: { current_bit: 0 } },
        { bits: "1100", active: 1, line: 2, title: "Find lowest 1", desc: "This is the first on bit reached from the low end.", state: { lowest_one: "4 place" } },
        { bits: "1000", active: 1, line: 3, title: "Turn it off", desc: "Only that on bit changes to 0.", state: { changed_bit: "4 place", new_bits: "1000" } },
        { bits: "1000", active: 0, line: 4, title: "Higher 1 stays", desc: "The higher on bit remains in place.", state: { new_bits: "1000", result: 8 } },
        { bits: "1000", active: 0, line: 5, title: "Return new value", desc: "The new bit pattern represents 8.", state: { final_result: "8" } },
      ],
    },
    "bit-different-count": {
      example: "a=10 bits=1010, b=7 bits=0111",
      target: "count different positions",
      result: "3",
      code: ["line up both bit strings", "compare one position", "track whether bits differ", "move to the next position", "return the difference count"],
      phases: [
        { bits: "1010", active: 0, line: 1, title: context.title || "Different Bit Count", desc: "Line up the visible bits for both codes.", state: { a: "1010", b: "0111", differences: 0 } },
        { bits: "1010", active: 0, line: 2, title: "Compare first place", desc: "1 and 0 differ, so the count changes.", state: { pair: "1 vs 0", differences: 1 } },
        { bits: "0010", active: 1, line: 2, title: "Compare second place", desc: "0 and 1 differ too.", state: { pair: "0 vs 1", differences: 2 } },
        { bits: "0000", active: 2, line: 2, title: "Compare third place", desc: "1 and 1 match, so the count stays.", state: { pair: "1 vs 1", differences: 2 } },
        { bits: "0001", active: 3, line: 2, title: "Compare last place", desc: "0 and 1 differ.", state: { pair: "0 vs 1", differences: 3 } },
        { bits: "1010", active: 3, line: 4, title: "All positions compared", desc: "Every aligned position has been checked.", state: { differences: 3 } },
        { bits: "1010", active: 3, line: 5, title: "Return count", desc: "Return how many positions were different.", state: { final_result: "3" } },
      ],
    },
    "bit-xor-all": {
      example: "nums=[4,1,4]",
      target: "xor every number",
      result: "1",
      code: ["start with an empty xor state", "combine one number at a time", "matching bits cancel in xor", "keep the running bit pattern", "return the final pattern as a value"],
      phases: [
        { bits: "000", active: 2, line: 1, title: context.title || "Xor Every Number", desc: "Start with no bits turned on in the running XOR.", state: { incoming: "none", running_xor: "000", result: "not final" } },
        { bits: "100", active: 0, line: 2, title: "Combine 4", desc: "The running pattern now matches 4.", state: { incoming: 4, running_xor: "100" } },
        { bits: "101", active: 2, line: 2, title: "Combine 1", desc: "The low bit toggles on.", state: { incoming: 1, running_xor: "101" } },
        { bits: "101", active: 0, line: 3, title: "Read another 4", desc: "The next number has the same high bit as the running state.", state: { incoming: 4, running_xor: "101" } },
        { bits: "001", active: 0, line: 3, title: "Matching high bit cancels", desc: "XOR turns matching on bits off.", state: { incoming: 4, running_xor: "001" } },
        { bits: "001", active: 2, line: 4, title: "Final pattern left", desc: "Only the low bit remains on.", state: { running_xor: "001", result: 1 } },
        { bits: "001", active: 2, line: 5, title: "Return value", desc: "Return the value represented by the final pattern.", state: { final_result: "1" } },
      ],
    },
    "bit-alternating": {
      example: "n=10, bits=1010",
      target: "bits alternate",
      result: "true",
      code: ["write the number as bits", "compare neighboring bits", "track whether the pattern still alternates", "move to the next neighbor pair", "return the boolean requested"],
      phases: [
        { bits: "1010", active: 0, line: 1, title: context.title || "Alternating Bits", desc: "Write the bit pattern for 10.", state: { number: 10, pattern_ok: "not decided" } },
        { bits: "1010", active: 0, line: 2, title: "Compare 1 and 0", desc: "The first neighboring pair is different.", state: { pair: "1 then 0", pattern_ok: "yes so far" } },
        { bits: "1010", active: 1, line: 2, title: "Compare 0 and 1", desc: "The next pair is different too.", state: { pair: "0 then 1", pattern_ok: "yes so far" } },
        { bits: "1010", active: 2, line: 2, title: "Compare 1 and 0", desc: "The final neighboring pair also alternates.", state: { pair: "1 then 0", pattern_ok: "yes so far" } },
        { bits: "1010", active: 3, line: 4, title: "No same neighbors", desc: "No adjacent equal bits were found.", state: { pattern_ok: "true", result: "true" } },
        { bits: "1010", active: 3, line: 5, title: "Return boolean", desc: "Return the boolean value for the pattern.", state: { final_result: "true" } },
        { bits: "1010", active: 3, line: 5, title: "Done", desc: "The alternating check is complete.", state: { final_result: "true" } },
      ],
    },
    "bit-max-pair-xor": {
      example: "nums=[3,10,5]",
      target: "largest pair xor",
      result: "15",
      code: ["write compact bit patterns", "choose one candidate pair", "compare their differing bits", "keep the strongest pair seen", "try another pair", "return the largest value found"],
      phases: [
        { bits: "0011", active: 0, line: 1, title: context.title || "Maximum Pair XOR", desc: "Use a shorter sample so pair comparisons fit on screen.", state: { pair: "none", best: "not final" } },
        { bits: "1001", active: 0, line: 2, title: "Compare 3 with 10", desc: "Different positions turn on in the pair result.", state: { pair: "3 xor 10", candidate_bits: "1001", candidate: 9, best: 9 } },
        { bits: "0110", active: 1, line: 2, title: "Compare 3 with 5", desc: "This candidate is smaller than the best so far.", state: { pair: "3 xor 5", candidate_bits: "0110", candidate: 6, best: 9 } },
        { bits: "1111", active: 0, line: 2, title: "Compare 10 with 5", desc: "This pair turns on more high-value places.", state: { pair: "10 xor 5", candidate_bits: "1111", candidate: 15, best: 15 } },
        { bits: "1111", active: 0, line: 4, title: "Keep strongest pair", desc: "The best visible candidate is saved.", state: { best_pair: "10 and 5", best: 15 } },
        { bits: "1111", active: 0, line: 5, title: "No larger pair left", desc: "All pairs in the compact sample have been checked.", state: { best: 15, result: 15 } },
        { bits: "1111", active: 0, line: 6, title: "Return largest xor", desc: "Return the largest pair value found for the sample.", state: { final_result: "15" } },
      ],
    },
  };
  const config = configs[family] || configs["bit-count"]!;
  return config.phases.map((phase, index) => {
    const nodes = layoutArray(phase.bits.split("")).map((node, bitIndex) => ({
      ...node,
      state: phase.inactive?.includes(bitIndex)
        ? "inactive" as const
        : bitIndex === phase.active
          ? "active" as const
          : bitIndex < phase.active
            ? "visited" as const
            : "default" as const,
    }));
    return step({
      concept: "bit-manipulation",
      title: phase.title,
      description: phase.desc,
      nodes,
      edges: [],
      highlights: { nodeIds: [`item-${phase.active}`], lineNumbers: [phase.line] },
      code: config.code,
      activeLine: phase.line,
      workflow: workflowFromLabels(config.phases.map((item) => item.title), index),
      state: { example: config.example, target: config.target, visual_family: family, result: index === config.phases.length - 1 ? config.result : "not final", ...phase.state },
    }, index + 1);
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
  if (family === "set-first-repeat") return generateFirstRepeatedSetSteps(context);
  if (family === "set-intersection") return generateSetIntersectionSteps(context);
  if (family === "set-unique-count") return generateUniqueCountSetSteps(context);
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
  if (family === "stack-brackets") return generateBalancedBracketSteps(context);
  if (family === "stack-min") return generateMinStackSteps(context);
  if (family === "stack-commands") return generateCommandStackSteps(context);
  if (family === "stack-adjacent-pairs") return generateAdjacentPairStackSteps(context);
  if (family === "stack-monotonic") return generateMonotonicStackSteps(context);
  if (family === "recursion-nested-list") return generateNestedRecursionSteps(context);
  if (String(family).startsWith("recursion-")) return generateRecursionSteps(context);
  if (family === "queue-help-desk") return generateHelpDeskQueueSteps(context);
  if (family === "queue-serve-count") return generateServeCountQueueSteps(context);
  if (family === "queue-line-commands") return generateLineCommandQueueSteps(context);
  if (family === "queue-window-count") return generateQueueWindowSteps(context);
  if (family === "queue-ticket-rounds") return generateTicketRoundQueueSteps(context);
  if (family === "conditional-flow") return generateConditionalSteps(context);
  if (family === "math-last-digit") return generateLastDigitSteps(context);
  if (family === "math-count-digits") return generateCountDigitsSteps(context);
  if (family === "math-grade-points") return generateGradePointsNeededSteps(context);
  if (family === "math-round-groups") return generateRoundUpLabGroupsSteps(context);
  if (family === "tuple-pair") return generateTupleSteps(context);
  if (family === "tuple-swap") return generateTupleSwapSteps(context);
  if (family === "tuple-score-at-index") return generateStudentScorePairSteps(context);
  if (family === "tuple-first-last") return generateFirstLastPairSteps(context);
  if (String(family).startsWith("graph-")) return generateGraphTraversalSteps(context);
  if (String(family).startsWith("tree-")) return generateTreeInsertSteps(context);
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
    case "hash-lookup":
      return generateHashLookupSteps(context);
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
