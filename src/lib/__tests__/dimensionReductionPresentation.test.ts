import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLOBAL_COLOR_CONFIG,
  getCategoricalColor,
} from '@/lib/playground/colorConfig';
import {
  buildDimensionReductionColorContext,
  buildDimensionReductionExportRows,
  formatDimensionReductionFoldLabel,
  getDimensionReductionExportName,
  getDimensionReductionPointColor,
  getDimensionReductionRechartsCellStyle,
  hashDimensionReductionMetadataValue,
} from '@/lib/playground/dimensionReductionPresentation';
import type { DimensionReductionDataPoint } from '@/lib/playground/dimensionReductionData';
import type { FoldsInfo } from '@/types/playground';

const yRange = { min: 10, max: 30 };

const point: DimensionReductionDataPoint = {
  x: 1,
  y: 2,
  z: 3,
  index: 0,
  name: 'Sample A',
  yValue: 10,
  foldLabel: 2,
  metadata: { batch: 'alpha' },
};

const folds: FoldsInfo = {
  splitter_name: 'Split',
  n_folds: 1,
  kind: 'test_split',
  fold_labels: [0, -1, 1],
  folds: [
    {
      fold_index: 0,
      train_count: 2,
      test_count: 1,
      train_indices: [0, 2],
      test_indices: [1],
    },
  ],
};

describe('dimensionReductionPresentation', () => {
  it('builds color context from folds, y range, metadata, and selection state', () => {
    const selectedSamples = new Set([2]);
    const pinnedSamples = new Set([1]);
    const context = buildDimensionReductionColorContext({
      y: [10, 20, 30],
      yRange,
      folds,
      fallbackFoldLabels: [5, 5, 5],
      metadata: { batch: ['a', 'b', 'c'] },
      selectedSamples,
      pinnedSamples,
    });

    expect(context.yMin).toBe(10);
    expect(context.yMax).toBe(30);
    expect(context.trainIndices).toEqual(new Set([0, 2]));
    expect(context.testIndices).toEqual(new Set([1]));
    expect(context.foldLabels).toBe(folds.fold_labels);
    expect(context.selectedSamples).toBe(selectedSamples);
    expect(context.pinnedSamples).toBe(pinnedSamples);
  });

  it('preserves an external global color context object', () => {
    const externalColorContext = { displayFilteredIndices: new Set([1]) };

    expect(buildDimensionReductionColorContext({
      externalColorContext,
      yRange,
      selectedSamples: new Set(),
      pinnedSamples: new Set(),
    })).toBe(externalColorContext);
  });

  it('resolves legacy point colors for target, fold, and metadata modes', () => {
    expect(getDimensionReductionPointColor({
      point,
      colorContext: {},
      colorMode: 'target',
      yRange,
    })).toBe('hsl(240, 70%, 50%)');

    expect(getDimensionReductionPointColor({
      point,
      colorContext: {},
      colorMode: 'fold',
      yRange,
    })).toBe(getCategoricalColor(2, 'default'));

    const metadataHash = hashDimensionReductionMetadataValue('alpha');
    expect(getDimensionReductionPointColor({
      point,
      colorContext: {},
      colorMode: 'metadata',
      metadataKey: 'batch',
      yRange,
    })).toBe(getCategoricalColor(metadataHash, 'default'));
  });

  it('derives Recharts cell styles for legacy and global color modes', () => {
    expect(getDimensionReductionRechartsCellStyle({
      point: { ...point, index: 1 },
      colorContext: {},
      colorMode: 'target',
      yRange,
      selectedSamples: new Set([0]),
      pinnedSamples: new Set(),
      hoveredSample: null,
    })).toMatchObject({
      fillOpacity: 0.3,
      strokeWidth: 0,
    });

    expect(getDimensionReductionRechartsCellStyle({
      point,
      colorContext: { displayFilteredIndices: new Set([1]) },
      globalColorConfig: DEFAULT_GLOBAL_COLOR_CONFIG,
      colorMode: 'target',
      yRange,
      selectedSamples: new Set(),
      pinnedSamples: new Set(),
      hoveredSample: null,
    })).toEqual({
      fill: 'transparent',
      fillOpacity: 0,
    });
  });

  it('builds export rows and stable export names', () => {
    expect(buildDimensionReductionExportRows([point], {
      xAxis: 'dim1',
      yAxis: 'dim2',
      zAxis: 'dim3',
    })).toEqual([
      {
        sample: 'Sample A',
        dim1: 1,
        dim2: 2,
        dim3: 3,
        y_value: 10,
        fold: 'Fold 3',
      },
    ]);

    expect(formatDimensionReductionFoldLabel(0)).toBe('Fold 1');
    expect(getDimensionReductionExportName('pca')).toBe('pca_scores');
    expect(getDimensionReductionExportName('umap')).toBe('umap_embedding');
  });
});
