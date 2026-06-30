import {
  DATASET_SCHEMA_REF_VERSION,
  type DataViewRef,
  type DatasetSchemaRef,
  type DatasetSchemaTaskType,
} from "@/lib/datasetSchema";
import { buildDatasetAggregationRef } from "@/lib/datasetSchemaAggregation";
import { getDatasetDefaultDataView } from "@/lib/datasetSchemaAccessors";
import { buildDatasetSchemaFingerprint } from "@/lib/datasetSchemaFingerprint";
import { buildDatasetSchemaViewProjection } from "@/lib/datasetSchemaViews";
import type { PlaygroundData } from "@/types/playground";

export interface LegacyPlaygroundDataViewOptions {
  datasetId?: string;
  datasetName?: string;
  targetColumn?: string | null;
  taskType?: DatasetSchemaTaskType;
}

export interface PlaygroundDataViewInput {
  dataView: DataViewRef;
  payload: PlaygroundData;
  schemaRef: DatasetSchemaRef;
}

function getFeatureCount(data: PlaygroundData): number | null {
  if (Array.isArray(data.wavelengths) && data.wavelengths.length > 0) {
    return data.wavelengths.length;
  }
  const firstRow = data.x[0];
  return Array.isArray(firstRow) ? firstRow.length : null;
}

function getSampleCount(data: PlaygroundData): number | null {
  if (data.x.length > 0) {
    return data.x.length;
  }
  return data.y?.length ?? data.sample_ids?.length ?? null;
}

function inferLegacyTaskType(data: PlaygroundData, explicitTaskType?: DatasetSchemaTaskType): DatasetSchemaTaskType {
  if (explicitTaskType) {
    return explicitTaskType;
  }
  return data.y?.length ? "auto" : "unknown";
}

export function buildLegacyPlaygroundSchemaRef(
  data: PlaygroundData,
  options: LegacyPlaygroundDataViewOptions = {},
): DatasetSchemaRef {
  const datasetId = options.datasetId ?? "playground:legacy";
  const sampleCount = getSampleCount(data);
  const featureCount = getFeatureCount(data);
  const targetColumn = options.targetColumn ?? (data.y?.length ? "target" : null);
  const targetColumns = targetColumn ? [targetColumn] : [];
  const metadataColumns = Object.keys(data.metadata ?? {});
  const taskType = inferLegacyTaskType(data, options.taskType);
  const aggregation = buildDatasetAggregationRef(null);
  const {
    axes,
    representations,
    dataViews,
    defaultDataViewId,
  } = buildDatasetSchemaViewProjection({
    datasetId,
    defaultTargetColumn: targetColumn,
    featureCount,
    metadataColumns,
    repetitionColumn: null,
    sampleCount,
    sourceCount: null,
    targetCount: targetColumns.length,
    taskType,
  });

  return {
    aggregation,
    axes,
    dataViews,
    datasetId,
    datasetName: options.datasetName ?? "Playground data",
    defaultDataViewId,
    defaultTargetColumn: targetColumn,
    featureCount,
    fingerprint: buildDatasetSchemaFingerprint({
      aggregation,
      datasetId,
      defaultTargetColumn: targetColumn,
      featureCount,
      metadataColumns,
      repetitionColumn: null,
      sampleCount,
      sourceCount: null,
      targetColumns,
      taskType,
    }),
    id: `${datasetId}:schema`,
    isMultiSource: false,
    metadataColumns,
    repetitionColumn: null,
    representations,
    sampleCount,
    source: "legacy-dataset",
    sourceCount: null,
    targetColumns,
    targetRefs: targetColumn
      ? [{
          column: targetColumn,
          isDefault: true,
          label: targetColumn,
          taskType,
        }]
      : [],
    taskType,
    version: DATASET_SCHEMA_REF_VERSION,
  };
}

export function buildLegacyPlaygroundDataViewInput(
  data: PlaygroundData,
  options: LegacyPlaygroundDataViewOptions = {},
): PlaygroundDataViewInput {
  const schemaRef = buildLegacyPlaygroundSchemaRef(data, options);
  const dataView = getDatasetDefaultDataView(schemaRef) ?? schemaRef.dataViews[0];

  return {
    dataView,
    payload: data,
    schemaRef,
  };
}

export function dataViewInputToLegacyPlaygroundPayload(input: PlaygroundDataViewInput): PlaygroundData {
  return input.payload;
}
