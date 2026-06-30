import type {
  GroupByExpressionConfig,
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByVariable,
  GroupMode,
  InspectorDataFilters,
  InspectorPanelType,
  InspectorViewState as PanelViewState,
  ScoreColumn,
} from '@/types/inspector';
import type { InspectorLayoutMode } from '@/lib/inspector/viewState';
import {
  clearSessionState,
  DEFAULT_SESSION_MAX_AGE_MS,
  readSessionState,
  writeSessionState,
  type SessionPersistenceStorage,
} from '@/lib/sessionPersistence';

export type InspectorSessionLayoutMode = InspectorLayoutMode;

export interface InspectorSessionState {
  filters: InspectorDataFilters;
  groupMode: GroupMode;
  groupBy: GroupByVariable | null;
  rangeConfig: GroupByRangeConfig | null;
  topKConfig: GroupByTopKConfig | null;
  expressionConfig: GroupByExpressionConfig | null;
  scoreColumn: ScoreColumn;
  selectedScoreRefKey: string | null;
  partition: string;
  targetIndex: number;
  panelStates: Record<string, PanelViewState>;
  layoutMode: InspectorSessionLayoutMode;
  savedAt: number;
}

export type InspectorSessionStorage = SessionPersistenceStorage;

export const INSPECTOR_SESSION_STORAGE_KEY = 'inspector-session-state';
export const INSPECTOR_SESSION_MAX_AGE_MS = DEFAULT_SESSION_MAX_AGE_MS;

export function createDefaultInspectorSessionState(now = Date.now()): InspectorSessionState {
  return {
    filters: {},
    groupMode: 'by_variable',
    groupBy: 'model_class',
    rangeConfig: null,
    topKConfig: null,
    expressionConfig: null,
    scoreColumn: 'cv_val_score',
    selectedScoreRefKey: null,
    partition: 'val',
    targetIndex: 0,
    panelStates: {},
    layoutMode: 'auto',
    savedAt: now,
  };
}

export function mergeInspectorSessionState(
  current: InspectorSessionState | null | undefined,
  update: Partial<InspectorSessionState>,
  now = Date.now(),
): InspectorSessionState {
  return {
    ...createDefaultInspectorSessionState(now),
    ...(current ?? {}),
    ...update,
    savedAt: now,
  };
}

export function migrateInspectorSessionState(state: InspectorSessionState): InspectorSessionState {
  const filters = { ...(state.filters as Record<string, unknown>) };
  const selectedScoreRefKey = typeof state.selectedScoreRefKey === 'string' && state.selectedScoreRefKey.trim().length > 0
    ? state.selectedScoreRefKey
    : null;

  if (typeof filters.run_id === 'string') {
    filters.run_ids = [filters.run_id];
    delete filters.run_id;
  }
  if (typeof filters.dataset_name === 'string') {
    filters.dataset_names = [filters.dataset_name];
    delete filters.dataset_name;
  }
  if (typeof filters.model_class === 'string') {
    filters.model_classes = [filters.model_class];
    delete filters.model_class;
  }

  return {
    ...state,
    filters: filters as InspectorDataFilters,
    selectedScoreRefKey,
  };
}

export function readInspectorSessionState(
  storage: InspectorSessionStorage,
  {
    maxAgeMs = INSPECTOR_SESSION_MAX_AGE_MS,
    now = Date.now(),
    storageKey = INSPECTOR_SESSION_STORAGE_KEY,
  }: {
    maxAgeMs?: number;
    now?: number;
    storageKey?: string;
  } = {},
): InspectorSessionState | null {
  return readSessionState<InspectorSessionState>(storage, {
    maxAgeMs,
    migrate: migrateInspectorSessionState,
    now,
    storageKey,
  });
}

export function writeInspectorSessionState(
  storage: InspectorSessionStorage,
  state: InspectorSessionState,
  storageKey = INSPECTOR_SESSION_STORAGE_KEY,
): void {
  writeSessionState(storage, storageKey, state);
}

export function clearInspectorSessionState(
  storage: Pick<InspectorSessionStorage, 'removeItem'>,
  storageKey = INSPECTOR_SESSION_STORAGE_KEY,
): void {
  clearSessionState(storage, storageKey);
}

export type {
  GroupByExpressionConfig,
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByVariable,
  GroupMode,
  InspectorDataFilters,
  InspectorPanelType,
  PanelViewState,
  ScoreColumn,
};
