import type { PartitionPrediction } from "@/types/aggregated-predictions";
import { foldIdBase, safeNumber } from "@/lib/fold-utils";

export type FoldVariant = "raw" | "aggregated";
export type ScorePartition = "test" | "val" | "train";

export interface PartitionScoreMaps {
  testScores: Record<string, number | null>;
  valScores: Record<string, number | null>;
  trainScores: Record<string, number | null>;
}

/**
 * Project a flat `{metric: value}` score object into `{metric: number | null}`,
 * coercing every value through `safeNumber`. Non-object / nullish inputs yield `{}`.
 *
 * This is the single canonical projection for per-partition metric maps: every
 * adapter that surfaces a partition's scores routes through it so new metrics
 * such as multi-target or benchmark-specific metrics are coerced identically.
 */
export function coerceScoreMap(
  scores: Record<string, unknown> | null | undefined,
): Record<string, number | null> {
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) return {};
  const result: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(scores)) {
    result[k] = safeNumber(v);
  }
  return result;
}

/** Extract multi-metric scores from a {partition: {metric: value}} structure. */
export function extractNestedScores(
  scores: Record<string, Record<string, number>> | null | undefined,
  partition: string,
): Record<string, number | null> {
  return coerceScoreMap(scores?.[partition]);
}

function isScoreRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function scoreMapForPartition(
  maps: PartitionScoreMaps,
  partition: string,
): Record<string, number | null> {
  if (partition === "val") return maps.valScores;
  if (partition === "train") return maps.trainScores;
  return maps.testScores;
}

function nonNullScoreMap(scores: Record<string, number | null>): Record<string, number | null> {
  return Object.fromEntries(Object.entries(scores).filter(([, value]) => value != null));
}

export function projectPartitionScoreMaps(
  scores: Record<string, unknown> | null | undefined,
  activePartition?: string | null,
): PartitionScoreMaps {
  const maps: PartitionScoreMaps = {
    testScores: {},
    valScores: {},
    trainScores: {},
  };

  if (!isScoreRecord(scores)) return maps;

  const testInner = isScoreRecord(scores.test) ? scores.test : null;
  const valInner = isScoreRecord(scores.val) ? scores.val : null;
  const trainInner = isScoreRecord(scores.train) ? scores.train : null;

  if (testInner || valInner || trainInner) {
    return {
      testScores: coerceScoreMap(testInner),
      valScores: coerceScoreMap(valInner),
      trainScores: coerceScoreMap(trainInner),
    };
  }

  const flatScores = nonNullScoreMap(coerceScoreMap(scores));
  Object.assign(scoreMapForPartition(maps, activePartition ?? "test"), flatScores);
  return maps;
}

export function foldVariantSuffix(variant: FoldVariant): string {
  return variant === "aggregated" ? "_agg" : "";
}

export function foldVariantId(baseFoldId: string, variant: FoldVariant): string {
  return `${baseFoldId}${foldVariantSuffix(variant)}`;
}

export function predictionMatchesVariant(
  prediction: Pick<PartitionPrediction, "fold_id">,
  variant: FoldVariant,
): boolean {
  const isAgg = prediction.fold_id.endsWith("_agg");
  return variant === "aggregated" ? isAgg : !isAgg;
}

export function extractPredictionScoreMap(pred: PartitionPrediction): Record<string, number | null> {
  const scoresObj = pred.scores as Record<string, unknown> | null | undefined;
  const partitionMaps = projectPartitionScoreMaps(scoresObj, pred.partition);
  const result = nonNullScoreMap(scoreMapForPartition(partitionMaps, pred.partition));

  const primaryScore = pred.partition === "test"
    ? safeNumber(pred.test_score)
    : pred.partition === "val"
      ? safeNumber(pred.val_score)
      : safeNumber(pred.train_score);
  const metricKey = (pred.metric || "").trim().toLowerCase() || "score";
  if (primaryScore != null && result[metricKey] == null) {
    result[metricKey] = primaryScore;
  }

  return result;
}

export function averagePredictionScoreMaps(predictions: PartitionPrediction[]): Record<string, number | null> {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const pred of predictions) {
    for (const [key, value] of Object.entries(extractPredictionScoreMap(pred))) {
      const num = safeNumber(value);
      if (num == null) continue;
      const current = totals.get(key) ?? { sum: 0, count: 0 };
      current.sum += num;
      current.count += 1;
      totals.set(key, current);
    }
  }

  return Object.fromEntries(
    [...totals.entries()].map(([key, value]) => [key, value.count > 0 ? value.sum / value.count : null]),
  );
}

export function extremePredictionScoreMaps(
  predictions: PartitionPrediction[],
  mode: "min" | "max",
): Record<string, number | null> {
  const extrema = new Map<string, number>();

  for (const pred of predictions) {
    for (const [key, value] of Object.entries(extractPredictionScoreMap(pred))) {
      const num = safeNumber(value);
      if (num == null) continue;
      const current = extrema.get(key);
      if (current == null) {
        extrema.set(key, num);
        continue;
      }
      extrema.set(key, mode === "min" ? Math.min(current, num) : Math.max(current, num));
    }
  }

  return Object.fromEntries([...extrema.entries()]);
}

export function findFoldPrediction(
  predictions: PartitionPrediction[],
  foldId: string,
  partition: string,
): PartitionPrediction | undefined {
  return predictions.find(pred => pred.fold_id === foldId && pred.partition === partition);
}

export function isNumberedFoldId(foldId: string): boolean {
  const baseFoldId = foldIdBase(foldId);
  if (baseFoldId === "avg" || baseFoldId === "w_avg" || baseFoldId === "final") return false;
  if (foldId !== baseFoldId) return false;
  return true;
}
