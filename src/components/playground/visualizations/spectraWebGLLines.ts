import type { TargetValue } from '@/types/spectral';
import * as THREE from 'three';

import { isObservedTarget } from '@/lib/playground/targetValues';

import { normalizeSpectraValue, type SpectraDecimationResult } from './spectraWebGLGeometry';

export interface SpectraWebGLLineData {
  points: Float32Array;
  color: THREE.Color;
  index: number;
  isOriginal: boolean;
  pointCount: number;
}

export interface BuildSpectraWebGLLinesInput {
  decimation: SpectraDecimationResult | null;
  y?: TargetValue[];
  yTargetMin: number;
  yTargetMax: number;
  baseColor: string;
  originalColor?: string;
  sampleColors?: string[];
}

export function parseSpectraWebGLColor(color: string): THREE.Color {
  try {
    return new THREE.Color(color);
  } catch {
    return new THREE.Color(0x3b82f6);
  }
}

export function getSpectraTargetColor(value: number, min: number, max: number): THREE.Color {
  const normalizedValue = normalizeSpectraValue(value, min, max);
  const color = new THREE.Color();

  color.setHSL((240 - normalizedValue * 180) / 360, 1, 0.3);

  return color;
}

/** Palette colour of a line from its target value; `null` when the sample has none. */
function getObservedTargetColor(value: TargetValue | undefined, min: number, max: number): THREE.Color | null {
  return isObservedTarget(value) ? getSpectraTargetColor(value, min, max) : null;
}

export function buildSpectraWebGLLines({
  decimation,
  y,
  yTargetMin,
  yTargetMax,
  baseColor,
  originalColor,
  sampleColors,
}: BuildSpectraWebGLLinesInput): SpectraWebGLLineData[] {
  if (!decimation || decimation.metadata.length === 0) return [];

  const { allPoints, metadata } = decimation;
  const baseLineColor = parseSpectraWebGLColor(baseColor);
  const originalLineColor = originalColor ? parseSpectraWebGLColor(originalColor) : null;

  return metadata.map(({ index, isOriginal, pointCount, offset }) => {
    let color: THREE.Color;

    if (!isOriginal) {
      if (sampleColors?.[index]) color = parseSpectraWebGLColor(sampleColors[index]);
      else color = getObservedTargetColor(y?.[index], yTargetMin, yTargetMax) ?? baseLineColor;
    } else {
      if (originalLineColor) color = originalLineColor;
      else if (sampleColors?.[index]) color = parseSpectraWebGLColor(sampleColors[index]);
      else color = getObservedTargetColor(y?.[index], yTargetMin, yTargetMax) ?? baseLineColor;
    }

    return {
      points: allPoints.slice(offset, offset + pointCount * 2),
      color,
      index,
      isOriginal,
      pointCount,
    };
  });
}
