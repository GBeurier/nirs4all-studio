/**
 * Metric catalog, task-type selection helpers, and metric presets.
 *
 * This module owns the static metric definitions and the rules for exposing
 * them by task type. Runtime score-map parsing and display extraction stay in
 * `scores.ts`.
 */

import { canonicalMetricKey } from "./metricKeys.js";

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

// ============================================================================
// Full metric catalog - matches nirs4all/core/metrics.py
// ============================================================================

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
  {
    key: "explained_variance",
    label: "Expl. Variance",
    abbreviation: "ExpVar",
    direction: "higher",
    group: "regression",
  },
  { key: "max_error", label: "Max Error", abbreviation: "MaxErr", direction: "lower", group: "regression" },
  { key: "median_ae", label: "Median AE", abbreviation: "MedAE", direction: "lower", group: "regression" },
];

export const ALL_CLASSIFICATION_METRICS: MetricDefinition[] = [
  { key: "accuracy", label: "Accuracy", abbreviation: "Acc", direction: "higher", group: "multiclass" },
  {
    key: "balanced_accuracy",
    label: "Balanced Accuracy",
    abbreviation: "BalAcc",
    direction: "higher",
    group: "multiclass",
  },
  { key: "precision", label: "Precision", abbreviation: "Prec", direction: "higher", group: "multiclass" },
  {
    key: "balanced_precision",
    label: "Balanced Precision",
    abbreviation: "BalPrec",
    direction: "higher",
    group: "multiclass",
  },
  { key: "recall", label: "Recall", abbreviation: "Rec", direction: "higher", group: "multiclass" },
  {
    key: "balanced_recall",
    label: "Balanced Recall",
    abbreviation: "BalRec",
    direction: "higher",
    group: "multiclass",
  },
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

export function getMetricsForTaskType(taskType: string | null): readonly string[] {
  if (isClassificationTaskType(taskType)) return CLASSIFICATION_METRICS;
  return REGRESSION_METRICS;
}

export function getMetricDefinition(key: string | null | undefined): MetricDefinition | undefined {
  const canonical = canonicalMetricKey(key);
  return canonical ? METRIC_DEFINITIONS_BY_KEY.get(canonical) : undefined;
}

export function isKnownMetricKey(key: string | null | undefined): boolean {
  return getMetricDefinition(key) != null;
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
