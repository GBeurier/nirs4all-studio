/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChainPartitionDetailResponse, PartitionPrediction } from '@/types/aggregated-predictions';
import type { AllChainEntry, EnrichedDatasetRun, TopChainResult } from '@/types/enriched-runs';

const apiMocks = vi.hoisted(() => ({
  getAllChainsForDataset: vi.fn(),
  getAllChainsForResultsDataset: vi.fn(),
  getChainPartitionDetail: vi.fn(),
}));

vi.mock('@/api/enrichedRuns', () => ({
  getAllChainsForDataset: apiMocks.getAllChainsForDataset,
  getAllChainsForResultsDataset: apiMocks.getAllChainsForResultsDataset,
}));

vi.mock('@/api/aggregatedPredictions', () => ({
  getChainPartitionDetail: apiMocks.getChainPartitionDetail,
}));

import { useDatasetResultCardQueries } from './useDatasetResultCardQueries';

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

function topChain(overrides: Partial<TopChainResult> = {}): TopChainResult {
  return {
    chain_id: 'chain-fallback',
    run_id: 'run-1',
    pipeline_id: 'pipe-1',
    pipeline_name: 'Pipeline',
    model_name: 'PLS',
    model_class: 'PLSRegression',
    preprocessings: 'SNV',
    avg_val_score: 0.24,
    avg_test_score: 0.28,
    avg_train_score: 0.18,
    fold_count: 3,
    scores: {
      val: { rmse: 0.24 },
      test: { rmse: 0.28 },
    },
    cv_source_chain_id: null,
    final_test_score: null,
    final_train_score: null,
    final_scores: {},
    best_params: null,
    variant_params: null,
    ...overrides,
  };
}

function dataset(overrides: Partial<EnrichedDatasetRun> = {}): EnrichedDatasetRun {
  return {
    dataset_name: 'dataset-a',
    best_avg_val_score: 0.24,
    best_avg_test_score: 0.28,
    best_final_score: null,
    metric: 'rmse',
    task_type: 'regression',
    gain_from_previous_best: null,
    pipeline_count: 1,
    top_5: [topChain()],
    n_samples: 20,
    n_features: 128,
    ...overrides,
  };
}

function allChainEntry(overrides: Partial<AllChainEntry> = {}): AllChainEntry {
  return {
    chain_id: 'chain-api',
    run_id: 'run-1',
    pipeline_id: 'pipe-api',
    pipeline_name: 'API Pipeline',
    model_name: 'Ridge',
    model_class: 'Ridge',
    preprocessings: 'MSC',
    best_params: { alpha: 1 },
    variant_params: null,
    cv_val_score: 0.21,
    cv_test_score: 0.25,
    cv_train_score: 0.16,
    cv_fold_count: 3,
    cv_scores: {
      val: { rmse: 0.21 },
      test: { rmse: 0.25 },
    },
    cv_source_chain_id: null,
    final_test_score: 0.19,
    final_train_score: 0.12,
    final_scores: { rmse: 0.19 },
    final_agg_test_score: null,
    final_agg_train_score: null,
    final_agg_scores: null,
    metric: 'rmse',
    task_type: 'regression',
    is_refit_only: false,
    synthetic_refit: false,
    ...overrides,
  };
}

function partitionPrediction(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
  return {
    prediction_id: 'pred-test',
    pipeline_id: 'pipe-api',
    chain_id: 'chain-api',
    dataset_name: 'dataset-a',
    model_name: 'Ridge',
    model_class: 'Ridge',
    fold_id: 'fold-0',
    partition: 'test',
    val_score: 0.21,
    test_score: 0.25,
    train_score: 0.16,
    metric: 'rmse',
    task_type: 'regression',
    n_samples: 12,
    n_features: 128,
    preprocessings: 'MSC',
    ...overrides,
  };
}

describe('useDatasetResultCardQueries', () => {
  beforeEach(() => {
    apiMocks.getAllChainsForDataset.mockReset();
    apiMocks.getAllChainsForResultsDataset.mockReset();
    apiMocks.getChainPartitionDetail.mockReset();
  });

  it('uses parent-provided chains without fetching the full dataset history', async () => {
    const explicitChain = topChain({ chain_id: 'chain-explicit', avg_val_score: 0.18 });
    const openDetail = vi.fn();
    const mounted = await renderHook(() => useDatasetResultCardQueries({
      dataset: dataset(),
      allChains: [explicitChain],
      runId: 'run-1',
      workspaceId: 'workspace-1',
      expanded: true,
      quickViewPred: null,
      quickViewOpen: false,
      onOpenDetail: openDetail,
    }));

    expect(mounted.result.current!.useFullDatasetChains).toBe(false);
    expect(mounted.result.current!.chains).toEqual([explicitChain]);
    expect(mounted.result.current!.scoreRows[0]?.chainId).toBe('chain-explicit');
    expect(apiMocks.getAllChainsForDataset).not.toHaveBeenCalled();
    expect(apiMocks.getAllChainsForResultsDataset).not.toHaveBeenCalled();

    await mounted.unmount();
  });

  it('loads full run chains, normalizes them, and opens details from a score row', async () => {
    apiMocks.getAllChainsForDataset.mockResolvedValue({
      chains: [allChainEntry()],
      total: 1,
      metric: 'rmse',
    });
    const openDetail = vi.fn();
    const mounted = await renderHook(() => useDatasetResultCardQueries({
      dataset: dataset({ top_5: [topChain({ chain_id: 'chain-fallback' })] }),
      runId: 'run-1',
      workspaceId: 'workspace-1',
      expanded: true,
      quickViewPred: null,
      quickViewOpen: false,
      onOpenDetail: openDetail,
    }));

    await waitFor(() => {
      expect(apiMocks.getAllChainsForDataset).toHaveBeenCalledWith('workspace-1', 'run-1', 'dataset-a');
    });
    await waitFor(() => {
      expect(mounted.result.current!.chains[0]?.chain_id).toBe('chain-api');
    });

    const row = mounted.result.current!.scoreRows[0]!;
    expect(row.chainId).toBe('chain-api');

    await act(async () => {
      mounted.result.current!.handleViewDetails(row);
    });
    expect(openDetail).toHaveBeenCalledWith(expect.objectContaining({
      chain_id: 'chain-api',
      best_params: { alpha: 1 },
    }), row);
    expect(apiMocks.getAllChainsForResultsDataset).not.toHaveBeenCalled();

    await mounted.unmount();
  });

  it('preserves repeated run instances when loading full results dataset chains', async () => {
    apiMocks.getAllChainsForResultsDataset.mockResolvedValue({
      chains: [
        allChainEntry({
          chain_id: 'chain-run-1',
          run_id: 'run-1',
          final_test_score: 0.21,
          cv_val_score: 0.24,
        }),
        allChainEntry({
          chain_id: 'chain-run-2',
          run_id: 'run-2',
          final_test_score: 0.19,
          cv_val_score: 0.22,
        }),
      ],
      total: 2,
      metric: 'rmse',
    });
    const mounted = await renderHook(() => useDatasetResultCardQueries({
      dataset: dataset({ top_5: [topChain({ chain_id: 'summary-chain' })] }),
      workspaceId: 'workspace-1',
      expanded: true,
      quickViewPred: null,
      quickViewOpen: false,
      onOpenDetail: vi.fn(),
    }));

    await waitFor(() => {
      expect(apiMocks.getAllChainsForResultsDataset).toHaveBeenCalledWith('workspace-1', 'dataset-a');
    });
    await waitFor(() => {
      expect(mounted.result.current!.chains.map(chain => chain.chain_id)).toEqual(['chain-run-1', 'chain-run-2']);
    });

    expect(mounted.result.current!.scoreRows.filter(row => row.cardType === 'refit').map(row => row.chainId)).toEqual([
      'chain-run-2',
      'chain-run-1',
    ]);

    await mounted.unmount();
  });

  it('loads sibling partitions for the quick prediction viewer', async () => {
    const selectedPrediction = partitionPrediction({
      prediction_id: 'pred-test',
      partition: 'test',
    });
    const chainDetail: ChainPartitionDetailResponse = {
      chain_id: 'chain-api',
      predictions: [
        partitionPrediction({ prediction_id: 'pred-train', partition: 'train' }),
        selectedPrediction,
      ],
      total: 2,
      partition: null,
      fold_id: null,
    };
    apiMocks.getChainPartitionDetail.mockResolvedValue(chainDetail);
    const mounted = await renderHook(() => useDatasetResultCardQueries({
      dataset: dataset(),
      workspaceId: 'workspace-1',
      expanded: false,
      quickViewPred: selectedPrediction,
      quickViewOpen: true,
      onOpenDetail: vi.fn(),
    }));

    await waitFor(() => {
      expect(apiMocks.getChainPartitionDetail).toHaveBeenCalledWith('chain-api');
    });
    await waitFor(() => {
      expect(mounted.result.current!.viewerPartitions).toHaveLength(2);
    });

    expect(mounted.result.current!.viewerPartitions.map((partition) => partition.partition)).toEqual(['train', 'test']);
    expect(mounted.result.current!.viewerHeader).toMatchObject({
      datasetName: 'dataset-a',
      modelName: 'Ridge',
      foldId: 'fold-0',
    });

    await mounted.unmount();
  });
});
