import { describe, expect, it } from 'vitest';

import {
  buildRepetitionExportRows,
  buildRepetitionQuantileValues,
  buildRepetitionsDataBounds,
  buildRepetitionsPlotModel,
  buildRepetitionsWebglData,
  buildRepetitionsXAxisViewport,
  buildRepetitionsYDomain,
  buildRepetitionsZoomInfo,
  getFiniteValueRange,
  getRepetitionMetadataValue,
  normalizeComputedRepetitionDistances,
  panRepetitionsXDomain,
  zoomRepetitionsXDomain,
} from '@/lib/playground/repetitionsChartData';
import type { RepetitionResult } from '@/types/playground';

const repetitionData: RepetitionResult = {
  has_repetitions: true,
  n_bio_samples: 2,
  n_with_reps: 1,
  data: [
    {
      bio_sample: 'sample-a',
      rep_index: 0,
      sample_index: 0,
      sample_id: 'a-1',
      distance: 1,
      y: 10,
      y_mean: 15,
    },
    {
      bio_sample: 'sample-a',
      rep_index: 1,
      sample_index: 1,
      sample_id: 'a-2',
      distance: 5,
      y: 20,
      y_mean: 15,
    },
    {
      bio_sample: 'sample-b',
      rep_index: 0,
      sample_index: 2,
      sample_id: 'b-1',
      distance: 2,
      y: 30,
      y_mean: 30,
    },
  ],
  statistics: {
    mean_distance: 2.7,
    max_distance: 5,
    std_distance: 1.7,
    p95_distance: 4,
  },
};

describe('repetitions chart data', () => {
  it('uses computed distances for repetition plotting, statistics, and outlier flags', () => {
    const computedDistances = normalizeComputedRepetitionDistances(
      [0.5, 6, 2],
      { 50: 2, 75: 4, 90: 5, 95: 4.5 }
    );

    const model = buildRepetitionsPlotModel({
      repetitionData,
      spectraData: [[1], [2], [3]],
      y: [10, 20, 30],
      computedDistances,
      scaleType: 'log',
      sortBy: 'distance_desc',
      selectedSamples: new Set([1]),
    });

    expect(model.bioSampleOrder).toEqual(['sample-a', 'sample-b']);
    expect(model.statistics).toEqual({
      mean_distance: 2.8333333333333335,
      max_distance: 6,
      p95_distance: 4.5,
    });
    expect(model.yRange).toEqual({ min: 10, max: 30 });
    expect(model.plotData[1]).toMatchObject({
      x: 0,
      y: Math.log1p(6),
      isOutlier: true,
      isSelected: true,
    });
    expect(model.plotData[2]).toMatchObject({
      x: 1,
      y: Math.log1p(2),
      isOutlier: false,
    });
  });

  it('synthesizes no-repetition points grouped by metadata with filters applied', () => {
    const model = buildRepetitionsPlotModel({
      repetitionData: null,
      spectraData: [[1], [2], [3], [4]],
      y: [4, 1, 3, 2],
      scaleType: 'linear',
      displayFilteredIndices: new Set([0, 1, 2]),
      sortBy: 'metadata_column',
      metadataSortColumn: 'batch',
      metadata: { batch: ['b', 'a', 'b', ''] },
      sampleIds: ['s0', 's1', 's2', 's3'],
      selectedSamples: new Set([2]),
    });

    expect(model.bioSampleOrder).toEqual(['a', 'b']);
    expect(model.yRange).toEqual({ min: 1, max: 4 });
    expect(model.statistics).toBeNull();
    expect(model.plotData).toHaveLength(3);
    expect(model.plotData[0]).toMatchObject({
      x: 1,
      bioSample: 'b',
      groupSize: 2,
      sampleId: 's0',
      y: 0,
    });
    expect(model.plotData[2]).toMatchObject({
      x: 1,
      bioSample: 'b',
      isSelected: true,
    });
  });

  it('normalizes invalid computed distances and returns null when no positive distance remains', () => {
    expect(normalizeComputedRepetitionDistances([Number.NaN, -1, 0], { 95: 1 })).toBeNull();

    expect(normalizeComputedRepetitionDistances([Number.NaN, -1, 3], { 95: 2 })).toEqual({
      distances: [0, 0, 3],
      quantiles: { 95: 2 },
      mean: 1,
      max: 3,
    });
  });

  it('stringifies usable metadata values and ignores empty cells', () => {
    const metadata = { batch: ['a', 2, '', null] };

    expect(getRepetitionMetadataValue(metadata, 0, 'batch')).toBe('a');
    expect(getRepetitionMetadataValue(metadata, 1, 'batch')).toBe('2');
    expect(getRepetitionMetadataValue(metadata, 2, 'batch')).toBeNull();
    expect(getRepetitionMetadataValue(metadata, 3, 'batch')).toBeNull();
    expect(getRepetitionMetadataValue(metadata, 0, 'missing')).toBeNull();
  });

  it('builds viewport domains, bounds, and zoom/tick metadata', () => {
    const plotData = [
      {
        x: 0,
        groupIndex: 0,
        groupSize: 1,
        y: 2,
        bioSample: 'a',
        repIndex: 0,
        sampleIndex: 10,
        sampleId: 'a',
        isOutlier: false,
        isSelected: false,
      },
      {
        x: 1,
        groupIndex: 1,
        groupSize: 1,
        y: 4,
        bioSample: 'b',
        repIndex: 0,
        sampleIndex: 11,
        sampleId: 'b',
        targetY: 9,
        isOutlier: false,
        isSelected: false,
      },
    ];

    expect(buildRepetitionsYDomain(plotData)).toEqual([0, 4.6]);
    expect(getFiniteValueRange([undefined, Number.NaN, 2, 5])).toEqual({ min: 2, max: 5 });
    expect(buildRepetitionsDataBounds([0, 1], 4, [0, 4.6])).toEqual({
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 4.6,
    });
    expect(buildRepetitionsZoomInfo([0, 4], 10)).toEqual({ level: 40, visible: 4, total: 10 });
    expect(buildRepetitionsXAxisViewport([2.2, 9.1], 12, 3)).toEqual({
      effectiveXDomain: [2.2, 9.1],
      visibleStart: 2,
      visibleEnd: 10,
      visibleCount: 9,
      xTicks: [2, 5, 8, 10],
    });
    expect(buildRepetitionsWebglData(plotData, point => `color-${point.sampleIndex}`)).toEqual({
      points: [[0, 2], [1, 4]],
      indices: [10, 11],
      colors: ['color-10', 'color-11'],
      values: [2, 9],
    });
  });

  it('builds repetition quantile reference values from computed distances or statistics', () => {
    expect(buildRepetitionQuantileValues({
      quantiles: [50, 95],
      computedDistances: {
        distances: [1, 2],
        quantiles: { 50: 2, 95: 5 },
        mean: 1.5,
        max: 5,
      },
      statistics: null,
      scaleType: 'log',
    })).toEqual([
      { quantile: 50, value: Math.log1p(2) },
      { quantile: 95, value: Math.log1p(5) },
    ]);

    expect(buildRepetitionQuantileValues({
      quantiles: [75, 90],
      statistics: { mean_distance: 2, p95_distance: 10 },
      scaleType: 'linear',
    })).toEqual([
      { quantile: 75, value: 3 },
      { quantile: 90, value: 9 },
    ]);
  });

  it('builds export rows using computed distances when available', () => {
    expect(buildRepetitionExportRows(repetitionData, {
      distances: [10, 20, 30],
      quantiles: {},
      mean: 20,
      max: 30,
    })).toEqual([
      {
        bio_sample: 'sample-a',
        rep_index: 0,
        sample_id: 'a-1',
        sample_index: 0,
        distance: 10,
        y: 10,
        y_mean: 15,
      },
      {
        bio_sample: 'sample-a',
        rep_index: 1,
        sample_id: 'a-2',
        sample_index: 1,
        distance: 20,
        y: 20,
        y_mean: 15,
      },
      {
        bio_sample: 'sample-b',
        rep_index: 0,
        sample_id: 'b-1',
        sample_index: 2,
        distance: 30,
        y: 30,
        y_mean: 30,
      },
    ]);
    expect(buildRepetitionExportRows(null)).toEqual([]);
  });

  it('computes clamped zoom and pan domains', () => {
    expect(zoomRepetitionsXDomain({
      xDomain: null,
      groupCount: 10,
      deltaY: -1,
    })).toEqual([0.5, 8.5]);

    expect(zoomRepetitionsXDomain({
      xDomain: [2, 4],
      groupCount: 10,
      deltaY: 1,
    })).toEqual([1.8, 4.2]);

    expect(panRepetitionsXDomain({
      xDomain: [2, 6],
      groupCount: 10,
      chartWidth: 100,
      deltaX: 25,
    })).toEqual([1, 5]);

    expect(panRepetitionsXDomain({
      xDomain: [0, 4],
      groupCount: 10,
      chartWidth: 100,
      deltaX: 100,
    })).toEqual([-0.5, 3.5]);

    expect(zoomRepetitionsXDomain({ xDomain: null, groupCount: 0, deltaY: 1 })).toBeNull();
    expect(panRepetitionsXDomain({ xDomain: null, groupCount: 10, chartWidth: 0, deltaX: 1 })).toBeNull();
  });
});
