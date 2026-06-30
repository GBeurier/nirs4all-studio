import type { BinAggregation, RebinRequest } from '@/types/shap';

export const SHAP_BIN_SIZE_LIMITS = {
  min: 5,
  max: 100,
} as const;

export const SHAP_BIN_STRIDE_LIMITS = {
  min: 1,
  max: 50,
} as const;

export const SHAP_BIN_AGGREGATION_OPTIONS: Array<{ value: BinAggregation; label: string }> = [
  { value: 'sum', label: 'Sum' },
  { value: 'sum_abs', label: 'Sum |SHAP|' },
  { value: 'mean', label: 'Mean' },
  { value: 'mean_abs', label: 'Mean |SHAP|' },
];

export function normalizeShapBinAggregation(value: string): BinAggregation {
  return isShapBinAggregation(value) ? value : 'mean_abs';
}

export function parseShapBinSizeInput(value: string): number | null {
  return parseBoundedInteger(value, SHAP_BIN_SIZE_LIMITS.min, SHAP_BIN_SIZE_LIMITS.max);
}

export function parseShapBinStrideInput(value: string): number | null {
  return parseBoundedInteger(value, SHAP_BIN_STRIDE_LIMITS.min, SHAP_BIN_STRIDE_LIMITS.max);
}

export function buildShapRebinRequest(
  binSize: number,
  binStride: number,
  binAggregation: BinAggregation,
): RebinRequest {
  return {
    bin_size: binSize,
    bin_stride: binStride,
    bin_aggregation: binAggregation,
  };
}

export function getShapRebinErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Rebin failed';
}

function isShapBinAggregation(value: string): value is BinAggregation {
  return SHAP_BIN_AGGREGATION_OPTIONS.some((option) => option.value === value);
}

function parseBoundedInteger(value: string, min: number, max: number): number | null {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}
