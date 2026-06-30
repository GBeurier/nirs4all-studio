import { describe, expect, it } from 'vitest';
import {
  computeClassBarData,
  computeHistogramBins,
  computeSelectedYStats,
  computeYStats,
  getHoveredBin,
  getHoveredClass,
  getSelectedBins,
  getSelectedClasses,
  mapSamplesToClasses,
} from './histogramDataUtils';

describe('histogram data utilities', () => {
  it('computes filtered bins and keeps fold sample mappings', () => {
    const { histogramData, sampleBins } = computeHistogramBins({
      values: [0, 1, 2, 3, 4],
      binCount: 2,
      displayFilter: new Set([0, 1, 4]),
      foldLabels: [0, 0, 1, 1, 2],
    });

    expect(histogramData).toHaveLength(2);
    expect(histogramData.map((bin) => bin.count)).toEqual([2, 1]);
    expect(histogramData.map((bin) => bin.samples)).toEqual([[0, 1], [4]]);
    expect(histogramData[0].foldCounts).toEqual({ 0: 2 });
    expect(histogramData[0].foldSamples).toEqual({ 0: [0, 1] });
    expect(histogramData[1].foldCounts).toEqual({ 2: 1 });
    expect(sampleBins[0]).toBe(0);
    expect(sampleBins[1]).toBe(0);
    expect(sampleBins[2]).toBeUndefined();
    expect(sampleBins[4]).toBe(1);
  });

  it('keeps constant values in the first bin', () => {
    const { histogramData, sampleBins } = computeHistogramBins({
      values: [5, 5, 5],
      binCount: 3,
    });

    expect(histogramData.map((bin) => bin.count)).toEqual([3, 0, 0]);
    expect(histogramData[0].binStart).toBe(5);
    expect(histogramData[0].binEnd).toBe(6);
    expect(sampleBins).toEqual([0, 0, 0]);
  });

  it('computes statistics using the existing quartile positions', () => {
    expect(computeYStats([4, 1, 2, 3])).toEqual({
      mean: 2.5,
      median: 2.5,
      std: Math.sqrt(1.25),
      min: 1,
      max: 4,
      n: 4,
      q1: 2,
      q3: 4,
    });
    expect(computeYStats([])).toBeNull();
  });

  it('computes selected stats after applying the display filter', () => {
    const stats = computeSelectedYStats(
      [10, 20, 30, 40],
      new Set([1, 2, 3]),
      new Set([0, 2])
    );

    expect(stats).toMatchObject({
      mean: 30,
      median: 30,
      min: 30,
      max: 30,
      n: 1,
    });
    expect(computeSelectedYStats([10, 20], new Set())).toBeNull();
  });

  it('computes class bars and sample-to-class mappings', () => {
    const classLabelMap = new Map([
      ['0', 0],
      ['1', 1],
    ]);
    const classBarData = computeClassBarData({
      values: [0, 1, 0, 2],
      classLabels: ['zero', 'one'],
      classLabelMap,
      displayFilter: new Set([0, 1, 3]),
      foldLabels: [0, 1, 0, 2],
    });

    expect(classBarData).toHaveLength(2);
    expect(classBarData[0]).toMatchObject({
      classLabel: 'zero',
      classIndex: 0,
      count: 1,
      samples: [0],
      foldCounts: { 0: 1 },
      foldSamples: { 0: [0] },
    });
    expect(classBarData[1]).toMatchObject({
      classLabel: 'one',
      classIndex: 1,
      count: 1,
      samples: [1],
      foldCounts: { 1: 1 },
      foldSamples: { 1: [1] },
    });
    expect(mapSamplesToClasses([0, 1, 0, 2], ['zero', 'one'], classLabelMap)).toEqual([0, 1, 0, -1]);
  });

  it('projects selected and hovered samples to bins and classes', () => {
    expect(getSelectedBins(new Set([0, 2, 5]), [1, 1, 2])).toEqual(new Set([1, 2]));
    expect(getHoveredBin(2, [1, 1, 2])).toBe(2);
    expect(getHoveredBin(5, [1, 1, 2])).toBeNull();

    expect(getSelectedClasses(new Set([0, 1, 2]), [0, -1, 2])).toEqual(new Set([0, 2]));
    expect(getHoveredClass(2, [0, -1, 2])).toBe(2);
    expect(getHoveredClass(1, [0, -1, 2])).toBeNull();
  });
});
