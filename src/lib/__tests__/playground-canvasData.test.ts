import { describe, expect, it } from 'vitest';

import {
  buildEffectivePlaygroundFolds,
  buildPartitionIndexSets,
  buildPlaygroundTargetView,
  getColumnarPlaygroundMetadata,
  getMetadataColumnNames,
  hasPlaygroundFolds,
  hasPlaygroundPartition,
} from '@/lib/playground/canvasData';
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

function dataViewProjection(overrides: Partial<PlaygroundDataViewProjection> = {}): PlaygroundDataViewProjection {
  return {
    id: 'd1:view:default',
    label: 'Default spectral view',
    source: 'schema-ref',
    representationIds: ['d1:representation:spectra'],
    sampleCount: 2,
    featureCount: 1,
    targetColumn: 'protein',
    metadataColumns: ['batch', 'operator'],
    repetitionColumn: 'sample_id',
    sourceCount: 1,
    isSpectralCompatible: true,
    ...overrides,
  };
}

describe('playground canvas data adapters', () => {
  it('builds target range and classification metadata from processed targets first', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2]],
      wavelengths: [1100],
      y: [100, 200],
    };
    const result = createResult({
      processed: {
        spectra: [[1], [2], [3], [4]],
        wavelengths: [1100],
        y: [0, 1, 0, 1],
        shape: [4, 1],
      },
    });

    const view = buildPlaygroundTargetView(rawData, result);

    expect(view.yValues).toEqual([0, 1, 0, 1]);
    expect(view.yMin).toBe(0);
    expect(view.yMax).toBe(1);
    expect(view.targetType).toBe('classification');
    expect(view.classLabels).toEqual(['0', '1']);
    expect(view.classLabelMap?.get('1')).toBe(1);
  });

  it('keeps target labels from the data-view projection', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2]],
      wavelengths: [1100],
      y: [100, 200],
    };

    expect(buildPlaygroundTargetView(rawData, null, dataViewProjection()).targetColumn).toBe('protein');
  });

  it('prefers processed metadata and falls back to raw row metadata', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2]],
      wavelengths: [1100],
      y: [1, 2],
      metadata: [
        { batch: 'a', repetition: 1 },
        { batch: 'b', repetition: 2 },
      ],
    };

    expect(getColumnarPlaygroundMetadata(rawData, null)).toEqual({
      batch: ['a', 'b'],
      repetition: [1, 2],
    });

    const result = createResult({
      processed: {
        spectra: [[1]],
        wavelengths: [1100],
        metadata: {
          batch: ['processed'],
        },
        shape: [1, 1],
      },
    });

    expect(getColumnarPlaygroundMetadata(rawData, result)).toEqual({
      batch: ['processed'],
    });
  });

  it('uses projection metadata column names when row metadata is not loaded yet', () => {
    expect(getMetadataColumnNames(undefined, dataViewProjection())).toEqual(['batch', 'operator']);
    expect(getMetadataColumnNames({ batch: ['a'] }, dataViewProjection())).toEqual(['batch']);
  });

  it('detects partitions and real fold availability', () => {
    expect(hasPlaygroundPartition(createResult({
      source_partitions: { has_test: true, n_train: 2, n_test: 1 },
    }))).toBe(true);
    expect(hasPlaygroundPartition(createResult({
      folds: {
        splitter_name: 'Split',
        n_folds: 1,
        kind: 'test_split',
        folds: [],
      },
    }))).toBe(true);
    expect(hasPlaygroundFolds(createResult({
      folds: {
        splitter_name: 'KFold',
        n_folds: 3,
        fold_labels: [0, 1, 2],
        folds: [],
      },
    }))).toBe(true);
    expect(hasPlaygroundFolds(createResult({
      folds: {
        splitter_name: 'Split',
        n_folds: 1,
        fold_labels: [0, 0, 0],
        folds: [],
      },
    }))).toBe(false);
  });

  it('synthesizes missing fold labels from fold test indices', () => {
    const result = createResult({
      folds: {
        splitter_name: 'KFold',
        n_folds: 2,
        folds: [
          { fold_index: 0, train_count: 2, test_count: 1, train_indices: [1, 2], test_indices: [0] },
          { fold_index: 1, train_count: 2, test_count: 1, train_indices: [0, 2], test_indices: [1] },
        ],
      },
    });

    expect(buildEffectivePlaygroundFolds(result, 3)?.fold_labels).toEqual([0, 1, -1]);
  });

  it('synthesizes source partitions and matching train/test index sets', () => {
    const result = createResult({
      source_partitions: {
        has_test: true,
        n_train: 2,
        n_test: 1,
      },
    });

    const folds = buildEffectivePlaygroundFolds(result, 3, [10, 20, 30]);

    expect(folds).toMatchObject({
      splitter_name: 'Source Partition',
      n_folds: 1,
      folds: [{
        train_indices: [0, 1],
        test_indices: [2],
        y_train_stats: {
          mean: 15,
          min: 10,
          max: 20,
        },
        y_test_stats: {
          mean: 30,
          min: 30,
          max: 30,
        },
      }],
    });

    const { trainIndices, testIndices } = buildPartitionIndexSets(result.source_partitions, folds);

    expect(Array.from(trainIndices ?? [])).toEqual([0, 1]);
    expect(Array.from(testIndices ?? [])).toEqual([2]);
  });
});
