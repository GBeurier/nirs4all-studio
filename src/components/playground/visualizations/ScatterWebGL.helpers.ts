/**
 * Pure color/data helpers for the ScatterWebGL view.
 *
 * These are framework-free (no React, no JSX) so they can be unit-tested in
 * isolation; the orchestration component owns when/how they are called.
 */

import * as THREE from 'three';
import type { PointData } from './ScatterWebGL.types';

// ============= Color helpers =============

export function parseColor(color: string): THREE.Color {
  try {
    return new THREE.Color(color);
  } catch {
    return new THREE.Color(0x3b82f6);
  }
}

export function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

export function getValueColor(t: number): THREE.Color {
  // Viridis-like colormap
  const r = Math.max(0, Math.min(1, 0.267004 + t * (1.0 - 0.267004)));
  const g = Math.max(0, Math.min(1, 0.004874 + t * 0.9));
  const b = Math.max(0, Math.min(1, 0.329415 - t * 0.2));
  return new THREE.Color(r, g, b);
}

// Distinct colors for categorical data
export const CATEGORY_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

export function getCategoryColor(label: string, labelSet: Set<string>): THREE.Color {
  const labels = Array.from(labelSet);
  const idx = labels.indexOf(label);
  return new THREE.Color(CATEGORY_COLORS[idx % CATEGORY_COLORS.length]);
}

// ============= Data helpers =============

/**
 * Compute padded x/y ranges from the point cloud, filtering out NaN/Infinity
 * coordinates. Falls back to [-1, 1] when no valid points are present.
 */
export function computeRanges(points: [number, number][]): {
  xRange: [number, number];
  yRange: [number, number];
} {
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;

  points.forEach(([x, y]) => {
    // Skip invalid values
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  });

  // Handle case where all points are invalid
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
    xMin = -1;
    xMax = 1;
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = -1;
    yMax = 1;
  }

  // Add padding
  const xPad = (xMax - xMin) * 0.05 || 0.5;
  const yPad = (yMax - yMin) * 0.05 || 0.5;

  return {
    xRange: [xMin - xPad, xMax + xPad] as [number, number],
    yRange: [yMin - yPad, yMax + yPad] as [number, number],
  };
}

/**
 * Compute the value range used for the colormap, filtering out NaN/Infinity.
 * Falls back to [0, 1] when no valid values are present.
 */
export function computeValueRange(values?: number[]): { valueMin: number; valueMax: number } {
  if (!values || values.length === 0) return { valueMin: 0, valueMax: 1 };
  const validValues = values.filter(v => Number.isFinite(v));
  if (validValues.length === 0) return { valueMin: 0, valueMax: 1 };
  return {
    valueMin: Math.min(...validValues),
    valueMax: Math.max(...validValues),
  };
}

export interface BuildPointDataParams {
  points: [number, number][];
  indices?: number[];
  values?: number[];
  labels?: string[];
  selectedIndicesSet: Set<number>;
  pinnedIndicesSet: Set<number>;
  baseColor: string;
  selectedColor: string;
  pinnedColor: string;
  pointSize: number;
  selectedPointSize: number;
  xRange: [number, number];
  yRange: [number, number];
  valueMin: number;
  valueMax: number;
  labelSet: Set<string>;
}

/**
 * Build the renderable point data, resolving color/size/selection state and
 * normalizing positions to the [0, 1] range. Invalid coordinates are skipped.
 */
export function buildPointData({
  points,
  indices,
  values,
  labels,
  selectedIndicesSet,
  pinnedIndicesSet,
  baseColor,
  selectedColor,
  pinnedColor,
  pointSize,
  selectedPointSize,
  xRange,
  yRange,
  valueMin,
  valueMax,
  labelSet,
}: BuildPointDataParams): PointData[] {
  const baseCol = parseColor(baseColor);
  const selectedCol = parseColor(selectedColor);
  const pinnedCol = parseColor(pinnedColor);
  const result: PointData[] = [];

  points.forEach(([x, y], i) => {
    // Skip invalid coordinates
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const idx = indices?.[i] ?? i;
    const isSelected = selectedIndicesSet.has(idx);
    const isPinned = pinnedIndicesSet.has(idx);

    // Determine color
    let color: THREE.Color;
    if (isPinned) {
      color = pinnedCol;
    } else if (isSelected) {
      color = selectedCol;
    } else if (labels && labels[i]) {
      color = getCategoryColor(labels[i], labelSet);
    } else if (values && values[i] !== undefined && Number.isFinite(values[i])) {
      const t = normalizeValue(values[i], valueMin, valueMax);
      color = getValueColor(t);
    } else {
      color = baseCol;
    }

    // Normalize position to 0-1 range
    const normX = normalizeValue(x, xRange[0], xRange[1]);
    const normY = normalizeValue(y, yRange[0], yRange[1]);

    // Determine size
    const size = isPinned || isSelected ? selectedPointSize / 100 : pointSize / 100;

    result.push({
      position: new THREE.Vector3(normX, normY, isPinned ? 0.2 : isSelected ? 0.1 : 0),
      color,
      size,
      index: idx,
      isSelected,
      isPinned,
    });
  });

  return result;
}
