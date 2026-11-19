import { describe, expect, it } from 'vitest';

import {
  buildShapPredictHref,
  isShapPlsModel,
  normalizeShapExplainerType,
  normalizeShapPartition,
  SHAP_EXPLAINER_OPTIONS,
  SHAP_PARTITION_OPTIONS,
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
