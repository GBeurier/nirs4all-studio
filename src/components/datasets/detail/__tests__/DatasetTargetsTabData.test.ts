import { describe, expect, it } from "vitest";
import {
  formatClassPercentage,
  formatTargetStatistic,
  getClassCountTotal,
  getDatasetTargetSampleCounts,
  getEffectiveTargetDistribution,
  getEffectiveTargetPartition,
  getRegressionThreeSigmaRange,
  hasDatasetTargets,
  hasTargetTestPartition,
} from "../DatasetTargetsTabData";
import type { TargetDistribution } from "@/types/datasets";

const trainDistribution: TargetDistribution = {
  type: "regression",
  n_samples: 80,
  min: 1,
  max: 4,
};

const testDistribution: TargetDistribution = {
  type: "regression",
  n_samples: 20,
  min: 2,
  max: 3,
};

const allDistribution: TargetDistribution = {
  type: "regression",
  n_samples: 100,
  min: 1,
  max: 4,
};

describe("DatasetTargetsTabData", () => {
  it("detects configured targets", () => {
    expect(hasDatasetTargets({ targets: [{ column: "protein", type: "regression" }] })).toBe(true);
    expect(hasDatasetTargets({ targets: [] })).toBe(false);
    expect(hasDatasetTargets({})).toBe(false);
  });

  it("reads target train and test counts from preview summary", () => {
    expect(
      getDatasetTargetSampleCounts({
        summary: {
          num_samples: 100,
          num_features: 12,
          n_sources: 1,
          train_samples: 80,
          test_samples: 20,
          has_targets: true,
          has_metadata: false,
        },
      }),
    ).toEqual({ trainCount: 80, testCount: 20 });

    expect(getDatasetTargetSampleCounts(null)).toEqual({ trainCount: undefined, testCount: undefined });
  });

  it("uses train as the effective partition when no test partition exists", () => {
    expect(getEffectiveTargetPartition("all", false)).toBe("train");
    expect(getEffectiveTargetPartition("test", false)).toBe("train");
    expect(getEffectiveTargetPartition("train", false)).toBe("train");
    expect(getEffectiveTargetPartition("all", true)).toBe("all");
    expect(getEffectiveTargetPartition("test", true)).toBe("test");
  });

  it("detects test availability from partition data or sample counts", () => {
    expect(hasTargetTestPartition({ test: testDistribution }, 0)).toBe(true);
    expect(hasTargetTestPartition(undefined, 1)).toBe(true);
    expect(hasTargetTestPartition({ train: trainDistribution }, 0)).toBe(false);
    expect(hasTargetTestPartition(undefined, undefined)).toBe(false);
  });

  it("resolves target distribution with partition fallback to train or all preview", () => {
    expect(
      getEffectiveTargetDistribution(
        {
          target_distribution: allDistribution,
          target_distribution_by_partition: {
            train: trainDistribution,
            test: testDistribution,
          },
        },
        "all",
      ),
    ).toBe(trainDistribution);

    expect(
      getEffectiveTargetDistribution(
        {
          target_distribution: allDistribution,
          target_distribution_by_partition: {},
        },
        "train",
      ),
    ).toBe(allDistribution);

    expect(
      getEffectiveTargetDistribution(
        {
          target_distribution: allDistribution,
        },
        "test",
      ),
    ).toBe(allDistribution);
  });

  it("formats regression statistics without hiding zero values", () => {
    expect(formatTargetStatistic(0)).toBe("0.000");
    expect(formatTargetStatistic(1.23456)).toBe("1.235");
    expect(formatTargetStatistic(undefined)).toBe("--");
    expect(formatTargetStatistic(Number.NaN)).toBe("--");
  });

  it("calculates class count totals and percentages", () => {
    const classCounts = { A: 2, B: 6, C: 0 };

    expect(getClassCountTotal(classCounts)).toBe(8);
    expect(formatClassPercentage(2, classCounts)).toBe("25.0");
    expect(formatClassPercentage(0, classCounts)).toBe("0.0");
    expect(formatClassPercentage(1, {})).toBe("0.0");
  });

  it("builds regression +/-3 sigma range visibility and label", () => {
    expect(getRegressionThreeSigmaRange({ mean: 10, std: 2 })).toEqual({
      isVisible: true,
      label: "4.00 to 16.00",
    });

    expect(getRegressionThreeSigmaRange({ mean: 0, std: 0 })).toEqual({
      isVisible: true,
      label: "0.00 to 0.00",
    });

    expect(getRegressionThreeSigmaRange({ mean: undefined, std: 2 })).toEqual({
      isVisible: false,
      label: "",
    });
  });
});
