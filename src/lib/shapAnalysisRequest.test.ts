import { describe, expect, it } from 'vitest';
import {
  buildShapComputeRequest,
  isShapBundleReference,
  resolveShapModelRef,
} from './shapAnalysisRequest';
import { DEFAULT_SHAP_OPTIONS } from './shapVariableImportanceFormData';

describe('shapAnalysisRequest', () => {
  it('builds a workspace-chain SHAP compute request', () => {
    expect(buildShapComputeRequest({
      modelRef: 'chain-123',
      datasetId: 'dataset-corn',
      partition: 'test',
      options: { ...DEFAULT_SHAP_OPTIONS, explainerType: 'auto' },
    })).toEqual({
      chain_id: 'chain-123',
      bundle_path: undefined,
      dataset_id: 'dataset-corn',
      partition: 'test',
      explainer_type: 'auto',
      n_samples: 50,
      n_background: 20,
      bin_size: 20,
      bin_stride: 10,
      bin_aggregation: 'sum',
    });
  });

  it('builds a bundle-backed SHAP compute request', () => {
    expect(buildShapComputeRequest({
      modelRef: '/exports/model.n4a',
      datasetId: 'dataset-corn',
      partition: 'train',
      options: { ...DEFAULT_SHAP_OPTIONS, explainerType: 'kernel' },
    })).toMatchObject({
      chain_id: undefined,
      bundle_path: '/exports/model.n4a',
      dataset_id: 'dataset-corn',
      partition: 'train',
      explainer_type: 'kernel',
    });
  });

  it('respects explicit chain and bundle model refs before legacy string heuristics', () => {
    expect(buildShapComputeRequest({
      modelRef: { modelSource: 'chain', chainId: '/workspace/chains/model.n4a' },
      datasetId: 'dataset-corn',
      partition: 'all',
      options: { ...DEFAULT_SHAP_OPTIONS, explainerType: 'linear' },
    })).toMatchObject({
      chain_id: '/workspace/chains/model.n4a',
      bundle_path: undefined,
      dataset_id: 'dataset-corn',
      partition: 'all',
      explainer_type: 'linear',
    });

    expect(buildShapComputeRequest({
      modelRef: { modelSource: 'bundle', bundlePath: 'bundle-without-extension' },
      datasetId: 'dataset-corn',
      partition: 'test',
      options: { ...DEFAULT_SHAP_OPTIONS, explainerType: 'tree' },
    })).toMatchObject({
      chain_id: undefined,
      bundle_path: 'bundle-without-extension',
      dataset_id: 'dataset-corn',
      partition: 'test',
      explainer_type: 'tree',
    });
  });

  it('sends the chosen sample and background sizes and native engine settings', () => {
    const base = { modelRef: 'chain-1', datasetId: 'corn', partition: 'test' as const };
    expect(buildShapComputeRequest({ ...base, options: { ...DEFAULT_SHAP_OPTIONS, nSamples: null, nBackground: 200 } }))
      .toMatchObject({ n_samples: null, n_background: 200 });
    const python = buildShapComputeRequest({ ...base, options: { ...DEFAULT_SHAP_OPTIONS, groupWidth: 5, nPermutations: 4 } });
    for (const key of ['explainer_backend', 'baseline', 'group_width', 'n_permutations', 'seed']) expect(python).not.toHaveProperty(key);
    expect(buildShapComputeRequest({ ...base, options: {
      ...DEFAULT_SHAP_OPTIONS, engine: 'native', explainerType: 'permutation', baseline: 'mean', groupWidth: 10, nPermutations: 8, seed: 3,
    } })).toMatchObject({ explainer_backend: 'methods', explainer_type: 'permutation', baseline: 'mean', group_width: 10, n_permutations: 8, seed: 3 });
    // Path-dependent TreeSHAP takes no baseline; permutations apply to permutation SHAP only.
    const tree = buildShapComputeRequest({ ...base, options: { ...DEFAULT_SHAP_OPTIONS, engine: 'native', explainerType: 'tree', nPermutations: 8 } });
    expect(tree).toMatchObject({ explainer_backend: 'methods', seed: 0 });
    expect(tree).not.toHaveProperty('baseline');
    expect(tree).not.toHaveProperty('n_permutations');
    expect(tree).not.toHaveProperty('group_width');
    // The engine's default background-rows baseline is left unset (native auto may then pick TreeSHAP).
    expect(buildShapComputeRequest({ ...base, options: { ...DEFAULT_SHAP_OPTIONS, engine: 'native' } })).not.toHaveProperty('baseline');
  });

  it('replaces the partition by metadata subsets only when they are enabled', () => {
    const base = { modelRef: 'chain-1', datasetId: 'corn', partition: 'test' as const };
    const subsets = {
      enabled: false,
      background: { partition: 'all' as const, filters: [{ column: 'site', values: ['A', 'B'] }] },
      explained: { partition: 'test' as const, filters: [{ column: 'variety', values: [] }, { column: '', values: ['x'] }] },
    };
    expect(buildShapComputeRequest({ ...base, options: { ...DEFAULT_SHAP_OPTIONS, subsets } })).not.toHaveProperty('subsets');
    expect(buildShapComputeRequest({ ...base, options: { ...DEFAULT_SHAP_OPTIONS, subsets: { ...subsets, enabled: true } } }).subsets).toEqual({
      background: { partition: 'all', filters: [{ column: 'site', values: ['A', 'B'] }] },
      // Filters without a column or a selected value do not narrow the subset.
      explained: { partition: 'test', filters: [] },
    });
  });

  it('resolves result artifact refs through explicit bundle and chain fields', () => {
    expect(resolveShapModelRef({
      id: 'artifact-ref',
      kind: 'model',
      role: 'exported-model',
      label: 'Exported model',
      source: 'result-repository',
      scope: 'chain',
      status: 'available',
      bundlePath: 'opaque-bundle-id',
    })).toEqual({ modelSource: 'bundle', bundlePath: 'opaque-bundle-id' });

    expect(resolveShapModelRef({
      id: 'artifact-ref',
      kind: 'model',
      role: 'refit-model',
      label: 'Refit model',
      source: 'legacy-fold-artifacts',
      scope: 'fold',
      status: 'available',
      chainId: 'chain/with/slash.n4a',
      artifactId: '/legacy/artifact.n4a',
    })).toEqual({ modelSource: 'chain', chainId: 'chain/with/slash.n4a' });
  });

  it('treats n4a names and path-like references as bundle references', () => {
    expect(isShapBundleReference('model.n4a')).toBe(true);
    expect(isShapBundleReference('/exports/model')).toBe(true);
    expect(isShapBundleReference('C:\\exports\\model')).toBe(true);
    expect(isShapBundleReference('chain-123')).toBe(false);
  });
});
