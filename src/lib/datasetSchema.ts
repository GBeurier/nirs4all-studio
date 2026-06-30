import type { Dataset } from "@/types/datasets";

import { getDatasetSourceCount } from "./datasetDomain";
import {
  getDatasetMetadataColumns,
  getDatasetRepetitionColumn,
} from "./datasetGroupingFields";
import {
  buildDatasetAggregationRef,
  type DatasetAggregationRef,
} from "./datasetSchemaAggregation";
import { buildDatasetSchemaFingerprint } from "./datasetSchemaFingerprint";
import { buildDatasetSchemaTargetProjection } from "./datasetSchemaTargets";
import { buildDatasetSchemaViewProjection } from "./datasetSchemaViews";

export const DATASET_SCHEMA_REF_VERSION = "studio.dataset-schema.v1" as const;

export type DatasetSchemaRefVersion = typeof DATASET_SCHEMA_REF_VERSION;
export type DatasetSchemaSource = "legacy-dataset";
export type DatasetSchemaTaskType =
  | "auto"
  | "regression"
  | "classification"
  | "binary_classification"
  | "multiclass_classification"
  | "unknown";
export type DatasetAxisKind =
  | "sample"
  | "feature"
  | "target"
  | "metadata"
  | "source";
export type RepresentationPreviewKind =
  | "spectra"
  | "targets"
  | "metadata"
  | "grouping";

export interface DatasetAxisRef {
  id: string;
  kind: DatasetAxisKind;
  label: string;
  size: number | null;
  unit?: string;
}

export interface DatasetTargetRef {
  column: string;
  label: string;
  taskType: DatasetSchemaTaskType;
  unit?: string;
  isDefault: boolean;
}

export interface RepresentationPreview {
  id: string;
  datasetId: string;
  kind: RepresentationPreviewKind;
  label: string;
  available: boolean;
  sampleCount: number | null;
  featureCount: number | null;
  targetCount: number | null;
  metadataColumnCount: number | null;
  sourceCount: number | null;
}

export interface DataViewRef {
  id: string;
  datasetId: string;
  label: string;
  source: DatasetSchemaSource;
  representationIds: string[];
  targetColumn: string | null;
  taskType: DatasetSchemaTaskType;
  sampleCount: number | null;
  featureCount: number | null;
  metadataColumns: string[];
  repetitionColumn: string | null;
  sourceCount: number | null;
}

export interface DatasetSchemaSummary {
  sampleCount: number | null;
  featureCount: number | null;
  targetLabel: string | null;
  metadataColumnCount: number | null;
  repetitionColumn: string | null;
}

export interface DatasetSchemaRef {
  id: string;
  datasetId: string;
  datasetName: string;
  version: DatasetSchemaRefVersion;
  source: DatasetSchemaSource;
  fingerprint: string;
  sampleCount: number | null;
  featureCount: number | null;
  sourceCount: number | null;
  isMultiSource: boolean;
  targetColumns: string[];
  defaultTargetColumn: string | null;
  targetRefs: DatasetTargetRef[];
  taskType: DatasetSchemaTaskType;
  metadataColumns: string[];
  repetitionColumn: string | null;
  aggregation: DatasetAggregationRef;
  axes: DatasetAxisRef[];
  representations: RepresentationPreview[];
  dataViews: DataViewRef[];
  defaultDataViewId: string;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildDatasetSchemaRef(dataset: Dataset): DatasetSchemaRef {
  const sampleCount = nullableNumber(dataset.num_samples);
  const featureCount = nullableNumber(dataset.num_features);
  const sourceCount = getDatasetSourceCount(dataset);
  const {
    targetColumns,
    defaultTargetColumn,
    targetRefs,
    taskType,
  } = buildDatasetSchemaTargetProjection(dataset);
  const metadataColumns = getDatasetMetadataColumns(dataset);
  const repetitionColumn = getDatasetRepetitionColumn(dataset);
  const aggregation = buildDatasetAggregationRef(dataset);
  const {
    axes,
    representations,
    dataViews,
    defaultDataViewId,
  } = buildDatasetSchemaViewProjection({
    datasetId: dataset.id,
    sampleCount,
    featureCount,
    targetCount: targetColumns.length,
    defaultTargetColumn,
    taskType,
    metadataColumns,
    sourceCount,
    repetitionColumn,
  });
  return {
    id: `${dataset.id}:schema`,
    datasetId: dataset.id,
    datasetName: dataset.name,
    version: DATASET_SCHEMA_REF_VERSION,
    source: "legacy-dataset",
    fingerprint: buildDatasetSchemaFingerprint({
      datasetId: dataset.id,
      hash: dataset.hash,
      sampleCount,
      featureCount,
      sourceCount,
      targetColumns,
      defaultTargetColumn,
      metadataColumns,
      repetitionColumn,
      aggregation,
      taskType,
    }),
    sampleCount,
    featureCount,
    sourceCount,
    isMultiSource: sourceCount > 1,
    targetColumns,
    defaultTargetColumn,
    targetRefs,
    taskType,
    metadataColumns,
    repetitionColumn,
    aggregation,
    axes,
    representations,
    dataViews,
    defaultDataViewId,
  };
}

export { summarizeDatasetSchemaRef } from "./datasetSchemaSummary";
