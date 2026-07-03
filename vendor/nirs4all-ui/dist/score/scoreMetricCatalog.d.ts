/**
 * Metric catalog, task-type selection helpers, and metric presets.
 *
 * This module owns the static metric definitions and the rules for exposing
 * them by task type. Runtime score-map parsing and display extraction stay in
 * `scores.ts`.
 */
/** Regression display metrics (compact). */
export declare const REGRESSION_METRICS: readonly ["r2", "rmse", "rpd"];
/** Classification display metrics (compact). */
export declare const CLASSIFICATION_METRICS: readonly ["accuracy", "balanced_accuracy", "precision", "recall"];
/** Requested default metric set for dataset-item summaries on runs/results pages. */
export declare const DEFAULT_DATASET_ITEM_REGRESSION_METRICS: readonly ["rmse", "r2", "nrmse", "sep", "rpd", "pearson_r"];
export declare const LEGACY_DATASET_ITEM_REGRESSION_METRICS: readonly ["rmse", "r2", "sep", "rpd", "bias", "mae"];
export declare const DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS: readonly ["accuracy", "balanced_accuracy", "precision", "recall"];
export declare const LEGACY_DATASET_ITEM_CLASSIFICATION_METRICS: readonly ["accuracy", "balanced_accuracy", "f1", "roc_auc"];
export interface MetricDefinition {
    key: string;
    label: string;
    abbreviation: string;
    direction: "higher" | "lower" | "zero";
    group: "general" | "regression" | "multiclass" | "binary";
}
export type MetricGroup = MetricDefinition["group"];
export declare const ALL_GENERAL_METRICS: MetricDefinition[];
export declare const ALL_REGRESSION_METRICS: MetricDefinition[];
export declare const ALL_CLASSIFICATION_METRICS: MetricDefinition[];
export declare const ALL_SCORE_METRICS: MetricDefinition[];
export declare function isClassificationTaskType(taskType: string | null | undefined): boolean;
export declare function getMetricsForTaskType(taskType: string | null): readonly string[];
export declare function getMetricDefinition(key: string | null | undefined): MetricDefinition | undefined;
export declare function isKnownMetricKey(key: string | null | undefined): boolean;
export declare function orderMetricKeys(metricKeys: readonly string[]): string[];
export declare function getMetricDefinitions(metricKeys: readonly string[]): MetricDefinition[];
export declare function groupMetricDefinitions(metricKeys: readonly string[]): Array<{
    group: MetricGroup;
    label: string;
    metrics: MetricDefinition[];
}>;
export declare function getDefaultSelectedMetricsForTaskTypes(taskTypes: Iterable<string | null | undefined>): string[];
export declare function getLegacySelectedMetricsForTaskTypes(taskTypes: Iterable<string | null | undefined>): string[];
export declare function getDefaultSelectionUpgradeCandidatesForTaskTypes(taskTypes: Iterable<string | null | undefined>): string[][];
export declare function getAvailableMetricKeysForTaskTypes(taskTypes: Iterable<string | null | undefined>): string[];
export declare function filterMetricsForTaskType(metricKeys: readonly string[], taskType: string | null | undefined): string[];
/** Get all available metrics for a task type. */
export declare function getAvailableMetrics(taskType: string | null): MetricDefinition[];
/** Metric preset definitions. */
export interface MetricPreset {
    id: string;
    label: string;
    keys: string[];
}
export declare const REGRESSION_PRESETS: MetricPreset[];
export declare const CLASSIFICATION_PRESETS: MetricPreset[];
export declare function getPresetsForTaskType(taskType: string | null): MetricPreset[];
export declare function getPresetsForTaskTypes(taskTypes: Iterable<string | null | undefined>): MetricPreset[];
/** Get the default selected metrics for a task type. */
export declare function getDefaultSelectedMetrics(taskType: string | null): string[];
//# sourceMappingURL=scoreMetricCatalog.d.ts.map