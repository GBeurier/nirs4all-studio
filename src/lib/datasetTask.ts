import i18next, { type TFunction } from "i18next";
import { isClassificationTaskType } from "@/lib/scores";

type DatasetTaskValue = string | null | undefined;

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
  t: TFunction = i18next.t,
  options: DatasetTaskLabelOptions = {},
): string {
  const {
    short = false,
    numClasses,
    fallback = "--",
  } = options;
  const normalized = (taskType || "").toLowerCase();

  if (!normalized) return fallback;
  if (normalized === "auto") return t("datasets.task.auto");
  if (normalized === "regression") return short ? t("datasets.task.regressionShort") : t("datasets.task.regression");

  if (normalized === "classification") {
    if (short) return numClasses != null && numClasses > 2 ? t("datasets.task.multiclassShort") : t("datasets.task.classificationShort");
    return numClasses != null && numClasses > 2
      ? t("datasets.task.multiclassClassification")
      : t("datasets.task.classification");
  }

  if (normalized === "binary_classification") {
    return short ? t("datasets.task.classificationShort") : t("datasets.task.binaryClassification");
  }

  if (normalized === "multiclass_classification") {
    return short ? t("datasets.task.multiclassShort") : t("datasets.task.multiclassClassification");
  }

  if (isClassificationTaskType(normalized)) {
    return short ? t("datasets.task.classificationShort") : humanizeTaskType(normalized);
  }

  return humanizeTaskType(normalized);
}
