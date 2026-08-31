/**
 * nirs4all-ui `dag` domain — the interactive compiled-DAG viewer.
 *
 * A dedicated, self-contained component for exploring a *compiled* DAG-ML graph
 * (or any bound variant) at any scale: layered layout, pan / zoom, viewport
 * culling and level-of-detail keep thousands of nodes responsive, while a
 * collapsible group hierarchy keeps a 5–6000-node graph readable. Unlike the
 * `viz` `PipelineFlow` (a small editable spine), this is a read-only *explorer*
 * of the whole graph.
 *
 * Same package boundary as the rest of nirs4all-ui: presentational + local UI
 * state only — NO app state, routing, network/IO, or runtime execution. Hosts
 * pass a {@link DagGraph} (adapt a real compiled graph with
 * {@link fromCompiledGraph}). A default stylesheet ships at
 * `nirs4all-ui/assets/dag.css`.
 *
 * Consumed as `nirs4all-ui/dag`.
 */

// --- view-model contract + kind → category mapping ---
export * from "./types.js";

// --- palette + adapter ---
export * from "./colors.js";
export * from "./fromCompiledGraph.js";

// --- dataset-shape annotations ---
export {
  deriveShapes,
  formatShape,
  formatCount,
  shapeChange,
  describeShapeDelta,
  SHAPE_CHANGE_STYLE,
  type ShapeChangeKind,
  type ShapeRule,
  type ShapeRuleContext,
  type DeriveShapesOptions,
} from "./shape.js";
export { DEFAULT_DAG_LABELS, resolveLabels, type DagViewLabels } from "./locale.js";

// --- pure engine (reusable by hosts / tests) ---
export {
  buildHierarchy,
  ancestorGroupIds,
  type DagGroup,
  type DagHierarchy,
} from "./hierarchy.js";
export {
  computeEffectiveGraph,
  collapseAtDepth,
  defaultCollapsed,
  shortLabel,
  GROUP_NODE_PREFIX,
  type EffNode,
  type EffEdge,
  type EffectiveGraph,
  type DefaultCollapseOptions,
} from "./collapse.js";
export {
  layoutDag,
  type DagLayout,
  type DagLayoutNode,
  type DagLayoutEdge,
  type DagLayoutFrame,
  type LayoutOptions,
} from "./layout.js";

// --- the component ---
export { DagGraphView, type DagGraphViewProps } from "./DagGraphView.js";
