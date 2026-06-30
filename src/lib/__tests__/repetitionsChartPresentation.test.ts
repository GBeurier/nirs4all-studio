import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLOBAL_COLOR_CONFIG,
  type ColorContext,
} from '@/lib/playground/colorConfig';
import type { RepetitionsPlotDataPoint } from '@/lib/playground/repetitionsChartData';
import {
  buildRepetitionsColorContext,
  getRepetitionDistanceColor,
  getRepetitionsPointColor,
} from '@/lib/playground/repetitionsChartPresentation';

const point: RepetitionsPlotDataPoint = {
  x: 0,
  groupIndex: 0,
  groupSize: 1,
  y: 5,
  bioSample: 'sample-a',
  repIndex: 0,
  sampleIndex: 1,
  sampleId: 'a-1',
  isOutlier: false,
  isSelected: false,
};

describe('repetitionsChartPresentation', () => {
  it('builds a resolved color context from target values and selection fallback', () => {
    const selectedSamples = new Set([1]);

    expect(buildRepetitionsColorContext({
      y: [3, 7],
      plotDataLength: 2,
      selectedSamples,
    })).toMatchObject({
      y: [3, 7],
      yMin: 3,
      yMax: 7,
      totalSamples: 2,
      selectedSamples,
    });
  });

  it('preserves explicit color context fields while filling missing defaults', () => {
    const selectedSamples = new Set([1]);
    const externalSelection = new Set([0]);
    const externalContext: ColorContext = {
      y: [10, 20],
      yMin: 0,
      selectedSamples: externalSelection,
      totalSamples: 10,
      displayFilteredIndices: new Set([1]),
    };

    const context = buildRepetitionsColorContext({
      colorContext: externalContext,
      y: [3, 7],
      plotDataLength: 2,
      selectedSamples,
    });

    expect(context.y).toBe(externalContext.y);
    expect(context.yMin).toBe(0);
    expect(context.yMax).toBe(20);
    expect(context.totalSamples).toBe(10);
    expect(context.selectedSamples).toBe(externalSelection);
    expect(context.displayFilteredIndices).toBe(externalContext.displayFilteredIndices);
  });

  it('resolves default distance colors for linear and log-scaled repetition distances', () => {
    expect(getRepetitionDistanceColor(0, 0)).toBe('hsl(120, 60%, 50%)');
    expect(getRepetitionDistanceColor(5, 10)).toBe('hsl(60, 70%, 50%)');

    const logPoint = { ...point, y: Math.log1p(5) };
    expect(getRepetitionsPointColor({
      point: logPoint,
      colorContext: {},
      scaleType: 'log',
      maxDistance: 10,
    })).toBe(`hsl(${120 - (Math.log1p(5) / Math.log1p(10)) * 120}, 70%, 50%)`);
  });

  it('delegates to the global color system when a global config is provided', () => {
    const context = buildRepetitionsColorContext({
      y: [0, 10],
      plotDataLength: 2,
      selectedSamples: new Set(),
    });

    expect(getRepetitionsPointColor({
      point,
      globalColorConfig: DEFAULT_GLOBAL_COLOR_CONFIG,
      colorContext: context,
      scaleType: 'linear',
      maxDistance: 1,
    })).toBe('hsl(0, 70%, 50%)');
  });
});
