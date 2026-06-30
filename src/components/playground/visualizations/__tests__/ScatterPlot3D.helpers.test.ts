import { describe, it, expect, vi } from 'vitest';
import {
  safeFinite,
  normalizeData,
  parsePointColor,
  DIMMED_COLOR,
} from '../ScatterPlot3D.helpers';
import type { DataPoint } from '../ScatterPlot3D.types';

const makePoint = (overrides: Partial<DataPoint> & { index: number }): DataPoint => ({
  x: 0,
  y: 0,
  name: `s${overrides.index}`,
  ...overrides,
});

describe('safeFinite', () => {
  it('returns the value when finite', () => {
    expect(safeFinite(3.5, 0)).toBe(3.5);
    expect(safeFinite(0, 9)).toBe(0);
  });

  it('falls back for undefined/null/non-finite', () => {
    expect(safeFinite(undefined, 7)).toBe(7);
    expect(safeFinite(null, 7)).toBe(7);
    expect(safeFinite(NaN, 7)).toBe(7);
    expect(safeFinite(Infinity, 7)).toBe(7);
  });
});

describe('normalizeData', () => {
  it('returns empty + default bounds for empty input', () => {
    const { normalized, bounds } = normalizeData([]);
    expect(normalized).toEqual([]);
    expect(bounds.min.toArray()).toEqual([-1, -1, -1]);
    expect(bounds.max.toArray()).toEqual([1, 1, 1]);
    expect(bounds.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('normalizes coordinates into the [-1, 1] range and preserves raw bounds', () => {
    const data = [
      makePoint({ index: 0, x: 0, y: 0, z: 0 }),
      makePoint({ index: 1, x: 10, y: 20, z: 4 }),
    ];
    const { normalized, bounds } = normalizeData(data);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toMatchObject({ index: 0, x: -1, y: -1, z: -1 });
    expect(normalized[1]).toMatchObject({ index: 1, x: 1, y: 1, z: 1 });
    expect(bounds.min.toArray()).toEqual([0, 0, 0]);
    expect(bounds.max.toArray()).toEqual([10, 20, 4]);
    expect(bounds.scale.toArray()).toEqual([10, 20, 4]);
  });

  it('treats missing z as 0', () => {
    const data = [
      makePoint({ index: 0, x: 0, y: 0 }),
      makePoint({ index: 1, x: 2, y: 2 }),
    ];
    const { normalized, bounds } = normalizeData(data);
    expect(normalized.every(p => Number.isFinite(p.z))).toBe(true);
    // Raw z collapses to 0 for every point, so the z range is degenerate (-> 1)
    // and normalized z is -1 for all of them.
    expect(bounds.min.z).toBe(0);
    expect(bounds.max.z).toBe(0);
    expect(normalized[0].z).toBe(-1);
  });

  it('filters out points with non-finite coordinates', () => {
    const data = [
      makePoint({ index: 0, x: 0, y: 0, z: 0 }),
      makePoint({ index: 1, x: NaN, y: 1, z: 1 }),
      makePoint({ index: 2, x: 1, y: Infinity, z: 1 }),
      makePoint({ index: 3, x: 5, y: 5, z: 5 }),
    ];
    const { normalized } = normalizeData(data);
    expect(normalized.map(p => p.index)).toEqual([0, 3]);
  });

  it('avoids division-by-zero for a single point (range collapses to 1)', () => {
    const data = [makePoint({ index: 0, x: 4, y: 4, z: 4 })];
    const { normalized, bounds } = normalizeData(data);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ x: -1, y: -1, z: -1 });
    expect(bounds.scale.toArray()).toEqual([1, 1, 1]);
  });
});

describe('parsePointColor', () => {
  it('returns the dimmed color when dimmed', () => {
    expect(parsePointColor('hsl(120, 50%, 50%)', true)).toBe(DIMMED_COLOR);
  });

  it('converts hsl()/hsla() to hex', () => {
    expect(parsePointColor('hsl(0, 100%, 50%)')).toBe('#ff0000');
    expect(parsePointColor('hsla(240, 100%, 50%, 0.5)')).toBe('#0000ff');
  });

  it('passes hex colors through unchanged', () => {
    expect(parsePointColor('#abcdef')).toBe('#abcdef');
  });

  it('falls back to indigo for unrecognized formats', () => {
    expect(parsePointColor('rebeccapurple')).toBe('#6366f1');
  });
});
