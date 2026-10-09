import type { TFunction } from 'i18next';
import type { BinAggregation, RebinRequest } from '@/types/shap';

export const SHAP_BIN_SIZE_LIMITS = {
  min: 5,
  max: 100,
} as const;

export const SHAP_BIN_STRIDE_LIMITS = {
  min: 1,
  max: 50,
} as const;

export const SHAP_BIN_AGGREGATION_OPTIONS: Array<{ value: BinAggregation; labelKey: string }> = [
  { value: 'sum', labelKey: 'results.variableImportance.binAggregation.sum' },
  { value: 'sum_abs', labelKey: 'results.variableImportance.binAggregation.sum_abs' },
  { value: 'mean', labelKey: 'results.variableImportance.binAggregation.mean' },
  { value: 'mean_abs', labelKey: 'results.variableImportance.binAggregation.mean_abs' },
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

export function getShapRebinErrorMessage(error: unknown, t: TFunction): string {
  return error instanceof Error ? error.message : t('results.variableImportance.rebinFailed');
}

function isShapBinAggregation(value: string): value is BinAggregation {
  return SHAP_BIN_AGGREGATION_OPTIONS.some((option) => option.value === value);
}

function parseBoundedInteger(value: string, min: number, max: number): number | null {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}
