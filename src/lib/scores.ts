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

/** A single metric entry for TabReport-style display. */
export interface MetricEntry {
  label: string;
  value: number | null | undefined;
  key: string;
  highlight?: boolean;
}

/**
 * Extract TabReport-style metrics from a best chain result.
 * Returns an array of labeled metric entries for display, filtered to only include available values.
 */
export function extractReportMetrics(
  chain: { final_test_score?: number | null; final_scores?: Record<string, number>; scores?: { val?: Record<string, number>; test?: Record<string, number> } },
  taskType: string | null,
): MetricEntry[] {
  const hasFinal = chain.final_test_score != null;
  const fs = chain.final_scores || {};
  const valScores = chain.scores?.val || {};
  const testScores = chain.scores?.test || {};

  if (taskType === "classification") {
    const src = hasFinal ? fs : testScores;
    const cvSrc = valScores;
    return [
      { label: hasFinal ? "Acc (Final)" : "Acc (Test)", value: src.accuracy, key: "accuracy", highlight: true },
      { label: "Acc (CV)", value: cvSrc.accuracy, key: "accuracy" },
      { label: "F1", value: src.f1, key: "f1", highlight: true },
      { label: "AUC", value: src.roc_auc, key: "roc_auc" },
      { label: "BalAcc", value: src.balanced_accuracy, key: "balanced_accuracy" },
      { label: "Prec", value: src.precision, key: "precision" },
      { label: "Recall", value: src.recall, key: "recall" },
      { label: "Kappa", value: src.cohen_kappa, key: "cohen_kappa" },
    ].filter(m => m.value != null);
  }

  // Regression
  if (hasFinal) {
    return [
      { label: "RMSEP", value: fs.rmse, key: "rmse", highlight: true },
      { label: "R²", value: fs.r2, key: "r2", highlight: true },
      { label: "RMSECV", value: valScores.rmse, key: "rmse" },
      { label: "RPD", value: fs.rpd, key: "rpd" },
      { label: "nRMSE", value: fs.nrmse, key: "nrmse" },
      { label: "Bias", value: fs.bias, key: "bias" },
      { label: "SEP", value: fs.sep, key: "sep" },
      { label: "MAE", value: fs.mae, key: "mae" },
    ].filter(m => m.value != null);
  }

  // CV only
  return [
    { label: "RMSECV", value: valScores.rmse, key: "rmse", highlight: true },
    { label: "R² (CV)", value: valScores.r2, key: "r2", highlight: true },
    { label: "RMSE (Test)", value: testScores.rmse, key: "rmse" },
    { label: "R² (Test)", value: testScores.r2, key: "r2" },
    { label: "RPD", value: (valScores.rpd ?? testScores.rpd), key: "rpd" },
    { label: "nRMSE", value: (valScores.nrmse ?? testScores.nrmse), key: "nrmse" },
    { label: "Bias", value: (valScores.bias ?? testScores.bias), key: "bias" },
    { label: "MAE", value: (valScores.mae ?? testScores.mae), key: "mae" },
  ].filter(m => m.value != null);
}
