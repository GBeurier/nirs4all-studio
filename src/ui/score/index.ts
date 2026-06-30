/**
 * Score / metric view-model foundation — public surface.
 *
 * Pure, dependency-free helpers for the metric vocabulary shared across the app
 * (Datasets, Runs, Results, Predictions): metric-key normalization, the static
 * metric catalog + task-type selection rules, and direction-aware score parsing
 * / comparison / formatting.
 *
 * Layering (all pure — no React, no IO, no app state):
 *   metricKeys  ──►  scoreValues
 *               └─►  scoreMetricCatalog
 *
 * App-runtime score-map parsing/extraction stays in `@/lib/scores`, which builds
 * on this foundation. Import the foundation from `@/ui/score`.
 */

export * from "./metricKeys";
export * from "./scoreValues";
export * from "./scoreMetricCatalog";
