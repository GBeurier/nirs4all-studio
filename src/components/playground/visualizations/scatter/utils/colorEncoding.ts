/**
 * Color encoding utilities for WebGL scatter plots
 * Handles CSS color parsing, palette generation, and picking color encoding
 */

import type { ContinuousPalette } from '../types';

// Canvas for parsing CSS colors
let colorCanvas: HTMLCanvasElement | null = null;
let colorCtx: CanvasRenderingContext2D | null = null;

function getColorContext(): CanvasRenderingContext2D {
  if (!colorCtx) {
    colorCanvas = document.createElement('canvas');
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true })!;
  }
  return colorCtx;
}

/**
 * Convert any CSS color string to RGBA [0-1] values
 */
export function cssToRGBA(color: string): [number, number, number, number] {
  const ctx = getColorContext();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  return [data[0] / 255, data[1] / 255, data[2] / 255, data[3] / 255];
}

/**
 * Convert RGBA [0-1] to CSS color string
 */
export function rgbaToCSS(r: number, g: number, b: number, a: number = 1): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

/**
 * Encode sample index as RGB color for GPU picking
 * Uses 24 bits = supports up to 16,777,215 points
 */
export function indexToPickColor(index: number): [number, number, number] {
  // Add 1 to avoid black (0,0,0) which is background
  const id = index + 1;
  const r = ((id >> 16) & 0xFF) / 255;
  const g = ((id >> 8) & 0xFF) / 255;
  const b = (id & 0xFF) / 255;
  return [r, g, b];
}

/**
 * Decode RGB pick color back to sample index
 */
export function pickColorToIndex(r: number, g: number, b: number): number | null {
  const id = (r << 16) | (g << 8) | b;
  if (id === 0) return null; // Background
  return id - 1;
}

/**
 * Linear interpolation between two colors
 */
function lerpColor(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): [number, number, number] {
  return [
    c1[0] + (c2[0] - c1[0]) * t,
    c1[1] + (c2[1] - c1[1]) * t,
    c1[2] + (c2[2] - c1[2]) * t,
  ];
}

// Palette color stops
const PALETTE_STOPS: Record<ContinuousPalette, [number, number, number][]> = {
  blue_red: [
    [0.0, 0.0, 1.0],   // Blue
    [0.0, 1.0, 1.0],   // Cyan
    [0.0, 1.0, 0.0],   // Green
    [1.0, 1.0, 0.0],   // Yellow
    [1.0, 0.0, 0.0],   // Red
  ],
  viridis: [
    [0.267, 0.005, 0.329],
    [0.283, 0.141, 0.458],
    [0.254, 0.265, 0.530],
    [0.207, 0.372, 0.553],
    [0.164, 0.471, 0.558],
    [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.518],
    [0.267, 0.749, 0.441],
    [0.478, 0.821, 0.318],
    [0.741, 0.873, 0.150],
    [0.993, 0.906, 0.144],
  ],
  plasma: [
    [0.050, 0.030, 0.528],
    [0.295, 0.011, 0.630],
    [0.492, 0.012, 0.658],
    [0.660, 0.083, 0.594],
    [0.798, 0.197, 0.470],
    [0.899, 0.329, 0.325],
    [0.963, 0.481, 0.178],
    [0.988, 0.652, 0.040],
    [0.940, 0.975, 0.131],
  ],
  inferno: [
    [0.001, 0.000, 0.014],
    [0.135, 0.035, 0.300],
    [0.341, 0.062, 0.429],
    [0.543, 0.115, 0.394],
    [0.735, 0.216, 0.330],
    [0.891, 0.369, 0.191],
    [0.976, 0.591, 0.035],
    [0.988, 0.809, 0.145],
    [0.988, 1.000, 0.644],
  ],
  coolwarm: [
    [0.230, 0.299, 0.754],  // Blue
    [0.706, 0.706, 0.706],  // Gray (middle)
    [0.706, 0.016, 0.150],  // Red
  ],
  spectral: [
    [0.620, 0.004, 0.259],  // Dark red
    [0.835, 0.243, 0.310],  // Red
    [0.957, 0.427, 0.263],  // Orange
    [0.992, 0.682, 0.380],  // Light orange
    [0.996, 0.878, 0.545],  // Yellow
    [0.902, 0.961, 0.596],  // Light green
    [0.671, 0.867, 0.643],  // Green
    [0.400, 0.761, 0.647],  // Teal
    [0.196, 0.533, 0.741],  // Blue
    [0.369, 0.310, 0.635],  // Purple
  ],
};

/**
 * Get color from continuous palette at normalized position t [0-1]
 */
export function getContinuousColor(
  t: number,
  palette: ContinuousPalette = 'blue_red'
): [number, number, number, number] {
  const stops = PALETTE_STOPS[palette];
  const clampedT = Math.max(0, Math.min(1, t));

  if (stops.length === 0) return [0.5, 0.5, 0.5, 1];
  if (stops.length === 1) return [...stops[0], 1];

  const scaledT = clampedT * (stops.length - 1);
  const index = Math.floor(scaledT);
  const frac = scaledT - index;

  if (index >= stops.length - 1) {
    return [...stops[stops.length - 1], 1];
  }

  const color = lerpColor(stops[index], stops[index + 1], frac);
  return [...color, 1];
}

// Categorical color palette (matches FOLD_COLORS from chartConfig)
const CATEGORICAL_COLORS: [number, number, number][] = [
  [0.047, 0.588, 0.576],  // Teal #0c9693
  [0.231, 0.510, 0.965],  // Blue #3b82f6
  [0.133, 0.773, 0.369],  // Green #22c55e
  [0.961, 0.620, 0.043],  // Orange #f59e0b
  [0.659, 0.333, 0.969],  // Purple #a855f7
  [0.937, 0.267, 0.267],  // Red #ef4444
  [0.024, 0.714, 0.831],  // Cyan #06b6d4
  [0.925, 0.286, 0.600],  // Pink #ec4899
  [0.518, 0.800, 0.086],  // Lime #84cc16
  [0.388, 0.400, 0.945],  // Indigo #6366f1
];

/**
 * Get categorical color by index (cycles through palette)
 */
export function getCategoricalColor(index: number): [number, number, number, number] {
  const color = CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length];
  return [...color, 1];
}

/**
 * Generate Float32Array for gradient texture (256 RGBA values)
 */
export function generateGradientTextureData(
  palette: ContinuousPalette,
  steps: number = 256
): Float32Array {
  const data = new Float32Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const color = getContinuousColor(t, palette);
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = color[3];
  }
  return data;
}

/**
 * Normalize value to [0, 1] range
 */
export function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}
