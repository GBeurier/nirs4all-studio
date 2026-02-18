/**
 * InspectorFilterContext — Non-destructive chain-level filtering for Inspector.
 *
 * Provides filteredChains and filteredChainIds to all consumers.
 * Filters: task type, score range, IQR-based outliers, selection.
 */

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useInspectorData } from './InspectorDataContext';
import { useInspectorSelection } from './InspectorSelectionContext';
import type {
  InspectorChainSummary,
  InspectorOutlierFilter,
  InspectorSelectionFilter,
  ScoreColumn,
} from '@/types/inspector';

// ============= Types =============

export interface InspectorFilterContextValue {
  // Filter state
  taskType: string;
  scoreRange: [number, number] | null;
  outlier: InspectorOutlierFilter;
  selection: InspectorSelectionFilter;

  // Setters
  setTaskTypeFilter: (taskType: string) => void;
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

// ============= Context =============

const InspectorFilterContext = createContext<InspectorFilterContextValue | null>(null);

// ============= Outlier Detection =============

function computeOutlierChainIds(chains: InspectorChainSummary[], scoreColumn: ScoreColumn): Set<string> {
  const scores: number[] = [];
  const chainIds: string[] = [];
  for (const c of chains) {
    const val = c[scoreColumn];
    if (val != null) {
      scores.push(val);
      chainIds.push(c.chain_id);
    }
  }
  if (scores.length < 4) return new Set();

  const sorted = [...scores].sort((a, b) => a - b);
  const q25 = sorted[Math.floor(sorted.length * 0.25)];
  const q75 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q75 - q25;
  const lower = q25 - 1.5 * iqr;
  const upper = q75 + 1.5 * iqr;

  const outliers = new Set<string>();
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] < lower || scores[i] > upper) {
      outliers.add(chainIds[i]);
    }
  }
  return outliers;
}

function computeScoreStats(chains: InspectorChainSummary[], scoreColumn: ScoreColumn): { min: number; max: number; mean: number } | null {
  const scores: number[] = [];
  for (const c of chains) {
    const val = c[scoreColumn];
    if (val != null) scores.push(val);
  }
  if (scores.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
    sum += s;
  }
  return { min, max, mean: sum / scores.length };
}

// ============= Provider =============

export function InspectorFilterProvider({ children }: { children: ReactNode }) {
  const { chains, scoreColumn } = useInspectorData();
  const { selectedChains, hasSelection } = useInspectorSelection();

  const [taskType, setTaskType] = useState('all');
  const [scoreRange, setScoreRange] = useState<[number, number] | null>(null);
  const [outlier, setOutlier] = useState<InspectorOutlierFilter>('all');
  const [selection, setSelection] = useState<InspectorSelectionFilter>('all');

  // Score stats from unfiltered chains (for slider bounds)
  const scoreStats = useMemo(
    () => computeScoreStats(chains as InspectorChainSummary[], scoreColumn),
    [chains, scoreColumn],
  );

  // Outlier chain IDs (IQR-based)
  const outlierChainIds = useMemo(
    () => computeOutlierChainIds(chains as InspectorChainSummary[], scoreColumn),
    [chains, scoreColumn],
  );

  // Apply filter pipeline (sequential AND logic)
  const filteredChains = useMemo(() => {
    let result = chains as InspectorChainSummary[];

    // 1. Task type filter
    if (taskType !== 'all') {
      result = result.filter(c => {
        if (!c.task_type) return false;
        if (taskType === 'regression') return c.task_type === 'regression';
        return c.task_type === 'binary_classification' || c.task_type === 'multiclass_classification' || c.task_type === 'classification';
      });
    }

    // 2. Score range filter
    if (scoreRange) {
      const [min, max] = scoreRange;
      result = result.filter(c => {
        const val = c[scoreColumn];
        return val != null && val >= min && val <= max;
      });
    }

    // 3. Outlier filter
    if (outlier !== 'all') {
      if (outlier === 'hide') {
        result = result.filter(c => !outlierChainIds.has(c.chain_id));
      } else {
        result = result.filter(c => outlierChainIds.has(c.chain_id));
      }
    }

    // 4. Selection filter
    if (selection !== 'all' && hasSelection) {
      if (selection === 'selected') {
        result = result.filter(c => selectedChains.has(c.chain_id));
      } else {
        result = result.filter(c => !selectedChains.has(c.chain_id));
      }
    }

    return result;
  }, [chains, taskType, scoreRange, scoreColumn, outlier, outlierChainIds, selection, hasSelection, selectedChains]);

  const filteredChainIds = useMemo(
    () => new Set(filteredChains.map(c => c.chain_id)),
    [filteredChains],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (taskType !== 'all') count++;
    if (scoreRange !== null) count++;
    if (outlier !== 'all') count++;
    if (selection !== 'all') count++;
    return count;
  }, [taskType, scoreRange, outlier, selection]);

  const clearAllFilters = useCallback(() => {
    setTaskType('all');
    setScoreRange(null);
    setOutlier('all');
    setSelection('all');
  }, []);

  const value = useMemo<InspectorFilterContextValue>(() => ({
    taskType,
    scoreRange,
    outlier,
    selection,
    setTaskTypeFilter: setTaskType,
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
    taskType, scoreRange, outlier, selection, clearAllFilters,
    filteredChains, filteredChainIds, activeFilterCount,
    scoreStats, outlierChainIds,
  ]);

  return (
    <InspectorFilterContext.Provider value={value}>
      {children}
    </InspectorFilterContext.Provider>
  );
}

// ============= Hook =============

export function useInspectorFilter(): InspectorFilterContextValue {
  const context = useContext(InspectorFilterContext);
  if (!context) {
    throw new Error('useInspectorFilter must be used within an InspectorFilterProvider');
  }
  return context;
}
