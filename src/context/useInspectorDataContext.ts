import { createContext, useContext } from 'react';
import type {
  GroupByExpressionConfig,
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByVariable,
  GroupMode,
  InspectorChainSummary,
  InspectorAvailableTarget,
  InspectorDataFilters,
  InspectorGroup,
  ScoreColumn,
} from '@/types/inspector';

export interface InspectorDataContextValue {
  // Data
  chains: InspectorChainSummary[];
  isLoading: boolean;
  error: string | null;

  // Filters
  filters: InspectorDataFilters;
  setFilters: (filters: InspectorDataFilters) => void;

  // Metadata for sidebar dropdowns
  availableMetrics: string[];
  availableModels: string[];
  availableDatasets: string[];
  availableRuns: string[];
  availablePreprocessings: string[];
  availableTargets: InspectorAvailableTarget[];

  // Groups
  groups: InspectorGroup[];
  groupMode: GroupMode;
  setGroupMode: (mode: GroupMode) => void;
  groupBy: GroupByVariable | null;
  setGroupBy: (variable: GroupByVariable | null) => void;
  rangeConfig: GroupByRangeConfig | null;
  setRangeConfig: (config: GroupByRangeConfig | null) => void;
  topKConfig: GroupByTopKConfig | null;
  setTopKConfig: (config: GroupByTopKConfig | null) => void;
  expressionConfig: GroupByExpressionConfig | null;
  setExpressionConfig: (config: GroupByExpressionConfig | null) => void;

  // Score/partition configuration
  scoreColumn: ScoreColumn;
  setScoreColumn: (col: ScoreColumn) => void;
  selectedScoreRefKey: string | null;
  setSelectedScoreRefKey: (key: string | null) => void;
  partition: string;
  setPartition: (partition: string) => void;
  targetIndex: number;
  setTargetIndex: (targetIndex: number) => void;

  // Helpers
  getChainGroup: (chainId: string) => InspectorGroup | undefined;
  refresh: () => void;
  totalChains: number;
}

export const InspectorDataContext = createContext<InspectorDataContextValue | null>(null);

export function useInspectorData(): InspectorDataContextValue {
  const context = useContext(InspectorDataContext);
  if (!context) {
    throw new Error('useInspectorData must be used within an InspectorDataProvider');
  }
  return context;
}
