import { createContext, useContext } from 'react';
import type {
  GroupByExpressionConfig,
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByVariable,
  GroupMode,
  InspectorDataFilters,
  InspectorPanelType,
  InspectorSessionLayoutMode,
  InspectorSessionState,
  PanelViewState,
  ScoreColumn,
} from '@/lib/inspector/sessionState';

export type LayoutMode = InspectorSessionLayoutMode;
export type { InspectorSessionState };

export interface InspectorSessionContextValue {
  getSession: () => InspectorSessionState | null;
  saveSession: (state: Partial<InspectorSessionState>) => void;
  clearSession: () => void;
  hasSession: boolean;
}

export const InspectorSessionContext = createContext<InspectorSessionContextValue | null>(null);

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
