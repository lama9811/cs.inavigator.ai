const VISUALIZER_TOPICS = new Set([
  "array-scan",
  "string-scan",
  "stack",
  "queue",
  "hash-map-set",
  "linked-list",
  "recursion",
  "binary-search",
  "two-pointers",
  "sliding-window",
  "tree",
  "graph",
]);

function normalizeVisualizerTopic(value) {
  const raw = String(value || "").trim().toLowerCase();
  const normalized = raw.replace(/_/g, "-");
  if (["arrays", "array", "scan"].includes(normalized)) return "array-scan";
  if (["strings", "string"].includes(normalized)) return "string-scan";
  if (["stacks", "stack"].includes(normalized)) return "stack";
  if (["queues", "queue"].includes(normalized)) return "queue";
  if (["hash-maps", "hash-map", "hash maps", "sets", "set", "hash-map-set"].includes(raw) || normalized === "hash-map-set") return "hash-map-set";
  if (["linked-lists", "linked-list", "linked lists"].includes(raw) || normalized === "linked-list") return "linked-list";
  if (["recursion", "recursive"].includes(normalized)) return "recursion";
  if (["binary-search", "binary search"].includes(raw) || normalized === "binary-search") return "binary-search";
  if (["two-pointers", "two pointers"].includes(raw) || normalized === "two-pointers") return "two-pointers";
  if (["sliding-window", "sliding window"].includes(raw) || normalized === "sliding-window") return "sliding-window";
  if (["trees", "tree"].includes(normalized)) return "tree";
  if (["graphs", "graph"].includes(normalized)) return "graph";
  return normalized;
}

export function problemHasVisualizer(problem) {
  if (!problem) return false;
  if (problem.visualizer) return true;
  return VISUALIZER_TOPICS.has(normalizeVisualizerTopic(problem.topic));
}
