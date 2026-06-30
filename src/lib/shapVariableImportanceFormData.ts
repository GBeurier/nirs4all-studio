import type { ExplainerType, Partition } from '@/types/shap';

export interface ShapSelectOption<TValue extends string> {
  value: TValue;
  label: string;
}

export const SHAP_PARTITION_OPTIONS: ShapSelectOption<Partition>[] = [
  { value: 'test', label: 'Test' },
  { value: 'train', label: 'Train' },
  { value: 'all', label: 'All' },
];

export const SHAP_EXPLAINER_OPTIONS: ShapSelectOption<ExplainerType>[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'tree', label: 'Tree (RF, GBR, XGBoost)' },
  { value: 'linear', label: 'Linear (PLS, Ridge)' },
  { value: 'kernel', label: 'Kernel (any model)' },
];

export function normalizeShapPartition(value: string): Partition {
  return isShapPartition(value) ? value : 'test';
}

export function normalizeShapExplainerType(value: string): ExplainerType {
  return isShapExplainerType(value) ? value : 'auto';
}

export function buildShapPredictHref(chainId: string): string {
  return `/predict?model_id=${encodeURIComponent(chainId)}&source=chain`;
}

function isShapPartition(value: string): value is Partition {
  return SHAP_PARTITION_OPTIONS.some((option) => option.value === value);
}

function isShapExplainerType(value: string): value is ExplainerType {
  return SHAP_EXPLAINER_OPTIONS.some((option) => option.value === value);
}
