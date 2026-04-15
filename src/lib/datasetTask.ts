import type { TaskType } from "@/types/datasets";
import { isClassificationTaskType } from "@/lib/scores";

type DatasetTaskValue = TaskType | "classification" | null | undefined;

interface DatasetTaskLabelOptions {
  short?: boolean;
  numClasses?: number | null;
  fallback?: string;
}

function humanizeTaskType(taskType: string): string {
  return taskType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getDatasetTaskLabel(
  taskType: DatasetTaskValue,
  options: DatasetTaskLabelOptions = {},
): string {
  const {
    short = false,
    numClasses,
    fallback = "--",
  } = options;
  const normalized = (taskType || "").toLowerCase();

  if (!normalized) return fallback;
  if (normalized === "auto") return "Auto";
  if (normalized === "regression") return short ? "Reg" : "Regression";

  if (normalized === "classification") {
    if (short) return numClasses != null && numClasses > 2 ? "Multi" : "Classif";
    return numClasses != null && numClasses > 2
      ? "Multi-class Classification"
      : "Classification";
  }

  if (normalized === "binary_classification") {
    return short ? "Classif" : "Binary Classification";
  }

  if (normalized === "multiclass_classification") {
    return short ? "Multi" : "Multi-class Classification";
  }

  if (isClassificationTaskType(normalized)) {
    return short ? "Classif" : humanizeTaskType(normalized);
  }

  return humanizeTaskType(normalized);
}
