import { describe, expect, it } from "vitest";

import { coercePredictionVector } from "../fetchPartitionData";

describe("coercePredictionVector", () => {
  it("keeps one-dimensional prediction arrays", () => {
    expect(coercePredictionVector([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("unwraps single-target matrices", () => {
    expect(coercePredictionVector([[1], [2], [3]])).toEqual([1, 2, 3]);
  });

  it("selects the requested target from multi-target matrices", () => {
    expect(coercePredictionVector([[1, 10], [2, 20]], 1)).toEqual([10, 20]);
  });

  it("defaults multi-target matrices to the first target", () => {
    expect(coercePredictionVector([[1, 10], [2, 20]])).toEqual([1, 2]);
  });

  it("preserves row positions for missing or non-numeric target cells", () => {
    const payload = [[1, 10], [2], [3, "bad" as unknown as number]];
    expect(coercePredictionVector(payload, 1)).toEqual([10, Number.NaN, Number.NaN]);
  });
});
