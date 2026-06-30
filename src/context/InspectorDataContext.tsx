/**
 * InspectorDataContext — Data loading and group management for Inspector.
 *
 * Loads chain summaries from the backend, tracks filters and source selection,
 * and manages prediction groups (by_variable, by_range, by_top_k, by_branch).
 */

import {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { getInspectorData } from '@/api/inspector';
import { useInspectorSessionOptional } from './useInspectorSession';
import type {
  InspectorChainSummary,
  InspectorDataFilters,
  InspectorGroup,
  GroupByVariable,
  GroupMode,
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByExpressionConfig,
  ScoreColumn,
} from '@/types/inspector';
import {
  buildInspectorChainGroupMap,
  computeInspectorGroupsFromStore,
} from '@/lib/inspector/grouping';
import { buildResultAnalysisStore } from '@/lib/inspector/resultAnalysisStore';
import {
  InspectorDataContext,
  type InspectorDataContextValue,
} from '@/context/useInspectorDataContext';

const EMPTY_CHAINS: InspectorChainSummary[] = [];

// ============= Provider =============
export function InspectorDataProvider({ children }: { children: ReactNode }) {
  const session = useInspectorSessionOptional();
  const restoredRef = useRef(false);

  // Restore from session on mount (lazy initializers)
  const [filters, setFilters] = useState<InspectorDataFilters>(() => {
    return session?.getSession()?.filters ?? {};
  });
  const [groupMode, setGroupMode] = useState<GroupMode>(() => {
    return session?.getSession()?.groupMode ?? 'by_variable';
  });
  const [groupBy, setGroupBy] = useState<GroupByVariable | null>(() => {
    const s = session?.getSession();
    return s ? s.groupBy : 'model_class';
  });
  const [rangeConfig, setRangeConfig] = useState<GroupByRangeConfig | null>(() => {
    return session?.getSession()?.rangeConfig ?? null;
  });
  const [topKConfig, setTopKConfig] = useState<GroupByTopKConfig | null>(() => {
    return session?.getSession()?.topKConfig ?? null;
  });
  const [expressionConfig, setExpressionConfig] = useState<GroupByExpressionConfig | null>(() => {
    return session?.getSession()?.expressionConfig ?? null;
  });
  const [scoreColumn, setScoreColumn] = useState<ScoreColumn>(() => {
    return session?.getSession()?.scoreColumn ?? 'cv_val_score';
  });
  const [selectedScoreRefKey, setSelectedScoreRefKey] = useState<string | null>(() => {
    return session?.getSession()?.selectedScoreRefKey ?? null;
  });
  const [partition, setPartition] = useState(() => {
    return session?.getSession()?.partition ?? 'val';
  });
  const [targetIndex, setTargetIndex] = useState(() => {
    return session?.getSession()?.targetIndex ?? 0;
  });

  // Mark as restored after mount
  useEffect(() => { restoredRef.current = true; }, []);

  // Auto-save data state to session on changes
  useEffect(() => {
    if (!restoredRef.current || !session) return;
    session.saveSession({
      filters,
      groupMode,
      groupBy,
      rangeConfig,
      topKConfig,
      expressionConfig,
      scoreColumn,
      selectedScoreRefKey,
      partition,
      targetIndex,
    });
  }, [filters, groupMode, groupBy, rangeConfig, topKConfig, expressionConfig, scoreColumn, selectedScoreRefKey, partition, targetIndex, session]);

  // Fetch chain summaries
  const {
    data,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['inspector', 'data', filters],
    queryFn: () => getInspectorData(filters),
    staleTime: 30_000,
    retry: 1,
  });

  const chains = data?.chains ?? EMPTY_CHAINS;
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;

  const analysisStore = useMemo(
    () => buildResultAnalysisStore({ chains }),
    [chains],
  );

  // Compute groups
  const groups = useMemo(
    () => computeInspectorGroupsFromStore(analysisStore, {
      groupMode,
      groupBy,
      rangeConfig,
      topKConfig,
      expressionConfig,
    }),
    [analysisStore, groupMode, groupBy, rangeConfig, topKConfig, expressionConfig],
  );

  // Build chain→group lookup
  const chainGroupMap = useMemo(() => {
    return buildInspectorChainGroupMap(groups);
  }, [groups]);

  const getChainGroup = useCallback(
    (chainId: string) => chainGroupMap.get(chainId),
    [chainGroupMap],
  );

  const refresh = useCallback(() => { refetch(); }, [refetch]);

  const value = useMemo<InspectorDataContextValue>(() => ({
    chains,
    isLoading,
    error,
    filters,
    setFilters,
    availableMetrics: data?.available_metrics ?? [],
    availableModels: data?.available_models ?? [],
    availableDatasets: data?.available_datasets ?? [],
    availableRuns: data?.available_runs ?? [],
    availablePreprocessings: data?.available_preprocessings ?? [],
    availableTargets: data?.available_targets ?? [],
    groups,
    groupMode,
    setGroupMode,
    groupBy,
    setGroupBy,
    rangeConfig,
    setRangeConfig,
    topKConfig,
    setTopKConfig,
    expressionConfig,
    setExpressionConfig,
    scoreColumn,
    setScoreColumn,
    selectedScoreRefKey,
    setSelectedScoreRefKey,
    partition,
    setPartition,
    targetIndex,
    setTargetIndex,
    getChainGroup,
    refresh,
    totalChains: data?.total ?? 0,
  }), [
    chains, isLoading, error, filters, data,
    groups, groupMode, groupBy, rangeConfig, topKConfig, expressionConfig,
    scoreColumn, selectedScoreRefKey, partition, targetIndex, getChainGroup, refresh,
  ]);

  return (
    <InspectorDataContext.Provider value={value}>
      {children}
    </InspectorDataContext.Provider>
  );
}
