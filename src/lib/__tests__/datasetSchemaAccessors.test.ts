import { describe, expect, it } from "vitest";

import {
  getDatasetDefaultDataView,
  getDatasetSchemaViewCounts,
} from "@/lib/datasetSchemaAccessors";
import type { DataViewRef, DatasetSchemaRef } from "@/lib/datasetSchema";

function dataView(overrides: Partial<DataViewRef> = {}): DataViewRef {
  return {
    id: "dataset-1:view:default",
    datasetId: "dataset-1",
    label: "Default spectral view",
    source: "legacy-dataset",
    representationIds: ["dataset-1:representation:spectra"],
    targetColumn: "protein",
    taskType: "regression",
    sampleCount: 42,
    featureCount: 128,
    metadataColumns: ["batch"],
    repetitionColumn: null,
    sourceCount: 2,
    ...overrides,
  };
}

function schemaRef(overrides: Partial<DatasetSchemaRef> = {}): DatasetSchemaRef {
  return {
    id: "dataset-1:schema",
    datasetId: "dataset-1",
    datasetName: "Dataset 1",
    version: "studio.dataset-schema.v1",
    source: "legacy-dataset",
    fingerprint: "fingerprint",
    sampleCount: 100,
    featureCount: 256,
    sourceCount: 3,
    isMultiSource: true,
    targetColumns: ["protein"],
    defaultTargetColumn: "protein",
    targetRefs: [],
    taskType: "regression",
    metadataColumns: ["batch"],
    repetitionColumn: null,
    aggregation: {
      enabled: false,
      column: null,
      method: "unknown",
      source: "none",
    },
    axes: [],
    representations: [],
    dataViews: [dataView()],
    defaultDataViewId: "dataset-1:view:default",
    ...overrides,
  };
}

describe("datasetSchemaAccessors", () => {
  it("resolves the default data view from a schema ref", () => {
    const schema = schemaRef({
      dataViews: [
        dataView({ id: "dataset-1:view:alternate", label: "Alternate" }),
        dataView({ id: "dataset-1:view:default", label: "Default" }),
      ],
      defaultDataViewId: "dataset-1:view:default",
    });

    expect(getDatasetDefaultDataView(schema)?.label).toBe("Default");
    expect(getDatasetDefaultDataView(null)).toBeNull();
    expect(getDatasetDefaultDataView(schemaRef({ defaultDataViewId: "missing" }))).toBeNull();
  });

  it("prefers data-view counts over schema counts and falls back to schema counts", () => {
    expect(getDatasetSchemaViewCounts(schemaRef())).toEqual({
      sampleCount: 42,
      featureCount: 128,
      sourceCount: 2,
    });

    expect(getDatasetSchemaViewCounts(
      schemaRef(),
      dataView({ sampleCount: null, featureCount: null, sourceCount: null }),
    )).toEqual({
      sampleCount: 100,
      featureCount: 256,
      sourceCount: 3,
    });

    expect(getDatasetSchemaViewCounts(null)).toEqual({
      sampleCount: null,
      featureCount: null,
      sourceCount: null,
    });
  });
});
