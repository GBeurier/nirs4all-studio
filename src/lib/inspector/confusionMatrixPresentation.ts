import type { TFunction } from 'i18next';

export function getConfusionMatrixEmptyDescription(reason: string | null | undefined, t: TFunction): string {
  return reason?.trim() || t('inspector.charts.empty.confusion');
}

export function getConfusionMatrixNoLabelsDescription(reason: string | null | undefined, t: TFunction): string {
  return reason?.trim() || t('inspector.charts.empty.confusionNoLabels');
}

export function getConfusionMatrixTooltipTitle(trueLabel: string, predLabel: string): string {
  return `${trueLabel} \u2192 ${predLabel}`;
}

export function getConfusionMatrixTotalSamplesLabel(totalSamples: number, t: TFunction): string {
  return t('inspector.charts.tooltip.totalSamples', { value: totalSamples });
}
