import { describe, expect, it } from "vitest";
import {
  getRunQuickViewAvailablePartitions,
  getRunQuickViewDefaultSelectedPartitions,
  getRunQuickViewPartitionStats,
  RUN_QUICK_VIEW_PARTITION_COLORS,
  RUN_QUICK_VIEW_PARTITION_LABELS,
  toggleRunQuickViewPartitionSelection,
} from "../RunQuickViewData";
import type { ScoreDistribution } from "@/types/enriched-runs";

function scoreDistribution(partitions: ScoreDistribution["partitions"]): ScoreDistribution {
  return {
    dataset_name: "Corn",
    metric: "rmse",
    partitions,
  };
}

function partitionDistribution(overrides: Partial<ScoreDistribution["partitions"][string]> = {}): ScoreDistribution["partitions"][string] {
  return {
    bins: [0, 1],
    counts: [2],
    n_scores: 2,
    min: 0.1,
    max: 0.5,
    mean: 0.3,
    ...overrides,
  };
}

describe("RunQuickViewData", () => {
  it("keeps partition labels and colors centralized", () => {
    expect(RUN_QUICK_VIEW_PARTITION_LABELS).toMatchObject({
      val: "Validation",
      test: "Test",
      train: "Train",
      final: "Final",
    });
    expect(RUN_QUICK_VIEW_PARTITION_COLORS.val).toBe("bg-chart-1/20 text-chart-1 border-chart-1/30");
    expect(RUN_QUICK_VIEW_PARTITION_COLORS.final).toBe("bg-chart-4/20 text-chart-4 border-chart-4/30");
  });

  it("defaults selection and available partitions to validation and test", () => {
    expect([...getRunQuickViewDefaultSelectedPartitions()]).toEqual(["val", "test"]);
    expect(getRunQuickViewAvailablePartitions(null)).toEqual(["val", "test"]);
    expect(getRunQuickViewAvailablePartitions(undefined)).toEqual(["val", "test"]);
  });

  it("only exposes known partitions with scores in display order", () => {
    const distribution = scoreDistribution({
      test: partitionDistribution({ n_scores: 4 }),
      val: partitionDistribution({ n_scores: 0 }),
      train: partitionDistribution({ n_scores: 3 }),
      final: partitionDistribution({ n_scores: 1 }),
      ignored: partitionDistribution({ n_scores: 10 }),
    });

    expect(getRunQuickViewAvailablePartitions(distribution)).toEqual(["test", "train", "final"]);
  });

  it("toggles selected partitions without mutating the input set", () => {
    const selected = new Set(["val", "test"]);

    const withoutVal = toggleRunQuickViewPartitionSelection(selected, "val");
    expect([...withoutVal]).toEqual(["test"]);
    expect([...selected]).toEqual(["val", "test"]);

    const withTrain = toggleRunQuickViewPartitionSelection(withoutVal, "train");
    expect([...withTrain]).toEqual(["test", "train"]);
    expect([...withoutVal]).toEqual(["test"]);
  });

  it("builds compact partition stats for available partitions", () => {
    const distribution = scoreDistribution({
      val: partitionDistribution({ mean: 0.2, min: 0.1, max: 0.3, n_scores: 5 }),
      test: partitionDistribution({ mean: 0.4, min: 0.2, max: 0.6, n_scores: 7 }),
      train: partitionDistribution({ mean: 0.8, min: 0.7, max: 0.9, n_scores: 9 }),
    });

    expect(getRunQuickViewPartitionStats(distribution, ["test", "missing", "val"])).toEqual({
      test: { mean: 0.4, min: 0.2, max: 0.6, n: 7 },
      val: { mean: 0.2, min: 0.1, max: 0.3, n: 5 },
    });
  });

  it("returns no stats when distribution data is missing", () => {
    expect(getRunQuickViewPartitionStats(null, ["val"])).toBeNull();
  });
});
