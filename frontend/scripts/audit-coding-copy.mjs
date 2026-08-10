import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const scanRoots = [
  path.join(repoRoot, "frontend", "src", "components", "coding-tutor"),
  path.join(repoRoot, "backend", "services", "adaptive_practice.py"),
  path.join(repoRoot, "backend", "data_sources", "lessons"),
];

const bannedPhrases = [
  "watch ",
  "what is happening",
  "rule feels fuzzy",
  "practice lane",
  "weak spot",
  "shaky topic",
  "ready when you want",
  "low-pressure",
  "ladder step",
  "unlock a calmer",
  "starting path",
  "compare the final value",
  "trace the code in order",
  "unlock deeper guidance",
  "no hints unlocked yet",
  "pythonista",
  "rubber duck",
  "hard hunter",
  "daily devotee",
  "the long haul",
  "interview ready",
  "next concepts that matter most",
];

const ignoredLinePatterns = [
  /bannedPhrases/i,
  /\.replace\(/,
  /https?:\/\//i,
  /Watch out/i,
  /Watch the solution walkthrough/i,
  /className=/,
  /bandClass:/,
  /function\s+\w+/,
  /^\s*\/\//,
  /^\s*\/\*/,
  /^\s*\*/,
];

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(target, entry.name);
    if (entry.isDirectory()) return walk(next);
    return next;
  });
}

const files = scanRoots
  .flatMap(walk)
  .filter((file) => /\.(jsx?|tsx?|py|json)$/.test(file))
  .filter((file) => !file.includes(`${path.sep}scripts${path.sep}`));

const matches = [];
for (const file of files) {
  const relative = path.relative(repoRoot, file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (ignoredLinePatterns.some((pattern) => pattern.test(line))) return;
    const lower = line.toLowerCase();
    const phrase = bannedPhrases.find((item) => lower.includes(item));
    if (phrase) {
      matches.push({ file: relative, line: index + 1, phrase, text: line.trim() });
    }
  });
}

if (!matches.length) {
  console.log("Coding Tutor copy audit: no flagged phrases found.");
  process.exit(0);
}

console.log(`Coding Tutor copy audit: ${matches.length} flagged phrase${matches.length === 1 ? "" : "s"} found.`);
for (const match of matches) {
  console.log(`- ${match.file}:${match.line} [${match.phrase}] ${match.text}`);
}
process.exit(0);
