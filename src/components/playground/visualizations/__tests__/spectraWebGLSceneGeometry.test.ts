import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { SpectraWebGLLineData } from '../spectraWebGLLines';
import {
  buildSpectraWebGLAggregatedAreaGeometry,
  buildSpectraWebGLBatchedLineGroups,
  buildSpectraWebGLBatchedLinePositions,
  buildSpectraWebGLLinePositions,
} from '../spectraWebGLSceneGeometry';

function line(index: number, color: string, points: number[]): SpectraWebGLLineData {
  return {
    index,
    color: new THREE.Color(color),
    isOriginal: false,
    pointCount: points.length / 2,
    points: new Float32Array(points),
  };
}

function toRoundedArray(values: Float32Array) {
  return Array.from(values, value => Number.isNaN(value) ? 'NaN' : Number(value.toFixed(4)));
}

describe('spectraWebGLSceneGeometry', () => {
  it('builds batched line positions with NaN separators between spectra', () => {
    const positions = buildSpectraWebGLBatchedLinePositions([
      line(1, '#ff0000', [0, 0, 1, 1]),
      line(2, '#ff0000', [0.5, 0.25]),
    ]);

    expect(toRoundedArray(positions)).toEqual([
      0, 0, 0,
      1, 1, 0,
      'NaN', 'NaN', 'NaN',
      0.5, 0.25, 0,
      'NaN', 'NaN', 'NaN',
    ]);
  });

  it('groups batched lines by color key while preserving group positions', () => {
    const groups = buildSpectraWebGLBatchedLineGroups([
      line(1, '#ff0000', [0, 0]),
      line(2, '#00ff00', [0.5, 0.5]),
      line(3, '#ff0000', [1, 1]),
    ]);

    expect(groups.map(group => group.colorKey)).toEqual(['ff0000', '00ff00']);
    expect(toRoundedArray(groups[0].positions)).toEqual([
      0, 0, 0,
      'NaN', 'NaN', 'NaN',
      1, 1, 0,
      'NaN', 'NaN', 'NaN',
    ]);
  });

  it('builds single-line positions with the requested z-order', () => {
    expect(toRoundedArray(buildSpectraWebGLLinePositions(line(1, '#ff0000', [0, 0, 1, 0.5]), 0.03))).toEqual([
      0, 0, 0.03,
      1, 0.5, 0.03,
    ]);
  });

  it('builds aggregated area, quantile area, and center-line geometry', () => {
    const geometry = buildSpectraWebGLAggregatedAreaGeometry({
      wavelengths: [100, 200],
      min: [0, 2],
      max: [10, 8],
      median: [5, 6],
      mean: [4, 7],
      quantileLower: [1, 3],
      quantileUpper: [9, 7],
      xRange: [100, 200],
      yRange: [0, 10],
      showMean: true,
    });

    expect(geometry).not.toBeNull();
    expect(toRoundedArray(geometry!.areaPositions)).toEqual([
      0, 0, -0.02,
      0, 1, -0.02,
      1, 0.2, -0.02,
      0, 1, -0.02,
      1, 0.8, -0.02,
      1, 0.2, -0.02,
    ]);
    expect(toRoundedArray(geometry!.quantilePositions!)).toEqual([
      0, 0.1, -0.015,
      0, 0.9, -0.015,
      1, 0.3, -0.015,
      0, 0.9, -0.015,
      1, 0.7, -0.015,
      1, 0.3, -0.015,
    ]);
    expect(toRoundedArray(geometry!.centerLinePositions)).toEqual([
      0, 0.4, 0,
      1, 0.7, 0,
    ]);
  });

  it('returns null when aggregated geometry has fewer than two points', () => {
    expect(buildSpectraWebGLAggregatedAreaGeometry({
      wavelengths: [100],
      min: [0],
      max: [1],
      median: [0.5],
      xRange: [100, 200],
      yRange: [0, 1],
    })).toBeNull();
  });
});
