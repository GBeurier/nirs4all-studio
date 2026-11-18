import type { Dataset, TargetConfig } from "@/types/datasets";

/** The explicit choice "train one model on all target columns together". */
export const ALL_TARGET_COLUMNS = null;

/** A run's target for one dataset: a column name, or all columns together. */
export type ExperimentTargetChoice = string | typeof ALL_TARGET_COLUMNS;

export interface ExperimentTargetOption {
  datasetId: string;
  datasetName: string;
  sampleCount: number | null;
  targets: TargetConfig[];
  /** The column this run trains on, or `ALL_TARGET_COLUMNS`. */
  selected: ExperimentTargetChoice;
}

/** Samples of one dataset without a value for the column its run trains on. */
export interface MissingTargetCount {
  datasetId: string;
  datasetName: string;
  target: string;
  missing: number;
  samples: number | null;
}

type TargetDataset = Pick<Dataset, "id" | "name" | "targets" | "default_target" | "config" | "num_samples">;

/** A linked multimodal cohort document declares its own targets; it has no column choice. */
function selectableTargets(dataset: TargetDataset): TargetConfig[] {
  if (dataset.config?.dataset_document !== undefined) return [];
  return (dataset.targets ?? []).filter((target) => typeof target.column === "string" && target.column.length > 0);
}

/**
 * The datasets whose run needs a target choice (several target columns), with
 * the column each one trains on: the user's answer, else the dataset's default
 * target, else its first target column. A dataset with one target column is
 * not listed: it launches with no extra question.
 */
export function resolveExperimentTargets(
  choices: Readonly<Record<string, ExperimentTargetChoice>>,
  datasets: TargetDataset[],
): ExperimentTargetOption[] {
  return datasets.flatMap((dataset) => {
    const targets = selectableTargets(dataset);
    if (targets.length < 2) return [];
    const columns = targets.map((target) => target.column);
    const choice = choices[dataset.id];
    const saved = dataset.default_target && columns.includes(dataset.default_target) ? dataset.default_target : columns[0];
    const selected = choice === ALL_TARGET_COLUMNS
      ? ALL_TARGET_COLUMNS
      : choice !== undefined && columns.includes(choice) ? choice : saved;
    return [{
      datasetId: dataset.id,
      datasetName: dataset.name,
      sampleCount: typeof dataset.num_samples === "number" ? dataset.num_samples : null,
      targets,
      selected,
    }];
  });
}

/** `legacyConfig.target_by_dataset`: only the datasets trained on one named column. */
export function buildTargetByDataset(options: ExperimentTargetOption[]): Record<string, string> {
  return Object.fromEntries(options.flatMap((option) => (
    option.selected === ALL_TARGET_COLUMNS ? [] : [[option.datasetId, option.selected]]
  )));
}

/** The known counts of samples without a value for the trained column, per dataset. */
export function missingTargetCounts(options: ExperimentTargetOption[], datasets: TargetDataset[]): MissingTargetCount[] {
  const selectedByDataset = new Map(options.map((option) => [option.datasetId, option.selected]));
  return datasets.flatMap((dataset) => {
    const targets = selectableTargets(dataset);
    const column = selectedByDataset.has(dataset.id) ? selectedByDataset.get(dataset.id) : targets[0]?.column;
    const target = targets.find((candidate) => candidate.column === column);
    if (!target || !target.missing_count) return [];
    return [{
      datasetId: dataset.id,
      datasetName: dataset.name,
      target: target.column,
      missing: target.missing_count,
      samples: typeof dataset.num_samples === "number" ? dataset.num_samples : null,
    }];
  });
}
