/**
 * Pure utility functions for histogram calculations.
 */

import {
  getPartitionRoleColor,
  getPartitionRoleLabel,
  type PartitionRole,
} from '@/lib/playground/colorConfig';

type HistogramPartitionRole = Exclude<PartitionRole, 'unknown'>;

// ============= KDE Calculation =============

/**
 * Calculate Kernel Density Estimation using Gaussian kernel
 */
export function computeKDE(
  values: number[],
  nPoints: number = 100,
  bandwidth?: number
): { x: number; density: number }[] {
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    return [{ x: min, density: 1 }];
  }

  // Silverman's rule of thumb for bandwidth
  const std = Math.sqrt(
    values.reduce((sum, v) => sum + Math.pow(v - values.reduce((a, b) => a + b, 0) / values.length, 2), 0) /
      values.length
  );
  const h = bandwidth ?? 1.06 * std * Math.pow(values.length, -0.2);

  const step = range / (nPoints - 1);
  const result: { x: number; density: number }[] = [];

  for (let i = 0; i < nPoints; i++) {
    const x = min + i * step;
    let density = 0;

    for (const v of values) {
      const u = (x - v) / h;
      density += Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
    }

    density /= values.length * h;
    result.push({ x, density });
  }

  return result;
}

/**
 * Calculate optimal bin count using Freedman-Diaconis rule
 */
export function calculateOptimalBinCount(values: number[]): number {
  if (values.length < 2) return 10;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;

  if (iqr === 0) return Math.min(20, Math.ceil(Math.sqrt(n)));

  const binWidth = 2 * iqr * Math.pow(n, -1 / 3);
  const range = sorted[n - 1] - sorted[0];
  const binCount = Math.ceil(range / binWidth);

  return Math.max(5, Math.min(50, binCount));
}

/**
 * Find the actual bar rect element from a Recharts mouse event target.
 * Always prefers the topmost visible bar segment at the click position so stacked
 * bar interactions resolve the segment the user actually hit.
 */
export function findBarRect(e: MouseEvent | null, target: SVGElement | null): Element | null {
  if (e) {
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    const topmostBarRect = elements.find(el =>
      el.classList.contains('recharts-rectangle') &&
      !el.classList.contains('recharts-reference-area-rect')
    );
    if (topmostBarRect) {
      return topmostBarRect;
    }
  }

  if (!target) return null;

  if (target.tagName.toLowerCase() === 'rect') {
    return target;
  }

  return target.closest('rect');
}

/**
 * Check if the event target is a bar element in a Recharts chart.
 */
export function isBarElement(target: SVGElement | null): boolean {
  if (!target) return false;
  return (
    target.classList?.contains('recharts-rectangle') ||
    target.closest('.recharts-bar-rectangle') !== null
  );
}

/**
 * Histogram-specific partition presentation:
 * validation folds are displayed as training-colored cross-validation samples.
 */
export function getHistogramPartitionRoleColor(role: HistogramPartitionRole): string {
  return role === 'val'
    ? getPartitionRoleColor('train')
    : getPartitionRoleColor(role);
}

export function getHistogramPartitionRoleLabel(role: HistogramPartitionRole): string {
  return role === 'val'
    ? 'cross-val'
    : getPartitionRoleLabel(role);
}
