import { describe, expect, it } from "vitest";

import { summarizeDatasetSchemaRef } from "../datasetSchemaSummary";
import type { DatasetSchemaRef } from "../datasetSchema";

function schema(overrides: Partial<DatasetSchemaRef> = {}): DatasetSchemaRef {
  return {
    id: "corn:schema",
    datasetId: "corn",
    datasetName: "Corn",
    version: "studio.dataset-schema.v1",
    source: "legacy-dataset",
    fingerprint: "dataset:hash-1",
    sampleCount: 42,
    featureCount: 128,
    sourceCount: 2,
    isMultiSource: true,
    targetColumns: ["protein"],
    defaultTargetColumn: "protein",
    targetRefs: [],
    taskType: "regression",
    metadataColumns: ["batch", "operator"],
    repetitionColumn: "sample_id",
    aggregation: {
      enabled: false,
      column: null,
      method: "unknown",
      source: "none",
    },
    axes: [],
    representations: [],
    dataViews: [],
    defaultDataViewId: "corn:view:default",
    ...overrides,
  };
}

describe("datasetSchemaSummary", () => {
  it("summarizes dataset schema refs for campaign-facing fallbacks", () => {
    expect(summarizeDatasetSchemaRef(schema())).toEqual({
      sampleCount: 42,
      featureCount: 128,
      targetLabel: "protein",
      metadataColumnCount: 2,
      repetitionColumn: "sample_id",
    });
  });

  it("preserves unknown counts and missing target/repetition values", () => {
    expect(summarizeDatasetSchemaRef(schema({
      sampleCount: null,
      featureCount: null,
      defaultTargetColumn: null,
      metadataColumns: [],
      repetitionColumn: null,
    }))).toEqual({
      sampleCount: null,
      featureCount: null,
      targetLabel: null,
      metadataColumnCount: 0,
      repetitionColumn: null,
    });
  });
});
