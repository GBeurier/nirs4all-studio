import i18n from "i18next";
import type { DataShape } from "./DatasetBinding";
import type { Dataset } from "@/types/datasets";

export interface PartitionedBindableDatasets {
  availableDatasets: Dataset[];
  missingDatasets: Dataset[];
}

export interface DataShapeSourcesBadge {
  label: string;
}

export interface DatasetShapeDisplayModel {
  tuple: string;
  sourcesBadge: DataShapeSourcesBadge | null;
}

export function partitionBindableDatasets(datasets: Dataset[]): PartitionedBindableDatasets {
  return {
    availableDatasets: datasets.filter((dataset) => dataset.status === "available"),
    missingDatasets: datasets.filter((dataset) => dataset.status === "missing"),
  };
}

export function formatBoundDatasetShapeBadge(shape: DataShape): string {
  return `${shape.samples.toLocaleString()} × ${shape.features.toLocaleString()}`;
}

export function formatDatasetListShape(dataset: Dataset): string {
  return i18n.t("pipelineEditor.binding.listShape", {
    samples: dataset.num_samples?.toLocaleString() || "?",
    features: dataset.num_features?.toLocaleString() || "?",
  });
}

export function formatDataShapeTuple(shape: DataShape): string {
  return `(${shape.samples.toLocaleString()}, ${shape.features.toLocaleString()})`;
}

export function getDataShapeSourcesBadge(shape: DataShape): DataShapeSourcesBadge | null {
  if (!shape.sources || shape.sources <= 1) {
    return null;
  }

  return { label: i18n.t("pipelineEditor.binding.sourcesBadge", { count: shape.sources }) };
}

export function buildDatasetShapeDisplayModel(shape: DataShape): DatasetShapeDisplayModel {
  return {
    tuple: formatDataShapeTuple(shape),
    sourcesBadge: getDataShapeSourcesBadge(shape),
  };
}
