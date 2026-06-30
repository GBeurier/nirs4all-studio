import type {
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByVariable,
  GroupMode,
  ScoreColumn,
} from '@/types/inspector';

export const INSPECTOR_GROUP_BY_OPTIONS: { value: GroupByVariable; label: string }[] = [
  { value: 'model_class', label: 'Model Class' },
  { value: 'preprocessings', label: 'Preprocessing' },
  { value: 'dataset_name', label: 'Dataset' },
  { value: 'task_type', label: 'Task Type' },
];

export const INSPECTOR_GROUP_PRIMARY_MODES: { value: GroupMode; label: string }[] = [
  { value: 'by_variable', label: 'Variable' },
  { value: 'by_top_k', label: 'Top K' },
];

export const INSPECTOR_GROUP_ADVANCED_MODES: { value: GroupMode; label: string }[] = [
  { value: 'by_range', label: 'Range' },
  { value: 'by_branch', label: 'Branch' },
  { value: 'by_expression', label: 'Expr' },
];

export function isInspectorAdvancedGroupMode(mode: GroupMode): boolean {
  return INSPECTOR_GROUP_ADVANCED_MODES.some(option => option.value === mode);
}

export function getInspectorGroupModeOptions(advancedVisible: boolean) {
  return advancedVisible
    ? [...INSPECTOR_GROUP_PRIMARY_MODES, ...INSPECTOR_GROUP_ADVANCED_MODES]
    : INSPECTOR_GROUP_PRIMARY_MODES;
}

export function clampInspectorRangeBinCount(value: number): number {
  return Math.max(2, Math.min(20, Number(value) || 5));
}

export function clampInspectorTopK(value: number): number {
  return Math.max(1, Math.min(100, Number(value) || 5));
}

export function getInspectorRangeConfigForColumn(
  scoreColumn: ScoreColumn,
  existing?: GroupByRangeConfig | null,
): GroupByRangeConfig {
  return { column: existing?.column ?? scoreColumn, binCount: existing?.binCount ?? 5 };
}

export function getInspectorTopKConfigForScore(
  scoreColumn: ScoreColumn,
  existing?: GroupByTopKConfig | null,
): GroupByTopKConfig {
  return { scoreColumn: existing?.scoreColumn ?? scoreColumn, k: existing?.k ?? 5 };
}
