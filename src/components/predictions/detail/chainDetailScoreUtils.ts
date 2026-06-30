import type { PartitionPrediction } from "@/types/aggregated-predictions";
import { extractPredictionScoreMap } from "@/lib/score-adapters-fold-scores";

export function scoreForPartition(row: PartitionPrediction, partition: string): number | null | undefined {
  if (partition === "val") return row.val_score;
  if (partition === "test") return row.test_score;
  return row.train_score;
}

export function metricMap(row: PartitionPrediction): Array<[string, number]> {
  const entries = Object.entries(extractPredictionScoreMap(row))
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
  const primary = (row.metric || "").toLowerCase();
  return entries.sort(([a], [b]) => {
    if (a === primary) return -1;
    if (b === primary) return 1;
    return a.localeCompare(b);
  });
}
