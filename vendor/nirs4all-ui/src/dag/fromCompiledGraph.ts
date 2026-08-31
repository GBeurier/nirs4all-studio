/**
 * Adapter: a dag-ml compiled `GraphSpec` / `ExecutionPlan` → {@link DagGraph}.
 *
 * The package does NOT depend on dag-ml; this reads the *serialized* compiled
 * graph (the JSON a host already has) and projects the fields the viewer needs.
 * It is defensive because this is a real system boundary — arbitrary JSON in,
 * a well-typed view-model out. Unknown / malformed entries are skipped, never
 * thrown on. Recognized inputs:
 *   • `ExecutionPlan`  → uses `graph_plan.graph`, plus `variants[]` for badges
 *   • `{ graph: GraphSpec }`
 *   • `GraphSpec`      → `{ nodes, edges }`
 *
 * Group nesting is derived from the dag-ml node-id convention
 * (`branch:b0.model:ridge` → cluster `branch:b0`), or from `seed_label`.
 */

import type { DagEdge, DagEdgeKind, DagGraph, DagNode } from "./types.js";

/** How collapsible clusters are derived from the compiled graph. */
export type GroupBy = "id" | "seed_label" | "none";

export interface FromCompiledGraphOptions {
  /** Cluster derivation strategy (default `"id"`). */
  groupBy?: GroupBy;
  /** Show a `×N` variant badge on generator/tuner nodes (default `true`). */
  variantBadges?: boolean;
}

const EDGE_KINDS = new Set<DagEdgeKind>(["data", "prediction", "target", "artifact", "metric", "control"]);
const VARIANT_KINDS = new Set(["generator", "tuner"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Unwrap the innermost `GraphSpec`-shaped object from any recognized input. */
function resolveGraphSpec(input: unknown): { spec: Record<string, unknown>; variantCount: number } {
  let variantCount = 0;
  let root = input;
  if (isRecord(root) && Array.isArray(root["variants"])) variantCount = root["variants"].length;
  if (isRecord(root) && isRecord(root["graph_plan"]) && isRecord(root["graph_plan"]["graph"])) {
    root = root["graph_plan"]["graph"];
  } else if (isRecord(root) && isRecord(root["graph"])) {
    root = root["graph"];
  }
  return { spec: isRecord(root) ? root : {}, variantCount };
}

function groupPathFromId(id: string): string[] {
  const segments = id.split(".");
  return segments.length > 1 ? segments.slice(0, -1) : [];
}

function deriveGroup(id: string, seedLabel: string | undefined, groupBy: GroupBy): string[] {
  if (groupBy === "none") return [];
  if (groupBy === "seed_label") return seedLabel && seedLabel !== id ? [seedLabel] : [];
  const byId = groupPathFromId(id);
  if (byId.length > 0) return byId;
  return seedLabel && seedLabel !== id ? [seedLabel] : [];
}

function lastSegment(id: string): string {
  const parts = id.split(".");
  return parts[parts.length - 1] ?? id;
}

function portRefNodeId(ref: unknown): string | undefined {
  if (typeof ref === "string") return asString(ref);
  if (isRecord(ref)) return asString(ref["node_id"]) ?? asString(ref["id"]);
  return undefined;
}

function mapNode(raw: unknown, groupBy: GroupBy, variantCount: number, variantBadges: boolean): DagNode | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw["id"]);
  if (id === undefined) return null;
  const kind = asString(raw["kind"]);
  const operator = raw["operator"];
  const operatorType = isRecord(operator) ? asString(operator["type"]) : undefined;
  const seedLabel = asString(raw["seed_label"]);
  const group = deriveGroup(id, seedLabel, groupBy);

  const node: DagNode = { id, label: operatorType ?? lastSegment(id) };
  if (kind !== undefined) node.kind = kind;
  if (kind !== undefined && operatorType !== undefined) node.detail = kind;
  if (group.length > 0) node.group = group;
  if (variantBadges && variantCount > 1 && kind !== undefined && VARIANT_KINDS.has(kind)) {
    node.variants = variantCount;
  }
  if (isRecord(raw["metadata"]) && Object.keys(raw["metadata"]).length > 0) {
    node.meta = raw["metadata"] as Record<string, unknown>;
  }
  return node;
}

function mapEdge(raw: unknown): DagEdge | null {
  if (!isRecord(raw)) return null;
  const source = portRefNodeId(raw["source"]) ?? asString(raw["from"]);
  const target = portRefNodeId(raw["target"]) ?? asString(raw["to"]);
  if (source === undefined || target === undefined) return null;
  const contract = isRecord(raw["contract"]) ? raw["contract"] : undefined;
  const kindRaw = asString(contract?.["kind"]) ?? asString(raw["kind"]);
  const edge: DagEdge = { source, target };
  if (kindRaw !== undefined && EDGE_KINDS.has(kindRaw as DagEdgeKind)) edge.kind = kindRaw as DagEdgeKind;
  if (contract?.["requires_oof"] === true) edge.oof = true;
  return edge;
}

/** Project a serialized dag-ml compiled graph into the viewer's contract. */
export function fromCompiledGraph(input: unknown, options: FromCompiledGraphOptions = {}): DagGraph {
  const groupBy = options.groupBy ?? "id";
  const variantBadges = options.variantBadges ?? true;
  const { spec, variantCount } = resolveGraphSpec(input);

  const rawNodes = Array.isArray(spec["nodes"]) ? spec["nodes"] : [];
  const rawEdges = Array.isArray(spec["edges"]) ? spec["edges"] : [];

  const nodes: DagNode[] = [];
  const ids = new Set<string>();
  for (const raw of rawNodes) {
    const node = mapNode(raw, groupBy, variantCount, variantBadges);
    if (node && !ids.has(node.id)) {
      ids.add(node.id);
      nodes.push(node);
    }
  }

  const edges: DagEdge[] = [];
  for (const raw of rawEdges) {
    const edge = mapEdge(raw);
    if (edge && ids.has(edge.source) && ids.has(edge.target)) edges.push(edge);
  }

  const name = asString(spec["id"]) ?? (isRecord(input) ? asString(input["id"]) : undefined);
  const graph: DagGraph = { nodes, edges };
  if (name !== undefined) graph.name = name;
  return graph;
}
