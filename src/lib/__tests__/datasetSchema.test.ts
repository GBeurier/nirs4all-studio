import { describe, expect, it } from "vitest";

import type { Dataset } from "@/types/datasets";

import {
  buildDatasetSchemaRef,
  DATASET_SCHEMA_REF_VERSION,
  summarizeDatasetSchemaRef,
} from "../datasetSchema";

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "corn",
    name: "Corn",
    path: "/data/corn.csv",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 42,
    num_features: 128,
    n_sources: 2,
    hash: "hash-1",
    task_type: "regression",
    default_target: "protein",
    metadata_columns: ["operator", "batch", "batch"],
    targets: [
      {
        column: "protein",
        type: "regression",
        unit: "%",
        label: "Protein",
      },
      {
        column: "moisture",
        type: "regression",
        unit: "%",
      },
    ],
    config: {
      delimiter: ",",
      decimal_separator: ".",
      has_header: true,
      repetition: "sample_id",
    },
    ...overrides,
  };
}

describe("datasetSchema", () => {
  it("builds a stable schema ref around a legacy dataset payload", () => {
    const schema = buildDatasetSchemaRef(dataset());

    expect(schema).toMatchObject({
      id: "corn:schema",
      datasetId: "corn",
      datasetName: "Corn",
      version: DATASET_SCHEMA_REF_VERSION,
      source: "legacy-dataset",
      fingerprint: "dataset:hash-1",
      sampleCount: 42,
      featureCount: 128,
      sourceCount: 2,
      isMultiSource: true,
      targetColumns: ["protein", "moisture"],
      defaultTargetColumn: "protein",
      taskType: "regression",
      metadataColumns: ["batch", "operator"],
      repetitionColumn: "sample_id",
      aggregation: {
        enabled: false,
        column: null,
        method: "unknown",
        source: "none",
      },
      defaultDataViewId: "corn:view:default",
    });
    expect(schema.targetRefs).toEqual([
      {
        column: "protein",
        label: "Protein",
        taskType: "regression",
        unit: "%",
        isDefault: true,
      },
      {
        column: "moisture",
        label: "moisture",
        taskType: "regression",
        unit: "%",
        isDefault: false,
      },
    ]);
    expect(schema.axes).toEqual([
      {
        id: "corn:axis:samples",
        kind: "sample",
        label: "Samples",
        size: 42,
      },
      {
        id: "corn:axis:features",
        kind: "feature",
        label: "Features",
        size: 128,
      },
      {
        id: "corn:axis:targets",
        kind: "target",
        label: "Targets",
        size: 2,
      },
      {
        id: "corn:axis:metadata",
        kind: "metadata",
        label: "Metadata",
        size: 2,
      },
      {
        id: "corn:axis:sources",
        kind: "source",
        label: "Sources",
        size: 2,
      },
    ]);
    expect(schema.representations.map((representation) => ({
      kind: representation.kind,
      available: representation.available,
    }))).toEqual([
      { kind: "spectra", available: true },
      { kind: "targets", available: true },
      { kind: "metadata", available: true },
      { kind: "grouping", available: true },
    ]);
    expect(schema.dataViews).toEqual([
      {
        id: "corn:view:default",
        datasetId: "corn",
        label: "Default spectral view",
        source: "legacy-dataset",
        representationIds: [
          "corn:representation:spectra",
          "corn:representation:targets",
          "corn:representation:metadata",
          "corn:representation:grouping",
        ],
        targetColumn: "protein",
        taskType: "regression",
        sampleCount: 42,
        featureCount: 128,
        metadataColumns: ["batch", "operator"],
        repetitionColumn: "sample_id",
        sourceCount: 2,
      },
    ]);
    expect(summarizeDatasetSchemaRef(schema)).toEqual({
      sampleCount: 42,
      featureCount: 128,
      targetLabel: "protein",
      metadataColumnCount: 2,
      repetitionColumn: "sample_id",
    });
  });

  it("keeps sparse legacy payloads deterministic without inventing unavailable views", () => {
    const sparseDataset = dataset({
      id: "sparse",
      name: "Sparse",
      hash: undefined,
      num_samples: undefined,
      num_features: undefined,
      n_sources: undefined,
      is_multi_source: false,
      task_type: undefined,
      default_target: undefined,
      metadata_columns: undefined,
      targets: undefined,
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
      },
    });

    const schema = buildDatasetSchemaRef(sparseDataset);
    const rebuiltSchema = buildDatasetSchemaRef(sparseDataset);

    expect(schema.fingerprint).toMatch(/^legacy:/);
    expect(rebuiltSchema.fingerprint).toBe(schema.fingerprint);
    expect(schema).toMatchObject({
      sampleCount: null,
      featureCount: null,
      sourceCount: 1,
      isMultiSource: false,
      targetColumns: [],
      defaultTargetColumn: null,
      taskType: "unknown",
      metadataColumns: [],
      repetitionColumn: null,
      aggregation: {
        enabled: false,
        column: null,
        method: "unknown",
        source: "none",
      },
    });
    expect(schema.representations.map((representation) => representation.available)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(schema.dataViews[0]).toMatchObject({
      targetColumn: null,
      representationIds: [],
    });
  });

  it("projects aggregation configuration into schema refs", () => {
    const schema = buildDatasetSchemaRef(dataset({
      hash: undefined,
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        aggregation: {
          enabled: true,
          column: "sample_id",
          method: "mean",
        },
      },
    }));

    expect(schema.aggregation).toEqual({
      enabled: true,
      column: "sample_id",
      method: "mean",
      source: "config",
    });
    expect(schema.fingerprint).toMatch(/^legacy:/);
  });

  it("uses a target marked as default when no explicit default is present", () => {
    const schema = buildDatasetSchemaRef(dataset({
      default_target: undefined,
      targets: undefined,
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        targets: [
          {
            column: "protein",
            type: "regression",
          },
          {
            column: "moisture",
            type: "regression",
            is_default: true,
          },
        ],
      },
    }));

    expect(schema.defaultTargetColumn).toBe("moisture");
    expect(schema.targetRefs).toMatchObject([
      { column: "protein", isDefault: false },
      { column: "moisture", isDefault: true },
    ]);
  });
});
