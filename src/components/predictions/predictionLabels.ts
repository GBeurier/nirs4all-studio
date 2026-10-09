import type { TFunction } from "i18next";

import { normalizePartition } from "@/lib/partitionColors";

const KNOWN_TASK_TYPES = new Set(["regression", "classification", "binary_classification", "multiclass_classification"]);

/** Localised name of a train / val / test partition; unrecognised partitions use `fallback`, then the stored value. */
export function getPartitionLabel(t: TFunction, partition: string | null | undefined, fallback?: string): string {
  const key = normalizePartition(partition);
  return key ? t(`predictions.partitions.${key}`) : (fallback ?? partition ?? "");
}

/** Localised task type; unrecognised task types are shown as stored. */
export function getTaskTypeLabel(t: TFunction, taskType: string): string {
  return KNOWN_TASK_TYPES.has(taskType) ? t(`predictions.taskTypes.${taskType}`) : taskType;
}
