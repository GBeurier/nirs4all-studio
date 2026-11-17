import { describe, expect, it } from "vitest";

import {
  buildDatasetSourceOptions,
  buildPlaygroundTargetChoices,
} from "@/lib/playground/datasetSelectionOptions";
import type { Dataset } from "@/types/datasets";

function dataset(fields: Partial<Dataset>): Dataset {
  return { id: "dataset-a", name: "A", path: "/data/a", linked_at: "", ...fields } as Dataset;
}

describe("playground dataset selection options", () => {
  it("maps multi-source datasets to zero-based source indexes", () => {
    expect(buildDatasetSourceOptions(3)).toEqual([
      { value: "0", label: "Source 1" },
      { value: "1", label: "Source 2" },
      { value: "2", label: "Source 3" },
    ]);
  });

  it("lists every target in backend order with its missing-value count and the saved default", () => {
    expect(buildPlaygroundTargetChoices(dataset({
      default_target: "moisture",
      targets: [
        { column: "protein", type: "regression", label: "Protein", missing_count: 0 },
        { column: "moisture", type: "regression", missing_count: 12 },
        { column: "starch", type: "regression" },
      ],
    }))).toEqual({
      choices: [
        { index: 0, column: "protein", label: "Protein", missing: 0 },
        { index: 1, column: "moisture", label: "moisture", missing: 12 },
        { index: 2, column: "starch", label: "starch", missing: null },
      ],
      defaultIndex: 1,
    });
  });

  it("falls back to the first target when no default is saved", () => {
    expect(buildPlaygroundTargetChoices(dataset({
      targets: [{ column: "protein", type: "regression" }],
    })).defaultIndex).toBe(0);
    expect(buildPlaygroundTargetChoices(dataset({ targets: [] }))).toEqual({ choices: [], defaultIndex: 0 });
  });
});
