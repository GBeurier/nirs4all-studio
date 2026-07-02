/**
 * Runtime/result status view-model foundation — public surface.
 *
 * Pure, dependency-free helpers for rendering run and pipeline result statuses:
 * status normalization, display tokens/classes, badge variants, busy-state
 * detection, progress projection, and status-aware empty-state copy.
 *
 * React components keep ownership of icon libraries and markup. Import this
 * foundation from `nirs4all-ui/runtime`.
 */

export * from "./statusDisplay.js";
export * from "./resultMetadata.js";

export interface RuntimeEngineLineage {
  compiled?: boolean | null;
  executed?: boolean | null;
}

export function runtimeEngineLabel(lineage: RuntimeEngineLineage | null | undefined): string | null {
  if (lineage?.executed) return "executed by dag-ml";
  if (lineage?.compiled) return "compiled by dag-ml";
  return null;
}
