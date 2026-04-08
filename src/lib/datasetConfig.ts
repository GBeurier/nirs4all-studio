import type { AggregationConfig, DatasetConfig } from "@/types/datasets";

const DEFAULT_AGGREGATION_METHOD: AggregationConfig["method"] = "mean";

function normalizeColumnName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getConfiguredRepetitionColumn(
  config?: Partial<DatasetConfig> | null,
): string | undefined {
  const aggregation = config?.aggregation;

  if (aggregation?.enabled === false) {
    return undefined;
  }

  const aggregationColumn = normalizeColumnName(aggregation?.column);
  if (aggregationColumn) {
    return aggregationColumn;
  }

  return normalizeColumnName(config?.repetition) ?? normalizeColumnName(config?.aggregate);
}

export function getInitialAggregationConfig(
  config?: Partial<DatasetConfig> | null,
): AggregationConfig {
  const column = getConfiguredRepetitionColumn(config);

  return {
    enabled: Boolean(column),
    column,
    method: config?.aggregation?.method ?? DEFAULT_AGGREGATION_METHOD,
  };
}
