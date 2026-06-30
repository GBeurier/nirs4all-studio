import { describe, expect, it } from "vitest";

import {
  buildDatasetAxes,
  buildDatasetRepresentationPreviews,
  buildDatasetSchemaViewProjection,
  buildDefaultDatasetDataView,
} from "../datasetSchemaViews";

describe("datasetSchemaViews", () => {
  it("builds representation previews with availability derived from legacy schema counts", () => {
    expect(buildDatasetRepresentationPreviews({
      datasetId: "corn",
      sampleCount: 42,
      featureCount: 128,
      targetCount: 2,
      metadataColumnCount: 1,
      sourceCount: 2,
      repetitionColumn: "sample_id",
    }).map((representation) => ({
      id: representation.id,
      kind: representation.kind,
      available: representation.available,
      sampleCount: representation.sampleCount,
      featureCount: representation.featureCount,
      targetCount: representation.targetCount,
      metadataColumnCount: representation.metadataColumnCount,
      sourceCount: representation.sourceCount,
    }))).toEqual([
      {
        id: "corn:representation:spectra",
        kind: "spectra",
        available: true,
        sampleCount: 42,
        featureCount: 128,
        targetCount: null,
        metadataColumnCount: null,
        sourceCount: 2,
      },
      {
        id: "corn:representation:targets",
        kind: "targets",
        available: true,
        sampleCount: 42,
        featureCount: null,
        targetCount: 2,
        metadataColumnCount: null,
        sourceCount: null,
      },
      {
        id: "corn:representation:metadata",
        kind: "metadata",
        available: true,
        sampleCount: 42,
        featureCount: null,
        targetCount: null,
        metadataColumnCount: 1,
        sourceCount: null,
      },
      {
        id: "corn:representation:grouping",
        kind: "grouping",
        available: true,
        sampleCount: 42,
        featureCount: null,
        targetCount: null,
        metadataColumnCount: 1,
        sourceCount: null,
      },
    ]);
  });

  it("keeps unavailable sparse representations deterministic", () => {
    expect(buildDatasetRepresentationPreviews({
      datasetId: "sparse",
      sampleCount: null,
      featureCount: null,
      targetCount: 0,
      metadataColumnCount: 0,
      sourceCount: 1,
      repetitionColumn: null,
    }).map((representation) => representation.available)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("builds schema axes for sample, feature, target, metadata, and source dimensions", () => {
    expect(buildDatasetAxes({
      datasetId: "corn",
      sampleCount: 42,
      featureCount: 128,
      targetCount: 2,
      metadataColumnCount: 1,
      sourceCount: 2,
    })).toEqual([
      { id: "corn:axis:samples", kind: "sample", label: "Samples", size: 42 },
      { id: "corn:axis:features", kind: "feature", label: "Features", size: 128 },
      { id: "corn:axis:targets", kind: "target", label: "Targets", size: 2 },
      { id: "corn:axis:metadata", kind: "metadata", label: "Metadata", size: 1 },
      { id: "corn:axis:sources", kind: "source", label: "Sources", size: 2 },
    ]);
  });

  it("builds default data views from available representations", () => {
    const representations = buildDatasetRepresentationPreviews({
      datasetId: "corn",
      sampleCount: 42,
      featureCount: 128,
      targetCount: 2,
      metadataColumnCount: 0,
      sourceCount: 2,
      repetitionColumn: null,
    });

    expect(buildDefaultDatasetDataView({
      datasetId: "corn",
      defaultDataViewId: "corn:view:default",
      representations,
      defaultTargetColumn: "protein",
      taskType: "regression",
      sampleCount: 42,
      featureCount: 128,
      metadataColumns: [],
      repetitionColumn: null,
      sourceCount: 2,
    })).toEqual({
      id: "corn:view:default",
      datasetId: "corn",
      label: "Default spectral view",
      source: "legacy-dataset",
      representationIds: [
        "corn:representation:spectra",
        "corn:representation:targets",
      ],
      targetColumn: "protein",
      taskType: "regression",
      sampleCount: 42,
      featureCount: 128,
      metadataColumns: [],
      repetitionColumn: null,
      sourceCount: 2,
    });
  });

  it("builds the full schema view projection consumed by dataset schema refs", () => {
    const projection = buildDatasetSchemaViewProjection({
      datasetId: "corn",
      sampleCount: 42,
      featureCount: 128,
      targetCount: 1,
      defaultTargetColumn: "protein",
      taskType: "regression",
      metadataColumns: ["batch"],
      repetitionColumn: "sample_id",
      sourceCount: 2,
    });

    expect(projection.defaultDataViewId).toBe("corn:view:default");
    expect(projection.axes).toHaveLength(5);
    expect(projection.representations).toHaveLength(4);
    expect(projection.dataViews).toEqual([
      expect.objectContaining({
        id: "corn:view:default",
        targetColumn: "protein",
        representationIds: [
          "corn:representation:spectra",
          "corn:representation:targets",
          "corn:representation:metadata",
          "corn:representation:grouping",
        ],
      }),
    ]);
  });
});
