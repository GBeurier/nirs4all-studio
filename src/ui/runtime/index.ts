/**
 * Runtime/result status view-model foundation — public surface.
 *
 * Pure, dependency-free helpers for rendering run and pipeline result statuses:
 * status normalization, display tokens/classes, badge variants, busy-state
 * detection, progress projection, and status-aware empty-state copy.
 *
 * React components keep ownership of icon libraries and markup. Import this
 * foundation from `@/ui/runtime`.
 */

export * from "./statusDisplay";
export * from "./resultMetadata";
