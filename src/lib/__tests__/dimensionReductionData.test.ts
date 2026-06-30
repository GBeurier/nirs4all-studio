import { describe, expect, it } from 'vitest';

import {
  buildDimensionReductionOptions,
  buildDimensionReductionPoints,
  buildDimensionReductionVarianceExplained,
  buildDimensionReductionWebgl2DProps,
  buildDimensionReductionWebgl3DProps,
  calculateDimensionReductionViewBounds,
  computeDimensionReductionYRange,
  filterDimensionReductionPoints,
  formatDimensionReductionAxisLabel,
  getDimensionReductionComponentsForVariance,
  getDimensionReductionUniqueFolds,
  safeDimensionReductionCoord,
  screenToDimensionReductionData,
} from '@/lib/playground/dimensionReductionData';
import type { FoldsInfo, PCAResult } from '@/types/playground';

const axes = {
  xAxis: 'dim1',
  yAxis: 'dim2',
  zAxis: 'dim3',
};

const pca: PCAResult = {
  coordinates: [
    [1, 2, 3],
    [4, Number.NaN, 6],
    [7, 8],
  ],
  explained_variance_ratio: [0.6, 0.35, 0.049, 0.001],
  explained_variance: [6, 3.5, 0.49, 0.01],
  n_components: 4,
  y: [10, 20, 30],
  fold_labels: [0, 1, -1],
};

const folds: FoldsInfo = {
  splitter_name: 'KFold',
  n_folds: 2,
  fold_labels: [1, 1, 0],
  folds: [],
};

describe('dimensionReductionData', () => {
  it('derives PCA components, dimension options, and variance labels', () => {
    expect(getDimensionReductionComponentsForVariance(pca)).toBe(3);
    expect(getDimensionReductionComponentsForVariance({ ...pca, explained_variance_ratio: undefined as unknown as number[] })).toBe(4);
    expect(buildDimensionReductionOptions('umap', 2)).toEqual([
      { value: 'dim1', label: 'UMAP1', index: 0 },
      { value: 'dim2', label: 'UMAP2', index: 1 },
    ]);
    expect(buildDimensionReductionVarianceExplained('pca', [0.25, 0.5])).toEqual({
      dim1: 25,
      dim2: 50,
    });
    expect(formatDimensionReductionAxisLabel('dim2', 'pca', { dim2: 50 }, value => `${value.toFixed(1)}%`)).toBe('PC2 (50.0%)');
    expect(formatDimensionReductionAxisLabel('dim1', 'umap', {}, value => `${value}%`)).toBe('UMAP1');
  });

  it('builds valid chart points with metadata, fallbacks, and finite z coordinates', () => {
    expect(safeDimensionReductionCoord(undefined)).toBe(0);
    expect(safeDimensionReductionCoord(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeDimensionReductionCoord(3)).toBe(3);

    const points = buildDimensionReductionPoints({
      result: pca,
      axes,
      sampleIds: ['A', 'B', 'C'],
      y: [1, 2, 3],
      folds,
      metadata: {
        batch: ['x', 'y', 'z'],
        missing: [undefined, 'ignored', 'kept'],
      },
    });

    expect(points).toEqual([
      {
        x: 1,
        y: 2,
        z: 3,
        index: 0,
        name: 'A',
        yValue: 1,
        foldLabel: 1,
        metadata: { batch: 'x' },
      },
      {
        x: 7,
        y: 8,
        z: 0,
        index: 2,
        name: 'C',
        yValue: 3,
        foldLabel: 0,
        metadata: { batch: 'z', missing: 'kept' },
      },
    ]);
  });

  it('builds reference-style point names and applies display filtering', () => {
    const points = buildDimensionReductionPoints({
      result: pca,
      axes,
      nameForIndex: index => `Reference ${index + 1}`,
    });

    expect(points.map(point => point.name)).toEqual(['Reference 1', 'Reference 3']);
    expect(filterDimensionReductionPoints(points, new Set([2]))).toEqual([points[1]]);
    expect(filterDimensionReductionPoints(points, undefined)).toBe(points);
  });

  it('derives fold, target range, and renderer payloads', () => {
    const points = buildDimensionReductionPoints({ result: pca, axes });
    const getColor = (point: { index: number }) => point.index === 0 ? 'red' : 'blue';

    expect(getDimensionReductionUniqueFolds(folds)).toEqual([0, 1]);
    expect(computeDimensionReductionYRange(points)).toEqual({ min: 10, max: 30 });
    expect(buildDimensionReductionWebgl2DProps(points, getColor)).toEqual({
      points: [[1, 2], [7, 8]],
      indices: [0, 2],
      colors: ['red', 'blue'],
      values: [10, 30],
    });
    expect(buildDimensionReductionWebgl3DProps(points, getColor)).toEqual({
      points: [[1, 2, 3], [7, 8, 0]],
      indices: [0, 2],
      colors: ['red', 'blue'],
      values: [10, 30],
    });
  });

  it('calculates padded bounds and converts screen coordinates into data space', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ];
    const stretched = calculateDimensionReductionViewBounds(points, 100, 100, false);
    expect(stretched).toEqual({
      left: -0.5,
      right: 10.5,
      bottom: -1,
      top: 21,
    });

    const preserved = calculateDimensionReductionViewBounds(points, 200, 100, true);
    expect(preserved.left).toBeCloseTo(-17);
    expect(preserved.right).toBeCloseTo(27);
    expect(preserved.bottom).toBeCloseTo(-1);
    expect(preserved.top).toBeCloseTo(21);

    expect(screenToDimensionReductionData(50, 50, 100, 100, stretched)).toEqual({
      x: 5,
      y: 10,
    });
  });
});
