import { getPredictionMetricLabel } from "@/lib/predict-metrics";
import { formatMetricValue } from "@/lib/scores";
import type { AvailableModel } from "@/types/predict";

export type DataSourceConfig =
  | { type: "dataset"; datasetId: string; partition: string }
  | { type: "file"; file: File }
  | { type: "array"; spectra: number[][] };

export type DataInputTab = "dataset" | "upload" | "paste";
export type DataInputSourceIcon = "dataset" | "upload" | "paste";

export interface DataInputSourceTab {
  id: DataInputTab;
  icon: DataInputSourceIcon;
  labelKey: string;
  disabled: boolean;
}

export interface DataInputDatasetOption {
  id: string;
  name?: string | null;
}

export interface DataInputDatasetReadModel {
  options: Array<{ id: string; label: string }>;
  availabilityLabel: string;
}

export interface DataInputPartitionOption {
  value: string;
  label: string;
  labelKey?: string;
}

export interface DataInputCanSubmitInput {
  isModelSelected: boolean;
  modelSource?: AvailableModel["source"] | null;
  isLoading: boolean;
  tab: DataInputTab;
  datasetId: string;
  file: File | null;
  pasteText: string;
}

export interface DataInputSubmitDraft {
  tab: DataInputTab;
  datasetId: string;
  partition: string;
  file: File | null;
  pasteText: string;
}

export type DataInputSubmitError =
  | "missing-dataset"
  | "missing-file"
  | "invalid-paste"
  | "unsupported-source";

export type DataInputSubmitResult =
  | { ok: true; config: DataSourceConfig }
  | { ok: false; reason: DataInputSubmitError };

export interface DataInputModelBadgeReadModel {
  key: string;
  label: string;
  variant: "outline" | "secondary";
}

export interface DataInputModelPillReadModel {
  key: string;
  label: string;
  className: string;
}

export interface DataInputModelReadModel {
  isSelected: boolean;
  title: string;
  description: string;
  badges: DataInputModelBadgeReadModel[];
  pills: DataInputModelPillReadModel[];
}

export interface DataInputFileReadModel {
  name: string;
  sizeLabel: string;
}

export const DEFAULT_DATA_INPUT_TAB: DataInputTab = "dataset";
export const DEFAULT_DATA_INPUT_PARTITION = "test";
export const DATA_INPUT_FILE_ACCEPT = ".csv,.xlsx,.xls";

export const DATA_INPUT_FIELD_LABELS = {
  dataset: "Dataset",
  partition: "Partition",
} as const;

export const DATA_INPUT_PARTITION_HINT =
  "Use `test` by default when you want the displayed RMSEP to stay comparable.";

const DATA_INPUT_SOURCE_DEFINITIONS: Array<Omit<DataInputSourceTab, "disabled">> = [
  { id: "dataset", icon: "dataset", labelKey: "predict.data.tabs.dataset" },
  { id: "upload", icon: "upload", labelKey: "predict.data.tabs.upload" },
  { id: "paste", icon: "paste", labelKey: "predict.data.tabs.paste" },
];

export const DATA_INPUT_PARTITION_OPTIONS: DataInputPartitionOption[] = [
  { value: "test", label: "Test" },
  { value: "train", label: "Train" },
  { value: "all", label: "All partitions", labelKey: "predict.data.dataset.allPartitions" },
];

const ACCEPTED_DATA_INPUT_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;

const MODEL_SCORE_PILL_CLASS = "rounded-full bg-background px-2.5 py-1 font-medium text-foreground";
const MODEL_METADATA_PILL_CLASS = "rounded-full bg-background px-2.5 py-1 text-muted-foreground";

export function buildDataInputSourceTabs(
  isModelSelected: boolean,
  modelSource?: AvailableModel["source"] | null,
): DataInputSourceTab[] {
  return DATA_INPUT_SOURCE_DEFINITIONS.map((source) => ({
    ...source,
    disabled: !isModelSelected || (modelSource === "native_archive" && source.id !== "upload"),
  }));
}

export function buildDataInputDatasetReadModel(
  datasets: readonly DataInputDatasetOption[],
): DataInputDatasetReadModel {
  return {
    options: datasets.map((dataset) => ({
      id: dataset.id,
      label: dataset.name || dataset.id,
    })),
    availabilityLabel: `${datasets.length} linked dataset${datasets.length === 1 ? "" : "s"} available.`,
  };
}

export function formatDataInputPartitionLabel(value: string): string {
  const option = DATA_INPUT_PARTITION_OPTIONS.find((entry) => entry.value === value);
  if (option) return option.label;
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isAcceptedDataInputFile<T extends Pick<File, "name">>(file: T | null | undefined): file is T {
  if (!file) return false;
  const name = file.name.toLowerCase();
  return ACCEPTED_DATA_INPUT_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function buildDataInputFileReadModel(file: Pick<File, "name" | "size"> | null): DataInputFileReadModel | null {
  if (!file) return null;
  return {
    name: file.name,
    sizeLabel: `${(file.size / 1024).toFixed(1)} KB`,
  };
}

export function parsePastedSpectra(text: string): number[][] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const jsonSpectra = parseJsonSpectra(parsed);
    if (jsonSpectra) return jsonSpectra;
  } catch {
    // Plain CSV/TSV text is handled below.
  }

  return parseDelimitedSpectra(trimmed);
}

export function getDataInputCanSubmit(input: DataInputCanSubmitInput): boolean {
  if (!input.isModelSelected || input.isLoading) return false;
  if (input.modelSource === "native_archive" && input.tab !== "upload") return false;
  if (input.tab === "dataset") return Boolean(input.datasetId);
  if (input.tab === "upload") return Boolean(input.file);
  if (input.tab === "paste") return Boolean(input.pasteText.trim());
  return false;
}

export function buildDataSourceConfig(input: DataInputSubmitDraft): DataInputSubmitResult {
  if (input.tab === "dataset") {
    if (!input.datasetId) return { ok: false, reason: "missing-dataset" };
    return {
      ok: true,
      config: {
        type: "dataset",
        datasetId: input.datasetId,
        partition: input.partition || DEFAULT_DATA_INPUT_PARTITION,
      },
    };
  }

  if (input.tab === "upload") {
    if (!input.file) return { ok: false, reason: "missing-file" };
    return { ok: true, config: { type: "file", file: input.file } };
  }

  if (input.tab === "paste") {
    const spectra = parsePastedSpectra(input.pasteText);
    if (!spectra) return { ok: false, reason: "invalid-paste" };
    return { ok: true, config: { type: "array", spectra } };
  }

  return { ok: false, reason: "unsupported-source" };
}

export function buildDataInputModelReadModel(model: AvailableModel | null): DataInputModelReadModel {
  if (!model) {
    return {
      isSelected: false,
      title: "Model required",
      description: "Select a trained model on the left before choosing data.",
      badges: [],
      pills: [],
    };
  }

  const badges: DataInputModelBadgeReadModel[] = [
    { key: "source", label: model.source, variant: "outline" },
    { key: "model-class", label: model.model_class || model.name, variant: "secondary" },
  ];
  if (model.dataset_name) {
    badges.push({ key: "dataset", label: model.dataset_name, variant: "outline" });
  }

  const pills: DataInputModelPillReadModel[] = [];
  if (model.prediction_score != null && model.prediction_metric) {
    pills.push({
      key: "prediction-score",
      label: `${getPredictionMetricLabel(model.prediction_metric)} ${formatMetricValue(
        model.prediction_score,
        model.prediction_metric,
      )}`,
      className: MODEL_SCORE_PILL_CLASS,
    });
  }
  if (model.preprocessing) {
    pills.push({
      key: "preprocessing",
      label: model.preprocessing,
      className: MODEL_METADATA_PILL_CLASS,
    });
  }

  return {
    isSelected: true,
    title: model.name,
    description: "Input data will be replayed through this trained model path.",
    badges,
    pills,
  };
}

function parseJsonSpectra(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  if (value.every(isFiniteNumber)) {
    return [value];
  }

  const rows: number[][] = [];
  for (const row of value) {
    const normalized = normalizeNumberRow(row);
    if (!normalized) return null;
    rows.push(normalized);
  }
  return rows.length > 0 ? rows : null;
}

function parseDelimitedSpectra(text: string): number[][] | null {
  const rows: number[][] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const cells = line.split(/[,;\t]/).map((value) => value.trim());
    if (cells.length === 0 || cells.some((value) => value === "")) return null;

    const values = cells.map((value) => Number(value));
    if (values.some((value) => !Number.isFinite(value))) return null;
    rows.push(values);
  }

  return rows.length > 0 ? rows : null;
}

function normalizeNumberRow(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every(isFiniteNumber)) return null;
  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
