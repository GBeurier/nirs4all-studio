import {
  canonicalMetricKey,
  formatMetricDisplayName,
  getMetricDefinitions,
  getMetricAbbreviation,
  getPrimaryContextMetricLabel,
  getScoreMapValue,
  isLowerBetter,
} from '@/lib/scores';
import type { ScoreCardRow, ScoreCardType } from '@/types/score-cards';

function isKnownScoreMetric(key: string): boolean {
  return getMetricDefinitions([key]).length > 0;
}

function getScoreMetricLabel(key: string): string {
  const metricKey = canonicalMetricKey(key) || key;
  if (isKnownScoreMetric(metricKey)) {
    return getMetricAbbreviation(metricKey);
  }
  return formatMetricDisplayName(metricKey) || getMetricAbbreviation(metricKey);
}

export function getScoreContextLabel(
  key: string,
  cardType: ScoreCardType,
  primaryMetric: string | null,
  taskType?: string | null,
): string {
  const k = canonicalMetricKey(key);
  const pm = canonicalMetricKey(primaryMetric);
  const isPrimaryMetric = !!k && k === pm;
  const isKnownMetric = isKnownScoreMetric(k || key);

  if ((cardType === 'refit' || cardType === 'crossval') && isPrimaryMetric && isKnownMetric) {
    return getPrimaryContextMetricLabel(primaryMetric || key, cardType, taskType);
  }

  if ((k === 'rmse' || (isKnownMetric && k === pm)) && isLowerBetter(k || key)) {
    if (cardType === 'refit') return 'RMSEP';
    if (cardType === 'crossval') return 'RMSECV';
  }
  return getScoreMetricLabel(k || key);
}

export function extractDisplayScores(
  row: ScoreCardRow,
  selectedMetrics: string[],
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const pm = canonicalMetricKey(row.metric || 'rmse');

  for (const requestedMetric of selectedMetrics) {
    const metricKey = canonicalMetricKey(requestedMetric) || requestedMetric;
    let val: number | null = null;

    if (row.cardType === 'refit') {
      val = getScoreMapValue(row.testScores, metricKey);
      if (val == null && metricKey === pm) {
        val = row.primaryTestScore;
      }
    } else if (row.cardType === 'crossval') {
      val = getScoreMapValue(row.valScores, metricKey) ?? getScoreMapValue(row.avgValScores, metricKey);
      if (val == null) val = getScoreMapValue(row.testScores, metricKey) ?? getScoreMapValue(row.avgTestScores, metricKey);
      if (val == null && metricKey === pm) {
        val = row.primaryValScore ?? row.primaryTestScore;
      }
    } else {
      val = getScoreMapValue(row.testScores, metricKey) ?? getScoreMapValue(row.valScores, metricKey) ?? getScoreMapValue(row.trainScores, metricKey);
      if (val == null && metricKey === pm) {
        val = row.primaryTestScore ?? row.primaryValScore ?? row.primaryTrainScore;
      }
    }

    result[requestedMetric] = val;
  }
  return result;
}

export function cardTypeColorClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case 'refit': return 'text-emerald-500';
    case 'crossval': return 'text-chart-1';
    case 'train': return 'text-foreground/70';
  }
}

export function cardTypeBorderClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case 'refit': return 'border-emerald-500/20';
    case 'crossval': return 'border-chart-1/20';
    case 'train': return 'border-border/50';
  }
}

export function cardTypeBgClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case 'refit': return 'bg-emerald-500/5';
    case 'crossval': return 'bg-chart-1/5';
    case 'train': return '';
  }
}
