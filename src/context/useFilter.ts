import { createContext, useContext } from 'react';

import type { PartitionFilter } from '@/lib/playground/partitionFilters';
import type { FoldsInfo } from '@/types/playground';

export type OutlierFilter = 'all' | 'hide' | 'only';

export type SelectionFilter = 'all' | 'selected' | 'unselected';

export interface MetadataFilter {
  column: string;
  values: Set<string>;
}

export interface FilterState {
  /** Partition filter (train/test/fold) */
  partition: PartitionFilter;
  /** Outlier display filter */
  outlier: OutlierFilter;
  /** Selection display filter */
  selection: SelectionFilter;
  /** Metadata column/values filter */
  metadata: MetadataFilter | null;
}

export interface FilterDataContext {
  /** Total number of samples */
  totalSamples: number;
  /** Fold information for partition filtering */
  folds: FoldsInfo | null;
  /** Outlier indices (from detection) */
  outlierIndices: Set<number>;
  /** Selected sample indices */
  selectedSamples: Set<number>;
  /** Metadata columns and values */
  metadata: Record<string, unknown[]> | null;
}

export type FilterAction =
  | { type: 'SET_PARTITION'; partition: PartitionFilter }
  | { type: 'SET_OUTLIER'; filter: OutlierFilter }
  | { type: 'SET_SELECTION'; filter: SelectionFilter }
  | { type: 'SET_METADATA'; filter: MetadataFilter | null }
  | { type: 'CLEAR_ALL' };

export interface FilterContextValue extends FilterState {
  // Setters
  setPartitionFilter: (partition: PartitionFilter) => void;
  setOutlierFilter: (filter: OutlierFilter) => void;
  setSelectionFilter: (filter: SelectionFilter) => void;
  setMetadataFilter: (filter: MetadataFilter | null) => void;
  clearAllFilters: () => void;

  // Computed
  activeFilterCount: number;
  hasActiveFilters: boolean;

  // Filter application
  getFilteredIndices: (context: FilterDataContext) => number[];
}

export const FilterContext = createContext<FilterContextValue | null>(null);

/**
 * Hook to access filter context (throws if not within provider)
 */
export function useFilter(): FilterContextValue {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useFilter must be used within a FilterProvider');
  }
  return context;
}

/**
 * Optional hook that returns null if not within provider
 * Useful for components that can work with or without the context
 */
export function useFilterOptional(): FilterContextValue | null {
  return useContext(FilterContext);
}
