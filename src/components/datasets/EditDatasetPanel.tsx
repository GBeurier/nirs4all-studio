import { useMemo, useCallback } from "react";
import type { UpdateDatasetRequest } from "@/api/client";
import { DatasetWizard, type WizardInitialState } from "./DatasetWizard";
import { getInitialAggregationConfig } from "@/lib/datasetConfig";
import type {
  Dataset,
  DatasetConfig,
  DatasetFile,
  DetectedFile,
  HeaderUnit,
  ParsingOptions,
  SignalType,
} from "@/types/datasets";

interface EditDatasetPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset | null;
  onSave: (datasetId: string, updates: UpdateDatasetRequest) => Promise<void>;
  onRefresh?: (datasetId: string) => Promise<void>;
  onVerify?: (datasetId: string) => Promise<void>;
}

const DEFAULT_PARSING: ParsingOptions = {
  delimiter: ";",
  decimal_separator: ".",
  has_header: true,
  header_unit: "cm-1",
  signal_type: "auto",
  na_policy: "auto",
};

function inferFormat(filePath: string): DetectedFile["format"] {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "xlsx":
      return "xlsx";
    case "xls":
      return "xls";
    case "mat":
      return "mat";
    case "npy":
      return "npy";
    case "npz":
      return "npz";
    case "parquet":
      return "parquet";
    default:
      return "csv";
  }
}

function buildLegacyFiles(config: Partial<DatasetConfig>): DatasetFile[] {
  const files: DatasetFile[] = [];

  const addFile = (
    path: string | undefined,
    type: DatasetFile["type"],
    split: DatasetFile["split"],
  ) => {
    if (!path) return;
    files.push({ path, type, split, source: 0 });
  };

  addFile(config.train_x, "X", "train");
  addFile(config.train_y, "Y", "train");
  addFile(config.train_group, "metadata", "train");
  addFile(config.test_x, "X", "test");
  addFile(config.test_y, "Y", "test");
  addFile(config.test_group, "metadata", "test");

  return files;
}

function buildDetectedFiles(config: Partial<DatasetConfig>): DetectedFile[] {
  const files = config.files?.length ? config.files : buildLegacyFiles(config);

  return files.map((file) => {
    const filename = file.path.split(/[\\/]/).pop() || file.path;
    return {
      path: file.path,
      filename,
      type: file.type,
      split: file.split,
      source: file.source ?? 0,
      format: inferFormat(file.path),
      size_bytes: 0,
      confidence: 1,
      detected: false,
    };
  });
}

function buildPerFileOverrides(config: Partial<DatasetConfig>): Record<string, Partial<ParsingOptions>> {
  const overrides: Record<string, Partial<ParsingOptions>> = {};

  config.files?.forEach((file) => {
    if (file.overrides && Object.keys(file.overrides).length > 0) {
      overrides[file.path] = file.overrides;
    }
  });

  const legacyOverrides: Array<[string | undefined, Partial<ParsingOptions> | undefined]> = [
    [config.train_x, config.train_x_params],
    [config.train_y, config.train_y_params],
    [config.test_x, config.test_x_params],
    [config.test_y, config.test_y_params],
  ];

  legacyOverrides.forEach(([path, value]) => {
    if (path && value && Object.keys(value).length > 0) {
      overrides[path] = value;
    }
  });

  return overrides;
}

function buildInitialState(dataset: Dataset): WizardInitialState {
  const config = (dataset.config || {}) as Partial<DatasetConfig>;

  return {
    sourceType: "folder",
    basePath: dataset.path,
    datasetName: dataset.name,
    files: buildDetectedFiles(config),
    skipToStep: "files",
    parsing: {
      delimiter: config.delimiter ?? DEFAULT_PARSING.delimiter,
      decimal_separator: config.decimal_separator ?? DEFAULT_PARSING.decimal_separator,
      has_header: config.has_header ?? DEFAULT_PARSING.has_header,
      header_unit: (config.header_unit ?? config.header_type ?? DEFAULT_PARSING.header_unit) as HeaderUnit,
      signal_type: (config.signal_type ?? DEFAULT_PARSING.signal_type) as SignalType,
      na_policy: config.na_policy ?? DEFAULT_PARSING.na_policy,
    },
    perFileOverrides: buildPerFileOverrides(config),
    targets: config.targets ?? dataset.targets ?? [],
    defaultTarget: dataset.default_target ?? config.default_target ?? "",
    taskType: dataset.task_type ?? config.task_type ?? "auto",
    aggregation: getInitialAggregationConfig(config),
    folds: config.folds ?? null,
    hasFoldFile: config.folds?.source === "file",
    foldFilePath: config.folds?.file,
  };
}

export function EditDatasetPanel({
  open,
  onOpenChange,
  dataset,
  onSave,
}: EditDatasetPanelProps) {
  const initialState = useMemo(() => (dataset ? buildInitialState(dataset) : undefined), [dataset]);

  const handleSave = useCallback(async (_path: string, config?: Partial<DatasetConfig>) => {
    if (!dataset || !config) return;

    const updates: UpdateDatasetRequest = {
      config,
      default_target: config.default_target ?? dataset.default_target,
      task_type: config.task_type ?? dataset.task_type,
      signal_types: config.signal_type && config.signal_type !== "auto" ? [config.signal_type] : [],
    };

    await onSave(dataset.id, updates);
  }, [dataset, onSave]);

  if (!dataset || !initialState) {
    return null;
  }

  return (
    <DatasetWizard
      open={open}
      onOpenChange={onOpenChange}
      onAdd={handleSave}
      initialState={initialState}
      submitLabel="Save Changes"
      submitErrorMessage="Failed to save dataset"
    />
  );
}
