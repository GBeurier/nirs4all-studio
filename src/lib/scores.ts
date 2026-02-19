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

type ChainScores = {
  final_test_score?: number | null;
  final_train_score?: number | null;
  final_scores?: Record<string, number>;
  avg_val_score?: number | null;
  avg_test_score?: number | null;
  avg_train_score?: number | null;
  scores?: { val?: Record<string, number>; test?: Record<string, number> };
  metric?: string | null;
};

/**
 * Extract final (refit) model metrics for the primary display row.
 * Uses NIRS naming: RMSEP for final test RMSE.
 *
 * Falls back to ``final_test_score`` when the detailed ``final_scores``
 * dict is empty (e.g. chain summary not yet backfilled).
 */
export function extractFinalMetrics(chain: ChainScores, taskType: string | null): MetricEntry[] {
  const fs = chain.final_scores || {};

  if (taskType === "classification") {
    const metrics = [
      { label: "Accuracy", value: fs.accuracy, key: "accuracy", highlight: true },
      { label: "F1", value: fs.f1, key: "f1", highlight: true },
      { label: "AUC", value: fs.roc_auc, key: "roc_auc" },
      { label: "BalAcc", value: fs.balanced_accuracy, key: "balanced_accuracy" },
      { label: "Prec", value: fs.precision, key: "precision" },
      { label: "Recall", value: fs.recall, key: "recall" },
      { label: "Kappa", value: fs.cohen_kappa, key: "cohen_kappa" },
    ].filter(m => m.value != null);
    if (metrics.length > 0) return metrics;
    // Fallback: use final_test_score with best-guess label
    if (chain.final_test_score != null) {
      const label = _finalFallbackLabel(chain.metric, taskType);
      return [{ label, value: chain.final_test_score, key: chain.metric || "score", highlight: true }];
    }
    return [];
  }

  const metrics = [
    { label: "RMSEP", value: fs.rmse, key: "rmse", highlight: true },
    { label: "R²", value: fs.r2, key: "r2", highlight: true },
    { label: "RPD", value: fs.rpd, key: "rpd" },
    { label: "nRMSE", value: fs.nrmse, key: "nrmse" },
    { label: "Bias", value: fs.bias, key: "bias" },
    { label: "SEP", value: fs.sep, key: "sep" },
    { label: "MAE", value: fs.mae, key: "mae" },
  ].filter(m => m.value != null);
  if (metrics.length > 0) return metrics;
  // Fallback: use final_test_score with best-guess label
  if (chain.final_test_score != null) {
    const label = _finalFallbackLabel(chain.metric, taskType);
    return [{ label, value: chain.final_test_score, key: chain.metric || "score", highlight: true }];
  }
  return [];
}

/** Determine a display label for the fallback when final_scores is empty. */
function _finalFallbackLabel(metric: string | null | undefined, taskType: string | null): string {
  if (!metric) return taskType === "classification" ? "Score" : "Final";
  const m = metric.toLowerCase();
  if (m === "rmse") return "RMSEP";
  if (m === "r2") return "R²";
  return metric.toUpperCase();
}

/**
 * Extract CV (cross-validation) metrics for the secondary row below a refit model.
 * Uses NIRS naming: RMSECV for CV validation RMSE.
 */
export function extractCVMetrics(chain: ChainScores, taskType: string | null): MetricEntry[] {
  const val = chain.scores?.val || {};

  if (taskType === "classification") {
    const metrics = [
      { label: "Acc (CV)", value: val.accuracy, key: "accuracy" },
      { label: "F1 (CV)", value: val.f1, key: "f1" },
      { label: "AUC (CV)", value: val.roc_auc, key: "roc_auc" },
      { label: "BalAcc (CV)", value: val.balanced_accuracy, key: "balanced_accuracy" },
    ].filter(m => m.value != null);
    if (metrics.length > 0) return metrics;
    if (chain.avg_val_score != null) {
      return [{ label: "CV Val", value: chain.avg_val_score, key: chain.metric || "score" }];
    }
    return [];
  }

  const metrics = [
    { label: "RMSECV", value: val.rmse, key: "rmse" },
    { label: "R² (CV)", value: val.r2, key: "r2" },
    { label: "RPD (CV)", value: val.rpd, key: "rpd" },
    { label: "nRMSE (CV)", value: val.nrmse, key: "nrmse" },
    { label: "Bias (CV)", value: val.bias, key: "bias" },
    { label: "MAE (CV)", value: val.mae, key: "mae" },
  ].filter(m => m.value != null);
  if (metrics.length > 0) return metrics;
  if (chain.avg_val_score != null) {
    return [{ label: "CV Val", value: chain.avg_val_score, key: chain.metric || "score" }];
  }
  return [];
}

/**
 * Extract combined metrics for a CV-only model (no refit).
 * Shows CV val and test scores side by side.
 */
export function extractCVOnlyMetrics(chain: ChainScores, taskType: string | null): MetricEntry[] {
  const valScores = chain.scores?.val || {};
  const testScores = chain.scores?.test || {};

  if (taskType === "classification") {
    const metrics = [
      { label: "Acc (CV)", value: valScores.accuracy, key: "accuracy", highlight: true },
      { label: "Acc (Test)", value: testScores.accuracy, key: "accuracy" },
      { label: "F1", value: (valScores.f1 ?? testScores.f1), key: "f1" },
      { label: "AUC", value: (valScores.roc_auc ?? testScores.roc_auc), key: "roc_auc" },
      { label: "BalAcc", value: (valScores.balanced_accuracy ?? testScores.balanced_accuracy), key: "balanced_accuracy" },
      { label: "Prec", value: (valScores.precision ?? testScores.precision), key: "precision" },
      { label: "Recall", value: (valScores.recall ?? testScores.recall), key: "recall" },
    ].filter(m => m.value != null);
    if (metrics.length > 0) return metrics;
    // Fallback to scalar scores
    const entries: MetricEntry[] = [];
    if (chain.avg_val_score != null) entries.push({ label: "CV Val", value: chain.avg_val_score, key: chain.metric || "score", highlight: true });
    if (chain.avg_test_score != null) entries.push({ label: "CV Test", value: chain.avg_test_score, key: chain.metric || "score" });
    return entries;
  }

  const metrics = [
    { label: "RMSECV", value: valScores.rmse, key: "rmse", highlight: true },
    { label: "R² (CV)", value: valScores.r2, key: "r2", highlight: true },
    { label: "RMSE (Test)", value: testScores.rmse, key: "rmse" },
    { label: "R² (Test)", value: testScores.r2, key: "r2" },
    { label: "RPD", value: (valScores.rpd ?? testScores.rpd), key: "rpd" },
    { label: "nRMSE", value: (valScores.nrmse ?? testScores.nrmse), key: "nrmse" },
    { label: "Bias", value: (valScores.bias ?? testScores.bias), key: "bias" },
    { label: "MAE", value: (valScores.mae ?? testScores.mae), key: "mae" },
  ].filter(m => m.value != null);
  if (metrics.length > 0) return metrics;
  // Fallback to scalar scores
  const entries: MetricEntry[] = [];
  if (chain.avg_val_score != null) entries.push({ label: "CV Val", value: chain.avg_val_score, key: chain.metric || "score", highlight: true });
  if (chain.avg_test_score != null) entries.push({ label: "CV Test", value: chain.avg_test_score, key: chain.metric || "score" });
  return entries;
}
