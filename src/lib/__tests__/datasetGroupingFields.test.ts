import { describe, expect, it } from "vitest";

import {
  getDatasetMetadataColumns,
  getDatasetRepetitionColumn,
} from "../datasetGroupingFields";

describe("datasetGroupingFields", () => {
  it("normalizes metadata columns from legacy and frontend dataset payloads", () => {
    expect(getDatasetMetadataColumns({
      metadata_columns: ["batch", "", "batch", "year"],
      metadataColumns: ["ignored"],
    })).toEqual(["batch", "year"]);

    expect(getDatasetMetadataColumns({
      metadataColumns: ["operator", "batch", "operator"],
    })).toEqual(["batch", "operator"]);
  });

  it("normalizes repetition columns using explicit payloads before legacy config fallbacks", () => {
    expect(getDatasetRepetitionColumn({
      repetitionColumn: " sample_id ",
      config: {
        aggregation: { enabled: true, column: "aggregate_id", method: "mean" },
        repetition: "legacy_id",
      },
    })).toBe("sample_id");

    expect(getDatasetRepetitionColumn({
      config: {
        aggregation: { enabled: true, column: " aggregate_id ", method: "median" },
        repetition: "legacy_id",
      },
    })).toBe("aggregate_id");

    expect(getDatasetRepetitionColumn({
      config: {
        aggregation: { enabled: false, column: "aggregate_id", method: "mean" },
        repetition: " legacy_id ",
      },
    })).toBe("legacy_id");
  });

  it("keeps missing or empty grouping fields deterministic", () => {
    expect(getDatasetMetadataColumns(null)).toEqual([]);
    expect(getDatasetRepetitionColumn({
      repetitionColumn: " ",
      config: {
        aggregation: { enabled: true, column: "", method: "vote" },
        repetition: " ",
      },
    })).toBeNull();
  });
});
