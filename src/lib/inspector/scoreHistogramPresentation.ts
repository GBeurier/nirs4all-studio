import type { TFunction } from 'i18next';
import type { HistogramResponse } from '@/types/inspector';
import type { ScoreHistogramBarData } from '@/lib/inspector/scoreHistogramData';

export interface ScoreHistogramTooltipData {
  rangeLabel: string;
  countLabel: string;
  percentageLabel: string;
}

export function getScoreHistogramEmptyMessage(t: TFunction): string {
  return t('inspector.charts.empty.histogram');
}

export function formatScoreHistogramValue(value: number): string {
  return value.toFixed(4);
}

export function buildScoreHistogramStatsSegments(
  data: HistogramResponse | null | undefined,
  t: TFunction,
): string[] {
  if (!data) return [];
  const segments: string[] = [];
  if (data.min_score != null) segments.push(t('inspector.charts.histogram.statMin', { value: formatScoreHistogramValue(data.min_score) }));
  if (data.mean_score != null) segments.push(t('inspector.charts.histogram.statMean', { value: formatScoreHistogramValue(data.mean_score) }));
  if (data.max_score != null) segments.push(t('inspector.charts.histogram.statMax', { value: formatScoreHistogramValue(data.max_score) }));
  return segments;
}

export function buildScoreHistogramTooltipData(
  bar: ScoreHistogramBarData,
  totalChains: number | null | undefined,
  t: TFunction,
): ScoreHistogramTooltipData {
  const denominator = totalChains && totalChains > 0 ? totalChains : 1;
  return {
    rangeLabel: `[${formatScoreHistogramValue(bar.binStart)}, ${formatScoreHistogramValue(bar.binEnd)})`,
    countLabel: String(bar.count),
    percentageLabel: t('inspector.charts.tooltip.percentOfTotal', { value: ((bar.count / denominator) * 100).toFixed(1) }),
  };
}

export function formatScoreHistogramMeanReference(
  meanScore: number | null | undefined,
): string | null {
  return meanScore == null ? null : meanScore.toFixed(3);
}
