import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const questionDir = path.join(repoRoot, "backend", "data_sources", "quiz", "questions");
const generatorPath = path.join(process.cwd(), "src", "components", "coding-tutor", "universal-visualizer", "generators.ts");
const bannedPhrases = [
  "use this prompt rule",
  "authored example input",
  "public example input",
  "hidden test",
];

const bannedGeneratedPseudocode = [
  "first_operation",
  "second_operation",
  "total = adjust(total)",
  "result.append(",
  "seen.add(",
  "pairs.append(",
  "queue.append(",
  "frontier.append(",
  "heap.append(",
  "values.append(",
  "ops.append(",
  "positives = set()",
  "positives.add(",
  "groups[key].append(",
  "visited.add(",
];

const conceptStepTargets = {
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
};

function targetStepCount(concept) {
  return conceptStepTargets[concept] || 6;
}

const familyStepTargets = {
  "array-maximum-score": 7,
  "array-sum-even": 7,
  "array-dedupe-order": 7,
  "array-smallest-positive": 7,
  "array-find-index": 6,
  "array-merge-names": 7,
  "array-threshold-count": 6,
  "array-truthy-count": 6,
  "array-every-other": 7,
  "array-comfort-count": 6,
  "array-plant-care-days": 7,
  "array-rotate": 8,
  "array-dedupe": 6,
  "array-filter": 6,
  "array-running-total": 6,
  "array-search": 6,
  "array-max-min": 6,
  "array-swap": 7,
  "string-scan": 6,
  "string-count-vowels": 6,
  "string-reverse-words": 6,
  "string-count-words": 5,
  "string-course-code": 6,
  "string-initials": 6,
  "string-palindrome": 5,
  "string-normalize-emails": 7,
  "string-prefix-search": 7,
  "hash-complement": 7,
  "hash-frequency": 7,
  "hash-grouping": 7,
  "hash-lookup": 7,
  "stack-brackets": 8,
  "stack-expression": 8,
  "queue-help-desk": 7,
  "queue-fifo": 6,
  "binary-search": 8,
  "two-pointers": 7,
  "sliding-window": 8,
  "matrix-traverse": 7,
  "dp-table": 8,
  "graph-traversal": 7,
  "prefix-range": 8,
  "recursion-stack": 8,
  "recursion-nested-list": 8,
  "heap-priority": 7,
  "trie-prefix": 7,
  "union-find": 7,
  "interval-merge": 7,
  "bit-count": 7,
  "conditional-flow": 6,
  "set-membership": 6,
  "set-first-missing": 8,
  "math-last-digit": 4,
  "math-count-digits": 6,
  "math-grade-points": 5,
  "math-round-groups": 6,
  "tuple-pair": 6,
  "tuple-swap": 6,
  "tuple-score-at-index": 5,
  "tuple-first-last": 4,
  "linked-list-traverse": 7,
  "string-run-compress": 7,
  "graph-islands": 8,
  "stack-min": 8,
};

const trueArrayFamilies = {
  "easy-03": { family: "array-maximum-score", sample: "scores=[72, 88, 91, 84]", expected: "91" },
  "easy-05": { family: "array-sum-even", sample: "values=[1, 2, 3, 4]", expected: "6" },
  "easy-08": { family: "array-dedupe-order", sample: "values=[3, 1, 3, 2]", expected: "[3, 1, 2]" },
  "easy-10": { family: "array-smallest-positive", sample: "values=[-2, 4, 0, 3]", expected: "3" },
  "easy-11": { family: "array-running-total", sample: "values=[2, 4, 1]", expected: "[2, 6, 7]" },
  "easy-13": { family: "array-find-index", sample: "values=[5, 7, 9], target=7", expected: "1" },
  "easy-14": { family: "array-merge-names", sample: "first=[Ada], second=[Grace, Katherine]", expected: "[Ada, Grace, Katherine]" },
  "easy-15": { family: "array-threshold-count", sample: "readings=[70, 82, 81], threshold=80", expected: "2" },
  "easy-17": { family: "array-truthy-count", sample: "present=[true, false, true]", expected: "2" },
  "easy-20": { family: "array-every-other", sample: "values=[10, 20, 30, 40, 50]", expected: "[10, 30, 50]" },
  "easy-27": { family: "array-comfort-count", sample: "readings=[68, 72, 80], low=70, high=78", expected: "1" },
  "easy-36": { family: "array-plant-care-days", sample: "readings=[20, 55, 30], days=[Mon, Tue, Wed], threshold=35", expected: "[Mon, Wed]" },
  "medium-09": { family: "array-rotate", sample: "values=[1, 2, 3, 4], k=2", expected: "[3, 4, 1, 2]" },
};

const trueConditionalIds = new Set([
  "easy-07",
  "easy-19",
  "easy-23",
  "easy-25",
  "easy-26",
  "easy-35",
]);

const trueMathFamilies = {
  "easy-16": { family: "math-last-digit", sample: "number=384", expected: "4" },
  "easy-21": { family: "math-count-digits", sample: "number_left=5029", expected: "4" },
  "easy-53": { family: "math-grade-points", sample: "current=72, target=80", expected: "8" },
  "easy-54": { family: "math-round-groups", sample: "students=23, group_size=5", expected: "5" },
};

const trueTupleFamilies = {
  "easy-33": { family: "tuple-pair", sample: "names=[Ada, Grace], scores=[95, 88]", expected: "[Ada:95, Grace:88]" },
  "easy-34": { family: "tuple-swap", sample: "original=[lab, lecture]", expected: "[lecture, lab]" },
  "easy-55": { family: "tuple-score-at-index", sample: "index=1", expected: "Bo:82" },
  "easy-56": { family: "tuple-first-last", sample: "items=[pen, notebook, charger]", expected: "[pen, charger]" },
};

const trueStringFamilies = {
  "easy-01": { family: "string-count-vowels", sample: "Code", expected: "2" },
  "easy-02": { family: "string-reverse-words", sample: "red blue", expected: "blue red" },
  "easy-04": { family: "string-palindrome", sample: "level", expected: "true" },
  "easy-09": { family: "string-count-words", sample: "red blue", expected: "2" },
  "easy-12": { family: "string-course-code", sample: "COSC 352", expected: "true" },
  "easy-18": { family: "string-initials", sample: "Ada Lovelace", expected: "AL" },
  "medium-11": { family: "string-run-compress", sample: "aaabbc", expected: "a3b2c1" },
  "medium-16": { family: "string-normalize-emails", sample: "emails=[Ada@MSU.edu, ada@msu.edu, Bo@MSU.edu]", expected: "[ada@msu.edu, bo@msu.edu]" },
  "medium-17": { family: "string-prefix-search", sample: "words=[code, card, car], prefix=ca", expected: "[card, car]" },
};

function visualizerFamilyText(problem) {
  return `${problem?.title || ""} ${problem?.topic || ""} ${problem?.prompt || ""} ${problem?.visualizer?.title || ""} ${problem?.visualizer?.caption || ""} ${problem?.visualizer?.concept || ""}`.toLowerCase();
}

function isTupleSwapProblem(problem) {
  return /swap|reverse\s+pair|pair\s+order|order\s+pair/i.test(visualizerFamilyText(problem));
}

function detectVisualizerFamily(problem, concept) {
  const text = visualizerFamilyText(problem);
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
  if (concept === "tuple") return isTupleSwapProblem(problem) ? "tuple-swap" : "tuple-pair";
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
    if (/group|anagram|bucket by|categor/.test(text)) return "hash-grouping";
    if (/count|frequency|frequent|favorite|most common|occurrence/.test(text)) return "hash-frequency";
    return "hash-lookup";
  }
  if (/palindrome/.test(text)) return "string-palindrome";
  if (/string|word|text|vowel|character|letter/.test(text)) return "string-scan";
  if (/rotate/.test(text)) return "array-rotate";
  if (/duplicate|unique|repeat/.test(text)) return "array-dedupe";
  if (/running total|prefix|cumulative/.test(text)) return "array-running-total";
  if (/find|index|search|smallest positive|missing/.test(text)) return "array-search";
  if (/maximum|minimum|max|min|largest|smallest|best/.test(text)) return "array-max-min";
  if (/even|odd|filter|above|below|comfortable|count/.test(text)) return "array-filter";
  return "array-swap";
}

function targetStepCountFor(problem, concept) {
  const family = detectVisualizerFamily(problem, concept);
  return familyStepTargets[family] || targetStepCount(concept);
}

const generatedOverrideConcepts = new Set([
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
  "matrix",
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
  const family = detectVisualizerFamily(problem, concept);
  if (trueArrayFamilies[problem.id]) return trueArrayFamilies[problem.id].sample;
  if (trueMathFamilies[problem.id]) return trueMathFamilies[problem.id].sample;
  if (trueTupleFamilies[problem.id]) return trueTupleFamilies[problem.id].sample;
  if (trueStringFamilies[problem.id]) return trueStringFamilies[problem.id].sample;
  if (family === "set-first-missing") return "values=[1, 2, 0]";
  if (family === "string-run-compress") return "aaabbc";
  if (family === "graph-islands") return "grid=[[1,1,0],[0,0,1],[1,0,1]]";
  if (family === "stack-min") return "commands=[push 3, push 1, push 2, min, pop, min]";
  if (family === "recursion-nested-list") return "value=[1,[2,[3]]]";
  if (family === "queue-help-desk") return "commands=[join Ana, join Bo, serve, serve, serve]";
  if (title.includes("vowel")) return "Code";
  if (title.includes("palindrome")) return "level";
  if (title.includes("reverse words")) return "red blue";
  if (title.includes("reverse only letters")) return "a-bC-d";
  if (title.includes("first repeated")) return "cocoa";
  if (title.includes("edit distance")) return "cat -> cut";
  if (concept === "stack") return "expression=3+2*2";
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
  if (/expression\s*=\s*3\s*\+\s*2\s*\*\s*2/i.test(sample)) return [3, "+", 2, "*", 2];
  const namedLists = parseAllNamedLists(sample);
  const firstNamed = Object.values(namedLists)[0];
  if (firstNamed?.length) return firstNamed;
  const firstList = parseFirstList(sample);
  if (firstList.length) return firstList;
  if (sample && !sample.includes("=")) return [...sample].map((char) => char === " " ? "space" : char);
  return [];
}

function usesGeneratedRuntimeTrace(problem, concept, rawSteps = []) {
  if (!generatedOverrideConcepts.has(concept)) return false;
  const target = targetStepCountFor(problem, concept);
  if (!rawSteps.length || rawSteps.length >= target) return false;
  if (rawSteps.length < Math.min(target, 6)) return true;
  const genericText = rawSteps.map((step) => `${step.title || ""} ${step.body || ""} ${step.action || ""}`).join(" ").toLowerCase();
  return /load the example|set the sample|predict the next state|connect the visual|return only what the prompt asks|movement pattern/.test(genericText)
    || /animated practice trace|visual walkthrough/i.test(`${problem.visualizer?.title || ""} ${problem.visualizer?.caption || ""}`);
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

function hasGenericScaffold(steps = []) {
  const genericText = steps.map((step) => `${step.title || ""} ${step.body || ""} ${step.action || ""} ${step.code || ""}`).join(" ").toLowerCase();
  return /load the example|set the sample|predict the next state|connect the visual|return only what the prompt asks|movement pattern|make one .* move|animated practice trace|visual walkthrough/.test(genericText);
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
const generatorSource = fs.existsSync(generatorPath) ? fs.readFileSync(generatorPath, "utf8") : "";
for (const phrase of bannedGeneratedPseudocode) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const visibleStringPattern = new RegExp(`["'\`][^"'\`\\n]*${escaped}`);
  if (visibleStringPattern.test(generatorSource)) {
    warnings.push(`generated pseudocode contains old visible remnant "${phrase}"`);
  }
}

for (const file of fs.readdirSync(questionDir).filter((item) => item.endsWith(".json"))) {
  const difficulty = difficultyFromFile(file);
  const data = JSON.parse(fs.readFileSync(path.join(questionDir, file), "utf8"));
  for (const problem of data.questions || []) {
    if (!problem.visualizer) continue;
    const concept = conceptFromProblem(problem);
    const family = detectVisualizerFamily(problem, concept);
    const firstState = problem.visualizer.input || problem.visualizer.steps?.[0]?.state || {};
    const raw = rawVisualInput(problem, firstState);
    const sample = compactVisualInput(problem, concept, firstState);
    const itemCount = valuesFromVisualSample(sample).length;
    const rawStepCount = Array.isArray(problem.visualizer.steps) ? problem.visualizer.steps.length : 0;
    const targetSteps = targetStepCountFor(problem, concept);
    const effectiveStepCount = rawStepCount > 0 ? Math.max(rawStepCount, targetSteps) : 0;
    const banned = containsBannedPhrase(problem, concept, sample);
    const rawSteps = Array.isArray(problem.visualizer.steps) ? problem.visualizer.steps : [];
    const runtimeGenerated = usesGeneratedRuntimeTrace(problem, concept, rawSteps);
    const duplicateLabels = duplicateGenericStepLabels(rawSteps);
    const noStateChangeCount = adjacentNoStateChanges(rawSteps);
    const genericScaffold = hasGenericScaffold(rawSteps);

    rows.push({
      id: problem.id,
      title: problem.title,
      difficulty,
      concept,
      family,
      targetSteps,
      rawStepCount,
      effectiveStepCount,
      runtimeGenerated,
      genericScaffold,
      sample,
      itemCount,
    });

    if (banned) warnings.push(`${problem.id} ${problem.title}: banned phrase "${banned}"`);
    if (effectiveStepCount < targetSteps) warnings.push(`${problem.id} ${problem.title}: visualizer has only ${effectiveStepCount} effective steps; target is ${targetSteps}`);
    if ((difficulty === "medium" || difficulty === "hard") && effectiveStepCount < targetSteps) {
      warnings.push(`${problem.id} ${problem.title}: medium/hard visualizer is below ${family} target depth`);
    }
    if ((difficulty === "medium" || difficulty === "hard") && rawStepCount > 0 && rawStepCount < Math.min(targetSteps, 6) && !runtimeGenerated) {
      warnings.push(`${problem.id} ${problem.title}: authored medium/hard visualizer has only ${rawStepCount} raw steps before runtime expansion`);
    }
    if (duplicateLabels.length) warnings.push(`${problem.id} ${problem.title}: duplicate generic step label(s): ${duplicateLabels.join(", ")}`);
    if (noStateChangeCount > 1) warnings.push(`${problem.id} ${problem.title}: ${noStateChangeCount} adjacent authored step(s) have no state/code change`);
    if ((difficulty === "medium" || difficulty === "hard") && genericScaffold && !runtimeGenerated) {
      warnings.push(`${problem.id} ${problem.title}: generic authored scaffold is not replaced by a family renderer`);
    }
    if (!familyStepTargets[family]) warnings.push(`${problem.id} ${problem.title}: unknown visualizer family "${family}"`);
    if (trueConditionalIds.has(problem.id) || concept === "conditional" || String(problem.topic || "").toLowerCase() === "conditionals") {
      if (family !== "conditional-flow") {
        warnings.push(`${problem.id} ${problem.title}: Conditionals visualizer routes to "${family}", expected "conditional-flow"`);
      }
      if (/\[[\s\d,]+\]/.test(sample) || /array-|list/.test(family)) {
        warnings.push(`${problem.id} ${problem.title}: Conditionals visualizer still looks like an array/list visual with sample "${sample}"`);
      }
    }
    const requiredArray = trueArrayFamilies[problem.id];
    if (requiredArray) {
      if (family !== requiredArray.family) {
        warnings.push(`${problem.id} ${problem.title}: true Arrays visualizer routes to "${family}", expected "${requiredArray.family}"`);
      }
      if (sample !== requiredArray.sample) {
        warnings.push(`${problem.id} ${problem.title}: true Arrays sample is "${sample}", expected "${requiredArray.sample}"`);
      }
      if (/array-(dedupe|filter|search|max-min|swap)$/.test(family)) {
        warnings.push(`${problem.id} ${problem.title}: true Arrays visualizer still uses shared generic array family "${family}"`);
      }
    }
    const requiredMath = trueMathFamilies[problem.id];
    if (requiredMath) {
      if (family !== requiredMath.family) {
        warnings.push(`${problem.id} ${problem.title}: Math visualizer routes to "${family}", expected "${requiredMath.family}"`);
      }
      if (sample !== requiredMath.sample) {
        warnings.push(`${problem.id} ${problem.title}: Math sample is "${sample}", expected "${requiredMath.sample}"`);
      }
    }
    const requiredTuple = trueTupleFamilies[problem.id];
    if (requiredTuple) {
      if (family !== requiredTuple.family) {
        warnings.push(`${problem.id} ${problem.title}: Tuple visualizer routes to "${family}", expected "${requiredTuple.family}"`);
      }
      if (sample !== requiredTuple.sample) {
        warnings.push(`${problem.id} ${problem.title}: Tuple sample is "${sample}", expected "${requiredTuple.sample}"`);
      }
    }
    const requiredString = trueStringFamilies[problem.id];
    if (requiredString) {
      if (family !== requiredString.family) {
        warnings.push(`${problem.id} ${problem.title}: String visualizer routes to "${family}", expected "${requiredString.family}"`);
      }
      if (sample !== requiredString.sample) {
        warnings.push(`${problem.id} ${problem.title}: String sample is "${sample}", expected "${requiredString.sample}"`);
      }
      if (family === "string-scan") {
        warnings.push(`${problem.id} ${problem.title}: true Strings visualizer still uses shared generic string-scan`);
      }
    }
    if (concept === "array" && sample && !sample.includes("=") && itemCount > 8 && !trueStringFamilies[problem.id]) {
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
  family: row.family,
  target: row.targetSteps,
  steps: row.effectiveStepCount,
  rawSteps: row.rawStepCount,
  runtime: row.runtimeGenerated ? "generated" : "authored",
  generic: row.genericScaffold ? "yes" : "",
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
