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

const rows = [];
const warnings = [];
for (const file of fs.readdirSync(questionDir).filter((item) => item.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(questionDir, file), "utf8"));
  for (const problem of data.questions || []) {
    if (!problem.visualizer) continue;
    const concept = conceptFromProblem(problem);
    const firstState = problem.visualizer.input || problem.visualizer.steps?.[0]?.state || {};
    const raw = rawVisualInput(problem, firstState);
    const sample = compactVisualInput(problem, concept, firstState);
    const itemCount = valuesFromVisualSample(sample).length;
    const stepCount = Array.isArray(problem.visualizer.steps) ? problem.visualizer.steps.length : 0;
    const banned = containsBannedPhrase(problem, concept, sample);

    rows.push({
      id: problem.id,
      title: problem.title,
      concept,
      stepCount,
      sample,
      itemCount,
    });

    if (banned) warnings.push(`${problem.id} ${problem.title}: banned phrase "${banned}"`);
    if (concept === "array" && sample && !sample.includes("=") && itemCount > 8) {
      warnings.push(`${problem.id} ${problem.title}: oversized string/list visual sample "${sample}" (${itemCount} items)`);
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
  steps: row.stepCount,
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
