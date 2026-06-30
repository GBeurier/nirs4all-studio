import type { Dataset, TargetConfig } from "@/types/datasets";

import { getDatasetTargetColumns } from "./datasetDomain";
import type {
  DatasetSchemaTaskType,
  DatasetTargetRef,
} from "./datasetSchema";

export interface DatasetSchemaTargetProjection {
  targetColumns: string[];
  defaultTargetColumn: string | null;
  targetRefs: DatasetTargetRef[];
  taskType: DatasetSchemaTaskType;
}

export function normalizeDatasetSchemaTaskType(value: unknown): DatasetSchemaTaskType {
  if (value === "auto") return "auto";
  if (value === "regression") return "regression";
  if (value === "classification") return "classification";
  if (value === "binary_classification") return "binary_classification";
  if (value === "multiclass_classification") return "multiclass_classification";
  return "unknown";
}

export function getDefaultDatasetTargetColumn(
  dataset: Dataset,
  targetColumns: string[],
): string | null {
  const explicitDefault = dataset.default_target || dataset.config?.default_target;
  if (explicitDefault) return explicitDefault;

  const configuredDefault = [
    ...(dataset.targets ?? []),
    ...(dataset.config?.targets ?? []),
  ].find((target) => target.is_default && target.column);

  return configuredDefault?.column ?? targetColumns[0] ?? null;
}

export function buildDatasetTargetRefs(
  dataset: Dataset,
  targetColumns: string[],
  defaultTargetColumn: string | null,
  fallbackTaskType: DatasetSchemaTaskType,
): DatasetTargetRef[] {
  const configuredTargets = new Map<string, TargetConfig>();
  for (const target of dataset.config?.targets ?? []) {
    if (target.column) configuredTargets.set(target.column, target);
  }
  for (const target of dataset.targets ?? []) {
    if (target.column) configuredTargets.set(target.column, target);
  }

  return targetColumns.map((column) => {
    const target = configuredTargets.get(column);
    const targetTaskType = normalizeDatasetSchemaTaskType(target?.type);
    return {
      column,
      label: target?.label || column,
      taskType: targetTaskType === "unknown" ? fallbackTaskType : targetTaskType,
      ...(target?.unit ? { unit: target.unit } : {}),
      isDefault: column === defaultTargetColumn,
    };
  });
}

export function buildDatasetSchemaTargetProjection(dataset: Dataset): DatasetSchemaTargetProjection {
  const targetColumns = getDatasetTargetColumns(dataset);
  const defaultTargetColumn = getDefaultDatasetTargetColumn(dataset, targetColumns);
  const taskType = normalizeDatasetSchemaTaskType(dataset.task_type ?? dataset.config?.task_type);
  const targetRefs = buildDatasetTargetRefs(dataset, targetColumns, defaultTargetColumn, taskType);

  return {
    targetColumns,
    defaultTargetColumn,
    targetRefs,
    taskType,
  };
}
