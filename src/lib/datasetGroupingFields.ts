export type DatasetGroupingFieldsInput = {
  config?: {
    aggregation?: {
      enabled?: boolean;
      column?: string;
      method?: "mean" | "median" | "vote";
    };
    repetition?: string;
  };
  metadata_columns?: string[];
  metadataColumns?: string[];
  repetitionColumn?: string | null;
};

export function getDatasetRepetitionColumn(
  dataset: Pick<DatasetGroupingFieldsInput, "config" | "repetitionColumn"> | null | undefined,
): string | null {
  if (typeof dataset?.repetitionColumn === "string" && dataset.repetitionColumn.trim()) {
    return dataset.repetitionColumn.trim();
  }

  const config = dataset?.config;
  if (!config) {
    return null;
  }

  if (config.aggregation?.enabled && typeof config.aggregation.column === "string" && config.aggregation.column.trim()) {
    return config.aggregation.column.trim();
  }

  if (typeof config.repetition === "string" && config.repetition.trim()) {
    return config.repetition.trim();
  }

  return null;
}

export function getDatasetMetadataColumns(
  dataset: Pick<DatasetGroupingFieldsInput, "metadata_columns" | "metadataColumns"> | null | undefined,
): string[] {
  const columns = dataset?.metadata_columns ?? dataset?.metadataColumns ?? [];
  return [...new Set(columns.filter((column): column is string => typeof column === "string" && column.length > 0))].sort(
    (left, right) => left.localeCompare(right),
  );
}
