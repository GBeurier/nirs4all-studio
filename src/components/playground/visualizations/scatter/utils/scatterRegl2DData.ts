/**
 * Pure data adapters for the Regl 2D scatter renderer.
 */

import type { DataBounds } from '../types';
import {
  cssToRGBA,
  getCategoricalColor,
  getContinuousColor,
  indexToPickColor,
  normalizeValue,
} from './colorEncoding';

export type Regl2DPoint = [number, number];
export type Regl2DColor = [number, number, number, number];
export type Regl2DColorParser = (color: string) => Regl2DColor;

export interface Regl2DGridGeometry {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

export interface Regl2DPointBufferData {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  pickColor: Float32Array;
  count: number;
}

export interface Regl2DSelectionData {
  selected: Float32Array;
  hovered: Float32Array;
}

export interface Regl2DViewportBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

const DEFAULT_POINT_COLOR: Regl2DColor = [0.231, 0.510, 0.965, 1.0];
const GRID_COLOR: Regl2DColor = [0.5, 0.5, 0.5, 0.4];
const AXIS_COLOR: Regl2DColor = [0.4, 0.4, 0.4, 0.8];

export function createRegl2DIndexMap(points: readonly Regl2DPoint[], indices?: number[]): number[] {
  if (indices) return indices;
  return points.map((_, i) => i);
}

export function calculateRegl2DBounds(points: readonly Regl2DPoint[]): DataBounds {
  if (points.length === 0) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const [x, y] of points) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const padX = (maxX - minX) * 0.05 || 0.1;
  const padY = (maxY - minY) * 0.05 || 0.1;

  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
  };
}

export function computeRegl2DPointColors(
  points: readonly Regl2DPoint[],
  colors?: string[],
  values?: number[],
  labels?: string[],
  parseCssColor: Regl2DColorParser = cssToRGBA
): Regl2DColor[] {
  const result: Regl2DColor[] = [];
  const uniqueLabels = labels ? [...new Set(labels)] : [];

  let minVal = Infinity, maxVal = -Infinity;
  if (values) {
    for (const value of values) {
      if (Number.isFinite(value)) {
        minVal = Math.min(minVal, value);
        maxVal = Math.max(maxVal, value);
      }
    }
  }

  for (let i = 0; i < points.length; i++) {
    if (colors?.[i]) {
      result.push(parseCssColor(colors[i]));
    } else if (values && Number.isFinite(values[i])) {
      const t = normalizeValue(values[i], minVal, maxVal);
      result.push(getContinuousColor(t, 'blue_red'));
    } else if (labels?.[i]) {
      const labelIdx = uniqueLabels.indexOf(labels[i]);
      result.push(getCategoricalColor(labelIdx));
    } else {
      result.push(DEFAULT_POINT_COLOR);
    }
  }

  return result;
}

export function buildRegl2DPointBufferData(
  points: readonly Regl2DPoint[],
  pointColors: readonly Regl2DColor[],
  pointSize: number,
  indexMap: readonly number[]
): Regl2DPointBufferData {
  const count = points.length;
  const position = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const size = new Float32Array(count);
  const pickColor = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    position[i * 2] = points[i][0];
    position[i * 2 + 1] = points[i][1];

    const pointColor = pointColors[i];
    color[i * 4] = pointColor[0];
    color[i * 4 + 1] = pointColor[1];
    color[i * 4 + 2] = pointColor[2];
    color[i * 4 + 3] = pointColor[3];

    size[i] = pointSize;

    const [r, g, b] = indexToPickColor(indexMap[i]);
    pickColor[i * 3] = r;
    pickColor[i * 3 + 1] = g;
    pickColor[i * 3 + 2] = b;
  }

  return { position, color, size, pickColor, count };
}

export function buildRegl2DSelectionData(
  pointCount: number,
  indexMap: readonly number[],
  selectedSamples: ReadonlySet<number>,
  pinnedSamples: ReadonlySet<number>,
  hoveredSample: number | null
): Regl2DSelectionData {
  const selected = new Float32Array(pointCount);
  const hovered = new Float32Array(pointCount);

  for (let i = 0; i < pointCount; i++) {
    const sampleIdx = indexMap[i];
    selected[i] = selectedSamples.has(sampleIdx) || pinnedSamples.has(sampleIdx) ? 1.0 : 0.0;
    hovered[i] = hoveredSample === sampleIdx ? 1.0 : 0.0;
  }

  return { selected, hovered };
}

export function calculateRegl2DTicks(min: number, max: number, targetCount: number = 5): number[] {
  const range = max - min;
  if (range <= 0) return [min];

  const roughStep = range / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;

  let niceStep: number;
  if (normalized <= 1.5) niceStep = magnitude;
  else if (normalized <= 3) niceStep = 2 * magnitude;
  else if (normalized <= 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const ticks: number[] = [];
  const start = Math.ceil(min / niceStep) * niceStep;

  for (let t = start; t <= max + niceStep * 0.001; t += niceStep) {
    if (t >= min - niceStep * 0.001 && t <= max + niceStep * 0.001) {
      ticks.push(t);
    }
  }

  return ticks;
}

export function generateRegl2DGridGeometry(
  bounds: DataBounds,
  showGrid: boolean,
  showAxes: boolean
): Regl2DGridGeometry {
  const positions: number[] = [];
  const colors: number[] = [];

  if (showGrid) {
    const xTicks = calculateRegl2DTicks(bounds.minX, bounds.maxX);
    const yTicks = calculateRegl2DTicks(bounds.minY, bounds.maxY);

    for (const x of xTicks) {
      positions.push(x, bounds.minY, x, bounds.maxY);
      colors.push(...GRID_COLOR, ...GRID_COLOR);
    }

    for (const y of yTicks) {
      positions.push(bounds.minX, y, bounds.maxX, y);
      colors.push(...GRID_COLOR, ...GRID_COLOR);
    }
  }

  if (showAxes) {
    const xAxisY = bounds.minY <= 0 && bounds.maxY >= 0 ? 0 : bounds.minY;
    positions.push(bounds.minX, xAxisY, bounds.maxX, xAxisY);
    colors.push(...AXIS_COLOR, ...AXIS_COLOR);

    const yAxisX = bounds.minX <= 0 && bounds.maxX >= 0 ? 0 : bounds.minX;
    positions.push(yAxisX, bounds.minY, yAxisX, bounds.maxY);
    colors.push(...AXIS_COLOR, ...AXIS_COLOR);
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 2,
  };
}

export function calculateRegl2DViewportBounds(
  bounds: DataBounds,
  width: number,
  height: number,
  preserveAspectRatio: boolean
): Regl2DViewportBounds {
  let left = bounds.minX, right = bounds.maxX;
  let bottom = bounds.minY, top = bounds.maxY;

  if (preserveAspectRatio) {
    const aspect = width / height;
    const dataW = bounds.maxX - bounds.minX;
    const dataH = bounds.maxY - bounds.minY;
    const dataAspect = dataW / dataH;

    if (dataAspect > aspect) {
      const newH = dataW / aspect;
      const pad = (newH - dataH) / 2;
      bottom -= pad;
      top += pad;
    } else {
      const newW = dataH * aspect;
      const pad = (newW - dataW) / 2;
      left -= pad;
      right += pad;
    }
  }

  return { left, right, bottom, top };
}

export function createRegl2DTransform({
  left,
  right,
  bottom,
  top,
}: Regl2DViewportBounds): Float32Array {
  const width = right - left;
  const height = top - bottom;

  return new Float32Array([
    2 / width, 0, 0,
    0, 2 / height, 0,
    -(right + left) / width, -(top + bottom) / height, 1,
  ]);
}
