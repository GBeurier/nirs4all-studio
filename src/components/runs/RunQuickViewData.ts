import type { ScoreDistribution } from "@/types/enriched-runs";

export const RUN_QUICK_VIEW_DEFAULT_PARTITIONS = ["val", "test"] as const;

export const RUN_QUICK_VIEW_PARTITIONS = ["val", "test", "train", "final"] as const;

export type RunQuickViewPartition = typeof RUN_QUICK_VIEW_PARTITIONS[number];

export const RUN_QUICK_VIEW_PARTITION_LABELS: Record<string, string> = {
  val: "Validation",
  test: "Test",
  train: "Train",
  final: "Final",
};

export const RUN_QUICK_VIEW_PARTITION_COLORS: Record<string, string> = {
  val: "bg-chart-1/20 text-chart-1 border-chart-1/30",
  test: "bg-chart-2/20 text-chart-2 border-chart-2/30",
  train: "bg-chart-3/20 text-chart-3 border-chart-3/30",
  final: "bg-chart-4/20 text-chart-4 border-chart-4/30",
};

export interface RunQuickViewPartitionStats {
  mean: number;
  min: number;
  max: number;
  n: number;
}

export type RunQuickViewPartitionStatsByPartition = Record<string, RunQuickViewPartitionStats>;

export function getRunQuickViewDefaultSelectedPartitions(): Set<string> {
  return new Set(RUN_QUICK_VIEW_DEFAULT_PARTITIONS);
}

export function getRunQuickViewAvailablePartitions(distribution: ScoreDistribution | null | undefined): string[] {
  if (!distribution?.partitions) {
    return [...RUN_QUICK_VIEW_DEFAULT_PARTITIONS];
  }

  return RUN_QUICK_VIEW_PARTITIONS.filter((partition) => distribution.partitions[partition]?.n_scores > 0);
}

export function toggleRunQuickViewPartitionSelection(selectedPartitions: ReadonlySet<string>, partition: string): Set<string> {
  const next = new Set(selectedPartitions);

  if (next.has(partition)) {
    next.delete(partition);
  } else {
    next.add(partition);
  }

  return next;
}

export function getRunQuickViewPartitionStats(
  distribution: ScoreDistribution | null | undefined,
  availablePartitions: readonly string[],
): RunQuickViewPartitionStatsByPartition | null {
  if (!distribution?.partitions) {
    return null;
  }

  const stats: RunQuickViewPartitionStatsByPartition = {};

  for (const partition of availablePartitions) {
    const partitionDistribution = distribution.partitions[partition];
    if (partitionDistribution) {
      stats[partition] = {
        mean: partitionDistribution.mean,
        min: partitionDistribution.min,
        max: partitionDistribution.max,
        n: partitionDistribution.n_scores,
      };
    }
  }

  return Object.keys(stats).length > 0 ? stats : null;
}
