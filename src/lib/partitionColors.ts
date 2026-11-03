/**
 * Single source of truth for partition colors (train / val / test), plus the
 * prediction-only partition of samples whose target is missing.
 *
 * Consolidates what was previously hardcoded in three places:
 *   - ChainDetailSheet PartitionBadge
 *   - viewer/types.ts DEFAULT_CHART_CONFIG.partitionColors
 *   - PartitionToggles dots
 *
 * Keeps the historical palette (teal / blue / green) so the viewer's default
 * chart look is unchanged.
 */

export type PartitionKey = "train" | "val" | "test";

/**
 * Hex colors used by charts (Recharts fills, SVG strokes).
 * Kept in sync with the historical viewer defaults.
 */
export const PARTITION_COLORS: Record<PartitionKey, string> = {
  train: "#17cfb9",
  val: "#266bd9",
  test: "#1cca5b",
};

/**
 * Tailwind class string for small status badges (light + dark).
 *
 * NOTE: badge hues are intentionally distinct from chart hex colors —
 * badges use Tailwind's semantic color ramps for text-on-background contrast,
 * while charts use the historical partition palette for visual continuity
 * with earlier versions. Consumers rendering a legend next to a chart should
 * prefer `PARTITION_COLORS` (dot / swatch), not `PARTITION_BADGE_CLASS`.
 */
export const PARTITION_BADGE_CLASS: Record<PartitionKey, string> = {
  train:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  val: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  test: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

/** Lowercase a partition label; returns null if not recognized. */
export function normalizePartition(value: string | null | undefined): PartitionKey | null {
  if (!value) return null;
  const key = value.toLowerCase();
  if (key === "train" || key === "val" || key === "test") return key;
  return null;
}

/**
 * Partition of the rows a run predicts for samples whose target is missing:
 * excluded from training, then predicted. They carry no y_true and no scores,
 * so they never enter metric, residual or y_true-vs-y_pred computations.
 */
export const PREDICTION_ONLY_PARTITION = "prediction";

export const PREDICTION_ONLY_BADGE_CLASS =
  "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300";

export function isPredictionOnlyPartition(value: string | null | undefined): boolean {
  return value?.toLowerCase() === PREDICTION_ONLY_PARTITION;
}

/** Rows that carry a target and scores: drops prediction-only rows. */
export function scoredPartitionRows<T extends { partition?: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isPredictionOnlyPartition(row.partition));
}

export function partitionBadgeClass(value: string | null | undefined): string {
  if (isPredictionOnlyPartition(value)) return PREDICTION_ONLY_BADGE_CLASS;
  const key = normalizePartition(value);
  return key ? PARTITION_BADGE_CLASS[key] : "";
}
