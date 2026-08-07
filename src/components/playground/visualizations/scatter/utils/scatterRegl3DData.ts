/**
 * Pure data adapters for the Regl 3D scatter renderer.
 */

import type { DataBounds } from '../types';
import {
  cssToRGBA,
  getCategoricalColor,
  getContinuousColor,
  indexToPickColor,
  normalizeValue,
  pickColorToIndex,
} from './colorEncoding';
import { mat4Identity, mat4Perspective } from './projectionMatrix';

export type Regl3DPoint = [number, number, number];
export type Regl3DBounds = DataBounds & { minZ: number; maxZ: number };
export type Regl3DColor = [number, number, number, number];
export type Regl3DColorParser = (color: string) => Regl3DColor;

export interface Regl3DGridGeometry {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

export interface Regl3DPointBufferData {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  pickColor: Float32Array;
  count: number;
}

export interface Regl3DSelectionData {
  selected: Float32Array;
  hovered: Float32Array;
}

export interface Regl3DViewportSize {
  width: number;
  height: number;
  dpr: number;
}

export interface Regl3DReadbackCoordinate {
  x: number;
  y: number;
}

export interface Regl3DCameraMatrices {
  projection: Float32Array;
  model: Float32Array;
}

export interface Regl3DRectPickingPlan {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  width: number;
  height: number;
  stepSize: number;
}

export const DEFAULT_REGL_3D_POINT_COLOR: Regl3DColor = [0.231, 0.510, 0.965, 1.0];

const GRID_COLOR: Regl3DColor = [0.3, 0.3, 0.3, 0.5];
const X_AXIS_COLOR: Regl3DColor = [1, 0.3, 0.3, 1];
const Y_AXIS_COLOR: Regl3DColor = [0.3, 1, 0.3, 1];
const Z_AXIS_COLOR: Regl3DColor = [0.3, 0.3, 1, 1];

export function createRegl3DIndexMap(points: readonly Regl3DPoint[], indices?: number[]): number[] {
  if (indices) return indices;
  return points.map((_, index) => index);
}

export function calculateRegl3DBounds(points: readonly Regl3DPoint[]): Regl3DBounds {
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

export function normalizeRegl3DPoint(
  x: number,
  y: number,
  z: number,
  bounds: Regl3DBounds
): Regl3DPoint {
  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const rangeZ = bounds.maxZ - bounds.minZ || 1;

  return [
    ((x - bounds.minX) / rangeX) * 2 - 1,
    ((y - bounds.minY) / rangeY) * 2 - 1,
    ((z - bounds.minZ) / rangeZ) * 2 - 1,
  ];
}

export function computeRegl3DPointColors(
  points: readonly Regl3DPoint[],
  colors?: string[],
  values?: number[],
  labels?: string[],
  parseCssColor: Regl3DColorParser = cssToRGBA
): Regl3DColor[] {
  const result: Regl3DColor[] = [];
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

  for (let index = 0; index < points.length; index++) {
    if (colors?.[index]) {
      result.push(parseCssColor(colors[index]));
    } else if (values && Number.isFinite(values[index])) {
      const t = normalizeValue(values[index], minVal, maxVal);
      result.push(getContinuousColor(t, 'blue_red'));
    } else if (labels?.[index]) {
      const labelIndex = uniqueLabels.indexOf(labels[index]);
      result.push(getCategoricalColor(labelIndex));
    } else {
      result.push(DEFAULT_REGL_3D_POINT_COLOR);
    }
  }

  return result;
}

export function buildRegl3DPointBufferData(
  points: readonly Regl3DPoint[],
  bounds: Regl3DBounds,
  pointColors: readonly Regl3DColor[],
  pointSize: number,
  indexMap: readonly number[]
): Regl3DPointBufferData {
  const count = points.length;
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 4);
  const size = new Float32Array(count);
  const pickColor = new Float32Array(count * 3);

  for (let index = 0; index < count; index++) {
    const [nx, ny, nz] = normalizeRegl3DPoint(points[index][0], points[index][1], points[index][2], bounds);
    position[index * 3] = nx;
    position[index * 3 + 1] = ny;
    position[index * 3 + 2] = nz;

    const pointColor = pointColors[index];
    color[index * 4] = pointColor[0];
    color[index * 4 + 1] = pointColor[1];
    color[index * 4 + 2] = pointColor[2];
    color[index * 4 + 3] = pointColor[3];

    size[index] = pointSize;

    const [r, g, b] = indexToPickColor(indexMap[index]);
    pickColor[index * 3] = r;
    pickColor[index * 3 + 1] = g;
    pickColor[index * 3 + 2] = b;
  }

  return { position, color, size, pickColor, count };
}

export function buildRegl3DSelectionData(
  pointCount: number,
  indexMap: readonly number[],
  selectedSamples: ReadonlySet<number>,
  pinnedSamples: ReadonlySet<number>,
  hoveredSample: number | null
): Regl3DSelectionData {
  const selected = new Float32Array(pointCount);
  const hovered = new Float32Array(pointCount);

  for (let index = 0; index < pointCount; index++) {
    const sampleIndex = indexMap[index];
    selected[index] = selectedSamples.has(sampleIndex) || pinnedSamples.has(sampleIndex) ? 1.0 : 0.0;
    hovered[index] = hoveredSample === sampleIndex ? 1.0 : 0.0;
  }

  return { selected, hovered };
}

export function generateRegl3DGridGeometry(): Regl3DGridGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const gridSize = 1;
  const gridStep = 0.5;

  for (let value = -gridSize; value <= gridSize; value += gridStep) {
    positions.push(-gridSize, -1, value, gridSize, -1, value);
    colors.push(...GRID_COLOR, ...GRID_COLOR);
    positions.push(value, -1, -gridSize, value, -1, gridSize);
    colors.push(...GRID_COLOR, ...GRID_COLOR);
  }

  positions.push(-1.2, -1, 0, 1.2, -1, 0);
  colors.push(...X_AXIS_COLOR, ...X_AXIS_COLOR);
  positions.push(0, -1.2, 0, 0, 1.2, 0);
  colors.push(...Y_AXIS_COLOR, ...Y_AXIS_COLOR);
  positions.push(0, -1, -1.2, 0, -1, 1.2);
  colors.push(...Z_AXIS_COLOR, ...Z_AXIS_COLOR);

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 3,
  };
}

export function calculateRegl3DViewportSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number
): Regl3DViewportSize {
  const dpr = Math.min(devicePixelRatio, 2);

  return {
    width: Math.floor(cssWidth * dpr),
    height: Math.floor(cssHeight * dpr),
    dpr,
  };
}

export function createRegl3DReadbackCoordinate(
  x: number,
  y: number,
  framebufferWidth: number,
  framebufferHeight: number
): Regl3DReadbackCoordinate | null {
  const width = Math.floor(framebufferWidth);
  const height = Math.floor(framebufferHeight);
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }

  return {
    x: Math.min(width - 1, Math.max(0, Math.floor(x))),
    y: Math.min(height - 1, Math.max(0, height - Math.floor(y) - 1)),
  };
}

export function createRegl3DCameraMatrices(width: number, height: number): Regl3DCameraMatrices {
  return {
    projection: mat4Perspective(Math.PI / 4, width / height, 0.1, 100),
    model: mat4Identity(),
  };
}

export function createRegl3DRectPickingPlan(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  framebufferWidth: number,
  framebufferHeight: number,
  dpr: number
): Regl3DRectPickingPlan | null {
  const deviceWidth = Math.floor(framebufferWidth);
  const deviceHeight = Math.floor(framebufferHeight);
  if (
    ![x1, y1, x2, y2, dpr].every(Number.isFinite)
    || !Number.isFinite(deviceWidth)
    || !Number.isFinite(deviceHeight)
    || deviceWidth <= 0
    || deviceHeight <= 0
    || dpr <= 0
  ) {
    return null;
  }

  const rawStartX = Math.floor(Math.min(x1, x2) * dpr);
  const rawEndX = Math.ceil(Math.max(x1, x2) * dpr) - 1;
  const rawStartY = deviceHeight - Math.ceil(Math.max(y1, y2) * dpr);
  const rawEndY = deviceHeight - Math.floor(Math.min(y1, y2) * dpr) - 1;
  if (
    rawEndX < 0
    || rawStartX >= deviceWidth
    || rawEndY < 0
    || rawStartY >= deviceHeight
  ) {
    return null;
  }

  const startX = Math.max(0, rawStartX);
  const endX = Math.min(deviceWidth - 1, rawEndX);
  const startY = Math.max(0, rawStartY);
  const endY = Math.min(deviceHeight - 1, rawEndY);
  const width = endX - startX + 1;
  const height = endY - startY + 1;
  if (width <= 0 || height <= 0) return null;

  const stepSize = Math.max(2, Math.floor(Math.min(width, height) / 50));

  return {
    startX,
    endX,
    startY,
    endY,
    width,
    height,
    stepSize,
  };
}

export function decodeRegl3DPickPixel(pixel: ArrayLike<number>): number | null {
  return pickColorToIndex(pixel[0], pixel[1], pixel[2]);
}
