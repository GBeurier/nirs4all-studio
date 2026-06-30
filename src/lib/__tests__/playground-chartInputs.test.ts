import { describe, expect, it } from 'vitest';

import {
  buildDimensionReductionChartInput,
  buildEmbeddingOverlayInput,
  buildFoldDistributionChartInput,
  buildHistogramChartInput,
  buildPlaygroundChartInputReadModel,
  buildPlaygroundChartExportInput,
  buildRepetitionsChartInput,
  buildSampleDetailsData,
  buildSpectraChartInput,
} from '@/lib/playground/chartInputs';
import type { PlaygroundDataViewProjection } from '@/lib/playground/dataViewProjection';
import type { PipelineExecutionMetricObservation } from '@/lib/pipelineExecutionContract';
import type { MetricStats, MetricsResult, PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

function createResult(overrides: Partial<PlaygroundResult> = {}): PlaygroundResult {
  return {
    original: {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      shape: [2, 2],
    },
    processed: {
      spectra: [[10, 20], [30, 40]],
      wavelengths: [1110, 1210],
      shape: [2, 2],
    },
    executionTimeMs: 0,
    trace: [],
    errors: [],
    ...overrides,
  };
}

function dataViewProjection(overrides: Partial<PlaygroundDataViewProjection> = {}): PlaygroundDataViewProjection {
  return {
    id: 'd1:view:default',
    label: 'Default spectral view',
    source: 'schema-ref',
    representationIds: ['d1:representation:spectra'],
    sampleCount: 2,
    featureCount: 2,
    targetColumn: 'protein',
    metadataColumns: ['batch', 'operator'],
    repetitionColumn: 'sample_id',
    sourceCount: 1,
    isSpectralCompatible: true,
    ...overrides,
  };
}

function metricStats(overrides: Partial<MetricStats> = {}): MetricStats {
  return {
    min: 0,
    max: 1,
    mean: 0.5,
    std: 0.1,
    p5: 0.1,
    p25: 0.25,
    p50: 0.5,
    p75: 0.75,
    p95: 0.95,
    ...overrides,
  };
}

function metrics(overrides: Partial<MetricsResult> = {}): MetricsResult {
  return {
    values: {
      custom_bias: [0.2, 0.3],
    },
    statistics: {
      custom_bias: metricStats({ mean: 0.25 }),
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

describe('playground chart input builders', () => {
  it('builds a chart input read model from centralized availability and metric capabilities', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
    };
    const result = createResult({
      processed: {
        spectra: [[10, 20], [30, 40]],
        wavelengths: [1110, 1210],
        y: [12, 34],
        shape: [2, 2],
      },
      pca: {
        coordinates: [[0, 1], [1, 0]],
        explained_variance_ratio: [0.8, 0.2],
        explained_variance: [8, 2],
        n_components: 2,
      },
      source_partitions: {
        has_test: true,
        n_train: 1,
        n_test: 1,
      },
      repetitions: {
        has_repetitions: true,
        n_bio_samples: 1,
        n_with_reps: 1,
      },
      metrics: metrics(),
      metricObservations: [observation('explicit_score')],
    });

    expect(buildPlaygroundChartInputReadModel({
      rawData,
      result,
      dataView: dataViewProjection(),
    })).toEqual({
      dataAvailability: {
        hasSpectraData: true,
        hasHistogramData: true,
        hasDimensionReductionData: true,
        hasFoldDistributionData: true,
        hasRepetitionData: true,
      },
      metricObservationCapability: {
        hasFilterableMetrics: true,
        hasMetricObservations: true,
        metricKeys: ['custom_bias', 'explicit_score'],
      },
    });
  });

  it('uses centralized spectral compatibility when reporting chart data availability', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2]],
      wavelengths: [1100, 1200],
      y: [10],
    };

    expect(buildPlaygroundChartInputReadModel({
      rawData,
      result: null,
      dataView: dataViewProjection({
        representationIds: ['d1:representation:metadata'],
        isSpectralCompatible: false,
      }),
    }).dataAvailability).toEqual({
      hasSpectraData: false,
      hasHistogramData: true,
      hasDimensionReductionData: false,
      hasFoldDistributionData: false,
      hasRepetitionData: false,
    });
  });

  it('exposes explicit metric observation capability without legacy chart data', () => {
    expect(buildPlaygroundChartInputReadModel({
      rawData: null,
      result: null,
      metricObservations: [
        observation('rmse'),
        observation('r2'),
      ],
    })).toEqual({
      dataAvailability: {
        hasSpectraData: false,
        hasHistogramData: false,
        hasDimensionReductionData: false,
        hasFoldDistributionData: false,
        hasRepetitionData: false,
      },
      metricObservationCapability: {
        hasFilterableMetrics: false,
        hasMetricObservations: true,
        metricKeys: ['r2', 'rmse'],
      },
    });
  });

  it('builds raw spectra chart input without backend result', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
      sampleIds: ['s1', 's2'],
      wavelengthUnit: 'nm',
    };

    expect(buildSpectraChartInput({
      rawData,
      result: null,
      yValues: rawData.y,
      effectiveFolds: null,
      columnMetadata: { batch: ['a', 'b'] },
      metadataColumns: ['batch'],
    })).toEqual({
      original: {
        spectra: [[1, 2], [3, 4]],
        wavelengths: [1100, 1200],
        shape: [2, 2],
        header_unit: 'nm',
      },
      processed: {
        spectra: [[1, 2], [3, 4]],
        wavelengths: [1100, 1200],
        shape: [2, 2],
        header_unit: 'nm',
      },
      y: [10, 20],
      sampleIds: ['s1', 's2'],
      folds: undefined,
      metadata: { batch: ['a', 'b'] },
      metadataColumns: ['batch'],
    });
  });

  it('uses projection metadata columns for spectral chart inputs when caller has no explicit columns', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
      sampleIds: ['s1', 's2'],
    };

    expect(buildSpectraChartInput({
      rawData,
      result: null,
      yValues: rawData.y,
      effectiveFolds: null,
      columnMetadata: { batch: ['a', 'b'], operator: ['op1', 'op2'] },
      dataView: dataViewProjection(),
    })?.metadataColumns).toEqual(['batch', 'operator']);
  });

  it('suppresses spectral chart, sample-detail, and export matrices for non-spectral projections', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
      sampleIds: ['s1', 's2'],
    };
    const dataView = dataViewProjection({
      representationIds: ['d1:representation:metadata'],
      isSpectralCompatible: false,
    });

    expect(buildSpectraChartInput({
      rawData,
      result: null,
      yValues: rawData.y,
      effectiveFolds: null,
      dataView,
    })).toBeNull();
    expect(buildSampleDetailsData(rawData, null, rawData.y, dataView)).toBeNull();
    expect(buildPlaygroundChartExportInput({
      rawData,
      result: null,
      selectedSamples: new Set([0]),
      pinnedSamples: new Set([1]),
      dataView,
    })).toMatchObject({
      spectra: null,
      wavelengths: null,
      sampleIds: undefined,
    });
  });

  it('builds result-backed spectra chart input and prefers processed sample ids', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
      sampleIds: ['raw-1', 'raw-2'],
    };
    const result = createResult({
      processed: {
        spectra: [[10, 20]],
        wavelengths: [1110, 1210],
        sample_ids: ['processed-1'],
        shape: [1, 2],
      },
    });

    expect(buildSpectraChartInput({
      rawData,
      result,
      yValues: [10],
      effectiveFolds: null,
    })?.sampleIds).toEqual(['processed-1']);
  });

  it('drops raw sample identity when processed rows no longer align', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2], [3]],
      wavelengths: [1100],
      y: [10, 20, 30],
      sampleIds: ['raw-1', 'raw-2', 'raw-3'],
      metadata: [{ batch: 'a' }, { batch: 'b' }, { batch: 'c' }],
    };
    const result = createResult({
      original: {
        spectra: [[1], [2], [3]],
        wavelengths: [1100],
        shape: [3, 1],
      },
      processed: {
        spectra: [[10], [20]],
        wavelengths: [1200],
        shape: [2, 1],
      },
      pca: {
        coordinates: [[0, 1], [1, 0]],
        explained_variance_ratio: [0.8, 0.2],
        explained_variance: [8, 2],
        n_components: 2,
      },
      repetitions: {
        has_repetitions: true,
        n_bio_samples: 1,
        n_with_reps: 1,
      },
    });
    const dataView = dataViewProjection({ sampleCount: 2, featureCount: 1 });

    expect(buildSpectraChartInput({
      rawData,
      result,
      yValues: [11, 22],
      effectiveFolds: null,
      dataView,
    })?.sampleIds).toBeUndefined();

    expect(buildDimensionReductionChartInput({
      result,
      rawData,
      yValues: [11, 22],
      effectiveFolds: null,
      dataView,
    })?.sampleIds).toBeUndefined();

    expect(buildRepetitionsChartInput({
      result,
      rawData,
      yValues: [11, 22],
      dataView,
    })?.sampleIds).toBeUndefined();

    expect(buildPlaygroundChartExportInput({
      rawData,
      result,
      selectedSamples: new Set([0]),
      pinnedSamples: new Set([1]),
      dataView,
    }).sampleIds).toBeUndefined();

    expect(buildSampleDetailsData(rawData, result, [11, 22], dataView)).toMatchObject({
      spectra: [[10], [20]],
      sampleIds: undefined,
      metadata: undefined,
      originalSpectra: [[10], [20]],
      originalY: [11, 22],
    });
  });

  it('builds sample details data with processed metadata rows when available', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
      sampleIds: ['raw-1', 'raw-2'],
      metadata: [{ batch: 'raw-a' }, { batch: 'raw-b' }],
    };
    const result = createResult({
      processed: {
        spectra: [[10, 20], [30, 40]],
        wavelengths: [1110, 1210],
        sample_ids: ['processed-1', 'processed-2'],
        metadata: {
          batch: ['processed-a', 'processed-b'],
          score: [1, 2],
        },
        shape: [2, 2],
      },
    });

    expect(buildSampleDetailsData(rawData, result, [12, 34])).toMatchObject({
      wavelengths: [1110, 1210],
      spectra: [[10, 20], [30, 40]],
      y: [12, 34],
      sampleIds: ['processed-1', 'processed-2'],
      metadata: [
        { batch: 'processed-a', score: 1 },
        { batch: 'processed-b', score: 2 },
      ],
      originalSpectra: [[1, 2], [3, 4]],
      originalY: [12, 34],
    });
  });

  it('builds secondary chart inputs with row-aligned processed fields', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
      sampleIds: ['raw-1', 'raw-2'],
    };
    const folds = {
      splitter_name: 'KFold',
      n_folds: 2,
      fold_labels: [0, 1],
      folds: [
        { fold_index: 0, train_count: 1, test_count: 1, train_indices: [1], test_indices: [0] },
        { fold_index: 1, train_count: 1, test_count: 1, train_indices: [0], test_indices: [1] },
      ],
    };
    const result = createResult({
      processed: {
        spectra: [[10, 20], [30, 40]],
        wavelengths: [1110, 1210],
        sample_ids: ['processed-1', 'processed-2'],
        shape: [2, 2],
      },
      pca: {
        coordinates: [[0, 1], [1, 0]],
        explained_variance_ratio: [0.8, 0.2],
        explained_variance: [8, 2],
        n_components: 2,
      },
      umap: {
        coordinates: [[2, 3], [3, 2]],
        n_components: 2,
      },
      repetitions: {
        has_repetitions: true,
        n_bio_samples: 1,
        n_with_reps: 1,
      },
    });

    expect(buildHistogramChartInput([12, 34], folds, { batch: ['a', 'b'] })).toEqual({
      y: [12, 34],
      folds,
      metadata: { batch: ['a', 'b'] },
      hasYValues: true,
    });
    expect(buildFoldDistributionChartInput(folds, [12, 34], { batch: ['a', 'b'] })).toEqual({
      folds,
      y: [12, 34],
      metadata: { batch: ['a', 'b'] },
    });
    expect(buildDimensionReductionChartInput({
      result,
      rawData,
      yValues: [12, 34],
      effectiveFolds: folds,
      columnMetadata: { batch: ['a', 'b'] },
      referencePca: result.pca,
      referenceLabel: 'reference',
      dataView: dataViewProjection({ metadataColumns: ['batch'] }),
    })).toMatchObject({
      pca: result.pca,
      umap: result.umap,
      y: [12, 34],
      folds,
      sampleIds: ['processed-1', 'processed-2'],
      metadata: { batch: ['a', 'b'] },
      referencePca: result.pca,
      referenceLabel: 'reference',
    });
    expect(buildRepetitionsChartInput({
      result,
      rawData,
      yValues: [12, 34],
      columnMetadata: { batch: ['a', 'b'] },
      dataView: dataViewProjection({ metadataColumns: ['batch'] }),
    })).toEqual({
      repetitionData: result.repetitions,
      spectraData: [[10, 20], [30, 40]],
      y: [12, 34],
      metadata: { batch: ['a', 'b'] },
      metadataColumns: ['batch'],
      sampleIds: ['processed-1', 'processed-2'],
    });
  });

  it('lets histogram chart input availability come from the chart input read model', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2]],
      wavelengths: [1100, 1200],
      y: [10],
    };
    const readModel = buildPlaygroundChartInputReadModel({
      rawData,
      result: null,
      dataView: dataViewProjection(),
    });

    expect(buildHistogramChartInput([], null, undefined, readModel)).toEqual({
      y: [],
      folds: null,
      metadata: undefined,
      hasYValues: true,
    });
    expect(buildHistogramChartInput([], null).hasYValues).toBe(false);
  });

  it('lets secondary chart input availability come from the chart input read model', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
    };
    const folds = {
      splitter_name: 'KFold',
      n_folds: 2,
      fold_labels: [0, 1],
      folds: [
        { fold_index: 0, train_count: 1, test_count: 1, train_indices: [1], test_indices: [0] },
        { fold_index: 1, train_count: 1, test_count: 1, train_indices: [0], test_indices: [1] },
      ],
    };
    const result = createResult({
      pca: {
        coordinates: [[0, 1], [1, 0]],
        explained_variance_ratio: [0.8, 0.2],
        explained_variance: [8, 2],
        n_components: 2,
      },
      repetitions: {
        has_repetitions: true,
        n_bio_samples: 1,
        n_with_reps: 1,
      },
    });
    const unavailableReadModel = buildPlaygroundChartInputReadModel({
      rawData: null,
      result: null,
      dataView: dataViewProjection(),
    });

    expect(buildFoldDistributionChartInput(folds, [12, 34], undefined, unavailableReadModel)).toEqual({
      folds: null,
      y: [12, 34],
      metadata: undefined,
      hasFoldDistributionData: false,
    });
    expect(buildDimensionReductionChartInput({
      result,
      rawData,
      yValues: [12, 34],
      effectiveFolds: folds,
      dataView: dataViewProjection(),
      readModel: unavailableReadModel,
    })).toBeNull();
    expect(buildRepetitionsChartInput({
      result,
      rawData,
      yValues: [12, 34],
      dataView: dataViewProjection(),
      readModel: unavailableReadModel,
    })).toMatchObject({
      repetitionData: null,
      spectraData: undefined,
      hasRepetitionData: false,
    });
  });

  it('builds embedding overlay partitions and export data from aligned processed data', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2], [3]],
      wavelengths: [1100],
      y: [1, 2, 3],
      sampleIds: ['raw-1', 'raw-2', 'raw-3'],
    };
    const result = createResult({
      processed: {
        spectra: [[10], [20]],
        wavelengths: [1200],
        sample_ids: ['processed-1', 'processed-2'],
        shape: [2, 1],
      },
      pca: {
        coordinates: [[0, 1], [1, 0]],
        explained_variance_ratio: [0.8, 0.2],
        explained_variance: [8, 2],
        n_components: 2,
      },
    });

    expect(buildEmbeddingOverlayInput({
      result,
      yValues: [11, 22],
      trainIndices: new Set([0]),
      testIndices: new Set([1]),
      totalSamples: 2,
      sampleIds: ['processed-1', 'processed-2'],
    })).toEqual({
      embedding: [[0, 1], [1, 0]],
      partitions: ['Train', 'Test'],
      targets: [11, 22],
      sampleIds: ['processed-1', 'processed-2'],
      embeddingMethod: 'pca',
    });

    const exportInput = buildPlaygroundChartExportInput({
      rawData,
      result,
      selectedSamples: new Set([0]),
      pinnedSamples: new Set([1]),
      outlierIndices: [1],
    });

    expect(exportInput).toMatchObject({
      spectra: [[10], [20]],
      wavelengths: [1200],
      sampleIds: ['processed-1', 'processed-2'],
    });
    expect(Array.from(exportInput.selectedSamples)).toEqual([0]);
    expect(Array.from(exportInput.pinnedSamples)).toEqual([1]);
    expect(Array.from(exportInput.outlierIndices ?? [])).toEqual([1]);
  });
});
