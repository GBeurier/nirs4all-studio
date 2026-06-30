import { describe, expect, it } from 'vitest';

import {
  buildShapPredictHref,
  normalizeShapExplainerType,
  normalizeShapPartition,
  SHAP_EXPLAINER_OPTIONS,
  SHAP_PARTITION_OPTIONS,
} from './shapVariableImportanceFormData';

describe('shapVariableImportanceFormData', () => {
  it('exposes the existing partition and explainer option order', () => {
    expect(SHAP_PARTITION_OPTIONS).toEqual([
      { value: 'test', label: 'Test' },
      { value: 'train', label: 'Train' },
      { value: 'all', label: 'All' },
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
