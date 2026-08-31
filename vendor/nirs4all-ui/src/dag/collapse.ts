/**
 * Collapse a graph against a set of collapsed group ids → the *effective* graph
 * actually drawn.
 *
 * Collapsing a cluster hides all of its leaf nodes and replaces them with a
 * single super-node; every edge that crossed the cluster boundary is re-routed
 * to that super-node, and edges fully inside a collapsed cluster disappear. This
 * is what keeps a 6000-node graph readable: the effective graph shrinks to the
 * clusters the user has chosen to open. Pure + testable — no layout, no React.
 */

import { dagCategory, type DagCategory, type DagEdgeKind, type DagGraph, type DagShape } from "./types.js";
import type { DagHierarchy } from "./hierarchy.js";

/** Prefix distinguishing a collapsed-group super-node id from a real node id. */
export const GROUP_NODE_PREFIX = "grp:";

export interface EffNode {
  id: string;
  isGroup: boolean;
  category: DagCategory;
  label: string;
  detail?: string;
  kind?: string;
  status?: DagGraph["nodes"][number]["status"];
  variants?: number;
  metric?: number;
  /** Innermost still-visible (expanded) group containing this node, or `null`. */
  containerId: string | null;
  /** Super-nodes only: number of leaf nodes hidden inside. */
  childCount?: number;
  /** Super-nodes only: the collapsed group id (drop `GROUP_NODE_PREFIX`). */
  groupId?: string;
  /** Real nodes only: dataset shape leaving this node. */
  outShape?: DagShape;
  /** Real nodes only: dataset shapes arriving at this node. */
  inShapes?: readonly DagShape[];
}

export interface EffEdge {
  id: string;
  source: string;
  target: string;
  kind?: DagEdgeKind;
  oof: boolean;
  /** Number of underlying edges merged into this one. */
  weight: number;
  /** Shape flowing on the wire (the source node's output shape). */
  shape?: DagShape;
}

export interface EffectiveGraph {
  nodes: EffNode[];
  edges: EffEdge[];
}

interface Representative {
  /** Visible id the node maps to (itself, or a `grp:` super-node). */
  id: string;
  /** The collapsed group id when the node is hidden inside one, else `null`. */
  collapsedGroupId: string | null;
}

/** Outermost collapsed group on a node's ancestor chain wins (it hides the rest). */
function representativeOf(
  hierarchy: DagHierarchy,
  nodeId: string,
  collapsed: ReadonlySet<string>,
): Representative {
  let current = hierarchy.nodeGroupId.get(nodeId) ?? null;
  let outermostCollapsed: string | null = null;
  while (current !== null) {
    if (collapsed.has(current)) outermostCollapsed = current;
    current = hierarchy.groups.get(current)?.parent ?? null;
  }
  if (outermostCollapsed !== null) {
    return { id: GROUP_NODE_PREFIX + outermostCollapsed, collapsedGroupId: outermostCollapsed };
  }
  return { id: nodeId, collapsedGroupId: null };
}

/** Innermost expanded (visible) group that should frame a visible node. */
function visibleContainer(
  hierarchy: DagHierarchy,
  innermostGroupId: string | null,
  collapsed: ReadonlySet<string>,
): string | null {
  let current = innermostGroupId;
  while (current !== null) {
    if (!collapsed.has(current)) return current;
    current = hierarchy.groups.get(current)?.parent ?? null;
  }
  return null;
}

function dominantCategory(counts: Map<DagCategory, number>): DagCategory {
  let best: DagCategory = "group";
  let bestN = -1;
  for (const [cat, n] of counts) {
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return best;
}

/**
 * Compute the effective (collapsed) graph. `collapsed` holds group ids from the
 * {@link DagHierarchy}; an empty set returns the fully-expanded graph.
 */
export function computeEffectiveGraph(
  graph: DagGraph,
  hierarchy: DagHierarchy,
  collapsed: ReadonlySet<string>,
): EffectiveGraph {
  const rep = new Map<string, Representative>();
  const nodes: EffNode[] = [];
  const superNodes = new Map<string, EffNode>();
  // dominant-category vote per collapsed group
  const groupCats = new Map<string, Map<DagCategory, number>>();
  // original node id → shape leaving it (for edge labels + node chips)
  const outShapeById = new Map<string, DagShape>();
  for (const node of graph.nodes) if (node.io?.out) outShapeById.set(node.id, node.io.out);

  for (const node of graph.nodes) {
    const r = representativeOf(hierarchy, node.id, collapsed);
    rep.set(node.id, r);

    if (r.collapsedGroupId === null) {
      const innermost = hierarchy.nodeGroupId.get(node.id) ?? null;
      const category = dagCategory(node.kind);
      const eff: EffNode = {
        id: node.id,
        isGroup: false,
        category,
        label: node.label ?? shortLabel(node.id),
        containerId: visibleContainer(hierarchy, innermost, collapsed),
      };
      if (node.detail !== undefined) eff.detail = node.detail;
      if (node.kind !== undefined) eff.kind = node.kind;
      if (node.status !== undefined) eff.status = node.status;
      if (node.variants !== undefined) eff.variants = node.variants;
      if (node.metric !== undefined) eff.metric = node.metric;
      if (node.io?.out !== undefined) eff.outShape = node.io.out;
      if (node.io?.in !== undefined) eff.inShapes = node.io.in;
      nodes.push(eff);
    } else {
      const votes = groupCats.get(r.collapsedGroupId) ?? new Map<DagCategory, number>();
      const cat = dagCategory(node.kind);
      votes.set(cat, (votes.get(cat) ?? 0) + 1);
      groupCats.set(r.collapsedGroupId, votes);
      if (!superNodes.has(r.id)) {
        const group = hierarchy.groups.get(r.collapsedGroupId);
        const parent = group?.parent ?? null;
        const eff: EffNode = {
          id: r.id,
          isGroup: true,
          category: "group",
          label: group?.label ?? r.collapsedGroupId,
          containerId: visibleContainer(hierarchy, parent, collapsed),
          childCount: group?.descendantLeafCount ?? 0,
          groupId: r.collapsedGroupId,
        };
        superNodes.set(r.id, eff);
        nodes.push(eff);
      }
    }
  }

  // Resolve each super-node's dominant category from the collected votes.
  for (const [groupId, votes] of groupCats) {
    const eff = superNodes.get(GROUP_NODE_PREFIX + groupId);
    if (eff) eff.category = dominantCategory(votes);
  }

  const edgeMap = new Map<string, EffEdge>();
  for (const edge of graph.edges) {
    const s = rep.get(edge.source)?.id;
    const t = rep.get(edge.target)?.id;
    if (s === undefined || t === undefined || s === t) continue;
    const key = `${s}${t}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.weight += 1;
      existing.oof = existing.oof || edge.oof === true;
      if (existing.kind === undefined && edge.kind !== undefined) existing.kind = edge.kind;
      continue;
    }
    const eff: EffEdge = { id: key, source: s, target: t, oof: edge.oof === true, weight: 1 };
    if (edge.kind !== undefined) eff.kind = edge.kind;
    const shape = outShapeById.get(edge.source);
    if (shape !== undefined) eff.shape = shape;
    edgeMap.set(key, eff);
  }

  return { nodes, edges: [...edgeMap.values()] };
}

/** Last `.`/`:`/`/` segment of an id — a readable fallback node label. */
export function shortLabel(id: string): string {
  const parts = id.split(/[./]/);
  return parts[parts.length - 1] ?? id;
}

/**
 * Collapse every cluster at exactly `depth` (deeper ones are hidden inside them,
 * so they need not be listed). `depth < 0` or `depth > maxDepth` → fully
 * expanded. This is the primitive behind the depth stepper and expand/collapse
 * all.
 */
export function collapseAtDepth(hierarchy: DagHierarchy, depth: number): Set<string> {
  const collapsed = new Set<string>();
  if (depth < 0) return collapsed;
  for (const group of hierarchy.groups.values()) {
    if (group.depth === depth) collapsed.add(group.id);
  }
  return collapsed;
}

export interface DefaultCollapseOptions {
  /** Force a specific collapse depth instead of auto-fitting. */
  depth?: number;
  /** Auto-fit target for the initial visible node count (default 160). */
  targetVisible?: number;
}

/**
 * Choose an initial collapse state. With an explicit `depth`, collapse to it.
 * Otherwise pick the most-expanded depth whose visible node count still fits
 * under `targetVisible` — so a small graph opens fully and a 6000-node graph
 * opens as a handful of clusters.
 */
export function defaultCollapsed(
  hierarchy: DagHierarchy,
  totalNodes: number,
  options: DefaultCollapseOptions = {},
): { collapsed: Set<string>; depth: number } {
  const maxDepth = hierarchy.maxDepth;
  if (options.depth !== undefined) {
    return { collapsed: collapseAtDepth(hierarchy, options.depth), depth: options.depth };
  }
  const target = options.targetVisible ?? 160;
  if (maxDepth < 0 || totalNodes <= target) {
    return { collapsed: new Set(), depth: maxDepth + 1 };
  }

  const groupsAtDepth = new Array<number>(maxDepth + 1).fill(0);
  for (const group of hierarchy.groups.values()) {
    groupsAtDepth[group.depth] = (groupsAtDepth[group.depth] as number) + 1;
  }
  const leafByDepth = new Map<number, number>();
  for (const gid of hierarchy.nodeGroupId.values()) {
    const d = gid === null ? -1 : hierarchy.groups.get(gid)?.depth ?? -1;
    leafByDepth.set(d, (leafByDepth.get(d) ?? 0) + 1);
  }
  const visibleAt = (d: number): number => {
    let leaves = 0;
    for (const [depth, count] of leafByDepth) if (depth < d) leaves += count;
    return leaves + (groupsAtDepth[d] ?? 0);
  };

  // visible count grows monotonically with depth → keep the deepest that fits.
  let best = 0;
  for (let d = 0; d <= maxDepth + 1; d += 1) {
    const visible = d > maxDepth ? totalNodes : visibleAt(d);
    if (visible <= target) best = d;
  }
  return {
    collapsed: best > maxDepth ? new Set<string>() : collapseAtDepth(hierarchy, best),
    depth: best,
  };
}
