import { describe, expect, it } from 'vitest';

import {
  buildPlaygroundChartAvailabilityReadModel,
  getPlaygroundChartDisabledReason,
  isPlaygroundChartAvailable,
  isPlaygroundChartDisabled,
  shouldRecommendPlaygroundChart,
} from '@/lib/playground/chartAvailability';
import type { PlaygroundDataViewProjection } from '@/lib/playground/dataViewProjection';
import type { PipelineExecutionMetricObservation } from '@/lib/pipelineExecutionContract';
import type { MetricStats, MetricsResult, PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

function createResult(overrides: Partial<PlaygroundResult> = {}): PlaygroundResult {
  return {
    original: {
      spectra: [],
      wavelengths: [],
      shape: [0, 0],
    },
    processed: {
      spectra: [],
      wavelengths: [],
      shape: [0, 0],
    },
    executionTimeMs: 0,
    trace: [],
    errors: [],
    ...overrides,
  };
}

function dataView(overrides: Partial<PlaygroundDataViewProjection> = {}): PlaygroundDataViewProjection {
  return {
    id: 'd1:view:default',
    label: 'Default view',
    source: 'schema-ref',
    representationIds: ['d1:representation:spectra'],
    sampleCount: 2,
    featureCount: 2,
    targetColumn: 'target',
    metadataColumns: [],
    repetitionColumn: null,
    sourceCount: 1,
    isSpectralCompatible: true,
    ...overrides,
  };
}

function metricStats(overrides: Partial<MetricStats> = {}): MetricStats {
  return {
    min: 0,
    max: 10,
    mean: 5,
    std: 1,
    p5: 1,
    p25: 3,
    p50: 5,
    p75: 7,
    p95: 9,
    ...overrides,
  };
}

function metrics(overrides: Partial<MetricsResult> = {}): MetricsResult {
  return {
    values: {
      custom_bias: [0.1, 0.2],
    },
    statistics: {
      custom_bias: metricStats({ mean: 0.15 }),
    },
    computed_metrics: ['custom_bias'],
    available_metrics: [],
    n_samples: 2,
    ...overrides,
  };
}

function observation(key: string): PipelineExecutionMetricObservation {
  return {
    key,
    label: key,
    value: 1,
    source: 'read-model',
  };
}

describe('playground chart availability', () => {
  it('suppresses spectral chart availability for non-spectral projections', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2]],
      wavelengths: [1100, 1200],
      y: [10],
    };

    expect(isPlaygroundChartAvailable('spectra', {
      rawData,
      result: null,
      dataView: dataView({
        representationIds: ['d1:representation:metadata'],
        isSpectralCompatible: false,
      }),
    })).toBe(false);
  });

  it('accepts processed target values for histogram availability', () => {
    const result = createResult({
      processed: {
        spectra: [],
        wavelengths: [],
        y: [1, 2],
        shape: [2, 0],
      },
    });

    expect(isPlaygroundChartAvailable('histogram', {
      rawData: null,
      result,
    })).toBe(true);
    expect(isPlaygroundChartDisabled('histogram', {
      rawData: null,
      result,
    })).toBe(false);
    expect(getPlaygroundChartDisabledReason('histogram', {
      rawData: null,
      result,
    })).toBeNull();
  });

  it('treats source partitions as fold-distribution data', () => {
    const result = createResult({
      source_partitions: {
        has_test: true,
        n_train: 2,
        n_test: 1,
      },
    });

    expect(isPlaygroundChartAvailable('folds', {
      rawData: null,
      result,
    })).toBe(true);
    expect(shouldRecommendPlaygroundChart('folds', {
      rawData: null,
      result,
    })).toBe(true);
  });

  it('keeps repetition disabled reasons tied to backend repetition status', () => {
    const result = createResult({
      repetitions: {
        has_repetitions: false,
        n_bio_samples: 0,
        n_with_reps: 0,
        message: 'No configured repetition column',
      },
    });

    expect(isPlaygroundChartAvailable('repetitions', {
      rawData: null,
      result,
    })).toBe(true);
    expect(isPlaygroundChartDisabled('repetitions', {
      rawData: null,
      result,
    })).toBe(true);
    expect(getPlaygroundChartDisabledReason('repetitions', {
      rawData: null,
      result,
    })).toBe('No configured repetition column');
  });

  it('exposes explicit metric observations without making render-only charts available', () => {
    const readModel = buildPlaygroundChartAvailabilityReadModel({
      rawData: null,
      result: null,
      metricObservations: [
        observation('rmse'),
        observation('r2'),
      ],
    });

    expect(readModel).toMatchObject({
      hasMetricObservations: true,
      hasFilterableMetrics: false,
      hasDimensionReduction: false,
      hasTargetValues: false,
    });
    expect(readModel.metricKeys).toEqual(['r2', 'rmse']);
    expect(isPlaygroundChartAvailable('pca', {
      rawData: null,
      result: null,
      metricObservations: [observation('rmse')],
    })).toBe(false);
  });

  it('projects legacy metrics into the chart availability read model', () => {
    const readModel = buildPlaygroundChartAvailabilityReadModel({
      rawData: null,
      result: createResult({
        metrics: metrics(),
      }),
    });

    expect(readModel).toMatchObject({
      hasMetricObservations: true,
      hasFilterableMetrics: true,
    });
    expect(readModel.metricKeys).toEqual(['custom_bias']);
  });
});
