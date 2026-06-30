import { describe, expect, it } from 'vitest';

import {
  buildCanvasColorContext,
  buildCanvasDisplayFilteredIndices,
  buildCanvasFilterDataContext,
  mergeCanvasOutlierIndices,
  resolveCanvasFilteredIndices,
} from '@/lib/playground/canvasSampleScope';
import type { FilterContextValue } from '@/context/useFilter';
import type { FoldsInfo } from '@/types/playground';

const folds: FoldsInfo = {
  splitter_name: 'KFold',
  n_folds: 2,
  fold_labels: [0, 1, 0],
  folds: [
    { fold_index: 0, train_count: 2, test_count: 1, train_indices: [0, 1], test_indices: [2] },
    { fold_index: 1, train_count: 2, test_count: 1, train_indices: [0, 2], test_indices: [1] },
  ],
  kind: 'cv_folds',
};

describe('canvas sample scope helpers', () => {
  it('merges detected and context outlier indices', () => {
    expect(mergeCanvasOutlierIndices([], new Set())).toBeUndefined();

    expect(Array.from(mergeCanvasOutlierIndices([1, 3], new Set([3, 4])) ?? [])).toEqual([1, 3, 4]);
    expect(Array.from(mergeCanvasOutlierIndices(undefined, new Set([2])) ?? [])).toEqual([2]);
  });

  it('builds filter data context with stable fallbacks', () => {
    const selectedSamples = new Set([1]);
    const context = buildCanvasFilterDataContext({
      totalSamples: 3,
      folds,
      selectedSamples,
    });

    expect(context.totalSamples).toBe(3);
    expect(context.folds).toBe(folds);
    expect(context.outlierIndices).toEqual(new Set());
    expect(context.selectedSamples).toBe(selectedSamples);
    expect(context.metadata).toBeNull();
  });

  it('only creates display-filter sets when filters are active', () => {
    expect(buildCanvasDisplayFilteredIndices([1, 2], false)).toBeUndefined();
    expect(buildCanvasDisplayFilteredIndices([1, 2], true)).toEqual(new Set([1, 2]));
  });

  it('uses the filter context to resolve displayed sample indices when available', () => {
    const filterDataContext = buildCanvasFilterDataContext({
      totalSamples: 3,
      folds,
      selectedSamples: new Set([1]),
    });
    const filterContext: FilterContextValue = {
      partition: 'all',
      outlier: 'all',
      selection: 'selected',
      metadata: null,
      setPartitionFilter: () => undefined,
      setOutlierFilter: () => undefined,
      setSelectionFilter: () => undefined,
      setMetadataFilter: () => undefined,
      clearAllFilters: () => undefined,
      activeFilterCount: 1,
      hasActiveFilters: true,
      getFilteredIndices: (context) => Array.from(context.selectedSamples),
    };

    expect(resolveCanvasFilteredIndices({
      filterContext,
      filterDataContext,
      partitionFilter: 'oof',
      folds,
      totalSamples: 3,
    })).toEqual([1]);
  });

  it('falls back to partition indices when no filter context is mounted', () => {
    const filterDataContext = buildCanvasFilterDataContext({
      totalSamples: 3,
      folds,
      selectedSamples: new Set(),
    });

    expect(resolveCanvasFilteredIndices({
      filterContext: null,
      filterDataContext,
      partitionFilter: 'oof',
      folds,
      totalSamples: 3,
    })).toEqual([1, 2]);
  });

  it('builds the shared color context for charts', () => {
    const selectedSamples = new Set([0]);
    const pinnedSamples = new Set([2]);
    const trainIndices = new Set([0, 1]);
    const testIndices = new Set([2]);
    const outlierIndices = new Set([1]);
    const displayFilteredIndices = new Set([0, 2]);
    const classLabelMap = new Map([['0', 0], ['1', 1]]);
    const metadata = { batch: ['a', 'b', 'a'] };

    expect(buildCanvasColorContext({
      yValues: [0, 1, 0],
      yMin: 0,
      yMax: 1,
      trainIndices,
      testIndices,
      folds,
      metadata,
      outlierIndices,
      totalSamples: 3,
      selectedSamples,
      pinnedSamples,
      displayFilteredIndices,
      targetType: 'classification',
      classLabels: ['no', 'yes'],
      classLabelMap,
    })).toEqual({
      y: [0, 1, 0],
      yMin: 0,
      yMax: 1,
      trainIndices,
      testIndices,
      foldLabels: [0, 1, 0],
      foldKind: 'cv_folds',
      foldCount: 2,
      metadata,
      outlierIndices,
      totalSamples: 3,
      selectedSamples,
      pinnedSamples,
      displayFilteredIndices,
      targetType: 'classification',
      classLabels: ['no', 'yes'],
      classLabelMap,
    });
  });
});
