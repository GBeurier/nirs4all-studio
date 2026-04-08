import { describe, expect, it } from "vitest";

import { buildTargetHistogramData } from "./TargetHistogram";

describe("buildTargetHistogramData", () => {
  it("returns backend histogram bins unchanged when provided", () => {
    expect(
      buildTargetHistogramData({
        type: "regression",
        histogram: [{ bin: 1.5, count: 4 }],
      }),
    ).toEqual([{ bin: 1.5, count: 4 }]);
  });

  it("builds classification bars from class counts using declared class order", () => {
    expect(
      buildTargetHistogramData({
        type: "classification",
        classes: ["B", "A", "C"],
        class_counts: {
          A: 7,
          B: 3,
          extra: 1,
        },
      }),
    ).toEqual([
      { bin: "B", count: 3 },
      { bin: "A", count: 7 },
      { bin: "C", count: 0 },
      { bin: "extra", count: 1 },
    ]);
  });
});