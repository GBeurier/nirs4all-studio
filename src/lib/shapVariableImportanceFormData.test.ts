import { describe, expect, it } from 'vitest';

import {
  buildShapPredictHref,
  isShapPlsModel,
  normalizeShapExplainerType,
  normalizeShapPartition,
  SHAP_EXPLAINER_OPTIONS,
  SHAP_PARTITION_OPTIONS,
  DEFAULT_SHAP_OPTIONS,
  isNonAdditiveExplainer,
  normalizeShapOptions,
  normalizeShapSubsets,
  DEFAULT_SHAP_SUBSETS,
  shapExplainerOptions,
  usesShapBaseline,
  usesShapPermutations,
} from './shapVariableImportanceFormData';

describe('shapVariableImportanceFormData', () => {
  it('identifies PLS models for the tree-explainer compatibility hint', () => {
    expect(isShapPlsModel('sklearn.cross_decomposition.PLSRegression')).toBe(true);
    expect(isShapPlsModel('n4m.PLSRegression')).toBe(true);
    expect(isShapPlsModel('PLS')).toBe(true);
    expect(isShapPlsModel('RandomForestRegressor')).toBe(false);
    expect(isShapPlsModel(null)).toBe(false);
  });
  it('exposes the existing partition and explainer option order', () => {
    expect(SHAP_PARTITION_OPTIONS).toEqual([
      { value: 'test', labelKey: 'results.variableImportance.partitionOptions.test' },
      { value: 'train', labelKey: 'results.variableImportance.partitionOptions.train' },
      { value: 'all', labelKey: 'results.variableImportance.partitionOptions.all' },
    ]);
    expect(SHAP_EXPLAINER_OPTIONS.map((option) => option.value)).toEqual([
      'auto',
      'tree',
      'linear',
      'kernel',
    ]);
  });

  it('offers the native engine its additional explainers', () => {
    expect(shapExplainerOptions('python').map((option) => option.value)).toEqual(['auto', 'tree', 'linear', 'kernel']);
    expect(shapExplainerOptions('native').map((option) => option.value)).toEqual(
      ['auto', 'permutation', 'exact', 'kernel', 'lime', 'occlusion', 'linear', 'tree'],
    );
    expect(isNonAdditiveExplainer('lime')).toBe(true);
    expect(isNonAdditiveExplainer('permutation')).toBe(false);
  });

  it('normalizes restored options to engine-compatible, bounded values', () => {
    expect(normalizeShapOptions(undefined)).toEqual(DEFAULT_SHAP_OPTIONS);
    expect(normalizeShapOptions({ engine: 'python', explainerType: 'lime' }).explainerType).toBe('auto');
    expect(normalizeShapOptions({ engine: 'native', explainerType: 'lime' }).explainerType).toBe('lime');
    expect(normalizeShapOptions({ nSamples: null, nBackground: 5000, groupWidth: 0, seed: -1 })).toMatchObject({
      nSamples: null, nBackground: 20, groupWidth: null, seed: 0,
    });
    const native = normalizeShapOptions({ engine: 'native', explainerType: 'permutation' });
    expect(usesShapBaseline(native) && usesShapPermutations(native)).toBe(true);
    expect(usesShapBaseline({ ...native, explainerType: 'tree' })).toBe(false);
    expect(usesShapPermutations({ ...native, explainerType: 'kernel' })).toBe(false);
    expect(usesShapBaseline(DEFAULT_SHAP_OPTIONS)).toBe(false);
  });

  it('restores subsets disabled by default and drops malformed filters', () => {
    expect(normalizeShapSubsets(undefined)).toEqual(DEFAULT_SHAP_SUBSETS);
    expect(normalizeShapSubsets({
      enabled: true,
      background: { partition: 'train', filters: [{ column: 'site', values: ['A', { nested: 1 }, null] }, { values: ['x'] }] },
      explained: { partition: 'validation' },
    })).toEqual({
      enabled: true,
      background: { partition: 'train', filters: [{ column: 'site', values: ['A', null] }] },
      explained: { partition: 'test', filters: [] },
    });
  });

  it('normalizes unknown select values to stable defaults', () => {
    expect(normalizeShapPartition('train')).toBe('train');
    expect(normalizeShapPartition('validation')).toBe('test');
    expect(normalizeShapExplainerType('kernel')).toBe('kernel');
    expect(normalizeShapExplainerType('future')).toBe('auto');
  });

  it('builds the current predict handoff URL with encoded chain ids', () => {
    expect(buildShapPredictHref('chain/a b')).toBe('/predict?model_id=chain%2Fa%20b&source=chain');
  });
});
