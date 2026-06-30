import { describe, expect, it } from 'vitest';

import type { FoldsInfo } from '@/types/playground';
import {
  buildSpectraColorContext,
  buildSpectraSamplingResult,
  filterSpectraDisplayIndices,
  getSpectraOutlierSamples,
  selectSimilarSpectraSamples,
} from './spectraChartData';

const sampling = {
  strategy: 'random' as const,
  sampleCount: 0,
  seed: 7,
};

const spectra = [
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 10],
];

const oneFold: FoldsInfo = {
  splitter_name: 'split',
  n_folds: 1,
  folds: [
    {
      fold_index: 0,
      train_count: 2,
      test_count: 1,
      train_indices: [0, 2],
      test_indices: [1],
    },
  ],
  fold_labels: [0, 1, 0],
  kind: 'test_split',
};

describe('spectra chart pure state helpers', () => {
  it('keeps selected samples visible when sampling would omit them', () => {
    const result = buildSpectraSamplingResult({
      totalSamples: spectra.length,
      sampling,
      displayMode: 'individual',
      selectedSamples: new Set([4, 2, 99]),
      spectra,
      maxForcedSelection: 1,
    });

    expect(result.indices).toEqual([4]);
    expect(result.totalSamples).toBe(5);
    expect(result.wasApplied).toBe(true);
  });

  it('uses only selected in-range samples for selected-only mode', () => {
    const result = buildSpectraSamplingResult({
      totalSamples: spectra.length,
      sampling,
      displayMode: 'selected_only',
      selectedSamples: new Set([3, 1, 8]),
      spectra,
    });

    expect(result.indices).toEqual([3, 1]);
    expect(result.strategy).toBe('random');
  });

  it('filters display indices with the color context filter when present', () => {
    const indices = [0, 1, 2, 3];

    expect(filterSpectraDisplayIndices(indices)).toBe(indices);
    expect(filterSpectraDisplayIndices(indices, new Set([1, 3, 8]))).toEqual([1, 3]);
  });

  it('builds local color context from target, fold, metadata, and outlier inputs', () => {
    const outlierSamples = new Set([2]);
    const context = buildSpectraColorContext({
      yValues: [3, 1, 5],
      folds: oneFold,
      metadata: { batch: ['a', 'b', 'a'] },
      outlierSamples,
    });

    expect(context.yMin).toBe(1);
    expect(context.yMax).toBe(5);
    expect(context.trainIndices).toEqual(new Set([0, 2]));
    expect(context.testIndices).toEqual(new Set([1]));
    expect(context.foldLabels).toEqual([0, 1, 0]);
    expect(context.metadata).toEqual({ batch: ['a', 'b', 'a'] });
    expect(context.outlierIndices).toBe(outlierSamples);
  });

  it('preserves provided color context and omits partition sets for multi-fold data', () => {
    const providedContext = { y: [1], yMin: 1, yMax: 1 };
    expect(buildSpectraColorContext({
      colorContext: providedContext,
      outlierSamples: new Set([0]),
    })).toBe(providedContext);

    const multiFold = {
      ...oneFold,
      n_folds: 2,
      folds: [
        ...oneFold.folds,
        {
          fold_index: 1,
          train_count: 2,
          test_count: 1,
          train_indices: [1, 2],
          test_indices: [0],
        },
      ],
    };

    const context = buildSpectraColorContext({
      yValues: [1, 2, 3],
      folds: multiFold,
      outlierSamples: new Set(),
    });

    expect(context.trainIndices).toBeUndefined();
    expect(context.testIndices).toBeUndefined();
    expect(context.outlierIndices).toBeUndefined();
  });

  it('uses backend outlier indices only in outlier color mode', () => {
    const outliers = new Set([1, 3]);

    expect(getSpectraOutlierSamples('target', outliers).size).toBe(0);
    expect(getSpectraOutlierSamples('outlier', outliers)).toBe(outliers);
  });

  it('selects similar samples by fold, target range, or target outlier score', () => {
    expect(selectSimilarSpectraSamples({
      sampleIndex: 0,
      criterion: 'fold',
      folds: oneFold,
    })).toEqual([0, 2]);

    expect(selectSimilarSpectraSamples({
      sampleIndex: 0,
      criterion: 'yRange',
      yValues: [10, 10.5, 30, 9.2],
    })).toEqual([0, 1, 3]);

    expect(selectSimilarSpectraSamples({
      sampleIndex: 5,
      criterion: 'outlier',
      yValues: [0, 0, 0, 0, 0, 100],
    })).toEqual([5]);
  });
});
