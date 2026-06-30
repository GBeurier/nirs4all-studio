import { describe, expect, it } from 'vitest';

import {
  buildInspectorSourceFilterBarModel,
  getInspectorChainCountLabel,
  getOptionalInspectorFilterArray,
  getOptionalInspectorFilterValue,
  hasInspectorSourceFilters,
  INSPECTOR_ALL_FILTER_VALUE,
  patchInspectorSourceArrayFilter,
  patchInspectorSourceFilters,
  patchInspectorSourceValueFilter,
  toggleInspectorFacetValue,
} from '@/lib/inspector/sourceFilterBar';

describe('inspector source filter bar helpers', () => {
  it('patches filters without dropping unrelated active filters', () => {
    expect(patchInspectorSourceFilters(
      { run_ids: ['run-1'], metric: 'r2' },
      { dataset_names: ['dataset-a'] },
    )).toEqual({
      run_ids: ['run-1'],
      metric: 'r2',
      dataset_names: ['dataset-a'],
    });
  });

  it('normalizes empty facet arrays and all-select values to undefined', () => {
    expect(getOptionalInspectorFilterArray([])).toBeUndefined();
    expect(getOptionalInspectorFilterArray(['a'])).toEqual(['a']);
    expect(getOptionalInspectorFilterValue(INSPECTOR_ALL_FILTER_VALUE)).toBeUndefined();
    expect(getOptionalInspectorFilterValue('classification')).toBe('classification');
  });

  it('patches source filter fields through typed filter keys', () => {
    expect(patchInspectorSourceArrayFilter(
      { run_ids: ['run-1'], metric: 'r2' },
      'dataset_names',
      ['dataset-a'],
    )).toEqual({
      run_ids: ['run-1'],
      metric: 'r2',
      dataset_names: ['dataset-a'],
    });
    expect(patchInspectorSourceArrayFilter(
      { dataset_names: ['dataset-a'] },
      'dataset_names',
      [],
    )).toEqual({ dataset_names: undefined });
    expect(patchInspectorSourceValueFilter(
      { task_type: 'regression' },
      'task_type',
      INSPECTOR_ALL_FILTER_VALUE,
    )).toEqual({ task_type: undefined });
    expect(patchInspectorSourceValueFilter(
      {},
      'metric',
      'r2',
    )).toEqual({ metric: 'r2' });
  });

  it('detects active source filters across every supported field', () => {
    expect(hasInspectorSourceFilters({})).toBe(false);
    expect(hasInspectorSourceFilters({ run_ids: ['run-1'] })).toBe(true);
    expect(hasInspectorSourceFilters({ dataset_names: ['dataset-a'] })).toBe(true);
    expect(hasInspectorSourceFilters({ model_classes: ['PLS'] })).toBe(true);
    expect(hasInspectorSourceFilters({ preprocessings: ['SNV'] })).toBe(true);
    expect(hasInspectorSourceFilters({ task_type: 'regression' })).toBe(true);
    expect(hasInspectorSourceFilters({ metric: 'r2' })).toBe(true);
  });

  it('toggles facet values and formats chain-count status', () => {
    expect(toggleInspectorFacetValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleInspectorFacetValue(['a', 'b'], 'a')).toEqual(['b']);
    expect(getInspectorChainCountLabel(true, 12)).toBe('...');
    expect(getInspectorChainCountLabel(false, 12)).toBe('12 chains');
  });

  it('builds the source filter bar read model from available values and active filters', () => {
    const model = buildInspectorSourceFilterBarModel({
      filters: {
        run_ids: ['run-1'],
        task_type: 'classification',
        metric: 'accuracy',
      },
      availableRuns: ['run-1', 'run-2'],
      availableDatasets: ['dataset-a'],
      availableModels: ['PLS'],
      availablePreprocessings: ['SNV'],
      availableMetrics: ['accuracy', 'f1'],
      totalChains: 7,
      isLoading: false,
    });

    expect(model.hasFilters).toBe(true);
    expect(model.chainCountLabel).toBe('7 chains');
    expect(model.facets.map(facet => facet.id)).toEqual([
      'run_ids',
      'dataset_names',
      'model_classes',
      'preprocessings',
    ]);
    expect(model.facets[0]).toMatchObject({
      labelKey: 'inspector.filter.runs',
      defaultLabel: 'Runs',
      values: ['run-1', 'run-2'],
      selected: ['run-1'],
    });
    expect(model.taskType.value).toBe('classification');
    expect(model.taskType.options).toContainEqual({ value: 'regression', label: 'Regression' });
    expect(model.metric?.value).toBe('accuracy');
    expect(model.metric?.options).toEqual([
      { value: INSPECTOR_ALL_FILTER_VALUE, label: 'All Metrics' },
      { value: 'accuracy', label: 'accuracy' },
      { value: 'f1', label: 'f1' },
    ]);
  });
});
