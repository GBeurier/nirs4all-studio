/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { useDatasetResultCardViewState } from './useDatasetResultCardViewState';
import type { ViewerHeader, ViewerPartitionTarget } from '@/components/predictions/viewer/types';
import type { PartitionPrediction } from '@/types/aggregated-predictions';
import type { TopChainResult } from '@/types/enriched-runs';
import type { ScoreCardRow } from '@/types/score-cards';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderHook<T>(hook: () => T) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(<TestComponent />);
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const dataset = {
  dataset_name: 'dataset-a',
  metric: 'rmse',
  task_type: 'regression',
};

const chain: TopChainResult = {
  chain_id: 'chain-1',
  model_name: 'PLS',
  model_class: 'PLSRegression',
  preprocessings: 'SNV',
  avg_val_score: 0.2,
  avg_test_score: 0.25,
  avg_train_score: 0.15,
  fold_count: 3,
  scores: { val: {}, test: {} },
  final_test_score: 0.19,
  final_train_score: 0.1,
  final_scores: {},
  best_params: null,
};

const focusRow: ScoreCardRow = {
  id: 'row-1',
  chainId: 'chain-1',
  modelName: 'PLS',
  modelClass: 'PLSRegression',
  preprocessings: 'SNV',
  bestParams: null,
  cardType: 'crossval',
  foldId: 'avg',
  metric: 'rmse',
  taskType: 'regression',
  testScores: {},
  valScores: {},
  trainScores: {},
  primaryTestScore: null,
  primaryValScore: 0.2,
  primaryTrainScore: null,
  hasRefitArtifact: false,
};

const prediction: PartitionPrediction = {
  prediction_id: 'pred-1',
  pipeline_id: 'pipe-1',
  chain_id: 'chain-1',
  dataset_name: 'dataset-a',
  model_name: 'PLS',
  model_class: 'PLSRegression',
  fold_id: 'fold-0',
  partition: 'test',
  val_score: 0.2,
  test_score: 0.25,
  train_score: 0.15,
  metric: 'rmse',
  task_type: 'regression',
  n_samples: 12,
  n_features: 128,
  preprocessings: 'SNV',
};

describe('useDatasetResultCardViewState', () => {
  it('opens detail, detail viewer, and quick prediction viewer state', async () => {
    const mounted = await renderHook(() => useDatasetResultCardViewState(dataset));

    await act(async () => {
      mounted.result.current!.openDetail(chain, focusRow);
    });
    expect(mounted.result.current!.detailOpen).toBe(true);
    expect(mounted.result.current!.detailChainId).toBe('chain-1');
    expect(mounted.result.current!.detailMetaHint).toMatchObject({
      datasetName: 'dataset-a',
      metric: 'rmse',
      modelName: 'PLS',
    });
    expect(mounted.result.current!.detailFocus).toEqual({
      cardType: 'crossval',
      foldId: 'avg',
    });

    const partitions: ViewerPartitionTarget[] = [{
      predictionId: 'pred-1',
      partition: 'test',
      label: 'Test',
      source: 'aggregated',
    }];
    const header: ViewerHeader = {
      datasetName: 'dataset-a',
      modelName: 'PLS',
    };

    await act(async () => {
      mounted.result.current!.openDetailViewer(partitions, header, 'scatter');
    });
    expect(mounted.result.current!.detailViewerOpen).toBe(true);
    expect(mounted.result.current!.detailViewerPartitions).toBe(partitions);
    expect(mounted.result.current!.detailViewerHeader).toBe(header);
    expect(mounted.result.current!.detailViewerKind).toBe('scatter');

    await act(async () => {
      mounted.result.current!.openQuickViewPrediction('missing');
    });
    expect(mounted.result.current!.quickViewOpen).toBe(false);

    await act(async () => {
      mounted.result.current!.openQuickViewPrediction('pred-1', prediction);
    });
    expect(mounted.result.current!.quickViewOpen).toBe(true);
    expect(mounted.result.current!.quickViewPred).toBe(prediction);

    await act(async () => {
      mounted.result.current!.setDetailOpen(false);
      mounted.result.current!.setDetailViewerOpen(false);
      mounted.result.current!.setQuickViewOpen(false);
    });
    expect(mounted.result.current!.detailOpen).toBe(false);
    expect(mounted.result.current!.detailViewerOpen).toBe(false);
    expect(mounted.result.current!.quickViewOpen).toBe(false);

    await mounted.unmount();
  });
});
