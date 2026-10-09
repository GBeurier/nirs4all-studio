import type { ExplainerType, Partition } from '@/types/shap';

export interface ShapSelectOption<TValue extends string> {
  value: TValue;
  labelKey: string;
}

export const SHAP_PARTITION_OPTIONS: ShapSelectOption<Partition>[] = [
  { value: 'test', labelKey: 'results.variableImportance.partitionOptions.test' },
  { value: 'train', labelKey: 'results.variableImportance.partitionOptions.train' },
  { value: 'all', labelKey: 'results.variableImportance.partitionOptions.all' },
];

export const SHAP_EXPLAINER_OPTIONS: ShapSelectOption<ExplainerType>[] = [
  { value: 'auto', labelKey: 'results.variableImportance.explainerOptions.auto' },
  { value: 'tree', labelKey: 'results.variableImportance.explainerOptions.tree' },
  { value: 'linear', labelKey: 'results.variableImportance.explainerOptions.linear' },
  { value: 'kernel', labelKey: 'results.variableImportance.explainerOptions.kernel' },
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
