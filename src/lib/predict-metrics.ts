import type { TFunction } from "i18next";

import { formatMetricName } from "@/lib/scores";

function normalizeMetric(metric: string | null | undefined): string {
  return (metric || "").trim().toLowerCase();
}

export function getPredictionMetricName(metric: string | null | undefined, t: TFunction): string {
  const normalized = normalizeMetric(metric);
  if (!normalized) return t("predict.metrics.score");
  if (normalized === "rmse" || normalized === "rmsep") return "RMSEP";
  return formatMetricName(normalized);
}

export function getPredictionMetricLabel(metric: string | null | undefined, t: TFunction): string {
  return t("predict.metrics.predictionLabel", { metric: getPredictionMetricName(metric, t) });
}
