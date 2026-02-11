/**
 * Shared score formatting and metric utilities used across pages (Datasets, Runs, Results).
 *
 * Centralizes formatting logic that was previously duplicated in TopScoreItem,
 * RunDetailSheet, DatasetSubItem, and other components.
 */

/** Metrics where lower values are better (error-based). */
const LOWER_IS_BETTER = new Set([
  "rmse", "rmsecv", "rmsep", "mse", "mae", "mape", "bias", "sep", "nrmse",
]);

/** Regression display metrics. */
export const REGRESSION_METRICS = ["r2", "rmse", "rpd"] as const;

/** Classification display metrics. */
export const CLASSIFICATION_METRICS = ["accuracy", "f1", "auc"] as const;

export function getMetricsForTaskType(taskType: string | null): readonly string[] {
  if (taskType === "classification") return CLASSIFICATION_METRICS;
  return REGRESSION_METRICS;
}

export function isLowerBetter(metric: string | null | undefined): boolean {
  return LOWER_IS_BETTER.has((metric || "").toLowerCase());
}

/**
 * Compare two scores, respecting the metric direction.
 * Returns true if `a` is better than `b`.
 */
export function isBetterScore(a: number, b: number, metric: string | null | undefined): boolean {
  return isLowerBetter(metric) ? a < b : a > b;
}

/**
 * Format a score value to 4 decimal places (or 3 for error metrics).
 */
export function formatScore(value: number | undefined | null): string {
  if (value == null) return "-";
  return value.toFixed(4);
}

/**
 * Format a metric-specific value (3 decimals for error metrics, 4 for others).
 */
export function formatMetricValue(value: number | undefined | null, metric: string): string {
  if (value == null) return "-";
  if (LOWER_IS_BETTER.has(metric.toLowerCase())) return value.toFixed(3);
  return value.toFixed(4);
}

/**
 * Format a metric name for display (uppercase).
 */
export function formatMetricName(metric: string | null | undefined): string {
  if (!metric) return "";
  return metric.toUpperCase();
}
