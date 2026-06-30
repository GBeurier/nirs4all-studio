import {
  canonicalMetricKey,
  filterMetricsForTaskType,
  formatMetricDisplayName,
  getDefaultSelectedMetrics,
  getMetricAbbreviation,
  getMetricDefinitions,
  getScoreMapValue,
  isClassificationTaskType,
  orderMetricKeys,
} from '@/lib/scores';
import type { ScoreCardRow } from '@/types/score-cards';

export interface ScorePairData {
  label: string;
  value: number | null | undefined;
  metric: string;
  colorClass?: string;
}

function getTestScore(row: ScoreCardRow, key: string): number | null {
  return getScoreMapValue(row.testScores, key);
}

function getValScore(row: ScoreCardRow, key: string): number | null {
  return getScoreMapValue(row.valScores, key);
}

function getTrainScore(row: ScoreCardRow, key: string): number | null {
  return getScoreMapValue(row.trainScores, key);
}

export function getScoreCardAnyScore(row: ScoreCardRow, key: string): number | null {
  return getScoreMapValue(row.testScores, key) ?? getScoreMapValue(row.valScores, key) ?? getScoreMapValue(row.trainScores, key);
}

export function getScoreCardPrimaryMetric(row: ScoreCardRow): string {
  return canonicalMetricKey(row.metric || (isClassificationTaskType(row.taskType) ? 'accuracy' : 'rmse'));
}

function isKnownScoreMetric(metric: string): boolean {
  return getMetricDefinitions([metric]).length > 0;
}

function getScoreRowMetricLabel(metric: string): string {
  const normalized = canonicalMetricKey(metric);
  if (!normalized) return '';
  if (isKnownScoreMetric(normalized)) return getMetricAbbreviation(normalized);
  return formatMetricDisplayName(normalized) || metric;
}

function orderScoreRowMetricKeys(metricKeys: readonly string[]): string[] {
  const knownKeys: string[] = [];
  const customKeys: string[] = [];
  const seen = new Set<string>();

  for (const metric of metricKeys) {
    const normalized = canonicalMetricKey(metric);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    if (isKnownScoreMetric(normalized)) {
      knownKeys.push(normalized);
    } else {
      customKeys.push(normalized);
    }
  }

  return [...orderMetricKeys(knownKeys), ...customKeys];
}

export function filterScoreRowMetricsForTaskType(metricKeys: readonly string[], taskType: string | null | undefined): string[] {
  const filteredKnownKeys = new Set(filterMetricsForTaskType(metricKeys, taskType));
  const filteredMetrics: string[] = [];

  for (const metric of metricKeys) {
    const normalized = canonicalMetricKey(metric);
    if (!normalized) continue;

    if (isKnownScoreMetric(normalized)) {
      if (filteredKnownKeys.has(normalized)) filteredMetrics.push(normalized);
    } else {
      filteredMetrics.push(normalized);
    }
  }

  return filteredMetrics;
}

export function getScoreCardRelevantMetricKeys(row: ScoreCardRow, selectedMetrics: string[]): string[] {
  const primaryMetric = getScoreCardPrimaryMetric(row);
  const scopedSelection = filterScoreRowMetricsForTaskType(selectedMetrics, row.taskType);
  const fallbackSelection = filterScoreRowMetricsForTaskType(getDefaultSelectedMetrics(row.taskType ?? null), row.taskType);
  const relevantMetrics = scopedSelection.length > 0 ? scopedSelection : fallbackSelection;

  return orderScoreRowMetricKeys([primaryMetric, ...relevantMetrics]);
}

function getSecondaryMetrics(row: ScoreCardRow, selectedMetrics: string[]): Array<{ key: string; label: string }> {
  const primaryMetric = getScoreCardPrimaryMetric(row);
  return getScoreCardRelevantMetricKeys(row, selectedMetrics)
    .filter((metric) => metric !== primaryMetric)
    .map((metric) => ({ key: metric, label: getScoreRowMetricLabel(metric) }));
}

function regressionPrimaryLabel(primaryMetric: string): string {
  return primaryMetric === 'rmse' || primaryMetric === 'rmsep'
    ? 'RMSEP'
    : getScoreRowMetricLabel(primaryMetric);
}

export function buildRefitScorePairs(row: ScoreCardRow, selectedMetrics: string[]): ScorePairData[] {
  const primaryMetric = getScoreCardPrimaryMetric(row);
  const secondaryMetrics = getSecondaryMetrics(row, selectedMetrics);
  const primaryLabel = isClassificationTaskType(row.taskType)
    ? getScoreRowMetricLabel(primaryMetric)
    : regressionPrimaryLabel(primaryMetric);

  return [
    {
      label: primaryLabel,
      value: row.primaryTestScore ?? getTestScore(row, primaryMetric),
      metric: primaryMetric,
      colorClass: 'text-emerald-500 font-semibold',
    },
    {
      label: 'Train',
      value: row.primaryTrainScore ?? getTrainScore(row, primaryMetric),
      metric: primaryMetric,
      colorClass: 'text-orange-400',
    },
    ...secondaryMetrics.map((metric) => ({
      label: metric.label,
      value: getTestScore(row, metric.key),
      metric: metric.key,
    })),
  ];
}

export function buildCrossvalScorePairs(row: ScoreCardRow, selectedMetrics: string[]): ScorePairData[] {
  const primaryMetric = getScoreCardPrimaryMetric(row);
  const secondaryMetrics = getSecondaryMetrics(row, selectedMetrics);

  if (isClassificationTaskType(row.taskType)) {
    const primaryLabel = getScoreRowMetricLabel(primaryMetric);

    return [
      {
        label: `${primaryLabel} CV`,
        value: row.primaryValScore ?? getScoreMapValue(row.avgValScores, primaryMetric),
        metric: primaryMetric,
        colorClass: 'text-chart-1 font-semibold',
      },
      { label: 'Mean Val', value: getScoreMapValue(row.meanValScores, primaryMetric), metric: primaryMetric, colorClass: 'text-blue-400' },
      { label: 'Min Val', value: getScoreMapValue(row.minValScores, primaryMetric), metric: primaryMetric, colorClass: 'text-blue-400' },
      { label: 'Max Val', value: getScoreMapValue(row.maxValScores, primaryMetric), metric: primaryMetric, colorClass: 'text-blue-400' },
      {
        label: `${primaryLabel} Test`,
        value: row.primaryTestScore ?? getScoreMapValue(row.avgTestScores, primaryMetric),
        metric: primaryMetric,
      },
      ...secondaryMetrics.map((metric) => ({
        label: metric.label,
        value: getScoreMapValue(row.avgValScores, metric.key) ?? getScoreMapValue(row.avgTestScores, metric.key),
        metric: metric.key,
        colorClass: 'text-green-400',
      })),
    ];
  }

  const rmseLike = primaryMetric === 'rmse';
  const primaryKey = primaryMetric || 'rmse';
  const meanVal = getScoreMapValue(row.meanValScores, primaryMetric) ?? getScoreMapValue(row.meanValScores, 'rmse');
  const minVal = getScoreMapValue(row.minValScores, primaryMetric) ?? getScoreMapValue(row.minValScores, 'rmse');
  const maxVal = getScoreMapValue(row.maxValScores, primaryMetric) ?? getScoreMapValue(row.maxValScores, 'rmse');
  const meanTest = getScoreMapValue(row.meanTestScores, primaryMetric) ?? getScoreMapValue(row.meanTestScores, 'rmse');
  const minTest = getScoreMapValue(row.minTestScores, primaryMetric) ?? getScoreMapValue(row.minTestScores, 'rmse');
  const maxTest = getScoreMapValue(row.maxTestScores, primaryMetric) ?? getScoreMapValue(row.maxTestScores, 'rmse');
  const weightedTest = getScoreMapValue(row.wAvgTestScores, primaryMetric) ?? getScoreMapValue(row.wAvgTestScores, 'rmse');
  const avgTest = row.primaryTestScore ?? getScoreMapValue(row.avgTestScores, primaryMetric) ?? getScoreMapValue(row.avgTestScores, 'rmse');

  return [
    {
      label: rmseLike ? 'RMSECV' : 'CV',
      value: row.primaryValScore ?? getScoreMapValue(row.avgValScores, primaryMetric) ?? getScoreMapValue(row.avgValScores, 'rmse'),
      metric: primaryKey,
      colorClass: 'text-chart-1 font-semibold',
    },
    { label: 'Mean Val', value: meanVal, metric: primaryKey, colorClass: 'text-blue-400' },
    { label: 'Min Val', value: minVal, metric: primaryKey, colorClass: 'text-blue-400' },
    { label: 'Max Val', value: maxVal, metric: primaryKey, colorClass: 'text-blue-400' },
    { label: rmseLike ? 'RMSEP Avg' : 'Test Avg', value: avgTest, metric: primaryKey },
    { label: rmseLike ? 'RMSEP W-Avg' : 'Test W-Avg', value: weightedTest, metric: primaryKey },
    { label: rmseLike ? 'Mean RMSEP' : 'Mean Test', value: meanTest, metric: primaryKey, colorClass: 'text-green-400' },
    { label: 'Min Test', value: minTest, metric: primaryKey, colorClass: 'text-green-400' },
    { label: 'Max Test', value: maxTest, metric: primaryKey, colorClass: 'text-green-400' },
    ...secondaryMetrics.map((metric) => ({
      label: metric.label,
      value: getScoreMapValue(row.avgValScores, metric.key) ?? getScoreMapValue(row.avgTestScores, metric.key),
      metric: metric.key,
      colorClass: 'text-green-400',
    })),
  ];
}

export function buildTrainScorePairs(row: ScoreCardRow, selectedMetrics: string[]): ScorePairData[] {
  const primaryMetric = getScoreCardPrimaryMetric(row);
  const secondaryMetrics = getSecondaryMetrics(row, selectedMetrics);
  const primaryLabel = isClassificationTaskType(row.taskType)
    ? getScoreRowMetricLabel(primaryMetric)
    : regressionPrimaryLabel(primaryMetric);

  return [
    {
      label: primaryLabel,
      value: isClassificationTaskType(row.taskType)
        ? row.primaryTestScore ?? getScoreCardAnyScore(row, primaryMetric)
        : row.primaryTestScore ?? getTestScore(row, primaryMetric),
      metric: primaryMetric,
      colorClass: 'font-semibold',
    },
    {
      label: 'Val',
      value: row.primaryValScore ?? getValScore(row, primaryMetric),
      metric: primaryMetric,
      colorClass: 'text-blue-400',
    },
    ...secondaryMetrics.map((metric) => ({
      label: metric.label,
      value: getScoreCardAnyScore(row, metric.key),
      metric: metric.key,
    })),
  ];
}
