import { describe, expect, it, vi } from 'vitest';
import { omitReactPerformancePropDiff } from './reactPerformanceMeasure';

function reactOptions(properties: unknown[] = [['Changed Props', '']]): PerformanceMeasureOptions {
  return {
    start: 100,
    end: 125,
    detail: {
      debug: { task: 'render' },
      devtools: { track: 'Components ⚛', color: 'primary', tooltipText: 'SpectraChart', properties },
    },
  };
}

describe('React performance prop diff omission', () => {
  it('keeps timings and metadata without touching or cloning large matrix properties', () => {
    const matrix = Array.from({ length: 1000 }, () => new Float64Array(700));
    const properties: unknown[] = [['Changed Props', '']];
    const readMatrix = vi.fn(() => matrix);
    Object.defineProperty(properties, 1, { enumerable: true, get: readMatrix });
    const options = reactOptions(properties);
    const result = { name: '\u200bSpectraChart' } as PerformanceMeasure;
    const nativeMeasure = vi.fn<Performance['measure']>((_name, received) => {
      if (typeof received === 'object') structuredClone(received.detail);
      return result;
    });
    const measure = omitReactPerformancePropDiff(nativeMeasure);
    expect(measure('\u200bSpectraChart', options)).toBe(result);
    expect(nativeMeasure).toHaveBeenCalledWith('\u200bSpectraChart', {
      start: 100, end: 125,
      detail: {
        debug: { task: 'render' },
        devtools: { track: 'Components ⚛', color: 'primary', tooltipText: 'SpectraChart' },
      },
    });
    expect(readMatrix).not.toHaveBeenCalled();
    expect(options.detail.devtools.properties).toBe(properties);
  });

  it('preserves other measures and their original options identity', () => {
    const nativeMeasure = vi.fn<Performance['measure']>(() => ({} as PerformanceMeasure));
    const measure = omitReactPerformancePropDiff(nativeMeasure);
    const custom = reactOptions();
    measure('application preview', custom);
    expect(nativeMeasure.mock.calls[0]).toEqual(['application preview', custom]);
    expect(nativeMeasure.mock.calls[0][1]).toBe(custom);
    const scheduler = reactOptions();
    scheduler.detail.devtools.track = 'Blocking';
    measure('\u200bScheduler', scheduler);
    expect(nativeMeasure.mock.calls[1][1]).toBe(scheduler);
    const componentError = reactOptions([['Error', 'Reader unavailable']]);
    measure('\u200bSpectraChart', componentError);
    expect(nativeMeasure.mock.calls[2][1]).toBe(componentError);
    measure('legacy measure', 'start-mark', 'end-mark');
    expect(nativeMeasure.mock.calls[3]).toEqual(['legacy measure', 'start-mark', 'end-mark']);
  });

  it('propagates unrelated failures and preserves native clone errors outside React prop diffs', () => {
    const invalidTiming = new DOMException('Missing start mark', 'SyntaxError');
    const nativeMeasure = vi.fn<Performance['measure']>(() => { throw invalidTiming; });
    const measure = omitReactPerformancePropDiff(nativeMeasure);
    expect(() => measure('\u200bSpectraChart', reactOptions())).toThrow(invalidTiming);
    const invalidClone = new DOMException('Cannot clone payload', 'DataCloneError');
    nativeMeasure.mockImplementation(() => { throw invalidClone; });
    expect(() => measure('application timing', reactOptions())).toThrow(invalidClone);
    expect(measure('\u200bSpectraChart', reactOptions())).toBeUndefined();
  });
});
