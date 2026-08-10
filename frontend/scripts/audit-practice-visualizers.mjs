import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const questionDir = path.join(repoRoot, "backend", "data_sources", "quiz", "questions");
const bannedPhrases = [
  "use this prompt rule",
  "authored example input",
  "public example input",
  "hidden test",
];

const conceptStepTargets = {
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

function targetStepCount(concept) {
  return conceptStepTargets[concept] || 6;
}

function difficultyFromFile(file) {
  return file.replace(/\.json$/i, "");
}

function parseToken(token) {
  const cleaned = String(token || "").trim().replace(/^['"]|['"]$/g, "");
  const numeric = Number(cleaned);
  return cleaned !== "" && Number.isFinite(numeric) ? numeric : cleaned;
}

function parseFirstList(input = "") {
  const match = String(input).match(/\[([^\]]*)\]/);
  if (!match) return [];
  return match[1].split(",").map(parseToken).filter((value) => String(value).length > 0);
}

function parseAllNamedLists(input = "") {
  const lists = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\[([^\]]*)\]/g;
  let match = pattern.exec(String(input));
  while (match) {
    lists[match[1]] = match[2].split(",").map(parseToken).filter((value) => String(value).length > 0);
    match = pattern.exec(String(input));
  }
  return lists;
}

function conceptFromProblem(problem) {
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
  return "array";
}

function rawVisualInput(problem, state = {}) {
  const example = Array.isArray(problem.examples) ? problem.examples[0] : {};
  return String(example?.input || state.example || state.text || state.input || state.sample || "").trim();
}

function compactVisualInput(problem, concept, state = {}) {
  const raw = rawVisualInput(problem, state);
  if (!raw) return raw;
  const title = `${problem.title || ""} ${problem.topic || ""} ${problem.prompt || ""} ${problem.visualizer?.concept || ""}`.toLowerCase();
  if (title.includes("vowel")) return "Code";
  if (title.includes("palindrome")) return "level";
  if (title.includes("reverse words")) return "red blue";
  if (title.includes("reverse only letters")) return "a-bC-d";
  if (title.includes("first repeated")) return "cocoa";
  if (title.includes("edit distance")) return "cat -> cut";
  if (concept === "stack") return "commands=[push 3, push +, pop +]";
  if (concept === "queue") return "commands=[join Ana, join Bo, serve Ana]";
  if (concept === "hash-map") {
    if (/two sum|complement/.test(title)) return "nums=[2, 7], target=9";
    if (/count|frequency|anagram/.test(title)) return "items=[A, B, A]";
    return "keys=[Ana, Bo], values=[90, 82], lookup=Ana";
  }
  if (concept === "binary-search") return "values=[1, 3, 5], target=3";
  if (concept === "two-pointers") return "values=[1, 4, 6], target=7";
  if (concept === "sliding-window") return "values=[2, 4, 1], k=2";
  if (concept === "recursion") return "n=3";
  if (concept === "binary-tree") return "values=[4, 2, 6]";
  if (concept === "graph") return "edges=[A-B, A-C, B-D], start=A";
  if (concept === "matrix") return "grid=[[1,2],[3,4]]";
  if (concept === "prefix-sum") return "values=[2, 4, 1]";
  if (concept === "intervals") return "intervals=[[1,3],[2,5]]";
  if (concept === "heap") return "values=[30, 40, 50]";
  if (concept === "trie") return "words=[cat, car]";
  if (concept === "union-find") return "pairs=[A-B, B-C]";
  if (concept === "dynamic-programming") return "n=4";
  if (concept === "bit-manipulation") return "bits=1011";
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
  const visualConcept = String(problem.visualizer?.concept || "").toLowerCase();
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

function valuesFromVisualSample(sample) {
  const namedLists = parseAllNamedLists(sample);
  const firstNamed = Object.values(namedLists)[0];
  if (firstNamed?.length) return firstNamed;
  const firstList = parseFirstList(sample);
  if (firstList.length) return firstList;
  if (sample && !sample.includes("=")) return [...sample].map((char) => char === " " ? "space" : char);
  return [];
}

function runtimeVisualText(problem, concept, sample) {
  const rawSteps = Array.isArray(problem.visualizer?.steps) ? problem.visualizer.steps : [];
  const rawValues = [
    problem.examples?.[0]?.input,
    problem.visualizer?.input?.sample,
    problem.visualizer?.input?.text,
    problem.visualizer?.input?.input,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return rawSteps.map((step) => {
    let text = `${step.title || ""} ${step.body || ""} ${step.code || ""}`;
    rawValues.forEach((raw) => {
      if (sample && raw && raw !== sample) text = text.split(raw).join(sample);
    });
    return text
      .replace(/authored example input/gi, "teaching sample")
      .replace(/public example input/gi, "teaching sample")
      .replace(/public example result/gi, "teaching sample result");
  }).join(" ").toLowerCase() + ` ${concept}`;
}

function containsBannedPhrase(problem, concept, sample) {
  const visualText = runtimeVisualText(problem, concept, sample);
  return bannedPhrases.find((phrase) => visualText.includes(phrase));
}

function normalizedStepLabel(step = {}) {
  return String(step.action || step.title || "").replace(/[-_]/g, " ").trim().toLowerCase();
}

function duplicateGenericStepLabels(steps = []) {
  const counts = new Map();
  const duplicates = [];
  for (const step of steps) {
    const label = normalizedStepLabel(step);
    if (!label) continue;
    const count = counts.get(label) || 0;
    counts.set(label, count + 1);
    if (count === 1 && /\b(setup|finish|trace|predict|load|result)\b/.test(label)) duplicates.push(label);
  }
  return duplicates;
}

function stableState(value) {
  return JSON.stringify(value || {});
}

function adjacentNoStateChanges(steps = []) {
  let count = 0;
  for (let index = 1; index < steps.length; index += 1) {
    const prev = steps[index - 1] || {};
    const next = steps[index] || {};
    if (
      stableState(prev.state) === stableState(next.state)
      && String(prev.code || "") === String(next.code || "")
      && normalizedStepLabel(prev) !== normalizedStepLabel(next)
    ) {
      count += 1;
    }
  }
  return count;
}

const rows = [];
const warnings = [];
for (const file of fs.readdirSync(questionDir).filter((item) => item.endsWith(".json"))) {
  const difficulty = difficultyFromFile(file);
  const data = JSON.parse(fs.readFileSync(path.join(questionDir, file), "utf8"));
  for (const problem of data.questions || []) {
    if (!problem.visualizer) continue;
    const concept = conceptFromProblem(problem);
    const firstState = problem.visualizer.input || problem.visualizer.steps?.[0]?.state || {};
    const raw = rawVisualInput(problem, firstState);
    const sample = compactVisualInput(problem, concept, firstState);
    const itemCount = valuesFromVisualSample(sample).length;
    const rawStepCount = Array.isArray(problem.visualizer.steps) ? problem.visualizer.steps.length : 0;
    const targetSteps = targetStepCount(concept);
    const effectiveStepCount = rawStepCount > 0 ? Math.max(rawStepCount, targetSteps) : 0;
    const banned = containsBannedPhrase(problem, concept, sample);
    const rawSteps = Array.isArray(problem.visualizer.steps) ? problem.visualizer.steps : [];
    const duplicateLabels = duplicateGenericStepLabels(rawSteps);
    const noStateChangeCount = adjacentNoStateChanges(rawSteps);

    rows.push({
      id: problem.id,
      title: problem.title,
      difficulty,
      concept,
      targetSteps,
      rawStepCount,
      effectiveStepCount,
      sample,
      itemCount,
    });

    if (banned) warnings.push(`${problem.id} ${problem.title}: banned phrase "${banned}"`);
    if (effectiveStepCount < targetSteps) warnings.push(`${problem.id} ${problem.title}: visualizer has only ${effectiveStepCount} effective steps; target is ${targetSteps}`);
    if ((difficulty === "medium" || difficulty === "hard") && effectiveStepCount < targetSteps) {
      warnings.push(`${problem.id} ${problem.title}: medium/hard visualizer is below ${concept} target depth`);
    }
    if (duplicateLabels.length) warnings.push(`${problem.id} ${problem.title}: duplicate generic step label(s): ${duplicateLabels.join(", ")}`);
    if (noStateChangeCount > 1) warnings.push(`${problem.id} ${problem.title}: ${noStateChangeCount} adjacent authored step(s) have no state/code change`);
    if (concept === "array" && sample && !sample.includes("=") && itemCount > 8) {
      warnings.push(`${problem.id} ${problem.title}: oversized string/list visual sample "${sample}" (${itemCount} items)`);
    }
    if ((difficulty === "medium" || difficulty === "hard") && /morgan state|university|data structures are useful/i.test(sample)) {
      warnings.push(`${problem.id} ${problem.title}: medium/hard visualizer still uses a long public sample "${sample}"`);
    }
    if (/count vowels/i.test(problem.title || "") && /morgan state/i.test(sample)) {
      warnings.push(`${problem.id} ${problem.title}: Count Vowels still uses Morgan State`);
    }
    if (raw && sample && raw !== sample && JSON.stringify(firstState).includes(raw)) {
      rows[rows.length - 1].compactedFrom = raw;
    }
  }
}

console.table(rows.map((row) => ({
  id: row.id,
  concept: row.concept,
  target: row.targetSteps,
  steps: row.effectiveStepCount,
  rawSteps: row.rawStepCount,
  items: row.itemCount,
  sample: row.sample,
  compactedFrom: row.compactedFrom || "",
})));

if (warnings.length) {
  console.error(`Practice visualizer audit found ${warnings.length} issue(s):`);
  warnings.forEach((warning) => console.error(`- ${warning}`));
  process.exit(1);
}

console.log(`Practice visualizer audit passed for ${rows.length} visualizer(s).`);
