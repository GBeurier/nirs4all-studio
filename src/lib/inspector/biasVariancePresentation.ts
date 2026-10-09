import type { TFunction } from 'i18next';

export function getBiasVarianceEmptyDescription(reason: string | null | undefined, t: TFunction): string {
  return reason?.trim() || t('inspector.charts.empty.biasVariance');
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
  t,
}: {
  chainCount: number;
  foldCount: number;
  sampleCount: number;
  t: TFunction;
}): string {
  return [
    t('inspector.counts.chains', { count: chainCount }),
    t('inspector.counts.folds', { count: foldCount }),
    t('inspector.counts.samples', { count: sampleCount }),
  ].join(', ');
}

export function formatBiasVarianceSelectionStatus(hasSelection: boolean, selectedCount: number, t: TFunction): string {
  return hasSelection ? t('inspector.counts.selected', { count: selectedCount }) : t('inspector.charts.noSelection');
}
