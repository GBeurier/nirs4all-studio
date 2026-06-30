import { describe, expect, it } from 'vitest';

import {
  countActiveMetricFiltersByCategory,
  countFilteredMetricSamples,
  countMetricFilterPasses,
  getMetricDisplayName,
  getMetricPresetFilters,
  groupMetricsByCategory,
  replaceMetricFilter,
} from '@/lib/playground/metricFilterData';
import { buildPlaygroundChartInputReadModel } from '@/lib/playground/chartInputs';
import type { PipelineExecutionMetricObservation } from '@/lib/pipelineExecutionContract';
import type { MetricFilter, MetricStats, MetricsResult } from '@/types/playground';

function stats(overrides: Partial<MetricStats> = {}): MetricStats {
  return {
    min: 0,
    max: 10,
    mean: 5,
    std: 2,
    p5: 1,
    p25: 3,
    p50: 5,
    p75: 7,
    p95: 9,
    ...overrides,
  };
}

const metrics: MetricsResult = {
  values: {
    l2_norm: [1, 5, 9, 11],
    snr_estimate: [2, 6, 8, 12],
    nan_count: [0, 0, 1, 0],
    distance_to_centroid: [0.1, 0.2, 0.9, 1.4],
    custom_metric: [3, 4, 5, 6],
  },
  statistics: {
    l2_norm: stats(),
    snr_estimate: stats({ p50: 6 }),
    nan_count: stats({ min: 0, max: 1, p95: 1 }),
    distance_to_centroid: stats({ p95: 0.9 }),
  },
  computed_metrics: ['l2_norm', 'snr_estimate', 'nan_count', 'distance_to_centroid', 'custom_metric'],
  available_metrics: ['energy', 'noise', 'quality', 'chemometric'],
  n_samples: 4,
};

function observation(key: string): PipelineExecutionMetricObservation {
  return {
    key,
    label: key,
    value: 1,
    source: 'read-model',
  };
}

describe('metric filter data helpers', () => {
  it('groups metrics by known categories and falls back to other', () => {
    expect(groupMetricsByCategory(metrics)).toEqual({
      energy: ['l2_norm'],
      noise: ['snr_estimate'],
      quality: ['nan_count'],
      chemometric: ['distance_to_centroid'],
      other: ['custom_metric'],
    });
    expect(getMetricDisplayName('l2_norm')).toBe('L2 Norm');
    expect(getMetricDisplayName('custom_metric')).toBe('custom_metric');
  });

  it('groups metric capability from the chart input read model when legacy metrics are absent', () => {
    const readModel = buildPlaygroundChartInputReadModel({
      rawData: null,
      result: null,
      metricObservations: [
        observation('snr_estimate'),
        observation('rmse'),
      ],
    });

    expect(groupMetricsByCategory(null, readModel.metricObservationCapability)).toEqual({
      other: ['rmse'],
      noise: ['snr_estimate'],
    });
    expect(groupMetricsByCategory(null)).toEqual({});
  });

  it('prioritizes metric observation keys and appends deduped legacy computed metrics', () => {
    const readModel = buildPlaygroundChartInputReadModel({
      rawData: null,
      result: null,
      metricObservations: [
        observation('rmse'),
        observation('snr_estimate'),
      ],
    });

    expect(groupMetricsByCategory(metrics, readModel.metricObservationCapability)).toEqual({
      other: ['rmse', 'custom_metric'],
      noise: ['snr_estimate'],
      energy: ['l2_norm'],
      quality: ['nan_count'],
      chemometric: ['distance_to_centroid'],
    });
  });

  it('counts pass samples for direct and inverted filters', () => {
    const filter: MetricFilter = {
      metric: 'l2_norm',
      min: 2,
      max: 10,
      invert: false,
    };

    expect(countMetricFilterPasses([1, 5, 9, 11], filter)).toBe(2);
    expect(countMetricFilterPasses([1, 5, 9, 11], { ...filter, invert: true })).toBe(2);
    expect(countMetricFilterPasses([1, 5, 9, 11])).toBe(4);
  });

  it('counts samples passing all active metric filters', () => {
    expect(countFilteredMetricSamples(metrics, [], 4)).toBe(4);
    expect(countFilteredMetricSamples(metrics, [
      { metric: 'l2_norm', min: 2, max: 10, invert: false },
      { metric: 'nan_count', max: 0, invert: false },
    ], 4)).toBe(1);
    expect(countFilteredMetricSamples(metrics, [
      { metric: 'l2_norm', min: 2, max: 10, invert: true },
    ], 4)).toBe(2);
  });

  it('replaces filters by metric while preserving unrelated filters', () => {
    const activeFilters: MetricFilter[] = [
      { metric: 'l2_norm', min: 1, invert: false },
      { metric: 'snr_estimate', min: 5, invert: false },
    ];

    expect(replaceMetricFilter(activeFilters, 'l2_norm', { metric: 'l2_norm', max: 8, invert: true })).toEqual([
      { metric: 'snr_estimate', min: 5, invert: false },
      { metric: 'l2_norm', max: 8, invert: true },
    ]);
    expect(replaceMetricFilter(activeFilters, 'l2_norm', undefined)).toEqual([
      { metric: 'snr_estimate', min: 5, invert: false },
    ]);
  });

  it('builds preset filters and category counts', () => {
    expect(getMetricPresetFilters('typical', metrics)).toEqual([
      { metric: 'l2_norm', min: 1, max: 9, invert: false },
      { metric: 'snr_estimate', min: 1, max: 9, invert: false },
    ]);
    expect(getMetricPresetFilters('outliers', metrics)).toEqual([
      { metric: 'distance_to_centroid', min: 0.9, max: undefined, invert: false },
    ]);
    expect(getMetricPresetFilters('missing', metrics)).toBeNull();
    expect(countActiveMetricFiltersByCategory([
      { metric: 'l2_norm', min: 1, invert: false },
      { metric: 'snr_estimate', min: 5, invert: false },
    ], 'energy')).toBe(1);
  });
});
