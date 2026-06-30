import { describe, expect, it } from "vitest";

import {
  buildLegacyPlaygroundDataViewInput,
  buildLegacyPlaygroundSchemaRef,
  dataViewInputToLegacyPlaygroundPayload,
} from "@/lib/playground/playgroundDataView";
import type { PlaygroundData } from "@/types/playground";

function playgroundData(overrides: Partial<PlaygroundData> = {}): PlaygroundData {
  return {
    header_unit: "nm",
    metadata: {
      batch: ["a", "b"],
      operator: ["x", "y"],
    },
    sample_ids: ["s1", "s2"],
    wavelengths: [1100, 1200, 1300],
    x: [[1, 2, 3], [4, 5, 6]],
    y: [10, 20],
    ...overrides,
  };
}

describe("playgroundDataView", () => {
  it("builds a schema/data-view contract from the legacy flat playground payload", () => {
    const schemaRef = buildLegacyPlaygroundSchemaRef(playgroundData(), {
      datasetId: "playground:upload",
      datasetName: "Uploaded spectra",
    });

    expect(schemaRef).toMatchObject({
      datasetId: "playground:upload",
      datasetName: "Uploaded spectra",
      defaultTargetColumn: "target",
      featureCount: 3,
      metadataColumns: ["batch", "operator"],
      sampleCount: 2,
      source: "legacy-dataset",
      targetColumns: ["target"],
      taskType: "auto",
    });
    expect(schemaRef.dataViews[0]).toMatchObject({
      datasetId: "playground:upload",
      featureCount: 3,
      metadataColumns: ["batch", "operator"],
      sampleCount: 2,
      targetColumn: "target",
    });
    expect(schemaRef.representations.map((representation) => representation.kind)).toEqual([
      "spectra",
      "targets",
      "metadata",
      "grouping",
    ]);
  });

  it("keeps the backend payload shape unchanged for the current wire contract", () => {
    const data = playgroundData();
    const input = buildLegacyPlaygroundDataViewInput(data);

    expect(input.payload).toBe(data);
    expect(dataViewInputToLegacyPlaygroundPayload(input)).toBe(data);
    expect(dataViewInputToLegacyPlaygroundPayload(input)).toEqual({
      header_unit: "nm",
      metadata: {
        batch: ["a", "b"],
        operator: ["x", "y"],
      },
      sample_ids: ["s1", "s2"],
      wavelengths: [1100, 1200, 1300],
      x: [[1, 2, 3], [4, 5, 6]],
      y: [10, 20],
    });
  });

  it("supports unlabeled data without inventing a target representation", () => {
    const schemaRef = buildLegacyPlaygroundSchemaRef(playgroundData({
      metadata: undefined,
      y: undefined,
    }));

    expect(schemaRef.defaultTargetColumn).toBeNull();
    expect(schemaRef.targetColumns).toEqual([]);
    expect(schemaRef.metadataColumns).toEqual([]);
    expect(schemaRef.dataViews[0].targetColumn).toBeNull();
    expect(schemaRef.dataViews[0].representationIds).toEqual([
      "playground:legacy:representation:spectra",
    ]);
  });
});
