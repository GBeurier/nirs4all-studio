import type {
  DataViewRef,
  DatasetSchemaRef,
} from "./datasetSchema";

export interface DatasetSchemaViewCounts {
  sampleCount: number | null;
  featureCount: number | null;
  sourceCount: number | null;
}

export function getDatasetDefaultDataView(
  schemaRef: DatasetSchemaRef | null | undefined,
): DataViewRef | null {
  return schemaRef?.dataViews.find((view) => view.id === schemaRef.defaultDataViewId) ?? null;
}

export function getDatasetSchemaViewCounts(
  schemaRef: DatasetSchemaRef | null | undefined,
  dataView: DataViewRef | null | undefined = getDatasetDefaultDataView(schemaRef),
): DatasetSchemaViewCounts {
  return {
    sampleCount: dataView?.sampleCount ?? schemaRef?.sampleCount ?? null,
    featureCount: dataView?.featureCount ?? schemaRef?.featureCount ?? null,
    sourceCount: dataView?.sourceCount ?? schemaRef?.sourceCount ?? null,
  };
}
