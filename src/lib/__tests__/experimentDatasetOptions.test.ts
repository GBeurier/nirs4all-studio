import { describe, expect, it } from "vitest";

import type { Dataset } from "@/types/datasets";
import { DATASET_SCHEMA_REF_VERSION } from "@/lib/datasetSchema";
import { toExperimentDatasetOption } from "@/lib/experimentDatasetOptions";

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "dataset-1",
    name: "Corn",
    path: "/data/corn",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 42,
    num_features: 128,
    default_target: "protein",
    metadata_columns: ["fold", "batch"],
    config: {
      delimiter: ",",
      decimal_separator: ".",
      has_header: true,
      repetition: "sample_id",
    },
    ...overrides,
  };
}

describe("experimentDatasetOptions", () => {
  it("maps dataset API payloads into experiment options", () => {
    const datasetOption = toExperimentDatasetOption(dataset());

    expect(datasetOption).toMatchObject({
      id: "dataset-1",
      name: "Corn",
      samples: 42,
      features: 128,
      sourceCount: 1,
      isMultiSource: false,
      representationCount: 4,
      dataViewLabel: "Default spectral view",
      dataViewTaskType: "unknown",
      target: "protein",
      targetCount: 1,
      metadataColumns: ["batch", "fold"],
      repetitionColumn: "sample_id",
      aggregationLabel: null,
    });
    expect(datasetOption.schemaRef).toMatchObject({
      id: "dataset-1:schema",
      datasetId: "dataset-1",
      version: DATASET_SCHEMA_REF_VERSION,
      source: "legacy-dataset",
      sampleCount: 42,
      featureCount: 128,
      sourceCount: 1,
      defaultTargetColumn: "protein",
      metadataColumns: ["batch", "fold"],
      repetitionColumn: "sample_id",
      defaultDataViewId: "dataset-1:view:default",
    });
  });

  it("projects dataset aggregation labels into experiment options", () => {
    expect(toExperimentDatasetOption(dataset({
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        repetition: "sample_id",
        aggregation: {
          enabled: true,
          column: "sample_id",
          method: "mean",
        },
      },
    })).aggregationLabel).toBe("Aggregation: mean by sample_id");
  });
});
