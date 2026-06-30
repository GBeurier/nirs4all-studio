/**
 * Shared score formatting and metric utilities used across pages (Datasets, Runs, Results).
 *
 * Centralizes formatting logic that was previously duplicated in TopScoreItem,
 * RunDetailSheet, DatasetSubItem, and other components.
 */

import {
  canonicalMetricKey,
  metricKeyCandidates,
  normalizeMetricLookupKey,
} from "./metricKeys";
import {
  getMetricDefinition,
  isClassificationTaskType,
  isKnownMetricKey,
  orderMetricKeys,
} from "./scoreMetricCatalog";
import { isBetterScore, parseScoreNumber } from "./scoreValues";

export { canonicalMetricKey, metricKeyCandidates } from "./metricKeys";
export {
  ALL_CLASSIFICATION_METRICS,
  ALL_GENERAL_METRICS,
  ALL_REGRESSION_METRICS,
  ALL_SCORE_METRICS,
  CLASSIFICATION_METRICS,
  CLASSIFICATION_PRESETS,
  DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS,
  DEFAULT_DATASET_ITEM_REGRESSION_METRICS,
  filterMetricsForTaskType,
  getAvailableMetricKeysForTaskTypes,
  getAvailableMetrics,
  getDefaultSelectedMetrics,
  getDefaultSelectedMetricsForTaskTypes,
  getDefaultSelectionUpgradeCandidatesForTaskTypes,
  getLegacySelectedMetricsForTaskTypes,
  getMetricDefinitions,
  getMetricsForTaskType,
  getPresetsForTaskType,
  getPresetsForTaskTypes,
  groupMetricDefinitions,
  isClassificationTaskType,
  LEGACY_DATASET_ITEM_CLASSIFICATION_METRICS,
  LEGACY_DATASET_ITEM_REGRESSION_METRICS,
  orderMetricKeys,
  REGRESSION_METRICS,
  REGRESSION_PRESETS,
} from "./scoreMetricCatalog";
export type {
  MetricDefinition,
  MetricGroup,
  MetricPreset,
} from "./scoreMetricCatalog";
export {
  formatMetricName,
  formatMetricDisplayName,
  formatMetricValue,
  formatScore,
  isBetterScore,
  isLowerBetter,
} from "./scoreValues";

export function collectPresentMetricKeys(
  ...maps: Array<Record<string, unknown> | null | undefined>
): string[] {
  const keys = new Set<string>();

  const visit = (map: Record<string, unknown> | null | undefined) => {
    if (!map) return;

    for (const [key, value] of Object.entries(map)) {
      if (
        (key === "test" || key === "val" || key === "train")
        && value
        && typeof value === "object"
        && !Array.isArray(value)
      ) {
        visit(value as Record<string, unknown>);
        continue;
      }

      const num = typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number.parseFloat(value)
          : Number.NaN;

      const canonical = canonicalMetricKey(key);
      if (Number.isFinite(num) && isKnownMetricKey(canonical)) {
        keys.add(canonical);
      }
    }
  };

  for (const map of maps) visit(map);

  return orderMetricKeys([...keys]);
}

/** Get the abbreviation for a metric key. */
export function getMetricAbbreviation(key: string): string {
  const canonical = canonicalMetricKey(key);
  return getMetricDefinition(canonical)?.abbreviation ?? normalizeMetricLookupKey(key).toUpperCase();
}

/**
 * Get the primary display label for a dataset/model score in a given context.
 *
 * Refit rows use prediction-oriented naming:
 * - regression rmse -> RMSEP
 * - classification balanced_accuracy -> BAccP
 */
export function getPrimaryContextMetricLabel(
  metric: string | null | undefined,
  cardType: "refit" | "crossval",
  taskType?: string | null,
): string {
  const normalized = canonicalMetricKey(metric);

  if (!normalized) {
    return cardType === "refit" ? "Final" : "CV";
  }

  if (cardType === "refit") {
    if (normalized === "rmse") {
      return "RMSEP";
    }

    if (isClassificationTaskType(taskType)) {
      if (normalized === "balanced_accuracy") {
        return "BAccP";
      }
      return `${getMetricAbbreviation(normalized)}P`;
    }
  }

  if (cardType === "crossval" && normalized === "rmse") {
    return "RMSECV";
  }

  return getMetricAbbreviation(normalized);
}

function findMetricValueInMap(
  scores: Record<string, unknown> | null | undefined,
  key: string | null | undefined,
): number | null {
  if (!scores) return null;

  for (const candidate of metricKeyCandidates(key)) {
    const direct = parseScoreNumber(scores[candidate]);
    if (direct != null) return direct;
  }

  const canonical = canonicalMetricKey(key);
  if (!canonical) return null;

  for (const [mapKey, value] of Object.entries(scores)) {
    if (canonicalMetricKey(mapKey) !== canonical) continue;
    const parsed = parseScoreNumber(value);
    if (parsed != null) return parsed;
  }

  return null;
}

export function getScoreMapValue(
  scores: Record<string, unknown> | null | undefined,
  key: string | null | undefined,
): number | null {
  return findMetricValueInMap(scores, key);
}

/**
 * Extract a metric value from a scores dict that may be flat or nested.
 *
 * Backend stores `final_scores` as the raw prediction JSON which can be:
 *   - Nested: `{"test": {"rmse": 0.3}, "train": {"rmse": 0.1}}`
 *   - Flat:   `{"rmse": 0.3, "r2": 0.7}`
 *
 * This helper checks both shapes.
 */
export function extractScoreValue(
  scores: Record<string, unknown> | null | undefined,
  key: string,
  partition: "test" | "train" | "val" = "test",
): number | null {
  if (!scores) return null;
  const flat = findMetricValueInMap(scores, key);
  if (flat != null) return flat;
  // Try nested: {test: {rmse: 0.3}}
  const inner = scores[partition];
  if (inner && typeof inner === "object") {
    const nested = findMetricValueInMap(inner as Record<string, unknown>, key);
    if (nested != null) return nested;
  }
  return null;
}

type ScoreBearingEntry = {
  final_test_score?: number | null;
  avg_val_score?: number | null;
};

function isFiniteScore(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Pick the best refit/final-scored entry for a metric.
 */
export function getBestFinalEntry<T extends ScoreBearingEntry>(
  entries: readonly T[] | null | undefined,
  metric: string | null | undefined,
): T | null {
  let best: T | null = null;

  for (const entry of entries ?? []) {
    if (!isFiniteScore(entry.final_test_score)) continue;
    if (
      !best ||
      !isFiniteScore(best.final_test_score) ||
      isBetterScore(entry.final_test_score, best.final_test_score, metric)
    ) {
      best = entry;
    }
  }

  return best;
}

/**
 * Pick the best cross-validation entry for a metric.
 */
export function getBestCvEntry<T extends ScoreBearingEntry>(
  entries: readonly T[] | null | undefined,
  metric: string | null | undefined,
): T | null {
  let best: T | null = null;

  for (const entry of entries ?? []) {
    if (!isFiniteScore(entry.avg_val_score)) continue;
    if (!best || !isFiniteScore(best.avg_val_score) || isBetterScore(entry.avg_val_score, best.avg_val_score, metric)) {
      best = entry;
    }
  }

  return best;
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
  final_scores?: Record<string, unknown>;
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
  const _v = (key: string) => extractScoreValue(fs, key, "test");

  if (isClassificationTaskType(taskType)) {
    const metrics = [
      { label: "Accuracy", value: _v("accuracy"), key: "accuracy", highlight: true },
      { label: "F1", value: _v("f1"), key: "f1", highlight: true },
      { label: "AUC", value: _v("roc_auc"), key: "roc_auc" },
      { label: "BalAcc", value: _v("balanced_accuracy"), key: "balanced_accuracy" },
      { label: "Prec", value: _v("precision"), key: "precision" },
      { label: "Recall", value: _v("recall"), key: "recall" },
      { label: "Kappa", value: _v("cohen_kappa"), key: "cohen_kappa" },
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
    { label: "RMSEP", value: _v("rmse"), key: "rmse", highlight: true },
    { label: "R²", value: _v("r2"), key: "r2", highlight: true },
    { label: "RPD", value: _v("rpd"), key: "rpd" },
    { label: "nRMSE", value: _v("nrmse"), key: "nrmse" },
    { label: "Bias", value: _v("bias"), key: "bias" },
    { label: "SEP", value: _v("sep"), key: "sep" },
    { label: "MAE", value: _v("mae"), key: "mae" },
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
  const m = canonicalMetricKey(metric);
  if (!m) return isClassificationTaskType(taskType) ? "Score" : "Final";
  if (m === "rmse") return "RMSEP";
  if (m === "r2") return "R²";
  return getMetricAbbreviation(m);
}

/**
 * Extract CV (cross-validation) metrics for the secondary row below a refit model.
 * Uses NIRS naming: RMSECV for CV validation RMSE.
 */
export function extractCVMetrics(chain: ChainScores, taskType: string | null): MetricEntry[] {
  const _v = (key: string) => getScoreMapValue(chain.scores?.val, key);

  if (isClassificationTaskType(taskType)) {
    const metrics = [
      { label: "Acc (CV)", value: _v("accuracy"), key: "accuracy" },
      { label: "F1 (CV)", value: _v("f1"), key: "f1" },
      { label: "AUC (CV)", value: _v("roc_auc"), key: "roc_auc" },
      { label: "BalAcc (CV)", value: _v("balanced_accuracy"), key: "balanced_accuracy" },
    ].filter(m => m.value != null);
    if (metrics.length > 0) return metrics;
    if (chain.avg_val_score != null) {
      return [
        {
          label: "CV Val",
          value: chain.avg_val_score,
          key: canonicalMetricKey(chain.metric) || chain.metric || "score",
        },
      ];
    }
    return [];
  }

  const metrics = [
    { label: "RMSECV", value: _v("rmse"), key: "rmse" },
    { label: "R² (CV)", value: _v("r2"), key: "r2" },
    { label: "RPD (CV)", value: _v("rpd"), key: "rpd" },
    { label: "nRMSE (CV)", value: _v("nrmse"), key: "nrmse" },
    { label: "Bias (CV)", value: _v("bias"), key: "bias" },
    { label: "MAE (CV)", value: _v("mae"), key: "mae" },
  ].filter(m => m.value != null);
  if (metrics.length > 0) return metrics;
  if (chain.avg_val_score != null) {
    return [
      {
        label: "CV Val",
        value: chain.avg_val_score,
        key: canonicalMetricKey(chain.metric) || chain.metric || "score",
      },
    ];
  }
  return [];
}

/**
 * Extract combined metrics for a CV-only model (no refit).
 * Shows CV val and test scores side by side.
 */
export function extractCVOnlyMetrics(chain: ChainScores, taskType: string | null): MetricEntry[] {
  const _val = (key: string) => getScoreMapValue(chain.scores?.val, key);
  const _test = (key: string) => getScoreMapValue(chain.scores?.test, key);

  if (isClassificationTaskType(taskType)) {
    const metrics = [
      { label: "Acc (CV)", value: _val("accuracy"), key: "accuracy", highlight: true },
      { label: "Acc (Test)", value: _test("accuracy"), key: "accuracy" },
      { label: "F1", value: (_val("f1") ?? _test("f1")), key: "f1" },
      { label: "AUC", value: (_val("roc_auc") ?? _test("roc_auc")), key: "roc_auc" },
      {
        label: "BalAcc",
        value: (_val("balanced_accuracy") ?? _test("balanced_accuracy")),
        key: "balanced_accuracy",
      },
      { label: "Prec", value: (_val("precision") ?? _test("precision")), key: "precision" },
      { label: "Recall", value: (_val("recall") ?? _test("recall")), key: "recall" },
    ].filter(m => m.value != null);
    if (metrics.length > 0) return metrics;
    // Fallback to scalar scores
    const entries: MetricEntry[] = [];
    const metricKey = canonicalMetricKey(chain.metric) || chain.metric || "score";
    if (chain.avg_val_score != null) {
      entries.push({
        label: "CV Val",
        value: chain.avg_val_score,
        key: metricKey,
        highlight: true,
      });
    }
    if (chain.avg_test_score != null) entries.push({ label: "CV Test", value: chain.avg_test_score, key: metricKey });
    return entries;
  }

  const metrics = [
    { label: "RMSECV", value: _val("rmse"), key: "rmse", highlight: true },
    { label: "R² (CV)", value: _val("r2"), key: "r2", highlight: true },
    { label: "RMSE (Test)", value: _test("rmse"), key: "rmse" },
    { label: "R² (Test)", value: _test("r2"), key: "r2" },
    { label: "RPD", value: (_val("rpd") ?? _test("rpd")), key: "rpd" },
    { label: "nRMSE", value: (_val("nrmse") ?? _test("nrmse")), key: "nrmse" },
    { label: "Bias", value: (_val("bias") ?? _test("bias")), key: "bias" },
    { label: "MAE", value: (_val("mae") ?? _test("mae")), key: "mae" },
  ].filter(m => m.value != null);
  if (metrics.length > 0) return metrics;
  // Fallback to scalar scores
  const entries: MetricEntry[] = [];
  const metricKey = canonicalMetricKey(chain.metric) || chain.metric || "score";
  if (chain.avg_val_score != null) {
    entries.push({
      label: "CV Val",
      value: chain.avg_val_score,
      key: metricKey,
      highlight: true,
    });
  }
  if (chain.avg_test_score != null) {
    entries.push({
      label: "CV Test",
      value: chain.avg_test_score,
      key: metricKey,
    });
  }
  return entries;
}
