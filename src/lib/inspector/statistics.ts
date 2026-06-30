/**
 * Pure, dependency-free statistical primitives over arrays of finite scores.
 *
 * This module intentionally knows nothing about inspector chains, score columns,
 * or metric direction beyond the explicit `lowerBetter` flag passed to
 * {@link aggregateScores}. Keeping these helpers isolated makes them reusable for
 * future pipeline-level / n4a-benchmarks metrics without dragging in the inspector
 * domain types. Every function operates on plain `number[]` and never mutates its
 * input.
 */

/** How a group of scores is collapsed to a single representative value. */
export type AggregateMode = "best" | "mean" | "median" | "worst";

/** Summary statistics for a non-empty array of scores. */
export interface ScoreSummary {
  mean: number;
  median: number;
  q25: number;
  q75: number;
}

/**
 * Linear-interpolation quantile of an already-ascending array.
 *
 * @param sortedValues values sorted ascending; an empty array yields `NaN`.
 * @param q quantile in `[0, 1]` (clamped).
 */
export function quantile(sortedValues: readonly number[], q: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const clampedQ = Math.min(1, Math.max(0, q));
  const position = (sortedValues.length - 1) * clampedQ;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/** Arithmetic mean of a non-empty array (returns `NaN` when empty). */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Mean, median and the inter-quartile bounds of an unsorted score array.
 * Sorts a copy of `values`; the input is left untouched.
 */
export function summarizeScores(values: readonly number[]): ScoreSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: mean(sorted),
    median: quantile(sorted, 0.5),
    q25: quantile(sorted, 0.25),
    q75: quantile(sorted, 0.75),
  };
}

/**
 * Collapse a group of scores to a single value according to `aggregate`,
 * honouring metric direction via `lowerBetter` for the `best`/`worst` modes.
 */
export function aggregateScores(scores: readonly number[], lowerBetter: boolean, aggregate: AggregateMode): number {
  const sorted = [...scores].sort((a, b) => a - b);
  if (aggregate === "best") return lowerBetter ? sorted[0] : sorted[sorted.length - 1];
  if (aggregate === "worst") return lowerBetter ? sorted[sorted.length - 1] : sorted[0];
  if (aggregate === "median") return quantile(sorted, 0.5);
  return mean(sorted);
}
