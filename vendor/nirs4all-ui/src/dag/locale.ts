/**
 * Chrome strings for {@link file://./DagGraphView.tsx DagGraphView}.
 *
 * Presentational text only — node/kind labels come from the data. Hosts pass a
 * partial `labels` override to localize; defaults are concise English.
 */

export interface DagViewLabels {
  title: string;
  search: string;
  fit: string;
  zoomIn: string;
  zoomOut: string;
  expandAll: string;
  collapseAll: string;
  direction: string;
  depth: string;
  nodesVisible: string;
  edges: string;
  legend: string;
  close: string;
  emptyGraph: string;
  group: string;
  contains: string;
  shapes: string;
  shape: string;
  shapeIn: string;
  shapeOut: string;
}

export const DEFAULT_DAG_LABELS: DagViewLabels = {
  title: "Compiled graph",
  search: "Search nodes…",
  fit: "Fit to view",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  direction: "Orientation",
  depth: "Depth",
  nodesVisible: "nodes",
  edges: "edges",
  legend: "Legend",
  close: "Close",
  emptyGraph: "Empty graph",
  group: "Cluster",
  contains: "leaf nodes",
  shapes: "Shapes",
  shape: "Shape",
  shapeIn: "in",
  shapeOut: "out",
};

export function resolveLabels(overrides?: Partial<DagViewLabels>): DagViewLabels {
  return overrides ? { ...DEFAULT_DAG_LABELS, ...overrides } : DEFAULT_DAG_LABELS;
}
