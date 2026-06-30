/**
 * Pure data preparation helpers for 2D scatter renderers.
 */

import type { DataBounds } from '../types';
import {
  cssToRGBA,
  getCategoricalColor,
  getContinuousColor,
  indexToPickColor,
  normalizeValue,
} from './colorEncoding';
import { mat3Ortho } from './projectionMatrix';

export type Point2D = [number, number];
export type RGBAColor = [number, number, number, number];
export type CssColorParser = (color: string) => RGBAColor;

export const DEFAULT_POINT_COLOR: RGBAColor = [0.231, 0.510, 0.965, 1.0];
export const MAX_SCATTER_2D_DEVICE_PIXEL_RATIO = 2;

export interface GridGeometry2D {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

export interface PointBufferData2D {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  pickColors: Float32Array;
}

export interface SelectionStateData2D {
  selected: Float32Array;
  hovered: Float32Array;
}

export interface ViewportBounds2D {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface Scatter2DViewStateOptions {
  points: readonly Point2D[];
  indices?: number[];
  colors?: string[];
  values?: number[];
  labels?: string[];
  customBounds?: DataBounds;
  parseCssColor?: CssColorParser;
}

export interface Scatter2DViewState {
  points: readonly Point2D[];
  indexMap: number[];
  bounds: DataBounds;
  pointColors: RGBAColor[];
}

export interface SizeLike2D {
  width: number;
  height: number;
}

export interface Scatter2DRenderFrame {
  dpr: number;
  width: number;
  height: number;
  viewportBounds: ViewportBounds2D;
  transform: Float32Array;
}

export interface RectLike {
  left: number;
  top: number;
}

export interface PointPickingPlan2D {
  x: number;
  y: number;
}

export type SelectionClickPlan2D =
  | { type: 'none' }
  | { type: 'select'; mode: 'add' | 'replace'; index: number }
  | { type: 'toggle'; index: number }
  | { type: 'clear' };

export interface SelectionClickOptions2D {
  shiftKey: boolean;
  toggleKey: boolean;
  clearOnBackgroundClick: boolean;
  useSelectionContext: boolean;
}

export function createIndexMap2D(points: readonly Point2D[], indices?: number[]): number[] {
  if (indices) return indices;
  return points.map((_, i) => i);
}

export function calculate2DBounds(points: readonly Point2D[]): DataBounds {
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

export function calculateTicks2D(min: number, max: number, targetCount: number = 5): number[] {
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

export function generateGridGeometry2D(
  bounds: DataBounds,
  showGrid: boolean,
  showAxes: boolean
): GridGeometry2D {
  const positions: number[] = [];
  const colors: number[] = [];

  const gridColor = [0.5, 0.5, 0.5, 0.4];
  const axisColor = [0.4, 0.4, 0.4, 0.8];

  if (showGrid) {
    const xTicks = calculateTicks2D(bounds.minX, bounds.maxX);
    const yTicks = calculateTicks2D(bounds.minY, bounds.maxY);

    for (const x of xTicks) {
      positions.push(x, bounds.minY, x, bounds.maxY);
      colors.push(...gridColor, ...gridColor);
    }

    for (const y of yTicks) {
      positions.push(bounds.minX, y, bounds.maxX, y);
      colors.push(...gridColor, ...gridColor);
    }
  }

  if (showAxes) {
    const xAxisY = bounds.minY <= 0 && bounds.maxY >= 0 ? 0 : bounds.minY;
    positions.push(bounds.minX, xAxisY, bounds.maxX, xAxisY);
    colors.push(...axisColor, ...axisColor);

    const yAxisX = bounds.minX <= 0 && bounds.maxX >= 0 ? 0 : bounds.minX;
    positions.push(yAxisX, bounds.minY, yAxisX, bounds.maxY);
    colors.push(...axisColor, ...axisColor);
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 2,
  };
}

export function computePointColors2D(
  points: readonly Point2D[],
  colors?: string[],
  values?: number[],
  labels?: string[],
  parseCssColor: CssColorParser = cssToRGBA
): RGBAColor[] {
  const result: RGBAColor[] = [];
  const uniqueLabels = labels ? [...new Set(labels)] : [];

  let minVal = Infinity, maxVal = -Infinity;
  if (values) {
    for (const v of values) {
      if (Number.isFinite(v)) {
        minVal = Math.min(minVal, v);
        maxVal = Math.max(maxVal, v);
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

export function prepareScatter2DViewState({
  points,
  indices,
  colors,
  values,
  labels,
  customBounds,
  parseCssColor,
}: Scatter2DViewStateOptions): Scatter2DViewState {
  return {
    points,
    indexMap: createIndexMap2D(points, indices),
    bounds: customBounds ?? calculate2DBounds(points),
    pointColors: computePointColors2D(points, colors, values, labels, parseCssColor),
  };
}

export function buildPointBufferData2D(
  points: readonly Point2D[],
  pointColors: readonly RGBAColor[],
  pointSize: number,
  indexMap: readonly number[]
): PointBufferData2D {
  const n = points.length;
  const positions = new Float32Array(n * 2);
  const colorData = new Float32Array(n * 4);
  const sizes = new Float32Array(n);
  const pickColors = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    positions[i * 2] = points[i][0];
    positions[i * 2 + 1] = points[i][1];

    const c = pointColors[i];
    colorData[i * 4] = c[0];
    colorData[i * 4 + 1] = c[1];
    colorData[i * 4 + 2] = c[2];
    colorData[i * 4 + 3] = c[3];

    const [r, g, b] = indexToPickColor(indexMap[i]);
    pickColors[i * 3] = r;
    pickColors[i * 3 + 1] = g;
    pickColors[i * 3 + 2] = b;
  }

  sizes.fill(pointSize);

  return {
    positions,
    colors: colorData,
    sizes,
    pickColors,
  };
}

export function buildSelectionStateData2D(
  pointCount: number,
  indexMap: readonly number[],
  selectedSamples: ReadonlySet<number>,
  pinnedSamples: ReadonlySet<number>,
  hoveredSample: number | null
): SelectionStateData2D {
  const selected = new Float32Array(pointCount);
  const hovered = new Float32Array(pointCount);

  for (let i = 0; i < pointCount; i++) {
    const sampleIdx = indexMap[i];
    selected[i] = selectedSamples.has(sampleIdx) || pinnedSamples.has(sampleIdx) ? 1.0 : 0.0;
    hovered[i] = hoveredSample === sampleIdx ? 1.0 : 0.0;
  }

  return { selected, hovered };
}

export function calculateViewportBounds2D(
  bounds: DataBounds,
  width: number,
  height: number,
  preserveAspectRatio: boolean
): ViewportBounds2D {
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

export function clampScatter2DDevicePixelRatio(
  devicePixelRatio: number,
  maxDevicePixelRatio: number = MAX_SCATTER_2D_DEVICE_PIXEL_RATIO
): number {
  return Math.min(devicePixelRatio, maxDevicePixelRatio);
}

export function prepareScatter2DRenderFrame(
  bounds: DataBounds,
  surface: SizeLike2D,
  devicePixelRatio: number,
  preserveAspectRatio: boolean
): Scatter2DRenderFrame {
  const dpr = clampScatter2DDevicePixelRatio(devicePixelRatio);
  const width = Math.floor(surface.width * dpr);
  const height = Math.floor(surface.height * dpr);
  const viewportBounds = calculateViewportBounds2D(bounds, width, height, preserveAspectRatio);
  const transform = mat3Ortho(
    viewportBounds.left,
    viewportBounds.right,
    viewportBounds.bottom,
    viewportBounds.top
  );

  return {
    dpr,
    width,
    height,
    viewportBounds,
    transform,
  };
}

export function createPointPickingPlan2D(
  clientX: number,
  clientY: number,
  rect: RectLike,
  dpr: number
): PointPickingPlan2D {
  return {
    x: (clientX - rect.left) * dpr,
    y: (clientY - rect.top) * dpr,
  };
}

export function createInteractionPickingPlan2D(
  clientX: number,
  clientY: number,
  rect: RectLike,
  devicePixelRatio: number
): PointPickingPlan2D {
  return createPointPickingPlan2D(
    clientX,
    clientY,
    rect,
    clampScatter2DDevicePixelRatio(devicePixelRatio)
  );
}

export function createSelectionClickPlan2D(
  index: number | null,
  selectedSamples: ReadonlySet<number>,
  options: SelectionClickOptions2D
): SelectionClickPlan2D {
  if (!options.useSelectionContext) return { type: 'none' };

  if (index !== null) {
    if (options.shiftKey) {
      return { type: 'select', mode: 'add', index };
    }

    if (options.toggleKey) {
      return { type: 'toggle', index };
    }

    if (selectedSamples.has(index) && selectedSamples.size === 1) {
      return { type: 'clear' };
    }

    return { type: 'select', mode: 'replace', index };
  }

  if (options.clearOnBackgroundClick && !options.shiftKey && !options.toggleKey) {
    return { type: 'clear' };
  }

  return { type: 'none' };
}
