/**
 * InspectorDataContext — Data loading and group management for Inspector.
 *
 * Loads chain summaries from the backend, tracks filters and source selection,
 * and manages prediction groups (by_variable, by_range, by_top_k, by_branch).
 */

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { getInspectorData } from '@/api/inspector';
import { useInspectorSessionOptional } from './InspectorSessionContext';
import type {
  InspectorChainSummary,
  InspectorDataFilters,
  InspectorGroup,
  GroupByVariable,
  GroupMode,
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByExpressionConfig,
  ExpressionRule,
  ExpressionCombinator,
  ScoreColumn,
} from '@/types/inspector';
import { INSPECTOR_GROUP_COLORS } from '@/types/inspector';

// ============= Types =============

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
  partition: string;
  setPartition: (partition: string) => void;

  // Helpers
  getChainGroup: (chainId: string) => InspectorGroup | undefined;
  refresh: () => void;
  totalChains: number;
}

// ============= Context =============

const InspectorDataContext = createContext<InspectorDataContextValue | null>(null);

// ============= Group Computation =============

function computeGroupsByVariable(
  chains: InspectorChainSummary[],
  groupBy: GroupByVariable | null,
): InspectorGroup[] {
  if (!groupBy || chains.length === 0) return [];

  const buckets = new Map<string, string[]>();
  for (const chain of chains) {
    const rawValue = chain[groupBy];
    const value = rawValue != null ? String(rawValue) : '(empty)';
    if (!buckets.has(value)) buckets.set(value, []);
    buckets.get(value)!.push(chain.chain_id);
  }

  const groups: InspectorGroup[] = [];
  let colorIndex = 0;
  for (const [label, chainIds] of buckets) {
    groups.push({
      id: `group-${groupBy}-${label}`,
      label,
      color: INSPECTOR_GROUP_COLORS[colorIndex % INSPECTOR_GROUP_COLORS.length],
      chain_ids: chainIds,
    });
    colorIndex++;
  }

  groups.sort((a, b) => b.chain_ids.length - a.chain_ids.length);
  return groups;
}

function computeGroupsByRange(
  chains: InspectorChainSummary[],
  config: GroupByRangeConfig | null,
): InspectorGroup[] {
  if (!config || chains.length === 0) return [];

  // Collect valid scores
  const scores: number[] = [];
  for (const c of chains) {
    const val = c[config.column];
    if (val != null) scores.push(val);
  }
  if (scores.length === 0) return [];

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const binCount = Math.max(2, config.binCount);
  const binWidth = (max - min) / binCount;

  const groups: InspectorGroup[] = [];
  for (let i = 0; i < binCount; i++) {
    const binMin = min + i * binWidth;
    const binMax = i === binCount - 1 ? max + 0.001 : min + (i + 1) * binWidth;
    const label = `${binMin.toFixed(3)} – ${(i === binCount - 1 ? max : binMax).toFixed(3)}`;
    const matchingIds = chains
      .filter(c => {
        const val = c[config.column];
        return val != null && val >= binMin && val < binMax;
      })
      .map(c => c.chain_id);

    if (matchingIds.length > 0) {
      groups.push({
        id: `group-range-${i}`,
        label,
        color: INSPECTOR_GROUP_COLORS[i % INSPECTOR_GROUP_COLORS.length],
        chain_ids: matchingIds,
      });
    }
  }
  return groups;
}

function computeGroupsByTopK(
  chains: InspectorChainSummary[],
  config: GroupByTopKConfig | null,
): InspectorGroup[] {
  if (!config || chains.length === 0) return [];

  const sorted = [...chains]
    .filter(c => c[config.scoreColumn] != null)
    .sort((a, b) => {
      const aVal = a[config.scoreColumn] ?? 0;
      const bVal = b[config.scoreColumn] ?? 0;
      return config.ascending ? aVal - bVal : bVal - aVal;
    });

  const topK = sorted.slice(0, config.k);
  const rest = sorted.slice(config.k);

  const groups: InspectorGroup[] = [
    {
      id: 'group-top-k',
      label: `Top ${config.k}`,
      color: INSPECTOR_GROUP_COLORS[0],
      chain_ids: topK.map(c => c.chain_id),
    },
  ];

  if (rest.length > 0) {
    groups.push({
      id: 'group-rest',
      label: `Others (${rest.length})`,
      color: INSPECTOR_GROUP_COLORS[1],
      chain_ids: rest.map(c => c.chain_id),
    });
  }
  return groups;
}

function computeGroupsByBranch(chains: InspectorChainSummary[]): InspectorGroup[] {
  if (chains.length === 0) return [];

  const buckets = new Map<string, string[]>();
  for (const chain of chains) {
    const label = chain.branch_path != null ? String(chain.branch_path) : '(no branch)';
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(chain.chain_id);
  }

  const groups: InspectorGroup[] = [];
  let i = 0;
  for (const [label, chainIds] of buckets) {
    groups.push({
      id: `group-branch-${label}`,
      label,
      color: INSPECTOR_GROUP_COLORS[i % INSPECTOR_GROUP_COLORS.length],
      chain_ids: chainIds,
    });
    i++;
  }
  groups.sort((a, b) => b.chain_ids.length - a.chain_ids.length);
  return groups;
}

function evaluateRule(chain: InspectorChainSummary, rule: ExpressionRule): boolean {
  const rawValue = chain[rule.field];
  const strValue = rawValue != null ? String(rawValue) : '';
  const numValue = typeof rawValue === 'number' ? rawValue : parseFloat(strValue);
  const ruleNum = parseFloat(rule.value);

  switch (rule.operator) {
    case 'eq':
      return strValue === rule.value;
    case 'neq':
      return strValue !== rule.value;
    case 'contains':
      return strValue.toLowerCase().includes(rule.value.toLowerCase());
    case 'not_contains':
      return !strValue.toLowerCase().includes(rule.value.toLowerCase());
    case 'gt':
      return !isNaN(numValue) && !isNaN(ruleNum) && numValue > ruleNum;
    case 'lt':
      return !isNaN(numValue) && !isNaN(ruleNum) && numValue < ruleNum;
    case 'gte':
      return !isNaN(numValue) && !isNaN(ruleNum) && numValue >= ruleNum;
    case 'lte':
      return !isNaN(numValue) && !isNaN(ruleNum) && numValue <= ruleNum;
    default:
      return false;
  }
}

function evaluateRules(
  chain: InspectorChainSummary,
  rules: ExpressionRule[],
  combinator: ExpressionCombinator,
): boolean {
  if (rules.length === 0) return false;
  if (combinator === 'AND') {
    return rules.every(rule => evaluateRule(chain, rule));
  }
  return rules.some(rule => evaluateRule(chain, rule));
}

function computeGroupsByExpression(
  chains: InspectorChainSummary[],
  config: GroupByExpressionConfig | null,
): InspectorGroup[] {
  if (!config || config.groups.length === 0 || chains.length === 0) return [];

  const groups: InspectorGroup[] = [];
  for (let i = 0; i < config.groups.length; i++) {
    const exprGroup = config.groups[i];
    if (exprGroup.rules.length === 0) continue;
    const matchingIds = chains
      .filter(c => evaluateRules(c, exprGroup.rules, exprGroup.combinator))
      .map(c => c.chain_id);

    groups.push({
      id: `group-expr-${exprGroup.id}`,
      label: exprGroup.label || `Group ${i + 1}`,
      color: INSPECTOR_GROUP_COLORS[i % INSPECTOR_GROUP_COLORS.length],
      chain_ids: matchingIds,
    });
  }
  return groups;
}

function computeGroups(
  chains: InspectorChainSummary[],
  groupMode: GroupMode,
  groupBy: GroupByVariable | null,
  rangeConfig: GroupByRangeConfig | null,
  topKConfig: GroupByTopKConfig | null,
  expressionConfig: GroupByExpressionConfig | null,
): InspectorGroup[] {
  switch (groupMode) {
    case 'by_variable':
      return computeGroupsByVariable(chains, groupBy);
    case 'by_range':
      return computeGroupsByRange(chains, rangeConfig);
    case 'by_top_k':
      return computeGroupsByTopK(chains, topKConfig);
    case 'by_branch':
      return computeGroupsByBranch(chains);
    case 'by_expression':
      return computeGroupsByExpression(chains, expressionConfig);
    default:
      return [];
  }
}

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
  const [partition, setPartition] = useState(() => {
    return session?.getSession()?.partition ?? 'val';
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
      partition,
    });
  }, [filters, groupMode, groupBy, rangeConfig, topKConfig, expressionConfig, scoreColumn, partition, session]);

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

  const chains = data?.chains ?? [];
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;

  // Compute groups
  const groups = useMemo(
    () => computeGroups(chains as InspectorChainSummary[], groupMode, groupBy, rangeConfig, topKConfig, expressionConfig),
    [chains, groupMode, groupBy, rangeConfig, topKConfig, expressionConfig],
  );

  // Build chain→group lookup
  const chainGroupMap = useMemo(() => {
    const map = new Map<string, InspectorGroup>();
    for (const group of groups) {
      for (const chainId of group.chain_ids) {
        map.set(chainId, group);
      }
    }
    return map;
  }, [groups]);

  const getChainGroup = useCallback(
    (chainId: string) => chainGroupMap.get(chainId),
    [chainGroupMap],
  );

  const refresh = useCallback(() => { refetch(); }, [refetch]);

  const value = useMemo<InspectorDataContextValue>(() => ({
    chains: chains as InspectorChainSummary[],
    isLoading,
    error,
    filters,
    setFilters,
    availableMetrics: data?.available_metrics ?? [],
    availableModels: data?.available_models ?? [],
    availableDatasets: data?.available_datasets ?? [],
    availableRuns: data?.available_runs ?? [],
    availablePreprocessings: data?.available_preprocessings ?? [],
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
    partition,
    setPartition,
    getChainGroup,
    refresh,
    totalChains: data?.total ?? 0,
  }), [
    chains, isLoading, error, filters, data,
    groups, groupMode, groupBy, rangeConfig, topKConfig, expressionConfig,
    scoreColumn, partition, getChainGroup, refresh,
  ]);

  return (
    <InspectorDataContext.Provider value={value}>
      {children}
    </InspectorDataContext.Provider>
  );
}

// ============= Hook =============

export function useInspectorData(): InspectorDataContextValue {
  const context = useContext(InspectorDataContext);
  if (!context) {
    throw new Error('useInspectorData must be used within an InspectorDataProvider');
  }
  return context;
}
