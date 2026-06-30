/**
 * InspectorFilterContext — Non-destructive chain-level filtering for Inspector.
 *
 * Provides filteredChains and filteredChainIds to all consumers.
 * Filters: task type, score range, IQR-based outliers, selection.
 */

import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useInspectorData } from './useInspectorDataContext';
import { useInspectorSelection } from './useInspectorSelection';
import {
  computeResultAnalysisOutlierChainIds,
  computeResultAnalysisScoreStats,
  filterResultAnalysisChains,
} from '@/lib/inspector/filtering';
import { buildResultAnalysisStore } from '@/lib/inspector/resultAnalysisStore';
import type {
  InspectorOutlierFilter,
  InspectorSelectionFilter,
} from '@/types/inspector';
import {
  InspectorFilterContext,
  type InspectorFilterContextValue,
} from '@/context/useInspectorFilter';

// ============= Provider =============

export function InspectorFilterProvider({ children }: { children: ReactNode }) {
  const { chains, scoreColumn } = useInspectorData();
  const { selectedChains, hasSelection } = useInspectorSelection();

  const [scoreRange, setScoreRange] = useState<[number, number] | null>(null);
  const [outlier, setOutlier] = useState<InspectorOutlierFilter>('all');
  const [selection, setSelection] = useState<InspectorSelectionFilter>('all');

  const analysisStore = useMemo(
    () => buildResultAnalysisStore({ chains }),
    [chains],
  );

  // Score stats from unfiltered chains (for slider bounds)
  const scoreStats = useMemo(
    () => computeResultAnalysisScoreStats(analysisStore, scoreColumn),
    [analysisStore, scoreColumn],
  );

  // Outlier chain IDs (IQR-based)
  const outlierChainIds = useMemo(
    () => computeResultAnalysisOutlierChainIds(analysisStore, scoreColumn),
    [analysisStore, scoreColumn],
  );

  // Apply filter pipeline (sequential AND logic)
  const filteredChains = useMemo(() => filterResultAnalysisChains({
    store: analysisStore,
    scoreColumn,
    scoreRange,
    outlier,
    outlierChainIds,
    selection,
    selectedChainIds: selectedChains,
    hasSelection,
  }), [analysisStore, scoreRange, scoreColumn, outlier, outlierChainIds, selection, hasSelection, selectedChains]);

  const filteredChainIds = useMemo(
    () => new Set(filteredChains.map(c => c.chain_id)),
    [filteredChains],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (scoreRange !== null) count++;
    if (outlier !== 'all') count++;
    if (selection !== 'all') count++;
    return count;
  }, [scoreRange, outlier, selection]);

  const clearAllFilters = useCallback(() => {
    setScoreRange(null);
    setOutlier('all');
    setSelection('all');
  }, []);

  const value = useMemo<InspectorFilterContextValue>(() => ({
    scoreRange,
    outlier,
    selection,
    setScoreRange,
    setOutlierFilter: setOutlier,
    setSelectionFilter: setSelection,
    clearAllFilters,
    filteredChains,
    filteredChainIds,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    scoreStats,
    outlierChainIds,
  }), [
    scoreRange, outlier, selection, clearAllFilters,
    filteredChains, filteredChainIds, activeFilterCount,
    scoreStats, outlierChainIds,
  ]);

  return (
    <InspectorFilterContext.Provider value={value}>
      {children}
    </InspectorFilterContext.Provider>
  );
}
