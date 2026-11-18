import { describe, expect, it } from 'vitest';

import type { SpectralData, TargetValue } from '@/types/spectral';
import { buildPlaygroundTargetView } from './canvasData';
import {
  DEFAULT_GLOBAL_COLOR_CONFIG,
  getBaseColor,
  getWebGLSampleColor,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLORS_CONCRETE,
} from './colorConfig';
import {
  buildDimensionReductionPoints,
  buildDimensionReductionWebgl2DProps,
  computeDimensionReductionYRange,
} from './dimensionReductionData';
import {
  buildFoldDistributionSegmentKeys,
  computeFoldDistributionSegments,
  FOLD_DISTRIBUTION_MISSING_TARGET_SEGMENT,
  getFoldDistributionTargetMean,
} from './foldDistributionData';
import { stratifiedSample } from './sampling';
import { buildSpectraColorContext, selectSimilarSpectraSamples } from './spectraChartData';
import {
  countMissingTargets,
  formatTargetValue,
  getObservedTargetRange,
  getObservedTargets,
  isObservedTarget,
  MISSING_TARGET_LABEL,
} from './targetValues';

// JSON cannot carry NaN: the backend sends a missing target value as `null`.
const Y_WITH_MISSING: TargetValue[] = [11.2, 9.5, 12.9, null, 5.8, null, 14.4];

function rawData(y: TargetValue[]): SpectralData {
  return {
    wavelengths: [1100, 1200],
    spectra: y.map((_, index) => [index, index + 1]),
    y,
  };
}

describe('target value helpers', () => {
  it('treats null, undefined and non-finite numbers as missing', () => {
    expect(isObservedTarget(0)).toBe(true);
    expect(isObservedTarget(-3.5)).toBe(true);
    expect(isObservedTarget(null)).toBe(false);
    expect(isObservedTarget(undefined)).toBe(false);
    expect(isObservedTarget(Number.NaN)).toBe(false);
    expect(isObservedTarget(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('keeps observed values in sample order and counts the missing ones', () => {
    expect(getObservedTargets(Y_WITH_MISSING)).toEqual([11.2, 9.5, 12.9, 5.8, 14.4]);
    expect(countMissingTargets(Y_WITH_MISSING)).toBe(2);
    expect(getObservedTargets(undefined)).toEqual([]);
    expect(countMissingTargets(undefined)).toBe(0);
  });

  it('computes the range from observed values only', () => {
    expect(getObservedTargetRange(Y_WITH_MISSING)).toEqual({ min: 5.8, max: 14.4 });
    expect(getObservedTargetRange([null, 7, null])).toEqual({ min: 7, max: 7 });
    expect(getObservedTargetRange([null, null])).toBeNull();
    expect(getObservedTargetRange([])).toBeNull();
  });

  it('formats a missing value as a placeholder instead of throwing', () => {
    expect(formatTargetValue(11.2345, 2)).toBe('11.23');
    expect(formatTargetValue(null, 2)).toBe(MISSING_TARGET_LABEL);
    expect(formatTargetValue(undefined, 2)).toBe(MISSING_TARGET_LABEL);
  });
});

describe('playground views with missing target values', () => {
  it('spans the legend range over observed values and keeps every sample', () => {
    const view = buildPlaygroundTargetView(rawData(Y_WITH_MISSING), null);

    expect(view.yValues).toHaveLength(Y_WITH_MISSING.length);
    expect(view.yValues[3]).toBeNull();
    expect(view.yMin).toBe(5.8);
    expect(view.yMax).toBe(14.4);
    expect(view.targetType).toBe('regression');
  });

  it('falls back to the default range when no target value is observed', () => {
    const view = buildPlaygroundTargetView(rawData([null, null, null]), null);

    expect(view.yMin).toBe(0);
    expect(view.yMax).toBe(1);
  });

  it('colours a sample without a target value in the neutral colour', () => {
    const context = { y: Y_WITH_MISSING, yMin: 5.8, yMax: 14.4 };

    expect(getBaseColor(3, DEFAULT_GLOBAL_COLOR_CONFIG, context)).toBe(HIGHLIGHT_COLORS.unselected);
    expect(getBaseColor(0, DEFAULT_GLOBAL_COLOR_CONFIG, context)).not.toBe(HIGHLIGHT_COLORS.unselected);
    // WebGL/canvas cannot parse the CSS variable behind the neutral colour.
    expect(getWebGLSampleColor(3, DEFAULT_GLOBAL_COLOR_CONFIG, context)).toBe(HIGHLIGHT_COLORS_CONCRETE.unselected);
    expect(getWebGLSampleColor(0, DEFAULT_GLOBAL_COLOR_CONFIG, context))
      .toBe(getBaseColor(0, DEFAULT_GLOBAL_COLOR_CONFIG, context));
  });

  it('builds the spectra colour context from observed values', () => {
    const context = buildSpectraColorContext({ yValues: Y_WITH_MISSING, outlierSamples: new Set() });

    expect(context.y).toBe(Y_WITH_MISSING);
    expect(context.yMin).toBe(5.8);
    expect(context.yMax).toBe(14.4);
  });

  it('never matches a sample without a target value in Y-based similarity selection', () => {
    expect(selectSimilarSpectraSamples({ sampleIndex: 3, criterion: 'yRange', yValues: Y_WITH_MISSING })).toEqual([]);
    expect(selectSimilarSpectraSamples({ sampleIndex: 0, criterion: 'yRange', yValues: [10, 10.5, null, 12] })).toEqual([0, 1]);
    expect(selectSimilarSpectraSamples({ sampleIndex: 0, criterion: 'outlier', yValues: [10, 10, 10, 10, 10, 10, null, 40] }))
      .toEqual([7]);
  });

  it('keeps every sample in the projection and excludes missing values from its colour range', () => {
    const points = buildDimensionReductionPoints({
      result: { coordinates: Y_WITH_MISSING.map((_, index) => [index, -index]) },
      axes: { xAxis: 'dim1', yAxis: 'dim2', zAxis: 'dim3' },
      y: Y_WITH_MISSING,
    });

    expect(points).toHaveLength(Y_WITH_MISSING.length);
    expect(points[3].yValue).toBeUndefined();
    expect(computeDimensionReductionYRange(points)).toEqual({ min: 5.8, max: 14.4 });

    const webgl = buildDimensionReductionWebgl2DProps(points, () => 'red');
    expect(webgl.points).toHaveLength(Y_WITH_MISSING.length);
    expect(webgl.values[0]).toBe(11.2);
    expect(webgl.values[3]).toBeNaN();
  });

  it('keeps samples without a target value in fold bars as their own segment', () => {
    const y: TargetValue[] = [1, 2, null, 9, null, 10];
    const yBins = [{ min: 1, max: 5.5 }, { min: 5.5, max: 10 }];
    const options = {
      colorMode: 'target' as const,
      y,
      yBins,
      isClassificationMode: false,
      classLabels: [],
      selectedSamples: new Set<number>(),
      metadataCategories: [],
    };

    const segments = computeFoldDistributionSegments([0, 1, 2, 3, 4, 5], options);
    expect(segments.counts).toEqual({ bin_0: 2, bin_1: 2, [FOLD_DISTRIBUTION_MISSING_TARGET_SEGMENT]: 2 });
    expect(segments.indices[FOLD_DISTRIBUTION_MISSING_TARGET_SEGMENT]).toEqual([2, 4]);
    expect(buildFoldDistributionSegmentKeys(options)).toEqual(['bin_0', 'bin_1', FOLD_DISTRIBUTION_MISSING_TARGET_SEGMENT]);
    expect(buildFoldDistributionSegmentKeys({ ...options, y: [1, 2, 3, 9, 9, 10] })).toEqual(['bin_0', 'bin_1']);
    expect(getFoldDistributionTargetMean(y)).toBe(5.5);
  });

  it('keeps samples without a target value represented in stratified sampling', () => {
    const y: TargetValue[] = Array.from({ length: 100 }, (_, index) => (index % 4 === 0 ? null : index));
    const sampled = stratifiedSample(y, 20, 42);

    expect(sampled).toHaveLength(20);
    expect(new Set(sampled).size).toBe(20);
    expect(sampled.filter(index => y[index] === null)).toHaveLength(5);
  });

  it('leaves stratified sampling of complete targets unchanged', () => {
    const y = Array.from({ length: 50 }, (_, index) => index);

    expect(stratifiedSample(y, 10, 42)).toHaveLength(10);
    expect(stratifiedSample(y, 10, 42)).toEqual(stratifiedSample([...y], 10, 42));
  });
});
