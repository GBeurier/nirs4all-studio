import { describe, expect, it } from 'vitest';
import { normalizeOperatorParameters } from '../operatorParameters';

describe('canonical constructor parameters', () => {
  it.each(['feature_range', 'quantile_range', 'offset_range', 'slope_range', 'shift_range', 'stretch_range'])('reconstructs %s without mutating editor controls', name => {
    const controls = { [`${name}_min`]: -2, [`${name}_max`]: 3 };
    expect(normalizeOperatorParameters('python.Operator', controls)).toEqual({ [name]: [-2, 3] });
    expect(Object.keys(controls)).toHaveLength(2);
  });
  it('omits an unset optional range and preserves native parameter names', () => {
    expect(normalizeOperatorParameters('python.Operator', { fwhm_range_min: null, fwhm_range_max: null })).toEqual({});
    expect(normalizeOperatorParameters('n4m:method', { value_min: 0, value_max: 1 })).toEqual({ value_min: 0, value_max: 1 });
  });
  it('migrates the unsupported default scope without discarding an explicit batch request', () => {
    const path = 'nirs4all.operators.augmentation.spectral.WavelengthShift';
    expect(normalizeOperatorParameters(path, { variation_scope: 'sample' })).toEqual({});
    expect(normalizeOperatorParameters(path, { variation_scope: 'batch' })).toEqual({ variation_scope: 'batch' });
  });
});
