import {
  buildInspectorScoreColumnAvailability,
  type InspectorMetricObservationReadModel,
  type InspectorScoreColumnAvailability,
} from '@/lib/inspector/chartInputs';
import type { InspectorGroup, RankingRow, ScoreColumn } from '@/types/inspector';

export const RANKINGS_TABLE_FALLBACK_COLOR = '#64748b';

export const RANKINGS_SCORE_COLUMN_ORDER: readonly ScoreColumn[] = [
  'cv_val_score',
  'cv_test_score',
  'cv_train_score',
  'final_test_score',
  'final_train_score',
] as const;

export type RankingSortField =
  | 'rank'
  | 'model_class'
  | 'preprocessings'
  | 'cv_val_score'
  | 'cv_test_score'
  | 'final_test_score'
  | 'cv_fold_count'
  | 'dataset_name';

export interface RankingSortState {
  field: RankingSortField;
  asc: boolean;
}

export interface RankingRowVisualState {
  chainId: string;
  isSelected: boolean;
  isHovered: boolean;
  dimmed: boolean;
  color: string;
}

export interface RankingSelectionModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface RankingSelectionDecision {
  chainIds: string[];
  mode: 'add' | 'toggle' | 'replace';
}

export type RankingsScoreColumnAvailability = InspectorScoreColumnAvailability;

const ASCENDING_DEFAULT_FIELDS = new Set<RankingSortField>([
  'model_class',
  'preprocessings',
  'dataset_name',
  'rank',
]);

export function buildRankingsScoreColumnAvailability(
  readModel: InspectorMetricObservationReadModel,
  scoreColumns: readonly ScoreColumn[] = RANKINGS_SCORE_COLUMN_ORDER,
): RankingsScoreColumnAvailability[] {
  return buildInspectorScoreColumnAvailability(readModel, scoreColumns);
}

export function resolveRankingsScoreColumn(
  requestedScoreColumn: ScoreColumn,
  readModel: InspectorMetricObservationReadModel,
  scoreColumns: readonly ScoreColumn[] = RANKINGS_SCORE_COLUMN_ORDER,
): ScoreColumn {
  const availability = buildRankingsScoreColumnAvailability(readModel, scoreColumns);
  const observed = availability.filter((entry) => entry.hasMetricObservations);
  if (observed.length === 0) return requestedScoreColumn;
  if (observed.some((entry) => entry.scoreColumn === requestedScoreColumn)) {
    return requestedScoreColumn;
  }

  let best = observed[0];
  for (const entry of observed) {
    if (entry.observationCount > best.observationCount) {
      best = entry;
    }
  }
  return best.scoreColumn;
}

export function buildRankingChainColorMap(
  groups: readonly InspectorGroup[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const chainId of group.chain_ids) {
      map.set(chainId, group.color);
    }
  }
  return map;
}

export function sortRankings(
  rankings: readonly RankingRow[] | null | undefined,
  sort: RankingSortState | null,
): RankingRow[] {
  if (!rankings) return [];
  if (!sort) return [...rankings];

  return [...rankings].sort((left, right) => {
    const leftValue = left[sort.field];
    const rightValue = right[sort.field];
    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return sort.asc ? leftValue - rightValue : rightValue - leftValue;
    }
    return sort.asc
      ? String(leftValue).localeCompare(String(rightValue))
      : String(rightValue).localeCompare(String(leftValue));
  });
}

export function getNextRankingSort(
  previous: RankingSortState | null,
  field: RankingSortField,
): RankingSortState {
  if (previous?.field === field) return { field, asc: !previous.asc };
  return { field, asc: ASCENDING_DEFAULT_FIELDS.has(field) };
}

export function getRankingRowVisualState({
  row,
  selectedChains,
  hasSelection,
  hoveredChain,
  chainColorMap,
}: {
  row: RankingRow;
  selectedChains: ReadonlySet<string>;
  hasSelection: boolean;
  hoveredChain: string | null;
  chainColorMap: ReadonlyMap<string, string>;
}): RankingRowVisualState {
  const chainId = row.chain_id;
  const isSelected = hasSelection && selectedChains.has(chainId);
  const isHovered = hoveredChain === chainId;
  return {
    chainId,
    isSelected,
    isHovered,
    dimmed: hasSelection && !isSelected,
    color: chainColorMap.get(chainId) ?? RANKINGS_TABLE_FALLBACK_COLOR,
  };
}

export function getRankingRowSelectionDecision({
  chainId,
  modifiers,
  selectedChains,
}: {
  chainId: string;
  modifiers: RankingSelectionModifiers;
  selectedChains: ReadonlySet<string>;
}): RankingSelectionDecision {
  if (modifiers.shiftKey) {
    return { chainIds: [chainId], mode: 'add' };
  }
  if (modifiers.ctrlKey || modifiers.metaKey) {
    return { chainIds: [chainId], mode: 'toggle' };
  }
  if (selectedChains.size === 1 && selectedChains.has(chainId)) {
    return { chainIds: [], mode: 'replace' };
  }
  return { chainIds: [chainId], mode: 'replace' };
}
