import type { HistogramResponse } from '@/types/inspector';
import type { ScoreHistogramBarData } from '@/lib/inspector/scoreHistogramData';

export interface ScoreHistogramTooltipData {
  rangeLabel: string;
  countLabel: string;
  percentageLabel: string;
}

export const SCORE_HISTOGRAM_EMPTY_MESSAGE = 'No score data available.';

export function getScoreHistogramEmptyMessage(): string {
  return SCORE_HISTOGRAM_EMPTY_MESSAGE;
}

export function formatScoreHistogramValue(value: number): string {
  return value.toFixed(4);
}

export function buildScoreHistogramStatsSegments(
  data: HistogramResponse | null | undefined,
): string[] {
  if (!data) return [];
  const segments: string[] = [];
  if (data.min_score != null) segments.push(`min: ${formatScoreHistogramValue(data.min_score)}`);
  if (data.mean_score != null) segments.push(`mean: ${formatScoreHistogramValue(data.mean_score)}`);
  if (data.max_score != null) segments.push(`max: ${formatScoreHistogramValue(data.max_score)}`);
  return segments;
}

export function buildScoreHistogramTooltipData(
  bar: ScoreHistogramBarData,
  totalChains: number | null | undefined,
): ScoreHistogramTooltipData {
  const denominator = totalChains && totalChains > 0 ? totalChains : 1;
  return {
    rangeLabel: `[${formatScoreHistogramValue(bar.binStart)}, ${formatScoreHistogramValue(bar.binEnd)})`,
    countLabel: String(bar.count),
    percentageLabel: `${((bar.count / denominator) * 100).toFixed(1)}% of total`,
  };
}

export function formatScoreHistogramMeanReference(
  meanScore: number | null | undefined,
): string | null {
  return meanScore == null ? null : meanScore.toFixed(3);
}
