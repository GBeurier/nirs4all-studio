import type {
  DatasetConfig,
  DatasetFile,
  DatasetTargetSelectionConfig,
  TaskType,
  WizardState,
} from "@/types/datasets";

type WizardConfigState = Pick<
  WizardState,
  | "datasetName"
  | "files"
  | "perFileOverrides"
  | "parsing"
  | "targets"
  | "defaultTarget"
  | "taskType"
  | "aggregation"
  | "folds"
  | "multiSource"
>;

export function buildDatasetWizardFiles(
  state: Pick<WizardState, "files" | "perFileOverrides">,
): DatasetFile[] {
  return state.files
    .filter((file) => file.type !== "unknown")
    .map((file) => ({
      path: file.path,
      type: file.type as DatasetFile["type"],
      split: file.split === "unknown" ? "train" : file.split,
      source: file.source ?? null,
      overrides: state.perFileOverrides[file.path],
    }));
}

export function buildDatasetTargetSelection(
  state: Pick<WizardState, "targets" | "defaultTarget" | "taskType">,
): DatasetTargetSelectionConfig {
  const selectedTargets = state.targets
    .map((target) => target.column.trim())
    .filter((target) => target.length > 0);

  const taskByTarget = state.targets.reduce<Record<string, TaskType>>((acc, target) => {
    const column = target.column.trim();
    if (!column) return acc;
    acc[column] = target.type === "auto" ? state.taskType : target.type;
    return acc;
  }, {});

  return {
    selected_targets: selectedTargets,
    ...(state.defaultTarget ? { default_target: state.defaultTarget } : {}),
    task_by_target: taskByTarget,
  };
}

export function buildDatasetWizardConfig(state: WizardConfigState): Partial<DatasetConfig> {
  const config: Partial<DatasetConfig> = {
    name: state.datasetName,
    delimiter: state.parsing.delimiter,
    decimal_separator: state.parsing.decimal_separator,
    has_header: state.parsing.has_header,
    header_unit: state.parsing.header_unit,
    signal_type: state.parsing.signal_type,
    na_policy: state.parsing.na_policy,
    files: buildDatasetWizardFiles(state),
    global_params: state.parsing,
    targets: state.targets,
    target_selection: buildDatasetTargetSelection(state),
    default_target: state.defaultTarget,
    task_type: state.taskType,
    aggregation: state.aggregation,
    folds: state.folds,
  };

  if (state.multiSource) {
    config.multi_source = state.multiSource;
  }

  return config;
}
