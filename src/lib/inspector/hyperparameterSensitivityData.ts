import type { HyperparameterPoint } from '@/types/inspector';

export type HyperparameterScaleMode = 'linear' | 'log';

export interface HyperparameterTrend {
  slope: number;
  intercept: number;
  r: number;
}

export interface HyperparameterScaleData {
  xValues: number[];
  yValues: number[];
  useLogX: boolean;
  logAllowed: boolean;
  xDomain: [number, number];
  yDomain: [number, number];
  trend: HyperparameterTrend | null;
}

export const HYPERPARAMETER_MODEL_COLORS = [
  '#0d9488', '#2563eb', '#d97706', '#e11d48', '#7c3aed',
  '#059669', '#ea580c', '#0284c7', '#db2777', '#65a30d',
];

export function isFiniteHyperparameterNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function filterFiniteHyperparameterPoints(
  points: readonly HyperparameterPoint[] | null | undefined,
): HyperparameterPoint[] {
  return (points ?? []).filter(
    (point) => isFiniteHyperparameterNumber(point.param_value) && isFiniteHyperparameterNumber(point.score),
  );
}

export function buildHyperparameterColorMap(
  points: readonly Pick<HyperparameterPoint, 'model_class'>[] | null | undefined,
  colors: readonly string[] = HYPERPARAMETER_MODEL_COLORS,
): Map<string, string> {
  const models = [...new Set((points ?? []).map((point) => point.model_class))];
  return new Map(models.map((model, index) => [model, colors[index % colors.length]]));
}

export function buildHyperparameterModelCounts(
  points: readonly Pick<HyperparameterPoint, 'model_class'>[] | null | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const point of points ?? []) {
    counts.set(point.model_class, (counts.get(point.model_class) ?? 0) + 1);
  }
  return counts;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function computeHyperparameterTrend(
  xs: readonly number[],
  ys: readonly number[],
): HyperparameterTrend | null {
  if (xs.length < 2 || ys.length < 2 || xs.length !== ys.length) return null;
  const meanX = average(xs);
  const meanY = average(ys);
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let index = 0; index < xs.length; index++) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return null;
  const slope = numerator / denomX;
  const intercept = meanY - slope * meanX;
  const r = numerator / Math.sqrt(denomX * denomY);
  return { slope, intercept, r };
}

export function buildHyperparameterScaleData(
  points: readonly HyperparameterPoint[],
  scaleMode: HyperparameterScaleMode,
): HyperparameterScaleData {
  const xs = points.map((point) => point.param_value);
  const ys = points.map((point) => point.score);
  const positive = xs.every((value) => value > 0);
  const logEnabled = scaleMode === 'log' && positive;
  const transformedX = logEnabled ? xs.map((value) => Math.log10(value)) : xs;

  if (transformedX.length === 0 || ys.length === 0) {
    return {
      xValues: [],
      yValues: [],
      useLogX: false,
      logAllowed: positive,
      xDomain: [0, 1],
      yDomain: [0, 1],
      trend: null,
    };
  }

  const rawXMin = Math.min(...transformedX);
  const rawXMax = Math.max(...transformedX);
  const rawYMin = Math.min(...ys);
  const rawYMax = Math.max(...ys);
  const xPad = rawXMax === rawXMin ? Math.abs(rawXMin) * 0.1 || 0.5 : 0;
  const yPad = rawYMax === rawYMin ? Math.abs(rawYMin) * 0.1 || 0.5 : 0;

  return {
    xValues: transformedX,
    yValues: ys,
    useLogX: logEnabled,
    logAllowed: positive,
    xDomain: [rawXMin - xPad, rawXMax + xPad],
    yDomain: [rawYMin - yPad, rawYMax + yPad],
    trend: computeHyperparameterTrend(transformedX, ys),
  };
}

export function buildHyperparameterTickValues(domain: readonly [number, number], steps = 4): number[] {
  const ticks: number[] = [];
  for (let index = 0; index <= steps; index++) {
    ticks.push(domain[0] + (domain[1] - domain[0]) * (index / steps));
  }
  return ticks;
}

export function formatHyperparameterXValue(value: number, useLogX: boolean): string {
  if (!useLogX) return value.toPrecision(3);
  return Number(10 ** value).toPrecision(3);
}
