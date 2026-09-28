export type DatasetGroupingFieldsInput = {
  config?: {
    dataset_document?: unknown;
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

/** A typed cohort may supply split groups directly, without a metadata column. */
export function hasEmbeddedCohortGroups(dataset: DatasetGroupingFieldsInput | null | undefined): boolean {
  const document = dataset?.config?.dataset_document;
  if (!document || typeof document !== "object" || Array.isArray(document)) return false;
  const typed = document as Record<string, unknown>;
  if (typed.schema !== "nirs4all.studio-multimodal-dataset.v1") return false;
  const cohort = typed.cohort;
  if (!cohort || typeof cohort !== "object" || Array.isArray(cohort)) return false;
  const value = cohort as Record<string, unknown>;
  if (value.schema !== "nirs4all.multimodal-dataset" || value.schema_version !== 1
      || !Array.isArray(value.sample_ids)) return false;
  const groups = value.groups;
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) return false;
  const array = groups as Record<string, unknown>;
  const count = value.sample_ids.length;
  return count > 0 && Array.isArray(array.shape) && array.shape.length === 1 && array.shape[0] === count
    && Array.isArray(array.values) && array.values.length === count
    && array.values.every((group) => typeof group === "string" || typeof group === "number");
}

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
