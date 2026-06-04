import { describe, it, expect } from 'vitest';
import { hashPipeline, createPlaygroundQueryKey } from '../hashing';
import type { UnifiedOperator } from '@/types/playground';

function op(partial: Partial<UnifiedOperator> & { name: string }): UnifiedOperator {
  return {
    id: `${partial.name}-${Math.floor(Math.random() * 1e9)}`,
    type: 'preprocessing',
    params: {},
    enabled: true,
    ...partial,
  };
}

describe('playground cache hashing', () => {
  it('is invariant to the transient operator id (the import/restore cache-miss bug)', () => {
    // Same semantic pipeline, freshly generated ids (as happens on import/restore).
    const a = [op({ name: 'StandardNormalVariate', params: { window: 5 } }), op({ name: 'KFold', type: 'splitting', params: { n_splits: 3 } })];
    const b = [
      { ...a[0], id: 'totally-different-id-1' },
      { ...a[1], id: 'totally-different-id-2' },
    ];

    expect(hashPipeline(a)).toBe(hashPipeline(b));

    const spectra = [[1, 2, 3], [4, 5, 6]];
    expect(createPlaygroundQueryKey(spectra, undefined, a)).toEqual(
      createPlaygroundQueryKey(spectra, undefined, b),
    );
  });

  it('still distinguishes different params, order, and enabled state', () => {
    const base = [op({ name: 'SNV', params: { window: 5 } }), op({ name: 'Detrend', params: {} })];

    const differentParams = [{ ...base[0], params: { window: 7 } }, base[1]];
    expect(hashPipeline(base)).not.toBe(hashPipeline(differentParams));

    const reordered = [base[1], base[0]];
    expect(hashPipeline(base)).not.toBe(hashPipeline(reordered));

    const toggled = [{ ...base[0], enabled: false }, base[1]];
    expect(hashPipeline(base)).not.toBe(hashPipeline(toggled));
  });
});
