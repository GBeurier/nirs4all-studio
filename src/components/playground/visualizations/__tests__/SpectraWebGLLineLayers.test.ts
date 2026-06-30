import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  partitionSpectraWebGLLines,
  type SpectraWebGLLinePartition,
} from '../spectraWebGLLinePartition';
import type { SpectraWebGLLineData } from '../spectraWebGLLines';

function line(index: number, isOriginal = false): SpectraWebGLLineData {
  return {
    index,
    isOriginal,
    color: new THREE.Color('#ff0000'),
    points: new Float32Array([0, 0, 1, 1]),
    pointCount: 2,
  };
}

function partitionIndices(partition: SpectraWebGLLinePartition) {
  return {
    normal: partition.normalLines.map(item => item.index),
    original: partition.originalLines.map(item => item.index),
    selected: partition.selectedLines.map(item => item.index),
    pinned: partition.pinnedLines.map(item => item.index),
  };
}

describe('partitionSpectraWebGLLines', () => {
  it('groups normal, original, selected, and pinned lines with pinned priority', () => {
    const partition = partitionSpectraWebGLLines(
      [
        line(0),
        line(1, true),
        line(2),
        line(3, true),
        line(4),
      ],
      new Set([2, 3, 4]),
      new Set([4])
    );

    expect(partitionIndices(partition)).toEqual({
      normal: [0],
      original: [1],
      selected: [2, 3],
      pinned: [4],
    });
  });

  it('keeps original lines behind normal lines when there is no selection state', () => {
    const partition = partitionSpectraWebGLLines([
      line(0, true),
      line(1),
    ]);

    expect(partitionIndices(partition)).toEqual({
      normal: [1],
      original: [0],
      selected: [],
      pinned: [],
    });
  });
});
