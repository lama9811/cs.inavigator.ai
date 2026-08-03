import type { Edge, Node } from "./types";

const WIDTH = 900;
const HEIGHT = 520;

export function layoutArray(
  values: Array<string | number>,
  options: { y?: number; startX?: number; gap?: number; type?: Node["type"] } = {},
): Node[] {
  const gap = options.gap ?? 92;
  const totalWidth = Math.max(0, (values.length - 1) * gap);
  const startX = options.startX ?? WIDTH / 2 - totalWidth / 2;
  const y = options.y ?? HEIGHT / 2;
  return values.map((value, index) => ({
    id: `item-${index}`,
    x: startX + index * gap,
    y,
    value,
    type: options.type ?? "array-cell",
    label: String(index),
    state: "default",
  }));
}

export function layoutHashBuckets(bucketCount: number, entries: Record<number, Array<string | number>>): { nodes: Node[]; edges: Edge[] } {
  const bucketGap = 92;
  const startX = WIDTH / 2 - ((bucketCount - 1) * bucketGap) / 2;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (let index = 0; index < bucketCount; index += 1) {
    const bucketId = `bucket-${index}`;
    const bucketX = startX + index * bucketGap;
    nodes.push({
      id: bucketId,
      x: bucketX,
      y: 120,
      value: index,
      type: "hash-bucket",
      label: "bucket",
      state: "default",
    });

    (entries[index] || []).forEach((value, entryIndex) => {
      const entryId = `entry-${index}-${entryIndex}`;
      nodes.push({
        id: entryId,
        x: bucketX,
        y: 220 + entryIndex * 82,
        value,
        type: "hash-entry",
        label: entryIndex === 0 ? "head" : "next",
        state: "default",
      });
      edges.push({
        id: `${entryId}-edge`,
        from: entryIndex === 0 ? bucketId : `entry-${index}-${entryIndex - 1}`,
        to: entryId,
        type: "pointer",
      });
    });
  }

  return { nodes, edges };
}

interface TreeItem {
  id: string;
  value: string | number;
  left?: TreeItem;
  right?: TreeItem;
}

export function insertTreeValue(root: TreeItem | null, value: number): TreeItem {
  if (!root) return { id: `tree-${value}`, value };
  if (value < Number(root.value)) {
    return { ...root, left: insertTreeValue(root.left || null, value) };
  }
  return { ...root, right: insertTreeValue(root.right || null, value) };
}

export function layoutTree(root: TreeItem | null): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  function walk(item: TreeItem | undefined, depth: number, minX: number, maxX: number, parentId?: string) {
    if (!item) return;
    const x = (minX + maxX) / 2;
    const y = 86 + depth * 112;
    nodes.push({
      id: item.id,
      x,
      y,
      value: item.value,
      type: "tree-node",
      state: "default",
    });
    if (parentId) {
      edges.push({
        id: `${parentId}-${item.id}`,
        from: parentId,
        to: item.id,
        type: "parent-child",
      });
    }
    walk(item.left, depth + 1, minX, x - 28, item.id);
    walk(item.right, depth + 1, x + 28, maxX, item.id);
  }

  walk(root || undefined, 0, 70, WIDTH - 70);
  return { nodes, edges };
}

export function layoutCircularGraph(values: string[], links: Array<[string, string]>): { nodes: Node[]; edges: Edge[] } {
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const radius = 172;
  const nodes = values.map((value, index) => {
    const angle = (Math.PI * 2 * index) / values.length - Math.PI / 2;
    return {
      id: value,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      value,
      type: "graph-vertex" as const,
      state: "default" as const,
    };
  });
  const edges = links.map(([from, to]) => ({
    id: `${from}-${to}`,
    from,
    to,
    type: "graph-edge" as const,
  }));
  return { nodes, edges };
}

export function layoutConditional(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: "input", x: 130, y: 260, value: "input", type: "logic-node", state: "default" },
    { id: "condition", x: 330, y: 260, value: "rule?", type: "logic-node", state: "default" },
    { id: "yes", x: 570, y: 160, value: "yes branch", type: "logic-node", state: "default" },
    { id: "no", x: 570, y: 360, value: "no branch", type: "logic-node", state: "inactive" },
    { id: "result", x: 770, y: 160, value: "result", type: "logic-node", state: "default" },
  ];
  const edges: Edge[] = [
    { id: "input-condition", from: "input", to: "condition", type: "branch" },
    { id: "condition-yes", from: "condition", to: "yes", type: "branch", label: "yes" },
    { id: "condition-no", from: "condition", to: "no", type: "branch", label: "no", state: "inactive" },
    { id: "yes-result", from: "yes", to: "result", type: "branch" },
  ];
  return { nodes, edges };
}
