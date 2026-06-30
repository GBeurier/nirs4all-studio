import { describe, expect, it } from "vitest";

import {
  buildDatasetSourceOptions,
  buildDatasetTargetOptions,
} from "@/lib/playground/datasetSelectionOptions";

describe("playground dataset selection options", () => {
  it("maps multi-source datasets to zero-based source indexes", () => {
    expect(buildDatasetSourceOptions(3)).toEqual([
      { value: "0", label: "Source 1" },
      { value: "1", label: "Source 2" },
      { value: "2", label: "Source 3" },
    ]);
  });

  it("maps target refs to zero-based target indexes and display labels", () => {
    expect(buildDatasetTargetOptions({
      targetColumns: ["protein", "moisture"],
      targetRefs: [
        { column: "protein", label: "Protein", taskType: "regression", isDefault: true },
        { column: "moisture", label: "Moisture", taskType: "regression", isDefault: false },
      ],
    })).toEqual([
      { value: "0", label: "Protein" },
      { value: "1", label: "Moisture" },
    ]);
  });

  it("falls back to target column names when target refs are absent", () => {
    expect(buildDatasetTargetOptions({
      targetColumns: ["protein", "moisture"],
      targetRefs: [],
    })).toEqual([
      { value: "0", label: "protein" },
      { value: "1", label: "moisture" },
    ]);
  });
});
