import { formatMetricName } from "@/lib/scores";

function normalizeMetric(metric: string | null | undefined): string {
  return (metric || "").trim().toLowerCase();
}

export function getPredictionMetricName(metric: string | null | undefined): string {
  const normalized = normalizeMetric(metric);
  if (!normalized) return "Score";
  if (normalized === "rmse" || normalized === "rmsep") return "RMSEP";
  return formatMetricName(normalized);
}

export function getPredictionMetricLabel(metric: string | null | undefined): string {
  return `Prediction: ${getPredictionMetricName(metric)}`;
}

export function getSelectionMetricLabel(metric: string | null | undefined): string {
  const normalized = normalizeMetric(metric);
  if (!normalized) return "Selection";
  if (normalized === "rmse" || normalized === "rmsep") return "Selection: RMSECV";
  return `Selection: ${formatMetricName(normalized)}`;
}
