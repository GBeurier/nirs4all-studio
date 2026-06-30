import type {
  DatasetSchemaRef,
  DatasetSchemaSummary,
} from "./datasetSchema";

export function summarizeDatasetSchemaRef(schema: DatasetSchemaRef): DatasetSchemaSummary {
  return {
    sampleCount: schema.sampleCount,
    featureCount: schema.featureCount,
    targetLabel: schema.defaultTargetColumn,
    metadataColumnCount: schema.metadataColumns.length,
    repetitionColumn: schema.repetitionColumn,
  };
}
