/**
 * InspectorSessionContext — Session persistence for Inspector state.
 *
 * Persists inspector state to sessionStorage so users can navigate away
 * and return to their previous view with:
 * - Source filters (run_id, dataset_name, model_class)
 * - Group configuration (mode, groupBy, rangeConfig, topKConfig, expressionConfig)
 * - Score column and partition
 * - Panel visibility and layout mode
 *
 * Note: Color config and selection state are already persisted by their own contexts.
 */

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type {
  InspectorDataFilters,
  InspectorViewState as PanelViewState,
  InspectorPanelType,
  GroupMode,
  GroupByVariable,
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByExpressionConfig,
  ScoreColumn,
} from '@/types/inspector';
import type { LayoutMode } from './InspectorViewContext';

// ============= Types =============

export interface InspectorSessionState {
  // Source filters
  filters: InspectorDataFilters;

  // Group configuration
  groupMode: GroupMode;
  groupBy: GroupByVariable | null;
  rangeConfig: GroupByRangeConfig | null;
  topKConfig: GroupByTopKConfig | null;
  expressionConfig: GroupByExpressionConfig | null;

  // Score/partition
  scoreColumn: ScoreColumn;
  partition: string;

  // View state
  panelStates: Record<string, PanelViewState>;
  layoutMode: LayoutMode;

  // Timestamp
  savedAt: number;
}

export interface InspectorSessionContextValue {
  getSession: () => InspectorSessionState | null;
  saveSession: (state: Partial<InspectorSessionState>) => void;
  clearSession: () => void;
  hasSession: boolean;
}

// ============= Constants =============

const STORAGE_KEY = 'inspector-session-state';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============= Storage Helpers =============

function loadSession(): InspectorSessionState | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed: InspectorSessionState = JSON.parse(stored);

    if (Date.now() - parsed.savedAt > SESSION_MAX_AGE_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function persistSession(state: InspectorSessionState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// ============= Context =============

const InspectorSessionContext = createContext<InspectorSessionContextValue | null>(null);

// ============= Provider =============

export function InspectorSessionProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<InspectorSessionState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    sessionRef.current = loadSession();
  }, []);

  const getSession = useCallback((): InspectorSessionState | null => {
    if (!sessionRef.current) {
      sessionRef.current = loadSession();
    }
    return sessionRef.current;
  }, []);

  const saveSession = useCallback((state: Partial<InspectorSessionState>) => {
    const current = sessionRef.current || {
      filters: {},
      groupMode: 'by_variable' as GroupMode,
      groupBy: 'model_class' as GroupByVariable,
      rangeConfig: null,
      topKConfig: null,
      expressionConfig: null,
      scoreColumn: 'cv_val_score' as ScoreColumn,
      partition: 'val',
      panelStates: {},
      layoutMode: 'auto' as LayoutMode,
      savedAt: Date.now(),
    };

    const newState: InspectorSessionState = {
      ...current,
      ...state,
      savedAt: Date.now(),
    };

    sessionRef.current = newState;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      persistSession(newState);
    }, 500);
  }, []);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    sessionStorage.removeItem(STORAGE_KEY);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
  }, []);

  const hasSession = useMemo(() => {
    return loadSession() !== null;
  }, []);

  const value = useMemo<InspectorSessionContextValue>(() => ({
    getSession,
    saveSession,
    clearSession,
    hasSession,
  }), [getSession, saveSession, clearSession, hasSession]);

  return (
    <InspectorSessionContext.Provider value={value}>
      {children}
    </InspectorSessionContext.Provider>
  );
}

// ============= Hooks =============

export function useInspectorSession(): InspectorSessionContextValue {
  const context = useContext(InspectorSessionContext);
  if (!context) {
    throw new Error('useInspectorSession must be used within an InspectorSessionProvider');
  }
  return context;
}

export function useInspectorSessionOptional(): InspectorSessionContextValue | null {
  return useContext(InspectorSessionContext);
}
