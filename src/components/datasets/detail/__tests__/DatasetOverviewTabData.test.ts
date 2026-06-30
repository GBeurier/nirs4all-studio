import { describe, expect, it } from "vitest";
import {
  formatCount,
  getEffectivePartition,
  getEffectiveTargetDistribution,
  getPartitionSampleCount,
  getRelativeTime,
  hasTestPartition,
} from "../DatasetOverviewTabData";
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

describe("DatasetOverviewTabData", () => {
  it("uses train as the effective partition when no test partition exists", () => {
    expect(getEffectivePartition("all", false)).toBe("train");
    expect(getEffectivePartition("test", false)).toBe("train");
    expect(getEffectivePartition("train", false)).toBe("train");
    expect(getEffectivePartition("all", true)).toBe("all");
    expect(getEffectivePartition("test", true)).toBe("test");
  });

  it("detects test availability from partition data or sample counts", () => {
    expect(hasTestPartition({ test: testDistribution }, 0)).toBe(true);
    expect(hasTestPartition(undefined, 1)).toBe(true);
    expect(hasTestPartition({ train: trainDistribution }, 0)).toBe(false);
    expect(hasTestPartition(undefined, undefined)).toBe(false);
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

  it("returns sample counts for all, train, and test partitions", () => {
    expect(
      getPartitionSampleCount({
        distribution: undefined,
        effectivePartition: "all",
        trainCount: 80,
        testCount: 20,
        totalCount: 100,
      }),
    ).toBe(100);

    expect(
      getPartitionSampleCount({
        distribution: undefined,
        effectivePartition: "train",
        trainCount: 80,
        testCount: 20,
        totalCount: 100,
      }),
    ).toBe(80);

    expect(
      getPartitionSampleCount({
        distribution: undefined,
        effectivePartition: "test",
        trainCount: 80,
        testCount: 20,
        totalCount: 100,
      }),
    ).toBe(20);

    expect(
      getPartitionSampleCount({
        distribution: { ...allDistribution, n_samples: 95 },
        effectivePartition: "all",
        trainCount: 80,
        testCount: 20,
        totalCount: 100,
      }),
    ).toBe(95);

    expect(
      getPartitionSampleCount({
        distribution: undefined,
        effectivePartition: "all",
        trainCount: 0,
        testCount: 0,
        totalCount: 0,
      }),
    ).toBe(0);
  });

  it("formats relative time labels", () => {
    const now = new Date("2026-06-29T12:00:00.000Z");

    expect(getRelativeTime("2026-06-29T08:00:00.000Z", now)).toBe("Today");
    expect(getRelativeTime("2026-06-28T12:00:00.000Z", now)).toBe("Yesterday");
    expect(getRelativeTime("2026-06-25T12:00:00.000Z", now)).toBe("4 days ago");
    expect(getRelativeTime("2026-06-08T12:00:00.000Z", now)).toBe("3 weeks ago");
    expect(getRelativeTime("2026-03-29T12:00:00.000Z", now)).toBe("3 months ago");
    expect(getRelativeTime("2025-06-29T12:00:00.000Z", now)).toBe("1 years ago");
  });

  it("formats counts with a placeholder for missing values", () => {
    expect(formatCount(undefined)).toBe("--");
    expect(formatCount(null)).toBe("--");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234)).toBe("1,234");
  });
});
