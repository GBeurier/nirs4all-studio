/**
 * Category → color mapping for the DAG viewer.
 *
 * Reuses the canonical nirs4all `viz` teal system as the single source of truth
 * (same hues as {@link file://../viz/PipelineFlow.tsx PipelineFlow}), so the DAG
 * view sits inside the existing design language rather than introducing a new
 * one. The adjacent-pair palette is CVD-validated; identity is never carried by
 * color alone — every node also shows its kind label and every category appears
 * in the legend. Hosts may retheme any slot via the `colors` prop.
 */

import { N4_VIZ_COLORS } from "../viz/theme.js";
import type { DagCategory, DagEdgeKind } from "./types.js";

export const DAG_CATEGORY_COLORS: Readonly<Record<DagCategory, string>> = {
  data: N4_VIZ_COLORS.slate,
  split: N4_VIZ_COLORS.indigo,
  preprocess: N4_VIZ_COLORS.cyan,
  model: N4_VIZ_COLORS.teal,
  merge: N4_VIZ_COLORS.green,
  branch: N4_VIZ_COLORS.amber,
  search: N4_VIZ_COLORS.violet,
  aggregate: N4_VIZ_COLORS.rose,
  subgraph: "#0284c7",
  chart: "#db2777",
  group: N4_VIZ_COLORS.slate,
  unknown: N4_VIZ_COLORS.slate,
};

/** Human-facing category labels for the legend. */
export const DAG_CATEGORY_LABELS: Readonly<Record<DagCategory, string>> = {
  data: "Data / source",
  split: "Split / CV",
  preprocess: "Preprocess",
  model: "Model",
  merge: "Merge / join",
  branch: "Branch",
  search: "Variant / tune",
  aggregate: "Aggregate",
  subgraph: "Subgraph",
  chart: "Chart",
  group: "Collapsed group",
  unknown: "Other",
};

/** Edge accent by semantic kind (mixed into the recessive base stroke). */
export const DAG_EDGE_COLORS: Readonly<Record<DagEdgeKind, string>> = {
  data: N4_VIZ_COLORS.slate,
  prediction: N4_VIZ_COLORS.teal,
  target: N4_VIZ_COLORS.indigo,
  artifact: N4_VIZ_COLORS.violet,
  metric: N4_VIZ_COLORS.amber,
  control: N4_VIZ_COLORS.rose,
};

/** Resolve a category color, honoring per-host overrides. */
export function categoryColor(
  category: DagCategory,
  overrides?: Partial<Record<DagCategory, string>>,
): string {
  return overrides?.[category] ?? DAG_CATEGORY_COLORS[category];
}
