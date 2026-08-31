/**
 * Layered ("Sugiyama-light") layout for the effective graph.
 *
 * Three pure passes — longest-path layering (cycle-safe), barycenter crossing
 * reduction, then coordinate assignment — plus cluster frame boxes derived from
 * the group hierarchy. O(V + E) per pass, so it stays cheap even when a user
 * expands several thousand nodes. No DOM, no React: given the same effective
 * graph it always returns the same geometry, which is what makes it memoizable
 * across pan/zoom and unit-testable.
 */

import { round } from "../viz/geometry.js";
import type { DagDirection } from "./types.js";
import type { EffEdge, EffectiveGraph, EffNode } from "./collapse.js";
import type { DagHierarchy } from "./hierarchy.js";

export interface DagLayoutNode {
  node: EffNode;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  order: number;
}

export interface DagLayoutEdge {
  edge: EffEdge;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  path: string;
  /** True when the edge runs against the rank direction (part of a cycle). */
  back: boolean;
}

export interface DagLayoutFrame {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DagLayout {
  nodes: DagLayoutNode[];
  edges: DagLayoutEdge[];
  frames: DagLayoutFrame[];
  width: number;
  height: number;
  direction: DagDirection;
  nodeW: number;
  nodeH: number;
}

export interface LayoutOptions {
  direction: DagDirection;
  hierarchy?: DagHierarchy;
}

interface Metrics {
  nodeW: number;
  nodeH: number;
  rankStep: number;
  alongStep: number;
}

const PAD = 26;
const FRAME_PAD = 14;
const FRAME_HEADER = 22;
const SWEEPS = 4;

function metricsFor(direction: DagDirection): Metrics {
  return direction === "LR"
    ? { nodeW: 178, nodeH: 42, rankStep: 178 + 74, alongStep: 42 + 16 }
    : { nodeW: 170, nodeH: 52, rankStep: 52 + 62, alongStep: 170 + 26 };
}

function emptyLayout(direction: DagDirection): DagLayout {
  const m = metricsFor(direction);
  return { nodes: [], edges: [], frames: [], width: 0, height: 0, direction, nodeW: m.nodeW, nodeH: m.nodeH };
}

/** Kahn topological order; cyclic leftovers are appended in index order. */
function topoOrder(n: number, out: number[][], inDeg: number[]): number[] {
  const deg = inDeg.slice();
  const queue: number[] = [];
  for (let i = 0; i < n; i += 1) if (deg[i] === 0) queue.push(i);
  const order: number[] = [];
  let head = 0;
  while (head < queue.length) {
    const u = queue[head] as number;
    head += 1;
    order.push(u);
    for (const v of out[u] as number[]) {
      deg[v] = (deg[v] as number) - 1;
      if (deg[v] === 0) queue.push(v);
    }
  }
  if (order.length < n) {
    const seen = new Set(order);
    for (let i = 0; i < n; i += 1) if (!seen.has(i)) order.push(i);
  }
  return order;
}

export function layoutDag(eff: EffectiveGraph, opts: LayoutOptions): DagLayout {
  const { direction } = opts;
  const n = eff.nodes.length;
  if (n === 0) return emptyLayout(direction);

  const m = metricsFor(direction);
  const index = new Map<string, number>();
  eff.nodes.forEach((node, i) => index.set(node.id, i));

  const out: number[][] = Array.from({ length: n }, () => []);
  const inn: number[][] = Array.from({ length: n }, () => []);
  const inDeg = new Array<number>(n).fill(0);
  for (const edge of eff.edges) {
    const s = index.get(edge.source);
    const t = index.get(edge.target);
    if (s === undefined || t === undefined || s === t) continue;
    (out[s] as number[]).push(t);
    (inn[t] as number[]).push(s);
    inDeg[t] = (inDeg[t] as number) + 1;
  }

  // --- 1. longest-path layering over the topological order (back edges ignored)
  const order = topoOrder(n, out, inDeg);
  const topoRank = new Array<number>(n).fill(0);
  order.forEach((node, rank) => (topoRank[node] = rank));
  const layer = new Array<number>(n).fill(0);
  for (const u of order) {
    for (const v of out[u] as number[]) {
      if ((topoRank[u] as number) < (topoRank[v] as number) && (layer[u] as number) + 1 > (layer[v] as number)) {
        layer[v] = (layer[u] as number) + 1;
      }
    }
  }

  let maxLayer = 0;
  for (let i = 0; i < n; i += 1) if ((layer[i] as number) > maxLayer) maxLayer = layer[i] as number;
  const layers: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
  // seed each layer in topological order for a stable starting arrangement
  for (const node of order) (layers[layer[node] as number] as number[]).push(node);

  const pos = new Array<number>(n).fill(0);
  const reindex = (): void => {
    for (const layerNodes of layers) layerNodes.forEach((node, i) => (pos[node] = i));
  };
  reindex();

  // --- 2. barycenter crossing reduction (alternating down / up sweeps)
  const barycenter = (node: number, neighbors: number[][], onLayer: number): number => {
    const list = neighbors[node] as number[];
    let sum = 0;
    let count = 0;
    for (const nb of list) {
      if ((layer[nb] as number) === onLayer) {
        sum += pos[nb] as number;
        count += 1;
      }
    }
    return count === 0 ? (pos[node] as number) : sum / count;
  };
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    for (let L = 1; L <= maxLayer; L += 1) {
      const layerNodes = layers[L] as number[];
      const bc = new Map<number, number>();
      for (const node of layerNodes) bc.set(node, barycenter(node, inn, L - 1));
      layerNodes.sort((a, b) => (bc.get(a) as number) - (bc.get(b) as number));
    }
    reindex();
    for (let L = maxLayer - 1; L >= 0; L -= 1) {
      const layerNodes = layers[L] as number[];
      const bc = new Map<number, number>();
      for (const node of layerNodes) bc.set(node, barycenter(node, out, L + 1));
      layerNodes.sort((a, b) => (bc.get(a) as number) - (bc.get(b) as number));
    }
    reindex();
  }

  // --- 3. coordinate assignment (rank axis = layer, cross axis = order)
  let globalAlong = 0;
  for (const layerNodes of layers) globalAlong = Math.max(globalAlong, layerNodes.length * m.alongStep);

  const layoutNodes: DagLayoutNode[] = new Array(n);
  for (let L = 0; L <= maxLayer; L += 1) {
    const layerNodes = layers[L] as number[];
    const alongOffset = (globalAlong - layerNodes.length * m.alongStep) / 2;
    const rankPos = L * m.rankStep;
    layerNodes.forEach((node, o) => {
      const alongPos = o * m.alongStep + alongOffset;
      const x = direction === "LR" ? rankPos : alongPos;
      const y = direction === "LR" ? alongPos : rankPos;
      layoutNodes[node] = { node: eff.nodes[node] as EffNode, x, y, w: m.nodeW, h: m.nodeH, layer: L, order: o };
    });
  }

  // --- cluster frames from the group hierarchy
  const frames = buildFrames(layoutNodes, opts.hierarchy);

  // --- normalize so all content starts at (PAD, PAD)
  let minX = Infinity;
  let minY = Infinity;
  for (const ln of layoutNodes) {
    minX = Math.min(minX, ln.x);
    minY = Math.min(minY, ln.y);
  }
  for (const f of frames) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
  }
  const dx = PAD - minX;
  const dy = PAD - minY;
  let maxX = 0;
  let maxY = 0;
  for (const ln of layoutNodes) {
    ln.x = round(ln.x + dx);
    ln.y = round(ln.y + dy);
    maxX = Math.max(maxX, ln.x + ln.w);
    maxY = Math.max(maxY, ln.y + ln.h);
  }
  for (const f of frames) {
    f.x = round(f.x + dx);
    f.y = round(f.y + dy);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  }

  // --- 4. edge routes (computed from the normalized node coordinates)
  const layoutEdges: DagLayoutEdge[] = [];
  for (const edge of eff.edges) {
    const s = index.get(edge.source);
    const t = index.get(edge.target);
    if (s === undefined || t === undefined) continue;
    const a = layoutNodes[s] as DagLayoutNode;
    const b = layoutNodes[t] as DagLayoutNode;
    const back = (layer[t] as number) <= (layer[s] as number);
    layoutEdges.push(edgeRoute(edge, a, b, direction, back));
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    frames,
    width: round(maxX + PAD),
    height: round(maxY + PAD),
    direction,
    nodeW: m.nodeW,
    nodeH: m.nodeH,
  };
}

function edgeRoute(
  edge: EffEdge,
  a: DagLayoutNode,
  b: DagLayoutNode,
  direction: DagDirection,
  back: boolean,
): DagLayoutEdge {
  let sx: number;
  let sy: number;
  let tx: number;
  let ty: number;
  let path: string;
  if (direction === "LR") {
    sx = a.x + a.w;
    sy = a.y + a.h / 2;
    tx = b.x;
    ty = b.y + b.h / 2;
    const off = Math.max(28, Math.abs(tx - sx) / 2);
    path = `M${round(sx)},${round(sy)} C${round(sx + off)},${round(sy)} ${round(tx - off)},${round(ty)} ${round(tx)},${round(ty)}`;
  } else {
    sx = a.x + a.w / 2;
    sy = a.y + a.h;
    tx = b.x + b.w / 2;
    ty = b.y;
    const off = Math.max(24, Math.abs(ty - sy) / 2);
    path = `M${round(sx)},${round(sy)} C${round(sx)},${round(sy + off)} ${round(tx)},${round(ty - off)} ${round(tx)},${round(ty)}`;
  }
  return { edge, sx: round(sx), sy: round(sy), tx: round(tx), ty: round(ty), path, back };
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function buildFrames(
  layoutNodes: readonly DagLayoutNode[],
  hierarchy: DagHierarchy | undefined,
): DagLayoutFrame[] {
  if (!hierarchy || hierarchy.groups.size === 0) return [];
  const boxes = new Map<string, Box>();
  const extend = (id: string, ln: DagLayoutNode): void => {
    const box = boxes.get(id);
    if (box) {
      box.minX = Math.min(box.minX, ln.x);
      box.minY = Math.min(box.minY, ln.y);
      box.maxX = Math.max(box.maxX, ln.x + ln.w);
      box.maxY = Math.max(box.maxY, ln.y + ln.h);
    } else {
      boxes.set(id, { minX: ln.x, minY: ln.y, maxX: ln.x + ln.w, maxY: ln.y + ln.h });
    }
  };

  for (const ln of layoutNodes) {
    let g = ln.node.containerId;
    while (g !== null) {
      extend(g, ln);
      g = hierarchy.groups.get(g)?.parent ?? null;
    }
  }

  let maxDepth = 0;
  for (const id of boxes.keys()) maxDepth = Math.max(maxDepth, hierarchy.groups.get(id)?.depth ?? 0);

  const frames: DagLayoutFrame[] = [];
  for (const [id, box] of boxes) {
    const group = hierarchy.groups.get(id);
    const depth = group?.depth ?? 0;
    // Outer frames get more padding so their header always clears inner frames.
    const pad = FRAME_PAD + (maxDepth - depth) * 6;
    frames.push({
      id,
      label: group?.label ?? id,
      depth,
      x: box.minX - pad,
      y: box.minY - pad - FRAME_HEADER,
      w: box.maxX - box.minX + pad * 2,
      h: box.maxY - box.minY + pad * 2 + FRAME_HEADER,
    });
  }
  // outer (shallow) first so inner frames paint on top
  frames.sort((a, b) => a.depth - b.depth);
  return frames;
}
