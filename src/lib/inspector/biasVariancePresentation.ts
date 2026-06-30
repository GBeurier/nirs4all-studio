export const BIAS_VARIANCE_EMPTY_DESCRIPTION = 'This view needs chains with repeated fold-level predictions for the same samples.';

export function getBiasVarianceEmptyDescription(reason: string | null | undefined): string {
  return reason?.trim() || BIAS_VARIANCE_EMPTY_DESCRIPTION;
}

export function formatBiasVarianceTotal(value: number): string {
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(3);
  return value.toFixed(4);
}

export function formatBiasVariancePrecise(value: number): string {
  return value.toFixed(6);
}

export function formatBiasVarianceShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

export function formatBiasVarianceSampleSummary({
  chainCount,
  foldCount,
  sampleCount,
}: {
  chainCount: number;
  foldCount: number;
  sampleCount: number;
}): string {
  return `${chainCount} chains, ${foldCount} folds, ${sampleCount} samples`;
}

export function formatBiasVarianceSelectionStatus(hasSelection: boolean, selectedCount: number): string {
  return hasSelection ? `${selectedCount} selected` : 'No selection';
}
