import { describe, expect, it } from 'vitest';

import {
  buildRankingChainColorMap,
  buildRankingsScoreColumnAvailability,
  getNextRankingSort,
  getRankingRowSelectionDecision,
  getRankingRowVisualState,
  RANKINGS_TABLE_FALLBACK_COLOR,
  resolveRankingsScoreColumn,
  sortRankings,
} from '@/lib/inspector/rankingsTableData';
import type {
  InspectorMetricObservationReadModel,
  InspectorScoreRefAvailability,
} from '@/lib/inspector/chartInputs';
import type { InspectorGroup, RankingRow } from '@/types/inspector';

function row(overrides: Partial<RankingRow> = {}): RankingRow {
  return {
    rank: 2,
    chain_id: 'chain-a',
    model_class: 'PLS',
    model_name: null,
    preprocessings: 'SNV',
    cv_val_score: 0.5,
    cv_test_score: 0.6,
    cv_train_score: 0.7,
    final_test_score: 0.55,
    final_train_score: 0.75,
    cv_fold_count: 3,
    dataset_name: 'dataset-b',
    best_params: null,
    ...overrides,
  };
}

function group(overrides: Partial<InspectorGroup> = {}): InspectorGroup {
  return {
    id: 'group-a',
    label: 'Group A',
    color: '#111111',
    chain_ids: ['chain-a'],
    ...overrides,
  };
}

function metricObservationReadModel(
  scoreRefs: Partial<InspectorScoreRefAvailability>[],
): InspectorMetricObservationReadModel {
  return {
    hasObservations: scoreRefs.some((scoreRef) => (scoreRef.observationCount ?? 1) > 0),
    metricKeys: ['rmse'],
    scoreRefs: scoreRefs.map((scoreRef, index) => ({
      key: `score-ref-${index}`,
      metric: 'rmse',
      protocol: 'cross_validation',
      partition: 'validation',
      aggregation: 'fold_mean',
      legacyScoreColumn: 'cv_val_score',
      observationCount: 1,
      ...scoreRef,
    })),
    unmappedScoreRefs: [],
  };
}

describe('inspector rankings table data helpers', () => {
  it('sorts rankings by configured numeric and string fields with nulls last', () => {
    const rows = [
      row({ chain_id: 'chain-a', rank: 2, model_class: 'ZModel', cv_val_score: 0.5 }),
      row({ chain_id: 'chain-b', rank: 1, model_class: 'AModel', cv_val_score: null }),
      row({ chain_id: 'chain-c', rank: 3, model_class: 'MModel', cv_val_score: 0.9 }),
    ];

    expect(sortRankings(rows, null).map((entry) => entry.chain_id)).toEqual(['chain-a', 'chain-b', 'chain-c']);
    expect(sortRankings(rows, { field: 'cv_val_score', asc: false }).map((entry) => entry.chain_id)).toEqual(['chain-c', 'chain-a', 'chain-b']);
    expect(sortRankings(rows, { field: 'cv_val_score', asc: true }).map((entry) => entry.chain_id)).toEqual(['chain-a', 'chain-c', 'chain-b']);
    expect(sortRankings(rows, { field: 'model_class', asc: true }).map((entry) => entry.chain_id)).toEqual(['chain-b', 'chain-c', 'chain-a']);
    expect(sortRankings(rows, { field: 'model_class', asc: false }).map((entry) => entry.chain_id)).toEqual(['chain-a', 'chain-c', 'chain-b']);
    expect(sortRankings(null, null)).toEqual([]);
  });

  it('builds next sort state', () => {
    expect(getNextRankingSort(null, 'rank')).toEqual({ field: 'rank', asc: true });
    expect(getNextRankingSort(null, 'cv_val_score')).toEqual({ field: 'cv_val_score', asc: false });
    expect(getNextRankingSort({ field: 'rank', asc: true }, 'rank')).toEqual({ field: 'rank', asc: false });
  });

  it('builds row visual state and click selection decisions', () => {
    const colorMap = buildRankingChainColorMap([
      group(),
      group({ id: 'group-b', label: 'Group B', color: '#222222', chain_ids: ['chain-b'] }),
    ]);

    expect(colorMap.get('chain-a')).toBe('#111111');
    expect(getRankingRowVisualState({
      row: row({ chain_id: 'chain-a' }),
      selectedChains: new Set(['chain-a']),
      hasSelection: true,
      hoveredChain: null,
      chainColorMap: colorMap,
    })).toEqual({
      chainId: 'chain-a',
      isSelected: true,
      isHovered: false,
      dimmed: false,
      color: '#111111',
    });
    expect(getRankingRowVisualState({
      row: row({ chain_id: 'chain-c' }),
      selectedChains: new Set(['chain-a']),
      hasSelection: true,
      hoveredChain: 'chain-c',
      chainColorMap: colorMap,
    })).toEqual({
      chainId: 'chain-c',
      isSelected: false,
      isHovered: true,
      dimmed: true,
      color: RANKINGS_TABLE_FALLBACK_COLOR,
    });

    expect(getRankingRowSelectionDecision({
      chainId: 'chain-a',
      modifiers: { shiftKey: true, ctrlKey: false, metaKey: false },
      selectedChains: new Set(),
    })).toEqual({ chainIds: ['chain-a'], mode: 'add' });
    expect(getRankingRowSelectionDecision({
      chainId: 'chain-a',
      modifiers: { shiftKey: false, ctrlKey: true, metaKey: false },
      selectedChains: new Set(),
    })).toEqual({ chainIds: ['chain-a'], mode: 'toggle' });
    expect(getRankingRowSelectionDecision({
      chainId: 'chain-a',
      modifiers: { shiftKey: false, ctrlKey: false, metaKey: false },
      selectedChains: new Set(['chain-a']),
    })).toEqual({ chainIds: [], mode: 'replace' });
    expect(getRankingRowSelectionDecision({
      chainId: 'chain-b',
      modifiers: { shiftKey: false, ctrlKey: false, metaKey: false },
      selectedChains: new Set(['chain-a']),
    })).toEqual({ chainIds: ['chain-b'], mode: 'replace' });
  });

  it('exposes score-column metric-observation availability for rankings', () => {
    const model = metricObservationReadModel([
      { legacyScoreColumn: 'cv_val_score', observationCount: 2 },
      { legacyScoreColumn: 'cv_val_score', metric: 'mae', observationCount: 3 },
      { legacyScoreColumn: 'final_test_score', observationCount: 1 },
      { legacyScoreColumn: 'cv_test_score', observationCount: 0 },
      { legacyScoreColumn: null, observationCount: 5 },
    ]);

    expect(buildRankingsScoreColumnAvailability(model)).toEqual([
      { scoreColumn: 'cv_val_score', observationCount: 5, hasMetricObservations: true },
      { scoreColumn: 'cv_test_score', observationCount: 0, hasMetricObservations: false },
      { scoreColumn: 'cv_train_score', observationCount: 0, hasMetricObservations: false },
      { scoreColumn: 'final_test_score', observationCount: 1, hasMetricObservations: true },
      { scoreColumn: 'final_train_score', observationCount: 0, hasMetricObservations: false },
    ]);
  });

  it('keeps the requested rankings score column when availability is legacy or observed', () => {
    const legacyModel = metricObservationReadModel([]);
    expect(resolveRankingsScoreColumn('cv_test_score', legacyModel)).toBe('cv_test_score');

    const model = metricObservationReadModel([
      { legacyScoreColumn: 'cv_val_score', observationCount: 2 },
      { legacyScoreColumn: 'final_test_score', observationCount: 1 },
    ]);
    expect(resolveRankingsScoreColumn('final_test_score', model)).toBe('final_test_score');
  });

  it('falls back to the most-observed rankings score column when the requested one is unavailable', () => {
    const model = metricObservationReadModel([
      { legacyScoreColumn: 'cv_val_score', observationCount: 2 },
      { legacyScoreColumn: 'final_test_score', observationCount: 1 },
    ]);

    expect(resolveRankingsScoreColumn('cv_test_score', model)).toBe('cv_val_score');
  });
});
