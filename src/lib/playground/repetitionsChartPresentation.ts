import {
  getWebGLSampleColor,
  type ColorContext,
  type GlobalColorConfig,
} from '@/lib/playground/colorConfig';
import {
  getFiniteValueRange,
  type RepetitionsPlotDataPoint,
} from '@/lib/playground/repetitionsChartData';

export interface BuildRepetitionsColorContextInput {
  colorContext?: ColorContext;
  y?: number[];
  plotDataLength: number;
  selectedSamples: Set<number>;
}

export interface GetRepetitionsPointColorInput {
  point: RepetitionsPlotDataPoint;
  globalColorConfig?: GlobalColorConfig;
  colorContext: ColorContext;
  scaleType: 'linear' | 'log';
  maxDistance: number;
}

export function getRepetitionDistanceColor(distance: number, maxDistance: number): string {
  if (maxDistance === 0) return 'hsl(120, 60%, 50%)';
  const t = Math.min(distance / maxDistance, 1);
  const hue = 120 - t * 120;
  return `hsl(${hue}, 70%, 50%)`;
}

export function buildRepetitionsColorContext({
  colorContext,
  y,
  plotDataLength,
  selectedSamples,
}: BuildRepetitionsColorContextInput): ColorContext {
  const targetValueRange = getFiniteValueRange(colorContext?.y ?? y);

  return {
    ...colorContext,
    y: colorContext?.y ?? y,
    yMin: colorContext?.yMin ?? targetValueRange.min,
    yMax: colorContext?.yMax ?? targetValueRange.max,
    totalSamples: colorContext?.totalSamples ?? plotDataLength,
    selectedSamples: colorContext?.selectedSamples ?? selectedSamples,
  };
}

export function getRepetitionsPointColor({
  point,
  globalColorConfig,
  colorContext,
  scaleType,
  maxDistance,
}: GetRepetitionsPointColorInput): string {
  if (globalColorConfig) {
    return getWebGLSampleColor(point.sampleIndex, globalColorConfig, colorContext);
  }

  const effectiveMaxDistance = scaleType === 'log' ? Math.log1p(maxDistance) : maxDistance;
  return getRepetitionDistanceColor(point.y, effectiveMaxDistance);
}
