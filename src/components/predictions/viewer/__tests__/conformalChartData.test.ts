import { describe, expect, it } from "vitest";

import { attachConformalIntervalsToSingleDataset } from "../conformalChartData";
import type { ConformalPredictionRow } from "@/ui/conformal";
import type { PartitionDataset } from "../types";

function dataset(overrides: Partial<PartitionDataset> = {}): PartitionDataset {
  return {
    predictionId: "pred-1",
    partition: "test",
    label: "Test",
    yTrue: [1, 2],
    yPred: [1.2, 1.8],
    nSamples: 2,
    ...overrides,
  };
}

const rows: ConformalPredictionRow[] = [
  {
    index: 0,
    intervals: [
      {
        coverage: 0.8,
        coverageLabel: "80%",
        lower: 0.8,
        lowerLabel: "0.8000",
        upper: 1.6,
        upperLabel: "1.6000",
        width: 0.8,
        widthLabel: "0.8000",
      },
      {
        coverage: 0.95,
        coverageLabel: "95%",
        lower: 0.5,
        lowerLabel: "0.5000",
        upper: 1.9,
        upperLabel: "1.9000",
        width: 1.4,
        widthLabel: "1.4000",
      },
    ],
    sampleId: "a",
    yPred: 1.2,
    yPredLabel: "1.2000",
  },
  {
    index: 1,
    intervals: [
      {
        coverage: 0.8,
        coverageLabel: "80%",
        lower: 1.4,
        lowerLabel: "1.4000",
        upper: 2.2,
        upperLabel: "2.2000",
        width: 0.8,
        widthLabel: "0.8000",
      },
    ],
    sampleId: "b",
    yPred: 1.8,
    yPredLabel: "1.8000",
  },
];

describe("conformalChartData", () => {
  it("attaches selected conformal intervals only when chart association is unambiguous", () => {
    expect(attachConformalIntervalsToSingleDataset([dataset()], rows, 0.8)).toEqual([
      expect.objectContaining({
        conformalCoverage: 0.8,
        conformalCoverageLabel: "80%",
        conformalIntervals: [
          { coverage: 0.8, coverageLabel: "80%", lower: 0.8, upper: 1.6 },
          { coverage: 0.8, coverageLabel: "80%", lower: 1.4, upper: 2.2 },
        ],
      }),
    ]);

    const ambiguous = [dataset({ predictionId: "pred-1" }), dataset({ predictionId: "pred-2" })];
    expect(attachConformalIntervalsToSingleDataset(ambiguous, rows, 0.8)).toEqual(ambiguous);
    expect(attachConformalIntervalsToSingleDataset([dataset({ yTrue: [1], yPred: [1.2], nSamples: 1 })], rows, 0.8))
      .toEqual([dataset({ yTrue: [1], yPred: [1.2], nSamples: 1 })]);
  });
});
