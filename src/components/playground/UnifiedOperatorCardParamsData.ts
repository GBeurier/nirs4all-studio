import type { OperatorParamInfo } from '@/types/playground';

export type VisibleParamEntry = [string, OperatorParamInfo];

export interface NumericParamConfig {
  min: number;
  max: number;
  step: number;
}

const NUMERIC_PARAM_FALLBACKS: Record<string, readonly [number, number, number]> = {
  n_splits: [2, 20, 1],
  window_length: [3, 51, 2],
  polyorder: [1, 5, 1],
  deriv: [0, 2, 1],
  test_size: [0.1, 0.5, 0.05],
  random_state: [0, 100, 1],
};

const DEFAULT_INT_RANGE = [1, 100, 1] as const;
const DEFAULT_FLOAT_RANGE = [0, 1, 0.1] as const;

export function getVisibleParamEntries(paramDefs: Record<string, OperatorParamInfo>): VisibleParamEntry[] {
  return Object.entries(paramDefs).filter(([key, info]) => {
    if (key.startsWith('_')) return false;
    if (info.isAdvanced) return false;
    return true;
  });
}

export function formatParamDisplayName(paramKey: string): string {
  return paramKey.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getNumericParamConfig(
  paramKey: string,
  paramInfo: OperatorParamInfo,
  isInt: boolean
): NumericParamConfig {
  const fallback = NUMERIC_PARAM_FALLBACKS[paramKey] ?? (isInt ? DEFAULT_INT_RANGE : DEFAULT_FLOAT_RANGE);

  return {
    min: paramInfo.min ?? fallback[0],
    max: paramInfo.max ?? fallback[1],
    step: paramInfo.step ?? fallback[2],
  };
}

export function normalizeNumericParamValue(value: unknown, isInt: boolean, min: number): number {
  return typeof value === 'number' ? value : (isInt ? min : 0);
}

export function coerceWindowLengthValue(paramKey: string, value: number): number {
  if (paramKey === 'window_length' && value % 2 === 0) {
    return value + 1;
  }
  return value;
}

export function formatNumericParamDisplayValue(value: number | null | undefined, isInt: boolean): string {
  if (value == null) return '-';
  return isInt ? String(Math.round(value)) : value.toFixed(2);
}
