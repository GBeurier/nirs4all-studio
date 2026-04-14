import { describe, expect, it } from "vitest";

import {
  getColumnarMetadata,
  getRepeatIndexColumnWarning,
  getSampleIdsFromMetadata,
  getSpectralRepetitionColumn,
  hasSpectralRepetitionGroups,
  isLikelyRepeatIndexColumnName,
} from "../playground/repetition";

describe("playground repetition helpers", () => {
  it("prefers the explicit dataset repetition column when present", () => {
    expect(getSpectralRepetitionColumn({
      repetitionColumn: "sample_group",
      metadata: [
        { sample_group: "A", sample_id: "s1" },
        { sample_group: "A", sample_id: "s2" },
      ],
    })).toBe("sample_group");
  });

  it("falls back to likely bio sample metadata columns", () => {
    expect(getSpectralRepetitionColumn({
      metadata: [
        { bio_sample_id: "A", replicate: 1 },
        { bio_sample_id: "A", replicate: 2 },
      ],
    })).toBe("bio_sample_id");
  });

  it("prefers repeated bio-sample columns over unique sample identifiers", () => {
    expect(getSpectralRepetitionColumn({
      metadata: [
        { sample_id: "s1", bio_sample: "A", repetition: 1 },
        { sample_id: "s2", bio_sample: "A", repetition: 2 },
        { sample_id: "s3", bio_sample: "B", repetition: 1 },
      ],
    })).toBe("bio_sample");
  });

  it("detects usable repetitions from the configured grouping column only", () => {
    expect(hasSpectralRepetitionGroups({
      repetitionColumn: "sample_group",
      metadata: [
        { sample_group: "A", batch: "B1" },
        { sample_group: "A", batch: "B2" },
        { sample_group: "B", batch: "B1" },
      ],
    })).toBe(true);

    expect(hasSpectralRepetitionGroups({
      metadata: [
        { batch: "B1" },
        { batch: "B1" },
        { batch: "B2" },
      ],
    })).toBe(false);
  });

  it("can infer sample ids from metadata columns", () => {
    expect(getSampleIdsFromMetadata([
      { sample_id: "s1", sample_group: "A" },
      { sample_id: "s2", sample_group: "A" },
    ])).toEqual(["s1", "s2"]);
  });

  it("converts row metadata into a columnar payload", () => {
    expect(getColumnarMetadata([
      { sample_group: "A", batch: "B1" },
      { sample_group: "A", batch: "B2", note: "late" },
    ])).toEqual({
      sample_group: ["A", "A"],
      batch: ["B1", "B2"],
      note: [undefined, "late"],
    });
  });

  it("warns for repetition counter column names", () => {
    expect(isLikelyRepeatIndexColumnName("Replicate")).toBe(true);
    expect(getRepeatIndexColumnWarning("Replicate")).toContain("repetition counter");
    expect(isLikelyRepeatIndexColumnName("sample_id")).toBe(false);
    expect(getRepeatIndexColumnWarning("sample_id")).toBeNull();
  });
});
