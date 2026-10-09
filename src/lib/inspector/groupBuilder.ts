import type {
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByVariable,
  GroupMode,
  ScoreColumn,
} from '@/types/inspector';

export const INSPECTOR_GROUP_BY_OPTIONS: { value: GroupByVariable; labelKey: string }[] = [
  { value: 'model_class', labelKey: 'inspector.fields.modelClass' },
  { value: 'preprocessings', labelKey: 'inspector.fields.preprocessing' },
  { value: 'dataset_name', labelKey: 'inspector.fields.dataset' },
  { value: 'task_type', labelKey: 'inspector.fields.taskType' },
];

export const INSPECTOR_GROUP_PRIMARY_MODES: { value: GroupMode; labelKey: string }[] = [
  { value: 'by_variable', labelKey: 'inspector.groupModes.by_variable' },
  { value: 'by_top_k', labelKey: 'inspector.groupModes.by_top_k' },
];

export const INSPECTOR_GROUP_ADVANCED_MODES: { value: GroupMode; labelKey: string }[] = [
  { value: 'by_range', labelKey: 'inspector.groupModes.by_range' },
  { value: 'by_branch', labelKey: 'inspector.groupModes.by_branch' },
  { value: 'by_expression', labelKey: 'inspector.groupModes.by_expression' },
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
