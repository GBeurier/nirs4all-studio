import { describe, expect, it } from 'vitest';
import {
  buildShapComputeRequest,
  isShapBundleReference,
  resolveShapModelRef,
} from './shapAnalysisRequest';

describe('shapAnalysisRequest', () => {
  it('builds a workspace-chain SHAP compute request', () => {
    expect(buildShapComputeRequest({
      modelRef: 'chain-123',
      datasetName: 'corn',
      partition: 'test',
      explainerType: 'auto',
    })).toEqual({
      chain_id: 'chain-123',
      bundle_path: undefined,
      dataset_id: 'corn',
      partition: 'test',
      explainer_type: 'auto',
      n_samples: null,
      n_background: 100,
      bin_size: 20,
      bin_stride: 10,
      bin_aggregation: 'sum',
    });
  });

  it('builds a bundle-backed SHAP compute request', () => {
    expect(buildShapComputeRequest({
      modelRef: '/exports/model.n4a',
      datasetName: 'corn',
      partition: 'train',
      explainerType: 'kernel',
    })).toMatchObject({
      chain_id: undefined,
      bundle_path: '/exports/model.n4a',
      dataset_id: 'corn',
      partition: 'train',
      explainer_type: 'kernel',
    });
  });

  it('respects explicit chain and bundle model refs before legacy string heuristics', () => {
    expect(buildShapComputeRequest({
      modelRef: { modelSource: 'chain', chainId: '/workspace/chains/model.n4a' },
      datasetName: 'corn',
      partition: 'all',
      explainerType: 'linear',
    })).toMatchObject({
      chain_id: '/workspace/chains/model.n4a',
      bundle_path: undefined,
      dataset_id: 'corn',
      partition: 'all',
      explainer_type: 'linear',
    });

    expect(buildShapComputeRequest({
      modelRef: { modelSource: 'bundle', bundlePath: 'bundle-without-extension' },
      datasetName: 'corn',
      partition: 'test',
      explainerType: 'tree',
    })).toMatchObject({
      chain_id: undefined,
      bundle_path: 'bundle-without-extension',
      dataset_id: 'corn',
      partition: 'test',
      explainer_type: 'tree',
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
