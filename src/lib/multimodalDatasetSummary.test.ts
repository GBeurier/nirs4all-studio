import { describe, expect, it } from "vitest";
import { getMultimodalDatasetSummary, isStudioMultimodalDatasetDocument } from "./multimodalDatasetSummary";

const descriptor = {
  schema: "nirs4all.studio-multimodal-dataset.v1",
  cohort: {
    schema: "nirs4all.multimodal-dataset", schema_version: 1,
    sample_ids: ["s2", "s1", "s3"], source_alignment: "left",
    task_type: "regression", target_names: ["protein"],
    partitions: { dtype: "object", shape: [3], values: ["train", "test", "predict"] },
    sources: [
      { name: "nir", sample_ids: ["s2", "s1", "s3"], representation_id: "signal_1d", array: { shape: [3, 12] },
        presence_mask: { values: [true, true, true] } },
      { name: "series", sample_ids: ["s2", "s1", "s3"], representation_id: "series_mv", source_kind: "ragged_series",
        array: { shape: [7, 2] }, presence_mask: { values: [true, false, true] } },
    ],
  },
};

describe("multimodal dataset overview", () => {
  it("reports declared source shapes and missing masks without flattening ragged data", () => {
    expect(getMultimodalDatasetSummary(descriptor)).toEqual({
      samples: 3, alignment: "left", task: "regression", targets: ["protein"],
      partitions: { train: 1, test: 1, predict: 1 },
      sources: [
        { name: "nir", representation: "signal_1d", shape: [3, 12], present: 3, missing: 0, ragged: false },
        { name: "series", representation: "series_mv", shape: [7, 2], present: 2, missing: 1, ragged: true },
      ],
    });
  });

  it("does not present unknown or inconsistent documents as a typed cohort", () => {
    expect(getMultimodalDatasetSummary({ ...descriptor, schema: "wrong" })).toBeNull();
    const invalid = structuredClone(descriptor);
    invalid.cohort.sources[1].presence_mask.values = [true];
    expect(getMultimodalDatasetSummary(invalid)).toBeNull();
    expect(isStudioMultimodalDatasetDocument(invalid)).toBe(true);
  });

  it("counts sparse left-aligned source rows and omitted masks from source IDs", () => {
    const sparse = structuredClone(descriptor);
    sparse.cohort.sources[1].sample_ids = ["s2", "s3"];
    sparse.cohort.sources[1].presence_mask.values = [true, false];
    expect(getMultimodalDatasetSummary(sparse)?.sources[1]).toMatchObject({ present: 1, missing: 2 });
    expect(getMultimodalDatasetSummary({ ...sparse, cohort: { ...sparse.cohort, source_alignment: "strict" } })).toBeNull();
    const withoutMask = { ...sparse, cohort: { ...sparse.cohort, sources: [
      sparse.cohort.sources[0],
      { ...sparse.cohort.sources[1], presence_mask: undefined },
    ] } };
    expect(getMultimodalDatasetSummary(withoutMask)?.sources[1]).toMatchObject({ present: 2, missing: 1 });
  });
});
