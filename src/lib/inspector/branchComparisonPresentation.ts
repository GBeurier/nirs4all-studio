import type { TFunction } from 'i18next';

export function getBranchComparisonEmptyMessage(t: TFunction): string {
  return t('inspector.charts.empty.branchComparison');
}

export function formatBranchComparisonLabel(label: string, maxLength = 16): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 2)}\u2026` : label;
}

export function formatBranchComparisonTick(value: number): string {
  return value.toFixed(3);
}

export function formatBranchComparisonScore(value: number): string {
  return value.toFixed(4);
}

export function formatBranchComparisonCountBadge(count: number): string {
  return `n=${count}`;
}

export function formatBranchComparisonChainCount(count: number, t: TFunction): string {
  return t('inspector.charts.tooltip.chains', { value: count });
}

export function formatBranchComparisonConfidenceInterval(lower: number, upper: number, t: TFunction): string {
  return t('inspector.charts.tooltip.confidenceInterval', {
    lower: formatBranchComparisonScore(lower),
    upper: formatBranchComparisonScore(upper),
  });
}
