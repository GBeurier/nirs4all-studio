/**
 * Dataset-shape helpers for the DAG viewer — pure view-model logic, no runtime
 * execution (same class of helper as `dataset/buildDatasetPreview`).
 *
 * `deriveShapes` propagates an entry dataset shape through the graph so the
 * viewer can show what arrives at and leaves every node — the "imagine we feed
 * the pipeline a (multimodal) dataset" view. Transform semantics are per-category
 * *display heuristics* (overridable); when a host has authoritative shapes (from
 * a materialized dag-ml plan) it sets `node.io` directly and those win.
 */

import { dagCategory, type DagCategory, type DagGraph, type DagNode, type DagShape, type DagSourceShape } from "./types.js";

export type ShapeChangeKind = "none" | "rows-up" | "rows-down" | "feat-up" | "feat-down" | "predict" | "join";

/** Glyph + tone used to badge a node whose output shape changes. */
export const SHAPE_CHANGE_STYLE: Readonly<Record<ShapeChangeKind, { glyph: string; tone: string }>> = {
  none: { glyph: "", tone: "" },
  "rows-up": { glyph: "↑", tone: "#d97706" }, // amber — data volume grows (augmentation, folds)
  "rows-down": { glyph: "↓", tone: "#64748b" }, // fewer rows (split, exclude, aggregate)
  "feat-up": { glyph: "＋", tone: "#10b981" }, // more features
  join: { glyph: "⋔", tone: "#10b981" }, // sources / predictions merged
  "feat-down": { glyph: "−", tone: "#4f46e5" }, // dimensionality reduction
  predict: { glyph: "ŷ", tone: "#0d9488" }, // becomes predictions
};

/** Compact human count: 2048 → "2048", 12000 → "12k", 1.2e6 → "1.2M". */
export function formatCount(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "·";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 10000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Compact one-line shape, e.g. "240×2048", "240×2060 ·2src", "240×1 ŷ". */
export function formatShape(shape: DagShape | undefined): string {
  if (!shape) return "—";
  if (shape.label) return shape.label;
  const isPred = shape.representation === "prediction";
  const rows = formatCount(shape.samples);
  const cols = isPred ? String(shape.targets ?? 1) : formatCount(shape.features);
  let out = `${rows}×${cols}`;
  const n = shape.sources?.length ?? 0;
  if (n > 1) out += ` ·${n}src`;
  if (isPred) out += " ŷ";
  return out;
}

function sumFeatures(shapes: readonly DagShape[]): number | undefined {
  let total = 0;
  let any = false;
  for (const s of shapes) {
    if (s.features != null) {
      total += s.features;
      any = true;
    }
  }
  return any ? total : undefined;
}

function sourceCount(shape: DagShape): number {
  return shape.sources?.length ?? (shape.features != null ? 1 : 0);
}

/** Classify how a node's output shape differs from its inputs. */
export function shapeChange(inputs: readonly DagShape[], out: DagShape | undefined): ShapeChangeKind {
  const ins = inputs.filter(Boolean);
  if (!out || ins.length === 0) return "none";
  const inSamples = ins.find((s) => s.samples != null)?.samples;
  const inFeat = sumFeatures(ins);
  const inSrc = ins.reduce((a, s) => a + sourceCount(s), 0);
  const outSrc = sourceCount(out);
  const inAllPred = ins.every((s) => s.representation === "prediction");

  if (out.representation === "prediction" && !inAllPred) return "predict";
  if (ins.length > 1 || (out.features != null && inSrc > outSrc && outSrc >= 1)) return "join";
  if (inSamples != null && out.samples != null) {
    if (out.samples > inSamples) return "rows-up";
    if (out.samples < inSamples) return "rows-down";
  }
  if (inFeat != null && out.features != null) {
    if (out.features > inFeat) return "feat-up";
    if (out.features < inFeat) return "feat-down";
  }
  return "none";
}

/** One-line human delta for the inspector, or null when nothing changes. */
export function describeShapeDelta(inputs: readonly DagShape[], out: DagShape | undefined): string | null {
  const kind = shapeChange(inputs, out);
  if (kind === "none" || !out) return null;
  const ins = inputs.filter(Boolean);
  const inSamples = ins.find((s) => s.samples != null)?.samples;
  const inFeat = sumFeatures(ins);

  switch (kind) {
    case "rows-up":
    case "rows-down": {
      if (inSamples == null || out.samples == null) return kind === "rows-up" ? "more rows" : "fewer rows";
      const factor = kind === "rows-up" && inSamples > 0 && out.samples % inSamples === 0 ? ` (×${out.samples / inSamples})` : "";
      return `rows ${formatCount(inSamples)} → ${formatCount(out.samples)}${factor}`;
    }
    case "feat-up":
    case "feat-down":
    case "join": {
      const parts: string[] = [];
      if (inFeat != null && out.features != null) parts.push(`features ${formatCount(inFeat)} → ${formatCount(out.features)}`);
      const inSrc = ins.reduce((a, s) => a + sourceCount(s), 0);
      const outSrc = sourceCount(out);
      if (inSrc !== outSrc) parts.push(`${inSrc} → ${outSrc} sources`);
      return parts.join(" · ") || (kind === "join" ? "joined" : null);
    }
    case "predict":
      return `→ prediction (${out.targets ?? 1})`;
    default:
      return null;
  }
}

// --- deriveShapes ----------------------------------------------------------

export interface ShapeRuleContext {
  node: DagNode;
  category: DagCategory;
  /** Output shapes of the node's predecessors (its inputs). */
  inputs: DagShape[];
  /** Entry shape for a root/source node, if one was provided. */
  entry: DagShape | undefined;
}

export type ShapeRule = (ctx: ShapeRuleContext) => DagShape | undefined;

export interface DeriveShapesOptions {
  /** Entry dataset shape for source/root nodes, keyed by node id. */
  entries?: Readonly<Record<string, DagShape>>;
  /** Override the display heuristic for a category. */
  rules?: Partial<Record<DagCategory, ShapeRule>>;
}

function numMeta(node: DagNode, key: string): number | undefined {
  const v = node.meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function augmentFactor(node: DagNode): number | undefined {
  return numMeta(node, "factor") ?? numMeta(node, "augment") ?? numMeta(node, "augmentFactor");
}

function joinInputs(inputs: readonly DagShape[], isPrediction: boolean): DagShape | undefined {
  if (inputs.length === 0) return undefined;
  const samples = inputs.find((s) => s.samples != null)?.samples;
  const sources: DagSourceShape[] = [];
  let features = 0;
  let anyFeat = false;
  for (const s of inputs) {
    if (isPrediction) {
      features += s.targets ?? s.features ?? 1;
      anyFeat = true;
    } else if (s.features != null) {
      features += s.features;
      anyFeat = true;
    }
    if (s.sources) sources.push(...s.sources);
    else if (s.features != null) sources.push({ name: s.representation ?? "source", features: s.features, ...(s.representation ? { kind: s.representation } : {}) });
  }
  const out: DagShape = { representation: "tabular_numeric" };
  if (samples != null) out.samples = samples;
  if (anyFeat) out.features = features;
  if (sources.length > 0) out.sources = sources;
  if (inputs.length > 1) out.note = isPrediction ? "stacked predictions" : "joined sources";
  return out;
}

const defaultRule: ShapeRule = ({ node, category, inputs, entry }) => {
  const first = inputs[0];
  switch (category) {
    case "data":
      if (node.kind === "source_join" || inputs.length > 1) return joinInputs(inputs, false);
      return entry ?? first;
    case "merge":
      return joinInputs(inputs, node.kind === "prediction_join");
    case "preprocess": {
      if (!first) return undefined;
      const factor = augmentFactor(node);
      if (node.kind === "augmentation" && factor && first.samples != null) {
        return { ...first, samples: first.samples * factor, note: `×${factor} augmented` };
      }
      return first;
    }
    case "split":
      return first ? { ...first, note: "CV folds" } : undefined;
    case "model": {
      const targets = numMeta(node, "targets") ?? first?.targets ?? 1;
      const out: DagShape = { targets, representation: "prediction" };
      if (first?.samples != null) out.samples = first.samples;
      return out;
    }
    case "aggregate":
      return first ? { ...first, note: "aggregated" } : undefined;
    default:
      return first;
  }
};

/**
 * Fill `io.in` / `io.out` on every node by propagating entry shapes through the
 * graph in topological order. Nodes that already carry `io.out` are treated as
 * authoritative and are not recomputed. Cycles are tolerated (their nodes are
 * processed last). Returns a new graph; the input is not mutated.
 */
export function deriveShapes(graph: DagGraph, options: DeriveShapesOptions = {}): DagGraph {
  const entries = options.entries ?? {};
  const rules = options.rules ?? {};
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const preds = new Map<string, string[]>();
  const succ = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of graph.nodes) {
    preds.set(n.id, []);
    succ.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    (preds.get(e.target) as string[]).push(e.source);
    (succ.get(e.source) as string[]).push(e.target);
    indeg.set(e.target, (indeg.get(e.target) as number) + 1);
  }

  const deg = new Map(indeg);
  const order: string[] = graph.nodes.filter((n) => deg.get(n.id) === 0).map((n) => n.id);
  for (let h = 0; h < order.length; h += 1) {
    for (const v of succ.get(order[h] as string) as string[]) {
      deg.set(v, (deg.get(v) as number) - 1);
      if (deg.get(v) === 0) order.push(v);
    }
  }
  if (order.length < graph.nodes.length) {
    const seen = new Set(order);
    for (const n of graph.nodes) if (!seen.has(n.id)) order.push(n.id);
  }

  const outShape = new Map<string, DagShape | undefined>();
  const inShapes = new Map<string, DagShape[]>();
  for (const id of order) {
    const node = byId.get(id) as DagNode;
    const ins = (preds.get(id) as string[]).map((p) => outShape.get(p)).filter((s): s is DagShape => s != null);
    inShapes.set(id, ins);
    if (node.io?.out) {
      outShape.set(id, node.io.out);
      continue;
    }
    const category = dagCategory(node.kind);
    const rule = rules[category] ?? defaultRule;
    const entryVal = entries[id];
    outShape.set(id, rule({ node, category, inputs: ins, entry: entryVal }));
  }

  const nodes = graph.nodes.map((n) => {
    const inList = n.io?.in ?? inShapes.get(n.id);
    const out = n.io?.out ?? outShape.get(n.id);
    const cleanIn = inList && inList.length > 0 ? inList : undefined;
    if (!cleanIn && !out) return n;
    return { ...n, io: { ...(cleanIn ? { in: cleanIn } : {}), ...(out ? { out } : {}) } };
  });
  return { ...graph, nodes };
}
