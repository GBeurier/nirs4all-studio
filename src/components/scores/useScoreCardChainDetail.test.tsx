/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChainPartitionDetailResponse, PartitionPrediction } from '@/types/aggregated-predictions';
import type { ScoreCardRow } from '@/types/score-cards';

const apiMocks = vi.hoisted(() => ({
  getChainPartitionDetail: vi.fn(),
}));

vi.mock('@/api/aggregatedPredictions', () => ({
  getChainPartitionDetail: apiMocks.getChainPartitionDetail,
}));

import { useScoreCardChainDetail } from './useScoreCardChainDetail';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

async function waitFor(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}

async function renderHook<T>(hook: () => T, queryClient = createQueryClient()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    );
  });

  return {
    result,
    queryClient,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    },
  };
}

function row(overrides: Partial<ScoreCardRow> = {}): ScoreCardRow {
  return {
    id: 'row-1',
    chainId: 'chain-1',
    modelName: 'PLS',
    modelClass: 'PLSRegression',
    preprocessings: 'SNV',
    bestParams: { n_components: 4 },
    cardType: 'crossval',
    foldId: 'avg',
    metric: 'rmse',
    taskType: 'regression',
    testScores: {},
    valScores: {},
    trainScores: {},
    primaryTestScore: null,
    primaryValScore: null,
    primaryTrainScore: null,
    hasRefitArtifact: false,
    ...overrides,
  };
}

function prediction(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
  return {
    prediction_id: 'pred-test',
    pipeline_id: 'pipe-1',
    chain_id: 'chain-1',
    dataset_name: 'dataset-a',
    model_name: 'PLS',
    model_class: 'PLSRegression',
    fold_id: '0',
    partition: 'test',
    val_score: null,
    test_score: 0.25,
    train_score: null,
    scores: { rmse: 0.25 },
    best_params: null,
    metric: 'rmse',
    task_type: 'regression',
    n_samples: 10,
    n_features: 128,
    preprocessings: 'SNV',
    ...overrides,
  };
}

describe('useScoreCardChainDetail', () => {
  beforeEach(() => {
    apiMocks.getChainPartitionDetail.mockReset();
  });

  it('loads chain detail, builds fold children, enriches the row, and resolves prediction callbacks', async () => {
    const finalPrediction = prediction({ prediction_id: 'pred-final', fold_id: 'final', partition: 'test', test_score: 0.18 });
    const selectedPrediction = prediction({ prediction_id: 'pred-fold-test', fold_id: '0', partition: 'test', test_score: 0.25 });
    const response: ChainPartitionDetailResponse = {
      chain_id: 'chain-1',
      predictions: [
        finalPrediction,
        prediction({ prediction_id: 'pred-avg-val', fold_id: 'avg', partition: 'val', val_score: 0.21, scores: { rmse: 0.21 } }),
        prediction({ prediction_id: 'pred-avg-test', fold_id: 'avg', partition: 'test', test_score: 0.26, scores: { rmse: 0.26 } }),
        selectedPrediction,
        prediction({ prediction_id: 'pred-fold-train', fold_id: '0', partition: 'train', train_score: 0.15, scores: { rmse: 0.15 } }),
      ],
      total: 5,
      partition: null,
      fold_id: null,
    };
    apiMocks.getChainPartitionDetail.mockResolvedValue(response);
    const onViewPrediction = vi.fn();
    const mounted = await renderHook(() => useScoreCardChainDetail({
      row: row(),
      onViewPrediction,
      includeTrainChildren: true,
      enrichCrossval: true,
    }));

    await waitFor(() => {
      expect(apiMocks.getChainPartitionDetail).toHaveBeenCalledWith('chain-1');
    });
    await waitFor(() => {
      expect(mounted.result.current!.trainChildren).toHaveLength(1);
    });

    expect(mounted.result.current!.displayRow).toMatchObject({
      primaryValScore: 0.21,
      primaryTestScore: 0.26,
    });
    expect(mounted.result.current!.trainChildren[0]).toMatchObject({
      foldId: '0',
      primaryTestScore: 0.25,
      primaryTrainScore: 0.15,
    });

    await act(async () => {
      mounted.result.current!.handleViewPrediction('pred-fold-test');
    });
    expect(onViewPrediction).toHaveBeenCalledWith('pred-fold-test', selectedPrediction);

    await act(async () => {
      mounted.result.current!.handleViewChainChart();
    });
    expect(onViewPrediction).toHaveBeenLastCalledWith('pred-final', finalPrediction);

    await mounted.unmount();
  });
});
