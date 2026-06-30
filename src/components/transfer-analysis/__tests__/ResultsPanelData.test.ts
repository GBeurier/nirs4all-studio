import { describe, expect, it } from 'vitest';
import {
  formatTransferReduction,
  getActivePreprocessingKey,
  getDistanceRows,
  getHeatmapPreprocessingKey,
  getPreprocessingOptions,
  getResultsPanelChartModel,
  getResultsPanelControlsModel,
  getResultsPanelDatasetBadges,
  getResultsPanelSummaryModel,
} from '../ResultsPanelData';
import type {
  DatasetPairDistance,
  MetricConvergenceItem,
  PCACoordinate,
  PreprocessingRankingItem,
  TransferAnalysisResponse,
} from '@/types/transfer';

const datasets = [
  { id: 'ds-1', name: 'Corn', n_samples: 10, n_features: 100 },
  { id: 'ds-2', name: 'Wheat', n_samples: 12, n_features: 110 },
  { id: 'ds-3', name: 'Soy', n_samples: 14, n_features: 120 },
  { id: 'ds-4', name: 'Barley', n_samples: 16, n_features: 130 },
];

const rawDistance: DatasetPairDistance = {
  dataset_1: 'ds-1',
  dataset_2: 'ds-2',
  centroid_dist_raw: 4,
  centroid_dist_pp: 3,
  centroid_improvement: 25,
  spread_dist_raw: 2,
  spread_dist_pp: 1.5,
  spread_improvement: 12,
};

const snvDistance: DatasetPairDistance = {
  ...rawDistance,
  centroid_dist_pp: 2,
  centroid_improvement: 50,
};

const centroidRanking: PreprocessingRankingItem = {
  preproc: 'snv',
  display_name: 'SNV',
  avg_distance: 2,
  reduction_pct: 50,
  raw_distance: 4,
};

const rawPca: PCACoordinate = {
  sample_index: 0,
  dataset: 'Corn',
  x: 1,
  y: 2,
};

const snvPca: PCACoordinate = {
  ...rawPca,
  x: 3,
};

const convergence: MetricConvergenceItem = {
  preproc: 'snv',
  metric: 'centroid',
  var_raw: 4,
  var_pp: 2,
  convergence: 50,
};

function transferResults(overrides: Partial<TransferAnalysisResponse> = {}): TransferAnalysisResponse {
  return {
    success: true,
    execution_time_ms: 123.6,
    distance_matrices: {
      '': [rawDistance],
      snv: [snvDistance],
    },
    preprocessing_ranking: {
      centroid: [centroidRanking],
    },
    pca_coordinates: {
      raw: [rawPca],
      snv: [snvPca],
    },
    metric_convergence: [convergence],
    summary: {
      best_preprocessing: 'SNV',
      best_reduction_pct: 12.34,
      n_datasets: 4,
      n_preprocessings: 3,
      n_pairs: 6,
    },
    datasets,
    preprocessings: ['raw', 'snv', 'msc'],
    ...overrides,
  };
}

describe('ResultsPanelData', () => {
  it('formats the summary, execution time, and positive reduction', () => {
    const summary = getResultsPanelSummaryModel(transferResults());

    expect(summary.description).toBe('4 datasets, 3 preprocessings, 6 pairwise comparisons');
    expect(summary.executionTimeLabel).toBe('124ms');
    expect(summary.bestPreprocessing).toBe('SNV');
    expect(summary.reduction).toEqual({
      label: '+12.3%',
      tone: 'positive',
      className: 'text-green-600',
    });
    expect(summary.preprocessingsTestedLabel).toBe('3 tested');
  });

  it('formats negative reductions without a positive sign', () => {
    expect(formatTransferReduction(-7.86)).toEqual({
      label: '-7.9%',
      tone: 'negative',
      className: 'text-red-600',
    });
  });

  it('limits dataset badges to 3 and adds overflow', () => {
    expect(getResultsPanelDatasetBadges(datasets)).toEqual({
      datasetBadges: [
        { id: 'ds-1', label: 'Corn' },
        { id: 'ds-2', label: 'Wheat' },
        { id: 'ds-3', label: 'Soy' },
      ],
      datasetOverflowLabel: '+1',
    });

    expect(getResultsPanelDatasetBadges(datasets.slice(0, 3))).toEqual({
      datasetBadges: [
        { id: 'ds-1', label: 'Corn' },
        { id: 'ds-2', label: 'Wheat' },
        { id: 'ds-3', label: 'Soy' },
      ],
      datasetOverflowLabel: null,
    });
  });

  it('builds preprocessing options and select value for the controls', () => {
    expect(getPreprocessingOptions(['raw', 'snv'])).toEqual([
      { value: 'raw', label: 'raw' },
      { value: 'snv', label: 'snv' },
    ]);

    expect(getResultsPanelControlsModel(transferResults(), null)).toMatchObject({
      activePreprocessingSelectValue: '',
      preprocessingOptions: [
        { value: 'raw', label: 'raw' },
        { value: 'snv', label: 'snv' },
        { value: 'msc', label: 'msc' },
      ],
    });
  });

  it('preserves heatmap and PCA preprocessing key behavior', () => {
    expect(getHeatmapPreprocessingKey(null)).toBe('');
    expect(getHeatmapPreprocessingKey('snv')).toBe('snv');
    expect(getActivePreprocessingKey(null)).toBe('raw');
    expect(getActivePreprocessingKey('snv')).toBe('snv');
  });

  it('builds chart data with fallbacks for missing metric and preprocessing keys', () => {
    const results = transferResults();
    const rawModel = getResultsPanelChartModel(results, 'spread', null);

    expect(rawModel.ranking).toEqual([]);
    expect(rawModel.datasetNames).toEqual(['Corn', 'Wheat', 'Soy', 'Barley']);
    expect(rawModel.distanceRows).toEqual([rawDistance]);
    expect(rawModel.pcaCoordinates).toEqual([rawPca]);
    expect(rawModel.convergenceData).toEqual([convergence]);

    const missingPreprocessingModel = getResultsPanelChartModel(results, 'centroid', 'missing');
    expect(missingPreprocessingModel.distanceRows).toEqual([]);
    expect(missingPreprocessingModel.pcaCoordinates).toEqual([]);
  });

  it('returns distance fallbacks directly from the heatmap key helper', () => {
    expect(getDistanceRows(transferResults(), 'missing')).toEqual([]);
  });
});
