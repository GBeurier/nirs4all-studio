import { getDatasetTargetColumns } from "@/lib/datasetDomain";
import { getDefaultDatasetTargetColumn } from "@/lib/datasetSchemaTargets";
import type { Dataset, TargetConfig } from "@/types/datasets";

export interface PlaygroundDatasetSelectOption {
  value: string;
  label: string;
}

export function buildDatasetSourceOptions(
  sourceCount: number | null | undefined,
): PlaygroundDatasetSelectOption[] {
  return Array.from(
    { length: Math.max(sourceCount ?? 1, 1) },
    (_, index) => ({
      value: String(index),
      label: `Source ${index + 1}`,
    }),
  );
}

/** One target column the Playground can colour and analyse by. */
export interface PlaygroundTargetChoice {
  /** Position of the column among the dataset's targets: the `target_index` the backend loads. */
  index: number;
  column: string;
  label: string;
  /** Samples without a value for this column, as counted when the dataset was last inspected. */
  missing: number | null;
}

export interface PlaygroundTargetChoices {
  choices: PlaygroundTargetChoice[];
  /** Index of the dataset's saved default target. */
  defaultIndex: number;
}

/**
 * The targets of a workspace dataset, in the order the backend indexes them,
 * with their missing-value counts and the dataset's saved default target.
 */
export function buildPlaygroundTargetChoices(dataset: Dataset): PlaygroundTargetChoices {
  const columns = getDatasetTargetColumns(dataset);
  const configured = new Map<string, TargetConfig>();
  for (const target of [...(dataset.config?.targets ?? []), ...(dataset.targets ?? [])]) {
    if (target.column) configured.set(target.column, target);
  }
  const choices = columns.map((column, index) => {
    const target = configured.get(column);
    return {
      index,
      column,
      label: target?.label || column,
      missing: typeof target?.missing_count === "number" ? target.missing_count : null,
    };
  });
  const defaultColumn = getDefaultDatasetTargetColumn(dataset, columns);
  return { choices, defaultIndex: Math.max(columns.indexOf(defaultColumn ?? ""), 0) };
}
