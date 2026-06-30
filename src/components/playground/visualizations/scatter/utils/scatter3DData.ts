/**
 * Pure data preparation helpers for 3D scatter renderers.
 */

import type { DataBounds } from '../types';
import {
  cssToRGBA,
  getCategoricalColor,
  getContinuousColor,
  indexToPickColor,
  normalizeValue,
} from './colorEncoding';
import { mat4Identity, mat4Perspective } from './projectionMatrix';

export type Point3D = [number, number, number];
export type Bounds3D = DataBounds & { minZ: number; maxZ: number };
export type RGBAColor = [number, number, number, number];
export type CssColorParser = (color: string) => RGBAColor;

export const DEFAULT_POINT_COLOR: RGBAColor = [0.231, 0.510, 0.965, 1.0];
export const MAX_SCATTER_3D_DEVICE_PIXEL_RATIO = 2;

export interface GridGeometry3D {
  positions: Float32Array;
  colors: Float32Array;
}

export interface PointBufferData3D {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  pickColors: Float32Array;
}

export interface SelectionStateData3D {
  selected: Float32Array;
  hovered: Float32Array;
}

export interface Scatter3DViewStateOptions {
  points: readonly Point3D[];
  indices?: number[];
  colors?: string[];
  values?: number[];
  labels?: string[];
  customBounds?: Bounds3D;
  parseCssColor?: CssColorParser;
}

export interface Scatter3DViewState {
  points: readonly Point3D[];
  indexMap: number[];
  bounds: Bounds3D;
  pointColors: RGBAColor[];
}

export interface SizeLike3D {
  width: number;
  height: number;
}

export interface Scatter3DRenderFrame {
  dpr: number;
  width: number;
  height: number;
  projectionMatrix: Float32Array;
  modelMatrix: Float32Array;
}

export interface RectLike3D {
  left: number;
  top: number;
  height: number;
}

export interface PointPickingPlan3D {
  x: number;
  y: number;
}

export interface RectPickingPlan {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  width: number;
  height: number;
  stepSize: number;
}

export type SelectionClickPlan3D =
  | { type: 'none' }
  | { type: 'select'; mode: 'add' | 'replace'; index: number }
  | { type: 'toggle'; index: number }
  | { type: 'clear' };

export interface SelectionClickOptions3D {
  shiftKey: boolean;
  toggleKey: boolean;
  clearOnBackgroundClick: boolean;
  useSelectionContext: boolean;
}

export function createIndexMap(points: readonly Point3D[], indices?: number[]): number[] {
  if (indices) return indices;
  return points.map((_, i) => i);
}

export function calculate3DBounds(points: readonly Point3D[]): Bounds3D {
  if (points.length === 0) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const [x, y, z] of points) {
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function normalizePoint3D(
  x: number,
  y: number,
  z: number,
  bounds: Bounds3D
): Point3D {
  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const rangeZ = bounds.maxZ - bounds.minZ || 1;

  return [
    ((x - bounds.minX) / rangeX) * 2 - 1,
    ((y - bounds.minY) / rangeY) * 2 - 1,
    ((z - bounds.minZ) / rangeZ) * 2 - 1,
  ];
}

export function computePointColors3D(
  points: readonly Point3D[],
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

export function prepareScatter3DViewState({
  points,
  indices,
  colors,
  values,
  labels,
  customBounds,
  parseCssColor,
}: Scatter3DViewStateOptions): Scatter3DViewState {
  return {
    points,
    indexMap: createIndexMap(points, indices),
    bounds: customBounds ?? calculate3DBounds(points),
    pointColors: computePointColors3D(points, colors, values, labels, parseCssColor),
  };
}

export function buildPointBufferData3D(
  points: readonly Point3D[],
  bounds: Bounds3D,
  pointColors: readonly RGBAColor[],
  pointSize: number,
  indexMap: readonly number[]
): PointBufferData3D {
  const n = points.length;
  const positions = new Float32Array(n * 3);
  const colorData = new Float32Array(n * 4);
  const sizes = new Float32Array(n);
  const pickColors = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const [nx, ny, nz] = normalizePoint3D(points[i][0], points[i][1], points[i][2], bounds);
    positions[i * 3] = nx;
    positions[i * 3 + 1] = ny;
    positions[i * 3 + 2] = nz;

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

export function buildSelectionStateData3D(
  pointCount: number,
  indexMap: readonly number[],
  selectedSamples: ReadonlySet<number>,
  pinnedSamples: ReadonlySet<number>,
  hoveredSample: number | null
): SelectionStateData3D {
  const selected = new Float32Array(pointCount);
  const hovered = new Float32Array(pointCount);

  for (let i = 0; i < pointCount; i++) {
    const sampleIdx = indexMap[i];
    selected[i] = selectedSamples.has(sampleIdx) || pinnedSamples.has(sampleIdx) ? 1.0 : 0.0;
    hovered[i] = hoveredSample === sampleIdx ? 1.0 : 0.0;
  }

  return { selected, hovered };
}

export function generateGridGeometry3D(): GridGeometry3D {
  const positions: number[] = [];
  const colors: number[] = [];
  const gridColor = [0.3, 0.3, 0.3, 0.5];
  const axisColors = {
    x: [1, 0.3, 0.3, 1],
    y: [0.3, 1, 0.3, 1],
    z: [0.3, 0.3, 1, 1],
  };

  // Grid lines on XZ plane (y = -1)
  const gridSize = 1;
  const gridStep = 0.5;
  for (let i = -gridSize; i <= gridSize; i += gridStep) {
    positions.push(-gridSize, -1, i, gridSize, -1, i);
    colors.push(...gridColor, ...gridColor);
    positions.push(i, -1, -gridSize, i, -1, gridSize);
    colors.push(...gridColor, ...gridColor);
  }

  positions.push(-1.2, -1, 0, 1.2, -1, 0);
  colors.push(...axisColors.x, ...axisColors.x);
  positions.push(0, -1.2, 0, 0, 1.2, 0);
  colors.push(...axisColors.y, ...axisColors.y);
  positions.push(0, -1, -1.2, 0, -1, 1.2);
  colors.push(...axisColors.z, ...axisColors.z);

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
  };
}

export function clampScatter3DDevicePixelRatio(
  devicePixelRatio: number,
  maxDevicePixelRatio: number = MAX_SCATTER_3D_DEVICE_PIXEL_RATIO
): number {
  return Math.min(devicePixelRatio, maxDevicePixelRatio);
}

export function prepareScatter3DRenderFrame(
  surface: SizeLike3D,
  devicePixelRatio: number
): Scatter3DRenderFrame {
  const dpr = clampScatter3DDevicePixelRatio(devicePixelRatio);
  const width = Math.floor(surface.width * dpr);
  const height = Math.floor(surface.height * dpr);

  return {
    dpr,
    width,
    height,
    projectionMatrix: mat4Perspective(Math.PI / 4, width / height, 0.1, 100),
    modelMatrix: mat4Identity(),
  };
}

export function createPointPickingPlan3D(
  clientX: number,
  clientY: number,
  rect: RectLike3D,
  dpr: number
): PointPickingPlan3D {
  return {
    x: (clientX - rect.left) * dpr,
    y: (clientY - rect.top) * dpr,
  };
}

export function createInteractionPickingPlan3D(
  clientX: number,
  clientY: number,
  rect: RectLike3D,
  devicePixelRatio: number
): PointPickingPlan3D {
  return createPointPickingPlan3D(
    clientX,
    clientY,
    rect,
    clampScatter3DDevicePixelRatio(devicePixelRatio)
  );
}

export function createRectPickingPlan(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  canvasHeight: number,
  dpr: number
): RectPickingPlan | null {
  const canvasX1 = Math.floor(Math.min(x1, x2) * dpr);
  const canvasY1 = Math.floor(Math.min(y1, y2) * dpr);
  const canvasX2 = Math.floor(Math.max(x1, x2) * dpr);
  const canvasY2 = Math.floor(Math.max(y1, y2) * dpr);

  const width = canvasX2 - canvasX1;
  const height = canvasY2 - canvasY1;
  if (width <= 0 || height <= 0) return null;

  const deviceCanvasHeight = Math.floor(canvasHeight * dpr);
  const startY = deviceCanvasHeight - canvasY2;
  const stepSize = Math.max(2, Math.floor(Math.min(width, height) / 50));

  return {
    startX: canvasX1,
    endX: canvasX2,
    startY,
    endY: startY + height,
    width,
    height,
    stepSize,
  };
}

export function createInteractionRectPickingPlan3D(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: RectLike3D,
  devicePixelRatio: number
): RectPickingPlan | null {
  return createRectPickingPlan(
    x1,
    y1,
    x2,
    y2,
    rect.height,
    clampScatter3DDevicePixelRatio(devicePixelRatio)
  );
}

export function createSelectionClickPlan3D(
  index: number | null,
  selectedSamples: ReadonlySet<number>,
  options: SelectionClickOptions3D
): SelectionClickPlan3D {
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

export function pickPixelToIndex(pixel: ArrayLike<number>): number | null {
  if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0) {
    const index = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
    if (index > 0) {
      return index - 1;
    }
  }

  return null;
}
