import i18n from "i18next";

import type { DatasetSchemaTaskType } from "./datasetSchema";

export interface DatasetPreviewSchemaAvailabilitySummaryInput {
  previewAvailable?: boolean;
  isMultiSource?: boolean;
  sourceCount?: number | null;
  targetCount?: number | null;
}

export function formatDatasetSchemaTaskTypeLabel(
  taskType: DatasetSchemaTaskType | undefined,
): string {
  if (taskType === "regression") return i18n.t("datasets.schema.taskType.regression");
  if (taskType === "classification") return i18n.t("datasets.schema.taskType.classification");
  if (taskType === "binary_classification") return i18n.t("datasets.schema.taskType.binaryClassification");
  if (taskType === "multiclass_classification") return i18n.t("datasets.schema.taskType.multiclassClassification");
  if (taskType === "auto") return i18n.t("datasets.schema.taskType.auto");
  return i18n.t("datasets.schema.taskType.unknown");
}

export function formatDatasetSourceModeLabel(
  isMultiSource: boolean | undefined,
): string {
  if (typeof isMultiSource !== "boolean") return i18n.t("datasets.schema.sourceMode.unknown");
  return isMultiSource ? i18n.t("datasets.schema.sourceMode.multi") : i18n.t("datasets.schema.sourceMode.single");
}

export function formatDatasetPreviewAvailabilityLabel(
  available: boolean | undefined,
): string {
  if (typeof available !== "boolean") return i18n.t("datasets.schema.preview.unknown");
  return available ? i18n.t("datasets.schema.preview.available") : i18n.t("datasets.schema.preview.unavailable");
}

export function formatDatasetSourceCountLabel(
  sourceCount: number | null | undefined,
): string {
  if (typeof sourceCount !== "number") return i18n.t("datasets.schema.sourceCount.unknown");
  return i18n.t("datasets.schema.sourceCount.count", { count: sourceCount });
}

export function formatDatasetTargetCountLabel(
  targetCount: number | null | undefined,
): string {
  if (typeof targetCount !== "number") return i18n.t("datasets.schema.targetCount.unknown");
  return i18n.t("datasets.schema.targetCount.count", { count: targetCount });
}

export function formatDatasetPreviewSchemaAvailabilitySummary(
  summary: DatasetPreviewSchemaAvailabilitySummaryInput,
): string {
  return [
    formatDatasetPreviewAvailabilityLabel(summary.previewAvailable),
    formatDatasetSourceModeLabel(summary.isMultiSource),
    formatDatasetSourceCountLabel(summary.sourceCount),
    formatDatasetTargetCountLabel(summary.targetCount),
  ].join(" / ");
}
