import i18n from "i18next";

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
  return i18n.t(`datasets.schema.aggregation.method.${method}`);
}

function formatAggregationSource(source: DatasetAggregationSource): string {
  if (source === "config") return i18n.t("datasets.schema.aggregation.sourceConfig");
  if (source === "legacy-aggregate") return i18n.t("datasets.schema.aggregation.sourceLegacy");
  return i18n.t("datasets.schema.aggregation.sourceUnknown");
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
  if (!aggregation.enabled) return i18n.t("datasets.schema.aggregation.noneConfigured");

  const methodLabel = formatAggregationMethod(aggregation.method);
  if (aggregation.column) return i18n.t("datasets.schema.aggregation.labelByColumn", { method: methodLabel, column: aggregation.column });
  return i18n.t("datasets.schema.aggregation.labelMethod", { method: methodLabel });
}

export function formatDatasetAggregationSourceLabel(aggregation: DatasetAggregationRef): string | null {
  if (!aggregation.enabled) return null;
  return i18n.t("datasets.schema.aggregation.sourceLabel", { source: formatAggregationSource(aggregation.source) });
}

export function getDatasetAggregationReadiness(aggregation: DatasetAggregationRef): DatasetAggregationReadiness {
  if (!aggregation.enabled) {
    return {
      status: "disabled",
      label: i18n.t("datasets.schema.aggregation.disabledLabel"),
      message: i18n.t("datasets.schema.aggregation.disabledMessage"),
    };
  }

  if (!aggregation.column) {
    return {
      status: "warning",
      label: i18n.t("datasets.schema.aggregation.incompleteLabel"),
      message: i18n.t("datasets.schema.aggregation.incompleteMessage"),
    };
  }

  if (aggregation.method === "unknown") {
    return {
      status: "warning",
      label: i18n.t("datasets.schema.aggregation.methodUnknownLabel"),
      message: i18n.t("datasets.schema.aggregation.methodUnknownMessage", { source: formatAggregationSource(aggregation.source), column: aggregation.column }),
    };
  }

  return {
    status: "ready",
    label: i18n.t("datasets.schema.aggregation.readyLabel"),
    message: i18n.t("datasets.schema.aggregation.readyMessage", {
      method: formatAggregationMethod(aggregation.method),
      column: aggregation.column,
      source: formatAggregationSource(aggregation.source),
    }),
  };
}

export function formatDatasetAggregationTitleLabel(aggregation: DatasetAggregationRef): string | null {
  if (!aggregation.enabled) return null;

  const methodLabel = formatAggregationMethod(aggregation.method);
  if (aggregation.column) return i18n.t("datasets.schema.aggregation.titleByColumn", { method: methodLabel, column: aggregation.column });
  return i18n.t("datasets.schema.aggregation.titleMethod", { method: methodLabel });
}
