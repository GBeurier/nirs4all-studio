/**
 * Shared score formatting and metric utilities used across pages (Datasets, Runs, Results).
 *
 * Centralizes formatting logic that was previously duplicated in TopScoreItem,
 * RunDetailSheet, DatasetSubItem, and other components.
 */

/** Metrics where lower values are better (error-based). */
const LOWER_IS_BETTER = new Set([
  "rmse", "rmsecv", "rmsep", "mse", "mae", "mape", "bias", "sep", "nrmse",
  "nmse", "nmae", "max_error", "median_ae", "hamming_loss", "log_loss",
]);

/** Regression display metrics (compact). */
export const REGRESSION_METRICS = ["r2", "rmse", "rpd"] as const;

/** Classification display metrics (compact). */
export const CLASSIFICATION_METRICS = [
  "accuracy",
  "balanced_accuracy",
  "precision",
  "recall",
] as const;

/** Requested default metric set for dataset-item summaries on runs/results pages. */
export const DEFAULT_DATASET_ITEM_REGRESSION_METRICS = [
  "rmse",
  "r2",
  "nrmse",
  "sep",
  "rpd",
  "pearson_r",
] as const;

export const LEGACY_DATASET_ITEM_REGRESSION_METRICS = [
  "rmse",
  "r2",
  "sep",
  "rpd",
  "bias",
  "mae",
] as const;

export const DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS = [
  "accuracy",
  "balanced_accuracy",
  "precision",
  "recall",
] as const;

export const LEGACY_DATASET_ITEM_CLASSIFICATION_METRICS = [
  "accuracy",
  "balanced_accuracy",
  "f1",
  "roc_auc",
] as const;

export function getMetricsForTaskType(taskType: string | null): readonly string[] {
  if (isClassificationTaskType(taskType)) return CLASSIFICATION_METRICS;
  return REGRESSION_METRICS;
}

// ============================================================================
// Full metric catalog — matches nirs4all/core/metrics.py
// ============================================================================

export interface MetricDefinition {
  key: string;
  label: string;
  abbreviation: string;
  direction: "higher" | "lower" | "zero";
  group: "general" | "regression" | "multiclass" | "binary";
}

export type MetricGroup = MetricDefinition["group"];

const CLASSIFICATION_TASK_TYPES = new Set([
  "classification",
  "binary_classification",
  "multiclass_classification",
]);

const METRIC_KEY_ALIASES: Record<string, string> = {
  mean_squared_error: "mse",
  root_mean_squared_error: "rmse",
  mean_absolute_error: "mae",
  mean_absolute_percentage_error: "mape",
  r2_score: "r2",
  explained_variance_score: "explained_variance",
  median_absolute_error: "median_ae",
  f1_score: "f1",
  auc: "roc_auc",
  mcc: "matthews_corrcoef",
  kappa: "cohen_kappa",
  jaccard_score: "jaccard",
  rmsep: "rmse",
  rmsecv: "rmse",
};

const METRIC_ALIAS_KEYS_BY_CANONICAL = new Map<string, string[]>();
for (const [aliasKey, canonicalKey] of Object.entries(METRIC_KEY_ALIASES)) {
  const aliases = METRIC_ALIAS_KEYS_BY_CANONICAL.get(canonicalKey) ?? [];
  aliases.push(aliasKey);
  METRIC_ALIAS_KEYS_BY_CANONICAL.set(canonicalKey, aliases);
}

function normalizeMetricLookupKey(key: string | null | undefined): string {
  return (key ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function canonicalMetricKey(key: string | null | undefined): string {
  const normalized = normalizeMetricLookupKey(key);
  if (!normalized) return "";
  return METRIC_KEY_ALIASES[normalized] ?? normalized;
}

export function metricKeyCandidates(key: string | null | undefined): string[] {
  const normalized = normalizeMetricLookupKey(key);
  const canonical = canonicalMetricKey(key);
  if (!canonical) return [];

  const candidates = new Set<string>([canonical]);
  if (normalized) candidates.add(normalized);
  for (const aliasKey of METRIC_ALIAS_KEYS_BY_CANONICAL.get(canonical) ?? []) {
    candidates.add(aliasKey);
  }
  return [...candidates];
}

export const ALL_GENERAL_METRICS: MetricDefinition[] = [];

export const ALL_REGRESSION_METRICS: MetricDefinition[] = [
  { key: "r2", label: "R²", abbreviation: "R²", direction: "higher", group: "regression" },
  { key: "rmse", label: "RMSE", abbreviation: "RMSE", direction: "lower", group: "regression" },
  { key: "mse", label: "MSE", abbreviation: "MSE", direction: "lower", group: "regression" },
  { key: "mae", label: "MAE", abbreviation: "MAE", direction: "lower", group: "regression" },
  { key: "mape", label: "MAPE", abbreviation: "MAPE", direction: "lower", group: "regression" },
  { key: "sep", label: "SEP", abbreviation: "SEP", direction: "lower", group: "regression" },
  { key: "rpd", label: "RPD", abbreviation: "RPD", direction: "higher", group: "regression" },
  { key: "bias", label: "Bias", abbreviation: "Bias", direction: "zero", group: "regression" },
  { key: "consistency", label: "Consistency", abbreviation: "Cons", direction: "higher", group: "regression" },
  { key: "nrmse", label: "NRMSE", abbreviation: "NRMSE", direction: "lower", group: "regression" },
  { key: "nmse", label: "NMSE", abbreviation: "NMSE", direction: "lower", group: "regression" },
  { key: "nmae", label: "NMAE", abbreviation: "NMAE", direction: "lower", group: "regression" },
  { key: "pearson_r", label: "Pearson", abbreviation: "Pearson", direction: "higher", group: "regression" },
  { key: "spearman_r", label: "Spearman", abbreviation: "Spearman", direction: "higher", group: "regression" },
  { key: "explained_variance", label: "Expl. Variance", abbreviation: "ExpVar", direction: "higher", group: "regression" },
  { key: "max_error", label: "Max Error", abbreviation: "MaxErr", direction: "lower", group: "regression" },
  { key: "median_ae", label: "Median AE", abbreviation: "MedAE", direction: "lower", group: "regression" },
];

export const ALL_CLASSIFICATION_METRICS: MetricDefinition[] = [
  { key: "accuracy", label: "Accuracy", abbreviation: "Acc", direction: "higher", group: "multiclass" },
  { key: "balanced_accuracy", label: "Balanced Accuracy", abbreviation: "BalAcc", direction: "higher", group: "multiclass" },
  { key: "precision", label: "Precision", abbreviation: "Prec", direction: "higher", group: "multiclass" },
  { key: "balanced_precision", label: "Balanced Precision", abbreviation: "BalPrec", direction: "higher", group: "multiclass" },
  { key: "recall", label: "Recall", abbreviation: "Rec", direction: "higher", group: "multiclass" },
  { key: "balanced_recall", label: "Balanced Recall", abbreviation: "BalRec", direction: "higher", group: "multiclass" },
  { key: "f1", label: "F1", abbreviation: "F1", direction: "higher", group: "multiclass" },
  { key: "specificity", label: "Specificity", abbreviation: "Spec", direction: "higher", group: "multiclass" },
  { key: "roc_auc", label: "ROC AUC", abbreviation: "AUC", direction: "higher", group: "binary" },
  { key: "matthews_corrcoef", label: "MCC", abbreviation: "MCC", direction: "higher", group: "binary" },
  { key: "cohen_kappa", label: "Cohen Kappa", abbreviation: "Kappa", direction: "higher", group: "binary" },
  { key: "jaccard", label: "Jaccard", abbreviation: "Jaccard", direction: "higher", group: "binary" },
];

export const ALL_SCORE_METRICS: MetricDefinition[] = [
  ...ALL_GENERAL_METRICS,
  ...ALL_REGRESSION_METRICS,
  ...ALL_CLASSIFICATION_METRICS,
];

const METRIC_DEFINITIONS_BY_KEY = new Map(
  ALL_SCORE_METRICS.map(metric => [metric.key, metric] as const),
);

export function isClassificationTaskType(taskType: string | null | undefined): boolean {
  return CLASSIFICATION_TASK_TYPES.has((taskType || "").toLowerCase());
}

function hasRegressionTaskType(taskType: string | null | undefined): boolean {
  return !!taskType && !isClassificationTaskType(taskType);
}

export function orderMetricKeys(metricKeys: readonly string[]): string[] {
  const requested = new Set(
    metricKeys
      .map(key => canonicalMetricKey(key))
      .filter(key => key && METRIC_DEFINITIONS_BY_KEY.has(key)),
  );
  return ALL_SCORE_METRICS
    .map(metric => metric.key)
    .filter(key => requested.has(key));
}

export function getMetricDefinitions(metricKeys: readonly string[]): MetricDefinition[] {
  return orderMetricKeys(metricKeys)
    .map(key => METRIC_DEFINITIONS_BY_KEY.get(key))
    .filter((metric): metric is MetricDefinition => !!metric);
}

export function groupMetricDefinitions(metricKeys: readonly string[]): Array<{
  group: MetricGroup;
  label: string;
  metrics: MetricDefinition[];
}> {
  const labels: Record<MetricGroup, string> = {
    general: "General",
    regression: "Regression",
    multiclass: "Multiclass",
    binary: "Binary",
  };

  const definitions = getMetricDefinitions(metricKeys);

  return (["regression", "multiclass", "binary", "general"] as const)
    .map(group => ({
      group,
      label: labels[group],
      metrics: definitions.filter(metric => metric.group === group),
    }))
    .filter(section => section.metrics.length > 0);
}

function combineMetricSelections(...metricLists: Array<readonly string[] | null | undefined>): string[] {
  return orderMetricKeys(metricLists.flatMap(metrics => metrics ?? []));
}

export function getDefaultSelectedMetricsForTaskTypes(
  taskTypes: Iterable<string | null | undefined>,
): string[] {
  let hasClassification = false;
  let hasRegression = false;

  for (const taskType of taskTypes) {
    if (isClassificationTaskType(taskType)) hasClassification = true;
    else if (hasRegressionTaskType(taskType)) hasRegression = true;
  }

  if (hasClassification && hasRegression) {
    return combineMetricSelections(
      DEFAULT_DATASET_ITEM_REGRESSION_METRICS,
      DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS,
    );
  }
  if (hasClassification) return [...DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS];
  return [...DEFAULT_DATASET_ITEM_REGRESSION_METRICS];
}

export function getLegacySelectedMetricsForTaskTypes(
  taskTypes: Iterable<string | null | undefined>,
): string[] {
  let hasClassification = false;
  let hasRegression = false;

  for (const taskType of taskTypes) {
    if (isClassificationTaskType(taskType)) hasClassification = true;
    else if (hasRegressionTaskType(taskType)) hasRegression = true;
  }

  if (hasClassification && hasRegression) {
    return combineMetricSelections(
      LEGACY_DATASET_ITEM_REGRESSION_METRICS,
      LEGACY_DATASET_ITEM_CLASSIFICATION_METRICS,
    );
  }
  if (hasClassification) return [...LEGACY_DATASET_ITEM_CLASSIFICATION_METRICS];
  return [...LEGACY_DATASET_ITEM_REGRESSION_METRICS];
}

export function getDefaultSelectionUpgradeCandidatesForTaskTypes(
  taskTypes: Iterable<string | null | undefined>,
): string[][] {
  let hasClassification = false;
  let hasRegression = false;

  for (const taskType of taskTypes) {
    if (isClassificationTaskType(taskType)) hasClassification = true;
    else if (hasRegressionTaskType(taskType)) hasRegression = true;
  }

  if (!(hasClassification && hasRegression)) {
    return [];
  }

  return [
    [...DEFAULT_DATASET_ITEM_REGRESSION_METRICS],
    [...LEGACY_DATASET_ITEM_REGRESSION_METRICS],
    [...DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS],
    [...LEGACY_DATASET_ITEM_CLASSIFICATION_METRICS],
  ].map(orderMetricKeys);
}

export function getAvailableMetricKeysForTaskTypes(
  taskTypes: Iterable<string | null | undefined>,
): string[] {
  let hasClassification = false;
  let hasRegression = false;

  for (const taskType of taskTypes) {
    if (isClassificationTaskType(taskType)) hasClassification = true;
    else if (hasRegressionTaskType(taskType)) hasRegression = true;
  }

  if (hasClassification && hasRegression) {
    return orderMetricKeys([
      ...ALL_GENERAL_METRICS.map(metric => metric.key),
      ...ALL_REGRESSION_METRICS.map(metric => metric.key),
      ...ALL_CLASSIFICATION_METRICS.map(metric => metric.key),
    ]);
  }
  if (hasClassification) {
    return orderMetricKeys([
      ...ALL_GENERAL_METRICS.map(metric => metric.key),
      ...ALL_CLASSIFICATION_METRICS.map(metric => metric.key),
    ]);
  }
  return orderMetricKeys([
    ...ALL_GENERAL_METRICS.map(metric => metric.key),
    ...ALL_REGRESSION_METRICS.map(metric => metric.key),
  ]);
}

export function filterMetricsForTaskType(
  metricKeys: readonly string[],
  taskType: string | null | undefined,
): string[] {
  const allowedKeys = new Set(
    [
      ...ALL_GENERAL_METRICS,
      ...(isClassificationTaskType(taskType) ? ALL_CLASSIFICATION_METRICS : ALL_REGRESSION_METRICS),
    ].map(metric => metric.key),
  );

  return orderMetricKeys(metricKeys).filter(key => allowedKeys.has(key));
}

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
      if (Number.isFinite(num) && METRIC_DEFINITIONS_BY_KEY.has(canonical)) {
        keys.add(canonical);
      }
    }
  };

  for (const map of maps) visit(map);

  return orderMetricKeys([...keys]);
}

/** Get all available metrics for a task type. */
export function getAvailableMetrics(taskType: string | null): MetricDefinition[] {
  if (isClassificationTaskType(taskType)) {
    return ALL_CLASSIFICATION_METRICS;
  }
  return ALL_REGRESSION_METRICS;
}

/** Metric preset definitions. */
export interface MetricPreset {
  id: string;
  label: string;
  keys: string[];
}

export const REGRESSION_PRESETS: MetricPreset[] = [
  { id: "essential", label: "Essential", keys: ["r2", "rmse", "mae"] },
  { id: "nirs", label: "NIRS", keys: ["r2", "rmse", "sep", "rpd", "bias", "consistency", "nrmse"] },
  { id: "ml", label: "ML", keys: ["r2", "rmse", "mse", "mae", "mape", "pearson_r"] },
  { id: "full", label: "Full", keys: ALL_REGRESSION_METRICS.map(m => m.key) },
];

export const CLASSIFICATION_PRESETS: MetricPreset[] = [
  { id: "essential", label: "Essential", keys: ["accuracy", "balanced_accuracy", "f1"] },
  { id: "full", label: "Full", keys: ALL_CLASSIFICATION_METRICS.map(m => m.key) },
];

export function getPresetsForTaskType(taskType: string | null): MetricPreset[] {
  if (isClassificationTaskType(taskType)) {
    return CLASSIFICATION_PRESETS;
  }
  return REGRESSION_PRESETS;
}

export function getPresetsForTaskTypes(
  taskTypes: Iterable<string | null | undefined>,
): MetricPreset[] {
  let hasClassification = false;
  let hasRegression = false;

  for (const taskType of taskTypes) {
    if (isClassificationTaskType(taskType)) hasClassification = true;
    else if (hasRegressionTaskType(taskType)) hasRegression = true;
  }

  if (!(hasClassification && hasRegression)) {
    return getPresetsForTaskType(hasClassification ? "classification" : "regression");
  }

  const classificationEssential = CLASSIFICATION_PRESETS.find(preset => preset.id === "essential")?.keys ?? [];
  const classificationFull = CLASSIFICATION_PRESETS.find(preset => preset.id === "full")?.keys ?? [];

  return [
    {
      id: "essential",
      label: "Essential",
      keys: combineMetricSelections(
        REGRESSION_PRESETS.find(preset => preset.id === "essential")?.keys,
        classificationEssential,
      ),
    },
    {
      id: "nirs",
      label: "NIRS",
      keys: combineMetricSelections(
        REGRESSION_PRESETS.find(preset => preset.id === "nirs")?.keys,
        classificationEssential,
      ),
    },
    {
      id: "ml",
      label: "ML",
      keys: combineMetricSelections(
        REGRESSION_PRESETS.find(preset => preset.id === "ml")?.keys,
        classificationEssential,
      ),
    },
    {
      id: "full",
      label: "Full",
      keys: combineMetricSelections(
        REGRESSION_PRESETS.find(preset => preset.id === "full")?.keys,
        classificationFull,
      ),
    },
  ];
}

/** Get the default selected metrics for a task type. */
export function getDefaultSelectedMetrics(taskType: string | null): string[] {
  if (isClassificationTaskType(taskType)) {
    return [...DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS];
  }
  if (taskType == null) {
    return combineMetricSelections(
      DEFAULT_DATASET_ITEM_REGRESSION_METRICS,
      DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS,
    );
  }
  return [...DEFAULT_DATASET_ITEM_REGRESSION_METRICS];
}

/** Get the abbreviation for a metric key. */
export function getMetricAbbreviation(key: string): string {
  const canonical = canonicalMetricKey(key);
  return METRIC_DEFINITIONS_BY_KEY.get(canonical)?.abbreviation ?? normalizeMetricLookupKey(key).toUpperCase();
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

function parseScoreNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

export function isLowerBetter(metric: string | null | undefined): boolean {
  return LOWER_IS_BETTER.has(canonicalMetricKey(metric));
}

/**
 * Compare two scores, respecting the metric direction.
 * Returns true if `a` is better than `b`.
 */
export function isBetterScore(a: number, b: number, metric: string | null | undefined): boolean {
  return isLowerBetter(metric) ? a < b : a > b;
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
    if (!best || !isFiniteScore(best.final_test_score) || isBetterScore(entry.final_test_score, best.final_test_score, metric)) {
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

/**
 * Format a score value to 4 decimal places (or 3 for error metrics).
 */
export function formatScore(value: number | string | undefined | null): string {
  if (value == null) return "-";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(4);
}

/**
 * Format a metric-specific value (3 decimals for error metrics, 4 for others).
 */
export function formatMetricValue(value: number | string | undefined | null, metric?: string): string {
  if (value == null) return "-";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return "-";
  if (metric && isLowerBetter(metric)) return num.toFixed(3);
  return num.toFixed(4);
}

/**
 * Format a metric name for display (uppercase).
 */
export function formatMetricName(metric: string | null | undefined): string {
  if (!metric) return "";
  return (canonicalMetricKey(metric) || normalizeMetricLookupKey(metric)).toUpperCase();
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
      return [{ label: "CV Val", value: chain.avg_val_score, key: canonicalMetricKey(chain.metric) || chain.metric || "score" }];
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
    return [{ label: "CV Val", value: chain.avg_val_score, key: canonicalMetricKey(chain.metric) || chain.metric || "score" }];
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
      { label: "BalAcc", value: (_val("balanced_accuracy") ?? _test("balanced_accuracy")), key: "balanced_accuracy" },
      { label: "Prec", value: (_val("precision") ?? _test("precision")), key: "precision" },
      { label: "Recall", value: (_val("recall") ?? _test("recall")), key: "recall" },
    ].filter(m => m.value != null);
    if (metrics.length > 0) return metrics;
    // Fallback to scalar scores
    const entries: MetricEntry[] = [];
    const metricKey = canonicalMetricKey(chain.metric) || chain.metric || "score";
    if (chain.avg_val_score != null) entries.push({ label: "CV Val", value: chain.avg_val_score, key: metricKey, highlight: true });
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
  if (chain.avg_val_score != null) entries.push({ label: "CV Val", value: chain.avg_val_score, key: metricKey, highlight: true });
  if (chain.avg_test_score != null) entries.push({ label: "CV Test", value: chain.avg_test_score, key: metricKey });
  return entries;
}
