import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaArrowLeft,
  FaArrowRight,
  FaPause,
  FaPlay,
  FaProjectDiagram,
  FaRedo,
  FaTimes,
  FaUndo,
} from "react-icons/fa";
import "./WorkspaceVisualizer.css";

const VISUALIZERS = [
  { id: "array-scan", label: "Array scan" },
  { id: "string-scan", label: "String scan" },
  { id: "stack", label: "Stack" },
  { id: "queue", label: "Queue" },
  { id: "hash-map-set", label: "Hash map / set" },
  { id: "linked-list", label: "Linked list" },
  { id: "recursion", label: "Recursion" },
  { id: "binary-search", label: "Binary search" },
  { id: "two-pointers", label: "Two pointers" },
  { id: "sliding-window", label: "Sliding window" },
  { id: "tree", label: "Tree traversal" },
  { id: "graph", label: "Graph traversal" },
];

const EDITABLE_CONCEPTS = new Set([
  "array-scan",
  "string-scan",
  "binary-search",
  "two-pointers",
  "sliding-window",
]);

const DEFAULT_ARRAY_TEXT = "70, 82, 81";
const DEFAULT_STRING_TEXT = "Morgan State";

function normalizeConcept(value) {
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
  return normalized || "array-scan";
}

function inferVisualizerFromProblem(problem) {
  if (!problem) return null;
  const topic = normalizeConcept(problem.topic);
  if (VISUALIZERS.some((item) => item.id === topic)) {
    return {
      concept: topic,
      title: `${problem.title}: visual trace`,
      caption: "Step through the idea behind this problem before changing code.",
    };
  }
  return null;
}

function parseNumberList(text) {
  const values = String(text || "")
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Type numbers separated by commas, like 2, 1, 5, 1, 3.");
  }
  return values.slice(0, 12);
}

function safeArrayInput(meta, inputText, fallback = [2, 1, 5, 1, 3]) {
  if (inputText != null) return parseNumberList(inputText);
  if (Array.isArray(meta?.input?.items)) return meta.input.items.slice(0, 12);
  if (Array.isArray(meta?.input?.array)) return meta.input.array.slice(0, 12);
  return fallback;
}

function textInput(meta, inputText) {
  if (inputText != null) return String(inputText).slice(0, 24);
  return String(meta?.input?.text || meta?.input?.string || DEFAULT_STRING_TEXT).slice(0, 24);
}

function makeStep({
  title,
  body,
  changed,
  why,
  state,
  code,
  action = "",
  animation = "highlight",
}) {
  return { title, body, changed, why, state, code, action, animation };
}

function arrayScanTrace(meta, inputText) {
  const values = safeArrayInput(meta, inputText, [70, 82, 81]);
  if (meta?.preset === "sum-even") {
    let total = 0;
    const steps = [
      makeStep({
        title: "Start the running sum",
        body: "The sum starts at 0 because no even numbers have been added yet.",
        changed: "sum = 0",
        why: "A running sum is one variable that grows as the loop finds matching values.",
        state: { items: values, active: [], note: "sum = 0" },
        code: "total = 0",
        action: "setup",
      }),
    ];
    values.slice(0, 8).forEach((value, index) => {
      const isEven = value % 2 === 0;
      if (isEven) total += value;
      steps.push(makeStep({
        title: `Check ${value}`,
        body: isEven ? `${value} is even, so add it to the total.` : `${value} is odd, so skip it.`,
        changed: `sum = ${total}`,
        why: "The condition protects the sum from values that do not belong in the answer.",
        state: { items: values, active: [index], note: `sum = ${total}` },
        code: "if value % 2 == 0:\n    total += value",
        action: isEven ? "add" : "skip",
        animation: isEven ? "add" : "highlight",
      }));
    });
    steps.push(makeStep({
      title: "Return the sum",
      body: "After the loop finishes, the total holds only the even numbers.",
      changed: `answer = ${total}`,
      why: "The answer is built one safe update at a time.",
      state: { items: values, active: [], note: `return ${total}` },
      code: "return total",
      action: "finish",
    }));
    return {
      title: meta?.title || "Array scan: add only matching values",
      concept: "array-scan",
      caption: meta?.caption || "Watch each number get checked before the running sum changes.",
      steps,
    };
  }
  const threshold = Number.isFinite(Number(meta?.input?.threshold)) ? Number(meta.input.threshold) : 80;
  const title = meta?.title || "Array scan: one item at a time";
  const steps = [
    makeStep({
      title: "Start before the first value",
      body: "The counter starts at 0 because no values have been checked yet.",
      changed: "count = 0",
      why: "A scan works by carrying one small piece of memory through the list.",
      state: { items: values, active: [], note: `threshold = ${threshold}, count = 0` },
      code: "count = 0",
      action: "setup",
    }),
  ];
  let count = 0;
  values.slice(0, 6).forEach((value, index) => {
    const passes = value > threshold;
    if (passes) count += 1;
    steps.push(makeStep({
      title: `Check ${value}`,
      body: passes ? `${value} is greater than ${threshold}, so it counts.` : `${value} is not greater than ${threshold}, so the counter stays put.`,
      changed: passes ? `count increases to ${count}` : `count stays ${count}`,
      why: "Only update the answer when the current item matches the rule.",
      state: { items: values, active: [index], note: `threshold = ${threshold}, count = ${count}` },
      code: `if value > ${threshold}:\n    count += 1`,
      action: "compare",
    }));
  });
  steps.push(makeStep({
    title: "Return the final count",
    body: "After the loop has checked every value, the counter is the answer.",
    changed: `answer = ${count}`,
    why: "The loop did the same small check for each item.",
    state: { items: values, active: [], note: `return ${count}` },
    code: "return count",
    action: "finish",
  }));
  return { title, concept: "array-scan", caption: meta?.caption || "Watch the loop visit each list item and update one answer variable.", steps };
}

function stringScanTrace(meta, inputText) {
  const text = textInput(meta, inputText);
  const chars = [...text];
  const vowels = new Set(["a", "e", "i", "o", "u"]);
  let count = 0;
  const steps = [
    makeStep({
      title: "Normalize the text",
      body: "Lowercase letters make A and a count the same way.",
      changed: `text = "${text.toLowerCase()}"`,
      why: "Cleaning input first makes the loop simpler.",
      state: { items: chars, active: [], note: "count = 0" },
      code: "text = text.lower()",
      action: "setup",
    }),
  ];
  chars.slice(0, 10).forEach((char, index) => {
    const isVowel = vowels.has(char.toLowerCase());
    if (isVowel) count += 1;
    steps.push(makeStep({
      title: `Read "${char}"`,
      body: isVowel ? `"${char}" is a vowel, so add 1.` : `"${char}" is not a vowel, so skip it.`,
      changed: `count = ${count}`,
      why: "A string scan is the same idea as an array scan: handle one character at a time.",
      state: { items: chars, active: [index], note: `count = ${count}` },
      code: "for char in text:\n    if char in vowels:\n        count += 1",
      action: "scan",
    }));
  });
  return { title: meta?.title || "String scan: one character at a time", concept: "string-scan", caption: meta?.caption || "Watch each character get checked against one simple rule.", steps };
}

function stackTrace(meta) {
  const ops = meta?.input?.operations || ["push A", "push B", "peek", "pop"];
  const stack = [];
  const steps = [
    makeStep({
      title: "Start with an empty stack",
      body: "A stack removes the newest item first. That rule is called LIFO.",
      changed: "stack = []",
      why: "The top is the only end you touch.",
      state: { stack: [] },
      code: "stack = []",
      action: "setup",
    }),
  ];
  ops.forEach((op) => {
    const [command, value] = String(op).split(/\s+/);
    if (command === "push") {
      stack.push(value);
      steps.push(makeStep({
        title: `Push ${value}`,
        body: `${value} goes on top of the stack.`,
        changed: `top is now ${value}`,
        why: "Push and pop use the same end.",
        state: { stack: [...stack], active: [stack.length - 1] },
        code: `stack.append("${value}")`,
        action: "push",
        animation: "add",
      }));
    } else if (command === "peek") {
      steps.push(makeStep({
        title: "Peek at the top",
        body: `Peek sees ${stack.at(-1)} without removing it.`,
        changed: "stack does not change",
        why: "Peek is a read, not a remove.",
        state: { stack: [...stack], active: [stack.length - 1] },
        code: "top = stack[-1]",
        action: "peek",
      }));
    } else if (command === "pop") {
      const removed = stack.pop();
      steps.push(makeStep({
        title: `Pop removes ${removed}`,
        body: "Pop removes and returns the current top item.",
        changed: `${removed} leaves the stack`,
        why: "The newest item is the first one out.",
        state: { stack: [...stack], active: [stack.length - 1] },
        code: "top = stack.pop()",
        action: "pop",
        animation: "remove",
      }));
    }
  });
  return { title: meta?.title || "Stack: push, peek, pop", concept: "stack", caption: meta?.caption || "See why the newest item comes out first.", steps };
}

function queueTrace(meta) {
  const ops = meta?.input?.operations || ["join Ana", "join Bo", "serve", "join Cy", "serve"];
  const queue = [];
  const served = [];
  const steps = [
    makeStep({
      title: "Start with an empty queue",
      body: "A queue serves the oldest item first. That rule is called FIFO.",
      changed: "queue = []",
      why: "New items join at the back. Old items leave from the front.",
      state: { queue: [] },
      code: "queue = deque()",
      action: "setup",
    }),
  ];
  ops.forEach((op) => {
    const [command, value] = String(op).split(/\s+/);
    if (command === "join" || command === "enqueue") {
      queue.push(value);
      steps.push(makeStep({
        title: `${value} joins`,
        body: `${value} goes to the back of the line.`,
        changed: `back is now ${value}`,
        why: "A queue keeps arrival order.",
        state: { queue: [...queue], active: [queue.length - 1], note: served.length ? `served: ${served.join(", ")}` : "" },
        code: `queue.append("${value}")`,
        action: "enqueue",
        animation: "add",
      }));
    } else if (command === "serve" || command === "dequeue") {
      const removed = queue.shift() || "none";
      served.push(removed);
      steps.push(makeStep({
        title: `Serve ${removed}`,
        body: removed === "none" ? "Nobody is waiting, so record none." : `${removed} was at the front, so they leave first.`,
        changed: `served = ${served.join(", ")}`,
        why: "The front item is the oldest waiting item.",
        state: { queue: [...queue], active: [0], note: `served: ${served.join(", ")}` },
        code: "served.append(queue.popleft())",
        action: "dequeue",
        animation: "remove",
      }));
    }
  });
  return { title: meta?.title || "Queue: first in, first out", concept: "queue", caption: meta?.caption || "Watch the front and back of the line change.", steps };
}

function hashTrace(meta) {
  const items = meta?.input?.items || ["login", "sync", "login", "chat"];
  const target = Number(meta?.input?.target);
  if (Number.isFinite(target)) {
    const seen = {};
    const steps = [
      makeStep({
        title: "Start with an empty map",
        body: "The map stores each earlier value with its index.",
        changed: "{}",
        why: "Then each new value can ask, 'Have I already seen the number I need?'",
        state: { table: [] },
        code: "seen = {}",
        action: "setup",
      }),
    ];
    items.forEach((value, index) => {
      const need = target - value;
      const found = Object.prototype.hasOwnProperty.call(seen, need);
      steps.push(makeStep({
        title: `At index ${index}, value ${value}`,
        body: found ? `${value} needs ${need}, and ${need} is already in the map.` : `${value} needs ${need}, but ${need} is not in the map yet.`,
        changed: found ? `answer indexes = [${seen[need]}, ${index}]` : `store ${value} -> ${index}`,
        why: found ? "The map turns the second nested loop into a quick lookup." : "If there is no pair yet, save this value for later numbers.",
        state: {
          items,
          active: [index],
          table: Object.entries(seen).map(([key, storedIndex]) => ({ key, value: storedIndex, active: Number(key) === need })),
          note: `target = ${target}, need = ${need}`,
        },
        code: "need = target - value\nif need in seen:\n    return [seen[need], index]",
        action: found ? "found" : "lookup",
      }));
      if (!found) seen[value] = index;
    });
    return { title: meta?.title || "Hash map: lookup before insert", concept: "hash-map-set", caption: meta?.caption || "Watch the map store old values so the complement check is quick.", steps };
  }
  const counts = {};
  const steps = [
    makeStep({
      title: "Start with an empty table",
      body: "A hash map stores a value by a key.",
      changed: "{}",
      why: "Here the key is the event name and the value is the count.",
      state: { table: [] },
      code: "counts = {}",
      action: "setup",
    }),
  ];
  items.forEach((item) => {
    counts[item] = (counts[item] || 0) + 1;
    steps.push(makeStep({
      title: `Count ${item}`,
      body: counts[item] === 1 ? `${item} is new, so start it at 1.` : `${item} was already there, so add 1.`,
      changed: `${item} -> ${counts[item]}`,
      why: "Lookup before update keeps the count correct.",
      state: { table: Object.entries(counts).map(([key, value]) => ({ key, value, active: key === item })) },
      code: "counts[item] = counts.get(item, 0) + 1",
      action: "count",
    }));
  });
  return { title: meta?.title || "Hash map: lookup before update", concept: "hash-map-set", caption: meta?.caption || "See how a table remembers what has already appeared.", steps };
}

function linkedListTrace(meta) {
  const steps = [
    makeStep({
      title: "Start with linked nodes",
      body: "Each node stores a value and a next link.",
      changed: "head points to A",
      why: "The list is held together by links, not by indexes.",
      state: {
        nodes: [
          { id: "A", label: "A", x: 70, y: 100, active: true },
          { id: "B", label: "B", x: 190, y: 100 },
          { id: "C", label: "C", x: 310, y: 100 },
        ],
        edges: [{ from: "A", to: "B", active: true }, { from: "B", to: "C" }],
      },
      code: "head -> A -> B -> C",
      action: "read",
    }),
    makeStep({
      title: "Save the next link",
      body: "Before inserting X after A, keep track of B.",
      changed: "X.next will point to B",
      why: "If you lose B, you lose the rest of the list.",
      state: {
        nodes: [
          { id: "A", label: "A", x: 60, y: 80 },
          { id: "X", label: "X", x: 180, y: 150, active: true },
          { id: "B", label: "B", x: 250, y: 80 },
          { id: "C", label: "C", x: 360, y: 80 },
        ],
        edges: [{ from: "A", to: "B" }, { from: "X", to: "B", active: true }, { from: "B", to: "C" }],
      },
      code: "new.next = current.next",
      action: "save link",
    }),
    makeStep({
      title: "Connect A to X",
      body: "Now A points to X, and X points to B.",
      changed: "A -> X -> B",
      why: "The list stays connected because both links were set in the safe order.",
      state: {
        nodes: [
          { id: "A", label: "A", x: 50, y: 100 },
          { id: "X", label: "X", x: 170, y: 100, active: true },
          { id: "B", label: "B", x: 290, y: 100 },
          { id: "C", label: "C", x: 390, y: 100 },
        ],
        edges: [{ from: "A", to: "X", active: true }, { from: "X", to: "B", active: true }, { from: "B", to: "C" }],
      },
      code: "current.next = new",
      action: "insert",
      animation: "add",
    }),
  ];
  return { title: meta?.title || "Linked list: do not lose the chain", concept: "linked-list", caption: meta?.caption || "Trace the links before and after an insert.", steps };
}

function recursionTrace(meta) {
  const n = Number.isFinite(Number(meta?.input?.n)) ? Number(meta.input.n) : 3;
  const steps = [
    makeStep({
      title: `Call sumDigits(${n})`,
      body: "The first call starts the work.",
      changed: "one call is on the stack",
      why: "Recursive calls wait for smaller calls to finish.",
      state: { call_stack: [`sumDigits(${n})`], active_call: 0 },
      code: `sumDigits(${n})`,
      action: "call",
    }),
    makeStep({
      title: "Call a smaller version",
      body: "Remove the last digit and ask the same question again.",
      changed: "another call is added",
      why: "Each call should move closer to the base case.",
      state: { call_stack: [`sumDigits(${n})`, "sumDigits(40)", "sumDigits(4)"], active_call: 2 },
      code: "last = n % 10\nreturn last + sumDigits(n // 10)",
      action: "recurse",
      animation: "add",
    }),
    makeStep({
      title: "Hit the base case",
      body: "A one-digit number can return itself.",
      changed: "sumDigits(4) returns 4",
      why: "The base case stops the calls from going forever.",
      state: { call_stack: [`sumDigits(${n})`, "sumDigits(40)", "sumDigits(4)"], active_call: 2, note: "base case" },
      code: "if n < 10:\n    return n",
      action: "base case",
    }),
    makeStep({
      title: "Return back up",
      body: "Each waiting call uses the value returned by the smaller call.",
      changed: `final answer for ${n} is 11`,
      why: "Recursion finishes by unwinding the call stack.",
      state: { call_stack: [`sumDigits(${n}) -> 11`], active_call: 0, note: "7 + 0 + 4 = 11" },
      code: "return last + smaller_answer",
      action: "return",
      animation: "return",
    }),
  ];
  return { title: meta?.title || "Recursion: calls go down, answers come back", concept: "recursion", caption: meta?.caption || "Watch calls stack up until the base case, then return.", steps };
}

function binarySearchTrace(meta, inputText) {
  const items = safeArrayInput(meta, inputText, [1, 3, 5, 6, 9, 12]).sort((a, b) => a - b);
  const target = Number.isFinite(Number(meta?.input?.target)) ? Number(meta.input.target) : items[Math.min(2, items.length - 1)];
  let left = 0;
  let right = items.length - 1;
  const steps = [];
  while (left <= right && steps.length < 8) {
    const mid = Math.floor((left + right) / 2);
    const value = items[mid];
    steps.push(makeStep({
      title: `Check middle index ${mid}`,
      body: `${value} is compared with target ${target}.`,
      changed: value === target ? "target found" : value < target ? "move left up" : "move right down",
      why: "Because the list is sorted, one half becomes impossible.",
      state: { items, active: [mid], pointers: { left, mid, right }, note: `target = ${target}` },
      code: "mid = (left + right) // 2",
      action: "check mid",
    }));
    if (value === target) break;
    if (value < target) left = mid + 1;
    else right = mid - 1;
  }
  return { title: meta?.title || "Binary search: shrink the range", concept: "binary-search", caption: meta?.caption || "Watch left, mid, and right move on a sorted list.", steps };
}

function twoPointersTrace(meta, inputText) {
  const items = safeArrayInput(meta, inputText, [1, 2, 4, 7]).sort((a, b) => a - b);
  const target = Number.isFinite(Number(meta?.input?.target)) ? Number(meta.input.target) : 9;
  let left = 0;
  let right = items.length - 1;
  const steps = [];
  while (left < right && steps.length < 8) {
    const sum = items[left] + items[right];
    steps.push(makeStep({
      title: `${items[left]} + ${items[right]} = ${sum}`,
      body: sum === target ? "This pair hits the target." : sum < target ? "The sum is too small, so move the left pointer right." : "The sum is too large, so move the right pointer left.",
      changed: sum === target ? "pair found" : sum < target ? "left moves" : "right moves",
      why: "Sorted order tells you which pointer can safely move.",
      state: { items, active: [left, right], pointers: { left, right }, note: `target = ${target}` },
      code: "sum = nums[left] + nums[right]",
      action: "compare pair",
    }));
    if (sum === target) break;
    if (sum < target) left += 1;
    else right -= 1;
  }
  return { title: meta?.title || "Two pointers: move from both ends", concept: "two-pointers", caption: meta?.caption || "Watch a sorted pair search decide which side moves.", steps };
}

function slidingWindowTrace(meta, inputText) {
  const items = safeArrayInput(meta, inputText, [2, 1, 5, 1, 3]);
  const k = Math.max(1, Math.min(items.length, Number.isFinite(Number(meta?.input?.k)) ? Number(meta.input.k) : 3));
  let sum = items.slice(0, k).reduce((total, value) => total + value, 0);
  let best = sum;
  const steps = [
    makeStep({
      title: `Build the first window of ${k}`,
      body: "Add the first k values once.",
      changed: `window sum = ${sum}`,
      why: "After this, each slide only changes two values.",
      state: { items, window: [0, k - 1], active: [...Array(k).keys()], note: `sum = ${sum}, best = ${best}` },
      code: "window_sum = sum(nums[:k])",
      action: "build",
      animation: "grow",
    }),
  ];
  for (let right = k; right < items.length && steps.length < 8; right += 1) {
    const left = right - k;
    sum = sum - items[left] + items[right];
    best = Math.max(best, sum);
    steps.push(makeStep({
      title: `Slide to include ${items[right]}`,
      body: `Subtract ${items[left]} because it left. Add ${items[right]} because it entered.`,
      changed: `sum = ${sum}, best = ${best}`,
      why: "The running total saves you from adding the whole window again.",
      state: { items, window: [left + 1, right], active: [left, right], note: `sum = ${sum}, best = ${best}` },
      code: "window_sum += nums[right] - nums[left]",
      action: "slide",
      animation: "slide",
    }));
  }
  return { title: meta?.title || "Sliding window: update the moving range", concept: "sliding-window", caption: meta?.caption || "Watch the window slide while the running total changes.", steps };
}

function treeTrace(meta) {
  const order = meta?.input?.order || "level-order";
  const nodes = [
    { id: "A", label: "3", x: 210, y: 45 },
    { id: "B", label: "9", x: 120, y: 115 },
    { id: "C", label: "20", x: 300, y: 115 },
    { id: "D", label: "15", x: 260, y: 185 },
    { id: "E", label: "7", x: 350, y: 185 },
  ];
  const edges = [{ from: "A", to: "B" }, { from: "A", to: "C" }, { from: "C", to: "D" }, { from: "C", to: "E" }];
  const visitOrder = order === "preorder" ? ["A", "B", "C", "D", "E"] : order === "inorder" ? ["B", "A", "D", "C", "E"] : ["A", "B", "C", "D", "E"];
  const seen = [];
  const steps = visitOrder.map((id) => {
    seen.push(nodes.find((node) => node.id === id)?.label || id);
    return makeStep({
      title: `Visit ${seen.at(-1)}`,
      body: `Add ${seen.at(-1)} to the ${order} result.`,
      changed: `result = [${seen.join(", ")}]`,
      why: "Traversal means visiting each node in a specific order.",
      state: { nodes: nodes.map((node) => ({ ...node, active: node.id === id })), edges, note: `${order}: ${seen.join(", ")}` },
      code: `${order}(node)`,
      action: "visit",
      animation: "visit",
    });
  });
  return { title: meta?.title || `Tree: ${order} traversal`, concept: "tree", caption: meta?.caption || "Watch nodes get visited one at a time.", steps };
}

function graphTrace(meta) {
  const nodes = [
    { id: "A", label: "A", x: 70, y: 90 },
    { id: "B", label: "B", x: 180, y: 45 },
    { id: "C", label: "C", x: 180, y: 145 },
    { id: "D", label: "D", x: 300, y: 90 },
  ];
  const edges = [{ from: "A", to: "B" }, { from: "A", to: "C" }, { from: "B", to: "D" }, { from: "C", to: "D" }];
  const queue = ["A"];
  const visited = [];
  const steps = [
    makeStep({
      title: "Start from A",
      body: "Put the starting node in the queue.",
      changed: "queue = [A]",
      why: "BFS explores closest neighbors first.",
      state: { nodes: nodes.map((node) => ({ ...node, active: node.id === "A" })), edges, queue, note: "visited: []" },
      code: "queue = deque([start])",
      action: "start",
    }),
  ];
  ["A", "B", "C", "D"].forEach((id) => {
    if (!visited.includes(id)) visited.push(id);
    steps.push(makeStep({
      title: `Visit ${id}`,
      body: `Mark ${id} as visited before exploring its neighbors.`,
      changed: `visited = [${visited.join(", ")}]`,
      why: "The visited set prevents cycles and repeated work.",
      state: { nodes: nodes.map((node) => ({ ...node, active: node.id === id })), edges: edges.map((edge) => ({ ...edge, active: edge.from === id })), note: `visited: ${visited.join(", ")}` },
      code: "visited.add(node)",
      action: "visit",
      animation: "visit",
    }));
  });
  return { title: meta?.title || "Graph: BFS and visited set", concept: "graph", caption: meta?.caption || "Watch the search visit nodes without repeating them.", steps };
}

function buildTrace(meta, inputText) {
  const concept = normalizeConcept(meta?.concept);
  switch (concept) {
    case "string-scan":
      return stringScanTrace(meta, inputText);
    case "stack":
      return stackTrace(meta);
    case "queue":
      return queueTrace(meta);
    case "hash-map-set":
      return hashTrace(meta);
    case "linked-list":
      return linkedListTrace(meta);
    case "recursion":
      return recursionTrace(meta);
    case "binary-search":
      return binarySearchTrace(meta, inputText);
    case "two-pointers":
      return twoPointersTrace(meta, inputText);
    case "sliding-window":
      return slidingWindowTrace(meta, inputText);
    case "tree":
      return treeTrace(meta);
    case "graph":
      return graphTrace(meta);
    case "array-scan":
    default:
      return arrayScanTrace(meta, inputText);
  }
}

function VisualTokenRow({ items = [], active = [], pointers = {}, window = null }) {
  const activeSet = new Set(active || []);
  const pointerEntries = Object.entries(pointers || {});
  const windowStart = Array.isArray(window) ? window[0] : null;
  const windowEnd = Array.isArray(window) ? window[1] : null;
  return (
    <div className="workspace-visual-row" aria-label="Trace values">
      {items.map((item, index) => {
        const labels = pointerEntries.filter(([, value]) => value === index).map(([label]) => label);
        const inWindow = Number.isInteger(windowStart) && Number.isInteger(windowEnd) && index >= windowStart && index <= windowEnd;
        return (
          <div key={`${item}-${index}`} className={`workspace-visual-token ${activeSet.has(index) ? "is-active" : ""} ${inWindow ? "is-window" : ""}`}>
            <strong>{item}</strong>
            <span>{labels.length ? labels.join(" / ") : index}</span>
          </div>
        );
      })}
    </div>
  );
}

function VisualStack({ items = [], active = [] }) {
  const activeSet = new Set(active || []);
  return (
    <div className="workspace-visual-stack" aria-label="Stack state">
      {[...items].reverse().map((item, reverseIndex) => {
        const index = items.length - 1 - reverseIndex;
        return (
          <div key={`${item}-${index}`} className={`workspace-visual-token ${activeSet.has(index) ? "is-active" : ""}`}>
            <strong>{item}</strong>
            {reverseIndex === 0 ? <span>top</span> : null}
          </div>
        );
      })}
      {!items.length ? <p className="workspace-visual-empty">empty</p> : null}
    </div>
  );
}

function VisualTable({ rows = [] }) {
  return (
    <div className="workspace-visual-table" aria-label="Hash table state">
      {rows.map((row, index) => (
        <div key={`${row.key}-${index}`} className={row.active ? "is-active" : ""}>
          <span>{row.key}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function VisualNodes({ nodes = [], edges = [] }) {
  if (!nodes.length) return null;
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  return (
    <svg className="workspace-visual-svg" viewBox="0 0 420 230" role="img" aria-label="Node trace">
      {edges.map((edge, index) => {
        const from = byId[edge.from];
        const to = byId[edge.to];
        if (!from || !to) return null;
        return (
          <line key={`${edge.from}-${edge.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={edge.active ? "is-active" : ""} />
        );
      })}
      {nodes.map((node) => (
        <g key={node.id} className={node.active ? "is-active" : ""}>
          <circle cx={node.x} cy={node.y} r="24" />
          <text x={node.x} y={node.y + 5} textAnchor="middle">{node.label || node.id}</text>
        </g>
      ))}
    </svg>
  );
}

function VisualDiagram({ trace, step, replayKey }) {
  const state = step?.state || {};
  const items = state.items || state.values || [];
  return (
    <div key={`${step?.title}-${replayKey}`} className={`workspace-visual-diagram is-${trace.concept} anim-${step?.animation || "highlight"}`}>
      {state.stack ? <VisualStack items={state.stack} active={state.active} /> : null}
      {state.queue ? (
        <div>
          <VisualTokenRow items={state.queue} active={state.active} />
          <div className="workspace-visual-labels"><span>front</span><span>back</span></div>
        </div>
      ) : null}
      {items.length ? <VisualTokenRow items={items} active={state.active} pointers={state.pointers} window={state.window} /> : null}
      {state.table ? <VisualTable rows={state.table} /> : null}
      {state.nodes ? <VisualNodes nodes={state.nodes} edges={state.edges || []} /> : null}
      {state.call_stack ? (
        <div className="workspace-visual-call-stack">
          {state.call_stack.map((call, index) => (
            <div key={`${call}-${index}`} className={`workspace-visual-token ${index === state.active_call ? "is-active" : ""}`}>
              <strong>{call}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {state.note ? <p className="workspace-visual-note">{state.note}</p> : null}
    </div>
  );
}

function TraceShell({ activeProblem, initialVisualizer, mode = "panel", onClose }) {
  const baseMeta = useMemo(
    () => initialVisualizer || activeProblem?.visualizer || inferVisualizerFromProblem(activeProblem) || { concept: "array-scan" },
    [activeProblem, initialVisualizer],
  );
  const [concept, setConcept] = useState(() => normalizeConcept(baseMeta.concept));
  const [inputText, setInputText] = useState(() => {
    const normalized = normalizeConcept(baseMeta.concept);
    if (normalized === "string-scan") return String(baseMeta?.input?.text || DEFAULT_STRING_TEXT);
    if (EDITABLE_CONCEPTS.has(normalized)) {
      const items = baseMeta?.input?.items || baseMeta?.input?.array;
      return Array.isArray(items) ? items.join(", ") : DEFAULT_ARRAY_TEXT;
    }
    return "";
  });
  const [lastGoodTrace, setLastGoodTrace] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  const meta = useMemo(() => ({ ...baseMeta, concept }), [baseMeta, concept]);
  const traceResult = useMemo(() => {
    try {
      return { trace: buildTrace(meta, EDITABLE_CONCEPTS.has(concept) ? inputText : null), error: "" };
    } catch (error) {
      return { trace: null, error: error.message || "That input could not be visualized yet." };
    }
  }, [concept, inputText, meta]);

  useEffect(() => {
    if (traceResult.trace) {
      setLastGoodTrace(traceResult.trace);
      setStepIndex(0);
      setIsPlaying(false);
      setReplayKey((current) => current + 1);
    }
  }, [traceResult.trace]);

  const trace = traceResult.trace || lastGoodTrace || buildTrace({ concept: "array-scan" }, DEFAULT_ARRAY_TEXT);
  const steps = trace.steps || [];
  const step = steps[stepIndex] || steps[0] || {};
  const canGoBack = stepIndex > 0;
  const canGoNext = stepIndex < steps.length - 1;

  const goToStep = useCallback((nextIndex) => {
    setStepIndex(Math.max(0, Math.min(steps.length - 1, nextIndex)));
    setReplayKey((current) => current + 1);
  }, [steps.length]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    if (!canGoNext) {
      setIsPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => goToStep(stepIndex + 1), 1350);
    return () => window.clearTimeout(timer);
  }, [canGoNext, goToStep, isPlaying, stepIndex]);

  useEffect(() => {
    if (mode !== "modal") return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIsPlaying(false);
        goToStep(stepIndex - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIsPlaying(false);
        goToStep(stepIndex + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToStep, mode, onClose, stepIndex]);

  return (
    <section className={`workspace-visualizer ${mode === "modal" ? "is-modal" : "is-panel"}`}>
      <header className="workspace-visualizer-head">
        <div>
          <span className="workspace-visualizer-kicker">Python Tutor-style trace</span>
          <h3>{trace.title}</h3>
          <p>{trace.caption}</p>
        </div>
        {mode === "modal" ? (
          <button type="button" className="workspace-visual-close" onClick={onClose} autoFocus>
            <FaTimes aria-hidden="true" /> Close
          </button>
        ) : null}
      </header>

      <div className="workspace-visualizer-config">
        <label>
          Concept
          <select value={concept} onChange={(event) => setConcept(event.target.value)}>
            {VISUALIZERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {EDITABLE_CONCEPTS.has(concept) ? (
          <label className="workspace-visualizer-input">
            {concept === "string-scan" ? "Try a short string" : "Try small numbers"}
            <input
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder={concept === "string-scan" ? "Morgan State" : "2, 1, 5, 1, 3"}
            />
          </label>
        ) : (
          <p className="workspace-visualizer-lock">This concept uses a guided preset in V1.</p>
        )}
      </div>

      {traceResult.error ? <p className="workspace-visualizer-error">{traceResult.error}</p> : null}

      <div className="workspace-visualizer-grid">
        <div className="workspace-visualizer-code">
          <span>Trace line</span>
          <pre>{step.code || "Step through the visual trace."}</pre>
        </div>
        <VisualDiagram trace={trace} step={step} replayKey={replayKey} />
      </div>

      <div className="workspace-visualizer-progress" aria-label="Visualizer steps">
        {steps.map((visualStep, index) => (
          <button
            type="button"
            key={`${visualStep.title}-${index}`}
            className={index === stepIndex ? "is-active" : ""}
            aria-label={`Go to step ${index + 1}: ${visualStep.title}`}
            aria-current={index === stepIndex ? "step" : undefined}
            onClick={() => {
              setIsPlaying(false);
              goToStep(index);
            }}
          />
        ))}
      </div>

      <article className="workspace-visualizer-step">
        {step.action ? <span>{step.action}</span> : null}
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        {step.changed ? <p><strong>What changed:</strong> {step.changed}</p> : null}
        {step.why ? <p><strong>Why it matters:</strong> {step.why}</p> : null}
      </article>

      <footer className="workspace-visualizer-controls">
        <button type="button" onClick={() => { setIsPlaying(false); goToStep(0); }}>
          <FaUndo aria-hidden="true" /> Reset
        </button>
        <button type="button" onClick={() => setReplayKey((current) => current + 1)}>
          <FaRedo aria-hidden="true" /> Replay
        </button>
        <button type="button" disabled={!canGoBack} onClick={() => { setIsPlaying(false); goToStep(stepIndex - 1); }}>
          <FaArrowLeft aria-hidden="true" /> Previous
        </button>
        <button type="button" disabled={steps.length < 2 || (!canGoNext && !isPlaying)} onClick={() => setIsPlaying((current) => !current)}>
          {isPlaying ? <><FaPause aria-hidden="true" /> Pause</> : <><FaPlay aria-hidden="true" /> Play</>}
        </button>
        <button type="button" disabled={!canGoNext} onClick={() => { setIsPlaying(false); goToStep(stepIndex + 1); }}>
          Next <FaArrowRight aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}

export function WorkspaceVisualizerPanel({ activeProblem }) {
  return (
    <div className="workspace-visualizer-panel">
      <TraceShell activeProblem={activeProblem} mode="panel" />
    </div>
  );
}

export function WorkspaceVisualizerModal({ activeProblem, onClose }) {
  if (!activeProblem) return null;
  return (
    <div className="workspace-visualizer-backdrop" role="presentation" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Workspace visualizer" onMouseDown={(event) => event.stopPropagation()}>
        <TraceShell activeProblem={activeProblem} mode="modal" onClose={onClose} />
      </div>
    </div>
  );
}

export function VisualizeButton({ onClick }) {
  return (
    <button type="button" className="problem-visualize-button" onClick={onClick}>
      <FaProjectDiagram aria-hidden="true" />
      Visualize this idea
    </button>
  );
}
