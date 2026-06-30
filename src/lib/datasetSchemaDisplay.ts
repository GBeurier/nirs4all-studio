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
  if (taskType === "regression") return "regression";
  if (taskType === "classification") return "classification";
  if (taskType === "binary_classification") return "binary classification";
  if (taskType === "multiclass_classification") return "multiclass classification";
  if (taskType === "auto") return "auto task";
  return "unknown task";
}

export function formatDatasetSourceModeLabel(
  isMultiSource: boolean | undefined,
): string {
  if (typeof isMultiSource !== "boolean") return "Unknown source mode";
  return isMultiSource ? "multi-source" : "single-source";
}

export function formatDatasetPreviewAvailabilityLabel(
  available: boolean | undefined,
): string {
  if (typeof available !== "boolean") return "Unknown preview availability";
  return available ? "Preview available" : "Preview unavailable";
}

export function formatDatasetSourceCountLabel(
  sourceCount: number | null | undefined,
): string {
  if (typeof sourceCount !== "number") return "Unknown sources";
  return `${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`;
}

export function formatDatasetTargetCountLabel(
  targetCount: number | null | undefined,
): string {
  if (typeof targetCount !== "number") return "Unknown targets";
  return `${targetCount} ${targetCount === 1 ? "target" : "targets"}`;
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
