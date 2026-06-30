import { describe, expect, it } from 'vitest';

import {
  buildShapRebinRequest,
  getShapRebinErrorMessage,
  normalizeShapBinAggregation,
  parseShapBinSizeInput,
  parseShapBinStrideInput,
  SHAP_BIN_AGGREGATION_OPTIONS,
  SHAP_BIN_SIZE_LIMITS,
  SHAP_BIN_STRIDE_LIMITS,
} from './shapBinningControlsData';

describe('shapBinningControlsData', () => {
  it('normalizes aggregation values and exposes the existing options', () => {
    expect(SHAP_BIN_AGGREGATION_OPTIONS.map((option) => option.value)).toEqual([
      'sum',
      'sum_abs',
      'mean',
      'mean_abs',
    ]);
    expect(normalizeShapBinAggregation('sum_abs')).toBe('sum_abs');
    expect(normalizeShapBinAggregation('future')).toBe('mean_abs');
  });

  it('parses bin size and stride within their existing bounds', () => {
    expect(SHAP_BIN_SIZE_LIMITS).toEqual({ min: 5, max: 100 });
    expect(SHAP_BIN_STRIDE_LIMITS).toEqual({ min: 1, max: 50 });

    expect(parseShapBinSizeInput('5')).toBe(5);
    expect(parseShapBinSizeInput('100')).toBe(100);
    expect(parseShapBinSizeInput('4')).toBeNull();
    expect(parseShapBinSizeInput('101')).toBeNull();
    expect(parseShapBinSizeInput('abc')).toBeNull();

    expect(parseShapBinStrideInput('1')).toBe(1);
    expect(parseShapBinStrideInput('50')).toBe(50);
    expect(parseShapBinStrideInput('0')).toBeNull();
    expect(parseShapBinStrideInput('51')).toBeNull();
  });

  it('builds the rebin request payload and stable error messages', () => {
    expect(buildShapRebinRequest(20, 10, 'mean_abs')).toEqual({
      bin_size: 20,
      bin_stride: 10,
      bin_aggregation: 'mean_abs',
    });
    expect(getShapRebinErrorMessage(new Error('backend failed'))).toBe('backend failed');
    expect(getShapRebinErrorMessage('unknown')).toBe('Rebin failed');
  });
});
