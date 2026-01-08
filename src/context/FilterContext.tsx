/**
 * FilterContext - Centralized display filtering for Playground
 *
 * Phase 4: Display Filtering System
 *
 * Features:
 * - Partition filter (All, Train, Test, Specific Fold)
 * - Outlier filter (All, Hide Outliers, Outliers Only)
 * - Selection filter (All, Selected Only, Unselected Only)
 * - Metadata filter (column + values)
 * - Combined AND logic for all filters
 * - Active filter count and clear all
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { type PartitionFilter, getPartitionIndices } from '@/components/playground/PartitionSelector';
import type { FoldsInfo } from '@/types/playground';

// ============= Types =============

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

// ============= Initial State =============

const DEFAULT_FILTER_STATE: FilterState = {
  partition: 'all',
  outlier: 'all',
  selection: 'all',
  metadata: null,
};

// ============= Reducer =============

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case 'SET_PARTITION':
      return { ...state, partition: action.partition };

    case 'SET_OUTLIER':
      return { ...state, outlier: action.filter };

    case 'SET_SELECTION':
      return { ...state, selection: action.filter };

    case 'SET_METADATA':
      return { ...state, metadata: action.filter };

    case 'CLEAR_ALL':
      return DEFAULT_FILTER_STATE;

    default:
      return state;
  }
}

// ============= Filter Logic =============

/**
 * Apply partition filter to get indices
 */
function applyPartitionFilter(
  indices: number[],
  partition: PartitionFilter,
  folds: FoldsInfo | null,
  totalSamples: number
): number[] {
  if (partition === 'all') return indices;

  const partitionIndices = new Set(getPartitionIndices(partition, folds, totalSamples));
  return indices.filter(i => partitionIndices.has(i));
}

/**
 * Apply outlier filter
 */
function applyOutlierFilter(
  indices: number[],
  filter: OutlierFilter,
  outlierIndices: Set<number>
): number[] {
  if (filter === 'all') return indices;
  if (filter === 'hide') return indices.filter(i => !outlierIndices.has(i));
  if (filter === 'only') return indices.filter(i => outlierIndices.has(i));
  return indices;
}

/**
 * Apply selection filter
 */
function applySelectionFilter(
  indices: number[],
  filter: SelectionFilter,
  selectedSamples: Set<number>
): number[] {
  if (filter === 'all') return indices;
  if (filter === 'selected') return indices.filter(i => selectedSamples.has(i));
  if (filter === 'unselected') return indices.filter(i => !selectedSamples.has(i));
  return indices;
}

/**
 * Apply metadata filter
 */
function applyMetadataFilter(
  indices: number[],
  filter: MetadataFilter | null,
  metadata: Record<string, unknown[]> | null
): number[] {
  if (!filter || !metadata) return indices;

  const columnValues = metadata[filter.column];
  if (!columnValues) return indices;

  return indices.filter(i => {
    const value = columnValues[i];
    return filter.values.has(String(value));
  });
}

/**
 * Apply all filters with AND logic
 */
function getFilteredIndices(
  state: FilterState,
  context: FilterDataContext
): number[] {
  // Start with all indices
  let indices = Array.from({ length: context.totalSamples }, (_, i) => i);

  // Apply each filter in sequence (AND logic)
  indices = applyPartitionFilter(indices, state.partition, context.folds, context.totalSamples);
  indices = applyOutlierFilter(indices, state.outlier, context.outlierIndices);
  indices = applySelectionFilter(indices, state.selection, context.selectedSamples);
  indices = applyMetadataFilter(indices, state.metadata, context.metadata);

  return indices;
}

// ============= Context =============

const FilterContext = createContext<FilterContextValue | null>(null);

// ============= Provider =============

export interface FilterProviderProps {
  children: ReactNode;
  /** Initial filter state (optional) */
  initialState?: Partial<FilterState>;
}

export function FilterProvider({
  children,
  initialState,
}: FilterProviderProps) {
  const [state, dispatch] = useReducer(
    filterReducer,
    { ...DEFAULT_FILTER_STATE, ...initialState }
  );

  // ============= Actions =============

  const setPartitionFilter = useCallback((partition: PartitionFilter) => {
    dispatch({ type: 'SET_PARTITION', partition });
  }, []);

  const setOutlierFilter = useCallback((filter: OutlierFilter) => {
    dispatch({ type: 'SET_OUTLIER', filter });
  }, []);

  const setSelectionFilter = useCallback((filter: SelectionFilter) => {
    dispatch({ type: 'SET_SELECTION', filter });
  }, []);

  const setMetadataFilter = useCallback((filter: MetadataFilter | null) => {
    dispatch({ type: 'SET_METADATA', filter });
  }, []);

  const clearAllFilters = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
  }, []);

  // ============= Computed Values =============

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (state.partition !== 'all') count++;
    if (state.outlier !== 'all') count++;
    if (state.selection !== 'all') count++;
    if (state.metadata !== null) count++;
    return count;
  }, [state]);

  const hasActiveFilters = activeFilterCount > 0;

  // ============= Filter Application =============

  const getFilteredIndicesCallback = useCallback(
    (context: FilterDataContext) => getFilteredIndices(state, context),
    [state]
  );

  // ============= Context Value =============

  const value = useMemo<FilterContextValue>(() => ({
    // State
    ...state,

    // Setters
    setPartitionFilter,
    setOutlierFilter,
    setSelectionFilter,
    setMetadataFilter,
    clearAllFilters,

    // Computed
    activeFilterCount,
    hasActiveFilters,

    // Filter application
    getFilteredIndices: getFilteredIndicesCallback,
  }), [
    state,
    setPartitionFilter,
    setOutlierFilter,
    setSelectionFilter,
    setMetadataFilter,
    clearAllFilters,
    activeFilterCount,
    hasActiveFilters,
    getFilteredIndicesCallback,
  ]);

  return (
    <FilterContext.Provider value={value}>
      {children}
    </FilterContext.Provider>
  );
}

// ============= Hooks =============

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

export default FilterProvider;
