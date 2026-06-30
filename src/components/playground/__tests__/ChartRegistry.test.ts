import { describe, expect, it } from 'vitest';

import {
  buildEffectiveVisibility,
  chartRegistry,
  computeRecommendedVisibility,
  getToggleableCharts,
} from '@/components/playground/ChartRegistry';
import { ALL_CHARTS } from '@/context/usePlaygroundView';
import { PLAYGROUND_CHART_IDS } from '@/lib/playground/chartIds';
import type { PlaygroundDataViewProjection } from '@/lib/playground/dataViewProjection';
import type { PlaygroundResult } from '@/types/playground';
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

const nonSpectralDataView: PlaygroundDataViewProjection = {
  id: 'd1:view:metadata',
  label: 'Metadata view',
  source: 'schema-ref',
  representationIds: ['d1:representation:metadata'],
  sampleCount: 2,
  featureCount: 0,
  targetColumn: 'target',
  metadataColumns: ['batch'],
  repetitionColumn: null,
  sourceCount: 1,
  isSpectralCompatible: false,
};

describe('ChartRegistry data-view aware availability', () => {
  it('keeps built-in chart ids aligned with the shared chart id registry', () => {
    expect(ALL_CHARTS).toEqual([...PLAYGROUND_CHART_IDS]);
    expect(getToggleableCharts(null).map(chart => chart.id)).toEqual([...PLAYGROUND_CHART_IDS]);
  });

  it('keeps existing two-argument availability compatible', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2]],
      wavelengths: [1100, 1200],
      y: [10],
    };

    expect(chartRegistry.isAvailable('spectra', null, rawData)).toBe(true);
    expect(chartRegistry.isDisabled('histogram', null, rawData)).toBe(false);
  });

  it('accepts centralized availability context inputs', () => {
    const result = createResult({
      processed: {
        spectra: [],
        wavelengths: [],
        y: [1, 2],
        shape: [2, 0],
      },
    });
    const context = {
      result,
      rawData: null,
      metricObservations: [
        {
          key: 'rmse',
          label: 'RMSE',
          value: 0.4,
          source: 'read-model' as const,
        },
      ],
    };

    expect(chartRegistry.isAvailable('histogram', context)).toBe(true);
    expect(chartRegistry.isDisabled('histogram', context)).toBe(false);
    expect(chartRegistry.getDisabledReason('histogram', context)).toBeNull();
    expect(buildEffectiveVisibility({
      histogram: true,
      pca: true,
    }, context)).toEqual({
      histogram: true,
      pca: false,
    });
  });

  it('uses a prebuilt availability read model when the context provides one', () => {
    const context = {
      result: null,
      rawData: null,
      availability: {
        hasSpectralMatrix: false,
        hasTargetValues: true,
        hasDimensionReduction: false,
        hasFoldDistribution: true,
        hasRepetitionResult: false,
        hasFilterableMetrics: false,
        hasMetricObservations: false,
        metricKeys: [],
      },
    };

    expect(chartRegistry.isAvailable('histogram', context)).toBe(true);
    expect(chartRegistry.isDisabled('histogram', context)).toBe(false);
    expect(chartRegistry.getDisabledReason('histogram', context)).toBeNull();
    expect(computeRecommendedVisibility({
      folds: false,
      histogram: false,
    }, context)).toMatchObject({
      folds: true,
      histogram: false,
    });
  });

  it('applies optional data-view compatibility to effective visibility', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2]],
      wavelengths: [1100, 1200],
      y: [10],
    };

    expect(chartRegistry.isAvailable('spectra', null, rawData, nonSpectralDataView)).toBe(false);
    expect(buildEffectiveVisibility({
      spectra: true,
      histogram: true,
    }, null, rawData, nonSpectralDataView)).toEqual({
      spectra: false,
      histogram: true,
    });
  });

  it('recommends fold visibility for source partitions and exposes disabled toggle state', () => {
    const result = createResult({
      source_partitions: {
        has_test: true,
        n_train: 2,
        n_test: 1,
      },
    });

    expect(computeRecommendedVisibility({
      folds: false,
      repetitions: false,
    }, result, null)).toMatchObject({
      folds: true,
      repetitions: false,
    });

    const foldsToggle = getToggleableCharts(result, null).find((chart) => chart.id === 'folds');
    expect(foldsToggle).toMatchObject({
      disabled: false,
      disabledReason: null,
    });
  });

  it('preserves custom chart callbacks outside the built-in chart read model', () => {
    const customId = 'custom-context-chart';
    const icon = chartRegistry.get('spectra')?.icon;
    if (!icon) throw new Error('Expected spectra chart icon to be registered');

    chartRegistry.register({
      id: customId,
      name: 'Custom Context Chart',
      icon,
      component: () => null,
      requiresData: (_result, _rawData, dataView) => dataView?.id === nonSpectralDataView.id,
      isDisabled: () => true,
      disabledReason: () => 'Custom disabled',
      defaultVisible: false,
      priority: 999,
      category: 'advanced',
    });

    try {
      const context = {
        result: null,
        rawData: null,
        dataView: nonSpectralDataView,
      };

      expect(chartRegistry.isAvailable(customId, context)).toBe(true);
      expect(getToggleableCharts(context).find((chart) => chart.id === customId)).toMatchObject({
        disabled: true,
        disabledReason: 'Custom disabled',
      });
    } finally {
      chartRegistry.unregister(customId);
    }
  });

  it('supports context-first callbacks for custom chart extensions', () => {
    const customId = 'custom-context-first-chart';
    const icon = chartRegistry.get('spectra')?.icon;
    if (!icon) throw new Error('Expected spectra chart icon to be registered');

    chartRegistry.register({
      id: customId,
      name: 'Custom Context First Chart',
      icon,
      component: () => null,
      requiresDataContext: (context) => Boolean(context.availability?.hasMetricObservations),
      isDisabledContext: (context) => !context.availability?.hasFilterableMetrics,
      disabledReasonContext: (context) => (
        context.availability?.hasFilterableMetrics ? null : 'No filterable metrics'
      ),
      defaultVisible: false,
      priority: 999,
      category: 'advanced',
    });

    try {
      const unavailableContext = {
        result: null,
        rawData: null,
        availability: {
          hasSpectralMatrix: false,
          hasTargetValues: false,
          hasDimensionReduction: false,
          hasFoldDistribution: false,
          hasRepetitionResult: false,
          hasFilterableMetrics: false,
          hasMetricObservations: true,
          metricKeys: ['rmse'],
        },
      };
      const availableContext = {
        ...unavailableContext,
        availability: {
          ...unavailableContext.availability,
          hasFilterableMetrics: true,
        },
      };

      expect(chartRegistry.isAvailable(customId, availableContext)).toBe(true);
      expect(chartRegistry.isDisabled(customId, unavailableContext)).toBe(true);
      expect(chartRegistry.getDisabledReason(customId, unavailableContext)).toBe('No filterable metrics');
      expect(getToggleableCharts(availableContext).find((chart) => chart.id === customId)).toMatchObject({
        disabled: false,
        disabledReason: null,
      });
    } finally {
      chartRegistry.unregister(customId);
    }
  });
});
