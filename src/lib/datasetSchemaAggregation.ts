import type { Dataset } from "@/types/datasets";

export type DatasetAggregationMethod = "mean" | "median" | "vote" | "unknown";
export type DatasetAggregationSource = "config" | "legacy-aggregate" | "none";
export type DatasetAggregationReadinessStatus = "disabled" | "ready" | "warning";

export interface DatasetAggregationRef {
  enabled: boolean;
  column: string | null;
  method: DatasetAggregationMethod;
  source: DatasetAggregationSource;
}

export interface DatasetAggregationReadiness {
  status: DatasetAggregationReadinessStatus;
  label: string;
  message: string;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMethod(value: unknown): DatasetAggregationMethod {
  if (value === "mean" || value === "median" || value === "vote") return value;
  return "unknown";
}

function formatAggregationMethod(method: DatasetAggregationMethod): string {
  return method === "unknown" ? "unknown method" : method;
}

function formatAggregationSource(source: DatasetAggregationSource): string {
  if (source === "config") return "dataset config";
  if (source === "legacy-aggregate") return "legacy aggregate field";
  return "unknown source";
}

export function buildDatasetAggregationRef(
  dataset: Pick<Dataset, "config"> | null | undefined,
): DatasetAggregationRef {
  const aggregation = dataset?.config?.aggregation;
  if (aggregation?.enabled) {
    return {
      enabled: true,
      column: normalizeText(aggregation.column),
      method: normalizeMethod(aggregation.method),
      source: "config",
    };
  }

  const legacyAggregateColumn = normalizeText(dataset?.config?.aggregate);
  if (legacyAggregateColumn) {
    return {
      enabled: true,
      column: legacyAggregateColumn,
      method: "unknown",
      source: "legacy-aggregate",
    };
  }

  return {
    enabled: false,
    column: null,
    method: "unknown",
    source: "none",
  };
}

export function formatDatasetAggregationLabel(aggregation: DatasetAggregationRef): string {
  if (!aggregation.enabled) return "No aggregation configured";

  const methodLabel = formatAggregationMethod(aggregation.method);
  if (aggregation.column) return `aggregation: ${methodLabel} by ${aggregation.column}`;
  return `aggregation: ${methodLabel}`;
}

export function formatDatasetAggregationSourceLabel(aggregation: DatasetAggregationRef): string | null {
  if (!aggregation.enabled) return null;
  return `aggregation source: ${formatAggregationSource(aggregation.source)}`;
}

export function getDatasetAggregationReadiness(aggregation: DatasetAggregationRef): DatasetAggregationReadiness {
  if (!aggregation.enabled) {
    return {
      status: "disabled",
      label: "No aggregation",
      message: "No dataset aggregation is configured for this pair.",
    };
  }

  if (!aggregation.column) {
    return {
      status: "warning",
      label: "Aggregation incomplete",
      message: "Aggregation is enabled but no grouping column is configured.",
    };
  }

  if (aggregation.method === "unknown") {
    return {
      status: "warning",
      label: "Aggregation method unknown",
      message: `Aggregation uses ${formatAggregationSource(aggregation.source)} "${aggregation.column}" without an explicit method.`,
    };
  }

  return {
    status: "ready",
    label: "Aggregation ready",
    message: `Aggregation uses ${aggregation.method} by "${aggregation.column}" from ${formatAggregationSource(aggregation.source)}.`,
  };
}

export function formatDatasetAggregationTitleLabel(aggregation: DatasetAggregationRef): string | null {
  if (!aggregation.enabled) return null;

  const methodLabel = formatAggregationMethod(aggregation.method);
  if (aggregation.column) return `Aggregation: ${methodLabel} by ${aggregation.column}`;
  return `Aggregation: ${methodLabel}`;
}
