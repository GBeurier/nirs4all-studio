import { createContext, useContext } from 'react';
import type {
  InspectorChainSummary,
  InspectorOutlierFilter,
  InspectorSelectionFilter,
} from '@/types/inspector';

export interface InspectorFilterContextValue {
  // Filter state
  scoreRange: [number, number] | null;
  outlier: InspectorOutlierFilter;
  selection: InspectorSelectionFilter;

  // Setters
  setScoreRange: (range: [number, number] | null) => void;
  setOutlierFilter: (filter: InspectorOutlierFilter) => void;
  setSelectionFilter: (filter: InspectorSelectionFilter) => void;
  clearAllFilters: () => void;

  // Computed
  filteredChains: InspectorChainSummary[];
  filteredChainIds: Set<string>;
  activeFilterCount: number;
  hasActiveFilters: boolean;
  scoreStats: { min: number; max: number; mean: number } | null;
  outlierChainIds: Set<string>;
}

export const InspectorFilterContext = createContext<InspectorFilterContextValue | null>(null);

export function useInspectorFilter(): InspectorFilterContextValue {
  const context = useContext(InspectorFilterContext);
  if (!context) {
    throw new Error('useInspectorFilter must be used within an InspectorFilterProvider');
  }
  return context;
}

export type {
  InspectorOutlierFilter,
  InspectorSelectionFilter,
};
