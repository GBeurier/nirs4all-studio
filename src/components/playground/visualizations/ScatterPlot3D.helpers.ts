/**
 * Pure data/geometry helpers and constants for the ScatterPlot3D view.
 *
 * These are framework-free (no React, no JSX) so they can be unit-tested in
 * isolation; the orchestration component owns when/how they are called.
 */

import * as THREE from 'three';
import type { DataPoint, NormalizedDataPoint } from './ScatterPlot3D.types';

// ============= Constants =============

export const POINT_RADIUS = 0.04;
export const SELECTED_RADIUS = 0.06;
export const HOVERED_RADIUS = 0.07;
export const AXIS_COLOR = '#666666';
export const GRID_COLOR = '#333333';
export const CAMERA_DISTANCE = 4;

/** Muted grey for non-selected points (avoids transparent material which is slow in Three.js) */
export const DIMMED_COLOR = '#9ca3af';

/** Maximum number of point meshes rendered (performance cap for individual meshes) */
export const MAX_RENDERED_POINTS = 500;

export interface DataBounds {
  min: THREE.Vector3;
  max: THREE.Vector3;
  scale: THREE.Vector3;
}

// ============= Utility Functions =============

/**
 * Safely get a finite number, with fallback
 */
export function safeFinite(value: number | undefined | null, fallback: number): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

/**
 * Normalize data to fit within [-1, 1] range for each axis
 * Filters out points with NaN/Infinity coordinates to prevent Three.js errors
 */
export function normalizeData(data: DataPoint[]): { normalized: NormalizedDataPoint[]; bounds: DataBounds } {
  // Default safe bounds
  const defaultBounds: DataBounds = {
    min: new THREE.Vector3(-1, -1, -1),
    max: new THREE.Vector3(1, 1, 1),
    scale: new THREE.Vector3(1, 1, 1),
  };

  // Guard against invalid input
  if (!Array.isArray(data) || data.length === 0) {
    return { normalized: [], bounds: defaultBounds };
  }

  // Filter out invalid data points (NaN, Infinity, or non-numeric)
  const validData = data.filter(d =>
    d &&
    typeof d.x === 'number' && Number.isFinite(d.x) &&
    typeof d.y === 'number' && Number.isFinite(d.y) &&
    (d.z === undefined || (typeof d.z === 'number' && Number.isFinite(d.z)))
  );

  if (validData.length === 0) {
    return { normalized: [], bounds: defaultBounds };
  }

  const xs = validData.map(d => d.x);
  const ys = validData.map(d => d.y);
  const zs = validData.map(d => safeFinite(d.z, 0));

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  // Double-check that min/max are finite (shouldn't happen, but defensive)
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) ||
      !Number.isFinite(minY) || !Number.isFinite(maxY) ||
      !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    console.warn('[ScatterPlot3D] Invalid bounds detected, using defaults');
    return { normalized: [], bounds: defaultBounds };
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;

  // Normalize to [-1, 1], only include valid points
  const normalized = validData.map(d => {
    const normX = ((d.x - minX) / rangeX) * 2 - 1;
    const normY = ((d.y - minY) / rangeY) * 2 - 1;
    const normZ = ((safeFinite(d.z, 0) - minZ) / rangeZ) * 2 - 1;

    // Final NaN check on normalized values
    if (!Number.isFinite(normX) || !Number.isFinite(normY) || !Number.isFinite(normZ)) {
      return null;
    }

    return {
      ...d,
      x: normX,
      y: normY,
      z: normZ,
    };
  }).filter((d): d is NormalizedDataPoint => d !== null);

  return {
    normalized,
    bounds: {
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ),
      scale: new THREE.Vector3(rangeX, rangeY, rangeZ),
    },
  };
}

/**
 * Parse an HSL/HSLA (or hex) color string to a concrete hex color for Three.js
 * materials. Falls back to indigo for unrecognized formats.
 */
export function parsePointColor(color: string, dimmed = false): string {
  if (dimmed) return DIMMED_COLOR;
  // Match both hsl() and hsla()
  const hslMatch = color.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]);
    const s = parseFloat(hslMatch[2]);
    const l = parseFloat(hslMatch[3]);
    const c = new THREE.Color();
    c.setHSL(h / 360, s / 100, l / 100);
    return '#' + c.getHexString();
  }
  if (color.startsWith('#')) return color;
  return '#6366f1'; // Fallback indigo
}
