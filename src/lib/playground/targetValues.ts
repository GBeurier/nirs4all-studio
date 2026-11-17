/**
 * Shared helpers for target (y) values that may be missing.
 *
 * A sample without an observed target value is kept everywhere (spectra,
 * projections, selection, counts). Only target-dependent computations skip it,
 * and they do so through these helpers.
 */

import type { TargetValue } from '@/types/spectral';

export interface TargetRange {
  min: number;
  max: number;
}

/** True when the sample has an observed, finite target value. */
export function isObservedTarget(value: TargetValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Placeholder shown where a sample has no target value. */
export const MISSING_TARGET_LABEL = '—';

/** Fixed-point text of a target value, or the missing-value placeholder. */
export function formatTargetValue(value: TargetValue | undefined, fractionDigits: number): string {
  return isObservedTarget(value) ? value.toFixed(fractionDigits) : MISSING_TARGET_LABEL;
}

/** Observed target values, in sample order. Samples without a value are skipped. */
export function getObservedTargets(y: readonly (TargetValue | undefined)[] | undefined): number[] {
  return y ? y.filter(isObservedTarget) : [];
}

/** Number of samples without an observed target value. */
export function countMissingTargets(y: readonly (TargetValue | undefined)[] | undefined): number {
  if (!y) return 0;
  let missing = 0;
  for (const value of y) {
    if (!isObservedTarget(value)) missing += 1;
  }
  return missing;
}

/** Min/max of the observed target values, or `null` when none is observed. */
export function getObservedTargetRange(y: readonly (TargetValue | undefined)[] | undefined): TargetRange | null {
  if (!y) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of y) {
    if (!isObservedTarget(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? { min, max } : null;
}
