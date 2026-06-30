import type {
  DataViewRef,
  DatasetAxisRef,
  DatasetSchemaTaskType,
  RepresentationPreview,
} from "./datasetSchema";

export interface DatasetSchemaViewProjectionInput {
  datasetId: string;
  sampleCount: number | null;
  featureCount: number | null;
  targetCount: number;
  defaultTargetColumn: string | null;
  taskType: DatasetSchemaTaskType;
  metadataColumns: string[];
  repetitionColumn: string | null;
  sourceCount: number | null;
}

export interface DatasetSchemaViewProjection {
  axes: DatasetAxisRef[];
  representations: RepresentationPreview[];
  dataViews: DataViewRef[];
  defaultDataViewId: string;
}

export function buildDatasetRepresentationPreviews({
  datasetId,
  sampleCount,
  featureCount,
  targetCount,
  metadataColumnCount,
  sourceCount,
  repetitionColumn,
}: {
  datasetId: string;
  sampleCount: number | null;
  featureCount: number | null;
  targetCount: number;
  metadataColumnCount: number;
  sourceCount: number | null;
  repetitionColumn: string | null;
}): RepresentationPreview[] {
  return [
    {
      id: `${datasetId}:representation:spectra`,
      datasetId,
      kind: "spectra",
      label: "Spectral matrix",
      available: featureCount !== null,
      sampleCount,
      featureCount,
      targetCount: null,
      metadataColumnCount: null,
      sourceCount,
    },
    {
      id: `${datasetId}:representation:targets`,
      datasetId,
      kind: "targets",
      label: "Targets",
      available: targetCount > 0,
      sampleCount,
      featureCount: null,
      targetCount,
      metadataColumnCount: null,
      sourceCount: null,
    },
    {
      id: `${datasetId}:representation:metadata`,
      datasetId,
      kind: "metadata",
      label: "Metadata",
      available: metadataColumnCount > 0,
      sampleCount,
      featureCount: null,
      targetCount: null,
      metadataColumnCount,
      sourceCount: null,
    },
    {
      id: `${datasetId}:representation:grouping`,
      datasetId,
      kind: "grouping",
      label: "Grouping",
      available: Boolean(repetitionColumn),
      sampleCount,
      featureCount: null,
      targetCount: null,
      metadataColumnCount: repetitionColumn ? 1 : 0,
      sourceCount: null,
    },
  ];
}

export function buildDatasetAxes({
  datasetId,
  sampleCount,
  featureCount,
  targetCount,
  metadataColumnCount,
  sourceCount,
}: {
  datasetId: string;
  sampleCount: number | null;
  featureCount: number | null;
  targetCount: number;
  metadataColumnCount: number;
  sourceCount: number | null;
}): DatasetAxisRef[] {
  return [
    {
      id: `${datasetId}:axis:samples`,
      kind: "sample",
      label: "Samples",
      size: sampleCount,
    },
    {
      id: `${datasetId}:axis:features`,
      kind: "feature",
      label: "Features",
      size: featureCount,
    },
    {
      id: `${datasetId}:axis:targets`,
      kind: "target",
      label: "Targets",
      size: targetCount,
    },
    {
      id: `${datasetId}:axis:metadata`,
      kind: "metadata",
      label: "Metadata",
      size: metadataColumnCount,
    },
    {
      id: `${datasetId}:axis:sources`,
      kind: "source",
      label: "Sources",
      size: sourceCount,
    },
  ];
}

export function buildDefaultDatasetDataView({
  datasetId,
  defaultDataViewId,
  representations,
  defaultTargetColumn,
  taskType,
  sampleCount,
  featureCount,
  metadataColumns,
  repetitionColumn,
  sourceCount,
}: {
  datasetId: string;
  defaultDataViewId: string;
  representations: RepresentationPreview[];
  defaultTargetColumn: string | null;
  taskType: DatasetSchemaTaskType;
  sampleCount: number | null;
  featureCount: number | null;
  metadataColumns: string[];
  repetitionColumn: string | null;
  sourceCount: number | null;
}): DataViewRef {
  return {
    id: defaultDataViewId,
    datasetId,
    label: "Default spectral view",
    source: "legacy-dataset",
    representationIds: representations
      .filter((representation) => representation.available)
      .map((representation) => representation.id),
    targetColumn: defaultTargetColumn,
    taskType,
    sampleCount,
    featureCount,
    metadataColumns,
    repetitionColumn,
    sourceCount,
  };
}

export function buildDatasetSchemaViewProjection({
  datasetId,
  sampleCount,
  featureCount,
  targetCount,
  defaultTargetColumn,
  taskType,
  metadataColumns,
  repetitionColumn,
  sourceCount,
}: DatasetSchemaViewProjectionInput): DatasetSchemaViewProjection {
  const metadataColumnCount = metadataColumns.length;
  const representations = buildDatasetRepresentationPreviews({
    datasetId,
    sampleCount,
    featureCount,
    targetCount,
    metadataColumnCount,
    sourceCount,
    repetitionColumn,
  });
  const defaultDataViewId = `${datasetId}:view:default`;
  const defaultDataView = buildDefaultDatasetDataView({
    datasetId,
    defaultDataViewId,
    representations,
    defaultTargetColumn,
    taskType,
    sampleCount,
    featureCount,
    metadataColumns,
    repetitionColumn,
    sourceCount,
  });
  const axes = buildDatasetAxes({
    datasetId,
    sampleCount,
    featureCount,
    targetCount,
    metadataColumnCount,
    sourceCount,
  });

  return {
    axes,
    representations,
    dataViews: [defaultDataView],
    defaultDataViewId,
  };
}
