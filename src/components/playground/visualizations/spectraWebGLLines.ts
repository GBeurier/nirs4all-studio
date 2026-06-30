import * as THREE from 'three';

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
  y?: number[];
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
      else if (y?.[index] !== undefined) color = getSpectraTargetColor(y[index], yTargetMin, yTargetMax);
      else color = baseLineColor;
    } else {
      if (originalLineColor) color = originalLineColor;
      else if (sampleColors?.[index]) color = parseSpectraWebGLColor(sampleColors[index]);
      else if (y?.[index] !== undefined) color = getSpectraTargetColor(y[index], yTargetMin, yTargetMax);
      else color = baseLineColor;
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
